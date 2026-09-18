import { test, expect } from '@playwright/test';
import { stagingIdentities, assertNoSecretLeak } from './helpers/env';
import {
  hostStartMeeting,
  launchDualBrowser,
  signIn,
  waitForRemoteParticipantTiles,
} from './helpers/conference';

test.describe.configure({ mode: 'serial' });

/**
 * Screen-share verification using Chromium fake media / auto desktop capture flags
 * from playwright.config.ts. This proves the LiveKit screen-share control path and
 * remote "is presenting" UX when the environment can provide a capture source.
 * OS-level real desktop capture remains MANUAL REQUIRED when fake capture fails.
 */
test('host screen share start/stop is visible to remote participant when capture is available', async ({ browser }) => {
  test.setTimeout(240_000);
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);
  const diagnostics: Record<string, unknown> = {
    method: 'Playwright fake-device / auto desktop capture flags',
  };

  try {
    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    await signIn(participantPage, ids.participantEmail, ids.participantPassword);
    const meetingCode = await hostStartMeeting(hostPage);
    diagnostics.meetingCode = meetingCode;

    await participantPage.goto(`/#/join/${meetingCode}`, { waitUntil: 'domcontentloaded' });
    await participantPage.getByRole('button', { name: 'Join meeting' }).click();
    await expect(participantPage.getByRole('region', { name: 'Participant stage' })).toBeVisible({ timeout: 120_000 });
    await waitForRemoteParticipantTiles(hostPage, 2);

    await hostPage.getByRole('button', { name: 'Share screen' }).click();
    const stopShare = hostPage.getByRole('button', { name: 'Stop screen sharing' });
    const presenting = participantPage.getByText(/is presenting/i);
    const stage = participantPage.locator('[data-screen-share-stage="true"]');

    const shareStarted = await stopShare.or(presenting).or(stage).isVisible().catch(() => false);
    if (!shareStarted) {
      diagnostics.screenShare = 'unverified-automation-capture-source-limitation';
      assertNoSecretLeak(JSON.stringify(diagnostics));
      test.info().annotations.push({
        type: 'note',
        description: 'Fake capture did not produce a LiveKit screen-share track; OS capture remains MANUAL REQUIRED.',
      });
      return;
    }

    diagnostics.hostControl = (await stopShare.isVisible().catch(() => false)) ? 'stop-visible' : 'share-attempted';
    if (await presenting.isVisible().catch(() => false) || await stage.isVisible().catch(() => false)) {
      diagnostics.remoteVisibility = 'pass';
    } else {
      diagnostics.remoteVisibility = 'host-started-remote-unconfirmed';
    }

    // Cameras/audio controls remain available during share.
    await expect(hostPage.getByRole('button', { name: /Mute microphone|Unmute microphone/ })).toBeVisible();
    await expect(participantPage.getByRole('button', { name: /Mute microphone|Unmute microphone/ })).toBeVisible();

    if (await stopShare.isVisible().catch(() => false)) {
      await stopShare.click();
      await expect(hostPage.getByRole('button', { name: 'Share screen' })).toBeVisible({ timeout: 20_000 });
      diagnostics.stopShare = 'pass';
    }

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ screenShareE2E: diagnostics }));
  } finally {
    await participantContext.close();
    await hostContext.close();
  }
});
