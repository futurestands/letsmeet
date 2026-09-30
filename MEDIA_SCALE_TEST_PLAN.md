# LeTsMeet Real Media Scale Test Plan

---

## 1. Objective & Scope
The objective of this test plan is to establish a deterministic, empirical load-testing framework to measure the maximum sustained participant capacity of LeTsMeet across signalling, WebRTC media transport, client DOM rendering, and SFU infrastructure layers.

---

## 2. Test Tiers

| Tier | Target Participants | Publishers | Subscribed Video Tiles per Client | Target Audio Subscribers | Primary Verification Goal |
| --- | --- | --- | --- | --- | --- |
| **Tier 1** | 25 Participants | 25 Camera / 25 Mic | Max 16 (Paginated) | 25 Audio Tracks | Small room WebRTC media continuity & active speaker tracking. |
| **Tier 2** | 50 Participants | 50 Camera / 50 Mic | Max 16 (Paginated) | 50 Audio Tracks | Mid-sized room Dynacast layer suppression & Web Audio scaling. |
| **Tier 3** | 100 Participants | 100 Camera / 100 Mic | Max 16 (Paginated) | 100 Audio Tracks | Single-node SFU bandwidth fanout & token API join waves. |
| **Tier 4** | 250 Participants | 250 Camera / 250 Mic | Max 16 (Paginated) | 250 Audio Tracks | Large room client DOM virtualization & Supabase Realtime event fanout. |
| **Tier 5** | 500 Participants | 500 Camera / 500 Mic | Max 16 (Paginated) | 500 Audio Tracks | Multi-region SFU cluster media routing & rate-limited token issuance. |

---

## 3. Measurable Metrics Matrix

### 3.1 Signalling Metrics
- **Join Success Rate**: Percentage of join attempts returning HTTP 200 and connecting to LiveKit room within 5 seconds.
- **Join Latency**: Time from user click/request to LiveKit room `Connected` state event.
- **Reconnect Success Rate**: Percentage of clients successfully reconnecting after simulated network disconnect.
- **Rate-Limit Behavior**: Verification that HTTP 429 is returned gracefully under burst join waves without crashing database connection pools.

### 3.2 WebRTC Media Metrics
- **Published Tracks**: Number of active camera and microphone tracks published to the SFU.
- **Subscribed Camera Tracks**: Bounded to <= 16 subscribed video tracks per client via `GALLERY_PAGE_SIZE`.
- **Subscribed Audio Tracks**: Unbound Web Audio playback for unmuted participants, gated by SFU audio activity detection.
- **Dynacast Layer Suppression**: Verification that off-page participant video streams are set to `'off'` on the SFU.
- **Simulcast Negotiation**: Verification that low/medium/high simulcast video layers (`h180`, `h360`, `h720`) adaptively switch based on tile size.
- **Packet Loss & Connection Quality**: Measured via WebRTC `getStats()` (target: <2% packet loss).

### 3.3 Client Resource Usage
- **DOM Video Elements**: Max 16 `<video>` elements rendered in DOM.
- **Client CPU Usage**: Target <25% CPU utilization on quad-core desktop client.
- **Client Memory (RAM)**: Target <250MB WebAssembly/JS heap memory.
- **Received / Transmitted Bandwidth**: Target ~1.5 - 2.5 Mbps received per client.

### 3.4 SFU / Provider Telemetry
- **SFU CPU & Memory**: SFU server CPU and RAM utilization.
- **Ingress / Egress Bandwidth**: Aggregate network throughput at SFU edge nodes.
- **Connection Failures**: WebRTC ICE / DTLS handshake failure count.

---

## 4. Headless WebRTC Load Test Harness Architecture
- **Synthetic Media Sources**: Headless WebRTC agents publishing synthetic YUV video canvas and 440Hz sine-wave audio streams.
- **Controlled Join Waves**: Ramping join waves (e.g. 5 clients/sec) with randomized join delays to simulate organic user joins without overwhelming token API rate limiters.
- **Automated Teardown & Cleanup**: Test agents disconnect gracefully, triggering database cleanup of participant records.

---

## 5. Empirical Classification Guidelines
- **VERIFIED**: Requires empirical WebRTC media stream execution with actual published/subscribed tracks and measured WebRTC stats.
- **PARTIALLY VERIFIED**: Signalling or code architecture verified, but full media fanout under load is unverified.
- **PROVIDER REQUIRED**: Requires multi-region LiveKit Cloud SFU cluster or external payment/storage provider credentials.
