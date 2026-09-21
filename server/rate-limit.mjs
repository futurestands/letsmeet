/**
 * Distributed rate-limit policy for LeTsMeet.
 *
 * Support process-local Map for development and Redis for horizontal scaling.
 */

export function createRateLimiter(options = {}) {
  const { redis, clock = () => Date.now() } = options;
  const memoryBuckets = new Map();

  async function allowMemory(key, limit, windowMs) {
    const now = clock();
    const stamps = memoryBuckets.get(key) ?? [];
    const validStamps = stamps.filter((stamp) => now - stamp < windowMs);
    if (validStamps.length >= limit) {
      memoryBuckets.set(key, validStamps);
      return false;
    }
    validStamps.push(now);
    memoryBuckets.set(key, validStamps);
    return true;
  }

  async function allowRedis(key, limit, windowMs) {
    if (!redis) return allowMemory(key, limit, windowMs);

    try {
      const fullKey = `ratelimit:${key}`;
      const now = clock();
      const windowStart = now - windowMs;

      const multi = redis.multi();
      multi.zremrangebyscore(fullKey, 0, windowStart);
      multi.zadd(fullKey, now, `${now}-${Math.random()}`);
      multi.zcard(fullKey);
      multi.pexpire(fullKey, Math.ceil(windowMs / 1000) + 1); // TTL in seconds

      const results = await multi.exec();
      const count = results[2][1];

      return count <= limit;
    } catch (error) {
      console.error('Redis rate limit error, falling back to memory:', error);
      return allowMemory(key, limit, windowMs);
    }
  }

  const allow = redis ? allowRedis : allowMemory;

  async function evaluateTokenRequest({ ip, userId, room, authenticated }) {
    const windowMs = 60_000;

    if (!authenticated) {
      const ok = await allow(`anon-ip:${ip || 'unknown'}`, 20, windowMs);
      if (!ok) return { ok: false, reason: 'anon-ip' };
      return { ok: true };
    }

    // Parallel checks for authenticated buckets
    const checks = [
      allow(`user:${userId}`, 60, windowMs),
      room ? allow(`user-room:${userId}:${room}`, 20, windowMs) : Promise.resolve(true),
      room ? allow(`room:${room}`, 120, windowMs) : Promise.resolve(true),
      allow(`auth-ip:${ip || 'unknown'}`, 180, windowMs)
    ];

    const results = await Promise.all(checks);

    if (!results[0]) return { ok: false, reason: 'user' };
    if (!results[1]) return { ok: false, reason: 'user-room' };
    if (!results[2]) return { ok: false, reason: 'room' };
    if (!results[3]) return { ok: false, reason: 'auth-ip' };

    return { ok: true };
  }

  return { evaluateTokenRequest, isDistributed: Boolean(redis) };
}
