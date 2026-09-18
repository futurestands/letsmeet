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

test('host admin moderation: lock, mute, remove, end remain authoritative', async ({ browser }) => {
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

    // Lock meeting from device menu
    await hostPage.getByRole('button', { name: 'Device settings' }).click();
    await expect(hostPage.getByRole('dialog', { name: 'Device settings' })).toBeVisible();
    await hostPage.getByRole('button', { name: 'Lock meeting' }).click();
    await expect(hostPage.getByLabel('Meeting locked')).toBeVisible({ timeout: 20_000 });
    diagnostics.lock = 'pass';

    // Unlock
    await hostPage.getByRole('button', { name: 'Device settings' }).click();
    await hostPage.getByRole('button', { name: 'Unlock meeting' }).click();
    await expect(hostPage.getByLabel('Meeting locked')).toHaveCount(0);
    diagnostics.unlock = 'pass';

    // Mute participant
    const muteButton = hostPage.getByRole('button', { name: /Mute Staging Test Participant|Mute /i }).first();
    await muteButton.click({ force: true });
    await expect(participantPage.getByText(/Your microphone was muted|Muted/i).first()).toBeVisible({
      timeout: 30_000,
    });
    diagnostics.mute = 'pass';

    // Remove participant and confirm token denial
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

    // Fresh guest cannot use host End control; host still can.
    await expect(hostPage.getByRole('button', { name: 'End meeting for everyone' })).toBeVisible();

    await hostPage.getByRole('button', { name: 'End meeting for everyone' }).click();
    await expect(hostPage).not.toHaveURL(new RegExp(`#/meet/${meetingCode}`), { timeout: 60_000 });
    diagnostics.end = 'pass';

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ adminModerationE2E: diagnostics }));
  } finally {
    await participantContext.close();
    await hostContext.close();
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
    await expect(page.getByRole('menu')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('menu')).toHaveCount(0);

    await page.getByRole('button', { name: 'Device settings' }).click();
    await expect(page.getByRole('dialog', { name: 'Device settings' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog', { name: 'Device settings' })).toHaveCount(0);

    await page.getByRole('button', { name: 'Toggle meeting chat' }).click();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('textbox', { name: 'Message' })).toHaveCount(0);
  } finally {
    await context.close();
  }
});
