import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';

const FAKE_MEDIA_ARGS = [
  '--use-fake-ui-for-media-stream',
  '--use-fake-device-for-media-stream',
  '--auto-select-desktop-capture-source=Entire screen',
  '--disable-features=WebRtcHideLocalIpsWithMdns',
] as const;

export async function openIsolatedContext(browser: Browser): Promise<BrowserContext> {
  const context = await browser.newContext({
    permissions: ['camera', 'microphone', 'notifications'],
    viewport: { width: 1280, height: 800 },
    ignoreHTTPSErrors: false,
  });
  // Ensure each context starts with empty storage (independent Supabase sessions).
  await context.clearCookies();
  return context;
}

export async function launchDualBrowser(browser: Browser) {
  const hostContext = await openIsolatedContext(browser);
  const participantContext = await openIsolatedContext(browser);
  const hostPage = await hostContext.newPage();
  const participantPage = await participantContext.newPage();
  return { hostContext, participantContext, hostPage, participantPage };
}

export async function signIn(page: Page, email: string, password: string) {
  await page.goto('/#/auth', { waitUntil: 'domcontentloaded' });
  await page.getByRole('textbox', { name: 'Email' }).fill(email);
  await page.getByRole('textbox', { name: 'Password' }).fill(password);
  await page.getByRole('button', { name: 'Sign In', exact: true }).click();
  await expect(page).toHaveURL(/#\/(?:$|home)?/, { timeout: 45_000 });
  await expect(page.getByRole('button', { name: /Start (a )?meeting|Start Meeting/i }).first()).toBeVisible({
    timeout: 45_000,
  });
}

export async function hostStartMeeting(page: Page): Promise<string> {
  await page.getByRole('button', { name: 'Start Meeting', exact: true }).click();
  await expect(page).toHaveURL(/#\/join\/LM-[A-Z0-9]{6}/, { timeout: 60_000 });
  await page.getByRole('button', { name: 'Join meeting' }).click();
  await expect(page).toHaveURL(/#\/meet\/LM-[A-Z0-9]{6}/, { timeout: 90_000 });
  // Waiting lobby: host must explicitly start the LiveKit session.
  const startLive = page.getByRole('button', { name: 'Start meeting', exact: true });
  await expect(startLive).toBeVisible({ timeout: 60_000 });
  await startLive.click();

  const stage = page.getByRole('region', { name: 'Participant stage' });
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (await stage.isVisible().catch(() => false)) break;
    const tryAgain = page.getByRole('button', { name: 'Try again' });
    if (await tryAgain.isVisible().catch(() => false)) {
      await tryAgain.click();
    }
    const startAgain = page.getByRole('button', { name: 'Start meeting', exact: true });
    if (await startAgain.isVisible().catch(() => false)) {
      await startAgain.click();
    }
    await page.waitForTimeout(2000);
  }
  await expect(stage).toBeVisible({ timeout: 90_000 });
  const match = page.url().match(/LM-[A-Z0-9]{6}/);
  if (!match) throw new Error('Meeting code missing from host URL');
  return match[0];
}

export async function participantJoinMeeting(page: Page, meetingCode: string) {
  await page.goto(`/#/join/${meetingCode}`, { waitUntil: 'domcontentloaded' });
  await expect(page.getByRole('button', { name: 'Join meeting' })).toBeVisible({ timeout: 60_000 });
  await page.getByRole('button', { name: 'Join meeting' }).click();
  await expect(page).toHaveURL(new RegExp(`#/meet/${meetingCode}`), { timeout: 90_000 });
  // If the host already started, stage appears; otherwise waiting lobby briefly then stage.
  const stage = page.getByRole('region', { name: 'Participant stage' });
  await expect(stage).toBeVisible({ timeout: 120_000 });
}

export async function waitForRemoteParticipantTiles(page: Page, minimum = 2) {
  await expect
    .poll(async () => page.locator('[data-participant-identity]').count(), { timeout: 90_000 })
    .toBeGreaterThanOrEqual(minimum);
}

export type MediaProbe = {
  videoCount: number;
  videosWithFrames: number;
  audioCount: number;
  identities: string[];
  mutedBadges: number;
  speakingBadges: number;
  connectionText: string | null;
};

export async function probeMedia(page: Page): Promise<MediaProbe> {
  return page.evaluate(() => {
    const videos = Array.from(document.querySelectorAll('video'));
    const audios = Array.from(document.querySelectorAll('audio'));
    const identities = Array.from(document.querySelectorAll('[data-participant-identity]')).map(
      (node) => node.getAttribute('data-participant-identity') || '',
    );
    const mutedBadges = Array.from(document.querySelectorAll('span')).filter((node) => node.textContent?.includes('Muted')).length;
    const speakingBadges = Array.from(document.querySelectorAll('span')).filter((node) => node.textContent?.trim() === 'Speaking').length;
    const banner = document.querySelector('[role="status"], .connection, .banner');
    return {
      videoCount: videos.length,
      videosWithFrames: videos.filter((video) => video.readyState >= 2 && video.videoWidth > 0).length,
      audioCount: audios.length,
      identities,
      mutedBadges,
      speakingBadges,
      connectionText: banner?.textContent?.trim() || null,
    };
  });
}

export async function openCollaborationTools(page: Page) {
  const tools = page.getByRole('button', { name: 'Toggle collaboration tools' });
  await tools.scrollIntoViewIfNeeded();
  const pollsVisible = await page.getByRole('button', { name: 'Polls', exact: true }).isVisible().catch(() => false);
  if (!pollsVisible) {
    await tools.click();
  }
  await expect(page.getByRole('button', { name: 'Polls', exact: true })).toBeVisible({ timeout: 15_000 });
}

export async function sendChat(page: Page, message: string) {
  const openChat = page.getByRole('button', { name: 'Toggle meeting chat' });
  const composer = page.getByRole('textbox', { name: 'Message' });
  if (!(await composer.isVisible().catch(() => false))) {
    await openChat.click();
  }
  await expect(composer).toBeVisible({ timeout: 10_000 });
  await composer.fill(message);
  await page.getByRole('button', { name: 'Send message' }).click();
  await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 20_000 });
}

export async function expectChatVisible(page: Page, message: string) {
  const openChat = page.getByRole('button', { name: 'Toggle meeting chat' });
  const composer = page.getByRole('textbox', { name: 'Message' });
  if (!(await composer.isVisible().catch(() => false))) {
    await openChat.scrollIntoViewIfNeeded();
    await openChat.click();
  }
  await expect(page.getByText(message, { exact: true })).toBeVisible({ timeout: 45_000 });
}

export { FAKE_MEDIA_ARGS };
