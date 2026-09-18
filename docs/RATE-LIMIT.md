# Token API rate-limit policy

## Problem

A naive per-IP/auth-header limiter (30 requests / minute) blocked legitimate join storms around ~25 concurrent authenticated users while remaining too loose for anonymous probing when shared tokens were reused as bucket keys.

## Goals

1. Prevent anonymous abuse and stolen-token spray.
2. Allow a real meeting launch burst (dozens of distinct authenticated users joining one room).
3. Keep a single user from hammering mint endpoints during reconnect loops.
4. Never remove rate limiting.

## Policy (60-second window)

| Bucket | Limit | Rationale |
|---|---|---|
| Anonymous IP | 20 | Unauthenticated callers only get 401 after this soft check |
| Authenticated user | 60 | Covers reconnect + token refresh |
| Authenticated user + room | 20 | Caps rejoin storms for one identity |
| Authenticated room (all users) | 120 | ≈2 joins/sec sustained for one meeting |
| Authenticated IP | 180 | Soft NAT / stolen-token ceiling |

## What this does not do

- It does not prove LiveKit media capacity.
- It does not replace WAF / edge protection.
- It does not raise limits arbitrarily to hide latency problems.

## Latency work alongside the limiter

Token authorization now:

1. Authenticates the user
2. Evaluates the multi-bucket limiter
3. Loads the meeting once
4. Parallelizes participant / membership / workspace lookups

Structured logs include `requestId`, `room`, `userId`, `durationMs`, and outcome — never tokens or secrets.

## Verification

- Unit: `node scripts/rate-limit-policy-test.mjs`
- Staging concurrency probes remain documented in `docs/MEDIA-SCALE.md` and `docs/PRODUCTION-READINESS.md`
