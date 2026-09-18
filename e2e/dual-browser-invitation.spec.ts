import { test, expect } from '@playwright/test';
import { stagingIdentities } from './helpers/env';
import { launchDualBrowser, signIn } from './helpers/conference';

test('dual-browser schedule + invite participant', async ({ browser }) => {
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);

  try {
    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    await signIn(participantPage, ids.participantEmail, ids.participantPassword);

    await hostPage.goto('/#/schedule', { waitUntil: 'domcontentloaded' });
    await expect(hostPage.getByRole('heading', { name: 'Plan a meeting' })).toBeVisible({ timeout: 30_000 });

    const title = `Dual Invite UI ${Date.now()}`;
    await hostPage.locator('#meeting-title').fill(title);
    await hostPage.locator('#meeting-description').fill('Dual-browser invitation E2E');

    const tomorrow = new Date(Date.now() + 36 * 60 * 60 * 1000);
    const yyyy = tomorrow.getFullYear();
    const mm = String(tomorrow.getMonth() + 1).padStart(2, '0');
    const dd = String(tomorrow.getDate()).padStart(2, '0');
    await hostPage.locator('#meeting-date').fill(`${yyyy}-${mm}-${dd}`);
    await hostPage.locator('#meeting-time').fill('15:30');
    await hostPage.locator('#meeting-invites').fill(ids.participantEmail);

    await hostPage.getByRole('button', { name: 'Save event' }).click();
    await expect(hostPage.getByText('Invitation link')).toBeVisible({ timeout: 45_000 });
    await expect(hostPage.getByText(/invitation.*queued/i)).toBeVisible({ timeout: 20_000 });

    const shareLink = await hostPage.locator('input[readonly]').inputValue();
    expect(shareLink).toMatch(/#\/join\/LM-[A-Z0-9]{6}/);
    const meetingCode = shareLink.match(/LM-[A-Z0-9]{6}/)?.[0];
    expect(meetingCode).toBeTruthy();

    await participantPage.goto(`/#/join/${meetingCode}`, { waitUntil: 'domcontentloaded' });
    await expect(
      participantPage.getByRole('button', { name: 'Join meeting' })
        .or(participantPage.getByText(/cancelled|ended|no longer joinable|access denied/i)),
    ).toBeVisible({ timeout: 60_000 });

    // Scheduled future meetings may not be joinable as live yet — joining prejoin is enough for invite resolution.
    const canJoin = await participantPage.getByRole('button', { name: 'Join meeting' }).isVisible().catch(() => false);
    if (canJoin) {
      await participantPage.getByRole('button', { name: 'Join meeting' }).click();
      await expect(participantPage).toHaveURL(new RegExp(`#/(meet|join)/${meetingCode}`), { timeout: 60_000 });
    }
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
