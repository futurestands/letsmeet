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
| Two-way video | VERIFIED | Dual-browser Playwright (`LM-RBNVHY` and later) |
| Two-way audio (technical) | VERIFIED | Mic publish + remote tiles + `RoomAudioRenderer` |
| Human-ear audio | MANUAL REQUIRED | Automation cannot prove perception |
| Active speaker | PARTIALLY VERIFIED | Synthetic-tone harness exists; LiveKit may still miss fake energy |
| Screen share | MANUAL REQUIRED / PARTIALLY VERIFIED | Implementation real; browser capture source often blocked in automation |
| Host mute-other | VERIFIED | Dual-browser UI |
| Host remove-other | VERIFIED | Dual-browser UI + subsequent token 403 |
| Reconnect | VERIFIED | Playwright `setOffline` restore path |
| Scheduling | VERIFIED | RPC + schedule UI invitation E2E |
| Invitations | VERIFIED | Dual-browser + staging invitation harness |
| Chat | VERIFIED | Dual-browser bidirectional |
| Reactions | PARTIALLY VERIFIED | Ephemeral overlays; durable row + reliable data channel + Realtime |
| Hand raise | VERIFIED | Dual-browser |
| Polls | VERIFIED | Dual-browser |
| Q&A | VERIFIED | Dual-browser |
| Shared notes | VERIFIED | Dual-browser + stale-version rejection |
| Whiteboard | PARTIALLY VERIFIED | Append-only ops verified; **not CRDT** |
| Recording | PROVIDER REQUIRED | Queued/unconfigured without egress+storage |
| Transcription | PROVIDER REQUIRED | Jobs remain queued without provider |
| AI | PROVIDER REQUIRED | Jobs remain queued; cross-tenant must stay denied |
| Organizations UI | PARTIALLY VERIFIED | Owner vs member browser matrix; guest browser account optional |
| Notifications email/SMS | PROVIDER REQUIRED | Stay pending without provider; never fake SENT |
| In-app notifications | PARTIALLY VERIFIED | Persisted + Settings UI |
| Accessibility | PARTIALLY VERIFIED | Keyboard smoke on core flows; not WCAG certification |
| Responsive | VERIFIED | 390 / 768 / 1280 Playwright |
| Observability | PARTIALLY VERIFIED | `/health` `/ready` structured server logs |
| Rate limiting | VERIFIED | Token API 429 under concurrency |
| Load testing (token) | PARTIALLY VERIFIED | 10–250 concurrency probes; not media soak |
| 500 participants | NOT SUPPORTED | No media evidence; see `docs/MEDIA-SCALE.md` |
| Security regression | VERIFIED | Phase 2–6 + LiveKit endpoint + invitation harness |
| Backups | NOT TESTED | Supabase project ops outside app repo |
| CI/CD | PARTIALLY VERIFIED | Lint/test/build/secret scan/LiveKit; dual-browser needs staging secrets |
| Secret scanning | VERIFIED | Tracked files placeholders only |

## Staging projects

- Staging Supabase: `uasslvisjnwhdhcgqwyc`
- Production Supabase: `wvmmofornwivfsjeqmda` (must remain untouched from this branch)
- Feature branch only: `phase-1-saas-foundation`
- `main` must remain untouched until an explicit production cutover

## Provider checklist (do not invent credentials)

1. Notification email/SMS provider env on Render
2. LiveKit Egress + object storage keys
3. Transcription provider
4. AI provider key + model endpoint

Until configured, jobs must remain queued/unconfigured and UI must not claim completion.
