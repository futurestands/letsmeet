import crypto from 'crypto';
import jwt from 'jsonwebtoken';
import dotenv from 'dotenv';
dotenv.config({ path: '.env.staging.local' });
process.env.NO_SERVER_LISTEN = '1';

import { createClient } from '@supabase/supabase-js';
import { app, redis } from '../server/livekit-token.mjs';

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

import * as jose from 'jose';

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

      // Signature verification succeeded! (200 OK if completed, or 502 if storage object verification failed because S3 bucket is unconfigured)
      report('3. Valid HMAC-signed webhook signature accepted by WebhookReceiver HTTP route', [200, 502].includes(resValidSigned.status), `status=${resValidSigned.status}`);

    } finally {
      if (testRec?.id) {
        await supabaseAdmin.from('meeting_recordings').delete().eq('id', testRec.id);
      }
      if (isoMeeting?.id) {
        await supabaseAdmin.from('meetings').delete().eq('id', isoMeeting.id);
      }
    }

    // 4. Test Terminal Monotonicity directly on database row:
    const { data: completedRec } = await supabaseAdmin.from('meeting_recordings').insert({
      meeting_id: baseMeeting.id,
      organization_id: baseMeeting.organization_id,
      workspace_id: baseMeeting.workspace_id,
      started_by: baseMeeting.host_id,
      status: 'queued',
      egress_id: `EG_TERM_${Date.now()}`,
      storage_key: 'term-key.mp4',
    }).select().single();

    await supabaseAdmin.from('meeting_recordings').update({ status: 'starting' }).eq('id', completedRec.id);
    await supabaseAdmin.from('meeting_recordings').update({ status: 'active' }).eq('id', completedRec.id);
    await supabaseAdmin.from('meeting_recordings').update({ status: 'stopping' }).eq('id', completedRec.id);
    await supabaseAdmin.from('meeting_recordings').update({ status: 'completed' }).eq('id', completedRec.id);

    try {
      // Attempt late update to FAILED on COMPLETED recording in DB
      const { error: errFailed } = await supabaseAdmin.from('meeting_recordings').update({ status: 'failed', error: 'Late egress error' }).eq('id', completedRec.id);
      report('4. Late status change completed -> failed rejected by DB trigger', Boolean(errFailed), errFailed?.message ?? '');

      const { data: checkRow } = await supabaseAdmin.from('meeting_recordings').select('status').eq('id', completedRec.id).single();
      report('   Completed status remains immutable on DB row', checkRow?.status === 'completed', `status=${checkRow?.status}`);

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
