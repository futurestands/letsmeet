import { describe, expect, it } from 'vitest';
import {
  canUseHostControls,
  clampParticipantPage,
  connectionStatusMessage,
  decodeConferenceEvent,
  encodeConferenceEvent,
  participantPageCount,
  resolveSelectedDeviceId,
  shouldAllowReaction,
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
});
