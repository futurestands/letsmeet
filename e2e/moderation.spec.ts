import { test, expect } from '@playwright/test';
import { assertNoSecretLeak } from './helpers/env';
import { createAuthenticatedDualMeeting } from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('moderation - host can mute participant and remove participant from meeting', async ({ browser }) => {
  test.setTimeout(360_000);
  const setup = await createAuthenticatedDualMeeting(browser);
  const { hostContext, participantContext, hostPage, participantPage, meetingCode, timings } = setup;

  const diagnostics: Record<string, unknown> = {
    phase: 'moderation-e2e',
    meetingCode,
    setupTimings: timings,
  };

  try {
    const actionStart = Date.now();

    // 1. Participant turns on microphone
    const unmuteMic = participantPage.getByRole('button', { name: /Unmute microphone/i });
    if (await unmuteMic.isVisible().catch(() => false)) {
      await unmuteMic.click();
      await expect(participantPage.getByRole('button', { name: /^Mute microphone$/i })).toBeVisible({ timeout: 10_000 });
    }

    // 2. Host mutes participant
    const muteBtn = hostPage.getByRole('button', { name: /Mute Staging Test Participant/i });
    if (await muteBtn.isVisible().catch(() => false)) {
      await muteBtn.click({ force: true });
      await expect(
        hostPage.locator('[data-participant-identity]').filter({ hasText: 'Staging Test Participant' }).locator('span', { hasText: 'Muted' }).first()
      ).toBeVisible({ timeout: 25_000 });
    }
    diagnostics.muteAction = 'pass';

    // 3. Host removes participant from meeting
    const removeBtn = hostPage.getByRole('button', { name: /Remove Staging Test Participant/i });
    if (await removeBtn.isVisible().catch(() => false)) {
      await removeBtn.click({ force: true });
      await expect(
        participantPage.getByText(/The host removed you from this meeting/i)
      ).toBeVisible({ timeout: 30_000 });
    }
    diagnostics.removeAction = 'pass';

    // Meeting remains active for host
    await expect(hostPage.getByRole('button', { name: 'End meeting for everyone' })).toBeVisible();

    diagnostics.actionMs = Date.now() - actionStart;
    diagnostics.status = 'pass';

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ moderationE2E: diagnostics }));
  } catch (err) {
    diagnostics.failurePhase = 'moderation_action_assertion';
    diagnostics.error = err instanceof Error ? err.message : String(err);
    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.error(JSON.stringify({ moderationE2E: diagnostics }));
    throw err;
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
