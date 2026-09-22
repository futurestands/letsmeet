import { test, expect } from '@playwright/test';

test.describe('Fresh User Onboarding and Scheduling', () => {
  const timestamp = Date.now();
  const testEmail = `fresh-${timestamp}@example.com`;
  const testPassword = 'Password123!';
  const testName = `Fresh User ${timestamp}`;

  test('should sign up, auto-provision organization, and schedule a meeting', async ({ page }) => {
    // 1. Sign Up
    await page.goto('/#/auth');
    await page.getByRole('button', { name: 'Create account' }).click();

    await page.getByLabel('Full name').fill(testName);
    await page.getByLabel('Email').fill(testEmail);
    await page.getByLabel('Password').fill(testPassword);

    await page.getByRole('button', { name: 'Create Account' }).click();

    // 2. Dashboard - verify onboarding worked
    await expect(page).toHaveURL(/\/$/);
    // Home page should show "Current workspace" if onboarding worked
    await expect(page.getByText(/Current workspace:/i)).toBeVisible({ timeout: 20000 });
    await expect(page.getByText(new RegExp(`${testName} Workspace`, 'i'))).toBeVisible();

    // 3. Schedule Meeting
    await page.getByRole('button', { name: /Schedule/i }).first().click();
    await expect(page).toHaveURL(/#\/schedule/);

    await page.getByLabel('Title').fill('E2E Onboarding Meeting');

    // Set date to tomorrow to avoid "must be in future" errors
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const dateStr = tomorrow.toISOString().split('T')[0];
    await page.getByLabel('Date').fill(dateStr);
    await page.getByLabel('Start time').fill('14:00');

    // Select Africa/Nairobi
    await page.getByLabel('Timezone').selectOption('Africa/Nairobi');

    await page.getByRole('button', { name: 'Save event' }).click();

    // 4. Verify success
    await expect(page.getByText(/Invitation link/i)).toBeVisible({ timeout: 15000 });
    const inviteLink = await page.getByRole('textbox', { editable: false }).inputValue();
    expect(inviteLink).toContain('/#/join/LM-');

    // 5. Verify persistence on refresh
    await page.reload();
    await expect(page.getByText(/Invitation link/i)).toBeVisible();

    // 6. Check Dashboard (Upcoming meetings)
    await page.getByRole('button', { name: /Back to home/i }).or(page.locator('button[aria-label="Back to home"]')).click();
    await expect(page).toHaveURL(/\/$/);
    await expect(page.getByText('E2E Onboarding Meeting')).toBeVisible();
    await expect(page.getByText(/14:00/)).toBeVisible();
  });
});
