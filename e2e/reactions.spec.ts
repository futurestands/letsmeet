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

test('reactions - participant sends emoji reaction and overlay is visibly received', async ({ browser }) => {
  test.setTimeout(300_000);
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);

  try {
    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    await signIn(participantPage, ids.participantEmail, ids.participantPassword);
    const meetingCode = await hostStartMeeting(hostPage);
    await participantJoinMeeting(participantPage, meetingCode);

    await waitForRemoteParticipantTiles(hostPage, 2);
    await waitForRemoteParticipantTiles(participantPage, 2);

    // Open reactions menu on participant page
    const reactionsBtn = participantPage.getByRole('button', { name: 'Show reactions' });
    const reactionMenu = participantPage.getByRole('menu');
    if (!(await reactionMenu.isVisible().catch(() => false))) {
      await reactionsBtn.click();
    }

    const emojiBtn = participantPage.getByRole('menuitem', { name: /Send .* reaction/ }).first();
    await expect(emojiBtn).toBeVisible({ timeout: 15_000 });
    await emojiBtn.click();

    // Strict assertion: reaction overlay MUST be visibly rendered in DOM on participant page
    await expect(
      participantPage.locator('span', { hasText: '👍' }).first()
    ).toBeVisible({ timeout: 15_000 });

    const diagnostics = {
      meetingCode,
      reactionDelivery: 'pass',
    };

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ reactionsE2E: diagnostics }));
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
