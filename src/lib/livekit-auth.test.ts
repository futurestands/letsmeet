import { describe, expect, it } from 'vitest';
import { evaluateLiveKitAccess, evaluateModerationAccess, isAllowedRoomCode } from '../../server/livekit-auth.mjs';

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
});

describe('LiveKit host moderation authorization', () => {
  it('allows the stored host to mute or remove a tenant-matched participant', () => {
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      targetParticipant: memberParticipant,
      action: 'mute',
    })).toMatchObject({ ok: true, status: 200 });
    expect(evaluateModerationAccess({
      isAuthenticated: true,
      actorId: 'user-a',
      meeting,
      targetParticipant: memberParticipant,
      action: 'remove',
    })).toMatchObject({ ok: true, status: 200 });
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
