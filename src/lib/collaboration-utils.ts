export const POLL_OPTION_LIMITS = { min: 2, max: 8 } as const;
export const WHITEBOARD_OP_TYPES = ['stroke', 'clear', 'undo', 'redo'] as const;
export const AI_JOB_TYPES = [
  'summary',
  'executive_summary',
  'action_items',
  'decisions',
  'topics',
  'transcript_qa',
] as const;

export function sanitizePollOptions(raw: string[]): string[] {
  const unique: string[] = [];
  for (const option of raw.map((value) => value.trim()).filter(Boolean)) {
    if (!unique.some((item) => item.toLowerCase() === option.toLowerCase())) unique.push(option);
  }
  return unique.slice(0, POLL_OPTION_LIMITS.max);
}

export function canCreatePoll(options: string[], question: string): boolean {
  return Boolean(question.trim()) && sanitizePollOptions(options).length >= POLL_OPTION_LIMITS.min;
}

export function isWhiteboardOpType(value: string): value is (typeof WHITEBOARD_OP_TYPES)[number] {
  return WHITEBOARD_OP_TYPES.includes(value as (typeof WHITEBOARD_OP_TYPES)[number]);
}

export function recordingStatusLabel(status?: string | null): string {
  switch (status) {
    case 'queued':
      return 'Queued until LiveKit egress is configured';
    case 'starting':
      return 'Starting';
    case 'active':
      return 'Recording';
    case 'processing':
      return 'Processing';
    case 'completed':
      return 'Ready to play';
    case 'failed':
      return 'Failed';
    default:
      return 'Not recording';
  }
}

export function aiJobStatusLabel(status?: string | null): string {
  switch (status) {
    case 'queued':
      return 'Queued';
    case 'processing':
      return 'Processing';
    case 'completed':
      return 'Completed';
    case 'failed':
      return 'Failed';
    case 'unconfigured':
      return 'Waiting for an AI provider';
    default:
      return 'Not started';
  }
}
