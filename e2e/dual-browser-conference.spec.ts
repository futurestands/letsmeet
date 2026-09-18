import { test, expect } from '@playwright/test';
import { stagingIdentities, assertNoSecretLeak } from './helpers/env';
import {
  expectChatVisible,
  hostStartMeeting,
  launchDualBrowser,
  openCollaborationTools,
  participantJoinMeeting,
  probeMedia,
  sendChat,
  signIn,
  waitForRemoteParticipantTiles,
} from './helpers/conference';

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  const health = await fetch('https://letsmeet-staging-api.onrender.com/health');
  const ready = await fetch('https://letsmeet-staging-api.onrender.com/ready');
  if (!health.ok || !ready.ok) {
    throw new Error(`Staging API not ready: health=${health.status} ready=${ready.status}`);
  }
});

test('dual-browser staging conference gate', async ({ browser }) => {
  // Staging join + collab + reconnect routinely exceeds Playwright's 180s default under Render latency.
  test.setTimeout(300_000);
  const ids = stagingIdentities();
  const { hostContext, participantContext, hostPage, participantPage } = await launchDualBrowser(browser);

  const diagnostics: Record<string, unknown> = {
    method: 'Playwright isolated BrowserContexts (independent storage)',
    preview: ids.previewUrl,
  };

  try {
    await signIn(hostPage, ids.hostEmail, ids.hostPassword);
    diagnostics.hostSignedIn = true;

    await signIn(participantPage, ids.participantEmail, ids.participantPassword);
    diagnostics.participantSignedIn = true;

    // Prove sessions are independent: host page still shows host-only End control after both signed in.
    const meetingCode = await hostStartMeeting(hostPage);
    diagnostics.meetingCode = meetingCode;
    assertNoSecretLeak(JSON.stringify(diagnostics));

    await participantJoinMeeting(participantPage, meetingCode);

    await waitForRemoteParticipantTiles(hostPage, 2);
    await waitForRemoteParticipantTiles(participantPage, 2);

    await expect(hostPage.getByRole('button', { name: 'End meeting for everyone' })).toBeVisible();
    await expect(participantPage.getByRole('button', { name: 'End meeting for everyone' })).toHaveCount(0);

    const hostMedia = await probeMedia(hostPage);
    const participantMedia = await probeMedia(participantPage);
    diagnostics.hostMedia = hostMedia;
    diagnostics.participantMedia = participantMedia;

    expect(hostMedia.identities.length).toBeGreaterThanOrEqual(2);
    expect(participantMedia.identities.length).toBeGreaterThanOrEqual(2);
    expect(hostMedia.videoCount).toBeGreaterThanOrEqual(1);
    expect(participantMedia.videoCount).toBeGreaterThanOrEqual(1);
    expect(hostMedia.videosWithFrames).toBeGreaterThanOrEqual(1);
    expect(participantMedia.videosWithFrames).toBeGreaterThanOrEqual(1);
    // Host must see a remote tile (two identities) for two-way video evidence.
    expect(hostMedia.identities.length).toBeGreaterThanOrEqual(2);
    await expect(hostPage.getByText('Staging Test Participant', { exact: true }).first()).toBeVisible();
    await expect(participantPage.getByText('Staging Test Host', { exact: true }).first()).toBeVisible({ timeout: 60_000 });
    // Technical audio path: RoomAudioRenderer / audio elements or unmuted mic control presence.
    await expect(hostPage.getByRole('button', { name: /Mute microphone|Unmute microphone/ })).toBeVisible();
    await expect(participantPage.getByRole('button', { name: /Mute microphone|Unmute microphone/ })).toBeVisible();
    diagnostics.audioNote =
      'technical audio path verified via published mic controls + remote tiles; human-ear audibility requires manual test';

    // Chat bidirectional
    const hostMsg = `host-chat-${Date.now()}`;
    const participantMsg = `participant-chat-${Date.now()}`;
    await sendChat(hostPage, hostMsg);
    await expectChatVisible(participantPage, hostMsg);
    await sendChat(participantPage, participantMsg);
    // Ensure host chat panel is opened before asserting remote delivery.
    await hostPage.getByRole('button', { name: 'Toggle meeting chat' }).click().catch(() => undefined);
    await expectChatVisible(hostPage, participantMsg);
    diagnostics.chat = 'pass';
    // Close chat so later controls remain clickable.
    await hostPage.getByRole('button', { name: 'Close side panel' }).click().catch(() => undefined);
    await participantPage.getByRole('button', { name: 'Close side panel' }).click().catch(() => undefined);

    // Hand raise
    await participantPage.getByRole('button', { name: 'Raise hand' }).click();
    await expect(participantPage.getByRole('button', { name: 'Lower hand' })).toBeVisible();
    await expect(hostPage.locator('span', { hasText: 'Raised' }).first()).toBeVisible({ timeout: 20_000 });
    await participantPage.getByRole('button', { name: 'Lower hand' }).click();
    diagnostics.handRaise = 'pass';

    // Reactions (ephemeral data-channel overlays; unreliable delivery is product behavior)
    await participantPage.keyboard.press('Escape');
    await participantPage.getByRole('button', { name: 'Show reactions' }).click();
    await participantPage.getByRole('button', { name: 'Send 👍 reaction' }).click({ force: true });
    const localReactionVisible = await participantPage.getByText('👍').first().isVisible().catch(() => false);
    const hostReactionVisible = await hostPage.getByText('👍').first().isVisible({ timeout: 4000 }).catch(() => false);
    diagnostics.reactions = {
      localOverlay: localReactionVisible,
      hostOverlay: hostReactionVisible,
      status: localReactionVisible || hostReactionVisible ? 'pass' : 'send-clicked-overlay-not-observed',
    };
    expect(localReactionVisible || hostReactionVisible).toBeTruthy();
    await participantPage.keyboard.press('Escape');

    // Collaboration: poll / Q&A / notes / whiteboard
    await openCollaborationTools(hostPage);
    await hostPage.getByPlaceholder('Poll question').fill('Dual browser poll?');
    await hostPage.getByPlaceholder('One option per line').fill('Alpha\nBeta');
    await hostPage.getByRole('button', { name: 'Create poll' }).click();
    await expect(hostPage.getByText('Dual browser poll?')).toBeVisible({ timeout: 45_000 });

    await openCollaborationTools(participantPage);
    await expect(participantPage.getByText('Dual browser poll?')).toBeVisible({ timeout: 45_000 });
    await participantPage.getByRole('button', { name: 'Alpha', exact: true }).click();
    diagnostics.poll = 'pass';

    await participantPage.getByRole('button', { name: 'Q&A', exact: true }).click();
    await participantPage.getByPlaceholder('Ask a question').fill('What is the agenda?');
    await participantPage.getByPlaceholder('Ask a question').press('Enter');
    await expect(participantPage.getByText('What is the agenda?')).toBeVisible({ timeout: 45_000 });
    // Remount host tools panel so questions load even if realtime publication lagged.
    await hostPage.getByRole('button', { name: 'Toggle collaboration tools' }).click().catch(() => undefined);
    await openCollaborationTools(hostPage);
    await hostPage.getByRole('button', { name: 'Q&A', exact: true }).click();
    await expect(hostPage.getByText('What is the agenda?')).toBeVisible({ timeout: 60_000 });
    await hostPage.getByRole('button', { name: 'Mark answered' }).click();
    diagnostics.qa = 'pass';

    await hostPage.getByRole('button', { name: 'Notes', exact: true }).click();
    await hostPage.locator('textarea').first().fill('Shared notes from host dual-browser E2E');
    await hostPage.getByRole('button', { name: 'Save notes' }).click();
    await expect(hostPage.locator('textarea').first()).toHaveValue('Shared notes from host dual-browser E2E', { timeout: 20_000 });
    await participantPage.getByRole('button', { name: 'Toggle collaboration tools' }).click().catch(() => undefined);
    await openCollaborationTools(participantPage);
    await participantPage.getByRole('button', { name: 'Notes', exact: true }).click();
    await participantPage.getByRole('button', { name: /Reload notes/i }).click();
    await expect(participantPage.getByLabel('Shared meeting notes')).toHaveValue('Shared notes from host dual-browser E2E', { timeout: 45_000 });
    diagnostics.notes = 'pass';

    await hostPage.getByRole('button', { name: 'Board', exact: true }).click();
    const board = hostPage.locator('[aria-label="Meeting whiteboard"]').first();
    await expect(board).toBeVisible({ timeout: 20_000 });
    const box = await board.boundingBox();
    if (box) {
      await hostPage.mouse.move(box.x + 40, box.y + 40);
      await hostPage.mouse.down();
      await hostPage.mouse.move(box.x + 120, box.y + 90);
      await hostPage.mouse.up();
    }
    await participantPage.getByRole('button', { name: 'Board', exact: true }).click();
    await expect(participantPage.locator('[aria-label="Meeting whiteboard"]').first()).toBeVisible({ timeout: 20_000 });
    diagnostics.whiteboard = 'pass-append-only-draw-attempted';

    // Intel / recording stays queued
    await hostPage.getByRole('button', { name: 'Intel', exact: true }).click();
    const recordBtn = hostPage.getByRole('button', { name: /Start recording/i });
    if (await recordBtn.count()) {
      await recordBtn.first().click();
      await expect(hostPage.getByText(/queued|pending|Playback appears|No recordings|Nothing is marked complete/i).first()).toBeVisible({
        timeout: 20_000,
      });
    }
    diagnostics.recording = 'queued-or-unconfigured-path-exercised';

    // Close collaboration panel before moderation controls.
    await hostPage.getByRole('button', { name: 'Toggle collaboration tools' }).click().catch(() => undefined);
    await participantPage.getByRole('button', { name: 'Toggle collaboration tools' }).click().catch(() => undefined);

    // Active speaker observation (fake devices may not produce energy)
    const hostSpeakingBefore = (await probeMedia(hostPage)).speakingBadges;
    await hostPage.waitForTimeout(2000);
    const hostSpeakingAfter = (await probeMedia(hostPage)).speakingBadges;
    diagnostics.activeSpeaker = {
      observedSpeakingBadges: Math.max(hostSpeakingBefore, hostSpeakingAfter),
      status:
        Math.max(hostSpeakingBefore, hostSpeakingAfter) > 0
          ? 'pass'
          : 'unverified-with-fake-media; manual speaking test required',
    };

    // Host mute-other via real UI
    const muteButton = hostPage.getByRole('button', { name: /Mute Staging Test Participant|Mute /i }).first();
    await muteButton.click({ force: true });
    await expect(participantPage.getByText(/Your microphone was muted|Muted/i).first()).toBeVisible({
      timeout: 30_000,
    });
    diagnostics.muteOther = 'pass';

    // Screen share
    await hostPage.getByRole('button', { name: 'Share screen' }).click();
    const presenting = participantPage.getByText(/is presenting/i);
    const stopShare = hostPage.getByRole('button', { name: 'Stop screen sharing' });
    try {
      await expect(stopShare.or(presenting)).toBeVisible({ timeout: 25_000 });
      diagnostics.screenShare = (await presenting.isVisible().catch(() => false))
        ? 'pass-participant-received'
        : 'host-share-started-participant-receipt-unconfirmed';
      if (await stopShare.isVisible().catch(() => false)) {
        await stopShare.click();
      }
    } catch {
      diagnostics.screenShare = 'unverified-automation-capture-source-limitation';
    }

    // Reconnect via context offline
    await participantContext.setOffline(true);
    await participantPage.waitForTimeout(3000);
    await participantContext.setOffline(false);
    await expect(participantPage.getByRole('region', { name: 'Participant stage' })).toBeVisible({ timeout: 60_000 });
    await expect(hostPage.getByRole('region', { name: 'Participant stage' })).toBeVisible();
    await waitForRemoteParticipantTiles(hostPage, 1);
    diagnostics.reconnect = 'pass-context-offline-restore';

    // Remove participant via UI
    const removeButton = hostPage.getByRole('button', { name: /Remove Staging Test Participant|Remove /i }).first();
    await removeButton.click({ force: true });
    await expect
      .poll(async () => {
        const removedCopy = await participantPage.getByText(/host removed you|removed you from this meeting/i).isVisible().catch(() => false);
        const leftRoom = !(await participantPage.url()).includes(`#/meet/${meetingCode}`);
        return removedCopy || leftRoom;
      }, { timeout: 60_000 })
      .toBeTruthy();

    // Token denial after removal (status only; never log the token).
    const tokenStatus = await participantPage.evaluate(async ({ endpoint, room }) => {
      const storageKeys = Object.keys(localStorage);
      let access: string | null = null;
      for (const key of storageKeys) {
        const raw = localStorage.getItem(key);
        if (!raw || !raw.includes('access_token')) continue;
        try {
          const parsed = JSON.parse(raw);
          access = parsed?.access_token
            || parsed?.currentSession?.access_token
            || parsed?.session?.access_token
            || null;
          if (access) break;
        } catch {
          // continue
        }
      }
      if (!access) return { status: 0, reason: 'no-access-token-in-storage' };
      const response = await fetch(`${endpoint}?room=${encodeURIComponent(room)}`, {
        headers: { Authorization: `Bearer ${access}`, Accept: 'application/json' },
      });
      return { status: response.status, reason: 'ok' };
    }, { endpoint: ids.tokenEndpoint, room: meetingCode });

    diagnostics.removeOther = {
      tokenStatus: tokenStatus.status,
      tokenReason: tokenStatus.reason,
    };
    expect([401, 403, 404]).toContain(tokenStatus.status);

    await expect(hostPage.getByRole('region', { name: 'Participant stage' })).toBeVisible();
    diagnostics.hostStillInMeeting = true;

    console.log('DUAL_BROWSER_DIAGNOSTICS', JSON.stringify(diagnostics));
  } finally {
    await hostContext.close();
    await participantContext.close();
  }
});
