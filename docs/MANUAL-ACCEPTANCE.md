# Manual acceptance gates

Automated suites cannot prove perception, capture, or full SR coverage.  
**RESULT** and **STATUS** below are left blank until a human runs each test.

Status vocabulary: `PASS` | `FAIL` | `NOT RUN`

---

## TEST: Human-ear two-way audio

**STEPS**
1. Host and participant join the same staging meeting on two devices/browsers.
2. Host speaks; participant listens with headphones.
3. Participant speaks; host listens.
4. Mute/unmute both sides; host mute-other once.
5. Change input device if available; briefly interrupt network and reconnect.

**EXPECTED RESULT**
Clear two-way speech both directions; mute stops audio; reconnect restores hearing without auth bypass or blank UI.

**RESULT:** _(not run in automation)_

**STATUS:** NOT RUN

---

## TEST: Real screen sharing

**STEPS**
1. Host starts screen/window share of a known visual.
2. Participant confirms the share stage shows the correct content.
3. Host stops share.
4. Confirm camera tiles restore for both sides.

**EXPECTED RESULT**
Participant sees real shared pixels; stop share restores gallery; no fake capture.

**RESULT:** Automation covers control path + remote “is presenting” when Chromium fake capture works (`npm run test:e2e:screen`). Real OS window pixels remain human-verified.

**STATUS:** PARTIAL — automated when capture available; OS capture NOT RUN

---

## TEST: Host meeting moderation (browser)

**STEPS**
1. Host creates/starts meeting; participant joins.
2. Host locks then unlocks meeting.
3. Host mutes participant; host removes participant.
4. Host ends meeting for everyone.

**EXPECTED RESULT**
UI + LiveKit moderation remain authoritative after refresh/reconnect; removed participant cannot mint a new token.

**RESULT:** Mute/remove/end covered by `npm run test:e2e:admin` and dual-browser gate. Lock/unlock remains best-effort in UI (device menu can be covered by LiveKit name overlays); Phase 3 DB suite covers lock RPC security.

**STATUS:** STAGING VERIFIED (mute/remove/end automated); lock UI MANUAL OPTIONAL

---

## TEST: Admin browser account

**STEPS**
1. Sign in as an organization **admin** (not owner).
2. Open Settings: confirm allowed admin actions work.
3. Attempt owner-only operations (e.g. destructive ownership changes if exposed).
4. Bypass UI and call restricted RPCs; confirm backend rejection where required.

**EXPECTED RESULT**
Admin can administer allowed surfaces; owner-only paths fail server-side.

**RESULT:** _(no dedicated staging admin browser identity)_

**STATUS:** NOT RUN

---

## TEST: Guest browser account (share-link, no account)

**STEPS**
1. Host creates/starts a meeting on staging Preview and copies the share link / code.
2. Open an isolated browser context with no cookies/localStorage auth.
3. Open only `/#/join/<code>` — do not sign in or create an account.
4. Enter display name, join, confirm LiveKit room + host visibility.
5. Confirm guest has no org/workspace membership and no host End control.

**EXPECTED RESULT**
Guest reaches the real meeting without registration, login, or org/workspace membership.

**RESULT:** Automated via `npm run test:e2e:guest` + `npm run test:guest-security` on staging (see PRODUCTION-READINESS). Human exploratory check still useful for UX polish.

**STATUS:** STAGING VERIFIED (automated); exploratory UX MANUAL OPTIONAL

---

## TEST: Screen-reader accessibility smoke

**STEPS**
1. With NVDA or VoiceOver, sign in, open schedule, open settings, join a meeting.
2. Tab through meeting controls, chat, and collaboration panel.
3. Trigger an error (e.g. bad join) and confirm it is announced or focus-moved.

**EXPECTED RESULT**
Controls have names; focus is usable; no silent critical failures.  
Not a WCAG certification.

**RESULT:** _(not run)_

**STATUS:** NOT RUN

---

## TEST: Large media soak

**STEPS**
1. Follow `scripts/media-scale-harness.md` with LiveKit load agents.
2. Ramp 10 → 25 → 50 → 100 → 250.
3. Record join success, latency, CPU, packet loss, reconnects.

**EXPECTED RESULT**
Documented metrics per stage; no claim of 500 without evidence.

**RESULT:** _(not run)_

**STATUS:** NOT RUN

---

## Related docs

- `docs/MANUAL-AUDIO.md`
- `docs/SCREEN-SHARE.md`
- `docs/ACCESSIBILITY.md`
- `docs/MEDIA-SCALE.md`
