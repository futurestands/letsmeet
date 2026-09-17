import express from 'express';
import dotenv from 'dotenv';
import { AccessToken } from 'livekit-server-sdk';
import { createClient } from '@supabase/supabase-js';

dotenv.config();

const app = express();
const port = Number(process.env.PORT || 3001);
const allowedOrigins = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:5173,http://127.0.0.1:5173').split(',').map((item) => item.trim()).filter(Boolean);

const supabaseUrl = process.env.VITE_SUPABASE_URL ?? process.env.SUPABASE_URL;
const supabaseServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.VITE_SUPABASE_SERVICE_ROLE_KEY;
const supabaseAdmin = supabaseUrl && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const normalizeRoomCode = (value) => String(value ?? '').trim().toUpperCase();
const isAllowedRoomCode = (value) => /^LM-[A-Z0-9]{6}$/.test(value);

app.use(express.json());

app.use((req, res, next) => {
  const origin = req.headers.origin;
  const allowOrigin = origin && allowedOrigins.includes(origin) ? origin : allowedOrigins[0];

  if (origin && !allowedOrigins.includes(origin)) {
    return res.status(403).json({ error: 'Origin not allowed.' });
  }

  res.header('Access-Control-Allow-Origin', allowOrigin);
  res.header('Access-Control-Allow-Methods', 'GET,OPTIONS');
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
  const authorization = req.headers.authorization || String(req.query.token || '');
  const authToken = authorization.startsWith('Bearer ') ? authorization.slice(7) : authorization;

  if (!apiKey || !apiSecret) {
    return res.status(500).json({
      error: 'LIVEKIT_API_KEY and LIVEKIT_API_SECRET must be configured.',
    });
  }

  if (!authToken || !supabaseAdmin || !supabaseUrl) {
    return res.status(401).json({ error: 'Authentication is required to join a meeting.' });
  }

  if (!isAllowedRoomCode(room)) {
    return res.status(400).json({ error: 'Meeting code is invalid or not recognized.' });
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

    if (meetingError || !meeting) {
      return res.status(404).json({ error: 'Meeting not found.' });
    }

    const status = String(meeting.status ?? 'live');
    if (['cancelled', 'ended'].includes(status)) {
      return res.status(403).json({ error: 'This meeting is no longer active.' });
    }

    const isHost = meeting.host_id === user.id;
    const { data: memberRow, error: memberError } = await supabaseAdmin
      .from('meeting_participants')
      .select('id, meeting_id, user_id')
      .eq('meeting_id', meeting.id)
      .eq('user_id', user.id)
      .maybeSingle();

    if (memberError && memberError.code !== 'PGRST116') {
      return res.status(500).json({ error: 'Unable to validate meeting membership.' });
    }

    if (!isHost && !memberRow) {
      return res.status(403).json({ error: 'You do not have access to this meeting.' });
    }

    const identity = String(user.id);
    const name = String(user.user_metadata?.full_name ?? user.email ?? 'Meeting Participant');
    const at = new AccessToken(apiKey, apiSecret, {
      identity,
      name,
      ttl: 60 * 5,
    });

    at.addGrant({
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    return res.json({ token, room, identity, name });
  } catch (error) {
    console.error('Failed to issue LiveKit token', error);
    return res.status(500).json({ error: 'Unable to issue a LiveKit token.' });
  }
});

app.listen(port, () => {
  console.log(`LiveKit token endpoint listening on http://localhost:${port}`);
});
