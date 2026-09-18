# Phase 3 staging deployment and acceptance

This runbook is only for a new, non-production LeTsMeet staging environment. Never link the
repository to the production Supabase or LiveKit projects while following it.

## Architecture

- Browser: static Vite application served over HTTPS.
- API: `server/livekit-token.mjs` served over HTTPS.
- Database/auth: a dedicated Supabase staging project with migrations 001 through 006.
- Media: a dedicated LiveKit staging deployment reachable over WSS and WebRTC.
- TURN: LiveKit Cloud TURN or a TLS-enabled TURN service attached to the staging LiveKit server.

Supabase stores durable meeting, participant, lifecycle, lock, and chat state. LiveKit owns live
media, presence, active-speaker state, raised hands, and reactions.

## Environment separation

Copy `.env.example` to `.env.staging.local`. Git ignores this file.

Public browser values:

- `VITE_SUPABASE_URL`
- `VITE_SUPABASE_ANON_KEY`
- `VITE_LIVEKIT_URL`
- `VITE_LIVEKIT_TOKEN_ENDPOINT`

Server-only values:

- `SUPABASE_URL`
- `SUPABASE_SERVICE_ROLE_KEY`
- `LIVEKIT_HOST`
- `LIVEKIT_API_KEY`
- `LIVEKIT_API_SECRET`
- `ALLOWED_ORIGINS`

Administration and test values:

- `DATABASE_URL`
- `STAGING_PROJECT_REF`
- `STAGING_CONFIRMATION` — must equal `staging:<STAGING_PROJECT_REF>`
- `PRODUCTION_SUPABASE_URL` — used only as a safety comparison
- `STAGING_TEST_HOST_EMAIL` and `STAGING_TEST_HOST_PASSWORD`
- `STAGING_TEST_PARTICIPANT_EMAIL` and `STAGING_TEST_PARTICIPANT_PASSWORD`

Store server and test secrets in the deployment provider's encrypted secret store. Never configure
them as `VITE_` values. The frontend receives a short-lived LiveKit token, not API or service-role
credentials.

Run the local safety check before any deployment:

```bash
npm run staging:preflight
```

The check prints variable names only; it does not print values.

## Supabase staging

1. Create a new Supabase project with no production data.
2. Copy its public URL and publishable anon key to the frontend environment.
3. Store its service-role key only in the API and seed-script secret environments.
4. Confirm the selected project before linking:

```bash
supabase projects list
supabase link --project-ref <staging-project-ref>
supabase db push --linked --include-all --dry-run
```

The dry run must show only:

```text
001_create_tables.sql
002_saas_foundation.sql
003_saas_security_hardening.sql
004_persistent_meeting_system.sql
005_realtime_conferencing.sql
006_supabase_pgcrypto_compatibility.sql
```

Apply and inspect:

```bash
supabase db push --linked --include-all
supabase migration list --linked
```

Do not run these commands if the linked ref is the production ref. The legacy
`npm run db:migrate` command is suitable only for a fresh database explicitly selected through
`DATABASE_URL`; the linked Supabase CLI workflow is preferred because it records migration history.

Re-run disposable security suites independently of staging:

```bash
node scripts/phase2-db-security-test.mjs
npm run test:phase3-db
```

Expected results are Phase 2 `34/34` and Phase 3 `19/19`.

## Test identities

After migrations are applied, create two staging-only identities and their shared tenant:

```bash
npm run staging:seed
```

The script:

- refuses a staging URL equal to `PRODUCTION_SUPABASE_URL`;
- requires an explicit project-ref confirmation;
- creates or reuses two synthetic auth users;
- assigns both users to `LeTsMeet Staging Acceptance / Acceptance`;
- never prints passwords or service-role credentials.

If automated user creation is not permitted, create both users in the staging Auth dashboard and
authenticate two browser profiles manually. Do not reuse customer accounts.

## LiveKit and TURN

Required DNS:

- `app.staging.example.com` — frontend
- `api.staging.example.com` — token/moderation API
- `livekit.staging.example.com` — LiveKit HTTPS/WSS endpoint
- `turn.staging.example.com` — TURN hostname when self-hosted

Required connectivity for the example self-hosted configuration:

- TCP 443 to the HTTPS/WSS reverse proxy
- TCP 7881 for WebRTC fallback
- UDP 50000–60000 for direct WebRTC media
- UDP 3478 for TURN/UDP
- TCP 5349 for TURN/TLS

Use `deploy/livekit.staging.example.yaml` as a reviewed template, not as deployable credentials.
Inject LiveKit keys and TLS private keys through the infrastructure secret store. The TURN
certificate must be valid for the TURN hostname. If TLS terminates outside LiveKit, adapt the
deployment to the selected proxy/provider rather than committing certificate material.

For LiveKit Cloud, use its staging project URL and keys; managed TURN is supplied by the service.
For self-hosting, set `use_external_ip: true`, provide public firewall/NAT mappings, and verify both
UDP and TURN/TLS paths from a network outside the hosting environment.

The browser should not receive static TURN credentials. LiveKit supplies authorized ICE server
configuration during connection setup.

## Deploy

Frontend:

```bash
npm run build
```

Deploy `dist/` with only the four public `VITE_` variables. The token endpoint value must be the
public HTTPS API URL.

API:

```bash
npm run server:staging
```

In hosted staging, run the same Node entry point with server variables injected by the provider.
Set `ALLOWED_ORIGINS` to the exact staging frontend origin.

Before browser acceptance, verify:

```bash
npm run test:phase3-livekit
```

Then repeat the authorization matrix against staging: unauthenticated, invalid meeting, wrong
tenant/workspace, non-member, missing/left/removed participant, valid host, and valid participant.
Client-supplied identity, role, organization, and workspace values must never affect authorization.

## Two-browser acceptance

Use independent browser profiles so sessions and storage are isolated.

Browser A signs in as the staging host. Browser B signs in as the staging participant.

Record every item as `PASS`, `FAIL`, or `NOT TESTED — dependency unavailable`:

1. Host creates a meeting and verifies its tenant, code, and history state.
2. Host pre-join renders real preview; mic, camera, and device selectors work.
3. Host starts and joins; local video and audio publication appear.
4. Participant joins by code; both users receive remote video and audio.
5. Each user mutes/unmutes and toggles camera; remote indicators and placeholders update.
6. Users speak alternately; active-speaker highlighting and prioritization change.
7. Host starts and stops screen share; participant receives it and layout restores.
8. Both users exchange chat; sender, timestamp, scrolling, unread count, and meeting isolation hold.
9. Each supported reaction appears remotely and is removed after its animation.
10. Participant raises and lowers hand; host sees both transitions.
11. Host mute/remove and meeting lock work; participant requests to the moderation endpoint fail.
12. Participant leaves without ending the host's meeting.
13. Host explicitly ends; future joins fail and history reports `ended`.

## Reconnection and device failure

- Use browser network tools to take Browser B offline briefly, then restore it.
- Record `reconnecting`, `Connection restored`, media recovery, and participant coherence.
- Deny camera and microphone independently through browser site permissions.
- Test without camera/microphone where available.
- Disconnect a removable device during pre-join and during a call.
- Switch among multiple real devices if the hardware is available.

No test passes unless the UI remains usable without a blank screen or uncaught fatal error.

## Mobile

Use a physical mobile browser on a different network when possible. Verify pre-join, camera,
microphone, join, remote media, mute, camera toggle, chat, participant panel, and leave. Browser
responsive emulation is useful for layout but is not evidence of mobile WebRTC connectivity.

## Performance observation

Capture browser performance and network observations during the two-user call:

- CPU and memory while idle and while screen sharing
- mounted video-element count
- participant-page changes and active-speaker layout stability
- subscribed video tracks when participants are off-page
- network recovery and event-listener stability

The current client uses adaptive streaming, dynacast, simulcast, lazy-loaded meeting bundles, and
16-person video pagination. This is preparation for later scale testing, not evidence of
500-participant readiness.

## Final verification

```bash
npm run lint
npm run test
npm run build
git diff --check
git status --short --branch
```

Only commit a code fix discovered by real staging testing. Documentation and staging tooling may be
committed separately as staging preparation; never commit `.env.staging.local`, certificates, API
keys, database passwords, or test-account passwords.
