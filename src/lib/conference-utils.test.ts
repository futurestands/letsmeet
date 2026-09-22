import { describe, expect, it } from 'vitest';
import {
  canUseHostControls,
  cameraSubscriptionIdentities,
  clampParticipantPage,
  classifyDisconnectReason,
  compareParticipantTiles,
  connectionStatusMessage,
  decodeConferenceEvent,
  describeAudioTrack,
  encodeConferenceEvent,
  isActiveSpeaker,
  liveKitReconnectDelayMs,
  nextLiveKitTokenRefreshDelayMs,
  pageIndexForIdentity,
  participantPageCount,
  preferredRemoteVideoQuality,
  resolveSelectedDeviceId,
  shouldAllowReaction,
  shouldAttemptReconnect,
  shouldEndMeetingOnDisconnect,
  shouldLeaveMeetingOnDisconnect,
  shouldShowConnectionBanner,
  updateRaisedHands,
  visibleParticipantRange,
  isVideoTrackSourceScreenShare,
  videoTransformStyle,
  videoObjectFitStyle,
} from './conference-utils';

describe('conference utilities', () => {
  it('maps professional connection messages', () => {
    expect(connectionStatusMessage('connecting')).toBe('Connecting…');
    expect(connectionStatusMessage('reconnecting')).toBe('Reconnecting…');
    expect(connectionStatusMessage('reconnected')).toBe('Connection restored');
    expect(connectionStatusMessage('disconnected')).toBe('Connection lost');
  });

  it('encodes and validates realtime meeting events', () => {
    expect(decodeConferenceEvent(encodeConferenceEvent({ type: 'hand', raised: true })))
      .toEqual({ type: 'hand', raised: true });
    expect(decodeConferenceEvent(encodeConferenceEvent({ type: 'reaction', emoji: '👏', nonce: '1' })))
      .toEqual({ type: 'reaction', emoji: '👏', nonce: '1' });
    expect(decodeConferenceEvent(new TextEncoder().encode('{"type":"reaction","emoji":"bad","nonce":"1"}')))
      .toBeNull();
    expect(decodeConferenceEvent(new Uint8Array([1, 2, 3]))).toBeNull();
  });

  it('updates raised-hand state without mutating the prior set', () => {
    const original = new Set(['user-a']);
    const raised = updateRaisedHands(original, 'user-b', true);
    const lowered = updateRaisedHands(raised, 'user-a', false);
    expect(original).toEqual(new Set(['user-a']));
    expect(raised).toEqual(new Set(['user-a', 'user-b']));
    expect(lowered).toEqual(new Set(['user-b']));
  });

  it('paginates participant video instead of rendering an unbounded grid', () => {
    expect(participantPageCount(0)).toBe(1);
    expect(participantPageCount(17)).toBe(2);
    expect(clampParticipantPage(5, 17)).toBe(1);
    expect(visibleParticipantRange(1, 35)).toEqual({ start: 16, end: 32 });
    expect(visibleParticipantRange(9, 18)).toEqual({ start: 16, end: 18 });
  });

  it('keeps camera subscriptions limited to the visible page plus pins', () => {
    const identities = Array.from({ length: 40 }, (_, index) => `user-${index}`);
    expect([...cameraSubscriptionIdentities({ orderedIdentities: identities, page: 1 })].sort())
      .toEqual(identities.slice(16, 32));
    expect(cameraSubscriptionIdentities({
      orderedIdentities: identities,
      page: 0,
      pinnedIdentity: 'user-30',
    }).has('user-30')).toBe(true);
    expect(pageIndexForIdentity(identities, 'user-17')).toBe(1);
    expect(preferredRemoteVideoQuality({
      identity: 'user-1',
      pinnedIdentity: 'user-1',
      speakerIdentities: new Set(),
      subscribedIdentities: new Set(['user-1']),
    })).toBe('high');
    expect(preferredRemoteVideoQuality({
      identity: 'user-2',
      speakerIdentities: new Set(),
      subscribedIdentities: new Set(['user-2']),
    })).toBe('low');
    expect(preferredRemoteVideoQuality({
      identity: 'user-3',
      speakerIdentities: new Set(),
      subscribedIdentities: new Set(['user-1']),
    })).toBe('off');
  });

  it('recovers device selection when a selected device disappears', () => {
    const devices = [{ deviceId: 'camera-a' }, { deviceId: 'camera-b' }];
    expect(resolveSelectedDeviceId('camera-b', devices)).toBe('camera-b');
    expect(resolveSelectedDeviceId('missing', devices)).toBe('camera-a');
    expect(resolveSelectedDeviceId('missing', [])).toBe('');
  });

  it('rate-limits reactions', () => {
    expect(shouldAllowReaction(1000, 1500)).toBe(false);
    expect(shouldAllowReaction(1000, 1800)).toBe(true);
  });

  it('derives host controls from trusted host identity', () => {
    expect(canUseHostControls('user-a', 'user-a')).toBe(true);
    expect(canUseHostControls('user-a', 'user-b')).toBe(false);
    expect(canUseHostControls('user-a', null)).toBe(false);
  });

  it('keeps local first, then pinned, then active speakers', () => {
    const tiles = [
      { identity: 'user-b', isLocal: false, name: 'Bravo', speaking: false, pinned: false },
      { identity: 'user-a', isLocal: true, name: 'Alpha', speaking: false, pinned: false },
      { identity: 'user-c', isLocal: false, name: 'Charlie', speaking: false, pinned: false },
      { identity: 'user-d', isLocal: false, name: 'Delta', speaking: false, pinned: true },
    ];
    expect([...tiles].sort(compareParticipantTiles).map((tile) => tile.identity))
      .toEqual(['user-a', 'user-d', 'user-b', 'user-c']);

    const withSpeaker = tiles.map((tile) => (
      tile.identity === 'user-c' ? { ...tile, speaking: true, pinned: false } : { ...tile, pinned: false }
    ));
    expect([...withSpeaker].sort(compareParticipantTiles).map((tile) => tile.identity))
      .toEqual(['user-a', 'user-c', 'user-b', 'user-d']);

    expect(isActiveSpeaker('user-c', new Set(['user-c']))).toBe(true);
    expect(isActiveSpeaker('user-b', new Set(['user-c']))).toBe(false);
    expect(visibleParticipantRange(1, 20)).toEqual({ start: 16, end: 20 });
  });

  it('associates mute state with the owning participant identity', () => {
    expect(describeAudioTrack({ identity: 'user-b', muted: false, source: 'microphone' })).toEqual({
      participantId: 'user-b',
      isMicrophone: true,
      isAudible: true,
    });
    expect(describeAudioTrack({ identity: 'user-b', muted: true, source: 'microphone' }).isAudible).toBe(false);
  });

  it('reconnects after a transient failure without ending the meeting', () => {
    expect(classifyDisconnectReason(4)).toBe('removed');
    expect(classifyDisconnectReason('PARTICIPANT_REMOVED')).toBe('removed');
    expect(classifyDisconnectReason(1)).toBe('client');
    expect(classifyDisconnectReason(9)).toBe('network');
    expect(shouldAttemptReconnect('network')).toBe(true);
    expect(shouldAttemptReconnect('removed')).toBe(false);
    expect(shouldLeaveMeetingOnDisconnect('removed')).toBe(true);
    expect(shouldLeaveMeetingOnDisconnect('network')).toBe(false);
    expect(shouldEndMeetingOnDisconnect('network')).toBe(false);
    expect(shouldEndMeetingOnDisconnect('removed')).toBe(false);
    expect(shouldShowConnectionBanner('reconnecting')).toBe(true);
    expect(shouldShowConnectionBanner('connected')).toBe(false);
    expect(liveKitReconnectDelayMs(0)).toBe(500);
    expect(liveKitReconnectDelayMs(11)).toBeNull();
    expect(nextLiveKitTokenRefreshDelayMs(0, 0, 3600, 600)).toBe(3_000_000);
  });

  it('enforces unmirrored contain transforms for screen shares and mirrored transforms for local camera', () => {
    expect(isVideoTrackSourceScreenShare('screen_share')).toBe(true);
    expect(isVideoTrackSourceScreenShare('camera')).toBe(false);
    expect(videoTransformStyle({ isLocal: true, isScreenShare: true })).toBe('none');
    expect(videoTransformStyle({ isLocal: true, isScreenShare: false })).toBe('scaleX(-1)');
    expect(videoTransformStyle({ isLocal: false, isScreenShare: false })).toBe('none');
    expect(videoObjectFitStyle(true)).toBe('contain');
    expect(videoObjectFitStyle(false)).toBe('cover');
  });
});

