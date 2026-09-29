import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { performance } from 'node:perf_hooks';

dotenv.config({ path: '.env.staging.local' });

const url = process.env.VITE_SUPABASE_URL;
if (!url?.includes('uasslvisjnwhdhcgqwyc')) {
  throw new Error('Refusing to run: VITE_SUPABASE_URL is not staging.');
}

const endpoint = process.env.VITE_LIVEKIT_TOKEN_ENDPOINT;
const client = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const supabaseAdmin = createClient(url, process.env.SUPABASE_SERVICE_ROLE_KEY);

const { data: auth, error } = await client.auth.signInWithPassword({
  email: process.env.STAGING_TEST_HOST_EMAIL,
  password: process.env.STAGING_TEST_HOST_PASSWORD,
});
if (error) throw error;

const { data: meeting, error: meetErr } = await client.rpc('create_persistent_meeting', {
  p_title: 'Fast Token Perf Probe',
});
if (meetErr) throw meetErr;

const room = meeting.code;
const accessToken = auth.session.access_token;

function pct(sorted, p) {
  if (!sorted.length) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
}

async function once() {
  const t0 = performance.now();
  try {
    const res = await fetch(`${endpoint}?room=${encodeURIComponent(room)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    return {
      status: res.status,
      ms: performance.now() - t0,
      ok: res.ok,
    };
  } catch (err) {
    return {
      status: 'error',
      ms: performance.now() - t0,
      ok: false,
    };
  }
}

async function stage(n) {
  const results = await Promise.all(Array.from({ length: n }, () => once()));
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const statuses = {};
  for (const r of results) statuses[r.status] = (statuses[r.status] || 0) + 1;
  const okRows = results.filter((r) => r.ok);

  return {
    n,
    ok: okRows.length,
    rate: Number(((okRows.length / n) * 100).toFixed(1)),
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    p99: pct(lat, 99),
    max: Math.round(lat[lat.length - 1] || 0),
    statuses,
  };
}

console.log('=== LIVEKIT TOKEN ENDPOINT CONCURRENCY BENCHMARK ===\n');

for (const n of [1, 10, 25, 50]) {
  const row = await stage(n);
  console.log(`Concurrency N=${row.n}: ${row.ok}/${row.n} OK (${row.rate}%), p50=${row.p50}ms, p95=${row.p95}ms, p99=${row.p99}ms, max=${row.max}ms | statuses: ${JSON.stringify(row.statuses)}`);
}

await supabaseAdmin.from('meetings').delete().eq('id', meeting.id);
