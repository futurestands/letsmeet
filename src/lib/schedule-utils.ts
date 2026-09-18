export const MEETING_DURATION_OPTIONS = [15, 30, 45, 60, 90, 120] as const;

export const COMMON_TIME_ZONES = [
  'UTC',
  'Africa/Nairobi',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Sao_Paulo',
  'Europe/London',
  'Europe/Paris',
  'Asia/Dubai',
  'Asia/Kolkata',
  'Asia/Singapore',
  'Asia/Tokyo',
  'Australia/Sydney',
] as const;

const DATE_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const TIME_PATTERN = /^\d{2}:\d{2}$/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/i;

export type InvitationStatus = 'pending' | 'accepted' | 'declined' | 'revoked';

export function isValidTimeZone(timeZone: string): boolean {
  try {
    Intl.DateTimeFormat('en-US', { timeZone });
    return Boolean(timeZone);
  } catch {
    return false;
  }
}

export function detectUserTimeZone(): string {
  const timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  return isValidTimeZone(timeZone) ? timeZone : 'UTC';
}

export function timeZonesForSelector(preferred?: string | null): string[] {
  const zones = new Set<string>(COMMON_TIME_ZONES);
  if (preferred && isValidTimeZone(preferred)) zones.add(preferred);
  return [...zones];
}

function timeZoneOffsetMs(instant: Date, timeZone: string): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(instant);
  const values = Object.fromEntries(parts.filter((part) => part.type !== 'literal').map((part) => [part.type, part.value]));
  const asUtc = Date.UTC(
    Number(values.year),
    Number(values.month) - 1,
    Number(values.day),
    Number(values.hour),
    Number(values.minute),
    Number(values.second),
  );
  return asUtc - instant.getTime();
}

export function wallTimeInTimeZoneToUtc(date: string, time: string, timeZone: string): Date {
  if (!DATE_PATTERN.test(date) || !TIME_PATTERN.test(time)) {
    throw new Error('Enter a valid date and time.');
  }
  if (!isValidTimeZone(timeZone)) {
    throw new Error('Choose a valid timezone.');
  }
  const [year, month, day] = date.split('-').map(Number);
  const [hour, minute] = time.split(':').map(Number);
  const utcGuess = Date.UTC(year, month - 1, day, hour, minute, 0);
  const firstPass = utcGuess - timeZoneOffsetMs(new Date(utcGuess), timeZone);
  return new Date(utcGuess - timeZoneOffsetMs(new Date(firstPass), timeZone));
}

export function formatZonedDateTime(value: string | Date, timeZone: string, locale = 'en-US'): string {
  const instant = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(instant.getTime())) return 'Unknown time';
  const zone = isValidTimeZone(timeZone) ? timeZone : 'UTC';
  return new Intl.DateTimeFormat(locale, {
    timeZone: zone,
    weekday: 'short',
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZoneName: 'short',
  }).format(instant);
}

export function formatDurationMinutes(minutes?: number | null): string {
  const value = Number(minutes);
  if (!Number.isFinite(value) || value <= 0) return '30 min';
  if (value % 60 === 0) return value === 60 ? '1 hour' : `${value / 60} hours`;
  return `${value} min`;
}

export function normalizeInviteEmail(email: string): string {
  return email.trim().toLowerCase();
}

export function isValidInviteEmail(email: string): boolean {
  return EMAIL_PATTERN.test(normalizeInviteEmail(email));
}

export function parseInviteEmails(raw: string): string[] {
  const unique = new Set<string>();
  for (const part of raw.split(/[\s,;]+/)) {
    const email = normalizeInviteEmail(part);
    if (isValidInviteEmail(email)) unique.add(email);
  }
  return [...unique];
}

export function invitationSharePath(code: string): string {
  return `/join/${encodeURIComponent(code)}`;
}

export function canManageScheduledMeeting(input: {
  userId?: string | null;
  hostId?: string | null;
  isOrgAdmin?: boolean;
}): boolean {
  if (!input.userId) return false;
  return input.userId === input.hostId || Boolean(input.isOrgAdmin);
}

export function reminderScheduleForMeeting(scheduledFor: Date, intervalsMinutes = [24 * 60, 60, 15], now = new Date()) {
  return intervalsMinutes
    .map((minutes) => new Date(scheduledFor.getTime() - minutes * 60 * 1000))
    .filter((when) => when.getTime() > now.getTime());
}

export function reminderTimeForMeeting(scheduledFor: Date, now = new Date()): Date {
  const upcoming = reminderScheduleForMeeting(scheduledFor, [15], now);
  return upcoming[0] ?? now;
}
