# Token API rate-limit policy

## Problem

The previous single bucket (`30 / min` keyed by `IP:Authorization`) treated a legitimate multi-user join storm like one client hammering the API. Historical probes under that policy showed roughly:

- 10 concurrent → ~100% success
- 25 concurrent → ~56% success
- 50+ → mostly 429

That was **policy collision**, not proof that 25 users cannot join.

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

### Legitimate 50–100 participant join

- **50–100 distinct users** in one room within a minute: allowed by the **room** bucket (120), subject to auth-ip (180).
- **One user** retrying the same room 50 times: blocked by **user-room** (20) — correct, not a launch scenario.
- Staging probes that reuse a single host token therefore show 429 after ~20 concurrent; that must not be read as “50-person meetings are impossible.”

Abuse resistance remains via anon-ip, user, user-room, room, and auth-ip ceilings.

## What this does not do

- Does not prove LiveKit **media** capacity.
- Does not replace edge WAF / DDoS controls.
- Does not authorize raising the room cap without a new abuse review.

## Latency work alongside the limiter

Token path:

1. Authenticate (`getUser`)
2. Evaluate multi-bucket limiter
3. Load meeting once
4. Parallelize participant / membership / workspace lookups

Structured logs: `requestId`, `room`, `userId`, `durationMs`, outcome — never tokens or secrets.

## Staging measurements (same authenticated identity)

Probe date: 2026-09-18 against Render staging token API + meeting `LM-KX4WWB`.

| Metric | Result |
|---|---|
| Cold | 2616 ms (200) |
| Warm serial ×5 | p50 **1092** ms · p95 **1340** ms · 5/5 success |
| 10 concurrent | 10/10 success · p50 5147 · p95 13656 · p99 13656 |
| 25 concurrent | 20×200 + 5×429 (user-room cap) · p50 2686 · p95 3409 · p99 5282 |
| 50 concurrent | 20×200 + 29×429 + 1 error |
| 100 concurrent | 20×200 + 77×429 + 3 errors |

Interpretation: beyond 20 concurrent requests from **one** user/room, 429 is expected and correct. Distinct-user room capacity remains 120/min (unit-tested). Do not raise user-room to “fix” this probe.
