import crypto from 'crypto';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging.local' });
process.env.NO_SERVER_LISTEN = '1';

import { createClient } from '@supabase/supabase-js';
import { app, redis } from '../server/livekit-token.mjs';
import * as jose from 'jose';

process.env.LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
process.env.LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secretkey';

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const apiKey = process.env.LIVEKIT_API_KEY;
const apiSecret = process.env.LIVEKIT_API_SECRET;

if (!supabaseUrl || !supabaseServiceKey) {
  console.error('Missing staging configuration');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function report(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` (${extra})` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function signWebhookPayload(rawBody, apiKey, apiSecret) {
  const sha256 = crypto.createHash('sha256').update(rawBody).digest('base64');
  const secret = new TextEncoder().encode(apiSecret);
  return await new jose.SignJWT({ sha256 })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer(apiKey)
    .sign(secret);
}

async function run() {
  console.log('=== VERIFYING LIVEKIT WEBHOOK ENDPOINT & TERMINAL MONOTONICITY ===\n');

  const server = app.listen(0);
  const port = server.address().port;
  const apiBase = `http://localhost:${port}/api`;

  try {
    // 1. Unauthenticated / unsigned webhook request -> MUST RETURN 401
    const resUnauth = await fetch(`${apiBase}/livekit/webhook`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ event: 'egress_ended' }),
    });
    report('1. Unsigned webhook request rejected with 401', resUnauth.status === 401, `status=${resUnauth.status}`);

    // 2. Invalid Signature Webhook Request -> MUST RETURN 401
    const resInvalidSig = await fetch(`${apiBase}/livekit/webhook`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: 'Bearer invalid-token-signature',
      },
      body: JSON.stringify({ event: 'egress_ended' }),
    });
    report('2. Invalid signature webhook request rejected with 401', resInvalidSig.status === 401, `status=${resInvalidSig.status}`);

    // 3. Valid Signed Webhook Request targeting an active recording
    const { data: baseMeeting } = await supabaseAdmin.from('meetings').select('id, organization_id, workspace_id, host_id').limit(1).single();

    const { data: isoMeeting } = await supabaseAdmin.from('meetings').insert({
      code: `LM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      title: 'Webhook Signed Meeting',
      host_id: baseMeeting.host_id,
      organization_id: baseMeeting.organization_id,
      workspace_id: baseMeeting.workspace_id,
      status: 'live',
    }).select().single();

    const egressId = `EG_TEST_${Date.now()}`;

    const { data: testRec } = await supabaseAdmin.from('meeting_recordings').insert({
      meeting_id: isoMeeting.id,
      organization_id: isoMeeting.organization_id,
      workspace_id: isoMeeting.workspace_id,
      started_by: isoMeeting.host_id,
      status: 'queued',
      egress_id: egressId,
      storage_key: 'test-signed-key.mp4',
    }).select().single();

    await supabaseAdmin.from('meeting_recordings').update({ status: 'starting' }).eq('id', testRec.id);
    await supabaseAdmin.from('meeting_recordings').update({ status: 'active' }).eq('id', testRec.id);

    try {
      const webhookPayload = JSON.stringify({
        event: 'egress_ended',
        egressInfo: {
          egressId,
          status: 3, // EGRESS_COMPLETE
          fileResults: [{ filename: 'test-signed-key.mp4', location: 'https://storage.staging/test.mp4' }],
        },
      });

      const validToken = await signWebhookPayload(webhookPayload, apiKey, apiSecret);

      const resValidSigned = await fetch(`${apiBase}/livekit/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${validToken}`,
        },
        body: webhookPayload,
      });

      report('3. Valid HMAC-signed webhook signature accepted by WebhookReceiver HTTP route', [200, 502].includes(resValidSigned.status), `status=${resValidSigned.status}`);

    } finally {
      if (testRec?.id) {
        await supabaseAdmin.from('meeting_recordings').delete().eq('id', testRec.id);
      }
      if (isoMeeting?.id) {
        await supabaseAdmin.from('meetings').delete().eq('id', isoMeeting.id);
      }
    }

    // 4. Test Late EGRESS_FAILED webhook POSTed at COMPLETED recording over HTTP route
    const { data: isoMeeting2 } = await supabaseAdmin.from('meetings').insert({
      code: `LM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
      title: 'Webhook Terminal Iso Meeting',
      host_id: baseMeeting.host_id,
      organization_id: baseMeeting.organization_id,
      workspace_id: baseMeeting.workspace_id,
      status: 'live',
    }).select().single();

    const egressIdCompleted = `EG_COMP_${Date.now()}`;
    const { data: recCompleted } = await supabaseAdmin.from('meeting_recordings').insert({
      meeting_id: isoMeeting2.id,
      organization_id: isoMeeting2.organization_id,
      workspace_id: isoMeeting2.workspace_id,
      started_by: isoMeeting2.host_id,
      status: 'queued',
      egress_id: egressIdCompleted,
      storage_key: 'completed-key.mp4',
    }).select().single();

    const { error: e1 } = await supabaseAdmin.from('meeting_recordings').update({ status: 'starting' }).eq('id', recCompleted.id);
    if (e1) throw new Error(`Failed to transition to starting: ${e1.message}`);

    const { error: e2 } = await supabaseAdmin.from('meeting_recordings').update({ status: 'active' }).eq('id', recCompleted.id);
    if (e2) throw new Error(`Failed to transition to active: ${e2.message}`);

    const { error: e3 } = await supabaseAdmin.from('meeting_recordings').update({ status: 'stopping' }).eq('id', recCompleted.id);
    if (e3) throw new Error(`Failed to transition to stopping: ${e3.message}`);

    const { error: e4 } = await supabaseAdmin.from('meeting_recordings').update({ status: 'completed' }).eq('id', recCompleted.id);
    if (e4) throw new Error(`Failed to transition to completed: ${e4.message}`);

    try {
      const lateFailedPayload = JSON.stringify({
        event: 'egress_ended',
        egressInfo: {
          egressId: egressIdCompleted,
          status: 4, // EGRESS_FAILED
          error: 'Late failure event',
        },
      });

      const lateToken = await signWebhookPayload(lateFailedPayload, apiKey, apiSecret);

      const resLateWebhook = await fetch(`${apiBase}/livekit/webhook`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${lateToken}`,
        },
        body: lateFailedPayload,
      });

      report('4. Late EGRESS_FAILED webhook on COMPLETED recording handled safely by HTTP route', [200, 409].includes(resLateWebhook.status), `status=${resLateWebhook.status}`);

      const { data: checkRowAfterWebhook } = await supabaseAdmin.from('meeting_recordings').select('status').eq('id', recCompleted.id).single();
      report('   Recording status remains completed in database', checkRowAfterWebhook?.status === 'completed', `status=${checkRowAfterWebhook?.status}`);

    } finally {
      if (recCompleted?.id) {
        await supabaseAdmin.from('meeting_recordings').delete().eq('id', recCompleted.id);
      }
      if (isoMeeting2?.id) {
        await supabaseAdmin.from('meetings').delete().eq('id', isoMeeting2.id);
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
