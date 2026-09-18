import { performance } from 'node:perf_hooks';

const endpoint = process.env.LOAD_TEST_TOKEN_ENDPOINT || 'http://127.0.0.1:3001/api/livekit/token';
const stages = (process.env.LOAD_TEST_STAGES || '10,25,50').split(',').map((value) => Number(value.trim())).filter((value) => value > 0);
const room = process.env.LOAD_TEST_ROOM || 'LM-LOAD12';

async function runStage(concurrency) {
  const started = performance.now();
  const results = await Promise.allSettled(Array.from({ length: concurrency }, () => fetch(`${endpoint}?room=${room}`)));
  const elapsed = performance.now() - started;
  const statuses = await Promise.all(results.map(async (result) => {
    if (result.status !== 'fulfilled') return 'error';
    return String(result.value.status);
  }));
  const counts = statuses.reduce((acc, status) => {
    acc[status] = (acc[status] ?? 0) + 1;
    return acc;
  }, {});
  return { concurrency, elapsedMs: Math.round(elapsed), statuses: counts };
}

console.log('LeTsMeet load probe');
console.log('This is not a 500-participant LiveKit soak test. It measures token API behavior only.');
console.log(`Endpoint: ${endpoint}`);

const rows = [];
for (const stage of stages) {
  const row = await runStage(stage);
  rows.push(row);
  console.log(`${stage} concurrent token requests: ${row.elapsedMs}ms ${JSON.stringify(row.statuses)}`);
}

console.log('Join latency, CPU, rendering, and media quality still require instrumented LiveKit rooms.');
console.log('Do not claim 500 participants are supported until those stages pass with media connected.');
