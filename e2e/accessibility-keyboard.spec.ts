import { test, expect } from '@playwright/test';
import { stagingIdentities } from './helpers/env';
import { openIsolatedContext, signIn } from './helpers/conference';

test('keyboard accessibility smoke across core flows', async ({ browser }) => {
  const ids = stagingIdentities();
  const context = await openIsolatedContext(browser);
  const page = await context.newPage();
  const visited: string[] = [];

  try {
    await page.goto('/#/auth', { waitUntil: 'domcontentloaded' });
    await page.getByRole('textbox', { name: 'Email' }).focus();
    await expect(page.getByRole('textbox', { name: 'Email' })).toBeFocused();
    await page.keyboard.press('Tab');
    await expect(page.getByRole('textbox', { name: 'Password' })).toBeFocused();
    visited.push('login-tab-order');

    await signIn(page, ids.hostEmail, ids.hostPassword);
    visited.push('dashboard');

    await page.keyboard.press('Tab');
    const focusedTag = await page.evaluate(() => document.activeElement?.tagName || null);
    expect(focusedTag).toBeTruthy();
    visited.push('dashboard-focus');

    await page.goto('/#/schedule', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Plan a meeting' })).toBeVisible({ timeout: 30_000 });
    await page.locator('#meeting-title').focus();
    await expect(page.locator('#meeting-title')).toBeFocused();
    await page.keyboard.press('Escape');
    visited.push('schedule');

    await page.goto('/#/settings', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('heading', { name: 'Organization and account' })).toBeVisible({ timeout: 30_000 });
    await page.getByRole('button', { name: 'Back to home' }).focus();
    await expect(page.getByRole('button', { name: 'Back to home' })).toBeFocused();
    visited.push('settings');

    await page.goto('/#/', { waitUntil: 'domcontentloaded' });
    await page.getByRole('button', { name: 'Start Meeting', exact: true }).click();
    await expect(page.getByRole('button', { name: 'Join meeting' })).toBeVisible({ timeout: 60_000 });
    await page.getByRole('button', { name: 'Turn off camera' }).or(page.getByRole('button', { name: 'Turn on camera' })).focus();
    visited.push('prejoin');

    // Join lobby / ready screen and verify labeled controls.
    await page.getByRole('button', { name: 'Join meeting' }).click();
    await expect(page).toHaveURL(/#\/meet\/LM-[A-Z0-9]{6}/, { timeout: 90_000 });
    const start = page.getByRole('button', { name: 'Start meeting', exact: true });
    if (await start.isVisible().catch(() => false)) {
      await start.focus();
      await expect(start).toBeFocused();
      visited.push('ready-lobby');
      await start.click();
    }

    const stage = page.getByRole('region', { name: 'Participant stage' });
    for (let attempt = 0; attempt < 3 && !(await stage.isVisible().catch(() => false)); attempt += 1) {
      const tryAgain = page.getByRole('button', { name: 'Try again' });
      if (await tryAgain.isVisible().catch(() => false)) await tryAgain.click();
      const startAgain = page.getByRole('button', { name: 'Start meeting', exact: true });
      if (await startAgain.isVisible().catch(() => false)) await startAgain.click();
      await page.waitForTimeout(2000);
    }
    await expect(stage).toBeVisible({ timeout: 90_000 });
    for (const label of [
      'Mute microphone',
      'Turn off camera',
      'Share screen',
      'Toggle meeting chat',
      'Toggle collaboration tools',
      'Raise hand',
      'Show reactions',
      'Leave meeting',
    ]) {
      const control = page.getByRole('button', { name: label });
      // Collaboration tools may require horizontal scroll on short viewports.
      await control.first().scrollIntoViewIfNeeded();
      await expect(control.first()).toBeVisible();
      await control.first().focus();
    }
    visited.push('meeting-controls');

    await page.getByRole('button', { name: 'Toggle meeting chat' }).click();
    await expect(page.getByRole('textbox', { name: 'Message' })).toBeVisible();
    await page.keyboard.press('Escape');
    visited.push('chat');

    await page.getByRole('button', { name: 'Toggle collaboration tools' }).click();
    await expect(page.getByRole('button', { name: 'Polls', exact: true })).toBeVisible();
    await page.getByRole('button', { name: 'Q&A', exact: true }).click();
    await page.getByRole('button', { name: 'Notes', exact: true }).click();
    await page.getByRole('button', { name: 'Board', exact: true }).click();
    visited.push('collaboration-panel');

    console.log('A11Y_VISITED', JSON.stringify(visited));
  } finally {
    await context.close();
  }
});
