# LeTsMeet WebRTC Media Scale Load Test Execution Guide

---

## 1. Overview
This document specifies the execution setup, environment requirements, CLI options, and execution commands for the deterministic WebRTC media load test harness ([`scripts/media-scale-load.mjs`](file:///C:/Users/MJ/Desktop/letsmeet/scripts/media-scale-load.mjs)).

The harness executes real multi-participant WebRTC media sessions targeting the LeTsMeet staging environment using synthetic Chromium browser media agents with fake audio/video devices.

---

## 2. Environment Prerequisites
To run real WebRTC media agents locally or in CI, the test runner node must have Playwright Chromium browser binaries installed:

```bash
# Install Playwright browser binaries (required for WebRTC browser agents)
npx playwright install chromium
```

If Playwright Chromium browser binaries are absent, the harness detects the missing resource and reports:
`CLASSIFICATION: ENVIRONMENT FAILURE — Limiting Resource: Playwright Chromium browser binaries missing`
and generates a JSON artifact in `artifacts/media-scale/`.

---

## 3. CLI Execution Options
The load harness supports the following CLI options:
- `--participants=25` (Target number of WebRTC participants; default: 25)
- `--join-delay-ms=500` (Stagger delay between participant join attempts in ms; default: 500)
- `--soak-seconds=15` (Duration to hold WebRTC session connected and collect stats; default: 15)
- `--stats-interval-ms=5000` (Sampling interval for WebRTC `getStats()`; default: 5000)

---

## 4. Execution Commands

### 4.1 Run Tier 1 (25 Participants)
```bash
node --env-file=.env.staging.local scripts/media-scale-load.mjs --participants=25
```

### 4.2 Run Tier 2 (50 Participants)
```bash
node --env-file=.env.staging.local scripts/media-scale-load.mjs --participants=50
```

### 4.3 Run Tier 3 (100 Participants)
```bash
node --env-file=.env.staging.local scripts/media-scale-load.mjs --participants=100
```

### 4.4 Run Signalling & Token Endpoint Concurrency Benchmark
```bash
node --env-file=.env.staging.local scripts/token-perf-fast.mjs
```

---

## 5. Artifacts Generated
Upon completion, the harness outputs a machine-readable JSON artifact to:
`artifacts/media-scale/<timestamp>_tier_<count>.json`

Example structure:
```json
{
  "tier": 25,
  "classification": "VERIFIED",
  "participants": {
    "target": 25,
    "joined": 25,
    "publishedAudio": 25,
    "publishedVideo": 25,
    "stable": 25
  },
  "joinLatencyMs": { "p50": 1240, "p95": 2180, "max": 2850 },
  "webrtc": { "packetLoss": "< 1%", "rttMs": { "p50": 42, "p95": 88 }, "reconnects": 0 },
  "client": { "maxVideoElements": 16, "maxCameraSubscriptions": 16 },
  "failures": []
}
```
