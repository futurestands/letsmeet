import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.staging.local' });

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

async function runSecurityAudit() {
  console.log('=== DIRECT RPC & PLATFORM ADMIN SECURITY AUDIT MATRIX ===\n');

  const timeId = Date.now();
  const sysAdminEmail = `sysadmin-sec-${timeId}@example.com`;
  const orgOwnerEmail = `orgowner-sec-${timeId}@example.com`;
  const normalUserEmail = `normal-sec-${timeId}@example.com`;
  const password = 'Password123!';

  // Create Users
  const sysAdminAuth = await supabaseAdmin.auth.admin.createUser({ email: sysAdminEmail, password, email_confirm: true });
  const sysAdminId = sysAdminAuth.data.user.id;

  const orgOwnerAuth = await supabaseAdmin.auth.admin.createUser({ email: orgOwnerEmail, password, email_confirm: true });
  const orgOwnerId = orgOwnerAuth.data.user.id;

  const normalAuth = await supabaseAdmin.auth.admin.createUser({ email: normalUserEmail, password, email_confirm: true });
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
    // A. Unauthenticated Direct RPC
    const { data: isUnauthAdmin } = await unauthClient.rpc('is_system_admin');
    report('A. Unauthenticated is_system_admin() returns false', isUnauthAdmin === false);

    const { error: errUnauthOverview } = await unauthClient.rpc('get_system_overview_metrics');
    report('A. Unauthenticated get_system_overview_metrics() denied', Boolean(errUnauthOverview));

    // B. Normal Authenticated User Direct RPC
    const { data: isNormalAdmin } = await normalClient.rpc('is_system_admin');
    report('B. Normal user is_system_admin() returns false', isNormalAdmin === false);

    const { error: errNormalOverview } = await normalClient.rpc('get_system_overview_metrics');
    report('B. Normal user get_system_overview_metrics() denied', Boolean(errNormalOverview));

    // C. DIRECT RPC PARAMETER SUBSTITUTION ATTACK: Normal user passes sysAdminId as p_user_id
    const { data: isSubstAdmin } = await normalClient.rpc('is_system_admin', { p_user_id: sysAdminId });
    report('C. Parameter substitution attack is_system_admin(sysAdminId) returns false', isSubstAdmin === false);

    const { error: errSubstOverview } = await normalClient.rpc('get_system_overview_metrics', { p_user_id: sysAdminId });
    report('C. Parameter substitution attack get_system_overview_metrics(sysAdminId) denied', Boolean(errSubstOverview));

    // D. Organization Owner
    const { data: isOwnerAdmin } = await orgOwnerClient.rpc('is_system_admin');
    report('D. Organization Owner is_system_admin() returns false (Org owner != Platform admin)', isOwnerAdmin === false);

    // E. Real System Admin Direct RPC
    const { data: isRealAdmin } = await sysAdminClient.rpc('is_system_admin');
    report('E. Real System Admin is_system_admin() returns true', isRealAdmin === true);

    const { data: overviewData, error: errRealOverview } = await sysAdminClient.rpc('get_system_overview_metrics');
    report('E. Real System Admin get_system_overview_metrics() succeeds', !errRealOverview && Boolean(overviewData), errRealOverview?.message);

    // F. Self-Promotion Attempt on platform_admins Table by Normal User
    const { error: errSelfPromote } = await normalClient.from('platform_admins').insert({ user_id: normalId, role: 'system_admin' });
    report('F. Normal user self-promotion on platform_admins table denied by RLS', Boolean(errSelfPromote));

    // G. System Audit Logs Immutability Check
    const { data: auditRow } = await supabaseAdmin.from('system_audit_logs').insert({
      admin_user_id: sysAdminId,
      action: 'TEST_AUDIT',
      target_type: 'test',
      target_id: '1',
      reason: 'UNTOUCHED_ORIGINAL',
    }).select().single();

    if (auditRow) {
      // Attempt UPDATE on system_audit_logs -> MUST FAIL or result in 0 rows updated
      const { error: errAuditUpdate } = await normalClient.from('system_audit_logs').update({ reason: 'Hacked' }).eq('id', auditRow.id);
      const { data: checkRow } = await supabaseAdmin.from('system_audit_logs').select('reason').eq('id', auditRow.id).single();
      report('G. Normal user update on system_audit_logs denied (0 rows updated / reason unmodified)', Boolean(errAuditUpdate) || checkRow?.reason === 'UNTOUCHED_ORIGINAL', `reason=${checkRow?.reason}`);

      // Attempt DELETE on system_audit_logs via admin client (trigger check) -> MUST FAIL
      const { error: errAuditDelete } = await supabaseAdmin.from('system_audit_logs').delete().eq('id', auditRow.id);
      report('G. Deletion of system_audit_logs blocked by immutability trigger', Boolean(errAuditDelete), errAuditDelete?.message);
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
