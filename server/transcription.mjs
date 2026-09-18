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

export async function executeTranscriptionJob(job, deps = {}) {
  if (!job || !['queued', 'processing'].includes(job.status)) {
    return { completed: false, skipped: true, reason: 'Job is not executable.' };
  }

  if (!transcriptionProviderConfigured()) {
    return {
      completed: false,
      skipped: true,
      reason: 'Transcription provider is not configured. The job remains queued.',
      status: 'PROVIDER_REQUIRED',
    };
  }

  if (deps.executeConfigured) {
    return deps.executeConfigured(job);
  }

  return {
    completed: false,
    skipped: true,
    reason: `Transcription provider "${process.env.TRANSCRIPTION_PROVIDER}" credentials are present, but no vendor adapter is enabled yet.`,
    status: 'PROVIDER_REQUIRED',
  };
}
