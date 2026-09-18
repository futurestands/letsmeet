# LeTsMeet Production Readiness Matrix

Last updated against branch `phase-1-saas-foundation`.

Status vocabulary:

- **VERIFIED** — exercised with evidence in staging
- **PARTIALLY VERIFIED** — architecture + some automated evidence; gaps remain
- **MANUAL REQUIRED** — cannot be fully proven by current automation
- **PROVIDER REQUIRED** — waits on external credentials/services
- **NOT TESTED** — no credible evidence yet
- **NOT SUPPORTED** — explicitly out of scope or unclaimed

| Capability | Status | Evidence / notes |
|---|---|---|
| Authentication | VERIFIED | Staging sign-in in dual-browser Playwright |
| Tenant isolation | VERIFIED | Phase 2–6 DB suites + invitation outsider checks |
| Meetings lifecycle | VERIFIED | Create/start/join/end + cancelled/ended denials |
| LiveKit token auth | VERIFIED | Endpoint suites + dual-browser join |
| Two-way video | VERIFIED | Dual-browser Playwright |
| Two-way audio (technical) | VERIFIED | Mic publish + remote tiles + `RoomAudioRenderer` |
| Human-ear audio | MANUAL REQUIRED | See `docs/MANUAL-AUDIO.md` |
| Active speaker | PARTIALLY VERIFIED | Synthetic harness + speaker-priority tile ordering |
| Screen share | MANUAL REQUIRED | Implementation real; see `docs/SCREEN-SHARE.md` |
| Host mute-other | VERIFIED | Dual-browser UI |
| Host remove-other | VERIFIED | Dual-browser UI + subsequent token 403 |
| Reconnect | VERIFIED | Playwright `setOffline` restore path |
| Scheduling | VERIFIED | RPC + schedule UI invitation E2E |
| Invitations | VERIFIED | Dual-browser + staging invitation harness |
| Chat | VERIFIED | Dual-browser bidirectional |
| Reactions | PARTIALLY VERIFIED | Reliable data channel + Realtime publication |
| Hand raise | VERIFIED | Dual-browser |
| Polls | VERIFIED | Dual-browser |
| Q&A | VERIFIED | Dual-browser |
| Shared notes | VERIFIED | Dual-browser + stale-version rejection |
| Whiteboard | PARTIALLY VERIFIED | Append-only ops verified; **not CRDT** |
| Recording | PROVIDER REQUIRED | Queued without egress + object storage |
| Transcription | PROVIDER REQUIRED | Worker skips without provider; never fabricates text |
| AI | PROVIDER REQUIRED | Worker skips without provider; auth inherits meeting access |
| Organizations UI | PARTIALLY VERIFIED | Owner/member browser + RPC matrix for admin/guest invites |
| Notifications email/SMS | PROVIDER REQUIRED | Dispatcher + retries; stay pending without provider |
| In-app notifications | PARTIALLY VERIFIED | Persisted + Settings UI |
| Accessibility | PARTIALLY VERIFIED | See `docs/ACCESSIBILITY.md` — not WCAG certification |
| Responsive | VERIFIED | 390 / 768 / 1280 Playwright |
| Observability | PARTIALLY VERIFIED | `/health` `/ready` + structured request logs |
| Rate limiting | VERIFIED | Multi-bucket policy; `docs/RATE-LIMIT.md` |
| Load testing (token) | PARTIALLY VERIFIED | Policy tests + prior concurrency probes |
| Media load 10–250 | NOT TESTED | Harness documented; not executed this pass |
| 500 participants | NOT SUPPORTED | See `docs/MEDIA-SCALE.md` |
| Security regression | VERIFIED | Phase 2–6 + LiveKit endpoint + invitation harness |
| Backups | NOT TESTED | Supabase project ops outside app repo |
| CI/CD | PARTIALLY VERIFIED | Lint/test/build/secret scan/LiveKit/rate-limit/notification tests |
| Secret scanning | VERIFIED | Tracked files placeholders only |

## Staging projects

- Staging Supabase: `uasslvisjnwhdhcgqwyc`
- Production Supabase: `wvmmofornwivfsjeqmda` (must remain untouched from this branch)
- Feature branch only: `phase-1-saas-foundation`
- `main` must remain untouched until an explicit production cutover

## Provider checklist (do not invent credentials)

1. `NOTIFICATION_EMAIL_PROVIDER` + API key + from (optional webhook URL for `http`)
2. SMS provider env (adapter intentionally disabled until vendor chosen)
3. LiveKit Egress + `RECORDING_STORAGE_*`
4. `TRANSCRIPTION_PROVIDER` + `TRANSCRIPTION_API_KEY`
5. `AI_PROVIDER` + `AI_API_KEY`

Until configured, jobs must remain queued/unconfigured and UI must not claim completion.

## Migration note

Migration `014_provider_queue_indexes.sql` is in the repo. Staging application requires a **staging** `DATABASE_URL` (`uasslvisjnwhdhcgqwyc`). Local `.env.local` currently points at production Postgres and must **not** be used to apply migrations from this branch.
