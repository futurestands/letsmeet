/**
 * AI meeting-assistant provider interface.
 * Jobs stay queued until a real provider is configured. Never fabricate completions.
 */

export function aiProviderConfigured() {
  return Boolean(process.env.AI_PROVIDER && process.env.AI_API_KEY);
}

export function aiStatusPayload() {
  return {
    configured: aiProviderConfigured(),
    supportedJobs: ['summary', 'action_items', 'decisions', 'transcript_qa'],
    note: 'AI jobs remain queued until a provider accepts them. Queued does not mean completed.',
  };
}

export async function executeAiJob(job, deps = {}) {
  if (!job || !['queued', 'processing'].includes(job.status)) {
    return { completed: false, skipped: true, reason: 'Job is not executable.' };
  }

  if (!aiProviderConfigured()) {
    return {
      completed: false,
      skipped: true,
      reason: 'AI provider is not configured. The job remains queued.',
      status: 'PROVIDER_REQUIRED',
    };
  }

  if (deps.executeConfigured) {
    return deps.executeConfigured(job);
  }

  return {
    completed: false,
    skipped: true,
    reason: `AI provider "${process.env.AI_PROVIDER}" credentials are present, but no vendor adapter is enabled yet.`,
    status: 'PROVIDER_REQUIRED',
  };
}
