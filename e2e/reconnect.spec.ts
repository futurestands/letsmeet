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

test('reconnect - transient network disconnect recovers and participant remains in meeting', async ({ browser }) => {
  test.setTimeout(300_000);
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);

  try {
    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    await signIn(participantPage, ids.participantEmail, ids.password || ids.participantPassword);
    const meetingCode = await hostStartMeeting(hostPage);
    await participantJoinMeeting(participantPage, meetingCode);

    await waitForRemoteParticipantTiles(hostPage, 2);
    await waitForRemoteParticipantTiles(participantPage, 2);

    // Simulate participant network disconnect
    await participantContext.setOffline(true);
    await expect(participantPage.getByText(/Reconnecting|Connection lost/i)).toBeVisible({ timeout: 20_000 });

    // Restore network
    await participantContext.setOffline(false);
    await expect(participantPage.getByText(/Connected|Connection restored/i)).toBeVisible({ timeout: 30_000 });

    // Meeting remains active and host still sees participant
    await waitForRemoteParticipantTiles(hostPage, 2);

    const diagnostics = {
      meetingCode,
      reconnect: 'pass',
    };

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ reconnectE2E: diagnostics }));
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
