# LeTsMeet Real Media Scale Results & Empirical Analysis

---

## 1. Environment & Setup
* **Environment**: Staging (`.env.staging.local` / PostgreSQL `uasslvisjnwhdhcgqwyc` in `eu-west-2`).
* **LiveKit Server**: Staging LiveKit Host (`https://letsmeet-staging-1lkr2c90.livekit.cloud`).
* **Test Date**: September 2026.
* **HEAD Commit**: `a46d105`.
* **Execution Harness**: [`scripts/media-scale-load.mjs`](file:///C:/Users/MJ/Desktop/letsmeet/scripts/media-scale-load.mjs).

---

## 2. Real WebRTC Media Load Test Results

| Tier | Real Participants | Published Video | Published Audio | Join Success | Reconnects | Packet Loss | RTT | Result | Limiting Resource / Reason |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| **Tier 1 (25)** | 0 | 0 | 0 | 0% | 0 | NOT AVAILABLE | NOT AVAILABLE | **ENVIRONMENT FAILURE** | Playwright Chromium browser binaries missing locally (`npx playwright install chromium` required). |
| **Tier 2 (50)** | 0 | 0 | 0 | 0% | 0 | NOT AVAILABLE | NOT AVAILABLE | **ENVIRONMENT FAILURE** | Blocked until Tier 1 succeeds with installed browser binaries. |
| **Tier 3 (100)** | 0 | 0 | 0 | 0% | 0 | NOT AVAILABLE | NOT AVAILABLE | **ENVIRONMENT FAILURE** | Blocked until Tier 2 succeeds. |
| **Tier 4 (250)** | 0 | 0 | 0 | 0% | 0 | NOT AVAILABLE | NOT AVAILABLE | **NOT EMPIRICALLY VERIFIED** | Unverified. |
| **Tier 5 (500)** | 0 | 0 | 0 | 0% | 0 | NOT AVAILABLE | NOT AVAILABLE | **PROVIDER REQUIRED** | Multi-node LiveKit SFU Cloud Cluster required for 500 media streams. |

---

## 3. Signalling & Token API Concurrency Results (`scripts/token-perf-fast.mjs`)

* **N=1 Concurrency**: 1/1 OK (100%), p50 = **24.6s** (cold start connection pool initialization).
* **N=10 Concurrency**: 10/10 OK (100%), p50 = **1859ms**, p95 = **3847ms** (100% success rate under burst join wave).
* **N=25 Concurrency**: 9/25 OK (36%), p50 = **1217ms**, p95 = **1582ms** | Redis rate limiter active (16 requests blocked with HTTP 429).
* **N=50 Concurrency**: 0/50 OK (0%), p50 = **1789ms** | Redis rate limiter enforced 100% protection (50 requests blocked with HTTP 429).

---

## 4. Client DOM Virtualization & Subscription Control Architecture
* **Max Rendered DOM Video Elements**: **16 tiles** (`GALLERY_PAGE_SIZE = 16` in [`src/components/ParticipantGrid.tsx`](file:///C:/Users/MJ/Desktop/letsmeet/src/components/ParticipantGrid.tsx)).
* **Off-Page Track Subscription**: Verified in [`src/lib/conference-utils.ts`](file:///C:/Users/MJ/Desktop/letsmeet/src/lib/conference-utils.ts) (`cameraSubscriptionIdentities` sets `preferredRemoteVideoQuality = 'off'` for off-page tiles).
* **Active Speaker Prioritization**: Verified in [`src/lib/conference-utils.ts`](file:///C:/Users/MJ/Desktop/letsmeet/src/lib/conference-utils.ts) (`compareParticipantTiles` orders active speakers first; `pageIndexForIdentity` auto-navigates gallery pages).

---

## 5. System Bottlenecks Summary
1. **ENVIRONMENT_FAILURE**: Local test runner node lacks installed Playwright Chromium browser binaries (`npx playwright install chromium` required on machine to launch WebRTC agents).
2. **TOKEN_API_RATE_LIMIT**: Token issuance rate limiter enforces protection at N>10 burst concurrency, protecting database connection pools.
3. **LIVEKIT_PROVIDER_LIMIT**: 500 real simultaneous media stream fanouts require multi-node LiveKit Cloud cluster infrastructure (`PROVIDER REQUIRED`).

---

## 6. Next Engineering Step
1. Execute `npx playwright install chromium` on test runner node to install Chromium browser binaries.
2. Execute `node --env-file=.env.staging.local scripts/media-scale-load.mjs --participants=25` to collect empirical WebRTC stats across Tier 1 (25).
