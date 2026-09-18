import express from 'express';
import dotenv from 'dotenv';
import { AccessToken, RoomServiceClient, TrackSource } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';
import { evaluateLiveKitAccess, evaluateModerationAccess, isAllowedRoomCode, normalizeRoomCode } from './livekit-auth.mjs';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((item) => item.trim()).filter(Boolean);

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const livekitHost = process.env.LIVEKIT_HOST
  ?? process.env.VITE_LIVEKIT_URL?.replace(/^wss:/, 'https:').replace(/^ws:/, 'http:');
const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

app.use(express.json());

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

app.get('/api/livekit/token', async (req, res) => {
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
      ttl: 60 * 5,
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

app.listen(port, () => {
  console.log(`LiveKit token endpoint listening on http://localhost:${port}`);
});
