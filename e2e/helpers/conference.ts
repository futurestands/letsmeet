import { expect, type Browser, type BrowserContext, type Page } from '@playwright/test';
import { stagingIdentities } from './env';

export type SetupTimings = {
  hostAuthMs: number;
  participantAuthMs: number;
  meetingCreateMs: number;
  participantJoinMs: number;
  remoteTilesMs: number;
};

export type DualMeetingSetup = {
  hostContext: BrowserContext;
  participantContext: BrowserContext;
  hostPage: Page;
  participantPage: Page;
  meetingCode: string;
  timings: SetupTimings;
};

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

export async function signIn(page: Page, email: string, password: string, retries = 3) {
  for (let i = 0; i < retries; i += 1) {
    try {
      await page.goto('/#/auth', { waitUntil: 'domcontentloaded' });
      await page.getByRole('textbox', { name: 'Email' }).fill(email);
      await page.getByRole('textbox', { name: 'Password' }).fill(password);
      await page.getByRole('button', { name: 'Sign In', exact: true }).click();
      await expect(page).toHaveURL(/#\/(?:$|home)?/, { timeout: 45_000 });
      await expect(page.getByRole('button', { name: /Start (a )?meeting|Start Meeting/i }).first()).toBeVisible({
        timeout: 45_000,
      });
      return;
    } catch (err) {
      if (i === retries - 1) throw err;
      await new Promise((resolve) => setTimeout(resolve, 2000 * (i + 1)));
    }
  }
}

export async function hostStartMeeting(page: Page): Promise<string> {
  const startBtn = page.getByRole('button', { name: /Start (a )?meeting|Start Meeting/i }).first();
  await expect(startBtn).toBeVisible({ timeout: 45_000 });
  await startBtn.click();
  await expect(page).toHaveURL(/#\/join\/LM-[A-Z0-9]{6}/, { timeout: 90_000 });
  const joinBtn = page.getByRole('button', { name: 'Join meeting' });
  await expect(joinBtn).toBeVisible({ timeout: 60_000 });
  await joinBtn.click();
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
  const joinBtn = page.getByRole('button', { name: 'Join meeting' });
  const stage = page.getByRole('region', { name: 'Participant stage' });

  for (let attempt = 0; attempt < 5; attempt += 1) {
    if (await stage.isVisible().catch(() => false)) break;
    if (await joinBtn.isVisible().catch(() => false)) {
      await joinBtn.click();
    }
    const tryAgain = page.getByRole('button', { name: 'Try again' });
    if (await tryAgain.isVisible().catch(() => false)) {
      await tryAgain.click();
    }
    await page.waitForTimeout(3000);
  }
  await expect(stage).toBeVisible({ timeout: 90_000 });
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

export async function createAuthenticatedDualMeeting(browser: Browser): Promise<DualMeetingSetup> {
  const startTs = Date.now();
  const timings: SetupTimings = {
    hostAuthMs: 0,
    participantAuthMs: 0,
    meetingCreateMs: 0,
    participantJoinMs: 0,
    remoteTilesMs: 0,
  };

  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);

  // 1. Host Auth
  await signIn(hostPage, ids.hostEmail, ids.hostPassword);
  timings.hostAuthMs = Date.now() - startTs;

  // 2. Participant Auth
  await signIn(participantPage, ids.participantEmail, ids.participantPassword);
  timings.participantAuthMs = Date.now() - startTs;

  // 3. Meeting Creation
  const meetingCode = await hostStartMeeting(hostPage);
  timings.meetingCreateMs = Date.now() - startTs;

  // 4. Participant Join
  await participantJoinMeeting(participantPage, meetingCode);
  timings.participantJoinMs = Date.now() - startTs;

  // 5. Remote Tiles Visible
  await waitForRemoteParticipantTiles(hostPage, 2);
  await waitForRemoteParticipantTiles(participantPage, 2);
  timings.remoteTilesMs = Date.now() - startTs;

  return {
    hostContext,
    participantContext,
    hostPage,
    participantPage,
    meetingCode,
    timings,
  };
}

export { FAKE_MEDIA_ARGS };
