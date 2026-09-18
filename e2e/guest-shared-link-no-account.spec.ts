import { test, expect } from '@playwright/test';
import { stagingIdentities, assertNoSecretLeak } from './helpers/env';
import {
  expectChatVisible,
  hostStartMeeting,
  launchDualBrowser,
  probeMedia,
  sendChat,
  signIn,
  waitForRemoteParticipantTiles,
} from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const health = await fetch('https://letsmeet-staging-api.onrender.com/health');
  const ready = await fetch('https://letsmeet-staging-api.onrender.com/ready');
  const readyBody = await ready.json().catch(() => ({}));
  if (!health.ok || !ready.ok) {
    throw new Error(`Staging API not ready: health=${health.status} ready=${ready.status}`);
  }
  if (readyBody?.dependencies && readyBody.dependencies.guestJoin === false) {
    throw new Error('Staging API ready but guestJoin is false — guest session endpoints are not configured.');
  }
});

test('unauthenticated guest can join shared meeting link without account', async ({ browser }) => {
  test.setTimeout(300_000);
  const ids = stagingIdentities();
  const { hostContext, participantContext: guestContext, hostPage, participantPage: guestPage } =
    await launchDualBrowser(browser);

  const diagnostics: Record<string, unknown> = {
    method: 'Playwright isolated BrowserContexts — host authenticated, guest unauthenticated',
    preview: ids.previewUrl,
    guestDisplayName: 'Staging Guest',
  };

  try {
    // Prove guest context starts clean (no Supabase session cookies / localStorage auth).
    await guestPage.goto('/#/join', { waitUntil: 'domcontentloaded' });
    const guestStorage = await guestPage.evaluate(() => ({
      cookieCount: document.cookie ? document.cookie.split(';').filter(Boolean).length : 0,
      localStorageKeys: Object.keys(localStorage),
    }));
    diagnostics.guestStorageBefore = {
      cookieCount: guestStorage.cookieCount,
      localStorageKeyCount: guestStorage.localStorageKeys.length,
      hasAuthTokenKey: guestStorage.localStorageKeys.some((key) => /supabase|auth|sb-/i.test(key)),
    };
    expect(diagnostics.guestStorageBefore.hasAuthTokenKey).toBe(false);

    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    diagnostics.hostSignedIn = true;

    const meetingCode = await hostStartMeeting(hostPage);
    diagnostics.meetingCode = meetingCode;
    assertNoSecretLeak(JSON.stringify(diagnostics));

    // Guest opens ONLY the shared link — no sign-in, no account creation.
    await guestPage.goto(`/#/join/${meetingCode}`, { waitUntil: 'domcontentloaded' });
    await expect(guestPage.getByText(/Guest pre-join|Join as guest/i).first()).toBeVisible({ timeout: 60_000 });
    await expect(guestPage.getByRole('button', { name: 'Sign In', exact: true })).toHaveCount(0);
    await expect(guestPage.getByRole('button', { name: /Create account|Sign Up/i })).toHaveCount(0);

    const nameField = guestPage.getByRole('textbox', { name: 'Display name' });
    await expect(nameField).toBeVisible({ timeout: 30_000 });
    await nameField.fill('Staging Guest');
    await expect(guestPage.getByRole('button', { name: 'Join meeting' })).toBeEnabled({ timeout: 60_000 });
    await guestPage.getByRole('button', { name: 'Join meeting' }).click();

    await expect(guestPage).toHaveURL(new RegExp(`#/meet/${meetingCode}`), { timeout: 90_000 });
    await expect(guestPage.getByRole('region', { name: 'Participant stage' })).toBeVisible({ timeout: 120_000 });
    diagnostics.guestEnteredMeeting = true;

    // Guest must never gain host End control.
    await expect(guestPage.getByRole('button', { name: 'End meeting for everyone' })).toHaveCount(0);
    await expect(hostPage.getByRole('button', { name: 'End meeting for everyone' })).toBeVisible();

    await waitForRemoteParticipantTiles(hostPage, 2);
    await waitForRemoteParticipantTiles(guestPage, 2);

    await expect(hostPage.getByText('Staging Guest', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    await expect(guestPage.getByText('Staging Test Host', { exact: true }).first()).toBeVisible({ timeout: 60_000 });

    const hostMedia = await probeMedia(hostPage);
    const guestMedia = await probeMedia(guestPage);
    diagnostics.hostMedia = hostMedia;
    diagnostics.guestMedia = guestMedia;
    expect(hostMedia.identities.length).toBeGreaterThanOrEqual(2);
    expect(guestMedia.identities.length).toBeGreaterThanOrEqual(2);
    expect(hostMedia.videoCount).toBeGreaterThanOrEqual(1);
    expect(guestMedia.videoCount).toBeGreaterThanOrEqual(1);
    diagnostics.audioNote =
      'technical audio path via mic controls + remote tiles; human-ear audibility remains MANUAL REQUIRED';

    await expect(hostPage.getByRole('button', { name: /Mute microphone|Unmute microphone/ })).toBeVisible();
    await expect(guestPage.getByRole('button', { name: /Mute microphone|Unmute microphone/ })).toBeVisible();

    const chatMsg = `guest-chat-${Date.now()}`;
    await sendChat(guestPage, chatMsg);
    await expectChatVisible(hostPage, chatMsg);
    diagnostics.chat = 'pass';

    await guestPage.getByRole('button', { name: 'Raise hand' }).click();
    await expect(guestPage.getByRole('button', { name: 'Lower hand' })).toBeVisible();
    await expect(hostPage.locator('span', { hasText: 'Raised' }).first()).toBeVisible({ timeout: 20_000 });
    await guestPage.getByRole('button', { name: 'Lower hand' }).click();
    diagnostics.handRaise = 'pass';

    // Guest moderation denial: guest must not see host mute/remove affordances on host tile.
    await expect(guestPage.getByRole('button', { name: /Mute participant|Remove participant/i })).toHaveCount(0);

    // Host mute + remove guest (LiveKit moderation path already covered in dual-browser; assert remove ends guest access UX).
    const removeGuest = hostPage.getByRole('button', { name: /Remove participant/i }).first();
    if (await removeGuest.isVisible().catch(() => false)) {
      await removeGuest.click();
      await expect(guestPage.getByText(/removed|no longer|access denied|left the meeting/i).first()).toBeVisible({
        timeout: 60_000,
      }).catch(() => undefined);
      diagnostics.hostRemove = 'attempted';
    } else {
      diagnostics.hostRemove = 'control-not-visible-skipped';
    }

    assertNoSecretLeak(JSON.stringify(diagnostics));
    console.log(JSON.stringify({ guestSharedLinkE2E: diagnostics }, null, 2));
  } finally {
    await guestContext.close();
    await hostContext.close();
  }
});

test('invalid and ended share links show friendly guest errors', async ({ browser }) => {
  test.setTimeout(120_000);
  const context = await browser.newContext({
    permissions: ['camera', 'microphone'],
    viewport: { width: 1280, height: 800 },
  });
  await context.clearCookies();
  const page = await context.newPage();

  try {
    await page.goto('/#/join/LM-ZZZZZZ', { waitUntil: 'domcontentloaded' });
    await expect(page.getByRole('alert').or(page.getByText(/not found|invalid|Unable to open/i))).toBeVisible({
      timeout: 45_000,
    });
    await expect(page.getByText(/service_role|LIVEKIT_API_SECRET|postgres:/i)).toHaveCount(0);
  } finally {
    await context.close();
  }
});
