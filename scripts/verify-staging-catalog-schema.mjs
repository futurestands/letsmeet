import pg from 'pg';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.staging.local' });
dotenv.config({ path: '.env.local' });

const targetUrl = process.env.STAGING_DATABASE_URL || process.env.DATABASE_URL;

function report(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function verifyCatalog() {
  console.log('=== VERIFYING STAGING POSTGRESQL CATALOG SCHEMA ===\n');

  const client = new pg.Client({
    connectionString: targetUrl,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();

  try {
    // 1. Verify function enforce_recording_status_transition exists
    const resFunc = await client.query(`
      SELECT proname, proname FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid
      WHERE pg_namespace.nspname = 'public' AND proname = 'enforce_recording_status_transition';
    `);
    report('1. Function public.enforce_recording_status_transition exists in catalog', resFunc.rows.length === 1);

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

    // 4. Verify can_manage_recordings overload count
    const resCanManage = await client.query(`
      SELECT proname, pg_get_function_identity_arguments(pg_proc.oid) as args
      FROM pg_proc JOIN pg_namespace ON pg_proc.pronamespace = pg_namespace.oid
      WHERE pg_namespace.nspname = 'public' AND proname = 'can_manage_recordings';
    `);
    report('4. Function public.can_manage_recordings has exactly 1 active signature (no orphaned overload)', resCanManage.rows.length === 1, `args: ${resCanManage.rows[0]?.args}`);

  } finally {
    await client.end();
  }
}

verifyCatalog().catch((err) => {
  console.error('Catalog verification error:', err);
  process.exit(1);
});
