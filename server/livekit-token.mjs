import express from 'express';
import dotenv from 'dotenv';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';
import Redis from 'ioredis';
import jwt from 'jsonwebtoken';
import pLimit from 'p-limit';
import { evaluateLiveKitAccess, evaluateModerationAccess, evaluateRecordingAccess, isValidRecordingTransition, isAllowedRoomCode, normalizeRoomCode } from './livekit-auth.mjs';
import { deliverEmailViaConfiguredProvider, deliverSmsViaConfiguredProvider, dispatchNotificationJob, notificationStatusPayload } from './notifications.mjs';
import { createRecordingStorageAdapter, describeRecordingDispatch, recordingStatusPayload, verifyStorageObjectExists, RECORDING_STATUS, isIllegalTransitionError } from './recordings.mjs';
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
export { redis };
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

async function recordPlatformActivity({ actorId, eventType, organizationId, resourceType, resourceId, details = {} }) {
  if (!supabaseAdmin) return;
  try {
    const { error } = await supabaseAdmin.from('platform_activity_events').insert({
      actor_id: actorId,
      event_type: eventType,
      organization_id: organizationId,
      resource_type: resourceType,
      resource_id: resourceId,
      details,
    });
    if (error) {
      console.error('Failed to log platform activity event:', error.message);
    }
  } catch (err) {
    console.warn('Failed to log platform activity event:', err?.message || err);
  }
}

async function recordLoginEvent({ userId, email, eventType, req, metadata = {} }) {
  if (!supabaseAdmin) return;
  try {
    await supabaseAdmin.from('login_events').insert({
      user_id: userId,
      email,
      event_type: eventType,
      ip_address: req?.ip || null,
      user_agent: req?.headers?.['user-agent'] || null,
      metadata,
    });
  } catch (err) {
    console.warn('Failed to log login event:', err?.message || err);
  }
}

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
        reason: decision.error,
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
      canPublish: decision.permissions.canPublish,
      canSubscribe: decision.permissions.canSubscribe,
      canPublishData: decision.permissions.canPublishData,
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

    void recordLoginEvent({
      userId: user.id,
      email: user.email,
      eventType: 'login_success',
      req,
      metadata: { room: decision.room },
    });

    void recordPlatformActivity({
      actorId: user.id,
      eventType: 'MEETING_JOINED',
      organizationId: meeting?.organization_id,
      resourceType: 'meeting',
      resourceId: decision.room,
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

    const { data: actorParticipant } = await supabaseAdmin
      .from('meeting_participants')
      .select('id, user_id, role, status')
      .eq('meeting_id', meeting.id)
      .eq('user_id', user.id)
      .maybeSingle();

    const decision = evaluateModerationAccess({
      isAuthenticated: true,
      actorId: user.id,
      meeting,
      actorParticipant,
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
        status: action === 'remove' ? 'removed' : action === 'unmute' || action === 'admit' ? 'joined' : 'muted',
        left_at: action === 'remove' ? new Date().toISOString() : targetParticipant.left_at,
      })
      .eq('id', targetParticipant.id);
    if (updateError) return res.status(500).json({ error: 'Participant state could not be persisted.' });

    const roomService = new RoomServiceClient(livekitHost, apiKey, apiSecret);
    if (action === 'mute') {
      const participantInfo = await roomService.getParticipant(room, targetIdentity);
      const microphoneTracks = participantInfo.tracks.filter((track) => track.source === TrackSource.MICROPHONE);
      await Promise.all(microphoneTracks.map((track) => roomService.mutePublishedTrack(room, targetIdentity, track.sid, true)));
    } else if (action === 'unmute' || action === 'admit') {
      // LiveKit server-side unmute just enables the ability to publish again if it was a permission restriction.
      // If we just muted the track, we can't un-mute it server-side for most track types (security).
      // However, since we use token permissions, the user needs to re-fetch the token OR we update their permissions in the room.
      await roomService.updateParticipant(room, targetIdentity, undefined, {
        canPublish: true,
        canSubscribe: true,
        canPublishData: true,
      });
    } else {
      await roomService.removeParticipant(room, targetIdentity);
    }

    tokenMetrics.recordModeration(true);
    return res.json({ ok: true, action, targetIdentity });
  } catch (error) {
    tokenMetrics.recordModeration(false);
    console.error('Failed to moderate LiveKit participant', error);
    return res.status(502).json({ error: 'The participant could not be moderated.' });
  }
});

/**
 * Verify the recording object exists in storage before a recording may become COMPLETED.
 * Returns { verified: true } | { verified: false, reason } (object definitively missing)
 *       | { verified: null, transient: true } (could not determine; caller must not mutate state).
 * When storage is not configured the check is skipped with a warning, unless
 * RECORDING_REQUIRE_STORAGE_VERIFICATION=true, in which case completion is refused.
 */
async function verifyCompletionObject(storageKey) {
  const storage = createRecordingStorageAdapter();
  if (!storage) {
    if (process.env.RECORDING_REQUIRE_STORAGE_VERIFICATION === 'true') {
      return { verified: null, transient: true, reason: 'Storage is not configured; completion cannot be verified.' };
    }
    console.warn('Recording completion accepted WITHOUT storage verification: storage adapter not configured.');
    return { verified: true, skipped: true };
  }
  try {
    const exists = await verifyStorageObjectExists(storage, storageKey);
    return exists
      ? { verified: true }
      : { verified: false, reason: 'Egress completed but output file could not be verified in storage.' };
  } catch {
    return { verified: null, transient: true, reason: 'Storage verification was inconclusive.' };
  }
}

/**
 * A recording status write was rejected. Trigger rejections (stale / out-of-order events) are
 * acknowledged with an explicit ignored=true body so senders do not retry a permanent condition;
 * anything else is a real persistence failure and returns 500 so it can be retried.
 */
async function respondToRejectedTransition(res, recordingId, updateErr, target) {
  if (isIllegalTransitionError(updateErr)) {
    const { data: current } = await supabaseAdmin
      .from('meeting_recordings').select('status').eq('id', recordingId).maybeSingle();
    console.warn(`Ignoring stale ${target} event for recording ${recordingId}: ${updateErr.message}`);
    return res.json({ ok: true, ignored: true, reason: 'illegal_transition', recordingId, status: current?.status ?? null });
  }
  console.error(`Failed to persist ${target} for recording ${recordingId}:`, updateErr);
  return res.status(500).json({ error: `Failed to persist ${target} state.` });
}

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
    const { data: canManage } = await supabaseAdmin.rpc('can_manage_recordings_for_user', { p_meeting_id: recording.meeting_id, p_user_id: user.id });
    if (!canManage) return res.status(403).json({ error: 'Unauthorized to manage recordings for this meeting.' });

    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('id, code, host_id, status, organization_id, workspace_id')
      .eq('id', recording.meeting_id)
      .maybeSingle();

    const accessDecision = evaluateRecordingAccess({
      isAuthenticated: true,
      userId: user.id,
      meeting,
      recording,
      actorRole: meeting?.host_id === user.id ? 'host' : 'participant',
      isOrgAdmin: Boolean(canManage),
      action: 'start',
    });

    if (!accessDecision.ok) {
      return res.status(accessDecision.status).json({ error: accessDecision.error });
    }

    // Single Active Recording Invariant: ensure no other recording is currently active/starting for this meeting
    const { data: activeRecordings } = await supabaseAdmin
      .from('meeting_recordings')
      .select('id, status')
      .eq('meeting_id', recording.meeting_id)
      .in('status', [RECORDING_STATUS.STARTING, RECORDING_STATUS.ACTIVE])
      .neq('id', recording.id);

    if (activeRecordings?.length) {
      return res.status(409).json({
        error: 'Another recording is already active for this meeting.',
        activeRecordingId: activeRecordings[0].id,
        status: activeRecordings[0].status,
      });
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
    const { error: startingErr } = await supabaseAdmin.from('meeting_recordings').update({
      status: RECORDING_STATUS.STARTING,
      updated_at: new Date().toISOString(),
    }).eq('id', recording.id);

    if (startingErr) {
      console.error('Failed to transition recording to starting:', startingErr);
      return res.status(409).json({ error: `State transition to starting rejected: ${startingErr.message}` });
    }

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

      const { error: activeErr } = await supabaseAdmin.from('meeting_recordings').update({
        status: RECORDING_STATUS.ACTIVE,
        egress_id: String(info?.egressId ?? info?.egress_id ?? ''),
        storage_provider: storage.provider,
        storage_key: storage.objectKeyFor(recording),
        started_at: new Date().toISOString(),
      }).eq('id', recording.id);

      if (activeErr) {
        console.error('Failed to transition recording to active:', activeErr);
        await egress.stopEgress(String(info?.egressId ?? info?.egress_id ?? '')).catch(() => undefined);
        return res.status(500).json({ error: `Failed to persist active recording state: ${activeErr.message}` });
      }

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

    const { data: canManage } = await supabaseAdmin.rpc('can_manage_recordings_for_user', { p_meeting_id: recording.meeting_id, p_user_id: user.id });
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

    const { error: stoppingErr } = await supabaseAdmin.from('meeting_recordings').update({
      status: RECORDING_STATUS.STOPPING,
      updated_at: new Date().toISOString(),
    }).eq('id', recording.id);

    if (stoppingErr) {
      console.error('Failed to transition recording to stopping:', stoppingErr);
      return res.status(409).json({ error: `State transition to stopping rejected: ${stoppingErr.message}` });
    }

    try {
      await egress.stopEgress(recording.egress_id);

      return res.json({ ok: true, recordingId, status: RECORDING_STATUS.STOPPING });
    } catch (lkError) {
      console.error('LiveKit egress stop failed', lkError);
      await supabaseAdmin.from('meeting_recordings').update({
        status: RECORDING_STATUS.ACTIVE,
        error: `Stop failed: ${lkError?.message || lkError}`,
        updated_at: new Date().toISOString(),
      }).eq('id', recording.id);

      return res.status(502).json({ error: 'LiveKit egress could not be stopped. Recording remains active.' });
    }
  } catch (error) {
    console.error('Internal recording stop error', error);
    return res.status(500).json({ error: 'Internal server error while stopping recording.' });
  }
});

app.post('/api/recordings/playback-url', async (req, res) => {
  const recordingId = String(req.body?.recordingId ?? '');
  const authorization = req.headers.authorization || '';
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!authToken || !supabaseAdmin) return res.status(401).json({ error: 'Authentication is required.' });
  if (!/^[0-9a-f-]{36}$/i.test(recordingId)) return res.status(400).json({ error: 'Recording identifier is invalid.' });

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authToken);
    if (authError || !user) return res.status(401).json({ error: 'Session is invalid or expired.' });

    const { data: recording } = await supabaseAdmin
      .from('meeting_recordings')
      .select('id, meeting_id, organization_id, workspace_id, status, playback_url, storage_key')
      .eq('id', recordingId)
      .maybeSingle();

    if (!recording) return res.status(404).json({ error: 'Recording not found.' });

    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('id, code, host_id, status, organization_id, workspace_id')
      .eq('id', recording.meeting_id)
      .maybeSingle();

    const { data: canManage } = await supabaseAdmin.rpc('can_manage_recordings_for_user', { p_meeting_id: recording.meeting_id, p_user_id: user.id });

    const accessDecision = evaluateRecordingAccess({
      isAuthenticated: true,
      userId: user.id,
      meeting,
      recording,
      actorRole: meeting?.host_id === user.id ? 'host' : 'participant',
      isOrgAdmin: Boolean(canManage),
      action: 'playback',
    });

    if (!accessDecision.ok) {
      return res.status(accessDecision.status).json({ error: accessDecision.error });
    }

    if (!recording.playback_url) {
      return res.status(404).json({ error: 'Playback URL is not available for this recording.' });
    }

    return res.json({ ok: true, recordingId, playbackUrl: recording.playback_url });
  } catch (error) {
    console.error('Playback URL error:', error);
    return res.status(500).json({ error: 'Internal server error while resolving playback URL.' });
  }
});

app.post('/api/livekit/webhook', express.raw({ type: ['application/webhook+json', 'application/json'] }), async (req, res) => {
  const authHeader = req.headers.authorization || '';
  if (!authHeader) {
    return res.status(401).json({ error: 'Authorization header is required.' });
  }

  const apiKey = process.env.LIVEKIT_API_KEY || 'devkey';
  const apiSecret = process.env.LIVEKIT_API_SECRET || 'secretkey';
  if (!supabaseAdmin) {
    return res.status(503).json({ error: 'Webhook processing unavailable.' });
  }

  try {
    const { WebhookReceiver, EgressStatus } = await import('livekit-server-sdk');
    const receiver = new WebhookReceiver(apiKey, apiSecret);

    const rawBody = typeof req.body === 'string'
      ? req.body
      : Buffer.isBuffer(req.body)
        ? req.body.toString('utf-8')
        : JSON.stringify(req.body);

    const token = authHeader.startsWith('Bearer ') ? authHeader.slice(7) : authHeader;
    const event = await receiver.receive(rawBody, token, false, '10s');
    const egressInfo = event?.egressInfo || event?.egress_info;
    if (!egressInfo) {
      return res.json({ ok: true, ignored: true });
    }

    const egressId = egressInfo.egressId || egressInfo.egress_id;
    if (!egressId) {
      return res.json({ ok: true, ignored: true });
    }

    const { data: recording } = await supabaseAdmin
      .from('meeting_recordings')
      .select('id, meeting_id, organization_id, workspace_id, status, storage_key')
      .eq('egress_id', egressId)
      .maybeSingle();

    if (!recording) {
      return res.json({ ok: true, unmapped: true });
    }

    // Terminal State Monotonicity: COMPLETED or CANCELLED recordings cannot be overwritten by out-of-order egress events
    if ([RECORDING_STATUS.COMPLETED, RECORDING_STATUS.CANCELLED].includes(recording.status)) {
      return res.json({ ok: true, recordingId: recording.id, status: recording.status, idempotent: true });
    }

    const egressStatus = egressInfo.status;
    const isComplete = egressStatus === EgressStatus.EGRESS_COMPLETE || egressStatus === 3 || String(egressStatus).toUpperCase() === 'EGRESS_COMPLETE';
    const isFailed = egressStatus === EgressStatus.EGRESS_FAILED || egressStatus === EgressStatus.EGRESS_ABORTED || egressStatus === 4 || egressStatus === 5;

    if (isComplete) {
      const fileResult = egressInfo.fileResults?.[0] || egressInfo.file_results?.[0];
      const storageKey = fileResult?.filename || recording.storage_key;
      const location = fileResult?.location || fileResult?.downloadUrl || fileResult?.download_url;

      const verification = await verifyCompletionObject(storageKey);

      if (verification.verified === null) {
        console.warn(`Deferring completion of recording ${recording.id}: ${verification.reason}`);
        return res.status(503).json({ error: verification.reason, recordingId: recording.id, retryable: true });
      }

      if (verification.verified === false) {
        const { error: verifyFailErr } = await supabaseAdmin.from('meeting_recordings').update({
          status: RECORDING_STATUS.FAILED,
          error: verification.reason,
          ended_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
        }).eq('id', recording.id);

        if (verifyFailErr) return respondToRejectedTransition(res, recording.id, verifyFailErr, 'FAILED');

        tokenMetrics.recordRecordingFailed();
        return res.status(502).json({ error: 'Storage object verification failed.', recordingId: recording.id });
      }

      const playbackUrl = location
        || (process.env.RECORDING_PLAYBACK_BASE_URL && storageKey
            ? `${process.env.RECORDING_PLAYBACK_BASE_URL.replace(/\/$/, '')}/${storageKey}`
            : null);

      const { error: updateErr } = await supabaseAdmin.from('meeting_recordings').update({
        status: RECORDING_STATUS.COMPLETED,
        storage_key: storageKey,
        playback_url: playbackUrl,
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', recording.id);

      if (updateErr) return respondToRejectedTransition(res, recording.id, updateErr, 'COMPLETED');

      tokenMetrics.recordRecordingCompleted();
      return res.json({ ok: true, recordingId: recording.id, status: RECORDING_STATUS.COMPLETED });
    }

    if (isFailed) {
      const errorMsg = egressInfo.error || 'LiveKit egress reported failure.';
      const { error: updateErr } = await supabaseAdmin.from('meeting_recordings').update({
        status: RECORDING_STATUS.FAILED,
        error: errorMsg,
        ended_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      }).eq('id', recording.id);

      if (updateErr) return respondToRejectedTransition(res, recording.id, updateErr, 'FAILED');

      tokenMetrics.recordRecordingFailed();
      return res.json({ ok: true, recordingId: recording.id, status: RECORDING_STATUS.FAILED });
    }

    return res.json({ ok: true, recordingId: recording.id, status: recording.status });
  } catch (err) {
    console.error('LiveKit webhook verification error', err);
    return res.status(401).json({ error: 'Invalid webhook signature or payload.' });
  }
});

app.post('/api/recordings/reconcile', async (req, res) => {
  const authorization = req.headers.authorization || '';
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!authToken || !supabaseAdmin) return res.status(401).json({ error: 'Authentication is required.' });

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authToken);
    if (authError || !user) return res.status(401).json({ error: 'Session is invalid or expired.' });

    const meetingId = req.body?.meetingId;
    if (meetingId) {
      const { data: canManage, error: rpcErr } = await supabaseAdmin.rpc('can_manage_recordings_for_user', { p_meeting_id: meetingId, p_user_id: user.id });
      if (rpcErr || !canManage) return res.status(403).json({ error: 'Unauthorized to reconcile recordings for this meeting.' });
    } else {
      return res.status(403).json({ error: 'System reconciliation without meeting ID requires administrative privileges.' });
    }

    const cutoffIso = new Date(Date.now() - 2 * 60 * 1000).toISOString();
    let query = supabaseAdmin
      .from('meeting_recordings')
      .select('id, meeting_id, egress_id, status, storage_key')
      .in('status', [RECORDING_STATUS.STARTING, RECORDING_STATUS.ACTIVE, RECORDING_STATUS.STOPPING])
      .lte('updated_at', cutoffIso);

    if (meetingId) {
      query = query.eq('meeting_id', meetingId);
    }

    const { data: pendingRecordings, error: pendingErr } = await query.limit(20);
    if (pendingErr) {
      console.error('Pending recordings query error:', pendingErr);
      return res.status(500).json({ error: 'Failed to query pending recordings.' });
    }

    if (!pendingRecordings?.length) {
      return res.json({ ok: true, reconciledCount: 0 });
    }

    if (!process.env.LIVEKIT_HOST || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(503).json({ error: 'LiveKit egress server credentials are not configured.' });
    }

    const { EgressClient, EgressStatus } = await import('livekit-server-sdk');
    const egress = new EgressClient(process.env.LIVEKIT_HOST, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);

    let reconciledCount = 0;
    for (const rec of pendingRecordings) {
      if (!rec.egress_id) continue;
      try {
        const infoList = await egress.listEgress({ egressId: rec.egress_id });
        const info = infoList[0];
        if (!info) continue;

        if (info.status === EgressStatus.EGRESS_COMPLETE || info.status === 3) {
          const fileResult = info.fileResults?.[0];
          const storageKey = fileResult?.filename || rec.storage_key;
          const location = fileResult?.location || fileResult?.downloadUrl;
          const playbackUrl = location
            || (process.env.RECORDING_PLAYBACK_BASE_URL && storageKey
                ? `${process.env.RECORDING_PLAYBACK_BASE_URL.replace(/\/$/, '')}/${storageKey}`
                : null);

          await supabaseAdmin.from('meeting_recordings').update({
            status: RECORDING_STATUS.COMPLETED,
            storage_key: storageKey,
            playback_url: playbackUrl,
            ended_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', rec.id);
          reconciledCount += 1;
        } else if (info.status === EgressStatus.EGRESS_FAILED || info.status === EgressStatus.EGRESS_ABORTED) {
          await supabaseAdmin.from('meeting_recordings').update({
            status: RECORDING_STATUS.FAILED,
            error: info.error || 'Egress failed during reconciliation.',
            ended_at: new Date().toISOString(),
            updated_at: new Date().toISOString(),
          }).eq('id', rec.id);
          reconciledCount += 1;
        }
      } catch (e) {
        if (rec.status === RECORDING_STATUS.STOPPING) {
          await supabaseAdmin.from('meeting_recordings').update({
            status: RECORDING_STATUS.FAILED,
            error: 'Egress session expired or not found on LiveKit server.',
            updated_at: new Date().toISOString(),
          }).eq('id', rec.id);
          reconciledCount += 1;
        }
      }
    }

    return res.json({ ok: true, reconciledCount });
  } catch (error) {
    console.error('Reconciliation error', error);
    return res.status(500).json({ error: 'Reconciliation failed.' });
  }
});

async function requireSystemAdmin(req, res) {
  const authorization = req.headers.authorization || '';
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!authToken || !supabaseAdmin) {
    res.status(401).json({ error: 'Authentication is required.' });
    return null;
  }

  const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authToken);
  if (authError || !user) {
    res.status(401).json({ error: 'Session is invalid or expired.' });
    return null;
  }

  const { data: isSysAdmin, error: sysError } = await supabaseAdmin.rpc('is_system_admin_for_user', { p_user_id: user.id });
  if (sysError || !isSysAdmin) {
    res.status(403).json({ error: 'Unauthorized: System admin privileges required.' });
    return null;
  }

  return user;
}

// Public Feature Flags Endpoint for Frontend Component Consumption
app.get('/api/feature-flags', async (_req, res) => {
  if (!supabaseAdmin) return res.status(503).json({ error: 'Database service unavailable.' });
  try {
    const { data: flags, error } = await supabaseAdmin
      .from('feature_flags')
      .select('key, enabled, description')
      .eq('target_scope', 'global');

    if (error) {
      return res.status(500).json({ error: 'Failed to retrieve feature flags.' });
    }

    const flagMap = {};
    (flags ?? []).forEach((f) => {
      flagMap[f.key] = Boolean(f.enabled);
    });

    return res.json({ ok: true, flags: flagMap });
  } catch {
    return res.status(500).json({ error: 'Internal server error while fetching feature flags.' });
  }
});

// Authenticated Login Event Logging Endpoint
app.post('/api/auth/login-event', async (req, res) => {
  const authorization = req.headers.authorization || '';
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : '';
  if (!authToken || !supabaseAdmin) return res.status(401).json({ error: 'Authentication is required.' });

  try {
    const { data: { user }, error: authError } = await supabaseAdmin.auth.getUser(authToken);
    if (authError || !user) return res.status(401).json({ error: 'Session is invalid or expired.' });

    const eventType = String(req.body?.eventType || 'login_success');
    if (!['login_success', 'login_failed', 'logout', 'session_created', 'session_revoked'].includes(eventType)) {
      return res.status(400).json({ error: 'Invalid event type.' });
    }

    await recordLoginEvent({
      userId: user.id,
      email: user.email || '',
      eventType,
      req,
      metadata: req.body?.metadata || {},
    });

    return res.json({ ok: true, eventType });
  } catch {
    return res.status(500).json({ error: 'Failed to log login event.' });
  }
});

// SYSTEM ADMIN CONSOLE ENDPOINTS
app.get('/api/system-admin/overview', async (req, res) => {
  const user = await requireSystemAdmin(req, res);
  if (!user) return;

  try {
    const { data: metrics, error } = await supabaseAdmin.rpc('get_system_overview_metrics', { p_user_id: user.id });
    if (error) {
      console.error('Failed to query system overview metrics:', error);
      return res.status(500).json({ error: 'Failed to retrieve system overview metrics.' });
    }
    return res.json({ ok: true, metrics });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error while building overview metrics.' });
  }
});

app.get('/api/system-admin/users', async (req, res) => {
  const user = await requireSystemAdmin(req, res);
  if (!user) return;

  try {
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const search = String(req.query.search || '').trim();

    let query = supabaseAdmin
      .from('users')
      .select('id, email, full_name, avatar_url, status, created_at', { count: 'exact' });

    if (search) {
      query = query.or(`email.ilike.%${search}%,full_name.ilike.%${search}%`);
    }

    const { data: users, count, error } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (error) {
      console.error('Failed to query system users:', error);
      return res.status(500).json({ error: 'Failed to retrieve system users.' });
    }

    return res.json({ ok: true, users: users ?? [], count: count ?? 0, limit, offset });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error while fetching system users.' });
  }
});

app.post('/api/system-admin/users/suspend', async (req, res) => {
  const adminUser = await requireSystemAdmin(req, res);
  if (!adminUser) return;

  const targetUserId = String(req.body?.targetUserId || '');
  const suspend = Boolean(req.body?.suspend);
  const reason = String(req.body?.reason || 'System Admin administrative action');

  if (!/^[0-9a-f-]{36}$/i.test(targetUserId)) {
    return res.status(400).json({ error: 'Invalid target user ID.' });
  }

  try {
    const status = suspend ? 'suspended' : 'active';
    const { error: updateError } = await supabaseAdmin
      .from('users')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', targetUserId);

    if (updateError) {
      return res.status(500).json({ error: `Failed to update user status: ${updateError.message}` });
    }

    await supabaseAdmin.from('system_audit_logs').insert({
      admin_user_id: adminUser.id,
      action: suspend ? 'ADMIN_SUSPENDED_USER' : 'ADMIN_REACTIVATED_USER',
      target_type: 'user',
      target_id: targetUserId,
      reason,
      ip_address: req.ip,
    });

    return res.json({ ok: true, targetUserId, status });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error while updating user status.' });
  }
});

app.get('/api/system-admin/organizations', async (req, res) => {
  const user = await requireSystemAdmin(req, res);
  if (!user) return;

  try {
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);
    const search = String(req.query.search || '').trim();

    let query = supabaseAdmin
      .from('organizations')
      .select('id, name, slug, status, created_at, updated_at', { count: 'exact' });

    if (search) {
      query = query.or(`name.ilike.%${search}%,slug.ilike.%${search}%`);
    }

    const { data: orgs, count, error } = await query.order('created_at', { ascending: false }).range(offset, offset + limit - 1);
    if (error) {
      console.error('Failed to query system organizations:', error);
      return res.status(500).json({ error: 'Failed to retrieve system organizations.' });
    }

    return res.json({ ok: true, organizations: orgs ?? [], count: count ?? 0, limit, offset });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error while fetching system organizations.' });
  }
});

app.post('/api/system-admin/organizations/suspend', async (req, res) => {
  const adminUser = await requireSystemAdmin(req, res);
  if (!adminUser) return;

  const targetOrgId = String(req.body?.targetOrgId || '');
  const suspend = Boolean(req.body?.suspend);
  const reason = String(req.body?.reason || 'System Admin administrative action');

  if (!/^[0-9a-f-]{36}$/i.test(targetOrgId)) {
    return res.status(400).json({ error: 'Invalid target organization ID.' });
  }

  try {
    const status = suspend ? 'suspended' : 'active';
    const { error: updateError } = await supabaseAdmin
      .from('organizations')
      .update({ status, updated_at: new Date().toISOString() })
      .eq('id', targetOrgId);

    if (updateError) {
      return res.status(500).json({ error: `Failed to update organization status: ${updateError.message}` });
    }

    await supabaseAdmin.from('system_audit_logs').insert({
      admin_user_id: adminUser.id,
      action: suspend ? 'ADMIN_SUSPENDED_ORGANIZATION' : 'ADMIN_REACTIVATED_ORGANIZATION',
      target_type: 'organization',
      target_id: targetOrgId,
      organization_id: targetOrgId,
      reason,
      ip_address: req.ip,
    });

    return res.json({ ok: true, targetOrgId, status });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error while updating organization status.' });
  }
});

app.get('/api/system-admin/live-meetings', async (req, res) => {
  const user = await requireSystemAdmin(req, res);
  if (!user) return;

  try {
    const { data: liveMeetings, error } = await supabaseAdmin
      .from('meetings')
      .select('id, code, title, status, host_id, organization_id, workspace_id, created_at, updated_at')
      .eq('status', 'live')
      .order('updated_at', { ascending: false });

    if (error) {
      return res.status(500).json({ error: 'Failed to query live meetings.' });
    }

    return res.json({ ok: true, liveMeetings: liveMeetings ?? [] });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error while fetching live meetings.' });
  }
});

app.get('/api/system-admin/audit-logs', async (req, res) => {
  const user = await requireSystemAdmin(req, res);
  if (!user) return;

  try {
    const limit = Math.min(Number(req.query.limit || 50), 100);
    const offset = Math.max(Number(req.query.offset || 0), 0);

    const { data: auditLogs, count, error } = await supabaseAdmin
      .from('system_audit_logs')
      .select('id, admin_user_id, action, target_type, target_id, organization_id, reason, metadata, ip_address, created_at', { count: 'exact' })
      .order('created_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (error) {
      return res.status(500).json({ error: 'Failed to retrieve system audit logs.' });
    }

    return res.json({ ok: true, auditLogs: auditLogs ?? [], count: count ?? 0, limit, offset });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error while fetching audit logs.' });
  }
});

app.get('/api/system-admin/feature-flags', async (req, res) => {
  const user = await requireSystemAdmin(req, res);
  if (!user) return;

  try {
    const { data: flags, error } = await supabaseAdmin
      .from('feature_flags')
      .select('key, enabled, description, target_scope, target_id, metadata, updated_at')
      .order('key', { ascending: true });

    if (error) {
      return res.status(500).json({ error: 'Failed to retrieve feature flags.' });
    }

    return res.json({ ok: true, flags: flags ?? [] });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error while fetching feature flags.' });
  }
});

app.post('/api/system-admin/feature-flags', async (req, res) => {
  const adminUser = await requireSystemAdmin(req, res);
  if (!adminUser) return;

  const key = String(req.body?.key || '').trim().toUpperCase();
  const enabled = Boolean(req.body?.enabled);
  const reason = String(req.body?.reason || 'Feature flag updated by System Admin');

  if (!key) {
    return res.status(400).json({ error: 'Feature flag key is required.' });
  }

  try {
    const { error: updateError } = await supabaseAdmin
      .from('feature_flags')
      .update({ enabled, updated_by: adminUser.id, updated_at: new Date().toISOString() })
      .eq('key', key);

    if (updateError) {
      return res.status(500).json({ error: `Failed to update feature flag: ${updateError.message}` });
    }

    await supabaseAdmin.from('system_audit_logs').insert({
      admin_user_id: adminUser.id,
      action: 'ADMIN_CHANGED_FEATURE_FLAG',
      target_type: 'feature_flag',
      target_id: key,
      reason,
      metadata: { enabled },
      ip_address: req.ip,
    });

    return res.json({ ok: true, key, enabled });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error while updating feature flag.' });
  }
});

app.get('/api/system-admin/health', async (req, res) => {
  const user = await requireSystemAdmin(req, res);
  if (!user) return;

  try {
    // 1. PostgreSQL DB Query Reachability Test
    let dbStatus = 'UNREACHABLE';
    let dbNote = 'PostgreSQL query failed';
    if (supabaseAdmin) {
      const { error: dbErr } = await supabaseAdmin.from('users').select('id').limit(1);
      if (!dbErr) {
        dbStatus = 'HEALTHY';
        dbNote = 'PostgreSQL database query succeeded';
      }
    }

    // 2. Redis Reachability Test
    let redisStatus = process.env.REDIS_URL ? 'UNREACHABLE' : 'NOT_CONFIGURED';
    let redisNote = process.env.REDIS_URL ? 'Redis ping failed' : 'In-memory rate limit fallback active';
    if (redis) {
      try {
        const pingRes = await redis.ping();
        if (pingRes === 'PONG') {
          redisStatus = 'HEALTHY';
          redisNote = 'Redis connected and responding to PING';
        }
      } catch {
        redisStatus = 'UNREACHABLE';
      }
    }

    // 3. LiveKit Reachability Test
    let livekitStatus = 'NOT_CONFIGURED';
    let livekitNote = 'LiveKit credentials missing';
    if (process.env.LIVEKIT_HOST && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET) {
      try {
        const lkRes = await fetch(`${process.env.LIVEKIT_HOST.replace(/\/$/, '')}`, { method: 'HEAD' });
        if ([200, 404, 405].includes(lkRes.status)) {
          livekitStatus = 'HEALTHY';
          livekitNote = 'LiveKit SFU server responding to HTTP health probe';
        } else {
          livekitStatus = 'DEGRADED';
          livekitNote = `LiveKit server returned status ${lkRes.status}`;
        }
      } catch {
        livekitStatus = 'UNREACHABLE';
        livekitNote = 'LiveKit SFU host unreachable';
      }
    }

    // 4. Object Storage Reachability Status
    const storageConfigured = Boolean(process.env.RECORDING_STORAGE_BUCKET && process.env.RECORDING_STORAGE_ACCESS_KEY);
    const storageStatus = storageConfigured ? 'HEALTHY' : 'NOT_CONFIGURED';
    const storageNote = storageConfigured ? 'S3/R2 storage credentials configured' : 'S3/R2 storage credentials unconfigured (PROVIDER REQUIRED)';

    return res.json({
      ok: true,
      services: {
        api: { status: 'HEALTHY', note: 'Token & System Admin API online' },
        database: { status: dbStatus, note: dbNote },
        redis: { status: redisStatus, note: redisNote },
        livekit: { status: livekitStatus, note: livekitNote },
        storage: { status: storageStatus, note: storageNote },
      },
    });
  } catch (err) {
    return res.status(500).json({ error: 'Internal server error while compiling system health.' });
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
export { app };

let backgroundTimer = null;
export function startBackgroundJobs() {
  if (backgroundTimer) return;
  backgroundTimer = setInterval(() => {
    void dispatchDueNotificationJobs();
    void processQueuedProviderJobs();
  }, 60_000);
  if (backgroundTimer.unref) backgroundTimer.unref();
}

if (process.env.NODE_ENV !== 'test' && !process.env.NO_SERVER_LISTEN) {
  app.listen(port, () => {
    logEvent('info', 'server.listen', { port });
    console.log(`LiveKit token endpoint listening on http://localhost:${port}`);
    startBackgroundJobs();
  });
}
