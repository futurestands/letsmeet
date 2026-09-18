export type MemberRole = 'owner' | 'admin' | 'member' | 'guest';
export type ParticipantRole = 'host' | 'co-host' | 'moderator' | 'participant';
export type MeetingStatus = 'scheduled' | 'waiting' | 'live' | 'ended' | 'cancelled';
export type MeetingHistoryFilter = 'upcoming' | 'active' | 'past' | 'hosted' | 'joined';

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

export function isValidMeetingCode(input?: string | null): boolean {
  return /^LM-[A-Z0-9]{6}$/.test(String(input ?? '').trim().toUpperCase());
}

export function meetingRoomPath(code: string): string {
  return `/meet/${encodeURIComponent(normalizeMeetingCode(code))}`;
}

export function meetingJoinPath(code: string): string {
  return `/join/${encodeURIComponent(normalizeMeetingCode(code))}`;
}

export function meetingDetailsPath(meetingId: string): string {
  return `/meetings/${encodeURIComponent(meetingId)}`;
}

export function isUserMemberOfOrganization(role?: string | null, status?: string | null): boolean {
  const validRole = role ? role.toLowerCase() : '';
  const validStatus = status ? status.toLowerCase() : '';

  return ['owner', 'admin', 'member'].includes(validRole) && validStatus === 'active';
}

export function isUserMemberOfWorkspace(organizationMember: boolean, workspaceMember?: boolean): boolean {
  return organizationMember && (workspaceMember ?? true);
}

export function resolveParticipantRole(input: {
  isHost?: boolean;
  isCoHost?: boolean;
  isModerator?: boolean;
}): ParticipantRole {
  if (input.isHost) return 'host';
  if (input.isCoHost) return 'co-host';
  if (input.isModerator) return 'moderator';
  return 'participant';
}

export function isJoinableMeetingStatus(status?: string | null): boolean {
  return ['scheduled', 'waiting', 'live'].includes(String(status ?? '').toLowerCase());
}

export function isActiveMeetingStatus(status?: string | null): boolean {
  return ['waiting', 'live'].includes(String(status ?? '').toLowerCase());
}

export function isPastMeetingStatus(status?: string | null): boolean {
  return ['ended', 'cancelled'].includes(String(status ?? '').toLowerCase());
}

export function isValidMeetingTransition(from: MeetingStatus, to: MeetingStatus): boolean {
  return (
    (from === 'scheduled' && ['waiting', 'cancelled'].includes(to))
    || (from === 'waiting' && ['live', 'cancelled', 'ended'].includes(to))
    || (from === 'live' && ['ended', 'cancelled'].includes(to))
  );
}

export function canAccessMeeting(input: {
  userId?: string | null;
  meetingHostId?: string | null;
  organizationMember?: boolean;
  workspaceMember?: boolean;
  participantMembership?: boolean;
  meetingStatus?: string | null;
  isAuthenticated?: boolean;
}): boolean {
  if (!input.isAuthenticated || !input.userId) {
    return false;
  }

  if (input.meetingStatus && isPastMeetingStatus(input.meetingStatus)) {
    return false;
  }

  if (input.userId === input.meetingHostId) {
    return Boolean(input.organizationMember ?? true) && Boolean(input.workspaceMember ?? true);
  }

  return Boolean(input.organizationMember) && Boolean(input.workspaceMember) && Boolean(input.participantMembership);
}

export function canIssueLiveKitToken(input: {
  isAuthenticated: boolean;
  organizationMember: boolean;
  workspaceMember: boolean;
  participantMembership: boolean;
  meetingStatus?: string | null;
  participantStatus?: string | null;
}): boolean {
  if (!input.isAuthenticated) {
    return false;
  }

  if (input.meetingStatus && !isJoinableMeetingStatus(input.meetingStatus)) {
    return false;
  }

  if (input.participantStatus && ['left', 'removed'].includes(input.participantStatus)) {
    return false;
  }

  return input.organizationMember && input.workspaceMember && input.participantMembership;
}

export function meetingActionForStatus(status?: string | null): 'join' | 'view' {
  return isJoinableMeetingStatus(status) ? 'join' : 'view';
}

export function destinationForMeeting(input: {
  id: string;
  code?: string | null;
  status?: string | null;
}): string {
  if (isJoinableMeetingStatus(input.status) && isValidMeetingCode(input.code ?? '')) {
    return meetingJoinPath(input.code as string);
  }

  return meetingDetailsPath(input.id);
}
