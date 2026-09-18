# LeTsMeet Media Scale Assessment

This document is an engineering assessment. It does **not** claim 500-participant support.

## Current verified capacity

| Stage | Evidence | Status |
|---|---|---|
| 2 concurrent human browsers | Playwright dual-context staging conference gate | VERIFIED |
| Token API warm path | Structured duration logs; typically ~1–2s including auth | PARTIALLY VERIFIED |
| Token API 10 concurrent authenticated | Historical probe ~100% when not rate-limited | PARTIALLY VERIFIED |
| Token API 25–250 concurrent | Multi-bucket limiter returns principled 429; see `docs/RATE-LIMIT.md` | VERIFIED (limiter) / NOT a media proof |
| LiveKit media soak 10–250 | Not executed with LiveKit load agents in this pass | NOT TESTED |
| 500 participants | No evidence | NOT SUPPORTED |

## Tested capacity

- Dual-browser media: 2
- Token concurrency: policy-tested locally; staging soak numbers remain from prior probes under the old limiter

## Expected bottlenecks

1. Browser DOM / video element count without pagination (mitigated: page size 16 + selective subscribe)
2. Full remote track subscription (mitigated: unsubscribe off-page cameras; keep screen share subscribed)
3. Token mint latency: Supabase `getUser` + meeting authorization queries (mitigated: parallel membership lookups)
4. Render cold starts on free tiers
5. Realtime fan-out for chat / polls / Q&A / notes
6. SFU region, TURN, and uplink bandwidth (provider-dependent)
7. Recording egress + object storage (PROVIDER REQUIRED)

## 500-participant requirements (not claimed)

1. LiveKit-compatible load generator ramp: 10 → 25 → 50 → 100 → 250 → controlled 500
2. Dedicated staging LiveKit capacity / region plan
3. Horizontal token API + connection storm protection at the edge
4. Gallery pagination + speaker/stage layout only (already foundational)
5. Simulcast + dynacast + adaptiveStream enabled (already present in conference connect)
6. Documented packet loss / CPU / memory budgets per stage
7. Separate soak for Realtime collaboration channels

## Load-test strategy

Prefer LiveKit CLI / server SDK agents publishing muted tracks over 500 GUI browsers.

Harness notes live in `scripts/media-scale-harness.md` (procedure) — execution requires LiveKit admin credentials and is **NOT TESTED** until operators run it.

## Decision

Until staged LiveKit media soaks produce evidence at 100+, treat large-meeting marketing claims as **unsupported**.
