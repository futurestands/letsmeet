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

  void organizationMember;
  void workspaceMember;

  if (!participant || participant.user_id !== userId) {
    return { ok: false, status: 403, error: 'You do not have access to this meeting.' };
  }

  if (participant.organization_id !== meeting.organization_id || participant.workspace_id !== meeting.workspace_id) {
    return { ok: false, status: 403, error: 'You do not have access to this meeting.' };
  }

  const participantStatus = String(participant.status ?? '').toLowerCase();
  const participantRole = String(participant.role ?? 'participant').toLowerCase();

  if (['left', 'removed'].includes(participantStatus)) {
    return { ok: false, status: 403, error: 'You have been removed or have left this meeting.' };
  }

  if (!['joined', 'waiting', 'muted'].includes(participantStatus)) {
    return { ok: false, status: 403, error: 'You do not have active access to this meeting.' };
  }

  void requestedIdentity;
  void requestedName;
  void requestedRole;
  void requestedOrganizationId;
  void requestedWorkspaceId;

  const isHost = meeting.host_id === userId || ['host', 'co-host'].includes(participantRole);

  // Authoritative permissions based on status and role
  // Admitted participants (joined/muted) can subscribe.
  // Only joined participants (not waiting/muted) can publish.
  const permissions = {
    canPublish: participantStatus === 'joined',
    canSubscribe: participantStatus === 'joined' || participantStatus === 'muted',
    canPublishData: participantStatus === 'joined',
  };

  return {
    ok: true,
    status: 200,
    identity: String(userId),
    name: String(userName || 'Meeting Participant'),
    room: meeting.code,
    isHost,
    permissions,
  };
}

export function evaluateModerationAccess({
  isAuthenticated,
  actorId,
  meeting,
  actorParticipant,
  targetParticipant,
  action,
}) {
  if (!isAuthenticated || !actorId) {
    return { ok: false, status: 401, error: 'Authentication is required.' };
  }
  if (!meeting) {
    return { ok: false, status: 404, error: 'Meeting not found.' };
  }

  const actorRole = String(actorParticipant?.role ?? 'participant').toLowerCase();
  const isAuthorizedActor = meeting.host_id === actorId || ['host', 'co-host', 'moderator'].includes(actorRole);

  if (!isAuthorizedActor) {
    return { ok: false, status: 403, error: 'Only authorized moderators can perform this action.' };
  }

  if (!['waiting', 'live'].includes(String(meeting.status))) {
    return { ok: false, status: 409, error: 'This meeting is not active.' };
  }
  if (!targetParticipant) {
    return { ok: false, status: 404, error: 'Participant not found.' };
  }

  const targetRole = String(targetParticipant.role ?? 'participant').toLowerCase();

  // Rules:
  // 1. Host cannot be moderated.
  // 2. Co-host/Moderator cannot moderate someone of equal or higher rank (Host > Co-Host > Moderator > Participant).
  if (targetParticipant.user_id === meeting.host_id || targetRole === 'host') {
    return { ok: false, status: 403, error: 'The primary host cannot be moderated.' };
  }

  if (actorId !== meeting.host_id) {
     if (actorRole === 'moderator' && ['moderator', 'co-host'].includes(targetRole)) {
        return { ok: false, status: 403, error: 'Moderators cannot moderate other moderators or co-hosts.' };
     }
     if (actorRole === 'co-host' && targetRole === 'co-host') {
        // Option: allow co-hosts to moderate each other? Usually not.
        return { ok: false, status: 403, error: 'Co-hosts cannot moderate other co-hosts.' };
     }
  }

  if (
    targetParticipant.organization_id !== meeting.organization_id
    || targetParticipant.workspace_id !== meeting.workspace_id
  ) {
    return { ok: false, status: 403, error: 'Participant belongs to a different tenant.' };
  }

  if (action === 'unmute') {
    if (String(targetParticipant.status) !== 'muted') {
      return { ok: false, status: 409, error: 'Participant is not currently muted.' };
    }
    return { ok: true, status: 200 };
  }

  if (!['joined', 'waiting', 'muted'].includes(String(targetParticipant.status))) {
    return { ok: false, status: 409, error: 'Participant is no longer active.' };
  }
  if (!['mute', 'remove', 'admit'].includes(String(action))) {
    return { ok: false, status: 400, error: 'Unsupported moderation action.' };
  }
  return { ok: true, status: 200 };
}

export function evaluateRecordingAccess({
  isAuthenticated,
  userId,
  meeting,
  recording,
  actorRole,
  isOrgAdmin,
  action,
}) {
  if (!isAuthenticated || !userId) {
    return { ok: false, status: 401, error: 'Authentication is required.' };
  }
  if (!meeting) {
    return { ok: false, status: 404, error: 'Meeting not found.' };
  }
  if (!recording) {
    return { ok: false, status: 404, error: 'Recording not found.' };
  }

  if (recording.meeting_id !== meeting.id) {
    return { ok: false, status: 403, error: 'Recording does not belong to this meeting.' };
  }

  const role = String(actorRole ?? 'participant').toLowerCase();
  const canManage = meeting.host_id === userId || ['host', 'co-host'].includes(role) || Boolean(isOrgAdmin);

  if (!canManage) {
    return { ok: false, status: 403, error: 'Unauthorized to manage recordings for this meeting.' };
  }

  if (action === 'start') {
    if (meeting.status !== 'live') {
      return { ok: false, status: 400, error: 'Meeting must be live to start recording.' };
    }
    if (!['queued', 'failed'].includes(recording.status)) {
      return { ok: false, status: 409, error: `Recording is already in ${recording.status} state.` };
    }
  }

  if (action === 'stop') {
    if (recording.status === 'completed') {
      return { ok: true, status: 200, alreadyCompleted: true };
    }
    if (!['starting', 'active'].includes(recording.status)) {
      if (recording.status === 'queued') {
        return { ok: true, status: 200, canCancel: true };
      }
      return { ok: false, status: 409, error: `Recording is in ${recording.status} state and cannot be stopped.` };
    }
  }

  return { ok: true, status: 200 };
}
