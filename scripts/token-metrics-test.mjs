import { createTokenMetrics } from '../server/token-metrics.mjs';

const metrics = createTokenMetrics();
metrics.recordTokenOutcome(200, { total_ms: 100, auth_ms: 80, meeting_ms: 70, participant_ms: 10, livekit_token_ms: 1 });
metrics.recordTokenOutcome(401, { total_ms: 20 });
metrics.recordTokenOutcome(403, { total_ms: 30 });
metrics.recordTokenOutcome(429, { total_ms: 40 });
metrics.recordGuestPreview();
metrics.recordGuestSession(true);
metrics.recordGuestSession(false);
metrics.recordModeration(true);
metrics.recordModeration(false);

const snap = metrics.snapshot();
const assert = (ok, message) => {
  if (!ok) {
    console.error('FAIL', message);
    process.exitCode = 1;
  } else {
    console.log('PASS', message);
  }
};

assert(snap.token.requests === 4, 'token requests counted');
assert(snap.token.issued === 1, 'issued counted');
assert(snap.token.unauthorized === 1, '401 counted');
assert(snap.token.forbidden === 1, '403 counted');
assert(snap.token.rateLimited === 1, '429 counted');
assert(snap.token.guestPreview === 1, 'guest preview counted');
assert(snap.token.guestSession === 2, 'guest sessions counted');
assert(snap.token.guestSessionFailed === 1, 'guest session failure counted');
assert(snap.token.moderation === 2, 'moderation counted');
assert(snap.token.moderationDenied === 1, 'moderation denial counted');
assert(snap.latencyMs.total.count === 4, 'latency samples retained');
assert(!JSON.stringify(snap).includes('eyJ'), 'metrics payload has no JWT-looking values');

if (!process.exitCode) console.log('token metrics assertions: PASS');
