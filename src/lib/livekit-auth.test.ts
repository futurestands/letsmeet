import { describe, expect, it } from 'vitest';
import { evaluateLiveKitAccess, evaluateModerationAccess, evaluateRecordingAccess, isAllowedRoomCode } from '../../server/livekit-auth.mjs';

const meeting = {
  id: 'meeting-a',
  code: 'LM-ABC234',
  host_id: 'user-a',
  status: 'live',
  organization_id: 'org-a',
  workspace_id: 'workspace-a',
};

const hostParticipant = {
  id: 'p-host',
  meeting_id: 'meeting-a',
  user_id: 'user-a',
  organization_id: 'org-a',
  workspace_id: 'workspace-a',
  role: 'host',
  status: 'joined',
};

const memberParticipant = {
  id: 'p-member',
  meeting_id: 'meeting-a',
  user_id: 'user-b',
  organization_id: 'org-a',
  workspace_id: 'workspace-a',
  role: 'participant',
  status: 'joined',
};

describe('LiveKit authorization', () => {
  it('rejects unauthenticated requests', () => {
    expect(evaluateLiveKitAccess({
      isAuthenticated: false,
      userId: null,
      requestedRoom: meeting.code,
      meeting,
      participant: hostParticipant,
      organizationMember: true,
      workspaceMember: true,
    })).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects malformed room codes', () => {
    expect(isAllowedRoomCode('not-a-code')).toBe(false);
    expect(evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-a',
      requestedRoom: 'arbitrary-room',
      meeting,
      participant: hostParticipant,
      organizationMember: true,
      workspaceMember: true,
    })).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects missing meetings', () => {
    expect(evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-a',
      requestedRoom: 'LM-ABC234',
      meeting: null,
      participant: null,
      organizationMember: true,
      workspaceMember: true,
    })).toMatchObject({ ok: false, status: 404 });
  });

  it('rejects another organization', () => {
    expect(evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-c',
      requestedRoom: meeting.code,
      meeting,
      participant: null,
      organizationMember: false,
      workspaceMember: false,
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('requires a participant row for hosts and members', () => {
    expect(evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-a',
      requestedRoom: meeting.code,
      meeting,
      participant: null,
      organizationMember: true,
      workspaceMember: true,
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('issues host and participant access from stored meeting state', () => {
    const host = evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-a',
      userName: 'Host',
      requestedRoom: meeting.code,
      meeting,
      participant: hostParticipant,
      organizationMember: true,
      workspaceMember: true,
      requestedIdentity: 'forged-identity',
      requestedRole: 'host',
    });
    const member = evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-b',
      userName: 'Member',
      requestedRoom: meeting.code,
      meeting,
      participant: memberParticipant,
      organizationMember: true,
      workspaceMember: true,
      requestedIdentity: 'user-a',
      requestedRole: 'host',
      requestedOrganizationId: 'org-b',
    });

    expect(host).toMatchObject({ ok: true, identity: 'user-a', room: 'LM-ABC234', isHost: true });
    expect(member).toMatchObject({ ok: true, identity: 'user-b', isHost: false });
  });

  it('restricts permissions for participants in the waiting room', () => {
    const waiting = evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-waiting',
      requestedRoom: meeting.code,
      meeting,
      participant: { ...memberParticipant, user_id: 'user-waiting', status: 'waiting' },
      organizationMember: true,
      workspaceMember: true,
    });

    expect(waiting).toMatchObject({
      ok: true,
      permissions: {
        canPublish: false,
        canSubscribe: false,
        canPublishData: false,
      },
    });
  });

  it('allows subscription but blocks publishing for muted participants', () => {
    const muted = evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-muted',
      requestedRoom: meeting.code,
      meeting,
      participant: { ...memberParticipant, user_id: 'user-muted', status: 'muted' },
      organizationMember: true,
      workspaceMember: true,
    });

    expect(muted).toMatchObject({
      ok: true,
      permissions: {
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
      },
    });
  });

  it('allows invited guests with a participant row even without org membership', () => {
    expect(evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-guest',
      userName: 'Guest',
      requestedRoom: meeting.code,
      meeting,
      participant: {
        ...memberParticipant,
        id: 'p-guest',
        user_id: 'user-guest',
      },
      organizationMember: false,
      workspaceMember: false,
    })).toMatchObject({ ok: true, identity: 'user-guest', isHost: false });
  });

  it('rejects departed or removed participants', () => {
    expect(evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-b',
      requestedRoom: meeting.code,
      meeting,
      participant: { ...memberParticipant, status: 'left' },
      organizationMember: true,
      workspaceMember: true,
    })).toMatchObject({ ok: false, status: 403 });

    expect(evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-b',
      requestedRoom: meeting.code,
      meeting,
      participant: { ...memberParticipant, status: 'removed' },
      organizationMember: true,
      workspaceMember: true,
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects tenant-mismatched participant rows', () => {
    expect(evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-b',
      requestedRoom: meeting.code,
      meeting,
      participant: { ...memberParticipant, organization_id: 'org-b' },
      organizationMember: true,
      workspaceMember: true,
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects access to ended or cancelled meetings', () => {
    expect(evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-a',
      requestedRoom: meeting.code,
      meeting: { ...meeting, status: 'ended' },
      participant: hostParticipant,
      organizationMember: true,
      workspaceMember: true,
    })).toMatchObject({ ok: false, status: 403 });

    expect(evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-a',
      requestedRoom: meeting.code,
      meeting: { ...meeting, status: 'cancelled' },
      participant: hostParticipant,
      organizationMember: true,
      workspaceMember: true,
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('ensures host-muted participant remains blocked from publishing on token refresh and reconnect', () => {
    const mutedParticipant = { ...memberParticipant, status: 'muted' };

    const initialToken = evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-b',
      requestedRoom: meeting.code,
      meeting,
      participant: mutedParticipant,
      organizationMember: true,
      workspaceMember: true,
    });
    expect(initialToken).toMatchObject({
      ok: true,
      permissions: {
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
      },
    });

    const reconnectedToken = evaluateLiveKitAccess({
      isAuthenticated: true,
      userId: 'user-b',
      requestedRoom: meeting.code,
      meeting,
      participant: mutedParticipant,
      organizationMember: true,
      workspaceMember: true,
    });
    expect(reconnectedToken).toMatchObject({
      ok: true,
      permissions: {
        canPublish: false,
        canSubscribe: true,
        canPublishData: false,
      },
    });
  });
});

describe('LiveKit host moderation authorization', () => {
  it('allows the stored host to mute or remove a tenant-matched participant', () => {
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      actorParticipant: hostParticipant,
      targetParticipant: memberParticipant,
      action: 'mute',
    })).toMatchObject({ ok: true, status: 200 });
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      actorParticipant: hostParticipant,
      targetParticipant: memberParticipant,
      action: 'remove',
    })).toMatchObject({ ok: true, status: 200 });
  });

  it('allows the host to unmute a muted participant', () => {
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      actorParticipant: hostParticipant,
      targetParticipant: { ...memberParticipant, status: 'muted' },
      action: 'unmute',
    })).toMatchObject({ ok: true, status: 200 });
  });

  it('allows the host to admit a waiting participant', () => {
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      actorParticipant: hostParticipant,
      targetParticipant: { ...memberParticipant, status: 'waiting' },
      action: 'admit',
    })).toMatchObject({ ok: true, status: 200 });
  });

  it('allows a co-host to moderate a participant', () => {
    const coHost = { ...memberParticipant, user_id: 'user-c', role: 'co-host' };
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-c',
      meeting,
      actorParticipant: coHost,
      targetParticipant: memberParticipant,
      action: 'mute',
    })).toMatchObject({ ok: true, status: 200 });
  });

  it('rejects a co-host moderating the host', () => {
    const coHost = { ...memberParticipant, user_id: 'user-c', role: 'co-host' };
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-c',
      meeting,
      actorParticipant: coHost,
      targetParticipant: hostParticipant,
      action: 'mute',
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects unmute if participant is not muted', () => {
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      actorParticipant: hostParticipant,
      targetParticipant: { ...memberParticipant, status: 'joined' },
      action: 'unmute',
    })).toMatchObject({ ok: false, status: 409 });
  });

  it('rejects non-host moderation and host targeting', () => {
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-b',
      meeting,
      targetParticipant: hostParticipant,
      action: 'remove',
    })).toMatchObject({ ok: false, status: 403 });
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      targetParticipant: hostParticipant,
      action: 'mute',
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('rejects cross-tenant targets and unsupported actions', () => {
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      targetParticipant: { ...memberParticipant, organization_id: 'org-b' },
      action: 'remove',
    })).toMatchObject({ ok: false, status: 403 });
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      targetParticipant: memberParticipant,
      action: 'promote',
    })).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects moderation of departed participants', () => {
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      targetParticipant: { ...memberParticipant, status: 'removed' },
      action: 'remove',
    })).toMatchObject({ ok: false, status: 409 });
  });
});

describe('LiveKit recording authorization', () => {
  const recording = {
    id: 'rec-1',
    meeting_id: 'meeting-a',
    organization_id: 'org-a',
    workspace_id: 'workspace-a',
    started_by: 'user-a',
    status: 'queued',
  };

  it('rejects unauthenticated recording management', () => {
    expect(evaluateRecordingAccess({
      isAuthenticated: false,
      userId: null,
      meeting,
      recording,
      actorRole: 'host',
      isOrgAdmin: false,
      action: 'start',
    })).toMatchObject({ ok: false, status: 401 });
  });

  it('rejects recording management by ordinary participants', () => {
    expect(evaluateRecordingAccess({
      isAuthenticated: true,
      userId: 'user-b',
      meeting,
      recording,
      actorRole: 'participant',
      isOrgAdmin: false,
      action: 'start',
    })).toMatchObject({ ok: false, status: 403 });
  });

  it('allows meeting host or org admin to start recording for a live meeting', () => {
    expect(evaluateRecordingAccess({
      isAuthenticated: true,
      userId: 'user-a',
      meeting,
      recording,
      actorRole: 'host',
      isOrgAdmin: false,
      action: 'start',
    })).toMatchObject({ ok: true, status: 200 });
  });

  it('rejects starting recording when meeting is not live', () => {
    expect(evaluateRecordingAccess({
      isAuthenticated: true,
      userId: 'user-a',
      meeting: { ...meeting, status: 'waiting' },
      recording,
      actorRole: 'host',
      isOrgAdmin: false,
      action: 'start',
    })).toMatchObject({ ok: false, status: 400 });
  });

  it('rejects starting recording if recording is already active', () => {
    expect(evaluateRecordingAccess({
      isAuthenticated: true,
      userId: 'user-a',
      meeting,
      recording: { ...recording, status: 'active' },
      actorRole: 'host',
      isOrgAdmin: false,
      action: 'start',
    })).toMatchObject({ ok: false, status: 409 });
  });

  it('rejects recording associated with a different meeting', () => {
    expect(evaluateRecordingAccess({
      isAuthenticated: true,
      userId: 'user-a',
      meeting,
      recording: { ...recording, meeting_id: 'meeting-other' },
      actorRole: 'host',
      isOrgAdmin: false,
      action: 'start',
    })).toMatchObject({ ok: false, status: 403 });
  });
});
