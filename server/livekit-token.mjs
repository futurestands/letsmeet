import express from 'express';
import dotenv from 'dotenv';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';
import { evaluateLiveKitAccess, evaluateModerationAccess, isAllowedRoomCode, normalizeRoomCode } from './livekit-auth.mjs';
import { dispatchNotificationJob, notificationStatusPayload } from './notifications.mjs';
import { createRecordingStorageAdapter, describeRecordingDispatch, recordingStatusPayload, aiProviderConfigured, transcriptionProviderConfigured } from './recordings.mjs';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((item) => item.trim()).filter(Boolean);

const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const livekitHost = process.env.LIVEKIT_HOST;
const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

app.use(express.json({ limit: '32kb' }));

const rateBuckets = new Map();
function allowRequest(key, limit, windowMs) {
  const now = Date.now();
  const next = (rateBuckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
  if (next.length >= limit) {
    rateBuckets.set(key, next);
    return false;
  }
  next.push(now);
  rateBuckets.set(key, next);
  return true;
}

app.get('/health', (_req, res) => {
  res.json({ status: 'ok' });
});

app.get('/ready', (_req, res) => {
  const ready = Boolean(supabaseAdmin && process.env.LIVEKIT_API_KEY && process.env.LIVEKIT_API_SECRET);
  res.status(ready ? 200 : 503).json({ status: ready ? 'ready' : 'not_ready' });
});

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

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
    transcriptionConfigured: transcriptionProviderConfigured(),
    aiConfigured: aiProviderConfigured(),
  });
});

app.get('/api/livekit/token', async (req, res) => {
  const clientKey = `${req.ip}:${req.headers.authorization || 'anon'}`;
  if (!allowRequest(`token:${clientKey}`, 30, 60_000)) {
    return res.status(429).json({ error: 'Too many token requests. Try again shortly.' });
  }

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
    return res.status(401).json({ error: 'Authentication is required to join a meeting.' });
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

    if (meetingError) {
      return res.status(500).json({ error: 'Unable to resolve the meeting.' });
    }

    const { data: participant } = meeting
      ? await supabaseAdmin
          .from('meeting_participants')
          .select('id, meeting_id, user_id, organization_id, workspace_id, role, status')
          .eq('meeting_id', meeting.id)
          .eq('user_id', user.id)
          .maybeSingle()
      : { data: null };

    const { data: membership } = meeting
      ? await supabaseAdmin
          .from('organization_members')
          .select('id, status')
          .eq('organization_id', meeting.organization_id)
          .eq('user_id', user.id)
          .eq('status', 'active')
          .maybeSingle()
      : { data: null };

    const { data: workspace } = meeting
      ? await supabaseAdmin
          .from('workspaces')
          .select('id, organization_id')
          .eq('id', meeting.workspace_id)
          .maybeSingle()
      : { data: null };

    const decision = evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: user.id,
      userName: user.user_metadata?.full_name ?? user.email ?? 'Meeting Participant',
      requestedRoom: room,
      meeting,
      participant,
      organizationMember: Boolean(membership),
      workspaceMember: Boolean(workspace && workspace.organization_id === meeting.organization_id && membership),
      requestedIdentity: req.query.identity,
      requestedName: req.query.name,
      requestedRole: req.query.role,
      requestedOrganizationId: req.query.organization_id,
      requestedWorkspaceId: req.query.workspace_id,
    });

    if (!decision.ok) {
      return res.status(decision.status).json({ error: decision.error });
    }

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
    return res.json({ token, room: decision.room, identity: decision.identity, name: decision.name });
  } catch (error) {
    console.error('Failed to issue LiveKit token', error);
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
    if (!decision.ok) return res.status(decision.status).json({ error: decision.error });

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

    return res.json({ ok: true, action, targetIdentity });
  } catch (error) {
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
    if (recording.started_by !== user.id) return res.status(403).json({ error: 'Only the host can start this recording.' });

    const { data: meeting } = await supabaseAdmin
      .from('meetings')
      .select('id, code, host_id, status')
      .eq('id', recording.meeting_id)
      .maybeSingle();
    if (!meeting || meeting.host_id !== user.id) return res.status(403).json({ error: 'Only the host can start this recording.' });

    const dispatch = describeRecordingDispatch(recording);
    const storage = createRecordingStorageAdapter();
    if (!storage || !process.env.LIVEKIT_HOST || !process.env.LIVEKIT_API_KEY || !process.env.LIVEKIT_API_SECRET) {
      return res.status(503).json({
        ok: false,
        recordingId,
        status: recording.status,
        error: dispatch.reason,
      });
    }

    const { EgressClient } = await import('livekit-server-sdk');
    const egress = new EgressClient(process.env.LIVEKIT_HOST, process.env.LIVEKIT_API_KEY, process.env.LIVEKIT_API_SECRET);
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
      status: 'active',
      egress_id: String(info?.egressId ?? info?.egress_id ?? ''),
      storage_provider: storage.provider,
      storage_key: storage.objectKeyFor(recording),
      started_at: new Date().toISOString(),
    }).eq('id', recording.id);

    return res.json({ ok: true, recordingId, status: 'active' });
  } catch (error) {
    console.error('Failed to start recording egress', error);
    await supabaseAdmin?.from('meeting_recordings').update({
      status: 'failed',
      error: 'LiveKit egress could not be started.',
    }).eq('id', req.body?.recordingId);
    return res.status(502).json({ error: 'LiveKit egress could not be started.' });
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
      async deliverInApp(current) {
        const { data: user } = await supabaseAdmin
          .from('users')
          .select('id')
          .eq('email', current.recipient)
          .maybeSingle();
        if (!user) {
          await supabaseAdmin.rpc('release_notification_job', { p_job_id: current.id });
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
        await supabaseAdmin.rpc('complete_notification_job', {
          p_job_id: current.id,
          p_provider: 'in_app',
          p_provider_message_id: null,
        });
        return { delivered: true, skipped: false };
      },
    });

    if (result.delivered) continue;
    if (result.skipped) {
      // Leave email/SMS pending without claiming delivery. Release processing lock.
      await supabaseAdmin.rpc('release_notification_job', { p_job_id: job.id });
      continue;
    }

    const attempts = (job.attempt_count ?? 0) + 1;
    const maxAttempts = job.max_attempts ?? 5;
    await supabaseAdmin.from('meeting_notification_jobs').update({
      attempt_count: attempts,
      last_error: String(result.reason ?? 'Delivery failed').slice(0, 500),
      status: attempts >= maxAttempts ? 'failed' : 'pending',
      next_attempt_at: attempts >= maxAttempts
        ? null
        : new Date(Date.now() + (2 ** Math.max(attempts - 1, 0)) * 60_000).toISOString(),
    }).eq('id', job.id);
  }
}

app.listen(port, () => {
  console.log(`LiveKit token endpoint listening on http://localhost:${port}`);
  setInterval(() => {
    void dispatchDueNotificationJobs();
  }, 60_000);
});
