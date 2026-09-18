# LeTsMeet Media Scale Assessment

This document is an engineering assessment. It does **not** claim 500-participant support.

## Current verified scale

| Stage | Evidence |
|---|---|
| 2 concurrent browsers | Playwright dual-context staging conference gate |
| Token API 10 concurrent | ~100% success when authenticated against a live meeting |
| Token API 25 concurrent | Partial success; rate limiter begins returning 429 |
| Token API 50–250 | Dominated by intentional 429 rate limiting |

## Target stages (aspirational)

| Participants | Frontend | SFU / LiveKit | API / DB | Primary risks |
|---|---|---|---|---|
| 10 | Full subscribe OK | Single room trivial | Negligible | None material |
| 25 | Prefer pagination + dynacast | Still comfortable on LiveKit Cloud | Token bursts need limiter | Join storms |
| 50 | Must paginate tiles; subscribe visible only | Simulcast + dynacast required | Auth/DB latency visible | Speaker + layout thrash |
| 100 | Aggressive selective subscription | TURN + region placement matter | Rate limits + connection storms | Reconnect avalanches |
| 250 | Stage + gallery pages only | Dedicated room capacity planning | Horizontal API needed | Bandwidth + CPU on clients |
| 500 | Not claimed | Requires LiveKit load tooling + capacity plan | Not proven | Browser render + SFU cost |

## Architecture levers already present

- LiveKit `adaptiveStream` / `dynacast` usage in conference connect paths
- Participant tile pagination / selective subscription in `ParticipantGrid`
- Stable tile ordering when active speaker changes (unit-tested)
- Token endpoint authentication, CORS allowlist, and request rate limiting

## Credible load-test strategy (media)

Do **not** spawn 500 full Chromium profiles.

Preferred approach:

1. Use LiveKit-compatible load generators / CLI agents publishing muted tracks
2. Ramp rooms: 10 → 25 → 50 → 100 → 250
3. Measure join latency, subscribe success, packet loss, SFU CPU, egress bandwidth
4. Separately soak token API with authenticated tokens and document 429 policy
5. Only after 250 is stable, attempt controlled 500 in a dedicated staging project

## Bottlenecks to watch

- Browser DOM/video element count
- Full-mesh subscription mistakes (mitigated by selective subscribe)
- Token mint latency (Supabase auth + meeting authorization queries)
- Render free-tier cold starts
- Realtime channel fan-out for chat/collab tables
- Recording egress and object storage throughput (provider-dependent)

## Decision

Until staged LiveKit media soaks produce evidence at 100+, treat marketing claims of large meetings as **unsupported**.
