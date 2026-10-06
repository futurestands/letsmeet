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

async function runRollbackAudit() {
  console.log('=== ATOMIC TRANSACTION ROLLBACK PROOF (FORCED AUDIT FAILURE) ===\n');

  const timeId = Date.now();
  const sysAdminEmail = `sysadmin-roll-${timeId}@example.com`;
  const targetUserEmail = `target-roll-${timeId}@example.com`;
  const password = 'Password123!';

  // Create Admin and Target User
  const sysAdminAuth = await supabaseAdmin.auth.admin.createUser({ email: sysAdminEmail, password, email_confirm: true });
  const sysAdminId = sysAdminAuth.data.user.id;

  const targetAuth = await supabaseAdmin.auth.admin.createUser({ email: targetUserEmail, password, email_confirm: true });
  const targetUserId = targetAuth.data.user.id;

  const sysAdminClient = createClient(supabaseUrl, supabaseAnonKey);
  await sysAdminClient.auth.signInWithPassword({ email: sysAdminEmail, password });

  await sysAdminClient.rpc('ensure_user_profile_context', { p_user_id: sysAdminId, p_email: sysAdminEmail, p_full_name: 'Rollback Admin' });
  await sysAdminClient.rpc('ensure_user_profile_context', { p_user_id: targetUserId, p_email: targetUserEmail, p_full_name: 'Rollback Target' });

  // Grant platform_admin strictly to sysAdminId via service-role
  await supabaseAdmin.from('platform_admins').insert({ user_id: sysAdminId, role: 'system_admin' });

  const dbConnStr = stagingDbUrl.includes('pgbouncer=true') ? stagingDbUrl : `${stagingDbUrl}?pgbouncer=true`;
  const pgClient = new pg.Client({ connectionString: dbConnStr, ssl: { rejectUnauthorized: false }, connectionTimeoutMillis: 5000, keepAlive: true });
  pgClient.on('error', () => undefined);

  try {
    try {
      await pgClient.connect();
      await pgClient.query(`
        CREATE OR REPLACE FUNCTION public.force_audit_failure()
        RETURNS TRIGGER
        LANGUAGE plpgsql
        SECURITY DEFINER
        SET search_path = public
        AS $$
        BEGIN
          IF NEW.reason LIKE '%FORCED_FAILURE_TEST%' THEN
            RAISE EXCEPTION 'STAGING_FORCED_AUDIT_FAILURE_SIMULATION';
          END IF;
          RETURN NEW;
        END;
        $$;

        DROP TRIGGER IF EXISTS trg_force_audit_failure ON public.system_audit_logs;
        CREATE TRIGGER trg_force_audit_failure
        BEFORE INSERT ON public.system_audit_logs
        FOR EACH ROW
        EXECUTE FUNCTION public.force_audit_failure();
      `);
    } catch (pgErr) {
      console.warn('PostgreSQL direct connection timed out via pooler:', pgErr?.message || pgErr);
    }

    // 1. Establish initial target state before forced failure
    const { data: beforeUser } = await supabaseAdmin.from('users').select('status').eq('id', targetUserId).single();
    report('1. Target user initial status is active', (beforeUser?.status || 'active') === 'active', `status=${beforeUser?.status}`);

    // Execute admin_suspend_user RPC expecting forced audit failure inside transaction
    const { error: errSuspendRpc } = await sysAdminClient.rpc('admin_suspend_user', {
      p_target_user_id: targetUserId,
      p_suspend: true,
      p_reason: 'FORCED_FAILURE_TEST_SUSPEND',
    });

    report('2. admin_suspend_user RPC failed as expected due to forced audit log failure', Boolean(errSuspendRpc) && String(errSuspendRpc?.message).includes('STAGING_FORCED_AUDIT_FAILURE'), errSuspendRpc?.message);

    // VERIFY TRANSACTION ROLLBACK: Target user status MUST STILL BE 'active' (NOT 'suspended')
    const { data: afterUser } = await supabaseAdmin.from('users').select('status').eq('id', targetUserId).single();
    report('3. EMPIRICAL PROOF: Target user status remained ACTIVE after failed RPC (User status update rolled back)', (afterUser?.status || 'active') === 'active', `status=${afterUser?.status}`);

    // VERIFY AUDIT LOG: No audit record created for failed operation
    const { data: auditRecords } = await supabaseAdmin.from('system_audit_logs').select('id').eq('target_id', targetUserId);
    report('4. EMPIRICAL PROOF: No system_audit_logs record exists for failed user suspension', auditRecords?.length === 0, `count=${auditRecords?.length}`);

    // --- TEST 2: admin_suspend_organization Rollback Proof ---
    const { data: testOrg } = await supabaseAdmin.from('organizations').select('id, name, status').limit(1).single();
    if (testOrg) {
      const origOrgStatus = testOrg.status || 'active';

      const { error: errOrgSuspendRpc } = await sysAdminClient.rpc('admin_suspend_organization', {
        p_target_org_id: testOrg.id,
        p_suspend: true,
        p_reason: 'FORCED_FAILURE_TEST_ORG_SUSPEND',
      });

      report('5. admin_suspend_organization RPC failed as expected due to forced audit log failure', Boolean(errOrgSuspendRpc) && String(errOrgSuspendRpc?.message).includes('STAGING_FORCED_AUDIT_FAILURE'), errOrgSuspendRpc?.message);

      const { data: afterOrg } = await supabaseAdmin.from('organizations').select('status').eq('id', testOrg.id).single();
      report('6. EMPIRICAL PROOF: Organization status remained unchanged after failed RPC', (afterOrg?.status || 'active') === origOrgStatus, `status=${afterOrg?.status}`);
    }

    // --- TEST 3: admin_set_feature_flag Rollback Proof ---
    const { data: testFlag } = await supabaseAdmin.from('feature_flags').select('key, enabled').eq('key', 'RECORDING').single();
    if (testFlag) {
      const origFlagEnabled = testFlag.enabled;
      const targetEnabled = !origFlagEnabled;

      const { error: errFlagRpc } = await sysAdminClient.rpc('admin_set_feature_flag', {
        p_key: 'RECORDING',
        p_enabled: targetEnabled,
        p_reason: 'FORCED_FAILURE_TEST_FLAG_TOGGLE',
      });

      report('7. admin_set_feature_flag RPC failed as expected due to forced audit log failure', Boolean(errFlagRpc) && String(errFlagRpc?.message).includes('STAGING_FORCED_AUDIT_FAILURE'), errFlagRpc?.message);

      const { data: afterFlag } = await supabaseAdmin.from('feature_flags').select('enabled').eq('key', 'RECORDING').single();
      report('8. EMPIRICAL PROOF: Feature flag status remained unchanged after failed RPC', afterFlag?.enabled === origFlagEnabled, `enabled=${afterFlag?.enabled}`);
    }

  } finally {
    // Cleanup temporary failure trigger
    await pgClient.query(`
      DROP TRIGGER IF EXISTS trg_force_audit_failure ON public.system_audit_logs;
      DROP FUNCTION IF EXISTS public.force_audit_failure();
    `).catch(() => undefined);
    await pgClient.end().catch(() => undefined);

    console.log('\nCleaning up rollback test users...');
    await supabaseAdmin.auth.admin.deleteUser(sysAdminId).catch(() => undefined);
    await supabaseAdmin.auth.admin.deleteUser(targetUserId).catch(() => undefined);
  }
}

runRollbackAudit().catch((err) => {
  console.error('Rollback audit error:', err);
  process.exit(1);
});
