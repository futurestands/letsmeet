import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.staging.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing staging configuration');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function report(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function run() {
  console.log('=== VERIFYING DATABASE RECORDING STATE MACHINE & CONCURRENCY INVARIANTS ===\n');

  // Query test meeting
  const { data: meeting } = await supabaseAdmin.from('meetings').select('id, organization_id, workspace_id, host_id').limit(1).single();
  if (!meeting) {
    console.error('No meeting found for test');
    process.exit(1);
  }

  // --- SECTION 1: LEGAL & IDEMPOTENT TRANSITIONS ---
  console.log('--- 1. Testing Legal & Idempotent Transitions ---');

  const { data: recRow } = await supabaseAdmin.from('meeting_recordings').insert({
    meeting_id: meeting.id,
    organization_id: meeting.organization_id,
    workspace_id: meeting.workspace_id,
    started_by: meeting.host_id,
    status: 'queued',
  }).select().single();

  report('Database inserted initial recording (queued)', Boolean(recRow?.id));
  if (!recRow) return;

  try {
    // queued -> queued (idempotent)
    const { error: errQ } = await supabaseAdmin.from('meeting_recordings').update({ status: 'queued' }).eq('id', recRow.id);
    report('queued -> queued (idempotent)', !errQ, errQ?.message);

    // queued -> starting
    const { error: errS } = await supabaseAdmin.from('meeting_recordings').update({ status: 'starting' }).eq('id', recRow.id);
    report('queued -> starting', !errS, errS?.message);

    // starting -> active
    const { error: errA } = await supabaseAdmin.from('meeting_recordings').update({ status: 'active' }).eq('id', recRow.id);
    report('starting -> active', !errA, errA?.message);

    // active -> stopping
    const { error: errSt } = await supabaseAdmin.from('meeting_recordings').update({ status: 'stopping' }).eq('id', recRow.id);
    report('active -> stopping', !errSt, errSt?.message);

    // stopping -> active (stop recovery)
    const { error: errRec } = await supabaseAdmin.from('meeting_recordings').update({ status: 'active' }).eq('id', recRow.id);
    report('stopping -> active (stop error recovery)', !errRec, errRec?.message);

    // active -> stopping
    await supabaseAdmin.from('meeting_recordings').update({ status: 'stopping' }).eq('id', recRow.id);

    // stopping -> completed
    const { error: errC } = await supabaseAdmin.from('meeting_recordings').update({ status: 'completed' }).eq('id', recRow.id);
    report('stopping -> completed', !errC, errC?.message);

    // completed -> completed (idempotent)
    const { error: errCompIdem } = await supabaseAdmin.from('meeting_recordings').update({ status: 'completed' }).eq('id', recRow.id);
    report('completed -> completed (idempotent)', !errCompIdem, errCompIdem?.message);

  } finally {
    await supabaseAdmin.from('meeting_recordings').delete().eq('id', recRow.id);
  }

  // --- SECTION 2: ILLEGAL TRANSITIONS FROM TERMINAL STATES ---
  console.log('\n--- 2. Testing Terminal State Immutability (completed / cancelled) ---');

  // Completed Terminal State Test
  const { data: completedRec } = await supabaseAdmin.from('meeting_recordings').insert({
    meeting_id: meeting.id,
    organization_id: meeting.organization_id,
    workspace_id: meeting.workspace_id,
    started_by: meeting.host_id,
    status: 'queued',
  }).select().single();

  await supabaseAdmin.from('meeting_recordings').update({ status: 'starting' }).eq('id', completedRec.id);
  await supabaseAdmin.from('meeting_recordings').update({ status: 'active' }).eq('id', completedRec.id);
  await supabaseAdmin.from('meeting_recordings').update({ status: 'stopping' }).eq('id', completedRec.id);
  await supabaseAdmin.from('meeting_recordings').update({ status: 'completed' }).eq('id', completedRec.id);

  try {
    for (const targetStatus of ['queued', 'starting', 'active', 'stopping', 'failed', 'cancelled']) {
      const { error: err } = await supabaseAdmin.from('meeting_recordings').update({ status: targetStatus }).eq('id', completedRec.id);
      report(`Terminal completed -> ${targetStatus} rejected`, Boolean(err), err?.message ?? 'Update unexpectedly succeeded');

      const { data: checkRow } = await supabaseAdmin.from('meeting_recordings').select('status').eq('id', completedRec.id).single();
      report(`Completed status remains immutable after ${targetStatus} attempt`, checkRow?.status === 'completed', `status=${checkRow?.status}`);
    }
  } finally {
    await supabaseAdmin.from('meeting_recordings').delete().eq('id', completedRec.id);
  }

  // Cancelled Terminal State Test
  const { data: cancelledRec } = await supabaseAdmin.from('meeting_recordings').insert({
    meeting_id: meeting.id,
    organization_id: meeting.organization_id,
    workspace_id: meeting.workspace_id,
    started_by: meeting.host_id,
    status: 'queued',
  }).select().single();

  await supabaseAdmin.from('meeting_recordings').update({ status: 'cancelled' }).eq('id', cancelledRec.id);

  try {
    for (const targetStatus of ['queued', 'starting', 'active', 'stopping', 'completed', 'failed']) {
      const { error: err } = await supabaseAdmin.from('meeting_recordings').update({ status: targetStatus }).eq('id', cancelledRec.id);
      report(`Terminal cancelled -> ${targetStatus} rejected`, Boolean(err), err?.message ?? 'Update unexpectedly succeeded');

      const { data: checkRow } = await supabaseAdmin.from('meeting_recordings').select('status').eq('id', cancelledRec.id).single();
      report(`Cancelled status remains immutable after ${targetStatus} attempt`, checkRow?.status === 'cancelled', `status=${checkRow?.status}`);
    }
  } finally {
    await supabaseAdmin.from('meeting_recordings').delete().eq('id', cancelledRec.id);
  }

  // --- SECTION 3: PARTIAL UNIQUE INDEX CONCURRENCY INVARIANT ---
  console.log('\n--- 3. Testing Partial Unique Index (idx_one_active_recording_per_meeting) ---');

  const { data: recA } = await supabaseAdmin.from('meeting_recordings').insert({
    meeting_id: meeting.id,
    organization_id: meeting.organization_id,
    workspace_id: meeting.workspace_id,
    started_by: meeting.host_id,
    status: 'starting',
  }).select().single();

  report('Inserted Recording A with status starting', Boolean(recA?.id));

  try {
    // Attempt inserting Recording B with status starting for SAME meeting -> MUST FAIL
    const { data: recB, error: errConcB1 } = await supabaseAdmin.from('meeting_recordings').insert({
      meeting_id: meeting.id,
      organization_id: meeting.organization_id,
      workspace_id: meeting.workspace_id,
      started_by: meeting.host_id,
      status: 'starting',
    }).select().single();

    report('Concurrent Recording B starting rejected by partial unique index', Boolean(errConcB1) && !recB, errConcB1?.message ?? '');

    // Transition Recording A to active
    await supabaseAdmin.from('meeting_recordings').update({ status: 'active' }).eq('id', recA.id);

    // Attempt inserting Recording B with status active for SAME meeting -> MUST FAIL
    const { data: recB2, error: errConcB2 } = await supabaseAdmin.from('meeting_recordings').insert({
      meeting_id: meeting.id,
      organization_id: meeting.organization_id,
      workspace_id: meeting.workspace_id,
      started_by: meeting.host_id,
      status: 'active',
    }).select().single();

    report('Concurrent Recording B active rejected by partial unique index', Boolean(errConcB2) && !recB2, errConcB2?.message ?? '');

    // Transition Recording A to stopping
    await supabaseAdmin.from('meeting_recordings').update({ status: 'stopping' }).eq('id', recA.id);

    // Attempt inserting Recording B with status starting for SAME meeting -> MUST FAIL
    const { data: recB3, error: errConcB3 } = await supabaseAdmin.from('meeting_recordings').insert({
      meeting_id: meeting.id,
      organization_id: meeting.organization_id,
      workspace_id: meeting.workspace_id,
      started_by: meeting.host_id,
      status: 'starting',
    }).select().single();

    report('Concurrent Recording B starting while A stopping rejected', Boolean(errConcB3) && !recB3, errConcB3?.message ?? '');

    // Transition Recording A to completed
    await supabaseAdmin.from('meeting_recordings').update({ status: 'completed' }).eq('id', recA.id);

    // Now Recording B starting for SAME meeting MUST SUCCEED
    const { data: recB4, error: errConcB4 } = await supabaseAdmin.from('meeting_recordings').insert({
      meeting_id: meeting.id,
      organization_id: meeting.organization_id,
      workspace_id: meeting.workspace_id,
      started_by: meeting.host_id,
      status: 'starting',
    }).select().single();

    report('New Recording B starting permitted after Recording A completes', !errConcB4 && Boolean(recB4?.id), errConcB4?.message ?? '');

    if (recB4?.id) {
      await supabaseAdmin.from('meeting_recordings').delete().eq('id', recB4.id);
    }
  } finally {
    if (recA?.id) {
      await supabaseAdmin.from('meeting_recordings').delete().eq('id', recA.id);
    }
  }

  console.log('\n=== RECORDING STATE MACHINE & CONCURRENCY VERIFICATION COMPLETE ===\n');
}

run().catch((err) => {
  console.error('State machine verification execution error:', err);
  process.exit(1);
});
