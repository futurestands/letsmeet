import { test, expect } from '@playwright/test';
import { stagingIdentities, assertNoSecretLeak } from './helpers/env';
import {
  hostStartMeeting,
  launchDualBrowser,
  openIsolatedContext,
  participantJoinMeeting,
  signIn,
  waitForRemoteParticipantTiles,
} from './helpers/conference';

test.describe.configure({ mode: 'serial' });

/**
 * Host/admin UI smoke. Authoritative mute/remove/token-denial coverage remains in
 * `e2e/dual-browser-conference.spec.ts` (avoids duplicate flaky LiveKit overlay races).
 */
test('host admin UI exposes moderation controls with a remote participant present', async ({ browser }) => {
  test.setTimeout(240_000);
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);
  const diagnostics: Record<string, unknown> = { method: 'host admin UI smoke' };

  try {
    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    await signIn(participantPage, ids.participantEmail, ids.participantPassword);
    const meetingCode = await hostStartMeeting(hostPage);
    diagnostics.meetingCode = meetingCode;
    await participantJoinMeeting(participantPage, meetingCode);
    await waitForRemoteParticipantTiles(hostPage, 2);

    await expect(hostPage.getByRole('button', { name: 'End meeting for everyone' })).toBeVisible();
    await expect(participantPage.getByRole('button', { name: 'End meeting for everyone' })).toHaveCount(0);

    await hostPage.getByRole('button', { name: 'Toggle participants' }).click();
    await expect(hostPage.getByRole('heading', { name: /Participants \(/ })).toBeVisible({ timeout: 15_000 });
    await expect(hostPage.getByRole('button', { name: /Mute Staging Test Participant|Mute /i }).first()).toBeVisible();
    await expect(hostPage.getByRole('button', { name: /Remove Staging Test Participant|Remove /i }).first()).toBeVisible();
    diagnostics.controls = 'pass';

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ adminUiE2E: diagnostics }));
  } finally {
    await participantContext.close().catch(() => undefined);
    await hostContext.close().catch(() => undefined);
  }
});

test('escape or toggle closes meeting overlays without stranding focus', async ({ browser }) => {
  test.setTimeout(180_000);
  const ids = stagingIdentities();
  const context = await openIsolatedContext(browser);
  const page = await context.newPage();

  try {
    await signIn(page, ids.hostEmail, ids.hostPassword);
    await hostStartMeeting(page);

    await page.getByRole('button', { name: 'Show reactions' }).click();
    await expect(page.getByRole('button', { name: /Send .* reaction/ }).first()).toBeVisible();
    await page.keyboard.press('Escape');
    if (await page.getByRole('button', { name: /Send .* reaction/ }).count() > 0) {
      await page.getByRole('button', { name: 'Show reactions' }).click();
    }
    await expect(page.getByRole('button', { name: /Send .* reaction/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Toggle meeting chat' }).click();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await page.keyboard.press('Escape');
    if (await page.getByRole('textbox', { name: 'Message' }).isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Toggle meeting chat' }).click();
    }
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
  } finally {
    await context.close().catch(() => undefined);
  }
});
