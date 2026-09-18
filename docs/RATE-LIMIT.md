# Token API rate-limit policy

## Problem

The previous single bucket (`30 / min` keyed by `IP:Authorization`) treated a legitimate multi-user join storm like one client hammering the API.

## Goals

1. Block anonymous abuse and stolen-token spray.
2. Allow a real meeting launch of many **distinct** authenticated users into one room.
3. Cap a single identity’s rejoin / refresh storm.
4. Never remove rate limiting; never raise limits just to green a benchmark.

## Policy (60-second window)

| Bucket | Limit | Behavior |
|---|---|---|
| Anonymous IP | 20 | Soft check before 401 |
| Authenticated user | 60 | Sustained mint/refresh per identity |
| Authenticated user + room | 20 | Rejoin storm for one person in one meeting |
| Authenticated room (all users) | 120 | Legitimate launch ≈2 joins/sec sustained |
| Authenticated IP | 180 | Soft NAT / stolen-token ceiling |

Limits unchanged in the performance pass. The in-memory limiter is synchronous Map bookkeeping only — it does **not** serialize async token work.

## Token path (after 2026-09-18 perf pass)

1. Overlap `auth.getUser` with meeting lookup by code
2. Evaluate multi-bucket limiter (after identity is known)
3. Load participant row for that user/meeting
4. Authorize via `evaluateLiveKitAccess` (participant + meeting status; client overrides ignored)
5. Mint LiveKit JWT (`toJwt` ≈ 0–1 ms)

Organization/workspace fetches were removed from this path because they did not affect allow/deny.

Structured logs + `Server-Timing` expose `auth_ms`, `meeting_ms`, `participant_ms`, `livekit_token_ms`, `total_ms` — never tokens or secrets.

## Root cause of concurrency latency (measured)

Dominant cost is **Supabase Auth `getUser` (+ meeting PostgREST)** round-trips from Render. LiveKit signing is negligible. Under concurrency, client-observed latency rises with outbound contention; successful **server** `total` for 10 concurrent stayed ~0.5–1.3 s after overlapping auth/meeting.

## Staging measurements — BEFORE (same user, pre-overlap)

Meeting `LM-KX4WWB` (2026-09-18 earlier probe):

| Stage | Success | p50 | p95 | p99 |
|---|---|---|---|---|
| Warm ×5 | 5/5 | 1092 | 1340 | — |
| 10 | 100% | 5147 | 13656 | 13656 |
| 25 | 80% (5×429) | 2686 | 3409 | 5282 |
| 50 | 40% | 9139 | 12539 | 14361 |
| 100 | 20% | 7517 | 12715 | 12742 |

## Staging measurements — AFTER (same user, post-overlap)

Meeting `LM-YUZX55` via `npm run test:token-perf`:

| Stage | Success | 429 | Client p50/p95/p99 | Server total p50 (200s only) |
|---|---|---|---|---|
| Warm ×5 | 5/5 | 0 | 997 / 4184 | sample total 2747 (includes cold-ish) |
| 1 | 100% | 0 | 2170 / 2170 / 2170 | 1345 |
| 5 | 100% | 0 | 2136 / 3198 / 3198 | 519 |
| 10 | 100% | 0 | **1683 / 1999 / 1999** | **576** |
| 20 | 100% | 0 | 3642 / 4322 / 4531 | 918 |
| 25 | 80% | 5 | 12135 / 13106 / 13717* | 456 |
| 50 | 40% | 30 | 3714 / 3944 / 4449* | 1401 |
| 100 | 20% | 80 | 4034 / 5518 / 5627* | 1094 |

\*Client percentiles mix successful and 429 responses. 429s still pay for `getUser` before the limiter rejects (accurate user-room accounting).

## Remaining bottleneck

Without a staging `SUPABASE_JWT_SECRET` for local JWT verification, every mint still depends on remote Auth `getUser`. Next infrastructure option: configure JWT secret on Render and verify locally, then keep meeting/participant PostgREST (or a single SECURITY DEFINER RPC). Do not cache authorization across removes/revokes.
