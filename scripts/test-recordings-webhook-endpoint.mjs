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

    // ---- Helpers: isolated meeting + recording walked to target status ----
    const { data: baseMeeting } = await supabaseAdmin.from('meetings').select('id, organization_id, workspace_id, host_id').limit(1).single();
    const cleanup = [];
    const PATHS = {
      active: ['starting', 'active'],
      stopping: ['starting', 'active', 'stopping'],
      completed: ['starting', 'active', 'stopping', 'completed'],
      failed: ['starting', 'failed'],
      cancelled: ['cancelled'],
    };

    async function makeRecording(target) {
      const { data: m } = await supabaseAdmin.from('meetings').insert({
        code: `LM-${Math.random().toString(36).substring(2, 8).toUpperCase()}`,
        title: `Webhook ${target}`,
        host_id: baseMeeting.host_id,
        organization_id: baseMeeting.organization_id,
        workspace_id: baseMeeting.workspace_id,
        status: 'live',
      }).select().single();

      const egressId = `EG_${target}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
      const { data: rec } = await supabaseAdmin.from('meeting_recordings').insert({
        meeting_id: m.id,
        organization_id: m.organization_id,
        workspace_id: m.workspace_id,
        started_by: m.host_id,
        status: 'queued',
        egress_id: egressId,
        storage_key: `${egressId}.mp4`,
      }).select().single();

      cleanup.push({ rec, m });
      for (const step of PATHS[target]) {
        const { error } = await supabaseAdmin.from('meeting_recordings').update({ status: step }).eq('id', rec.id);
        if (error) throw new Error(`setup ${target}: ${step} rejected: ${error.message}`);
      }
      return { rec, egressId };
    }

    async function postWebhook(egressId, status, extra = {}) {
      const payload = JSON.stringify({
        event: 'egress_ended',
        egressInfo: { egressId, status, ...extra },
      });
      const token = await signWebhookPayload(payload, apiKey, apiSecret);
      const res = await fetch(`${apiBase}/livekit/webhook`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: payload,
      });
      return res.status;
    }

    async function rowStatus(id) {
      const { data } = await supabaseAdmin.from('meeting_recordings').select('status').eq('id', id).single();
      return data?.status;
    }

    const COMPLETE = 3;
    const FAILED = 4;

    try {
      // 3. active + signed EGRESS_COMPLETE -> row becomes completed (or 502/failed if storage unconfigured)
      {
        const { rec, egressId } = await makeRecording('active');
        const code = await postWebhook(egressId, COMPLETE, { fileResults: [{ filename: `${egressId}.mp4`, location: 'https://storage.staging/test.mp4' }] });
        const st = await rowStatus(rec.id);
        const ok = (code === 200 && st === 'completed') || (code === 502 && st === 'failed');
        report('3. Signed EGRESS_COMPLETE on ACTIVE recording: HTTP result matches persisted row', ok, `http=${code} row=${st}`);
      }

      // A. duplicate COMPLETED
      {
        const { rec, egressId } = await makeRecording('completed');
        const code = await postWebhook(egressId, COMPLETE);
        const st = await rowStatus(rec.id);
        report('A. Duplicate EGRESS_COMPLETE on COMPLETED is idempotent 200, row stays completed', code === 200 && st === 'completed', `http=${code} row=${st}`);
      }

      // B. duplicate FAILED
      {
        const { rec, egressId } = await makeRecording('failed');
        const code = await postWebhook(egressId, FAILED, { error: 'dup failure' });
        const st = await rowStatus(rec.id);
        report('B. Duplicate EGRESS_FAILED on FAILED returns 200, row stays failed', code === 200 && st === 'failed', `http=${code} row=${st}`);
      }

      // C. COMPLETED -> late FAILED
      {
        const { rec, egressId } = await makeRecording('completed');
        const code = await postWebhook(egressId, FAILED, { error: 'Late failure event' });
        const st = await rowStatus(rec.id);
        report('C. Late EGRESS_FAILED on COMPLETED rejected/ignored, row stays completed', [200, 409].includes(code) && st === 'completed', `http=${code} row=${st}`);
      }

      // D. FAILED -> late COMPLETED
      {
        const { rec, egressId } = await makeRecording('failed');
        const code = await postWebhook(egressId, COMPLETE, { fileResults: [{ filename: `${egressId}.mp4`, location: 'https://storage.staging/late.mp4' }] });
        const st = await rowStatus(rec.id);
        report('D. Late EGRESS_COMPLETE on FAILED does not resurrect row and is not reported as success', st === 'failed' && [409, 502].includes(code), `http=${code} row=${st}`);
      }

      // E. CANCELLED -> late COMPLETED
      {
        const { rec, egressId } = await makeRecording('cancelled');
        const code = await postWebhook(egressId, COMPLETE);
        const st = await rowStatus(rec.id);
        report('E. Late EGRESS_COMPLETE on CANCELLED is idempotent 200, row stays cancelled', code === 200 && st === 'cancelled', `http=${code} row=${st}`);
      }

      // F. STOPPING -> FAILED
      {
        const { rec, egressId } = await makeRecording('stopping');
        const code = await postWebhook(egressId, FAILED, { error: 'egress failed while stopping' });
        const st = await rowStatus(rec.id);
        report('F. EGRESS_FAILED on STOPPING transitions row to failed', code === 200 && st === 'failed', `http=${code} row=${st}`);
      }

    } finally {
      for (const { rec, m } of cleanup) {
        if (rec?.id) await supabaseAdmin.from('meeting_recordings').delete().eq('id', rec.id).catch(() => undefined);
        if (m?.id) await supabaseAdmin.from('meetings').delete().eq('id', m.id).catch(() => undefined);
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
