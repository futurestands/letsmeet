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
| API | VERIFIED | Staging Render `/health` `/ready` + token auth; Server-Timing phases |
| Database | VERIFIED | Staging migrations **001–016**; security suites |
| Guest share-link join | VERIFIED | Unauthenticated guest E2E + security matrix; no org/workspace membership |
| Rate Limiting | VERIFIED | Multi-bucket policy unchanged; see `docs/RATE-LIMIT.md` |
| Observability | PARTIALLY VERIFIED | Structured logs + Server-Timing on token mint |
| CI | PARTIALLY VERIFIED | Lint/test/build/secret scan/LiveKit/policy tests; Windows DB suites local |
| Media Scale | NOT TESTED | Token ≠ media; see `docs/MEDIA-SCALE.md` |
| 500 Participants | NOT SUPPORTED | No media evidence |
| Token API latency | PARTIALLY VERIFIED | Overlap auth+meeting reduced 10-concurrent client p50 ~5147→~1683 ms; Auth `getUser` remains dominant |

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

Staging linked project `uasslvisjnwhdhcgqwyc` has migrations **001–016** applied via Supabase CLI (`supabase db push --linked`).  
Never apply from production-oriented `.env.local` (`wvmmofornwivfsjeqmda`).

## Guest share-link join (IMPLEMENTED + STAGING VERIFIED)

Implemented:
- Public `/join/:code` route (no account required)
- Render `/api/guest/meeting-preview` + `/api/guest/session` (ephemeral guest auth user)
- RPCs `lookup_meeting_share_link` / `join_meeting_by_share_link` (migration 015)
- Guests blocked from `ensure_user_profile_context` org provisioning (migration 016)
- Guests never receive organization or workspace membership
- LiveKit token still requires a real meeting participant row

Staging verification evidence (this pass):
- Dedicated Playwright: `e2e/guest-shared-link-no-account.spec.ts` — **2/2 passed** on staging Preview (`npm run test:e2e:guest`)
- Security matrix: `npm run test:guest-security` — **16/16 passed** against Render + staging Supabase
- Local staging-API probe of preview → guest session → share-link join with org_count=0
- Share URL uses meeting code only (`LM-XXXXXX`); no credentials in the link

Not claimed:
- Production readiness of the whole platform
- Human-ear audio
- 500 participants
- Provider-backed recording / transcription / AI
