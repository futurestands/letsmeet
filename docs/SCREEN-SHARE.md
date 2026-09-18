# Screen share verification

## Implementation

Screen share publish/subscribe is implemented in the LiveKit conference path.

- Host can request screen share via LiveKit local participant APIs
- Participants receive screen-share tracks in `ParticipantGrid` (priority stage above gallery)
- Stopping share returns the gallery to camera tiles

## Automation status

| Claim | Status |
|---|---|
| Implementation present | VERIFIED (code + unit/layout path) |
| Deterministic automated capture source | AUTOMATED CAPTURE UNAVAILABLE in current Playwright/CI Windows/Linux agents without unsafe OS capture injection |
| End-to-end host→participant screen pixels | MANUAL TEST REQUIRED |

## Manual gate

1. Host starts screen share of a known window/tab
2. Participant sees the share stage with presenter label
3. Host stops share
4. Camera tiles restore correctly for both sides

Do not fake capture sources in CI.
