# LeTsMeet Media Scale Assessment

This document is an engineering assessment. It does **not** claim 500-participant support.

Distinguish carefully:

- **TOKEN API SCALE** — minting LiveKit JWTs under concurrency (auth + DB + rate limits)
- **MEDIA / SFU SCALE** — LiveKit rooms, tracks, TURN, client CPU/GPU, packet loss

Token API results are **not** media proof.

## CURRENT VERIFIED

| Item | Evidence |
|---|---|
| 2 concurrent human browsers (media + collab) | Playwright dual-context staging gate |
| Selective camera subscribe + page size 16 | `ParticipantGrid` |
| `adaptiveStream` / `dynacast` / `simulcast` | `ConferenceRoom` LiveKit room options |
| Active-speaker priority in gallery order | Unit + grid sort |
| Token multi-bucket rate limit | `server/rate-limit.mjs` + policy unit test (120 distinct users / room / min) |
| Token warm serial latency | Staging 2026-09-18: p50 ≈1092 ms · p95 ≈1340 ms |
| Token same-user concurrency | 10 → 100%; ≥25 → 20×200 then user-room 429s (intentional) |

## CURRENT UNVERIFIED

| Item | Status |
|---|---|
| LiveKit media soak at 10 / 25 / 50 / 100 / 250 | NOT TESTED |
| TURN path under lossy networks | NOT TESTED |
| Client CPU/memory at ≥25 video tiles | NOT TESTED |
| Distinct-user token storm at 50–100 on staging Render | NOT TESTED (only two staging identities) |
| 500 participants | NOT SUPPORTED |

## Scale expectations (architecture judgment, not soak evidence)

| Participants | TOKEN API SCALE | MEDIA / SFU SCALE |
|---|---|---|
| **10** | Comfortable under policy (≤120 distinct users/room/min) | Expected OK with full gallery + adaptive stream |
| **25** | Distinct users OK; **same user** capped at 20/user-room/min | Expected OK with pagination |
| **50** | Distinct users OK within room 120/min burst | Expected OK if selective subscribe holds; needs soak |
| **100** | Near room burst ceiling; may need staggered joins | UNVERIFIED — SFU + client risk rises |
| **250** | Token API alone insufficient; edge/WAF + capacity plan | UNVERIFIED — requires load agents |
| **500** | NOT SUPPORTED | NOT SUPPORTED |

## Architecture levers present

- LiveKit `adaptiveStream`, `dynacast`, `simulcast`
- Paginated tiles (16) + unsubscribe off-page cameras
- Screen share prioritized above gallery
- Parallelized token authorization DB lookups
- Multi-bucket rate limits (see `docs/RATE-LIMIT.md`)

## Load-test strategy

See `scripts/media-scale-harness.md`. Prefer LiveKit agents over 500 GUI browsers.

## Decision

Until staged LiveKit media soaks produce evidence at 100+, treat large-meeting marketing claims as **unsupported**.
