# Self-hosted LiveKit setup for LeTsMeet

This project includes a real browser conferencing client, a server-authorized token endpoint,
and a host-only moderation endpoint for a self-hosted LiveKit service.

For the complete non-production deployment, TURN, test-account, and two-browser procedure, see
`docs/PHASE-3-STAGING-VALIDATION.md`.

## What to do next

1. Apply database migrations through `005_realtime_conferencing.sql`.
2. Update an ignored environment file with the public browser values and server-only secrets shown in `.env.example`.
3. Set `LIVEKIT_HOST` to the HTTP(S) LiveKit API origin used by the server SDK. Do not expose
   `LIVEKIT_API_SECRET` or `SUPABASE_SERVICE_ROLE_KEY` through a `VITE_` variable.
4. Start the token endpoint:
   npm run server:livekit-token
5. Start the LiveKit container:
   docker compose up -d
6. Open the app and start a meeting.

## Local development defaults

The included `livekit.yaml` uses placeholder credentials:
- API key: `devkey`
- API secret: `secretkey`

These are only for local development. Replace them with your own real credentials for any real deployment.

## Recommended production setup

For a real deployment, use:
- a proper LiveKit server deployment
- real API key / secret values
- proper TLS / hostnames
- Redis + TURN service if needed

## Notes

The frontend already points to the token endpoint at `http://localhost:3001/api/livekit/token` by default in `.env.example`.
Host moderation uses `http://localhost:3001/api/livekit/moderate` and independently verifies the
authenticated user, stored host identity, meeting tenant, target participant, and action.

The client uses adaptive streaming, dynacast, simulcast, visibility-managed subscriptions, and a
16-tile paginated grid. These are scaling foundations, not a claim of 500-participant production
readiness. Redis, TURN validation, distributed LiveKit, observability, and load testing remain
deployment work.
