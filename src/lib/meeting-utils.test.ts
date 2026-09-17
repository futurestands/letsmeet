import { describe, expect, it } from 'vitest';
import { generateMeetingCode, normalizeMeetingCode } from './meeting-utils';

describe('meeting utilities', () => {
  it('creates a valid human-friendly meeting code', () => {
    const code = generateMeetingCode();

    expect(code).toMatch(/^LM-[A-Z0-9]{6}$/);
  });

  it('normalizes and validates a meeting code input', () => {
    expect(normalizeMeetingCode(' lets-meet-abc123 ')).toBe('LM-ABC123');
    expect(normalizeMeetingCode('abc')).toBe('LM-INVALID');
  });
});
