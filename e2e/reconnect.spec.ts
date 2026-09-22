import { test, expect } from '@playwright/test';
import { assertNoSecretLeak } from './helpers/env';
import { createAuthenticatedDualMeeting, probeMedia } from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('reconnect - transient network disconnect recovers and participant remains in meeting', async ({ browser }) => {
  test.setTimeout(240_000);
  const setup = await createAuthenticatedDualMeeting(browser);
  const { hostContext, participantContext, hostPage, participantPage, meetingCode, timings } = setup;
  void hostPage;

  const diagnostics: Record<string, unknown> = {
    phase: 'reconnect-e2e',
    meetingCode,
    setupTimings: timings,
  };

  try {
    const actionStart = Date.now();

    // 1. Capture initial media frame count
    const initialMedia = await probeMedia(participantPage);
    diagnostics.initialMedia = initialMedia;

    // 2. Simulate participant network disconnect
    await participantContext.setOffline(true);
    await expect(participantPage.getByText(/Reconnecting|Connection lost/i)).toBeVisible({ timeout: 20_000 });
    diagnostics.offlineBannerObserved = true;

    // 3. Restore network connection
    await participantContext.setOffline(false);
    await expect(participantPage.getByText(/Connected|Connection restored/i)).toBeVisible({ timeout: 30_000 });
    diagnostics.reconnectedBannerObserved = true;

    // 4. Verify participant remains in meeting and video frames resume decoding
    await expect.poll(async () => (await probeMedia(participantPage)).videosWithFrames, { timeout: 30_000 }).toBeGreaterThanOrEqual(1);
    const recoveredMedia = await probeMedia(participantPage);
    diagnostics.recoveredMedia = recoveredMedia;

    diagnostics.actionMs = Date.now() - actionStart;
    diagnostics.status = 'pass';

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ reconnectE2E: diagnostics }));
  } catch (err) {
    diagnostics.failurePhase = 'reconnect_recovery_assertion';
    diagnostics.error = err instanceof Error ? err.message : String(err);
    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.error(JSON.stringify({ reconnectE2E: diagnostics }));
    throw err;
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
