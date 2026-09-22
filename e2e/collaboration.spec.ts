import { test, expect } from '@playwright/test';
import { stagingIdentities, assertNoSecretLeak } from './helpers/env';
import {
  hostStartMeeting,
  launchDualBrowser,
  openCollaborationTools,
  participantJoinMeeting,
  signIn,
  waitForRemoteParticipantTiles,
} from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('collaboration - polls, Q&A, shared notes, and whiteboard rendering', async ({ browser }) => {
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

    // 1. Poll Creation & Voting
    await openCollaborationTools(hostPage);
    await hostPage.getByPlaceholder('Poll question').fill('Collab E2E poll?');
    await hostPage.getByPlaceholder('One option per line').fill('Option A\nOption B');
    await hostPage.getByRole('button', { name: 'Create poll' }).click();
    await expect(hostPage.getByText('Collab E2E poll?')).toBeVisible({ timeout: 30_000 });

    await openCollaborationTools(participantPage);
    await expect(participantPage.getByText('Collab E2E poll?')).toBeVisible({ timeout: 30_000 });
    await participantPage.getByRole('button', { name: 'Option A', exact: true }).click();

    // 2. Q&A Submission & Host Moderation
    await participantPage.getByRole('button', { name: 'Q&A', exact: true }).click();
    await participantPage.getByPlaceholder('Ask a question').fill('Is collaboration active?');
    await participantPage.getByPlaceholder('Ask a question').press('Enter');
    await expect(participantPage.getByText('Is collaboration active?')).toBeVisible({ timeout: 30_000 });

    await openCollaborationTools(hostPage);
    await hostPage.getByRole('button', { name: 'Q&A', exact: true }).click();
    await expect(hostPage.getByText('Is collaboration active?')).toBeVisible({ timeout: 30_000 });
    await hostPage.getByRole('button', { name: 'Mark answered' }).click();

    // 3. Shared Notes Persistence
    await hostPage.getByRole('button', { name: 'Notes', exact: true }).click();
    await hostPage.locator('textarea').first().fill('Shared notes from collab E2E suite');
    await hostPage.getByRole('button', { name: 'Save notes' }).click();
    await expect(hostPage.locator('textarea').first()).toHaveValue('Shared notes from collab E2E suite', { timeout: 20_000 });

    await openCollaborationTools(participantPage);
    await participantPage.getByRole('button', { name: 'Notes', exact: true }).click();
    await participantPage.getByRole('button', { name: /Reload notes/i }).click();
    await expect(participantPage.getByLabel('Shared meeting notes')).toHaveValue('Shared notes from collab E2E suite', { timeout: 30_000 });

    // 4. Whiteboard Rendering
    await hostPage.getByRole('button', { name: 'Board', exact: true }).click();
    const board = hostPage.locator('[aria-label="Meeting whiteboard"]').first();
    await expect(board).toBeVisible({ timeout: 20_000 });

    const diagnostics = {
      meetingCode,
      poll: 'pass',
      qa: 'pass',
      notes: 'pass',
      whiteboard: 'pass',
    };

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ collaborationE2E: diagnostics }));
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
