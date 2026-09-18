/**
 * In-process token API counters for staging/production observability.
 * Never store tokens, JWTs, or secrets — only aggregate counts and latency samples.
 */

function createLatencyTracker(maxSamples = 200) {
  const samples = [];
  return {
    record(ms) {
      if (!Number.isFinite(ms) || ms < 0) return;
      samples.push(ms);
      if (samples.length > maxSamples) samples.shift();
    },
    snapshot() {
      if (samples.length === 0) {
        return { count: 0, p50: null, p95: null, max: null };
      }
      const sorted = [...samples].sort((a, b) => a - b);
      const at = (p) => sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * (sorted.length - 1)))];
      return {
        count: sorted.length,
        p50: at(50),
        p95: at(95),
        max: sorted[sorted.length - 1],
      };
    },
  };
}

export function createTokenMetrics() {
  const startedAt = Date.now();
  const counts = {
    requests: 0,
    issued: 0,
    unauthorized: 0,
    forbidden: 0,
    notFound: 0,
    rateLimited: 0,
    errors: 0,
    guestPreview: 0,
    guestSession: 0,
    guestSessionFailed: 0,
    moderation: 0,
    moderationDenied: 0,
  };
  const totalLatency = createLatencyTracker();
  const authLatency = createLatencyTracker();
  const meetingLatency = createLatencyTracker();
  const participantLatency = createLatencyTracker();
  const livekitLatency = createLatencyTracker();

  function recordTokenOutcome(status, timing = {}) {
    counts.requests += 1;
    if (status === 200) counts.issued += 1;
    else if (status === 401) counts.unauthorized += 1;
    else if (status === 403) counts.forbidden += 1;
    else if (status === 404) counts.notFound += 1;
    else if (status === 429) counts.rateLimited += 1;
    else if (status >= 500) counts.errors += 1;

    if (Number.isFinite(timing.total_ms)) totalLatency.record(timing.total_ms);
    if (Number.isFinite(timing.auth_ms)) authLatency.record(timing.auth_ms);
    if (Number.isFinite(timing.meeting_ms)) meetingLatency.record(timing.meeting_ms);
    if (Number.isFinite(timing.participant_ms)) participantLatency.record(timing.participant_ms);
    if (Number.isFinite(timing.livekit_token_ms)) livekitLatency.record(timing.livekit_token_ms);
  }

  function snapshot() {
    return {
      uptimeMs: Date.now() - startedAt,
      token: { ...counts },
      latencyMs: {
        total: totalLatency.snapshot(),
        auth: authLatency.snapshot(),
        meeting: meetingLatency.snapshot(),
        participant: participantLatency.snapshot(),
        livekit: livekitLatency.snapshot(),
      },
    };
  }

  return {
    recordTokenOutcome,
    recordGuestPreview() { counts.guestPreview += 1; },
    recordGuestSession(ok) {
      counts.guestSession += 1;
      if (!ok) counts.guestSessionFailed += 1;
    },
    recordModeration(ok) {
      counts.moderation += 1;
      if (!ok) counts.moderationDenied += 1;
    },
    snapshot,
  };
}
