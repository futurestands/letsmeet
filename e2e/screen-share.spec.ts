import { test, expect } from '@playwright/test';
import { stagingIdentities, assertNoSecretLeak } from './helpers/env';
import {
  hostStartMeeting,
  launchDualBrowser,
  signIn,
  waitForRemoteParticipantTiles,
} from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('host screen share publication, remote subscription, and presentation mode DOM properties', async ({ browser }) => {
  test.setTimeout(240_000);
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);
  const diagnostics: Record<string, unknown> = {
    method: 'Playwright dual-browser screen-share verification',
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

    // Attempt to start screen share
    await hostPage.getByRole('button', { name: 'Share screen' }).click();
    const stopShare = hostPage.getByRole('button', { name: 'Stop screen sharing' });
    const hostStarted = await stopShare.isVisible({ timeout: 15_000 }).catch(() => false);

    if (!hostStarted) {
      diagnostics.screenShare = 'MANUAL REQUIRED — OS screen capture unavailable in automation environment';
      assertNoSecretLeak(JSON.stringify(diagnostics));
      console.log(JSON.stringify({ screenShareE2E: diagnostics }));
      throw new Error('MANUAL REQUIRED — OS screen capture unavailable in automation environment.');
    }

    diagnostics.localPublication = 'published';

    // Verify remote participant received screen share track & stage rendered
    const remoteStage = participantPage.locator('[data-screen-share-stage="true"]');
    await expect(remoteStage).toBeVisible({ timeout: 30_000 });
    await expect(participantPage.getByText(/is presenting/i)).toBeVisible({ timeout: 30_000 });
    diagnostics.remoteSubscription = 'rendered';

    // Verify DOM computed styles on remote screen-share video element
    const remoteVideo = remoteStage.locator('video').first();
    if (await remoteVideo.isVisible().catch(() => false)) {
      const styles = await remoteVideo.evaluate((el) => {
        const computed = window.getComputedStyle(el);
        return {
          transform: computed.transform,
          objectFit: computed.objectFit,
        };
      });
      diagnostics.remoteVideoStyles = styles;
      expect(styles.transform).not.toContain('matrix(-1'); // Confirm no scaleX(-1) mirror
      expect(styles.objectFit).toBe('contain');
    }

    // Camera/mic controls remain accessible
    await expect(hostPage.getByRole('button', { name: /Mute microphone|Unmute microphone/ })).toBeVisible();
    await expect(participantPage.getByRole('button', { name: /Mute microphone|Unmute microphone/ })).toBeVisible();

    // Stop screen share and verify stage unmounts
    await stopShare.click();
    await expect(hostPage.getByRole('button', { name: 'Share screen' })).toBeVisible({ timeout: 20_000 });
    await expect(remoteStage).not.toBeVisible({ timeout: 20_000 });
    diagnostics.stopShare = 'pass';

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ screenShareE2E: diagnostics }));
  } finally {
    await participantContext.close();
    await hostContext.close();
  }
});
