# LeTsMeet Production Readiness Matrix

Last updated against branch `phase-1-saas-foundation` (staging only).

Status vocabulary (use only these):

- **VERIFIED**
- **PARTIALLY VERIFIED**
- **MANUAL REQUIRED**
- **PROVIDER REQUIRED**
- **NOT TESTED**
- **NOT SUPPORTED**

| Capability | Status | Evidence / notes |
|---|---|---|
| Authentication | VERIFIED | Staging sign-in; dual-browser Playwright |
| Tenant Security | VERIFIED | Phase 2–6 DB suites + invitation outsider denial |
| Meetings | VERIFIED | Create/start/join/end; cancelled/ended denials |
| LiveKit | VERIFIED | Token + moderation + dual-browser join |
| Video | VERIFIED | Dual-browser two-way video |
| Audio | PARTIALLY VERIFIED | Technical path VERIFIED; human-ear MANUAL REQUIRED |
| Active Speaker | PARTIALLY VERIFIED | Priority ordering + synthetic harness; live badges flaky with fake media |
| Moderation | VERIFIED | Host mute-other / remove-other + token 403 |
| Reconnection | VERIFIED | Playwright offline restore |
| Screen Share | MANUAL REQUIRED | Implementation real; capture not automatable safely |
| Scheduling | VERIFIED | RPC + invitation E2E |
| Invitations | VERIFIED | Staging invitation harness |
| Chat | VERIFIED | Dual-browser |
| Reactions | PARTIALLY VERIFIED | Reliable data + Realtime |
| Hand Raise | VERIFIED | Dual-browser |
| Polls | VERIFIED | Dual-browser |
| Q&A | VERIFIED | Dual-browser |
| Notes | VERIFIED | Dual-browser + optimistic locking |
| Whiteboard | PARTIALLY VERIFIED | Append-only; not CRDT |
| Recording | PROVIDER REQUIRED | Stays queued without egress + storage |
| Notifications | PROVIDER REQUIRED | Email/SMS pending; in-app PARTIALLY VERIFIED |
| Transcription | PROVIDER REQUIRED | Queued/unconfigured; never fabricated |
| AI | PROVIDER REQUIRED | Queued/unconfigured; meeting auth inherited |
| Organizations | PARTIALLY VERIFIED | Owner/member UI + RPC admin/guest invite matrix |
| Accessibility | PARTIALLY VERIFIED | Keyboard smoke; screen-reader MANUAL REQUIRED |
| Responsive | VERIFIED | 390 / 768 / 1280 |
| API | VERIFIED | Staging Render `/health` `/ready` + token auth |
| Database | VERIFIED | Staging migrations **001–014**; security suites |
| Rate Limiting | VERIFIED | Multi-bucket policy; see `docs/RATE-LIMIT.md` |
| Observability | PARTIALLY VERIFIED | Structured logs + readiness dependencies |
| CI | PARTIALLY VERIFIED | Lint/test/build/secret scan/LiveKit/policy tests; Windows DB suites local |
| Media Scale | NOT TESTED | Token ≠ media; see `docs/MEDIA-SCALE.md` |
| 500 Participants | NOT SUPPORTED | No media evidence |

## Staging

- Supabase staging: `uasslvisjnwhdhcgqwyc` (linked CLI target)
- Production Supabase: `wvmmofornwivfsjeqmda` — **untouched**
- Branch: `phase-1-saas-foundation` only; **main untouched**

## Provider checklist (do not invent credentials)

| Provider | Staging status |
|---|---|
| Email | PROVIDER REQUIRED (`emailConfigured: false`) |
| SMS | PROVIDER REQUIRED |
| LiveKit Egress + object storage | PROVIDER REQUIRED (`storageConfigured: false`) |
| Transcription | PROVIDER REQUIRED |
| AI | PROVIDER REQUIRED |

Jobs must remain pending/queued/unconfigured until a real provider accepts them.

## Migrations

Staging linked project `uasslvisjnwhdhcgqwyc` has migrations **001–014** applied via Supabase CLI (`supabase db push --linked`).  
Never apply from production-oriented `.env.local` (`wvmmofornwivfsjeqmda`).
