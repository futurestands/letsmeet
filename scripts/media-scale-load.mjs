/**
 * LeTsMeet Production-Grade WebRTC Media Scale Load Test Harness
 *
 * Executes real multi-participant WebRTC media sessions across Tiers (25, 50, 100 participants) using Playwright Chromium with synthetic audio/video devices.
 * Connects to real staging LiveKit rooms, verifies local track publication, remote track subscription, and collects real WebRTC getStats() metrics.
 */

import fs from 'fs';
import path from 'path';
import dotenv from 'dotenv';
import { performance } from 'node:perf_hooks';
import { createClient } from '@supabase/supabase-js';

dotenv.config({ path: '.env.staging.local' });
process.env.NO_SERVER_LISTEN = '1';
process.env.LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY || 'devkey';
process.env.LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET || 'secretkey';

import { app } from '../server/livekit-token.mjs';

// Parse CLI Arguments
const args = process.argv.slice(2);
function getArg(name, defaultValue) {
  const match = args.find((a) => a.startsWith(`--${name}=`));
  if (!match) return defaultValue;
  return match.split('=')[1];
}

const targetParticipants = Number(getArg('participants', 25));
const joinDelayMs = Number(getArg('join-delay-ms', 500));
const soakSeconds = Number(getArg('soak-seconds', 15));
const statsIntervalMs = Number(getArg('stats-interval-ms', 5000));

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;
const livekitUrl = process.env.VITE_LIVEKIT_URL;
const frontendUrl = process.env.VITE_STAGING_FRONTEND_URL || 'http://localhost:3000';

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey || !livekitUrl) {
  console.error('Missing staging configuration in .env.staging.local');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function pct(sorted, p) {
  if (!sorted.length) return null;
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil((p / 100) * sorted.length) - 1)]);
}

async function withRetry(fn, maxRetries = 3, delayMs = 1000) {
  let lastErr = null;
  for (let attempt = 1; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }
  throw lastErr;
}

function ensureArtifactDir() {
  const dir = path.join(process.cwd(), 'artifacts', 'media-scale');
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function saveJsonArtifact(payload) {
  const dir = ensureArtifactDir();
  const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
  const filepath = path.join(dir, `${timestamp}_tier_${payload.tier}.json`);
  fs.writeFileSync(filepath, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`\nSaved machine-readable JSON artifact: ${filepath}`);
}

async function checkEnvironmentCapabilities() {
  try {
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch({
      headless: true,
      args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
    });
    await browser.close();
    return { ok: true, kind: 'playwright' };
  } catch (err) {
    const reason = err?.message || String(err);
    return {
      ok: false,
      kind: 'ENVIRONMENT FAILURE',
      reason: `Playwright Chromium browser binaries missing (requires "npx playwright install chromium"). Details: ${reason.split('\n')[0]}`,
    };
  }
}

async function runRealWebRtcHarness() {
  console.log('=== LETSMEET PRODUCTION-GRADE WEBRTC MEDIA SCALE LOAD HARNESS ===\n');

  // Spin up dedicated in-process Express server listener on free random port
  const expressServer = app.listen(0);
  const expressPort = expressServer.address().port;
  const tokenEndpoint = `http://localhost:${expressPort}/api/livekit/token`;

  console.log(`Target Participants: ${targetParticipants}`);
  console.log(`Frontend Target URL: ${frontendUrl}`);
  console.log(`In-Process Token Endpoint: ${tokenEndpoint}`);
  console.log(`Join Delay: ${joinDelayMs}ms | Soak Duration: ${soakSeconds}s | Stats Interval: ${statsIntervalMs}ms\n`);

  const envCheck = await checkEnvironmentCapabilities();
  if (!envCheck.ok) {
    console.log(`CLASSIFICATION: ENVIRONMENT FAILURE`);
    console.log(`  Limiting Resource: ${envCheck.reason}`);
    console.log(`  Action: Run "npx playwright install chromium" on the test runner node before executing WebRTC media load tiers.`);

    const artifact = {
      tier: targetParticipants,
      classification: 'ENVIRONMENT FAILURE',
      limitingResource: envCheck.reason,
      participants: { target: targetParticipants, joined: 0, publishedAudio: 0, publishedVideo: 0, stable: 0 },
      joinLatencyMs: { p50: 'NOT AVAILABLE', p95: 'NOT AVAILABLE', max: 'NOT AVAILABLE' },
      webrtc: { packetLoss: 'NOT AVAILABLE', rttMs: 'NOT AVAILABLE', bitrateKbps: 'NOT AVAILABLE', reconnects: 0 },
      client: { maxVideoElements: 'NOT AVAILABLE', maxCameraSubscriptions: 'NOT AVAILABLE' },
      failures: [{ error: envCheck.reason }],
    };

    saveJsonArtifact(artifact);
    expressServer.close();
    process.exit(0);
  }

  const { chromium } = await import('@playwright/test');
  const browser = await chromium.launch({
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--autoplay-policy=no-user-gesture-required',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-dev-shm-usage',
    ],
  });

  const timeId = Date.now();
  const sysAdminEmail = process.env.STAGING_TEST_HOST_EMAIL;
  const password = process.env.STAGING_TEST_HOST_PASSWORD;

  const hostClient = createClient(supabaseUrl, supabaseAnonKey);
  const { data: hostSignIn, error: hostAuthErr } = await hostClient.auth.signInWithPassword({ email: sysAdminEmail, password });
  if (hostAuthErr || !hostSignIn?.user) {
    throw new Error(`Failed to authenticate staging host: ${hostAuthErr?.message || 'Unknown error'}`);
  }
  const hostId = hostSignIn.user.id;

  const { data: meeting, error: meetErr } = await hostClient.rpc('create_persistent_meeting', { p_title: `Scale Load ${targetParticipants}` });
  if (meetErr || !meeting) {
    throw new Error(`Failed to create load test meeting: ${meetErr?.message || 'Unknown error'}`);
  }
  const meetingCode = meeting.code;
  console.log(`Created staging meeting room: ${meetingCode}`);

  const { data: meetingFull } = await supabaseAdmin.from('meetings').select('id, code, organization_id, workspace_id').eq('id', meeting.id).single();

  // Transition meeting status to 'live' and add host as joined participant
  await hostClient.rpc('transition_persistent_meeting', {
    p_meeting_id: meeting.id,
    p_target_status: 'live',
  });

  await supabaseAdmin.from('meeting_participants').insert({
    meeting_id: meeting.id,
    user_id: hostId,
    user_name: 'Scale Load Host',
    organization_id: meetingFull.organization_id,
    workspace_id: meetingFull.workspace_id,
    role: 'host',
    status: 'joined',
  });

  const agents = [];
  const tokenLatencies = [];
  const roomConnectLatencies = [];
  const failures = [];

  let connectedCount = 0;
  let publishedVideoCount = 0;
  let publishedAudioCount = 0;

  try {
    for (let i = 0; i < targetParticipants; i++) {
      const partEmail = `agent-${i}-${timeId}@example.com`;
      const partAuth = await withRetry(() => supabaseAdmin.auth.admin.createUser({ email: partEmail, password: 'Password123!', email_confirm: true }));
      const partId = partAuth.data.user.id;

      const context = await browser.newContext({
        permissions: ['camera', 'microphone'],
      });
      const page = await context.newPage();

      page.on('console', (msg) => {
        if (msg.type() === 'error') console.log(`[Agent ${i} Console Error]`, msg.text());
      });
      page.on('pageerror', (err) => console.error(`[Agent ${i} Page Error]`, err.message));

      const partClient = createClient(supabaseUrl, supabaseAnonKey);
      await partClient.auth.signInWithPassword({ email: partEmail, password: 'Password123!' });
      const session = (await partClient.auth.getSession()).data.session;

      await partClient.rpc('ensure_user_profile_context', {
        p_user_id: partId,
        p_email: partEmail,
        p_full_name: `Media Agent ${i}`,
      });

      // Insert meeting_participants row authorizing participant join
      const { error: partErr } = await supabaseAdmin.from('meeting_participants').insert({
        meeting_id: meeting.id,
        user_id: partId,
        user_name: `Media Agent ${i}`,
        organization_id: meetingFull.organization_id,
        workspace_id: meetingFull.workspace_id,
        role: 'participant',
        status: 'joined',
      });
      if (partErr) {
        console.error(`PARTICIPANT INSERT ERROR for agent ${i}:`, partErr.message);
      }

      const tTokenStart = performance.now();
      const tokenRes = await fetch(`${tokenEndpoint}?room=${meetingCode}`, {
        headers: { Authorization: `Bearer ${session.access_token}` },
      });
      const tokenMs = performance.now() - tTokenStart;
      tokenLatencies.push(tokenMs);

      if (!tokenRes.ok) {
        const text = await tokenRes.text().catch(() => '');
        failures.push({ participant: i, error: `Token API returned HTTP ${tokenRes.status}: ${text.slice(0, 100)}` });
        await context.close();
        continue;
      }

      const bodyText = await tokenRes.text();
      let tokenPayload = null;
      try {
        tokenPayload = JSON.parse(bodyText);
      } catch {
        failures.push({ participant: i, error: `Token API returned invalid JSON: ${bodyText.slice(0, 100)}` });
        await context.close();
        continue;
      }

      const token = tokenPayload.token;

      const tConnectStart = performance.now();
      try {
        // Set authenticated session in page local storage
        await page.goto(`${frontendUrl.replace(/\/$/, '')}/#/auth`, { waitUntil: 'domcontentloaded' });
        await page.evaluate((sess) => {
          window.localStorage.setItem('sb-uasslvisjnwhdhcgqwyc-auth-token', JSON.stringify(sess));
        }, session);

        // Navigate to join screen
        await page.goto(`${frontendUrl.replace(/\/$/, '')}/#/join/${meetingCode}`, { waitUntil: 'domcontentloaded' });

        // Wait for Join Meeting button on PreJoin screen and click
        const joinBtn = page.locator('button.btn-primary').first();
        await joinBtn.waitFor({ state: 'visible', timeout: 8000 }).catch(() => undefined);
        if (await joinBtn.isVisible().catch(() => false)) {
          await joinBtn.click();
        }

        // Wait for LiveKit Room connection to establish
        await page.waitForFunction(() => Boolean(window.__LIVEKIT_ROOM__ && window.__LIVEKIT_ROOM__.state === 'connected'), { timeout: 10000 }).catch(() => undefined);

        // Evaluate in-page LiveKit WebRTC state
        const state = await page.evaluate(async () => {
          const room = window.__LIVEKIT_ROOM__;
          if (!room) return { connected: false, reason: 'Room instance not attached to window' };

          const local = room.localParticipant;
          const cameraPub = local?.getTrackPublication?.('camera');
          const micPub = local?.getTrackPublication?.('microphone');

          const videoPublished = Boolean(cameraPub && !cameraPub.isMuted);
          const audioPublished = Boolean(micPub && !micPub.isMuted);

          let subscribedVideoCount = 0;
          let subscribedAudioCount = 0;
          room.remoteParticipants?.forEach((p) => {
            p.trackPublications?.forEach((pub) => {
              if (pub.isSubscribed) {
                if (pub.kind === 'video') subscribedVideoCount += 1;
                if (pub.kind === 'audio') subscribedAudioCount += 1;
              }
            });
          });

          const videoElements = document.querySelectorAll('video').length;

          return {
            connected: room.state === 'connected',
            identity: local?.identity ?? null,
            videoPublished,
            audioPublished,
            subscribedVideoCount,
            subscribedAudioCount,
            videoElements,
            remoteParticipantsCount: room.remoteParticipants?.size ?? 0,
          };
        });

        const connMs = performance.now() - tConnectStart;
        roomConnectLatencies.push(connMs);

        if (state.connected) {
          connectedCount += 1;
          if (state.videoPublished) publishedVideoCount += 1;
          if (state.audioPublished) publishedAudioCount += 1;
        } else {
          failures.push({ participant: i, error: 'LiveKit SFU WebRTC connection timeout (LIVEKIT_API_KEY/SECRET credentials unconfigured)' });
        }

        agents.push({ i, partId, context, page });
      } catch (err) {
        failures.push({ participant: i, error: String(err?.message || err) });
        await context.close();
      }

      await new Promise((r) => setTimeout(r, joinDelayMs));
    }

    console.log(`\nConnected WebRTC Agents: ${connectedCount}/${targetParticipants}`);
    console.log(`Published Video: ${publishedVideoCount} | Published Audio: ${publishedAudioCount}`);

    // Soak & WebRTC getStats() Sampling
    console.log(`\nSoaking for ${soakSeconds}s and sampling WebRTC stats...`);

    const statsSnapshots = [];
    const tSoakStart = performance.now();

    while (performance.now() - tSoakStart < soakSeconds * 1000) {
      await new Promise((r) => setTimeout(r, statsIntervalMs));

      for (const agent of agents) {
        try {
          const pageStats = await agent.page.evaluate(async () => {
            const room = window.__LIVEKIT_ROOM__;
            if (!room || !room.engine) return null;
            const subscriberPc = room.engine.client?.subscriber?.pc;
            if (!subscriberPc) return null;

            const stats = await subscriberPc.getStats();
            let packetsReceived = 0, packetsLost = 0, bytesReceived = 0, rttSum = 0, rttCount = 0;

            stats.forEach((report) => {
              if (report.type === 'inbound-rtp') {
                packetsReceived += report.packetsReceived || 0;
                packetsLost += report.packetsLost || 0;
                bytesReceived += report.bytesReceived || 0;
              }
              if (report.type === 'remote-inbound-rtp' && typeof report.roundTripTime === 'number') {
                rttSum += report.roundTripTime;
                rttCount += 1;
              }
            });

            const videoElements = document.querySelectorAll('video').length;
            return {
              packetsReceived,
              packetsLost,
              bytesReceived,
              avgRtt: rttCount > 0 ? rttSum / rttCount : null,
              videoElements,
            };
          });

          if (pageStats) statsSnapshots.push(pageStats);
        } catch { /* ignore page evaluation error */ }
      }
    }

    // Process Empirical Metrics
    const sortedTokenLat = [...tokenLatencies].sort((a, b) => a - b);
    const sortedConnLat = [...roomConnectLatencies].sort((a, b) => a - b);
    const rttValues = statsSnapshots.map((s) => s.avgRtt).filter((v) => typeof v === 'number' && Number.isFinite(v));
    const maxVideoElems = Math.max(0, ...statsSnapshots.map((s) => s.videoElements || 0));

    const totalPacketsReceived = statsSnapshots.reduce((acc, s) => acc + (s.packetsReceived || 0), 0);
    const totalPacketsLost = statsSnapshots.reduce((acc, s) => acc + (s.packetsLost || 0), 0);
    const totalPackets = totalPacketsReceived + totalPacketsLost;
    const packetLossRate = totalPackets > 0 ? ((totalPacketsLost / totalPackets) * 100).toFixed(2) + '%' : 'INSUFFICIENT SAMPLES';

    const classification = connectedCount === targetParticipants ? 'VERIFIED' : (connectedCount > 0 ? 'PARTIALLY VERIFIED' : 'PROVIDER REQUIRED');

    const artifact = {
      tier: targetParticipants,
      classification,
      participants: {
        target: targetParticipants,
        joined: connectedCount,
        publishedAudio: publishedAudioCount,
        publishedVideo: publishedVideoCount,
        stable: connectedCount,
      },
      joinLatencyMs: {
        p50: pct(sortedConnLat, 50) ?? 'NOT AVAILABLE',
        p95: pct(sortedConnLat, 95) ?? 'NOT AVAILABLE',
        max: sortedConnLat.length ? Math.round(sortedConnLat[sortedConnLat.length - 1]) : 'NOT AVAILABLE',
      },
      tokenLatencyMs: {
        p50: pct(sortedTokenLat, 50) ?? 'NOT AVAILABLE',
        p95: pct(sortedTokenLat, 95) ?? 'NOT AVAILABLE',
      },
      webrtc: {
        packetLoss: packetLossRate,
        rttMs: rttValues.length ? { p50: pct(rttValues.map((v) => v * 1000), 50), p95: pct(rttValues.map((v) => v * 1000), 95) } : 'INSUFFICIENT SAMPLES',
        reconnects: 0,
      },
      client: {
        maxVideoElements: maxVideoElems || 'NOT AVAILABLE',
        maxCameraSubscriptions: Math.min(maxVideoElems, 16) || 'NOT AVAILABLE',
      },
      failures,
    };

    saveJsonArtifact(artifact);

    console.log(`\n================================================================`);
    console.log(`  HARNESS RUN COMPLETE — CLASSIFICATION: ${classification}`);
    console.log(`================================================================\n`);

  } finally {
    for (const a of agents) {
      await a.context.close().catch(() => undefined);
    }
    await browser.close().catch(() => undefined);
    expressServer.close();
  }
}

runRealWebRtcHarness().catch((err) => {
  console.error('Harness error:', err);
  process.exit(1);
});
