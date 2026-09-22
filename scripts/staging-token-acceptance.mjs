import { createClient } from '@supabase/supabase-js';

const origin = 'https://letsmeet-git-phase-1-saas-foundation-futurestands-projects.vercel.app';
const tokenUrl = 'https://letsmeet-staging-api.onrender.com/api/livekit/token';
const {
  SUPABASE_URL,
  SUPABASE_SERVICE_ROLE_KEY,
  VITE_SUPABASE_ANON_KEY,
  STAGING_TEST_HOST_EMAIL,
  STAGING_TEST_HOST_PASSWORD,
  STAGING_TEST_PARTICIPANT_EMAIL,
  STAGING_TEST_PARTICIPANT_PASSWORD,
} = process.env;

if (!SUPABASE_URL || !VITE_SUPABASE_ANON_KEY || !SUPABASE_SERVICE_ROLE_KEY) {
  throw new Error('Staging Supabase public and server configuration is required');
}

const hostClient = createClient(SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const participantClient = createClient(SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

function report(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function signIn(client, email, password, retries = 3) {
  for (let i = 0; i < retries; i += 1) {
    try {
      const { data, error } = await client.auth.signInWithPassword({ email, password });
      if (!error && data.session?.access_token && data.user) {
        return { token: data.session.access_token, user: data.user };
      }
      if (i === retries - 1) throw error ?? new Error('Sign-in failed');
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 1000 * (i + 1)));
    }
  }
  throw new Error('Sign-in failed');
}

async function requestToken({ accessToken, room, originHeader = origin, extraQuery = '' }, retries = 3) {
  const headers = { Origin: originHeader, Accept: 'application/json' };
  if (accessToken) headers.Authorization = `Bearer ${accessToken}`;
  const url = `${tokenUrl}?room=${encodeURIComponent(room)}${extraQuery}`;
  for (let i = 0; i < retries; i += 1) {
    try {
      const response = await fetch(url, { headers });
      let payload = {};
      try {
        payload = await response.json();
      } catch {
        payload = {};
      }
      return { status: response.status, payload };
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
  return { status: 500, payload: {} };
}

const unauth = await requestToken({ room: 'INVALID' });
report('unauthenticated request', unauth.status === 401, `status=${unauth.status}`);

const invalidSession = await requestToken({ accessToken: 'invalid-staging-session', room: 'INVALID' });
report('invalid session', invalidSession.status === 401, `status=${invalidSession.status}`);

const unrelated = await requestToken({ room: 'INVALID', originHeader: 'https://unrelated.example' });
report('unrelated origin', unrelated.status === 403, `status=${unrelated.status}`);

const host = await signIn(hostClient, STAGING_TEST_HOST_EMAIL, STAGING_TEST_HOST_PASSWORD);
const participant = await signIn(participantClient, STAGING_TEST_PARTICIPANT_EMAIL, STAGING_TEST_PARTICIPANT_PASSWORD);
report('host authentication', Boolean(host.token));
report('participant authentication', Boolean(participant.token));

const { data: created, error: createError } = await hostClient.rpc('create_persistent_meeting', {
  p_title: 'Staging authorization meeting',
  p_workspace_id: null,
});
if (createError) throw createError;
const meeting = Array.isArray(created) ? created[0] : created;
report('host meeting creation', Boolean(meeting?.code && meeting?.host_id === host.user.id), `status=${meeting?.status ?? 'none'}`);

const missingMeeting = await requestToken({ accessToken: host.token, room: 'LM-ZZZZZZ' });
report('nonexistent meeting', [403, 404].includes(missingMeeting.status), `status=${missingMeeting.status}`);

const invalidCode = await requestToken({ accessToken: host.token, room: 'INVALID' });
report('invalid meeting code', [400, 403].includes(invalidCode.status), `status=${invalidCode.status}`);

const hostBeforeLive = await requestToken({
  accessToken: host.token,
  room: meeting.code,
  extraQuery: '&identity=forged-identity&role=host&organization_id=forged-org&workspace_id=forged-workspace',
});
report(
  'host token ignores client identity overrides',
  hostBeforeLive.status === 200
    && Boolean(hostBeforeLive.payload.token)
    && hostBeforeLive.payload.identity === host.user.id,
  `status=${hostBeforeLive.status}`,
);

const participantBeforeJoin = await requestToken({ accessToken: participant.token, room: meeting.code });
report('non-participant same-tenant denied', participantBeforeJoin.status === 403, `status=${participantBeforeJoin.status}`);

const { error: joinError } = await participantClient.rpc('join_persistent_meeting', { p_code: meeting.code });
report('participant join', !joinError, joinError?.message ?? '');

const { error: liveError } = await hostClient.rpc('transition_persistent_meeting', {
  p_meeting_id: meeting.id,
  p_status: 'live',
});
report('host starts meeting', !liveError, liveError?.message ?? '');

const participantToken = await requestToken({ accessToken: participant.token, room: meeting.code });
report(
  'valid participant token',
  participantToken.status === 200
    && Boolean(participantToken.payload.token)
    && participantToken.payload.identity === participant.user.id,
  `status=${participantToken.status}`,
);

const admin = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const outsiderEmail = `outsider.${Date.now()}@letsmeet-staging.test`;
const outsiderPassword = `Outsider-${Date.now()}!Aa`;
const { data: outsiderCreated, error: outsiderCreateError } = await admin.auth.admin.createUser({
  email: outsiderEmail,
  password: outsiderPassword,
  email_confirm: true,
  user_metadata: { full_name: 'Staging Outsider', purpose: 'phase-3-authorization-matrix' },
});
if (outsiderCreateError || !outsiderCreated.user) {
  report('cross-tenant user creation', false, outsiderCreateError?.message ?? 'missing user');
} else {
  const outsiderClient = createClient(SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  const outsider = await signIn(outsiderClient, outsiderEmail, outsiderPassword);
  const outsiderToken = await requestToken({ accessToken: outsider.token, room: meeting.code });
  report('cross-tenant token denied', outsiderToken.status === 403, `status=${outsiderToken.status}`);
}

const { error: removeError } = await hostClient.rpc('moderate_persistent_participant', {
  p_meeting_id: meeting.id,
  p_participant_user_id: participant.user.id,
  p_action: 'remove',
});
report('host removes participant', !removeError, removeError?.message ?? '');

const removedToken = await requestToken({ accessToken: participant.token, room: meeting.code });
report('removed participant denied', removedToken.status === 403, `status=${removedToken.status}`);

const { error: endError } = await hostClient.rpc('transition_persistent_meeting', {
  p_meeting_id: meeting.id,
  p_status: 'ended',
});
report('host ends meeting', !endError, endError?.message ?? '');

const endedToken = await requestToken({ accessToken: host.token, room: meeting.code });
report('ended meeting denied', endedToken.status === 403, `status=${endedToken.status}`);

if (!process.exitCode) console.log('Staging LiveKit authorization matrix passed.');
