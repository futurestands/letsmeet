const MEETING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export function generateMeetingCode(): string {
  const values = new Uint32Array(6);
  crypto.getRandomValues(values);

  const code = Array.from(values)
    .map((value) => MEETING_ALPHABET[value % MEETING_ALPHABET.length])
    .join('');

  return `LM-${code}`;
}

export function normalizeMeetingCode(input: string): string {
  const sanitized = input.trim().toUpperCase().replace(/[^A-Z0-9]/g, '');

  if (!sanitized) {
    return 'LM-INVALID';
  }

  const token = sanitized.length >= 6 ? sanitized.slice(-6) : sanitized;
  if (token.length !== 6) {
    return 'LM-INVALID';
  }

  return `LM-${token}`;
}
