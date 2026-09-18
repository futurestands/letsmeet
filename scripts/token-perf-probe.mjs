/**
 * Staging token API concurrency probe with Server-Timing capture.
 * Does not print secrets. Uses staging env only.
 */
import { createClient } from '@supabase/supabase-js';
import { performance } from 'node:perf_hooks';

const url = process.env.VITE_SUPABASE_URL;
if (!url?.includes('uasslvisjnwhdhcgqwyc')) {
  throw new Error('Refusing to run: VITE_SUPABASE_URL is not staging.');
}
if (url.includes('wvmmofornwivfsjeqmda')) {
  throw new Error('Refusing to run: production Supabase detected.');
}

const endpoint = process.env.VITE_LIVEKIT_TOKEN_ENDPOINT;
const client = createClient(url, process.env.VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

const { data: auth, error } = await client.auth.signInWithPassword({
  email: process.env.STAGING_TEST_HOST_EMAIL,
  password: process.env.STAGING_TEST_HOST_PASSWORD,
});
if (error) throw error;

const { data: meeting, error: meetErr } = await client.rpc('create_persistent_meeting', {
  p_title: 'Token perf after-opt',
});
if (meetErr) throw meetErr;

const room = meeting.code;
const accessToken = auth.session.access_token;

function pct(sorted, p) {
  if (!sorted.length) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
}

function parseServerTiming(header) {
  if (!header) return {};
  const out = {};
  for (const part of String(header).split(',')) {
    const match = part.trim().match(/^([^;]+);dur=([0-9.]+)/);
    if (match) out[match[1]] = Number(match[2]);
  }
  return out;
}

async function once() {
  const t0 = performance.now();
  try {
    const res = await fetch(`${endpoint}?room=${encodeURIComponent(room)}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
    });
    const serverTiming = parseServerTiming(res.headers.get('server-timing'));
    return {
      status: res.status,
      ms: performance.now() - t0,
      ok: res.ok,
      serverTiming,
    };
  } catch (err) {
    return {
      status: 'error',
      ms: performance.now() - t0,
      ok: false,
      err: String(err?.message || err),
    };
  }
}

async function stage(n) {
  const results = await Promise.all(Array.from({ length: n }, () => once()));
  const lat = results.map((r) => r.ms).sort((a, b) => a - b);
  const statuses = {};
  for (const r of results) statuses[r.status] = (statuses[r.status] || 0) + 1;
  const okRows = results.filter((r) => r.ok);
  const phaseKeys = ['auth', 'meeting', 'auth_meeting_wall', 'participant', 'livekit', 'total'];
  const phases = {};
  for (const key of phaseKeys) {
    const values = okRows.map((r) => r.serverTiming?.[key]).filter((v) => typeof v === 'number').sort((a, b) => a - b);
    if (values.length) {
      phases[key] = { p50: pct(values, 50), p95: pct(values, 95), n: values.length };
    }
  }
  return {
    n,
    ok: okRows.length,
    rate: Number(((okRows.length / n) * 100).toFixed(1)),
    p50: pct(lat, 50),
    p95: pct(lat, 95),
    p99: pct(lat, 99),
    max: Math.round(lat[lat.length - 1] || 0),
    statuses,
    phases,
  };
}

const healthBase = endpoint.replace(/\/api\/livekit\/token$/, '');
const health = await fetch(`${healthBase}/health`);
console.log(JSON.stringify({ health: health.status, room, staging: true }));

const serial = [];
for (let i = 0; i < 5; i += 1) serial.push(await once());
const serialLat = serial.map((r) => r.ms).sort((a, b) => a - b);
console.log(JSON.stringify({
  warmSerial: {
    success: serial.filter((r) => r.ok).length,
    p50: pct(serialLat, 50),
    p95: pct(serialLat, 95),
    statuses: serial.reduce((acc, r) => {
      acc[r.status] = (acc[r.status] || 0) + 1;
      return acc;
    }, {}),
    sampleTiming: serial.find((r) => r.ok)?.serverTiming ?? null,
  },
}));

const stages = [];
for (const n of [1, 5, 10, 20, 25, 50, 100]) {
  console.log(`reset wait before ${n}`);
  await new Promise((r) => setTimeout(r, 61000));
  const row = await stage(n);
  stages.push(row);
  console.log(JSON.stringify(row));
}

console.log(JSON.stringify({ concurrentSameUser: stages }, null, 2));
