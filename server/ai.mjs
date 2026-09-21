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

export const AI_JOB_STATUS = {
  QUEUED: 'queued',
  PROCESSING: 'processing',
  COMPLETED: 'completed',
  FAILED: 'failed',
  UNCONFIGURED: 'unconfigured',
};

export const AI_JOB_TYPES = {
  SUMMARY: 'summary',
  EXECUTIVE_SUMMARY: 'executive_summary',
  ACTION_ITEMS: 'action_items',
  DECISIONS: 'decisions',
  TOPICS: 'topics',
  TRANSCRIPT_QA: 'transcript_qa',
};

export async function executeAiJob(job, deps = {}) {
  if (!job || !['queued', 'processing'].includes(job.status)) {
    return { completed: false, skipped: true, reason: 'Job is not executable.' };
  }

  if (!aiProviderConfigured()) {
    return {
      completed: false,
      skipped: true,
      reason: 'AI provider is not configured. The job remains queued.',
      status: AI_JOB_STATUS.UNCONFIGURED,
    };
  }

  if (deps.executeConfigured) {
    return deps.executeConfigured(job);
  }

  // Adapter for future providers (e.g., OpenAI, Anthropic, Gemini)
  const provider = String(process.env.AI_PROVIDER || '').toLowerCase();

  return {
    completed: false,
    skipped: true,
    reason: `AI provider "${provider}" credentials are present, but no vendor adapter is enabled yet.`,
    status: AI_JOB_STATUS.UNCONFIGURED,
  };
}
