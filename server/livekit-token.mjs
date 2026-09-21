import express from 'express';
import dotenv from 'dotenv';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import pLimit from 'p-limit';
import { evaluateLiveKitAccess, evaluateModerationAccess, isAllowedRoomCode, normalizeRoomCode } from './livekit-auth.mjs';
import { deliverEmailViaConfiguredProvider, deliverSmsViaConfiguredProvider, dispatchNotificationJob, notificationStatusPayload } from './notifications.mjs';
import { createRecordingStorageAdapter, describeRecordingDispatch, recordingStatusPayload } from './recordings.mjs';
import { aiStatusPayload, executeAiJob } from './ai.mjs';
import { transcriptionStatusPayload, executeTranscriptionJob } from './transcription.mjs';
import { createRateLimiter } from './rate-limit.mjs';
import { createGuestSessionHandlers } from './guest-session.mjs';
import { createTokenMetrics } from './token-metrics.mjs';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((item) => item.trim()).filter(Boolean);

// Scalability: Redis initialization
const redisUrl = process.env.REDIS_URL;
const redis = redisUrl ? new Redis(redisUrl, {
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 50, 2000),
}) : null;

const tokenRateLimiter = createRateLimiter({ redis });
const tokenMetrics = createTokenMetrics();
const authLimit = pLimit(50); // Bound remote dependency concurrency

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseJwtSecret = process.env.SUPABASE_JWT_SECRET;
const supabaseAnonKey = process.env.SUPABASE_ANON_KEY || process.env.VITE_SUPABASE_ANON_KEY;
// Prefer publishable/anon for password grant when present; fall back to service role (server-only).
const supabaseAuthKey = supabaseAnonKey || supabaseServiceRoleKey;
const livekitHost = process.env.LIVEKIT_HOST;
const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

app.use(express.json({ limit: '32kb' }));

function requestId() {
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

function logEvent(level, event, fields = {}) {
  console.log(JSON.stringify({
    ts: new Date().toISOString(),
    level,
    event,
    ...fields,
  }));
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/ready', async (_req, res) => {
  const dependencies = {
    supabaseAdmin: Boolean(supabaseAdmin),
    livekit: Boolean(process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET && livekitHost),
    guestJoin: Boolean(supabaseAdmin && supabaseUrl && supabaseAuthKey),
    redis: Boolean(redis),
  };

  // Probe Redis if configured
  if (redis) {
    try {
      const ping = await redis.ping();
      dependencies.redisStatus = ping === 'PONG' ? 'healthy' : 'degraded';
    } catch (err) {
      dependencies.redisStatus = 'down';
    }
  }

  // Probe Supabase
  if (supabaseAdmin) {
    try {
      const { error } = await supabaseAdmin.from('meetings').select('id').limit(1);
      dependencies.supabaseStatus = error ? 'degraded' : 'healthy';
    } catch (err) {
      dependencies.supabaseStatus = 'down';
    }
  }

  const ready = dependencies.supabaseAdmin && dependencies.livekit && (dependencies.supabaseStatus === 'healthy');
  res.status(ready ? 200 : 503).json({
    status: ready ? 'ready' : 'not_ready',
    dependencies,
  });
});

app.get('/api/livekit/metrics', (_req, res) => {
  // Aggregate counters only — never tokens, JWTs, emails, or secrets.
  res.json({
    service: 'letsmeet-token-api',
    ...tokenMetrics.snapshot(),
  });
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];
  req.requestId = requestId();
  res.setHeader('X-Request-Id', req.requestId);

  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  res.header('Access-Control-Allow-Origin', allowOrigin);
  res.header('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
  res.header('Access-Control-Allow-Headers', 'Content-Type,Authorization');
  res.header('Access-Control-Allow-Credentials', 'true');

  if (req.method === 'OPTIONS') {
    return res.sendStatus(204);
  }

  next();
});

app.get('/api/notifications/status', (_req, res) => {
  res.json(notificationStatusPayload());
});

app.get('/api/recordings/status', (_req, res) => {
  res.json({
    ...recordingStatusPayload(),
    transcription: transcriptionStatusPayload(),
    ai: aiStatusPayload(),
  });
});

app.get('/api/ai/status', (_req, res) => {
  res.json(aiStatusPayload());
});

app.get('/api/transcription/status', (_req, res) => {
  res.json(transcriptionStatusPayload());
});

const guestHandlers = createGuestSessionHandlers({
  supabaseAdmin,
  supabaseUrl,
  authKey: supabaseAuthKey,
  logEvent,
  redis,
});

app.get('/api/guest/meeting-preview', (req, res) => {
  tokenMetrics.recordGuestPreview();
  void guestHandlers.previewMeeting(req, res);
});

app.post('/api/guest/session', (req, res) => {
  const originalJson = res.json.bind(res);
  res.json = (body) => {
    tokenMetrics.recordGuestSession(res.statusCode < 400);
    return originalJson(body);
  };
  void guestHandlers.createGuestSession(req, res);
});

app.get('/api/livekit/token', async (req, res) => {
  const started = Date.now();
  const timing = {};
  const mark = (key) => {
    timing[key] = Date.now() - started;
  };
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const room = normalizeRoomCode(req.query.room);
  const authorization = req.headers.authorization || '';
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!apiKey || !apiSecret) {
    return res.status(500).json({
      error: 'LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be configured.',
    });
  }

  if (!authToken || !supabaseAdmin || !supabaseUrl) {
    const anonDecision = await tokenRateLimiter.evaluateTokenRequest({
      ip: req.ip,
      authenticated: false,
    });
    if (!anonDecision.ok) {
      tokenMetrics.recordTokenOutcome(429, { total_ms: Date.now() - started });
      return res.status(429).json({ error: 'Too many token requests. Try again shortly.' });
    }
    tokenMetrics.recordTokenOutcome(401, { total_ms: Date.now() - started });
    return res.status(401).json({ error: 'Authentication is required to join a meeting.' });
  }

  try {
    // Scalability: Local JWT verification if secret is available
    let user = null;
    let authError = null;

    if (supabaseJwtSecret) {
      try {
        const decoded = jwt.verify(authToken, supabaseJwtSecret);
        // Supabase JWT payload contains user id in 'sub'
        user = {
          id: decoded.sub,
          email: decoded.email,
          user_metadata: decoded.user_metadata || {},
        };
      } catch (err) {
        authError = err;
      }
    }

    // Auth and meeting resolution do not depend on each other — overlap the RTTs.
    const authStarted = Date.now();
    const meetingStarted = Date.now();

    // Only call getUser if local verify was skipped or failed. Bounded concurrency.
    const authPromise = authLimit(() => user
      ? Promise.resolve({ data: { user }, error: null })
      : supabaseAdmin.auth.getUser(authToken));

    const meetingPromise = authLimit(() => isAllowedRoomCode(room)
      ? supabaseAdmin
          .from('meetings')
          .select('id, code, host_id, status, organization_id, workspace_id')
          .eq('code', room)
          .maybeSingle()
      : Promise.resolve({ data: null, error: null }));

    const [authResult, meetingResult] = await Promise.all([authPromise, meetingPromise]);

    timing.auth_ms = Date.now() - authStarted;
    timing.meeting_ms = Date.now() - meetingStarted;
    mark('auth_meeting_wall_ms');

    user = authResult.data?.user;
    if (authResult.error || !user) {
      tokenMetrics.recordTokenOutcome(401, timing);
      return res.status(401).json({ error: 'Session is invalid or expired.' });
    }

    const rateStarted = Date.now();
    const rate = await tokenRateLimiter.evaluateTokenRequest({
      ip: req.ip,
      userId: user.id,
      room,
      authenticated: true,
    });
    timing.rate_limit_ms = Date.now() - rateStarted;
    if (!rate.ok) {
      timing.total_ms = Date.now() - started;
      tokenMetrics.recordTokenOutcome(429, timing);
      logEvent('warn', 'token.rate_limited', {
        requestId: req.requestId,
        reason: rate.reason,
        room,
        userId: user.id,
        durationMs: Date.now() - started,
        ...timing,
      });
      return res.status(429).json({ error: 'Too many token requests. Try again shortly.' });
    }

    if (meetingResult.error) {
      return res.status(500).json({ error: 'Unable to resolve the meeting.' });
    }
    const meeting = meetingResult.data;

    // evaluateLiveKitAccess authorizes via participant row (+ meeting status).
    // Organization/workspace lookups were unused for the allow/deny decision and
    // added a third remote query under concurrency.
    const participantStarted = Date.now();
    const { data: participant } = meeting
      ? await authLimit(() => supabaseAdmin
          .from('meeting_participants')
          .select('id, meeting_id, user_id, organization_id, workspace_id, role, status')
          .eq('meeting_id', meeting.id)
          .eq('user_id', user.id)
          .maybeSingle())
      : { data: null };
    timing.participant_ms = Date.now() - participantStarted;

    const authzStarted = Date.now();
    const decision = evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: user.id,
      userName: user.user_metadata?.full_name ?? user.email ?? 'Meeting Participant',
      requestedRoom: room,
      meeting,
      participant,
      organizationMember: false,
      workspaceMember: false,
      requestedIdentity: req.query.identity,
      requestedName: req.query.name,
      requestedRole: req.query.role,
      requestedOrganizationId: req.query.organization_id,
      requestedWorkspaceId: req.query.workspace_id,
    });
    timing.authorization_ms = Date.now() - authzStarted;

    if (!decision.ok) {
      timing.total_ms = Date.now() - started;
      tokenMetrics.recordTokenOutcome(decision.status, timing);
      logEvent('info', 'token.denied', {
        requestId: req.requestId,
        room,
        userId: user.id,
        status: decision.status,
        durationMs: Date.now() - started,
        ...timing,
      });
      return res.status(decision.status).json({ error: decision.error });
    }

    const livekitStarted = Date.now();
    const at = new AccessToken(apiKey, apiSecret, {
      identity: decision.identity,
      name: decision.name,
      ttl: 60 * 60 * 6,
    });

    at.addGrant({
      room: decision.room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();
    timing.livekit_token_ms = Date.now() - livekitStarted;
    timing.total_ms = Date.now() - started;

    res.setHeader(
      'Server-Timing',
      [
        `auth;dur=${timing.auth_ms}`,
        `meeting;dur=${timing.meeting_ms}`,
        `auth_meeting_wall;dur=${timing.auth_meeting_wall_ms}`,
        `participant;dur=${timing.participant_ms}`,
        `authorization;dur=${timing.authorization_ms}`,
        `livekit;dur=${timing.livekit_token_ms}`,
        `total;dur=${timing.total_ms}`,
      ].join(', '),
    );

    logEvent('info', 'token.issued', {
      requestId: req.requestId,
      room: decision.room,
      userId: user.id,
      durationMs: timing.total_ms,
      ...timing,
    });
    tokenMetrics.recordTokenOutcome(200, timing);
    return res.json({ token, room: decision.room, identity: decision.identity, name: decision.name });
  } catch (error) {
    timing.total_ms = Date.now() - started;
    tokenMetrics.recordTokenOutcome(500, timing);
    logEvent('error', 'token.failed', {
      requestId: req.requestId,
      room,
      durationMs: Date.now() - started,
      message: error instanceof Error ? error.message : 'unknown',
      ...timing,
    });
    return res.status(500).json({ error: 'Unable to issue a LiveKit token.' });
  }
});

app.post('/api/livekit/moderate', async (req, res) => {
  const apiKey = process.env.LIVEKIT_API_KEY;
  const apiSecret = process.env.LIVEKIT_API_SECRET;
  const room = normalizeRoomCode(req.body?.room);
  const targetIdentity = String(req.body?.targetIdentity ?? '');
  const action = String(req.body?.action ?? '');
  const authorization = req.headers.authorization || '';
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!apiKey || !apiSecret || !livekitHost) {
    return res.status(503).json({ error: 'LiveKit moderation is not configured.' });
  }
  if (!authToken || !supabaseAdmin) {
    return res.status(401).json({ error: 'Authentication is required.' });
  }
  if (!isAllowedRoomCode(room) || !/^[0-9a-f-]{36}$/i.test(targetIdentity)) {
    return res.status(400).json({ error: 'Meeting or participant identifier is invalid.' });
  }

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authToken);
    if (authError || !user) {
      return res.status(401).json({ error: 'Session is invalid or expired.' });
    }

    const { data: meeting, error: meetingError } = await supabaseAdmin
      .from('meetings')
      .select('id, code, host_id, status, organization_id, workspace_id')
      .eq('code', room)
      .maybeSingle();
    if (meetingError) return res.status(500).json({ error: 'Unable to resolve the meeting.' });

    const { data: targetParticipant, error: participantError } = meeting
      ? await supabaseAdmin
          .from('meeting_participants')
          .select('id, user_id, role, status, organization_id, workspace_id, left_at')
          .eq('meeting_id', meeting.id)
          .eq('user_id', targetIdentity)
          .maybeSingle()
      : { data: null, error: null };
    if (participantError) return res.status(500).json({ error: 'Unable to resolve the participant.' });

    const decision = evaluateModerationAccess({
      isAuthenticated: true,
      actorId: user.id,
      meeting,
      targetParticipant,
      action,
    });
    if (!decision.ok) {
      tokenMetrics.recordModeration(false);
      return res.status(decision.status).json({ error: decision.error });
    }

    const { error: updateError } = await supabaseAdmin
      .from('meeting_participants')
      .update({
        status: action === 'remove' ? 'removed' : 'muted',
        left_at: action === 'remove' ? new Date().toISOString() : targetParticipant.left_at,
      })
      .eq('id', targetParticipant.id);
    if (updateError) return res.status(500).json({ error: 'Participant state could not be persisted.' });

    const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);
    if (action === 'mute') {
      const participantInfo = await roomService.getParticipant(room, targetIdentity);
      const microphoneTracks = participantInfo.tracks.filter((track) => track.source === TrackSource.MICROPHONE);
      await Promise.all(microphoneTracks.map((track) => roomService.mutePublishedTrack(room, targetIdentity, track.sid, true)));
    } else {
      await roomService.removeParticipant(room, targetIdentity, {
        revokeTokenTs: BigInt(Math.floor(Date.now() / 1000)),
      });
    }

    tokenMetrics.recordModeration(true);
    return res.json({ ok: true, action, targetIdentity });
  } catch (error) {
    tokenMetrics.recordModeration(false);
    console.error('Failed to moderate LiveKit participant', error);
    return res.status(502).json({ error: 'The participant could not be moderated.' });
  }
});

app.post('/api/recordings/start', async (req, res) => {
  const recordingId = String(req.body?.recordingId ?? '');
  const authorization = req.headers.authorization || '';
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!authToken || !supabaseAdmin) return res.status(401).json({ error: 'Authentication is required.' });
  if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return res.status(400).json({ error: 'Recording identifier is invalid.' });

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authToken);
    if (authError || !user) return res.status(401).json({ error: 'Session is invalid or expired.' });

    const { data: recording, error: recordingError } = await supabaseAdmin
      .from('meeting_recordings')
      .select('id, meeting_id, organization_id, workspace_id, started_by, status')
      .eq('id', recordingId)
      .maybeSingle();

    if (recordingError) return res.status(500).json({ error: 'Unable to resolve the recording.' });
    if (!recording) return res.status(404).json({ error: 'Recording not found.' });

    // Multi-tenant authorization: Check if user is host or admin
    const { data: canManage } = await supabaseAdmin.rpc('can_manage_recordings', { p_meeting_id: recording.meeting_id });
    if (!canManage) return res.status(403).json({ error: 'Unauthorized to manage recordings for this meeting.' });

    if (!['queued', 'failed'].includes(recording.status)) {
      return res.status(409).json({ error: `Recording is already in ${recording.status} state.`, status: recording.status });
    }

    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('id, code, host_id, status')
      .eq('id', recording.meeting_id)
      .maybeSingle();

    if (!meeting || meeting.status !== 'live') {
      return res.status(400).json({ error: 'Meeting must be live to start recording.' });
    }

    const dispatch = describeRecordingDispatch(recording);
    const storage = createRecordingStorageAdapter();

    if (!dispatch.started || !storage) {
      return res.status(503).json({
        ok: false,
        recordingId,
        status: RECORDING_STATUS.QUEUED,
        error: dispatch.reason,
        providerRequired: true,
      });
    }

    const { EgressClient } = await import('livekit-server-sdk');
    const egress = new EgressClient(process.env.LIVEKIT_HOST, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

    // Update status to starting before calling LiveKit to prevent races
    await supabaseAdmin.from('meeting_recordings').update({
      status: RECORDING_STATUS.STARTING,
      updated_at: new Date().toISOString(),
    }).eq('id', recording.id);

    try {
      const info = await egress.startRoomCompositeEgress(meeting.code, {
        file: {
          filepath: storage.objectKeyFor(recording),
          s3: {
            accessKey: process.env.RECORDING_STORAGE_ACCESS_KEY,
            secret: process.env.RECORDING_STORAGE_SECRET,
            region: process.env.RECORDING_STORAGE_REGION,
            bucket: storage.bucket,
          },
        },
      });

      await supabaseAdmin.from('meeting_recordings').update({
        status: RECORDING_STATUS.ACTIVE,
        egress_id: String(info?.egressId ?? info?.egress_id ?? ''),
        storage_provider: storage.provider,
        storage_key: storage.objectKeyFor(recording),
        started_at: new Date().toISOString(),
      }).eq('id', recording.id);

      tokenMetrics.recordRecordingStarted();
      return res.json({ ok: true, recordingId, status: RECORDING_STATUS.ACTIVE });
    } catch (lkError) {
      console.error('LiveKit egress start failed', lkError);
      await supabaseAdmin.from('meeting_recordings').update({
        status: RECORDING_STATUS.FAILED,
        error: `LiveKit egress could not be started: ${lkError.message}`,
      }).eq('id', recording.id);
      tokenMetrics.recordRecordingFailed();
      return res.status(502).json({ error: 'LiveKit egress could not be started.' });
    }
  } catch (error) {
    console.error('Internal recording start error', error);
    return res.status(500).json({ error: 'Internal server error while starting recording.' });
  }
});

app.post('/api/recordings/stop', async (req, res) => {
  const recordingId = String(req.body?.recordingId ?? '');
  const authorization = req.headers.authorization || '';
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!authToken || !supabaseAdmin) return res.status(401).json({ error: 'Authentication is required.' });
  if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return res.status(400).json({ error: 'Recording identifier is invalid.' });

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authToken);
    if (authError || !user) return res.status(401).json({ error: 'Session is invalid or expired.' });

    const { data: recording, error: recordingError } = await supabaseAdmin
      .from('meeting_recordings')
      .select('id, meeting_id, status, egress_id')
      .eq('id', recordingId)
      .maybeSingle();

    if (recordingError || !recording) return res.status(404).json({ error: 'Recording not found.' });

    const { data: canManage } = await supabaseAdmin.rpc('can_manage_recordings', { p_meeting_id: recording.meeting_id });
    if (!canManage) return res.status(403).json({ error: 'Unauthorized to manage recordings.' });

    if (recording.status === RECORDING_STATUS.COMPLETED) {
      return res.json({ ok: true, recordingId, status: RECORDING_STATUS.COMPLETED });
    }

    if (!['starting', 'active'].includes(recording.status) || !recording.egress_id) {
      // If it was just queued, we can cancel it
      if (recording.status === RECORDING_STATUS.QUEUED) {
        await supabaseAdmin.from('meeting_recordings').update({
          status: RECORDING_STATUS.CANCELLED,
          updated_at: new Date().toISOString(),
        }).eq('id', recording.id);
        return res.json({ ok: true, recordingId, status: RECORDING_STATUS.CANCELLED });
      }
      return res.status(409).json({ error: `Recording is in ${recording.status} state and cannot be stopped.`, status: recording.status });
    }

    const { EgressClient } = await import('livekit-server-sdk');
    const egress = new EgressClient(process.env.LIVEKIT_HOST, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

    await supabaseAdmin.from('meeting_recordings').update({
      status: RECORDING_STATUS.STOPPING,
      updated_at: new Date().toISOString(),
    }).eq('id', recording.id);

    try {
      await egress.stopEgress(recording.egress_id);

      // We don't mark as COMPLETED here yet because we should wait for LiveKit webhook
      // or a background processor to confirm the file is in storage.
      // But for now, we mark it as processing/stopping.
      return res.json({ ok: true, recordingId, status: RECORDING_STATUS.STOPPING });
    } catch (lkError) {
      console.error('LiveKit egress stop failed', lkError);
      // Revert to active if stop failed, or mark as failed if it's a permanent error
      return res.status(502).json({ error: 'LiveKit egress could not be stopped.' });
    }
  } catch (error) {
    console.error('Internal recording stop error', error);
    return res.status(500).json({ error: 'Internal server error while stopping recording.' });
  }
});

async function dispatchDueNotificationJobs() {
  if (!supabaseAdmin) return;
  const nowIso = new Date().toISOString();
  const { data: jobs, error } = await supabaseAdmin
    .from('meeting_notification_jobs')
    .select('id, meeting_id, invite_id, organization_id, workspace_id, channel, template, status, recipient, scheduled_for, next_attempt_at, attempt_count, max_attempts, idempotency_key')
    .eq('status', 'pending')
    .lte('scheduled_for', nowIso)
    .or(`next_attempt_at.is.null,next_attempt_at.lte.${nowIso}`)
    .limit(20);
  if (error || !jobs?.length) return;

  for (const job of jobs) {
    const { data: claimed } = await supabaseAdmin.rpc('claim_notification_job', { p_job_id: job.id });
    if (!claimed) continue;

    const result = await dispatchNotificationJob(claimed, {
      deliverEmail: deliverEmailViaConfiguredProvider,
      deliverSms: deliverSmsViaConfiguredProvider,
      async deliverInApp(current) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('email', current.recipient)
          .maybeSingle();
        if (!user) {
          return { delivered: false, skipped: true, reason: 'Recipient does not have an account yet.' };
        }
        const { error: insertError } = await supabaseAdmin.from('in_app_notifications').insert({
          organization_id: current.organization_id,
          user_id: user.id,
          title: current.template === 'meeting_invitation' ? 'Meeting invitation' : 'Meeting reminder',
          body: `A ${String(current.template).replace(/_/g, ' ')} is waiting in LeTsMeet.`,
          meeting_id: current.meeting_id,
        });
        if (insertError) return { delivered: false, skipped: false, reason: insertError.message };
        return { delivered: true, skipped: false, provider: 'in_app', providerMessageId: null };
      },
    });

    if (result.delivered) {
      await supabaseAdmin.rpc('complete_notification_job', {
        p_job_id: claimed.id,
        p_provider: result.provider ?? claimed.channel,
        p_provider_message_id: result.providerMessageId ?? null,
      });
      continue;
    }
    if (result.skipped) {
      // Leave email/SMS pending without claiming delivery. Release processing lock.
      await supabaseAdmin.rpc('release_notification_job', { p_job_id: claimed.id });
      continue;
    }

    const attempts = (claimed.attempt_count ?? job.attempt_count ?? 0) + 1;
    const maxAttempts = claimed.max_attempts ?? job.max_attempts ?? 5;
    await supabaseAdmin.from('meeting_notification_jobs').update({
      attempt_count: attempts,
      last_error: String(result.reason ?? 'Delivery failed').slice(0, 500),
      status: attempts >= maxAttempts ? 'failed' : 'pending',
      next_attempt_at: attempts >= maxAttempts
        ? null
        : new Date(Date.now() + (2 ** Math.max(attempts - 1, 0)) * 60_000).toISOString(),
    }).eq('id', claimed.id);
  }
}

async function processQueuedProviderJobs() {
  if (!supabaseAdmin) return;

  const { data: aiJobs } = await supabaseAdmin
    .from('meeting_ai_jobs')
    .select('id, meeting_id, organization_id, workspace_id, requested_by, job_type, prompt, status')
    .eq('status', 'queued')
    .limit(10);

  for (const job of aiJobs ?? []) {
    const result = await executeAiJob(job);
    if (result.skipped) {
      // Remain queued / PROVIDER_REQUIRED — never mark completed without a provider.
      continue;
    }
    if (result.completed) {
      await supabaseAdmin.from('meeting_ai_jobs').update({
        status: 'completed',
        result: result.result ?? {},
        completed_at: new Date().toISOString(),
      }).eq('id', job.id);
      continue;
    }
    await supabaseAdmin.from('meeting_ai_jobs').update({
      status: 'failed',
      error: String(result.reason ?? 'AI provider failed').slice(0, 500),
    }).eq('id', job.id);
  }

  const { data: transcriptJobs } = await supabaseAdmin
    .from('meeting_transcripts')
    .select('id, meeting_id, organization_id, workspace_id, status')
    .eq('status', 'queued')
    .limit(10);

  for (const job of transcriptJobs ?? []) {
    const result = await executeTranscriptionJob(job);
    if (result.skipped) continue;
    if (result.completed) {
      await supabaseAdmin.from('meeting_transcripts').update({
        status: 'completed',
        updated_at: new Date().toISOString(),
      }).eq('id', job.id);
      continue;
    }
    await supabaseAdmin.from('meeting_transcripts').update({
      status: 'failed',
      error: String(result.reason ?? 'Transcription provider failed').slice(0, 500),
      updated_at: new Date().toISOString(),
    }).eq('id', job.id);
  }
}

app.post('/api/transcription/request', async (req, res) => {
  const meetingId = String(req.body?.meetingId ?? '');
  const recordingId = req.body?.recordingId ? String(req.body.recordingId) : null;
  const authorization = req.headers.authorization || '';
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!authToken || !supabaseAdmin) return res.status(401).json({ error: 'Authentication is required.' });
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) return res.status(400).json({ error: 'Meeting identifier is invalid.' });

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authToken);
    if (authError || !user) return res.status(401).json({ error: 'Session is invalid or expired.' });

    const { data: transcript, error: transcriptError } = await supabaseAdmin.rpc('request_meeting_transcription', {
      p_meeting_id: meetingId,
      p_recording_id: recordingId,
    });

    if (transcriptError) {
      return res.status(500).json({ error: `Unable to request transcription: ${transcriptError.message}` });
    }

    tokenMetrics.recordTranscriptionJobQueued();
    return res.json({ ok: true, transcriptId: transcript.id, status: transcript.status });
  } catch (error) {
    console.error('Internal transcription request error', error);
    return res.status(500).json({ error: 'Internal server error while requesting transcription.' });
  }
});

app.post('/api/ai/request', async (req, res) => {
  const meetingId = String(req.body?.meetingId ?? '');
  const jobType = String(req.body?.jobType ?? 'summary');
  const prompt = req.body?.prompt ? String(req.body.prompt) : null;
  const authorization = req.headers.authorization || '';
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';

  if (!authToken || !supabaseAdmin) return res.status(401).json({ error: 'Authentication is required.' });
  if (!/^[0-9a-f-]{36}$/i.test(meetingId)) return res.status(400).json({ error: 'Meeting identifier is invalid.' });

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authToken);
    if (authError || !user) return res.status(401).json({ error: 'Session is invalid or expired.' });

    const { data: job, error: jobError } = await supabaseAdmin.rpc('request_meeting_ai_job', {
      p_meeting_id: meetingId,
      p_job_type: jobType,
      p_prompt: prompt,
    });

    if (jobError) {
      return res.status(500).json({ error: `Unable to request AI job: ${jobError.message}` });
    }

    tokenMetrics.recordAiJobQueued();
    return res.json({ ok: true, jobId: job.id, status: job.status });
  } catch (error) {
    console.error('Internal AI request error', error);
    return res.status(500).json({ error: 'Internal server error while requesting AI job.' });
  }
});
app.listen(port, () => {
  logEvent('info', 'server.listen', { port });
  console.log(`LiveKit token endpoint listening on http://localhost:${port}`);
  setInterval(() => {
    void dispatchDueNotificationJobs();
    void processQueuedProviderJobs();
  }, 60_000);
});
