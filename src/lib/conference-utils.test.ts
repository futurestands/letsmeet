import { describe, expect, it } from 'vitest';
import {
  canUseHostControls,
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
  participantPageCount,
  resolveSelectedDeviceId,
  shouldAllowReaction,
  shouldAttemptReconnect,
  shouldEndMeetingOnDisconnect,
  shouldLeaveMeetingOnDisconnect,
  shouldShowConnectionBanner,
  updateRaisedHands,
  visibleParticipantRange,
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

  it('keeps participant tile order stable when the active speaker changes', () => {
    const tiles = [
      { identity: 'user-b', isLocal: false, name: 'Bravo' },
      { identity: 'user-a', isLocal: true, name: 'Alpha' },
      { identity: 'user-c', isLocal: false, name: 'Charlie' },
    ];
    const first = [...tiles].sort(compareParticipantTiles).map((tile) => tile.identity);
    const afterSpeakerChange = [...tiles].reverse().sort(compareParticipantTiles).map((tile) => tile.identity);
    expect(first).toEqual(['user-a', 'user-b', 'user-c']);
    expect(afterSpeakerChange).toEqual(first);
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
});

