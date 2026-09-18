/**
 * Token API rate-limit policy.
 *
 * Goals:
 * - Block anonymous / cross-IP abuse
 * - Allow a legitimate meeting join burst (many authenticated users, same room)
 * - Keep per-user sustained rates modest
 *
 * Buckets (window = 60s unless noted):
 * - anon/ip: 20 / min
 * - authenticated user: 60 / min
 * - authenticated user+meeting: 20 / min (rejoin storms)
 * - meeting global authenticated: 120 / min (≈2 joins/sec sustained)
 */

export function createRateLimiter(clock = () => Date.now()) {
  const buckets = new Map();

  function allow(key, limit, windowMs) {
    const now = clock();
    const next = (buckets.get(key) ?? []).filter((stamp) => now - stamp < windowMs);
    if (next.length >= limit) {
      buckets.set(key, next);
      return false;
    }
    next.push(now);
    buckets.set(key, next);
    return true;
  }

  function evaluateTokenRequest({ ip, userId, room, authenticated }) {
    const windowMs = 60_000;
    if (!authenticated) {
      if (!allow(`anon-ip:${ip || 'unknown'}`, 20, windowMs)) {
        return { ok: false, reason: 'anon-ip' };
      }
      return { ok: true };
    }

    if (!allow(`user:${userId}`, 60, windowMs)) {
      return { ok: false, reason: 'user' };
    }
    if (room && !allow(`user-room:${userId}:${room}`, 20, windowMs)) {
      return { ok: false, reason: 'user-room' };
    }
    if (room && !allow(`room:${room}`, 120, windowMs)) {
      return { ok: false, reason: 'room' };
    }
    // Keep a soft IP ceiling for stolen tokens / shared NAT abuse.
    if (!allow(`auth-ip:${ip || 'unknown'}`, 180, windowMs)) {
      return { ok: false, reason: 'auth-ip' };
    }
    return { ok: true };
  }

  return { allow, evaluateTokenRequest, buckets };
}
