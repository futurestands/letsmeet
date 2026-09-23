import { test, expect } from '@playwright/test';
import { assertNoSecretLeak } from './helpers/env';
import { createAuthenticatedDualMeeting } from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('reactions - participant sends emoji reaction and overlay is visibly received', async ({ browser }) => {
  test.setTimeout(360_000);
  const setup = await createAuthenticatedDualMeeting(browser);
  const { hostContext, participantContext, hostPage, participantPage, meetingCode, timings } = setup;
  void hostPage;

  const diagnostics: Record<string, unknown> = {
    phase: 'reaction-e2e',
    meetingCode,
    setupTimings: timings,
  };

  try {
    const actionStart = Date.now();
    const reactionsBtn = participantPage.getByRole('button', { name: 'Show reactions' });
    const reactionMenu = participantPage.getByRole('menu');
    if (!(await reactionMenu.isVisible().catch(() => false))) {
      await reactionsBtn.click();
    }

    const emojiBtn = participantPage.getByRole('menuitem', { name: /Send .* reaction/ }).first();
    await expect(emojiBtn).toBeVisible({ timeout: 15_000 });
    await emojiBtn.dispatchEvent('click');

    // Strict assertion: reaction overlay MUST be visibly rendered in DOM on both local sender and remote host
    const localOverlay = participantPage.getByTestId('reaction-overlay').first();
    await expect(localOverlay).toBeVisible({ timeout: 15_000 });

    const hostOverlay = hostPage.getByTestId('reaction-overlay').first();
    await expect(hostOverlay).toBeVisible({ timeout: 15_000 });
    diagnostics.remoteOverlayReceived = true;
    diagnostics.actionMs = Date.now() - actionStart;
    diagnostics.status = 'pass';

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ reactionsE2E: diagnostics }));
  } catch (err) {
    diagnostics.failurePhase = 'reaction_delivery_assertion';
    diagnostics.error = err instanceof Error ? err.message : String(err);
    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.error(JSON.stringify({ reactionsE2E: diagnostics }));
    throw err;
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
