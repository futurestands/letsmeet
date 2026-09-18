/**
 * Dual-identity LiveKit staging harness (Node-safe).
 * Verifies meeting create/join, token minting for host+participant,
 * host remove moderation persistence, and post-remove token denial.
 *
 * Does NOT open WebRTC in Node (livekit-client requires a browser).
 * Media publish / active-speaker still require two real browser profiles.
 */
import { createClient } from '@supabase/supabase-js';

const required = [
  'VITE_SUPABASE_URL',
  'VITE_SUPABASE_ANON_KEY',
  'VITE_LIVEKIT_TOKEN_ENDPOINT',
  'STAGING_TEST_HOST_EMAIL',
  'STAGING_TEST_HOST_PASSWORD',
  'STAGING_TEST_PARTICIPANT_EMAIL',
  'STAGING_TEST_PARTICIPANT_PASSWORD',
];

for (const key of required) {
  if (!process.env[key]) {
    console.error(`Missing ${key}`);
    process.exit(1);
  }
}

const results = [];
function pass(name, detail = '') {
  results.push({ name, ok: true, detail });
  console.log(`PASS ${name}${detail ? ` — ${detail}` : ''}`);
}
function fail(name, detail = '') {
  results.push({ name, ok: false, detail });
  console.error(`FAIL ${name}${detail ? ` — ${detail}` : ''}`);
}

async function signIn(email, password) {
  const client = createClient(process.env.VITE_SUPABASE_URL, process.env.VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.session) throw new Error(error?.message || 'sign-in failed');
  return { client, session: data.session, user: data.user };
}

async function fetchToken(accessToken, room) {
  const endpoint = process.env.VITE_LIVEKIT_TOKEN_ENDPOINT;
  const url = `${endpoint}${endpoint.includes('?') ? '&' : '?'}room=${encodeURIComponent(room)}`;
  const response = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
  });
  const body = await response.json().catch(() => ({}));
  return { status: response.status, body };
}

function moderateUrl() {
  return process.env.VITE_LIVEKIT_TOKEN_ENDPOINT.replace(/\/api\/livekit\/token.*/, '/api/livekit/moderate');
}

const host = await signIn(process.env.STAGING_TEST_HOST_EMAIL, process.env.STAGING_TEST_HOST_PASSWORD);
pass('host authenticated');

const { data: meeting, error: createError } = await host.client.rpc('create_persistent_meeting', {
  p_title: `Dual LiveKit E2E ${Date.now()}`,
  p_workspace_id: null,
});
if (createError || !meeting?.id || !meeting?.code) {
  fail('create meeting', createError?.message || 'no meeting payload');
  process.exit(1);
}
pass('host created meeting', meeting.code);

const { error: startError } = await host.client.rpc('transition_persistent_meeting', {
  p_meeting_id: meeting.id,
  p_status: 'live',
});
if (startError) {
  fail('start meeting', startError.message);
  process.exit(1);
}
pass('host started meeting');

const participant = await signIn(
  process.env.STAGING_TEST_PARTICIPANT_EMAIL,
  process.env.STAGING_TEST_PARTICIPANT_PASSWORD,
);
pass('participant authenticated');

const { error: joinError } = await participant.client.rpc('join_persistent_meeting', {
  p_code: meeting.code,
});
if (joinError) {
  fail('participant join rpc', joinError.message);
  process.exit(1);
}
pass('participant joined meeting row');

const hostToken = await fetchToken(host.session.access_token, meeting.code);
const participantToken = await fetchToken(participant.session.access_token, meeting.code);
if (hostToken.status !== 200 || !hostToken.body.token) {
  fail('host token', `status=${hostToken.status}`);
} else {
  pass('host token issued');
}
if (participantToken.status !== 200 || !participantToken.body.token) {
  fail('participant token', `status=${participantToken.status}`);
} else {
  pass('participant token issued');
}

const removeResponse = await fetch(moderateUrl(), {
  method: 'POST',
  headers: {
    Authorization: `Bearer ${host.session.access_token}`,
    'Content-Type': 'application/json',
  },
  body: JSON.stringify({
    room: meeting.code,
    targetIdentity: participant.user.id,
    action: 'remove',
  }),
});
const removeBody = await removeResponse.json().catch(() => ({}));

const { data: participantRow } = await host.client
  .from('meeting_participants')
  .select('status')
  .eq('meeting_id', meeting.id)
  .eq('user_id', participant.user.id)
  .maybeSingle();

if (removeResponse.status === 200 && removeBody.ok) {
  pass('host remove moderation accepted');
} else if (participantRow?.status === 'removed') {
  pass('participant marked removed despite LiveKit room miss', `api=${removeResponse.status}`);
} else {
  // Without an active LiveKit SFU presence, RoomService remove can 502.
  // Persist removal through transition is not available to clients; record as known gap.
  fail(
    'host remove moderation',
    `status=${removeResponse.status} body=${removeBody.error || 'n/a'} db=${participantRow?.status || 'n/a'}`,
  );
}

const denied = await fetchToken(participant.session.access_token, meeting.code);
if (participantRow?.status === 'removed' || denied.status >= 400) {
  if (denied.status >= 400) pass('removed/denied participant cannot mint token', `status=${denied.status}`);
  else fail('removed participant cannot mint token', `status=${denied.status}`);
} else {
  pass('token still available because remove did not persist (see prior fail)');
}

const { error: endError } = await host.client.rpc('transition_persistent_meeting', {
  p_meeting_id: meeting.id,
  p_status: 'ended',
});
if (endError) fail('end meeting', endError.message);
else pass('host ended meeting');

console.log('NOTE: WebRTC dual-connect requires two browser profiles; Node livekit-client is unsupported.');
const failed = results.filter((row) => !row.ok).length;
console.log(`\nStaging LiveKit dual harness: ${failed === 0 ? 'PASS' : 'FAIL'} (${failed} failed)`);
process.exit(failed === 0 ? 0 : 1);
