import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging.local' });
process.env.NO_SERVER_LISTEN = '1';

import { createClient } from '@supabase/supabase-js';
import { app, redis } from '../server/livekit-token.mjs';

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
  console.log('=== VERIFYING LIVEKIT WEBHOOK ENDPOINT & TERMINAL MONOTONICITY ===\n');

  const server = app.listen(0);
  const port = server.address().port;
  const apiBase = `http://localhost:${port}/api`;

  try {
    // 1. Unauthenticated / unsigned webhook request
    const resUnauth = await fetch(`${apiBase}/livekit/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'egress_ended' }),
    });
    report('Unsigned webhook request rejected with 401', resUnauth.status === 401, `status=${resUnauth.status}`);

    // 2. Test Terminal Monotonicity directly on database row:
    const { data: meeting } = await supabaseAdmin.from('meetings').select('id, organization_id, workspace_id, host_id').limit(1).single();
    const egressId = `EG_TEST_${Date.now()}`;

    const { data: completedRec } = await supabaseAdmin.from('meeting_recordings').insert({
      meeting_id: meeting.id,
      organization_id: meeting.organization_id,
      workspace_id: meeting.workspace_id,
      started_by: meeting.host_id,
      status: 'queued',
      egress_id: egressId,
      storage_key: 'test-key.mp4',
    }).select().single();

    await supabaseAdmin.from('meeting_recordings').update({ status: 'starting' }).eq('id', completedRec.id);
    await supabaseAdmin.from('meeting_recordings').update({ status: 'active' }).eq('id', completedRec.id);
    await supabaseAdmin.from('meeting_recordings').update({ status: 'stopping' }).eq('id', completedRec.id);
    await supabaseAdmin.from('meeting_recordings').update({ status: 'completed' }).eq('id', completedRec.id);

    try {
      // Attempt late update to FAILED on COMPLETED recording in DB
      const { error: errFailed } = await supabaseAdmin.from('meeting_recordings').update({ status: 'failed', error: 'Late egress error' }).eq('id', completedRec.id);
      report('Late status change completed -> failed rejected by DB trigger', Boolean(errFailed), errFailed?.message ?? '');

      const { data: checkRow } = await supabaseAdmin.from('meeting_recordings').select('status').eq('id', completedRec.id).single();
      report('Completed status remains immutable on DB row', checkRow?.status === 'completed', `status=${checkRow?.status}`);

    } finally {
      if (completedRec?.id) {
        await supabaseAdmin.from('meeting_recordings').delete().eq('id', completedRec.id);
      }
    }
  } finally {
    server.close();
    if (redis) redis.disconnect();
    process.exit(process.exitCode || 0);
  }
}

run().catch((err) => {
  console.error('Webhook test execution error:', err);
  process.exit(1);
});
