import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const port = 3019;
const results = [];

function assert(name, ok, detail = '') {
  results.push({ name, passed: Boolean(ok), detail });
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` (${detail})` : ''}`);
}

const child = spawn(process.execPath, [path.join(root, 'server', 'livekit-token.mjs')], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    LIVEKIT_API_KEY: 'devkey',
    LIVEKIT_API_SECRET: 'devsecret-devsecret-devsecret',
    ALLOWED_ORIGINS: 'http://localhost:5173',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('LiveKit token server did not start')), 8000);
  child.stdout.on('data', (chunk) => {
    if (String(chunk).includes('listening')) {
      clearTimeout(timer);
      resolve();
    }
  });
  child.on('error', reject);
});

try {
  const unauthenticated = await fetch(`http://127.0.0.1:${port}/api/livekit/token?room=LM-ABC234`);
  const unauthenticatedBody = await unauthenticated.json();
  assert('unauthenticated request returns 401', unauthenticated.status === 401, JSON.stringify(unauthenticatedBody));

  const malformed = await fetch(`http://127.0.0.1:${port}/api/livekit/token?room=arbitrary-room`, {
    headers: { Authorization: 'Bearer fake-token' },
  });
  const malformedBody = await malformed.json();
  assert('missing supabase admin still requires authentication', malformed.status === 401, JSON.stringify(malformedBody));
} finally {
  child.kill();
}

const failed = results.filter((item) => !item.passed);
console.log(`\nLiveKit endpoint assertions: ${results.length - failed.length}/${results.length} passed`);
if (failed.length > 0) process.exit(1);
