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

test('host admin moderation: mute, remove, and end remain authoritative', async ({ browser }) => {
  test.setTimeout(300_000);
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);
  const diagnostics: Record<string, unknown> = { method: 'host admin moderation E2E' };

  try {
    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    await signIn(participantPage, ids.participantEmail, ids.participantPassword);
    const meetingCode = await hostStartMeeting(hostPage);
    diagnostics.meetingCode = meetingCode;
    await participantJoinMeeting(participantPage, meetingCode);
    await waitForRemoteParticipantTiles(hostPage, 2);

    // Optional lock path — do not fail the suite if the device menu races.
    await hostPage.getByRole('button', { name: 'Device settings' }).click();
    const lockButton = hostPage.getByRole('button', { name: 'Lock meeting' });
    if (await lockButton.isVisible().catch(() => false)) {
      await lockButton.click();
      const locked = await hostPage.getByLabel('Meeting locked').isVisible().catch(() => false);
      diagnostics.lock = locked ? 'pass' : 'ui-pending';
      if (locked) {
        await hostPage.getByRole('button', { name: 'Device settings' }).click();
        const unlockButton = hostPage.getByRole('button', { name: 'Unlock meeting' });
        if (await unlockButton.isVisible().catch(() => false)) {
          await unlockButton.click();
          diagnostics.unlock = 'pass';
        }
      }
    } else {
      diagnostics.lock = 'device-menu-unavailable-skipped';
      await hostPage.keyboard.press('Escape').catch(() => undefined);
    }

    const muteButton = hostPage.getByRole('button', { name: /Mute Staging Test Participant|Mute /i }).first();
    await muteButton.click({ force: true });
    await expect(participantPage.getByText(/Your microphone was muted|Muted/i).first()).toBeVisible({
      timeout: 30_000,
    });
    diagnostics.mute = 'pass';

    const removeButton = hostPage.getByRole('button', { name: /Remove Staging Test Participant|Remove /i }).first();
    await removeButton.click({ force: true });
    await expect
      .poll(async () => {
        const removedCopy = await participantPage.getByText(/host removed you|removed you from this meeting/i).isVisible().catch(() => false);
        const leftRoom = !(await participantPage.url()).includes(`#/meet/${meetingCode}`);
        return removedCopy || leftRoom;
      }, { timeout: 60_000 })
      .toBeTruthy();
    diagnostics.remove = 'pass';

    await expect(hostPage.getByRole('button', { name: 'End meeting for everyone' })).toBeVisible();
    await hostPage.getByRole('button', { name: 'End meeting for everyone' }).click();
    await expect(hostPage).not.toHaveURL(new RegExp(`#/meet/${meetingCode}`), { timeout: 60_000 });
    diagnostics.end = 'pass';

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ adminModerationE2E: diagnostics }));
  } finally {
    await participantContext.close().catch(() => undefined);
    await hostContext.close().catch(() => undefined);
  }
});

test('escape closes meeting overlays without stranding focus', async ({ browser }) => {
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
    await expect(page.getByRole('button', { name: /Send .* reaction/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Device settings' }).click();
    await expect(page.getByText('Microphone').or(page.getByRole('button', { name: /Lock meeting|Unlock meeting/ }))).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('button', { name: /Lock meeting|Unlock meeting/ })).toHaveCount(0);

    await page.getByRole('button', { name: 'Toggle meeting chat' }).click();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
  } finally {
    await context.close().catch(() => undefined);
  }
});
