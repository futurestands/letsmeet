import { describe, expect, it } from 'vitest';
import {
  canManageScheduledMeeting,
  formatDurationMinutes,
  formatZonedDateTime,
  isValidInviteEmail,
  parseInviteEmails,
  reminderScheduleForMeeting,
  reminderTimeForMeeting,
  wallTimeInTimeZoneToUtc,
} from './schedule-utils';

describe('schedule utilities', () => {
  it('converts organizer wall time to UTC without depending on the browser timezone', () => {
    const summer = wallTimeInTimeZoneToUtc('2026-07-01', '15:00', 'America/New_York');
    expect(summer.toISOString()).toBe('2026-07-01T19:00:00.000Z');

    const winter = wallTimeInTimeZoneToUtc('2026-01-15', '15:00', 'America/New_York');
    expect(winter.toISOString()).toBe('2026-01-15T20:00:00.000Z');

    const nairobi = wallTimeInTimeZoneToUtc('2026-03-08', '10:00', 'Africa/Nairobi');
    expect(nairobi.toISOString()).toBe('2026-03-08T07:00:00.000Z');
  });

  it('formats stored UTC instants in the viewer timezone', () => {
    const label = formatZonedDateTime('2026-07-01T19:00:00.000Z', 'America/New_York', 'en-US');
    expect(label).toContain('2026');
    expect(label).toMatch(/3:00|15:00/);
  });

  it('parses invite emails without accepting tenant-identifying junk', () => {
    expect(parseInviteEmails('Ada@Company.com, bad, bob@company.com; ada@company.com')).toEqual([
      'ada@company.com',
      'bob@company.com',
    ]);
    expect(isValidInviteEmail('not-an-email')).toBe(false);
  });

  it('keeps scheduling management on the organizer or org admin', () => {
    expect(canManageScheduledMeeting({ userId: 'host', hostId: 'host' })).toBe(true);
    expect(canManageScheduledMeeting({ userId: 'admin', hostId: 'host', isOrgAdmin: true })).toBe(true);
    expect(canManageScheduledMeeting({ userId: 'member', hostId: 'host' })).toBe(false);
    expect(formatDurationMinutes(60)).toBe('1 hour');
  });

  it('schedules 24h, 1h, and 15m reminders without claiming they were delivered', () => {
    const meetingStart = new Date('2026-09-18T18:00:00.000Z');
    const now = new Date('2026-09-18T12:00:00.000Z');
    expect(reminderTimeForMeeting(meetingStart, now).toISOString()).toBe('2026-09-18T17:45:00.000Z');
    expect(reminderScheduleForMeeting(meetingStart, [24 * 60, 60, 15], new Date('2026-09-16T12:00:00.000Z')).map((value) => value.toISOString())).toEqual([
      '2026-09-17T18:00:00.000Z',
      '2026-09-18T17:00:00.000Z',
      '2026-09-18T17:45:00.000Z',
    ]);
  });
});
