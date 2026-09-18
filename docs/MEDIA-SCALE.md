# LeTsMeet Media Scale Assessment

This document is an engineering assessment and readiness plan. It does **not** claim 500-participant support.

Distinguish carefully:

- **TOKEN API SCALE** — minting LiveKit JWTs under concurrency (auth + DB + rate limits)
- **MEDIA / SFU SCALE** — LiveKit rooms, tracks, TURN, client CPU/GPU, packet loss
- **FRONTEND RENDER SCALE** — how many video tiles the React UI subscribes to and paints

Token API results are **not** media proof. LiveKit Cloud capacity alone is **not** product proof.

## Status vocabulary

| Label | Meaning |
|---|---|
| IMPLEMENTED | Code exists in the repository |
| STAGING VERIFIED | Measured or E2E-proven on staging |
| MANUAL VERIFIED | Requires a human operator |
| PROVIDER REQUIRED | Needs external vendor credentials/config |
| NOT YET SUPPORTED | Explicitly not claimed |

## CURRENT STAGING VERIFIED

| Item | Evidence |
|---|---|
| 2 concurrent human browsers (media + collab) | Playwright dual-context staging gate |
| Selective camera subscribe + page size 16 | `ParticipantGrid` + `GALLERY_PAGE_SIZE` |
| Pin / spotlight participant | Gallery pin keeps subscription + high quality |
| Active-speaker page follow | Auto page jump (paused after manual paging / while pinned) |
| Remote video quality bias | HIGH for pin/speaker; LOW for other subscribed cameras |
| Screen-share always subscribed | Independent of gallery pagination |
| `adaptiveStream` / `dynacast` / `simulcast` | `ConferenceRoom` LiveKit room options |
| Token multi-bucket rate limit | `server/rate-limit.mjs` + policy unit test |
| Token warm/concurrent latency | See `docs/RATE-LIMIT.md` |
| Token aggregate metrics | `GET /api/livekit/metrics` (counts + latency percentiles; no secrets) |

## CURRENT UNVERIFIED / NOT SUPPORTED

| Item | Status |
|---|---|
| LiveKit media soak at 10 / 25 / 50 / 100 / 250 | NOT TESTED |
| TURN path under lossy networks | NOT TESTED |
| Client CPU/memory at ≥25 video tiles | NOT TESTED |
| Distinct-user token storm at 50–100 on staging Render | NOT TESTED (only two staging identities) |
| 500 participants | **NOT SUPPORTED** |

## Frontend participant rendering limits (IMPLEMENTED)

| Control | Value / behavior |
|---|---|
| Gallery page size | **16** camera tiles (`GALLERY_PAGE_SIZE`) |
| Off-page cameras | Unsubscribed (bandwidth/CPU) |
| Audio | Remains available via `RoomAudioRenderer` independent of gallery page |
| Screen share | Prioritized stage; always subscribed |
| Pin | Always subscribed + high quality even when browsing other pages |
| Active speaker | Sorted toward front; page auto-follows unless user paged recently or pin is set |
| Participant roster | Full list with filter when count > 12 (not a second video decoder farm) |

Expected browser limits (engineering judgment, not soak evidence):

- **≤16 decoded cameras**: designed operating point for a modern laptop browser
- **>16**: must rely on pagination + unsubscribe; decoding all cameras is unsupported by this UI
- **CPU/GPU**: dominated by decoded video tiles, not React list length of the roster

## Architecture levers present

- LiveKit `adaptiveStream`, `dynacast`, `simulcast` (`h180`/`h360` layers)
- Paginated tiles (16) + unsubscribe off-page cameras
- Pin/spotlight + speaker-biased quality
- Screen share prioritized above gallery
- Parallelized token authorization DB lookups
- Multi-bucket rate limits (see `docs/RATE-LIMIT.md`)
- In-process metrics endpoint for token outcomes

## Scale readiness path to 500 (NOT YET SUPPORTED)

### 1. Frontend rendering
- Keep hard cap of ~16 simultaneous camera decodes
- Never render hundreds of `<video>` elements
- Prefer roster + pagination over gallery for webinar-style rooms (future mode)

### 2. Browser limits
- Plan for ~2–4 GB tab memory and significant GPU at 16 HD tiles
- Require soak evidence before raising page size

### 3. LiveKit Cloud
- Confirm project region, max participants, bandwidth quotas
- Separate staging vs production projects

### 4. TURN
- Mandatory for corporate NATs; verify with forced-relay tests

### 5. Token API
- Current bottleneck: remote Supabase `getUser` RTT
- Safe next step only with verified `SUPABASE_JWT_SECRET` local verification — **not** implemented without that secret
- Do not cache authorization across removes/revokes

### 6. Horizontal scaling (Render/Railway)
- Multiple token API instances behind a load balancer
- Sticky sessions not required for JWT minting

### 7. Distributed rate limiting
- Replace in-memory Maps with Redis (or equivalent) shared counters
- Preserve the same numeric policy; do not raise limits to pass tests

### 8. Observability
- Use `/api/livekit/metrics` + structured logs + `Server-Timing`
- Alert on 401/403/429 spikes and auth latency p95

### 9. Load-test methodology
- See `scripts/media-scale-harness.md`
- Prefer LiveKit agents over 500 GUI browsers

### 10. Target acceptance metrics

| Participants | Token API | Frontend | Media / SFU | Decision gate |
|---|---|---|---|---|
| **10** | Join p95 < 2s warm | Full gallery OK | Join ≥99%, stable A/V | Comfortable |
| **25** | Distinct users within room 120/min | Pagination used | No cascade disconnects | Expected OK; needs soak |
| **50** | Staggered joins OK | Selective subscribe holds CPU | Document CPU/bandwidth | Soak required |
| **100** | Near room burst ceiling | 16-tile cap mandatory | Packet loss budget documented | UNVERIFIED |
| **250** | Edge/WAF + multi-instance token API | Roster-first UX recommended | SFU CPU within budget | UNVERIFIED |
| **500** | Capacity plan + Redis limits | Webinar layout required | Explicit go/no-go | **NOT SUPPORTED** until soak |

## Load-test strategy

See `scripts/media-scale-harness.md`. Prefer LiveKit agents over 500 GUI browsers.

## Decision

Until staged LiveKit media soaks produce evidence at 100+, treat large-meeting marketing claims as **unsupported**.
**500 participants = NOT SUPPORTED.**
