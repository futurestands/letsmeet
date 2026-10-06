import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging.local' });
process.env.NO_SERVER_LISTEN = '1';
process.env.LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
process.env.LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secretkey';

import { createClient } from '@supabase/supabase-js';
import { app } from '../server/livekit-token.mjs';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  console.error('Missing staging configuration');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function report(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function run() {
  console.log('=== VERIFYING TELEMETRY PRODUCERS & FEATURE FLAGS ===\n');

  const server = app.listen(0);
  const port = server.address().port;
  const apiBase = `http://localhost:${port}/api`;

  const timeId = Date.now();
  const userEmail = `telemetry-${timeId}@example.com`;
  const password = 'Password123!';

  // Create User
  const userAuth = await supabaseAdmin.auth.admin.createUser({ email: userEmail, password, email_confirm: true });
  const userId = userAuth.data.user.id;

  const userClient = createClient(supabaseUrl, supabaseAnonKey);
  await userClient.auth.signInWithPassword({ email: userEmail, password });
  const userSession = (await userClient.auth.getSession()).data.session;

  await userClient.rpc('ensure_user_profile_context', { p_user_id: userId, p_email: userEmail, p_full_name: 'Telemetry Test User' });

  try {
    // 1. GET /api/feature-flags
    const resFlags = await fetch(`${apiBase}/feature-flags`);
    const flagsBody = await resFlags.json().catch(() => ({}));
    report('1. Public GET /api/feature-flags returns active flag map', resFlags.status === 200 && Boolean(flagsBody.flags?.RECORDING), `status=${resFlags.status}`);

    // 2. POST /api/auth/login-event
    const resLoginEvent = await fetch(`${apiBase}/auth/login-event`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${userSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ eventType: 'login_success', metadata: { client: 'telemetry_test' } }),
    });
    report('2. Authenticated POST /api/auth/login-event records event', resLoginEvent.status === 200, `status=${resLoginEvent.status}`);

    // Query login_events table in DB to verify real row was inserted
    const { data: loginRows } = await supabaseAdmin.from('login_events').select('*').eq('user_id', userId);
    report('   Real login_events row exists in database', Boolean(loginRows?.length), `count=${loginRows?.length}`);

    // 3. Create meeting & request token -> Verifies automatic login_events & platform_activity_events insertion
    const { data: meeting } = await userClient.rpc('create_persistent_meeting', { p_title: 'Telemetry Meeting' });
    const { data: meetingFull } = await supabaseAdmin.from('meetings').select('id, code, organization_id, workspace_id').eq('id', meeting.id).single();

    await userClient.rpc('transition_persistent_meeting', { p_meeting_id: meeting.id, p_target_status: 'live' });
    await supabaseAdmin.from('meeting_participants').insert({
      meeting_id: meeting.id,
      user_id: userId,
      user_name: 'Telemetry Test User',
      organization_id: meetingFull.organization_id,
      workspace_id: meetingFull.workspace_id,
      role: 'host',
      status: 'joined',
    });

    const resToken = await fetch(`${apiBase}/livekit/token?room=${meeting.code}`, {
      headers: { Authorization: `Bearer ${userSession.access_token}` },
    });
    report('3. Token request returns 200 and triggers automatic activity logging', resToken.status === 200, `status=${resToken.status}`);

    // Query platform_activity_events table in DB
    const { data: activityRows } = await supabaseAdmin.from('platform_activity_events').select('*').eq('actor_id', userId);
    report('   Real platform_activity_events row exists in database', Boolean(activityRows?.length), `count=${activityRows?.length}`);

  } finally {
    console.log('\nCleaning up telemetry test users...');
    server.close();
    await supabaseAdmin.auth.admin.deleteUser(userId).catch(() => undefined);
  }
}

run().catch((err) => {
  console.error('Telemetry test execution error:', err);
  process.exit(1);
});
