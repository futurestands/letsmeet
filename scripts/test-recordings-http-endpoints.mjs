import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging.local' });
process.env.NO_SERVER_LISTEN = '1';

import { createClient } from '@supabase/supabase-js';
import { app, redis } from '../server/livekit-token.mjs';

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
  console.log('=== VERIFYING RECORDING HTTP ENDPOINTS & AUTHORIZATION ===\n');

  const server = app.listen(0);
  const port = server.address().port;
  const apiBase = `http://localhost:${port}/api`;

  const timeId = Date.now();
  const hostEmail = `rec-host-${timeId}@example.com`;
  const partEmail = `rec-part-${timeId}@example.com`;
  const crossEmail = `rec-cross-${timeId}@example.com`;
  const password = 'Password123!';

  // 1. Create Host User
  const hostAuth = await supabaseAdmin.auth.admin.createUser({ email: hostEmail, password, email_confirm: true });
  const hostId = hostAuth.data.user.id;

  // 2. Create Participant User
  const partAuth = await supabaseAdmin.auth.admin.createUser({ email: partEmail, password, email_confirm: true });
  const partId = partAuth.data.user.id;

  // 3. Create Cross-Tenant User
  const crossAuth = await supabaseAdmin.auth.admin.createUser({ email: crossEmail, password, email_confirm: true });
  const crossId = crossAuth.data.user.id;

  const hostClient = createClient(supabaseUrl, supabaseAnonKey);
  const partClient = createClient(supabaseUrl, supabaseAnonKey);
  const crossClient = createClient(supabaseUrl, supabaseAnonKey);

  await hostClient.auth.signInWithPassword({ email: hostEmail, password });
  await partClient.auth.signInWithPassword({ email: partEmail, password });
  await crossClient.auth.signInWithPassword({ email: crossEmail, password });

  const hostSession = (await hostClient.auth.getSession()).data.session;
  const partSession = (await partClient.auth.getSession()).data.session;
  const crossSession = (await crossClient.auth.getSession()).data.session;

  await hostClient.rpc('ensure_user_profile_context', { p_user_id: hostId, p_email: hostEmail, p_full_name: 'Recording Host' });
  await partClient.rpc('ensure_user_profile_context', { p_user_id: partId, p_email: partEmail, p_full_name: 'Recording Part' });
  await crossClient.rpc('ensure_user_profile_context', { p_user_id: crossId, p_email: crossEmail, p_full_name: 'Recording Cross' });

  try {
    // 3. Unauthenticated request to /api/recordings/start -> MUST RETURN 401
    const resUnauth = await fetch(`${apiBase}/recordings/start`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ recordingId: '00000000-0000-0000-0000-000000000001' }),
    });
    report('HTTP POST /api/recordings/start unauthenticated returns 401', resUnauth.status === 401, `status=${resUnauth.status}`);

    // 4. Host creates meeting and requests recording row
    const { data: liveCreated } = await hostClient.rpc('create_persistent_meeting', { p_title: 'HTTP Rec Test' });
    const { data: recRow } = await hostClient.rpc('request_meeting_recording', { p_meeting_id: liveCreated.id });

    // 5. Ordinary Participant calling /api/recordings/start -> MUST RETURN 403
    const resPartStart = await fetch(`${apiBase}/recordings/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${partSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recordingId: recRow.id }),
    });
    report('HTTP POST /api/recordings/start ordinary participant returns 403', resPartStart.status === 403, `status=${resPartStart.status}`);

    // 6. Cross-Tenant User calling /api/recordings/start -> MUST RETURN 403
    const resCrossStart = await fetch(`${apiBase}/recordings/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${crossSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recordingId: recRow.id }),
    });
    report('HTTP POST /api/recordings/start cross-tenant user returns 403', resCrossStart.status === 403, `status=${resCrossStart.status}`);

    // 7. Host calling /api/recordings/start on waiting meeting -> MUST RETURN 400 (meeting not live) or 503 (storage not configured)
    const resHostStartWaiting = await fetch(`${apiBase}/recordings/start`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hostSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recordingId: recRow.id }),
    });
    report('HTTP POST /api/recordings/start host on non-live meeting returns 400 or 503', [400, 503].includes(resHostStartWaiting.status), `status=${resHostStartWaiting.status}`);

    // 8. Ordinary Participant calling /api/recordings/reconcile -> MUST RETURN 403
    const resPartReconcile = await fetch(`${apiBase}/recordings/reconcile`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${partSession.access_token}`,
        'Content-Type': 'application/json',
      },
    });
    report('HTTP POST /api/recordings/reconcile ordinary participant returns 403', resPartReconcile.status === 403, `status=${resPartReconcile.status}`);

    // 9. Cross-Tenant User calling /api/recordings/reconcile with meetingId -> MUST RETURN 403
    const resCrossReconcile = await fetch(`${apiBase}/recordings/reconcile`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${crossSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ meetingId: liveCreated.id }),
    });
    report('HTTP POST /api/recordings/reconcile cross-tenant user returns 403', resCrossReconcile.status === 403, `status=${resCrossReconcile.status}`);

    // 10. Host calling /api/recordings/reconcile with meetingId -> MUST RETURN 200
    const resHostReconcile = await fetch(`${apiBase}/recordings/reconcile`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hostSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ meetingId: liveCreated.id }),
    });
    report('HTTP POST /api/recordings/reconcile host with meetingId returns 200', resHostReconcile.status === 200, `status=${resHostReconcile.status}`);

    // 11. Unauthenticated Webhook request -> MUST RETURN 401
    const resUnauthWebhook = await fetch(`${apiBase}/livekit/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'egress_ended' }),
    });
    report('HTTP POST /api/livekit/webhook unauthenticated returns 401', resUnauthWebhook.status === 401, `status=${resUnauthWebhook.status}`);

    // 12. Ordinary Participant calling /api/recordings/playback-url -> MUST RETURN 403 or 409
    const resPartPlayback = await fetch(`${apiBase}/recordings/playback-url`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${partSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ recordingId: recRow.id }),
    });
    report('HTTP POST /api/recordings/playback-url ordinary participant returns 403 or 409', [403, 409].includes(resPartPlayback.status), `status=${resPartPlayback.status}`);

  } finally {
    console.log('\nCleaning up HTTP recording test users...');
    server.close();
    if (redis) redis.disconnect();
    if (hostId) await supabaseAdmin.auth.admin.deleteUser(hostId).catch(() => undefined);
    if (partId) await supabaseAdmin.auth.admin.deleteUser(partId).catch(() => undefined);
    if (crossId) await supabaseAdmin.auth.admin.deleteUser(crossId).catch(() => undefined);
    process.exit(process.exitCode || 0);
  }
}

run().catch((err) => {
  console.error('HTTP test execution error:', err);
  process.exit(1);
});
