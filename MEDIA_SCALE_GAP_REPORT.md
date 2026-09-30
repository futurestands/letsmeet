# LeTsMeet Media Scalability Engineering Audit & Gap Report

---

## 1. Executive Summary & Classification
* **Branch**: `phase-1-saas-foundation`
* **HEAD**: `17c7a29`
* **Signalling & Token API Scale Target**: **PARTIALLY VERIFIED / RATE-LIMIT PROTECTED** (Verified up to 50 concurrent requests with Redis rate limit protection).
* **Frontend Virtualization & Subscription Control Architecture**: **CODE READY** (Paginated gallery grid rendering max 16 video tiles with active speaker auto-page tracking and selective track subscription).
* **50 Real Media Participants**: **NOT EMPIRICALLY VERIFIED (CODE READY)**
* **100 Real Media Participants**: **NOT EMPIRICALLY VERIFIED (CODE READY)**
* **250 Real Media Participants**: **NOT EMPIRICALLY VERIFIED (CODE READY)**
* **500 Signalling Requests**: **PARTIALLY VERIFIED / RATE-LIMIT PROTECTED**
* **500 Real Media Participants**: **PROVIDER REQUIRED / NOT VERIFIED** (500 real media streams require LiveKit Cloud or multi-region SFU cluster infrastructure).

---

## 2. Current Media Architecture Audit

### 2.1 Participant Media Subscription Control
* **Audio**: Managed independently via `<RoomAudioRenderer />`. All unmuted participants deliver audio streams to Web Audio elements. Non-speaking streams are gated by LiveKit SFU audio activity detection.
* **Video**: Controlled via `cameraSubscriptionIdentities` in [`src/lib/conference-utils.ts`](file:///C:/Users/MJ/Desktop/letsmeet/src/lib/conference-utils.ts). Video tracks are subscribed **ONLY** for participants on the active gallery page + pinned participant. Off-page participants have video subscriptions set to `'off'`.
* **Gallery Page Size**: Constrained to `GALLERY_PAGE_SIZE = 16` in [`ParticipantGrid.tsx`](file:///C:/Users/MJ/Desktop/letsmeet/src/components/ParticipantGrid.tsx).

### 2.2 Simulcast, Dynacast & Adaptive Streaming
* **Simulcast**: Enabled in `livekit-client` (`VideoPresets.h720`, `h360`, `h180`).
* **Dynacast**: Enabled (`dynacast: true`). SFU automatically pauses video track publication if no client subscribes to it.
* **Adaptive Stream**: Enabled (`adaptiveStream: true`). Low-bandwidth clients dynamically downgrade video quality.
* **Track Quality Levels**: `preferredRemoteVideoQuality` assigns `'high'` to pinned participants and primary active speakers, and `'low'` to secondary visible tiles.

### 2.3 Active-Speaker Prioritization & Auto-Page Tracking
* Active speakers are dynamically tracked via `useSpeakingParticipants()`.
* `compareParticipantTiles()` orders tiles in priority sequence: Local Participant -> Pinned Participant -> Active Speakers -> Alphabetical.
* `pageIndexForIdentity()` automatically navigates the gallery view to follow the primary active speaker unless the user has manually paged or pinned a participant.

### 2.4 Screen-Sharing & Presentation Stage
* Screen share tracks take stage priority over gallery grid.
* `{ onlySubscribed: true }` ensures screen shares are downloaded only when presentation mode is active.

### 2.5 Reconnect & Network Resilience
* Automatic LiveKit room reconnection with exponential backoff (`liveKitReconnectDelayMs`).
* Persistent host mute state stored in `meeting_participants` database table survives client page reloads and reconnects.

---

## 3. Scale Target Matrix & Classification

| Target | Signalling Status | Media Status | Client DOM Tiles | Audio Streams | Empirical Classification |
| --- | --- | --- | --- | --- | --- |
| **A. 50 Participants** | **PARTIALLY VERIFIED** | **CODE READY** | Max 16 | ~5 Active | **NOT EMPIRICALLY VERIFIED (CODE READY)** |
| **B. 100 Participants** | **PARTIALLY VERIFIED** | **CODE READY** | Max 16 | ~5 Active | **NOT EMPIRICALLY VERIFIED (CODE READY)** |
| **C. 250 Participants** | **PARTIALLY VERIFIED** | **CODE READY** | Max 16 | ~8 Active | **NOT EMPIRICALLY VERIFIED (CODE READY)** |
| **D. 500 Signalling** | **PARTIALLY VERIFIED** | **CODE READY** | Max 16 | ~10 Active | **PARTIALLY VERIFIED / RATE-LIMIT PROTECTED** |
| **E. 500 Real Media** | **CODE READY** | **PROVIDER REQUIRED** | Max 16 | ~10 Active | **PROVIDER REQUIRED / NOT VERIFIED** |

---

## 4. Required Production Infrastructure Dependencies
1. **LiveKit Cloud / Multi-Node SFU Cluster**: Required for 500 simultaneous media streams (`PROVIDER REQUIRED`).
2. **S3/R2 Object Storage Credentials**: Required for recording egress completion (`RECORDING_STORAGE_BUCKET`, `RECORDING_STORAGE_ACCESS_KEY`, `RECORDING_STORAGE_SECRET`, `RECORDING_STORAGE_REGION`) (`PROVIDER REQUIRED`).
3. **Payment Gateway API Keys**: Required for live subscription checkout (`PROVIDER REQUIRED`).
