export function normalizeRoomCode(value) {
  return String(value ?? '').trim().toUpperCase();
}

export function isAllowedRoomCode(value) {
  return /^LM-[A-Z0-9]{6}$/.test(normalizeRoomCode(value));
}

export function evaluateLiveKitAccess({
  isAuthenticated,
  userId,
  userName,
  requestedRoom,
  meeting,
  participant,
  organizationMember,
  workspaceMember,
  requestedIdentity,
  requestedName,
  requestedRole,
  requestedOrganizationId,
  requestedWorkspaceId,
}) {
  if (!isAuthenticated || !userId) {
    return { ok: false, status: 401, error: 'Authentication is required to join a meeting.' };
  }

  const room = normalizeRoomCode(requestedRoom);
  if (!isAllowedRoomCode(room)) {
    return { ok: false, status: 400, error: 'Meeting code is invalid or not recognized.' };
  }

  if (!meeting) {
    return { ok: false, status: 404, error: 'Meeting not found.' };
  }

  if (normalizeRoomCode(meeting.code) !== room) {
    return { ok: false, status: 404, error: 'Meeting not found.' };
  }

  const meetingStatus = String(meeting.status ?? '').toLowerCase();
  if (['cancelled', 'ended'].includes(meetingStatus)) {
    return { ok: false, status: 403, error: 'This meeting is no longer active.' };
  }

  if (!['scheduled', 'waiting', 'live'].includes(meetingStatus)) {
    return { ok: false, status: 403, error: 'This meeting is not available.' };
  }

  if (!organizationMember || !workspaceMember) {
    return { ok: false, status: 403, error: 'You do not have access to this meeting.' };
  }

  if (!participant || participant.user_id !== userId) {
    return { ok: false, status: 403, error: 'You do not have access to this meeting.' };
  }

  if (participant.organization_id !== meeting.organization_id || participant.workspace_id !== meeting.workspace_id) {
    return { ok: false, status: 403, error: 'You do not have access to this meeting.' };
  }

  const participantStatus = String(participant.status ?? '').toLowerCase();
  if (['left', 'removed'].includes(participantStatus) || !['joined', 'waiting', 'muted'].includes(participantStatus)) {
    return { ok: false, status: 403, error: 'You do not have access to this meeting.' };
  }

  void requestedIdentity;
  void requestedName;
  void requestedRole;
  void requestedOrganizationId;
  void requestedWorkspaceId;

  return {
    ok: true,
    status: 200,
    identity: String(userId),
    name: String(userName || 'Meeting Participant'),
    room: meeting.code,
    isHost: meeting.host_id === userId,
  };
}
