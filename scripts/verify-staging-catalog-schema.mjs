import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.staging.local' });

const targetUrl = process.env.STAGING_DATABASE_URL;
if (!targetUrl) {
  console.error('STAGING_DATABASE_URL is required (no fallback to DATABASE_URL, to avoid verifying the wrong database).');
  process.exit(1);
}

function report(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function verifyCatalog() {
  console.log('=== VERIFYING STAGING POSTGRESQL CATALOG SCHEMA ===\n');

  const client = new pg.Client({
    connectionString: targetUrl,
    ssl: { rejectUnauthorized: false },
    connectionTimeoutMillis: 5000,
    keepAlive: true,
  });

  await client.connect();

  try {
    // 1. Verify function enforce_recording_status_transition exists
    const resFunc = await client.query(`
      SELECT proname FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid
      WHERE pg_namespace.nspname = 'public' AND proname = 'enforce_recording_status_transition';
    `);
    report('1. Function public.enforce_recording_status_transition exists in catalog', resFunc.rows.length === 1);

    // 1b. Verify function body definition allows active -> completed and maintains terminal state immutability
    const resBody = await client.query(`
      SELECT pg_get_functiondef(p.oid) AS def
      FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
      WHERE n.nspname = 'public' AND p.proname = 'enforce_recording_status_transition';
    `);
    const def = resBody.rows[0]?.def || '';
    const activeBlock = def.split("WHEN 'active' THEN")[1]?.split("WHEN 'stopping' THEN")[0] || '';
    report('   Function body allows active -> completed (migration 025 applied)', activeBlock.includes("'completed'"));
    report('   Function body keeps completed/cancelled terminal', def.includes('(terminal state)'));

    // 2. Verify trigger trg_enforce_recording_status_transition exists on meeting_recordings
    const resTrig = await client.query(`
      SELECT trigger_name, event_manipulation, action_timing
      FROM information_schema.triggers
      WHERE event_object_table = 'meeting_recordings'
        AND trigger_name = 'trg_enforce_recording_status_transition';
    `);
    report('2. Trigger trg_enforce_recording_status_transition exists on meeting_recordings', resTrig.rows.length === 1);
    report('   Trigger fires BEFORE UPDATE', resTrig.rows[0]?.action_timing === 'BEFORE' && resTrig.rows[0]?.event_manipulation === 'UPDATE');

    // 3. Verify index idx_one_active_recording_per_meeting exists with predicate
    const resIndex = await client.query(`
      SELECT indexname, indexdef
      FROM pg_indexes
      WHERE tablename = 'meeting_recordings' AND indexname = 'idx_one_active_recording_per_meeting';
    `);
    report('3. Partial Unique Index idx_one_active_recording_per_meeting exists', resIndex.rows.length === 1);
    const indexDef = resIndex.rows[0]?.indexdef || '';
    report('   Index predicate covers starting, active, stopping', indexDef.includes('starting') && indexDef.includes('active') && indexDef.includes('stopping'));

    // 4. Verify can_manage_recordings overload count & can_manage_recordings_for_user
    const resCanManage = await client.query(`
      SELECT proname, pg_get_function_identity_arguments(pg_proc.oid) as args
      FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid
      WHERE pg_namespace.nspname = 'public' AND proname IN ('can_manage_recordings', 'can_manage_recordings_for_user');
    `);
    report('4. Client-facing can_manage_recordings(p_meeting_id) and internal helper can_manage_recordings_for_user exist', resCanManage.rows.length >= 2);

    // 5. Verify system_audit_logs immutability trigger
    const resAuditTrig = await client.query(`
      SELECT trg.tgname
      FROM pg_trigger trg
      JOIN pg_class tbl ON trg.tgrelid = tbl.oid
      JOIN pg_namespace nsp ON tbl.relnamespace = nsp.oid
      WHERE nsp.nspname = 'public'
        AND tbl.relname = 'system_audit_logs'
        AND trg.tgname = 'trg_prevent_system_audit_log_modification';
    `);
    report('5. Immutability trigger trg_prevent_system_audit_log_modification exists on system_audit_logs', resAuditTrig.rows.length === 1);

  } finally {
    await client.end().catch(() => undefined);
    process.exit(process.exitCode || 0);
  }
}

verifyCatalog().catch((err) => {
  console.error('Catalog verification error:', err);
  process.exit(1);
});
