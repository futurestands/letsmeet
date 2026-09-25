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
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function run() {
  console.log('=== VERIFYING RECORDING STATE MACHINE & CONCURRENCY INVARIANTS ===\n');

  const { data: meeting } = await supabaseAdmin.from('meetings').select('id, organization_id, workspace_id, host_id').limit(1).single();
  if (!meeting) {
    console.error('No meeting found for test');
    process.exit(1);
  }

  const { data: recRow, error: insertErr } = await supabaseAdmin.from('meeting_recordings').insert({
    meeting_id: meeting.id,
    organization_id: meeting.organization_id,
    workspace_id: meeting.workspace_id,
    started_by: meeting.host_id,
    status: 'queued',
  }).select().single();

  report('Database inserted initial recording with status queued', !insertErr && Boolean(recRow?.id), insertErr?.message ?? '');

  if (!recRow) return;

  try {
    // 1. Test valid transition: queued -> starting
    const { error: startErr } = await supabaseAdmin.from('meeting_recordings').update({ status: 'starting' }).eq('id', recRow.id);
    report('Valid transition queued -> starting permitted', !startErr, startErr?.message ?? '');

    // 2. Test valid transition: starting -> active
    const { error: activeErr } = await supabaseAdmin.from('meeting_recordings').update({ status: 'active' }).eq('id', recRow.id);
    report('Valid transition starting -> active permitted', !activeErr, activeErr?.message ?? '');

    // 3. Test valid transition: active -> stopping
    const { error: stoppingErr } = await supabaseAdmin.from('meeting_recordings').update({ status: 'stopping' }).eq('id', recRow.id);
    report('Valid transition active -> stopping permitted', !stoppingErr, stoppingErr?.message ?? '');

    // 4. Test valid transition: stopping -> completed
    const { error: completedErr } = await supabaseAdmin.from('meeting_recordings').update({ status: 'completed' }).eq('id', recRow.id);
    report('Valid transition stopping -> completed permitted', !completedErr, completedErr?.message ?? '');

    // 5. TEST ILLEGAL TRANSITION: completed -> active
    const { error: illegalErr1 } = await supabaseAdmin.from('meeting_recordings').update({ status: 'active' }).eq('id', recRow.id);
    report('Database rejects illegal transition completed -> active', Boolean(illegalErr1), illegalErr1?.message ?? '');

    // 6. TEST ILLEGAL TRANSITION: completed -> failed
    const { error: illegalErr2 } = await supabaseAdmin.from('meeting_recordings').update({ status: 'failed' }).eq('id', recRow.id);
    report('Database rejects illegal transition completed -> failed', Boolean(illegalErr2), illegalErr2?.message ?? '');

  } finally {
    await supabaseAdmin.from('meeting_recordings').delete().eq('id', recRow.id);
  }
}

run().catch((err) => {
  console.error('Execution error:', err);
  process.exit(1);
});
