import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = 3020;
const child = spawn(process.execPath, [path.join(root, 'server', 'livekit-token.mjs')], {
  cwd: root,
  env: {
    ...process.env,
    PORT: String(port),
    LIVEKIT_API_KEY: 'phase3-test-key',
    LIVEKIT_API_SECRET: 'phase3-test-secret-phase3-test-secret',
    LIVEKIT_HOST: 'http://127.0.0.1:7880',
    ALLOWED_ORIGINS: 'http://localhost:5173',
    SUPABASE_SERVICE_ROLE_KEY: '',
  },
  stdio: ['ignore', 'pipe', 'pipe'],
});

await new Promise((resolve, reject) => {
  const timer = setTimeout(() => reject(new Error('Token server did not start')), 8000);
  child.stdout.on('data', (chunk) => {
    if (String(chunk).includes('listening')) {
      clearTimeout(timer);
      resolve();
    }
  });
  child.on('error', reject);
});

let passed = 0;
const assertStatus = async (name, request, expected) => {
  const response = await request;
  if (response.status !== expected) {
    throw new Error(`${name}: expected ${expected}, received ${response.status}`);
  }
  passed += 1;
  console.log(`PASS ${name}: ${response.status}`);
};

try {
  await assertStatus(
    'health endpoint',
    fetch(`http://127.0.0.1:${port}/health`),
    200,
  );
  await assertStatus(
    'unauthenticated token request',
    fetch(`http://127.0.0.1:${port}/api/livekit/token?room=LM-ABC234`),
    401,
  );
  await assertStatus(
    'unauthenticated moderation request',
    fetch(`http://127.0.0.1:${port}/api/livekit/moderate`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        room: 'LM-ABC234',
        targetIdentity: '22222222-2222-2222-2222-222222222222',
        action: 'remove',
      }),
    }),
    401,
  );
  await assertStatus(
    'disallowed origin',
    fetch(`http://127.0.0.1:${port}/api/livekit/token?room=LM-ABC234`, {
      headers: { Origin: 'https://attacker.example' },
    }),
    403,
  );
  console.log(`LiveKit endpoint assertions: ${passed}/4 passed`);
} finally {
  child.kill();
}
