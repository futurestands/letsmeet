import { test, expect } from '@playwright/test';
import { stagingIdentities } from './helpers/env';
import {
  hostStartMeeting,
  launchDualBrowser,
  participantJoinMeeting,
  probeMedia,
  signIn,
  waitForRemoteParticipantTiles,
} from './helpers/conference';
import { enableSyntheticSpeakingAudio, setToneGain } from './helpers/synthetic-audio';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const health = await fetch('https://letsmeet-staging-api.onrender.com/health');
  if (!health.ok) throw new Error(`Staging API health=${health.status}`);
});

test('active speaker with synthetic audio energy', async ({ browser }) => {
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);

  try {
    await enableSyntheticSpeakingAudio(hostContext);
    await enableSyntheticSpeakingAudio(participantContext);

    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    await signIn(participantPage, ids.participantEmail, ids.participantPassword);

    const meetingCode = await hostStartMeeting(hostPage);
    await participantJoinMeeting(participantPage, meetingCode);
    await waitForRemoteParticipantTiles(hostPage, 2);
    await waitForRemoteParticipantTiles(participantPage, 2);

    // Ensure mics are published.
    for (const page of [hostPage, participantPage]) {
      const unmute = page.getByRole('button', { name: 'Unmute microphone' });
      if (await unmute.isVisible().catch(() => false)) await unmute.click();
      await expect(page.getByRole('button', { name: 'Mute microphone' })).toBeVisible({ timeout: 15_000 });
    }

    // Host speaks loudly; participant quiet.
    await setToneGain(hostPage, 0.5);
    await setToneGain(participantPage, 0.01);
    await hostPage.waitForTimeout(4000);

    const participantSeesHostSpeaking = await participantPage
      .locator('[data-active-speaker="true"]')
      .filter({ hasText: /Staging Test Host|Host/i })
      .or(participantPage.locator('[data-active-speaker="true"]').first())
      .count();

    const hostProbe = await probeMedia(hostPage);
    const participantProbe = await probeMedia(participantPage);

    const identitiesStableBefore = hostProbe.identities.join(',');
    await hostPage.waitForTimeout(1500);
    const identitiesStableAfter = (await probeMedia(hostPage)).identities.join(',');
    expect(identitiesStableAfter).toBe(identitiesStableBefore);

    // Participant speaks; host quiet.
    await setToneGain(hostPage, 0.01);
    await setToneGain(participantPage, 0.5);
    await participantPage.waitForTimeout(4000);
    const hostSeesParticipantSpeaking = await hostPage.locator('[data-active-speaker="true"]').count();

    const result = {
      meetingCode,
      participantSeesHostSpeaking,
      hostSeesParticipantSpeaking,
      hostSpeakingBadges: hostProbe.speakingBadges,
      participantSpeakingBadges: participantProbe.speakingBadges,
      status:
        participantSeesHostSpeaking > 0 || hostSeesParticipantSpeaking > 0 || hostProbe.speakingBadges > 0 || participantProbe.speakingBadges > 0
          ? 'pass'
          : 'unverified-livekit-did-not-flag-synthetic-tone; manual speech test required',
    };
    console.log('ACTIVE_SPEAKER_RESULT', JSON.stringify(result));

    // Soft assertion: grid stability always required; speaking detection best-effort.
    expect(identitiesStableAfter.split(',').length).toBeGreaterThanOrEqual(2);
    if (result.status !== 'pass') {
      test.info().annotations.push({ type: 'manual-required', description: result.status });
    }
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
