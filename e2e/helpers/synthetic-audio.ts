import type { BrowserContext } from '@playwright/test';

/**
 * Inject a Web Audio oscillator into getUserMedia audio tracks so LiveKit
 * active-speaker detection has energy to measure. Does not mock LiveKit.
 */
export async function enableSyntheticSpeakingAudio(context: BrowserContext) {
  await context.addInitScript(() => {
    const mediaDevices = navigator.mediaDevices;
    if (!mediaDevices?.getUserMedia) return;
    const original = mediaDevices.getUserMedia.bind(mediaDevices);
    mediaDevices.getUserMedia = async (constraints) => {
      const stream = await original(constraints);
      const wantsAudio = typeof constraints === 'object' && constraints !== null && Boolean((constraints as MediaStreamConstraints).audio);
      if (!wantsAudio) return stream;
      try {
        const audioContext = new AudioContext();
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        const destination = audioContext.createMediaStreamDestination();
        oscillator.type = 'sine';
        oscillator.frequency.value = 880;
        gain.gain.value = 0.4;
        oscillator.connect(gain);
        gain.connect(destination);
        oscillator.start();
        for (const track of stream.getAudioTracks()) {
          stream.removeTrack(track);
          track.stop();
        }
        for (const track of destination.stream.getAudioTracks()) {
          stream.addTrack(track);
        }
        (window as unknown as { __letsmeetTone?: unknown }).__letsmeetTone = {
          audioContext,
          oscillator,
          gain,
        };
      } catch {
        // Keep original stream if Web Audio injection fails.
      }
      return stream;
    };
  });
}

export async function setToneGain(page: import('@playwright/test').Page, value: number) {
  await page.evaluate((gainValue) => {
    const tone = (window as unknown as { __letsmeetTone?: { gain?: GainNode } }).__letsmeetTone;
    if (tone?.gain) tone.gain.gain.value = gainValue;
  }, value);
}
