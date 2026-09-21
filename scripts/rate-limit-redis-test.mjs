import { createRateLimiter } from '../server/rate-limit.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function testMemory() {
  console.log('Testing Memory Rate Limiter...');
  const limiter = createRateLimiter({ clock: () => 1000 });

  for (let i = 0; i < 20; i++) {
    const res = await limiter.evaluateTokenRequest({ ip: '1.1.1.1', authenticated: false });
    assert(res.ok, `anon request ${i} should be allowed`);
  }
  const resOver = await limiter.evaluateTokenRequest({ ip: '1.1.1.1', authenticated: false });
  assert(!resOver.ok, 'anon request 21 should be blocked');
  console.log('Memory Rate Limiter: PASS');
}

async function testRedis() {
  console.log('Testing Redis Rate Limiter (Simulated)...');

  const mockRedis = {
    multi: () => {
      const commands = [];
      return {
        zremrangebyscore: () => commands.push('zremrangebyscore'),
        zadd: () => commands.push('zadd'),
        zcard: () => commands.push('zcard'),
        pexpire: () => commands.push('pexpire'),
        exec: async () => [
          [null, 0], // zremrangebyscore result
          [null, 1], // zadd result
          [null, 5], // zcard result (simulate 5 requests)
          [null, 1], // pexpire result
        ]
      };
    }
  };

  const limiter = createRateLimiter({ redis: mockRedis, clock: () => 2000 });
  const res = await limiter.evaluateTokenRequest({ ip: '2.2.2.2', authenticated: false });
  assert(res.ok, 'Redis-backed request should be allowed when under limit');

  // Test failure fallback
  const failingRedis = {
    multi: () => ({
      zremrangebyscore: () => {},
      zadd: () => {},
      zcard: () => {},
      pexpire: () => {},
      exec: async () => { throw new Error('Redis down'); }
    })
  };

  const limiterFallback = createRateLimiter({ redis: failingRedis, clock: () => 3000 });
  const resFallback = await limiterFallback.evaluateTokenRequest({ ip: '3.3.3.3', authenticated: false });
  assert(resFallback.ok, 'Should fall back to memory when Redis fails');

  console.log('Redis Rate Limiter (Simulated): PASS');
}

async function run() {
  await testMemory();
  await testRedis();
}

run().catch(err => {
  console.error('FAILED:', err);
  process.exit(1);
});
