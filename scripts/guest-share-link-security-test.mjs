/**
 * Guest share-link security matrix against staging Supabase + Render guest API.
 * Does not print secrets. Load via: node --env-file=.env.staging.local scripts/guest-share-link-security-test.mjs
 */
import { createClient } from '@supabase/supabase-js';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

const supabaseUrl = required('SUPABASE_URL');
const serviceKey = required('SUPABASE_SERVICE_ROLE_KEY');
const anonKey = required('VITE_SUPABASE_ANON_KEY');
const tokenEndpoint = required('VITE_LIVEKIT_TOKEN_ENDPOINT');
const hostEmail = required('STAGING_TEST_HOST_EMAIL');
const hostPassword = required('STAGING_TEST_HOST_PASSWORD');
const guestBase = tokenEndpoint.replace(/\/api\/livekit\/token\/?$/, '');
const origin = process.env.ALLOWED_ORIGINS?.split(',')[0]?.trim()
  || 'https://letsmeet-git-phase-1-saas-foundation-futurestands-projects.vercel.app';

const admin = createClient(supabaseUrl, serviceKey, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const results = [];

function record(name, ok, detail = '') {
  results.push({ name, ok, detail });
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${detail ? ` — ${detail}` : ''}`);
}

async function membershipCounts(userId) {
  const { count: orgCount } = await admin
    .from('organization_members')
    .select('*', { count: 'exact', head: true })
    .eq('user_id', userId);
  // Workspace access is derived from organization_members (no separate workspace_members table).
  return { orgCount: orgCount ?? 0 };
}

async function hostClient() {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({
    email: hostEmail,
    password: hostPassword,
  });
  if (error || !data.session) throw new Error(`Host sign-in failed: ${error?.message ?? 'no session'}`);
  return { client, session: data.session, userId: data.user.id };
}

async function createHostMeeting(host, title) {
  const { data, error } = await host.client.rpc('create_persistent_meeting', {
    p_title: title,
    p_workspace_id: null,
  });
  if (error) throw new Error(`create_persistent_meeting: ${error.message}`);
  const meeting = Array.isArray(data) ? data[0] : data;
  if (!meeting?.code || !meeting?.id) throw new Error('Meeting payload incomplete');
  return meeting;
}

async function guestPreview(room) {
  const response = await fetch(`${guestBase}/api/guest/meeting-preview?room=${encodeURIComponent(room)}`, {
    headers: { Origin: origin },
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function guestSession(room, displayName) {
  const response = await fetch(`${guestBase}/api/guest/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Origin: origin,
    },
    body: JSON.stringify({ room, displayName }),
  });
  const body = await response.json().catch(() => ({}));
  return { response, body };
}

async function authedGuestClient(accessToken, refreshToken) {
  const client = createClient(supabaseUrl, anonKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { error } = await client.auth.setSession({
    access_token: accessToken,
    refresh_token: refreshToken,
  });
  if (error) throw new Error(`guest setSession failed: ${error.message}`);
  return client;
}

async function main() {
  console.log('Guest share-link security matrix (staging)\n');

  {
    const { response, body } = await guestPreview('NOT-A-CODE');
    record('A.preview_rejects_invalid_code', response.status === 400, `status=${response.status}`);
    record('A.preview_no_secret_leak', !/service_role|LIVEKIT_API_SECRET|postgres:/i.test(JSON.stringify(body)));
  }

  const host = await hostClient();
  const meeting = await createHostMeeting(host, `Guest security ${Date.now()}`);

  {
    const { response, body } = await guestPreview(meeting.code);
    record('B.preview_joinable', response.ok && body.code === meeting.code, `status=${response.status}`);
  }

  const session = await guestSession(meeting.code, 'Staging Guest');
  const guestUserId = session.body.user?.id ?? null;
  const guestAccessToken = session.body.access_token ?? null;
  const guestRefreshToken = session.body.refresh_token ?? null;
  record(
    'C.guest_session_created',
    session.response.ok && Boolean(guestAccessToken) && session.body.user?.guest === true,
    `status=${session.response.status}`,
  );

  if (guestUserId) {
    const counts = await membershipCounts(guestUserId);
    record('C.no_org_membership', counts.orgCount === 0, `org_count=${counts.orgCount}`);
    record('C.no_workspace_membership', counts.orgCount === 0, 'workspace access is org-derived');
  } else {
    record('C.no_org_membership', false, 'no guest user id');
    record('C.no_workspace_membership', false, 'no guest user id');
  }

  let guestClient = null;
  if (guestAccessToken && guestRefreshToken) {
    guestClient = await authedGuestClient(guestAccessToken, guestRefreshToken);
    const { data: joined, error: joinError } = await guestClient.rpc('join_meeting_by_share_link', {
      p_code: meeting.code,
      p_display_name: 'Staging Guest',
    });
    const row = Array.isArray(joined) ? joined[0] : joined;
    record(
      'D.share_link_join_participant_role',
      !joinError && row?.participant_role === 'participant',
      joinError?.message ?? String(row?.participant_role ?? 'missing'),
    );
    const counts = await membershipCounts(guestUserId);
    record('D.still_no_org_membership_after_join', counts.orgCount === 0, `org_count=${counts.orgCount}`);
  }

  if (guestClient && guestUserId) {
    await guestClient.rpc('ensure_user_profile_context', {
      p_user_id: guestUserId,
      p_email: `guest-${guestUserId}@guest.letsmeet.invalid`,
      p_full_name: 'Evil Guest',
    });
    const counts = await membershipCounts(guestUserId);
    record('E.guest_cannot_gain_org_via_profile_rpc', counts.orgCount === 0, `org_count=${counts.orgCount}`);
  }

  if (guestAccessToken && meeting.code) {
    const tokenRes = await fetch(`${tokenEndpoint}?room=${encodeURIComponent(meeting.code)}`, {
      headers: {
        Authorization: `Bearer ${guestAccessToken}`,
        Origin: origin,
      },
    });
    const tokenBody = await tokenRes.json().catch(() => ({}));
    record('F.livekit_token_for_guest', tokenRes.ok && Boolean(tokenBody.token), `status=${tokenRes.status}`);

    const other = await createHostMeeting(host, `Guest isolation ${Date.now()}`);
    const otherTok = await fetch(`${tokenEndpoint}?room=${encodeURIComponent(other.code)}`, {
      headers: {
        Authorization: `Bearer ${guestAccessToken}`,
        Origin: origin,
      },
    });
    record('F.cannot_token_other_meeting', otherTok.status === 403 || otherTok.status === 404, `status=${otherTok.status}`);

    await admin.from('meetings').update({ status: 'ended' }).eq('id', other.id);
    const endedPreview = await guestPreview(other.code);
    record('G.ended_meeting_preview_denied', endedPreview.response.status === 403, `status=${endedPreview.response.status}`);

    await admin.from('meetings').update({ status: 'cancelled' }).eq('id', meeting.id);
    const cancelledPreview = await guestPreview(meeting.code);
    record('H.cancelled_meeting_preview_denied', cancelledPreview.response.status === 403, `status=${cancelledPreview.response.status}`);
  }

  {
    const response = await fetch(`${guestBase}/api/guest/session`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: origin },
      body: JSON.stringify({ room: meeting.code, displayName: ' ' }),
    });
    record('I.missing_display_name_rejected', response.status === 400, `status=${response.status}`);
  }

  {
    const liveMeeting = await createHostMeeting(host, `Guest remove ${Date.now()}`);
    const gs = await guestSession(liveMeeting.code, 'Staging Guest Remove');
    if (!gs.response.ok) {
      record('J.removed_guest_token_denied', false, `guest session status=${gs.response.status}`);
      record('K.guest_cannot_moderate_host', false, `guest session status=${gs.response.status}`);
    } else {
      const gClient = await authedGuestClient(gs.body.access_token, gs.body.refresh_token);
      await gClient.rpc('join_meeting_by_share_link', {
        p_code: liveMeeting.code,
        p_display_name: 'Staging Guest Remove',
      });
      const guestId = gs.body.user.id;

      const modRes = await fetch(`${guestBase}/api/livekit/moderate`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${gs.body.access_token}`,
          'Content-Type': 'application/json',
          Origin: origin,
        },
        body: JSON.stringify({
          room: liveMeeting.code,
          targetIdentity: host.userId,
          action: 'remove',
        }),
      });
      record('K.guest_cannot_moderate_host', modRes.status === 403 || modRes.status === 401, `status=${modRes.status}`);

      await admin
        .from('meeting_participants')
        .update({ status: 'removed' })
        .eq('meeting_id', liveMeeting.id)
        .eq('user_id', guestId);

      const removedTok = await fetch(`${tokenEndpoint}?room=${encodeURIComponent(liveMeeting.code)}`, {
        headers: {
          Authorization: `Bearer ${gs.body.access_token}`,
          Origin: origin,
        },
      });
      record('J.removed_guest_token_denied', removedTok.status === 403, `status=${removedTok.status}`);
    }
  }

  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} passed`);
  if (failed.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error('FATAL', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
