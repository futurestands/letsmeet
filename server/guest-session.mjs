import { createClient } from '@supabase/supabase-js';
import { isAllowedRoomCode, normalizeRoomCode } from './livekit-auth.mjs';
import { createRateLimiter } from './rate-limit.mjs';

const guestSessionLimiter = createRateLimiter();

function sanitizeDisplayName(value) {
  const name = String(value ?? '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name.length < 2) return null;
  return name;
}

export function createGuestSessionHandlers({ supabaseAdmin, supabaseUrl, authKey, logEvent }) {
  async function previewMeeting(req, res) {
    const room = normalizeRoomCode(req.query.room);
    if (!isAllowedRoomCode(room) || !supabaseAdmin) {
      return res.status(400).json({ error: 'Meeting code is invalid.' });
    }

    const decision = guestSessionLimiter.evaluateTokenRequest({
      ip: req.ip,
      authenticated: false,
    });
    if (!decision.ok) {
      return res.status(429).json({ error: 'Too many requests. Try again shortly.' });
    }

    const { data: meeting, error } = await supabaseAdmin
      .from('meetings')
      .select('code, title, status')
      .eq('code', room)
      .maybeSingle();

    if (error) {
      logEvent?.('error', 'guest.preview_failed', { requestId: req.requestId, room });
      return res.status(500).json({ error: 'Unable to look up this meeting.' });
    }
    if (!meeting) {
      return res.status(404).json({ error: 'Meeting not found.' });
    }
    if (['ended', 'cancelled'].includes(String(meeting.status))) {
      return res.status(403).json({
        error: meeting.status === 'cancelled'
          ? 'This meeting was cancelled and cannot be joined.'
          : 'This meeting has ended and cannot be rejoined.',
        status: meeting.status,
      });
    }
    if (!['scheduled', 'waiting', 'live'].includes(String(meeting.status))) {
      return res.status(403).json({ error: 'This meeting is not available.', status: meeting.status });
    }

    return res.json({
      code: meeting.code,
      title: meeting.title,
      status: meeting.status,
    });
  }

  async function createGuestSession(req, res) {
    const started = Date.now();
    const room = normalizeRoomCode(req.body?.room ?? req.body?.code);
    const displayName = sanitizeDisplayName(req.body?.displayName);

    // authKey may be the anon/publishable key or the service-role key (server-only).
    // Service role is already required for createUser; using it as apikey avoids a second Render secret.
    if (!supabaseAdmin || !supabaseUrl || !authKey) {
      return res.status(503).json({ error: 'Guest join is not configured.' });
    }
    if (!isAllowedRoomCode(room)) {
      return res.status(400).json({ error: 'Meeting code is invalid.' });
    }
    if (!displayName) {
      return res.status(400).json({ error: 'Enter a display name to join as a guest.' });
    }

    const decision = guestSessionLimiter.evaluateTokenRequest({
      ip: req.ip,
      authenticated: false,
    });
    if (!decision.ok) {
      return res.status(429).json({ error: 'Too many guest join attempts. Try again shortly.' });
    }

    try {
      const { data: meeting, error: meetingError } = await supabaseAdmin
        .from('meetings')
        .select('id, code, title, status, host_id, organization_id, workspace_id')
        .eq('code', room)
        .maybeSingle();

      if (meetingError) {
        return res.status(500).json({ error: 'Unable to resolve the meeting.' });
      }
      if (!meeting) {
        return res.status(404).json({ error: 'Meeting not found.' });
      }
      if (['ended', 'cancelled'].includes(String(meeting.status))) {
        return res.status(403).json({
          error: meeting.status === 'cancelled'
            ? 'This meeting was cancelled and cannot be joined.'
            : 'This meeting has ended and cannot be rejoined.',
        });
      }
      if (!['scheduled', 'waiting', 'live'].includes(String(meeting.status))) {
        return res.status(403).json({ error: 'This meeting is not available.' });
      }

      const guestId = crypto.randomUUID();
      const email = `guest-${guestId}@guest.letsmeet.invalid`;
      const password = `${crypto.randomUUID()}${crypto.randomUUID()}`.replace(/-/g, '');

      const { data: created, error: createError } = await supabaseAdmin.auth.admin.createUser({
        email,
        password,
        email_confirm: true,
        user_metadata: {
          full_name: displayName,
          guest: true,
          guest_meeting_code: meeting.code,
        },
      });

      if (createError || !created?.user) {
        logEvent?.('error', 'guest.create_user_failed', {
          requestId: req.requestId,
          room,
          message: createError?.message ?? 'unknown',
        });
        return res.status(502).json({ error: 'Unable to start a guest session.' });
      }

      await supabaseAdmin.from('users').upsert({
        id: created.user.id,
        email,
        full_name: displayName,
      }, { onConflict: 'id' });

      const userClient = createClient(supabaseUrl, authKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { data: signedIn, error: signInError } = await userClient.auth.signInWithPassword({
        email,
        password,
      });

      if (signInError || !signedIn?.session) {
        logEvent?.('error', 'guest.sign_in_failed', {
          requestId: req.requestId,
          room,
          userId: created.user.id,
        });
        return res.status(502).json({ error: 'Unable to start a guest session.' });
      }

      // Defense in depth: never leave accidental owner membership for guest users.
      await supabaseAdmin
        .from('organization_members')
        .delete()
        .eq('user_id', created.user.id);

      logEvent?.('info', 'guest.session_created', {
        requestId: req.requestId,
        room,
        userId: created.user.id,
        durationMs: Date.now() - started,
      });

      return res.json({
        access_token: signedIn.session.access_token,
        refresh_token: signedIn.session.refresh_token,
        expires_in: signedIn.session.expires_in,
        user: {
          id: created.user.id,
          displayName,
          guest: true,
        },
        meeting: {
          code: meeting.code,
          title: meeting.title,
          status: meeting.status,
        },
      });
    } catch (error) {
      logEvent?.('error', 'guest.session_exception', {
        requestId: req.requestId,
        room,
        message: error instanceof Error ? error.message : 'unknown',
      });
      return res.status(500).json({ error: 'Unable to start a guest session.' });
    }
  }

  return { previewMeeting, createGuestSession };
}
