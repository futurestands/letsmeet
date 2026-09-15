# Self-hosted LiveKit setup for LeTsMeet

This project now includes the pieces needed to connect the app to a self-hosted LiveKit service.

## Files added
- `docker-compose.yml`
- `livekit.yaml`
- `server/livekit-token.mjs`
- `.env.example` updated with LiveKit values

## What to do next

1. Update `.env.local` with your real values.
2. Start the token endpoint:
   npm run server:livekit-token
3. Start the LiveKit container:
   docker compose up -d
4. Open the app and start a meeting.

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
