/**
 * Transcription provider interface.
 * Never invent transcript text. Jobs stay queued without a configured provider.
 */

export function transcriptionProviderConfigured() {
  return Boolean(
    process.env.TRANSCRIPTION_PROVIDER
    && process.env.TRANSCRIPTION_API_KEY,
  );
}

export function transcriptionStatusPayload() {
  return {
    configured: transcriptionProviderConfigured(),
    note: 'Transcription jobs remain queued until a provider accepts them. Queued does not mean transcribed.',
  };
}

export const TRANSCRIPTION_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  UNCONFIGURED: 'unconfigured',
};

export async function executeTranscriptionJob(job, deps = {}) {
  if (!job || !['queued', 'processing'].includes(job.status)) {
    return { completed: false, skipped: true, reason: 'Job is not executable.' };
  }

  if (!transcriptionProviderConfigured()) {
    return {
      completed: false,
      skipped: true,
      reason: 'Transcription provider is not configured. The job remains queued.',
      status: TRANSCRIPTION_STATUS.UNCONFIGURED,
    };
  }

  if (deps.executeConfigured) {
    return deps.executeConfigured(job);
  }

  // Adapter for future providers (e.g., Deepgram, Whisper)
  const provider = String(process.env.TRANSCRIPTION_PROVIDER || '').toLowerCase();

  return {
    completed: false,
    skipped: true,
    reason: `Transcription provider "${provider}" credentials are present, but no vendor adapter is enabled yet.`,
    status: TRANSCRIPTION_STATUS.UNCONFIGURED,
  };
}
