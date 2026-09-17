const MEETING_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';

export type MemberRole = 'owner' | 'admin' | 'member' | 'guest';
export type ParticipantRole = 'host' | 'co-host' | 'moderator' | 'participant';

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

  if (input.meetingStatus && ['cancelled', 'ended'].includes(String(input.meetingStatus).toLowerCase())) {
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
}): boolean {
  if (!input.isAuthenticated) {
    return false;
  }

  if (input.meetingStatus && ['cancelled', 'ended'].includes(String(input.meetingStatus).toLowerCase())) {
    return false;
  }

  return input.organizationMember && input.workspaceMember && input.participantMembership;
}
