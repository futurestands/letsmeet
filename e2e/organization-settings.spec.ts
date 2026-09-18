import { test, expect } from '@playwright/test';
import { createClient } from '@supabase/supabase-js';
import { stagingIdentities } from './helpers/env';
import { launchDualBrowser, signIn } from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test('organization settings role boundaries in browser UI', async ({ browser }) => {
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);

  try {
    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    await signIn(participantPage, ids.participantEmail, ids.participantPassword);

    await hostPage.goto('/#/settings', { waitUntil: 'domcontentloaded' });
    await expect(hostPage.getByRole('heading', { name: 'Organization and account' })).toBeVisible({ timeout: 30_000 });
    await expect(hostPage.getByText(/Your role/i)).toBeVisible();
    await expect(hostPage.getByText(/owner/i).first()).toBeVisible();
    await expect(hostPage.getByRole('button', { name: /Invite (organization )?member/i })).toBeVisible();
    await expect(hostPage.getByRole('button', { name: /Save (organization )?settings/i })).toBeVisible();
    await expect(hostPage.getByRole('heading', { name: 'Audit log' })).toBeVisible();
    await expect(hostPage.getByRole('heading', { name: 'Retention' })).toBeVisible();

    // Owner can save retention without error.
    await hostPage.locator('#retention-days').or(hostPage.getByLabel(/Recording retention/i)).fill('120');
    await hostPage.getByRole('button', { name: /Save (organization )?settings/i }).click();
    await expect(hostPage.getByText(/Organization settings saved|Current retention: 120/i).first()).toBeVisible({ timeout: 20_000 });

    await participantPage.goto('/#/settings', { waitUntil: 'domcontentloaded' });
    await expect(participantPage.getByRole('heading', { name: 'Organization and account' })).toBeVisible({ timeout: 30_000 });
    await expect(participantPage.getByText(/member/i).first()).toBeVisible();
    await expect(participantPage.getByRole('button', { name: /Invite (organization )?member/i })).toHaveCount(0);
    await expect(participantPage.getByRole('button', { name: /Save (organization )?settings/i })).toHaveCount(0);
    await expect(participantPage.getByRole('heading', { name: 'Audit log' })).toHaveCount(0);
    await expect(participantPage.getByRole('heading', { name: 'Retention' })).toHaveCount(0);

    // Backend rejection even if UI is bypassed.
    const supabaseUrl = process.env.VITE_SUPABASE_URL!;
    const anon = process.env.VITE_SUPABASE_ANON_KEY!;
    const memberClient = createClient(supabaseUrl, anon, { auth: { persistSession: false, autoRefreshToken: false } });
    const { error: authError } = await memberClient.auth.signInWithPassword({
      email: ids.participantEmail,
      password: ids.participantPassword,
    });
    expect(authError).toBeNull();
    const { error: settingsError } = await memberClient.rpc('update_organization_settings', {
      p_retention_days: 7,
      p_recordings_enabled: false,
    });
    expect(settingsError).toBeTruthy();

    const { error: inviteError } = await memberClient.rpc('invite_organization_member', {
      p_email: 'unauthorized-invite@example.invalid',
      p_role: 'admin',
    });
    expect(inviteError).toBeTruthy();
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
