import { createRateLimiter } from '../server/rate-limit.mjs';

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

async function runTests() {
  const limiter = createRateLimiter({ clock: () => 1_000 });
  for (let i = 0; i < 20; i += 1) {
    const res = await limiter.evaluateTokenRequest({ ip: '1.1.1.1', authenticated: false });
    assert(res.ok, 'anon under limit');
  }
  assert(!(await limiter.evaluateTokenRequest({ ip: '1.1.1.1', authenticated: false })).ok, 'anon over limit');

  const authed = createRateLimiter({ clock: () => 2_000 });
  for (let i = 0; i < 60; i += 1) {
    const res = await authed.evaluateTokenRequest({
      ip: '2.2.2.2',
      userId: 'u1',
      room: `LM-ROOM${String(i).padStart(2, '0')}`,
      authenticated: true,
    });
    assert(res.ok, `authed under user limit ${i}`);
  }
  assert(
    !(await authed.evaluateTokenRequest({
      ip: '2.2.2.2',
      userId: 'u1',
      room: 'LM-ROOM99',
      authenticated: true,
    })).ok,
    'authed over user limit',
  );

  const userRoom = createRateLimiter({ clock: () => 2_500 });
  for (let i = 0; i < 20; i += 1) {
    const res = await userRoom.evaluateTokenRequest({
      ip: '3.3.3.3',
      userId: 'u2',
      room: 'LM-SAME01',
      authenticated: true,
    });
    assert(res.ok, `user-room under limit ${i}`);
  }
  assert(
    !(await userRoom.evaluateTokenRequest({
      ip: '3.3.3.3',
      userId: 'u2',
      room: 'LM-SAME01',
      authenticated: true,
    })).ok,
    'user-room over limit',
  );

  const roomBurst = createRateLimiter({ clock: () => 3_000 });
  let allowed = 0;
  for (let i = 0; i < 130; i += 1) {
    const result = await roomBurst.evaluateTokenRequest({
      ip: `10.0.0.${i % 40}`,
      userId: `user-${i}`,
      room: 'LM-MEET01',
      authenticated: true,
    });
    if (result.ok) allowed += 1;
  }
  assert(allowed === 120, `room burst should allow 120 unique users/min, got ${allowed}`);

  console.log('rate-limit policy assertions: PASS');
}

runTests().catch(err => {
  console.error(err);
  process.exit(1);
});
