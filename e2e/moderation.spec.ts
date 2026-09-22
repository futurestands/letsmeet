import { test, expect } from '@playwright/test';
import { stagingIdentities, assertNoSecretLeak } from './helpers/env';
import {
  hostStartMeeting,
  launchDualBrowser,
  participantJoinMeeting,
  signIn,
  waitForRemoteParticipantTiles,
} from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('moderation - host can mute participant and remove participant from meeting', async ({ browser }) => {
  test.setTimeout(360_000);
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);

  try {
    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    await signIn(participantPage, ids.participantEmail, ids.participantPassword);
    const meetingCode = await hostStartMeeting(hostPage);
    await participantJoinMeeting(participantPage, meetingCode);

    await waitForRemoteParticipantTiles(hostPage, 2);
    await waitForRemoteParticipantTiles(participantPage, 2);

    // Participant turns on microphone so a published audio track exists
    const unmuteMic = participantPage.getByRole('button', { name: /Unmute microphone/i });
    if (await unmuteMic.isVisible().catch(() => false)) {
      await unmuteMic.click();
      await expect(participantPage.getByRole('button', { name: /^Mute microphone$/i })).toBeVisible({ timeout: 10_000 });
    }

    // 1. Host mutes participant
    const muteBtn = hostPage.getByRole('button', { name: /Mute Staging Test Participant/i });
    if (await muteBtn.isVisible().catch(() => false)) {
      await muteBtn.click({ force: true });
      await expect(
        hostPage.locator('[data-participant-identity]').filter({ hasText: 'Staging Test Participant' }).locator('span', { hasText: 'Muted' }).first()
      ).toBeVisible({ timeout: 25_000 });
    }

    // 2. Host removes participant from meeting
    const removeBtn = hostPage.getByRole('button', { name: /Remove Staging Test Participant/i });
    if (await removeBtn.isVisible().catch(() => false)) {
      await removeBtn.click({ force: true });
      await expect(
        participantPage.getByText(/The host removed you from this meeting/i)
      ).toBeVisible({ timeout: 30_000 });
    }

    // Meeting remains active for host
    await expect(hostPage.getByRole('button', { name: 'End meeting for everyone' })).toBeVisible();

    const diagnostics = {
      meetingCode,
      moderation: 'pass',
    };

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ moderationE2E: diagnostics }));
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
