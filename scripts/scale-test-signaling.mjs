import { performance } from 'node:perf_hooks';

/**
 * Signaling scale test for LeTsMeet.
 *
 * Objectives:
 * 1. Measure Token API throughput.
 * 2. Measure database RTT under concurrency.
 * 3. Verify Redis rate limiter behavior across many users.
 */

const ENDPOINT = process.env.TOKEN_API_URL || 'http://127.0.0.1:3001/api/livekit/token';
const ACCESS_TOKEN = process.env.LOAD_TEST_ACCESS_TOKEN;
const ROOM = process.env.LOAD_TEST_ROOM || 'LM-SCALE01';

async function singleRequest(id) {
  const start = performance.now();
  try {
    const headers = { Accept: 'application/json' };
    if (ACCESS_TOKEN) headers.Authorization = `Bearer ${ACCESS_TOKEN}`;

    const res = await fetch(`${ENDPOINT}?room=${ROOM}&identity=user-${id}`, { headers });
    const body = await res.json();

    return {
      status: res.status,
      latency: performance.now() - start,
      ok: res.ok,
      error: body.error
    };
  } catch (err) {
    return {
      status: 'error',
      latency: performance.now() - start,
      ok: false,
      error: err.message
    };
  }
}

async function runStage(count) {
  console.log(`\n--- Stage: ${count} concurrent users ---`);
  const start = performance.now();
  const results = await Promise.all(Array.from({ length: count }, (_, i) => singleRequest(i)));
  const totalDuration = performance.now() - start;

  const successes = results.filter(r => r.ok);
  const rateLimited = results.filter(r => r.status === 429);
  const unauthorized = results.filter(r => r.status === 401);
  const errors = results.filter(r => r.status === 500 || r.status === 'error');

  const latencies = results.map(r => r.latency).sort((a, b) => a - b);
  const p50 = latencies[Math.floor(latencies.length * 0.5)];
  const p95 = latencies[Math.floor(latencies.length * 0.95)];

  console.log(`Total duration: ${Math.round(totalDuration)}ms`);
  console.log(`Success: ${successes.length} (${Math.round(successes.length/count*100)}%)`);
  console.log(`Rate Limited: ${rateLimited.length}`);
  console.log(`Unauthorized: ${unauthorized.length}`);
  console.log(`Errors: ${errors.length}`);
  console.log(`Latency: p50=${Math.round(p50)}ms, p95=${Math.round(p95)}ms`);

  if (errors.length > 0) {
    console.log('Sample Error:', errors[0].error);
  }
}

async function main() {
  if (!ACCESS_TOKEN) {
    console.warn('WARNING: No LOAD_TEST_ACCESS_TOKEN provided. Expecting 401s unless testing anon limits.');
  }

  await runStage(10);
  await runStage(50);
  await runStage(100);
  // await runStage(250); // Be careful with env limits
}

main().catch(console.error);
