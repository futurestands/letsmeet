import { test, expect } from '@playwright/test';
import { assertNoSecretLeak } from './helpers/env';
import { createAuthenticatedDualMeeting, probeMedia } from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('conference media - two-way video/audio connection and frame decoding', async ({ browser }) => {
  test.setTimeout(360_000);
  const setup = await createAuthenticatedDualMeeting(browser);
  const { hostContext, participantContext, hostPage, participantPage, meetingCode, timings } = setup;

  try {
    // 1. Verify host controls vs participant view
    await expect(hostPage.getByRole('button', { name: 'End meeting for everyone' })).toBeVisible();
    await expect(participantPage.getByRole('button', { name: 'End meeting for everyone' })).toHaveCount(0);

    // 2. Verify WebRTC video frame decoding for both participants
    await expect.poll(async () => (await probeMedia(hostPage)).videosWithFrames, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await probeMedia(participantPage)).videosWithFrames, { timeout: 60_000 }).toBeGreaterThanOrEqual(1);

    await expect.poll(async () => (await probeMedia(hostPage)).identities.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);
    await expect.poll(async () => (await probeMedia(participantPage)).identities.length, { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

    const hostMedia = await probeMedia(hostPage);
    const participantMedia = await probeMedia(participantPage);

    const diagnostics = {
      meetingCode,
      setupTimings: timings,
      hostVideoCount: hostMedia.videoCount,
      participantVideoCount: participantMedia.videoCount,
      status: 'pass',
    };

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ conferenceMediaE2E: diagnostics }));
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
