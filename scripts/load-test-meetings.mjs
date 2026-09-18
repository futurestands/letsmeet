import { performance } from 'node:perf_hooks';

const endpoint = process.env.LOAD_TEST_TOKEN_ENDPOINT || 'http://127.0.0.1:3001/api/livekit/token';
const stages = (process.env.LOAD_TEST_STAGES || '10,25,50,100,250')
  .split(',')
  .map((value) => Number(value.trim()))
  .filter((value) => value > 0);
const room = process.env.LOAD_TEST_ROOM || 'LM-LOAD12';
const authorization = process.env.LOAD_TEST_ACCESS_TOKEN || '';

function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = Math.min(sorted.length - 1, Math.max(0, Math.ceil((p / 100) * sorted.length) - 1));
  return Math.round(sorted[index]);
}

async function timedRequest() {
  const started = performance.now();
  try {
    const headers = { Accept: 'application/json' };
    if (authorization) headers.Authorization = `Bearer ${authorization}`;
    const response = await fetch(`${endpoint}?room=${encodeURIComponent(room)}`, { headers });
    return {
      ok: response.ok,
      status: String(response.status),
      latencyMs: performance.now() - started,
    };
  } catch {
    return {
      ok: false,
      status: 'error',
      latencyMs: performance.now() - started,
    };
  }
}

async function runStage(concurrency) {
  const results = await Promise.all(Array.from({ length: concurrency }, () => timedRequest()));
  const latencies = results.map((row) => row.latencyMs).sort((a, b) => a - b);
  const statuses = results.reduce((acc, row) => {
    acc[row.status] = (acc[row.status] ?? 0) + 1;
    return acc;
  }, {});
  const successes = results.filter((row) => row.ok).length;
  return {
    concurrency,
    requests: results.length,
    successRate: Number(((successes / results.length) * 100).toFixed(1)),
    failureRate: Number((((results.length - successes) / results.length) * 100).toFixed(1)),
    p50: percentile(latencies, 50),
    p95: percentile(latencies, 95),
    p99: percentile(latencies, 99),
    maxMs: Math.round(latencies[latencies.length - 1] ?? 0),
    statuses,
  };
}

console.log('LeTsMeet token API load probe');
console.log('This is not a 500-participant LiveKit media soak. It measures token endpoint concurrency only.');
console.log(`Endpoint: ${endpoint}`);
console.log(`Auth: ${authorization ? 'Bearer token provided' : 'unauthenticated (expect 401)'}`);

const rows = [];
for (const stage of stages) {
  const row = await runStage(stage);
  rows.push(row);
  console.log(
    `${stage} concurrent: success=${row.successRate}% fail=${row.failureRate}% `
    + `p50=${row.p50}ms p95=${row.p95}ms p99=${row.p99}ms max=${row.maxMs}ms `
    + `statuses=${JSON.stringify(row.statuses)}`,
  );
}

console.log(JSON.stringify({ summary: rows }, null, 2));
console.log('LiveKit media scale still requires SFU instrumentation, TURN validation, and progressive room soaks.');
console.log('Do not claim 500 participants are supported until media-connected stages pass.');
