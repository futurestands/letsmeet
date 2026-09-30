# LeTsMeet WebRTC Media Scale Load Test Execution Guide

---

## 1. Overview
This document specifies the execution setup, environment requirements, and execution commands for the deterministic WebRTC media load test harness ([`scripts/media-scale-load.mjs`](file:///C:/Users/MJ/Desktop/letsmeet/scripts/media-scale-load.mjs)).

The harness executes real multi-participant WebRTC media sessions targeting the LeTsMeet staging environment using synthetic Chromium browser media agents with fake audio/video devices.

---

## 2. Environment Prerequisites
To run real WebRTC media agents locally or in CI, the test runner node must have Playwright Chromium browser binaries installed:

```bash
# Install Playwright browser binaries (required for WebRTC browser agents)
npx playwright install chromium
```

If Playwright Chromium browser binaries are absent, the harness detects the missing resource and reports:
`ENVIRONMENT FAILURE — Limiting Resource: Playwright Chromium browser binaries missing`

---

## 3. Execution Commands

### 3.1 Run WebRTC Media Load Test Harness
```bash
node --env-file=.env.staging.local scripts/media-scale-load.mjs
```

### 3.2 Run Signalling & Token Endpoint Concurrency Benchmark
```bash
node --env-file=.env.staging.local scripts/token-perf-fast.mjs
```

---

## 4. Test Tiers & Execution Sequence
1. **Tier 1 (25 Participants)**: Executes 25 concurrent WebRTC media participants.
2. **Tier 2 (50 Participants)**: Executed ONLY if Tier 1 succeeds (`VERIFIED`).
3. **Tier 3 (100 Participants)**: Executed ONLY if Tier 2 succeeds (`VERIFIED`).

---

## 5. Metrics Collected
- **Join Success Rate**: Percentage of WebRTC clients successfully connecting to LiveKit room.
- **Published Video / Audio Tracks**: Number of synthetic video/audio tracks published.
- **Subscribed Video Tiles**: Verification that rendered video elements stay <= 16 (`GALLERY_PAGE_SIZE`).
- **WebRTC Stats**: `getStats()` packet loss, RTT, received bitrate, and disconnect/reconnect counts.
