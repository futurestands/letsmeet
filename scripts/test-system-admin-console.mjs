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
  console.log('=== VERIFYING SYSTEM ADMIN CONSOLE ENDPOINTS & AUTHORIZATION ===\n');

  const server = app.listen(0);
  const port = server.address().port;
  const apiBase = `http://localhost:${port}/api`;

  const timeId = Date.now();
  const hostEmail = `sysadmin-${timeId}@example.com`;
  const normalUserEmail = `normal-${timeId}@example.com`;
  const password = 'Password123!';

  // 1. Create Host (Will be promoted to System Admin)
  const hostAuth = await supabaseAdmin.auth.admin.createUser({ email: hostEmail, password, email_confirm: true });
  const hostId = hostAuth.data.user.id;

  // 2. Create Normal User / Org Admin
  const normalAuth = await supabaseAdmin.auth.admin.createUser({ email: normalUserEmail, password, email_confirm: true });
  const normalId = normalAuth.data.user.id;

  const hostClient = createClient(supabaseUrl, supabaseAnonKey);
  const normalClient = createClient(supabaseUrl, supabaseAnonKey);

  await hostClient.auth.signInWithPassword({ email: hostEmail, password });
  await normalClient.auth.signInWithPassword({ email: normalUserEmail, password });

  const hostSession = (await hostClient.auth.getSession()).data.session;
  const normalSession = (await normalClient.auth.getSession()).data.session;

  await hostClient.rpc('ensure_user_profile_context', { p_user_id: hostId, p_email: hostEmail, p_full_name: 'Sys Admin Candidate' });
  await normalClient.rpc('ensure_user_profile_context', { p_user_id: normalId, p_email: normalUserEmail, p_full_name: 'Normal Org User' });

  try {
    // A. Unauthenticated request to /api/system-admin/overview -> MUST RETURN 401
    const resUnauth = await fetch(`${apiBase}/system-admin/overview`);
    report('1. Unauthenticated request to /api/system-admin/overview returns 401', resUnauth.status === 401, `status=${resUnauth.status}`);

    // B. Normal User (Org Owner / Member without platform_admin entry) -> MUST RETURN 403
    const resNormal = await fetch(`${apiBase}/system-admin/overview`, {
      headers: { Authorization: `Bearer ${normalSession.access_token}` },
    });
    report('2. Normal Org User request to /api/system-admin/overview returns 403', resNormal.status === 403, `status=${resNormal.status}`);

    // C. Grant System Admin role to hostId in platform_admins
    const { error: grantError } = await supabaseAdmin.from('platform_admins').insert({
      user_id: hostId,
      role: 'system_admin',
    });
    report('3. Platform admin record granted in database', !grantError, grantError?.message);

    // D. Authorized System Admin Overview
    const resOverview = await fetch(`${apiBase}/system-admin/overview`, {
      headers: { Authorization: `Bearer ${hostSession.access_token}` },
    });
    const overviewBody = await resOverview.json().catch(() => ({}));
    report('4. Authorized System Admin GET /api/system-admin/overview returns 200 with real metrics', resOverview.status === 200 && Boolean(overviewBody.metrics?.users?.total), `status=${resOverview.status}`);

    // E. Authorized System Admin Users List
    const resUsers = await fetch(`${apiBase}/system-admin/users`, {
      headers: { Authorization: `Bearer ${hostSession.access_token}` },
    });
    const usersBody = await resUsers.json().catch(() => ({}));
    report('5. Authorized System Admin GET /api/system-admin/users returns 200 with user list', resUsers.status === 200 && Array.isArray(usersBody.users), `status=${resUsers.status}`);

    // F. Authorized System Admin Organizations List
    const resOrgs = await fetch(`${apiBase}/system-admin/organizations`, {
      headers: { Authorization: `Bearer ${hostSession.access_token}` },
    });
    const orgsBody = await resOrgs.json().catch(() => ({}));
    report('6. Authorized System Admin GET /api/system-admin/organizations returns 200 with org list', resOrgs.status === 200 && Array.isArray(orgsBody.organizations), `status=${resOrgs.status}`);

    // G. Authorized System Admin Live Meetings
    const resLive = await fetch(`${apiBase}/system-admin/live-meetings`, {
      headers: { Authorization: `Bearer ${hostSession.access_token}` },
    });
    report('7. Authorized System Admin GET /api/system-admin/live-meetings returns 200', resLive.status === 200, `status=${resLive.status}`);

    // H. Authorized System Admin Feature Flags
    const resFlags = await fetch(`${apiBase}/system-admin/feature-flags`, {
      headers: { Authorization: `Bearer ${hostSession.access_token}` },
    });
    const flagsBody = await resFlags.json().catch(() => ({}));
    report('8. Authorized System Admin GET /api/system-admin/feature-flags returns 200 with flags', resFlags.status === 200 && Array.isArray(flagsBody.flags), `status=${resFlags.status}`);

    // I. System Admin Toggle Feature Flag
    const resToggle = await fetch(`${apiBase}/system-admin/feature-flags`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${hostSession.access_token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ key: 'RECORDING', enabled: true, reason: 'Console test' }),
    });
    report('9. Authorized System Admin POST /api/system-admin/feature-flags returns 200', resToggle.status === 200, `status=${resToggle.status}`);

    // J. System Admin Health Endpoint
    const resHealth = await fetch(`${apiBase}/system-admin/health`, {
      headers: { Authorization: `Bearer ${hostSession.access_token}` },
    });
    const healthBody = await resHealth.json().catch(() => ({}));
    report('10. Authorized System Admin GET /api/system-admin/health returns 200 with service health', resHealth.status === 200 && Boolean(healthBody.services?.database?.status), `status=${resHealth.status}`);

    // K. System Admin Audit Logs
    const resAudit = await fetch(`${apiBase}/system-admin/audit-logs`, {
      headers: { Authorization: `Bearer ${hostSession.access_token}` },
    });
    const auditBody = await resAudit.json().catch(() => ({}));
    report('11. Authorized System Admin GET /api/system-admin/audit-logs returns 200 with logged admin actions', resAudit.status === 200 && Array.isArray(auditBody.auditLogs), `status=${resAudit.status}`);

  } finally {
    console.log('\nCleaning up System Admin test users...');
    server.close();
    if (redis) redis.disconnect();
    if (hostId) await supabaseAdmin.auth.admin.deleteUser(hostId).catch(() => undefined);
    if (normalId) await supabaseAdmin.auth.admin.deleteUser(normalId).catch(() => undefined);
    process.exit(process.exitCode || 0);
  }
}

run().catch((err) => {
  console.error('System admin test execution error:', err);
  process.exit(1);
});
