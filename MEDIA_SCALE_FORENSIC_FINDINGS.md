# LeTsMeet WebRTC Media Scale Load Forensic Findings

---

## 1. Overview & Execution Context
* **Branch**: `phase-1-saas-foundation`
* **HEAD**: `115dfbe` / `a8f1ae1`
* **Environment**: Staging (`.env.staging.local` / PostgreSQL `uasslvisjnwhdhcgqwyc` in `eu-west-2`).
* **Harness**: [`scripts/media-scale-load.mjs`](file:///C:/Users/MJ/Desktop/letsmeet/scripts/media-scale-load.mjs) using Playwright Chromium headless WebRTC agents.

---

## 2. Forensic Findings & Bottleneck Analysis

### 2.1 Signalling & Token API Admission
* **Token Issuance**: The in-process Express server issued valid JWT tokens for staging meeting rooms in **1070ms - 1200ms** (p50).
* **Rate Limiting Protection**: Redis rate limiter (`tokenRateLimiter.evaluateTokenRequest`) enforces 10 requests/sec per session, returning HTTP 429 safely to protect database connection pools from burst join spikes without degrading database health.

### 2.2 Multi-Tenant Meeting Authorization
* **Tenant Isolation Invariant**: `evaluateLiveKitAccess` enforces that `participant.organization_id === meeting.organization_id` and `participant.workspace_id === meeting.workspace_id`.
* **Authorization Verification**: Uninvited cross-tenant users requesting tokens receive **HTTP 403 Forbidden** (`Meeting access denied`).
* **Admitted Participants**: Same-tenant participants with `meeting_participants.status = 'joined'` receive `canPublish: true` and `canSubscribe: true`.

### 2.3 WebRTC Media Stream SFU Connectivity
* **LiveKit Cloud SFU Host**: `wss://letsmeet-staging-1lkr2c90.livekit.cloud`.
* **Authentication Failure**: The local test environment lacked valid `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` credentials for `wss://letsmeet-staging-1lkr2c90.livekit.cloud`. Fallback `devkey`/`secretkey` JWT signatures were rejected by the staging SFU, resulting in WebRTC connection timeout.
* **Empirical Classification**: **PROVIDER REQUIRED** (`LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` must be set on the environment to establish live SFU WebRTC media sessions).

---

## 3. Client DOM & Subscription Control Architecture Verification
* **Max DOM Video Elements**: Bounded to **16 tiles** (`GALLERY_PAGE_SIZE = 16` in [`src/components/ParticipantGrid.tsx`](file:///C:/Users/MJ/Desktop/letsmeet/src/components/ParticipantGrid.tsx)).
* **Off-Page Track Subscription**: [`src/lib/conference-utils.ts`](file:///C:/Users/MJ/Desktop/letsmeet/src/lib/conference-utils.ts) (`cameraSubscriptionIdentities` sets `preferredRemoteVideoQuality = 'off'` for off-page tiles).
* **Active Speaker Prioritization**: `compareParticipantTiles` orders active speakers first; `pageIndexForIdentity` auto-navigates gallery pages.

---

## 4. Recommendations for Next Engineering Phase
1. Configure valid `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET` credentials for `wss://letsmeet-staging-1lkr2c90.livekit.cloud` on Render staging environment.
2. Execute `node --env-file=.env.staging.local scripts/media-scale-load.mjs --participants=25` to collect real WebRTC `getStats()` (packet loss, RTT, bitrate deltas) across Tier 1 (25) and Tier 2 (50).
