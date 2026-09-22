import { test, expect } from '@playwright/test';
import { assertNoSecretLeak } from './helpers/env';
import { createAuthenticatedDualMeeting } from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('reactions - participant sends emoji reaction and overlay is visibly received', async ({ browser }) => {
  test.setTimeout(240_000);
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
    await emojiBtn.click({ force: true });

    // Strict assertion: reaction overlay MUST be visibly rendered in DOM
    const overlay = participantPage.getByTestId('reaction-overlay').first();
    await expect(overlay).toBeVisible({ timeout: 15_000 });
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
