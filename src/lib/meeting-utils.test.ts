import { describe, expect, it } from 'vitest';
import {
  canAccessMeeting,
  canIssueLiveKitToken,
  generateMeetingCode,
  isUserMemberOfOrganization,
  isUserMemberOfWorkspace,
  normalizeMeetingCode,
  resolveParticipantRole,
} from './meeting-utils';

describe('meeting utilities', () => {
  it('creates a valid human-friendly meeting code', () => {
    const code = generateMeetingCode();

    expect(code).toMatch(/^LM-[A-Z0-9]{6}$/);
  });

  it('normalizes and validates a meeting code input', () => {
    expect(normalizeMeetingCode(' lets-meet-abc123 ')).toBe('LM-ABC123');
    expect(normalizeMeetingCode('abc')).toBe('LM-INVALID');
  });

  it('authorizes active organization membership', () => {
    expect(isUserMemberOfOrganization('member', 'active')).toBe(true);
    expect(isUserMemberOfOrganization('guest', 'active')).toBe(false);
    expect(isUserMemberOfOrganization('member', 'disabled')).toBe(false);
  });

  it('authorizes workspace access only for valid org membership', () => {
    expect(isUserMemberOfWorkspace(true, true)).toBe(true);
    expect(isUserMemberOfWorkspace(false, true)).toBe(false);
    expect(isUserMemberOfWorkspace(true, false)).toBe(false);
  });

  it('resolves participant access for host and guest users', () => {
    expect(
      canAccessMeeting({
        userId: 'user-1',
        meetingHostId: 'user-1',
        organizationMember: true,
        workspaceMember: true,
        isAuthenticated: true,
        meetingStatus: 'live',
      }),
    ).toBe(true);

    expect(
      canAccessMeeting({
        userId: 'user-2',
        meetingHostId: 'user-1',
        organizationMember: true,
        workspaceMember: true,
        participantMembership: false,
        isAuthenticated: true,
        meetingStatus: 'live',
      }),
    ).toBe(false);

    expect(
      canAccessMeeting({
        userId: 'user-2',
        meetingHostId: 'user-1',
        organizationMember: true,
        workspaceMember: true,
        participantMembership: true,
        isAuthenticated: true,
        meetingStatus: 'cancelled',
      }),
    ).toBe(false);
  });

  it('resolves participant roles consistently', () => {
    expect(resolveParticipantRole({ isHost: true })).toBe('host');
    expect(resolveParticipantRole({ isCoHost: true })).toBe('co-host');
    expect(resolveParticipantRole({ isModerator: true })).toBe('moderator');
    expect(resolveParticipantRole({})).toBe('participant');
  });

  it('allows token issuance only for valid tenant access', () => {
    expect(
      canIssueLiveKitToken({
        isAuthenticated: true,
        organizationMember: true,
        workspaceMember: true,
        participantMembership: true,
        meetingStatus: 'live',
      }),
    ).toBe(true);

    expect(
      canIssueLiveKitToken({
        isAuthenticated: true,
        organizationMember: true,
        workspaceMember: false,
        participantMembership: true,
        meetingStatus: 'live',
      }),
    ).toBe(false);
  });
});
