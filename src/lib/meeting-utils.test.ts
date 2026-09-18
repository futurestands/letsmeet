import { describe, expect, it } from 'vitest';
import {
  canAccessMeeting,
  canIssueLiveKitToken,
  destinationForMeeting,
  isJoinableMeetingStatus,
  isPastMeetingStatus,
  isUserMemberOfOrganization,
  isUserMemberOfWorkspace,
  isValidMeetingCode,
  isValidMeetingTransition,
  meetingActionForStatus,
  meetingDetailsPath,
  meetingJoinPath,
  meetingRoomPath,
  normalizeMeetingCode,
  resolveParticipantRole,
} from './meeting-utils';

describe('meeting utilities', () => {
  it('normalizes and validates a meeting code input', () => {
    expect(normalizeMeetingCode(' lets-meet-abc123 ')).toBe('LM-ABC123');
    expect(normalizeMeetingCode('abc')).toBe('LM-INVALID');
    expect(isValidMeetingCode('LM-ABC234')).toBe(true);
    expect(isValidMeetingCode('LM-INVALID')).toBe(false);
  });

  it('builds refresh-safe meeting routes', () => {
    expect(meetingRoomPath('abc234')).toBe('/meet/LM-ABC234');
    expect(meetingJoinPath('LM-ABC234')).toBe('/join/LM-ABC234');
    expect(meetingDetailsPath('meeting-1')).toBe('/meetings/meeting-1');
    expect(destinationForMeeting({ id: 'meeting-1', code: 'LM-ABC234', status: 'live' })).toBe('/join/LM-ABC234');
    expect(destinationForMeeting({ id: 'meeting-1', code: 'LM-ABC234', status: 'ended' })).toBe('/meetings/meeting-1');
    expect(meetingActionForStatus('waiting')).toBe('join');
    expect(meetingActionForStatus('cancelled')).toBe('view');
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
        participantStatus: 'joined',
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

    expect(
      canIssueLiveKitToken({
        isAuthenticated: true,
        organizationMember: true,
        workspaceMember: true,
        participantMembership: true,
        meetingStatus: 'live',
        participantStatus: 'left',
      }),
    ).toBe(false);
  });

  it('prevents self-escalation into privileged roles and tenants', () => {
    expect(isUserMemberOfOrganization('owner', 'active')).toBe(true);
    expect(isUserMemberOfOrganization('admin', 'active')).toBe(true);
    expect(isUserMemberOfOrganization('member', 'active')).toBe(true);
    expect(isUserMemberOfOrganization('guest', 'active')).toBe(false);

    expect(
      canAccessMeeting({
        userId: 'user-b',
        meetingHostId: 'user-a',
        organizationMember: true,
        workspaceMember: true,
        participantMembership: true,
        isAuthenticated: true,
        meetingStatus: 'live',
      }),
    ).toBe(true);

    expect(
      canAccessMeeting({
        userId: 'user-b',
        meetingHostId: 'user-a',
        organizationMember: false,
        workspaceMember: false,
        participantMembership: false,
        isAuthenticated: true,
        meetingStatus: 'live',
      }),
    ).toBe(false);
  });

  it('models the authoritative meeting lifecycle', () => {
    expect(isJoinableMeetingStatus('scheduled')).toBe(true);
    expect(isJoinableMeetingStatus('ended')).toBe(false);
    expect(isPastMeetingStatus('cancelled')).toBe(true);
    expect(isValidMeetingTransition('scheduled', 'waiting')).toBe(true);
    expect(isValidMeetingTransition('waiting', 'live')).toBe(true);
    expect(isValidMeetingTransition('live', 'ended')).toBe(true);
    expect(isValidMeetingTransition('ended', 'live')).toBe(false);
    expect(isValidMeetingTransition('cancelled', 'live')).toBe(false);
    expect(isValidMeetingTransition('scheduled', 'live')).toBe(false);
  });
});
