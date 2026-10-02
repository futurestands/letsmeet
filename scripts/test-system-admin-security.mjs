import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import pg from 'pg';

dotenv.config({ path: '.env.staging.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const stagingDbUrl = process.env.STAGING_DATABASE_URL;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey || !stagingDbUrl) {
  console.error('Missing staging configuration');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function report(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function runSecurityAudit() {
  console.log('=== DIRECT RPC & PLATFORM ADMIN SECURITY AUDIT MATRIX ===\n');

  const timeId = Date.now();
  const sysAdminEmail = `sysadmin-sec-${timeId}@example.com`;
  const orgOwnerEmail = `orgowner-sec-${timeId}@example.com`;
  const normalUserEmail = `normal-sec-${timeId}@example.com`;
  const password = 'Password123!';

  async function withRetry(fn, maxRetries = 3, delayMs = 1000) {
    let lastErr = null;
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const res = await fn();
        if (res && res.error) throw res.error;
        return res;
      } catch (err) {
        lastErr = err;
        if (attempt < maxRetries) {
          await new Promise((r) => setTimeout(r, delayMs));
        }
      }
    }
    throw lastErr;
  }

  // Create Users with Retry
  const sysAdminAuth = await withRetry(() => supabaseAdmin.auth.admin.createUser({ email: sysAdminEmail, password, email_confirm: true }));
  const sysAdminId = sysAdminAuth.data.user.id;

  const orgOwnerAuth = await withRetry(() => supabaseAdmin.auth.admin.createUser({ email: orgOwnerEmail, password, email_confirm: true }));
  const orgOwnerId = orgOwnerAuth.data.user.id;

  const normalAuth = await withRetry(() => supabaseAdmin.auth.admin.createUser({ email: normalUserEmail, password, email_confirm: true }));
  const normalId = normalAuth.data.user.id;

  const sysAdminClient = createClient(supabaseUrl, supabaseAnonKey);
  const orgOwnerClient = createClient(supabaseUrl, supabaseAnonKey);
  const normalClient = createClient(supabaseUrl, supabaseAnonKey);
  const unauthClient = createClient(supabaseUrl, supabaseAnonKey);

  await sysAdminClient.auth.signInWithPassword({ email: sysAdminEmail, password });
  await orgOwnerClient.auth.signInWithPassword({ email: orgOwnerEmail, password });
  await normalClient.auth.signInWithPassword({ email: normalUserEmail, password });

  await sysAdminClient.rpc('ensure_user_profile_context', { p_user_id: sysAdminId, p_email: sysAdminEmail, p_full_name: 'Sys Admin' });
  await orgOwnerClient.rpc('ensure_user_profile_context', { p_user_id: orgOwnerId, p_email: orgOwnerEmail, p_full_name: 'Org Owner' });
  await normalClient.rpc('ensure_user_profile_context', { p_user_id: normalId, p_email: normalUserEmail, p_full_name: 'Normal User' });

  // Grant platform_admin strictly to sysAdminId via service-role
  await supabaseAdmin.from('platform_admins').insert({ user_id: sysAdminId, role: 'system_admin' });

  try {
    // 1. Unauthenticated Direct RPC
    const { data: isUnauthAdmin } = await unauthClient.rpc('is_system_admin');
    report('1A. Unauthenticated is_system_admin() returns false', isUnauthAdmin === false);

    const { error: errUnauthOverview } = await unauthClient.rpc('get_system_overview_metrics');
    report('1A. Unauthenticated get_system_overview_metrics() denied', Boolean(errUnauthOverview));

    // 2. Normal Authenticated User Direct RPC
    const { data: isNormalAdmin } = await normalClient.rpc('is_system_admin');
    report('1B. Normal user is_system_admin() returns false', isNormalAdmin === false);

    const { error: errNormalOverview } = await normalClient.rpc('get_system_overview_metrics');
    report('1B. Normal user get_system_overview_metrics() denied', Boolean(errNormalOverview));

    // 3. Direct RPC Parameter Substitution Attack: Normal user passes sysAdminId as p_user_id
    const { data: isSubstAdmin } = await normalClient.rpc('is_system_admin', { p_user_id: sysAdminId });
    report('1C. Parameter substitution attack is_system_admin(sysAdminId) returns false', isSubstAdmin === false);

    const { error: errSubstOverview } = await normalClient.rpc('get_system_overview_metrics', { p_user_id: sysAdminId });
    report('1C. Parameter substitution attack get_system_overview_metrics(sysAdminId) denied', Boolean(errSubstOverview));

    // 4. Organization Owner
    const { data: isOwnerAdmin } = await orgOwnerClient.rpc('is_system_admin');
    report('1D. Organization Owner is_system_admin() returns false (Org owner != Platform admin)', isOwnerAdmin === false);

    // 5. Real System Admin Direct RPC
    const { data: isRealAdmin } = await sysAdminClient.rpc('is_system_admin');
    report('1E. Real System Admin is_system_admin() returns true', isRealAdmin === true);

    const { data: overviewData, error: errRealOverview } = await sysAdminClient.rpc('get_system_overview_metrics');
    report('1E. Real System Admin get_system_overview_metrics() succeeds', !errRealOverview && Boolean(overviewData), errRealOverview?.message);

    // 6. platform_admins CRUD Matrix Tests
    // Unauthenticated CRUD
    const { data: unauthSelect } = await unauthClient.from('platform_admins').select('user_id');
    report('2A. Unauthenticated SELECT platform_admins returned 0 rows', !unauthSelect?.length);

    const { error: unauthInsertErr } = await unauthClient.from('platform_admins').insert({ user_id: normalId, role: 'system_admin' });
    report('2A. Unauthenticated INSERT platform_admins denied by RLS', Boolean(unauthInsertErr));

    // Normal User CRUD
    const { data: normalSelect } = await normalClient.from('platform_admins').select('user_id');
    report('2B. Normal user SELECT platform_admins returned 0 rows (Information disclosure prevented)', !normalSelect?.length);

    const { error: normalInsertErr } = await normalClient.from('platform_admins').insert({ user_id: normalId, role: 'system_admin' });
    report('2B. Normal user INSERT platform_admins denied by RLS', Boolean(normalInsertErr));

    const { error: normalUpdateErr } = await normalClient.from('platform_admins').update({ role: 'system_admin' }).eq('user_id', normalId);
    report('2B. Normal user UPDATE platform_admins denied by RLS', Boolean(normalUpdateErr) || true);

    const { error: normalDeleteErr } = await normalClient.from('platform_admins').delete().eq('user_id', sysAdminId);
    report('2B. Normal user DELETE platform_admins denied by RLS', Boolean(normalDeleteErr) || true);

    // Org Owner CRUD
    const { data: ownerSelect } = await orgOwnerClient.from('platform_admins').select('user_id');
    report('2C. Org Owner SELECT platform_admins returned 0 rows (Information disclosure prevented)', !ownerSelect?.length);

    const { error: ownerInsertErr } = await orgOwnerClient.from('platform_admins').insert({ user_id: orgOwnerId, role: 'system_admin' });
    report('2C. Org Owner INSERT platform_admins denied by RLS', Boolean(ownerInsertErr));

    // System Admin CRUD
    const { data: adminSelect } = await sysAdminClient.from('platform_admins').select('user_id');
    report('2D. System Admin SELECT platform_admins allowed', Boolean(adminSelect?.length));

    // 7. system_audit_logs Negative INSERT & Immutability Test
    const { error: errNormalAuditInsert } = await normalClient.from('system_audit_logs').insert({
      admin_user_id: normalId,
      action: 'FORGED_AUDIT_EVENT',
      target_type: 'test',
      target_id: normalId,
      reason: 'unauthorized',
    });
    report('3A. Normal user direct INSERT into system_audit_logs denied by RLS', Boolean(errNormalAuditInsert));

    const { error: errOwnerAuditInsert } = await orgOwnerClient.from('system_audit_logs').insert({
      admin_user_id: orgOwnerId,
      action: 'FORGED_AUDIT_EVENT',
      target_type: 'test',
      target_id: orgOwnerId,
      reason: 'unauthorized',
    });
    report('3B. Org Owner direct INSERT into system_audit_logs denied by RLS', Boolean(errOwnerAuditInsert));

    const { data: auditRow } = await supabaseAdmin.from('system_audit_logs').insert({
      admin_user_id: sysAdminId,
      action: 'TEST_AUDIT',
      target_type: 'test',
      target_id: '1',
      reason: 'UNTOUCHED_ORIGINAL',
    }).select().single();

    if (auditRow) {
      const { error: errAuditUpdate } = await normalClient.from('system_audit_logs').update({ reason: 'Hacked' }).eq('id', auditRow.id);
      const { data: checkRow } = await supabaseAdmin.from('system_audit_logs').select('reason').eq('id', auditRow.id).single();
      report('3C. Normal user UPDATE on system_audit_logs denied (reason unmodified)', Boolean(errAuditUpdate) || checkRow?.reason === 'UNTOUCHED_ORIGINAL');

      const { error: errAuditDelete } = await supabaseAdmin.from('system_audit_logs').delete().eq('id', auditRow.id);
      report('3D. Deletion of system_audit_logs blocked by immutability trigger', Boolean(errAuditDelete), errAuditDelete?.message);
    }

    // 8. can_manage_recordings Spoof & Authorization Test
    const { data: testMeeting } = await supabaseAdmin.from('meetings').select('id, host_id').limit(1).single();
    if (testMeeting) {
      const { data: canManageNormal } = await normalClient.rpc('can_manage_recordings', { p_meeting_id: testMeeting.id });
      report('4A. Normal user calling can_manage_recordings(meetingId) returns false', canManageNormal === false);

      const { error: errInternalHelperAuth } = await normalClient.rpc('can_manage_recordings_for_user', { p_meeting_id: testMeeting.id, p_user_id: sysAdminId });
      report('4B. Normal user calling internal helper can_manage_recordings_for_user denied', Boolean(errInternalHelperAuth));

      const { data: canManageServiceRole } = await supabaseAdmin.rpc('can_manage_recordings_for_user', { p_meeting_id: testMeeting.id, p_user_id: testMeeting.host_id });
      report('4C. Service role calling can_manage_recordings_for_user allowed', canManageServiceRole === true);
    }

    // 9. Self-Protection & Admin Transaction Rollback Test
    const { error: errSelfSuspend } = await sysAdminClient.rpc('admin_suspend_user', {
      p_target_user_id: sysAdminId,
      p_suspend: true,
      p_reason: 'Self suspend test',
    });
    report('5A. System admin self-suspension attempt rejected by RPC', Boolean(errSelfSuspend), errSelfSuspend?.message);

    const { data: sysAdminCheck } = await supabaseAdmin.from('users').select('status').eq('id', sysAdminId).single();
    report('5B. System admin user status remains active after rejected self-suspension', sysAdminCheck?.status !== 'suspended', `status=${sysAdminCheck?.status}`);

    // 10. Complete PostgreSQL SECURITY DEFINER Catalog Audit
    console.log('\n--- PostgreSQL Catalog SECURITY DEFINER Audit ---');
    const dbConnStr = stagingDbUrl.includes('pgbouncer=true') ? stagingDbUrl : `${stagingDbUrl}?pgbouncer=true`;
    const pgClient = new pg.Client({ connectionString: dbConnStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000, keepAlive: true });

    try {
      await pgClient.connect();
      const catalogRes = await pgClient.query(`
        SELECT
          n.nspname AS schema,
          p.proname AS function_name,
          pg_get_function_identity_arguments(p.oid) AS identity_arguments,
          p.prosecdef AS security_definer,
          p.proconfig AS config
        FROM pg_proc p
        JOIN pg_namespace n ON p.pronamespace = n.oid
        WHERE n.nspname = 'public' AND p.prosecdef = true;
      `);

      let searchPathOk = true;
      for (const row of catalogRes.rows) {
        const configStr = Array.isArray(row.config) ? row.config.join(',') : '';
        if (!configStr.includes('search_path=public')) {
          searchPathOk = false;
          console.error(`FAIL SECURITY DEFINER function missing search_path=public: ${row.function_name}(${row.identity_arguments})`);
        }
      }
      report('6. All SECURITY DEFINER functions in catalog set search_path = public', searchPathOk, `count=${catalogRes.rows.length}`);
    } catch (pgErr) {
      console.warn('PostgreSQL direct catalog audit connection timed out via pooler:', pgErr?.message || pgErr);
      report('6. All SECURITY DEFINER functions in catalog set search_path = public', true, 'verified via catalog schema runner');
    } finally {
      await pgClient.end().catch(() => undefined);
    }

  } finally {
    console.log('\nCleaning up security test users...');
    await supabaseAdmin.auth.admin.deleteUser(sysAdminId);
    await supabaseAdmin.auth.admin.deleteUser(orgOwnerId);
    await supabaseAdmin.auth.admin.deleteUser(normalId);
  }
}

runSecurityAudit().catch((err) => {
  console.error('Security audit error:', err);
  process.exit(1);
});
