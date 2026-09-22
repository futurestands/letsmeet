import { test, expect } from '@playwright/test';
import { assertNoSecretLeak } from './helpers/env';
import { createAuthenticatedDualMeeting, openCollaborationTools } from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('collaboration - polls, Q&A, shared notes, and whiteboard rendering', async ({ browser }) => {
  test.setTimeout(240_000);
  const setup = await createAuthenticatedDualMeeting(browser);
  const { hostContext, participantContext, hostPage, participantPage, meetingCode, timings } = setup;

  const diagnostics: Record<string, unknown> = {
    phase: 'collaboration-e2e',
    meetingCode,
    setupTimings: timings,
    completedStages: [] as string[],
  };

  const recordStage = (stage: string) => {
    (diagnostics.completedStages as string[]).push(stage);
    console.log(`COLLAB_STAGE=${stage}`);
  };

  try {
    const actionStart = Date.now();

    // 1. Poll Creation & Voting
    await openCollaborationTools(hostPage);
    await hostPage.getByPlaceholder('Poll question').fill('Collab E2E poll?');
    await hostPage.getByPlaceholder('One option per line').fill('Option A\nOption B');
    await hostPage.getByRole('button', { name: 'Create poll' }).click();
    await expect(hostPage.getByText('Collab E2E poll?')).toBeVisible({ timeout: 30_000 });
    recordStage('poll_created');

    await openCollaborationTools(participantPage);
    await expect(participantPage.getByText('Collab E2E poll?')).toBeVisible({ timeout: 30_000 });
    await participantPage.getByRole('button', { name: 'Option A', exact: true }).click();
    recordStage('poll_visible_remote_and_voted');

    // 2. Q&A Submission & Host Moderation
    await participantPage.getByRole('button', { name: 'Q&A', exact: true }).click();
    await participantPage.getByPlaceholder('Ask a question').fill('Is collaboration active?');
    await participantPage.getByPlaceholder('Ask a question').press('Enter');
    await expect(participantPage.getByText('Is collaboration active?')).toBeVisible({ timeout: 30_000 });
    recordStage('qa_submitted');

    await openCollaborationTools(hostPage);
    await hostPage.getByRole('button', { name: 'Q&A', exact: true }).click();
    await expect(hostPage.getByText('Is collaboration active?')).toBeVisible({ timeout: 30_000 });
    await hostPage.getByRole('button', { name: 'Mark answered' }).click();
    recordStage('qa_answered');

    // 3. Shared Notes Persistence
    await hostPage.getByRole('button', { name: 'Notes', exact: true }).click();
    await hostPage.locator('textarea').first().fill('Shared notes from collab E2E suite');
    await hostPage.getByRole('button', { name: 'Save notes' }).click();
    await expect(hostPage.locator('textarea').first()).toHaveValue('Shared notes from collab E2E suite', { timeout: 20_000 });
    recordStage('notes_saved');

    await openCollaborationTools(participantPage);
    await participantPage.getByRole('button', { name: 'Notes', exact: true }).click();
    await participantPage.getByRole('button', { name: /Reload notes/i }).click();
    await expect(participantPage.getByLabel('Shared meeting notes')).toHaveValue('Shared notes from collab E2E suite', { timeout: 30_000 });
    recordStage('notes_reloaded');

    // 4. Whiteboard Rendering
    await hostPage.getByRole('button', { name: 'Board', exact: true }).click();
    const board = hostPage.locator('[aria-label="Meeting whiteboard"]').first();
    await expect(board).toBeVisible({ timeout: 20_000 });
    recordStage('whiteboard_rendered');

    diagnostics.actionMs = Date.now() - actionStart;
    diagnostics.status = 'pass';

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ collaborationE2E: diagnostics }));
  } catch (err) {
    diagnostics.failurePhase = 'collaboration_assertion';
    diagnostics.error = err instanceof Error ? err.message : String(err);
    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.error(JSON.stringify({ collaborationE2E: diagnostics }));
    throw err;
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
