import { test, expect } from '@playwright/test';
import { stagingIdentities, assertNoSecretLeak } from './helpers/env';
import {
  hostStartMeeting,
  launchDualBrowser,
  participantJoinMeeting,
  probeMedia,
  signIn,
  waitForRemoteParticipantTiles,
} from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('conference media - two-way video/audio connection and frame decoding', async ({ browser }) => {
  test.setTimeout(180_000);
  const startTs = Date.now();
  const timings: Record<string, number> = {};
  const mark = (key: string) => { timings[key] = Date.now() - startTs; };

  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);

  try {
    // 1. Sign-in both users
    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    await signIn(participantPage, ids.participantEmail, ids.participantPassword);
    mark('auth_completed_ms');

    // 2. Host creates & starts meeting
    const meetingCode = await hostStartMeeting(hostPage);
    mark('host_meeting_started_ms');

    // 3. Participant joins meeting
    await participantJoinMeeting(participantPage, meetingCode);
    mark('participant_joined_ms');

    // 4. Verify two-way participant presence
    await waitForRemoteParticipantTiles(hostPage, 2);
    await waitForRemoteParticipantTiles(participantPage, 2);
    mark('remote_tiles_visible_ms');

    // 5. Verify host controls vs participant view
    await expect(hostPage.getByRole('button', { name: 'End meeting for everyone' })).toBeVisible();
    await expect(participantPage.getByRole('button', { name: 'End meeting for everyone' })).toHaveCount(0);

    // 6. Verify WebRTC video frame decoding for both participants
    await expect.poll(async () => (await probeMedia(hostPage)).videosWithFrames, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    await expect.poll(async () => (await probeMedia(participantPage)).videosWithFrames, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    mark('video_frames_decoded_ms');

    const hostMedia = await probeMedia(hostPage);
    const participantMedia = await probeMedia(participantPage);

    expect(hostMedia.identities.length).toBeGreaterThanOrEqual(2);
    expect(participantMedia.identities.length).toBeGreaterThanOrEqual(2);

    const diagnostics = {
      meetingCode,
      timings,
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
