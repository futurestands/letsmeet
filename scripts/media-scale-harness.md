# Media scale harness (procedure)

Do not spawn 500 full GUI browsers.

## Prerequisites

- Staging LiveKit host + API key/secret (Render env)
- Staging meeting code with host participant
- LiveKit load tooling (official CLI / server SDK agents) installed on the operator machine

## Ramp

| Stage | Publishers | Subscribers | Pass criteria |
|---|---|---|---|
| 10 | 10 muted | 2 real browsers optional | Join success ≥99%, audio/video stable |
| 25 | 25 | 2 | Join latency p95 documented |
| 50 | 50 | 2 | No cascade disconnects |
| 100 | 100 | 2 | Selective subscribe holds CPU |
| 250 | 250 | 2 | Packet loss / SFU CPU within budget |
| 500 | only after 250 | 2 | Explicit capacity decision |

## Metrics to capture

- join success / join latency (p50/p95/p99)
- client CPU / memory
- uplink/downlink bandwidth
- packet loss
- reconnects
- subscription errors
- audio/video freezes

## Claims

Running this document alone does **not** verify capacity. Record results into `docs/MEDIA-SCALE.md` only after execution.
