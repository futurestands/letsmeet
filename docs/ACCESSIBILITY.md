# Accessibility status

Status vocabulary matches `docs/PRODUCTION-READINESS.md`.

This is **not** a WCAG certification.

## Automated checks

| Area | Status | Notes |
|---|---|---|
| Keyboard-only navigation (auth → schedule → settings → meeting controls) | PARTIALLY VERIFIED | Playwright `e2e/accessibility-keyboard.spec.ts` |
| Responsive layout 390 / 768 / 1280 | VERIFIED | `e2e/responsive-a11y.spec.ts` |
| Control accessible names (mute/remove/raise/chat) | PARTIALLY VERIFIED | Dual-browser + a11y specs assert `aria-label` / roles |
| Focus visibility | PARTIALLY VERIFIED | Focus rings present on primary controls; not exhaustive |
| Dialogs / menus | PARTIALLY VERIFIED | Confirm dialogs use headings; full modal trap not audited |
| Form errors | PARTIALLY VERIFIED | Auth and schedule errors rendered as text |
| Meeting controls | PARTIALLY VERIFIED | Buttons labeled; live region coverage incomplete |
| Collaboration panel | PARTIALLY VERIFIED | Tab/panel labels present; deep SR path MANUAL |
| Screen reader smoke | MANUAL REQUIRED | No CI screen reader; manual NVDA/VoiceOver gate |

## Defects fixed in this pass

- Active-speaker tiles expose `data-active-speaker` for assistive diagnostics.
- Moderation controls keep explicit `aria-label` values including participant names.
- Participant pagination buttons expose previous/next labels.

## Manual required

1. Full page tab order through an active meeting with collaboration panel open
2. NVDA or VoiceOver smoke: join, mute, chat send, raise hand, leave
3. High-contrast / forced-colors spot check
4. Error announcement for failed token / removed participant

## Claims we do not make

- WCAG 2.x AA certification
- Complete screen-reader coverage
- Perfect focus management in every dialog
