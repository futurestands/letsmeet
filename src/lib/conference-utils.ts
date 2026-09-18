export type ConferenceConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'reconnected'
  | 'disconnected'
  | 'failed';

export type PreJoinSettings = {
  audioEnabled: boolean;
  videoEnabled: boolean;
  audioDeviceId: string;
  videoDeviceId: string;
  audioOutputDeviceId: string;
};

export type ConferenceEvent =
  | { type: 'hand'; raised: boolean }
  | { type: 'reaction'; emoji: string; nonce: string }
  | { type: 'chat'; messageId: string };

export const REACTIONS = ['👍', '👏', '❤️', '😂', '🎉', '😮'] as const;

export function encodeConferenceEvent(event: ConferenceEvent): Uint8Array {
  return new TextEncoder().encode(JSON.stringify(event));
}

export function decodeConferenceEvent(payload: Uint8Array): ConferenceEvent | null {
  try {
    const value = JSON.parse(new TextDecoder().decode(payload)) as Partial<ConferenceEvent>;
    if (value.type === 'hand' && typeof value.raised === 'boolean') {
      return { type: 'hand', raised: value.raised };
    }
    if (
      value.type === 'reaction'
      && typeof value.emoji === 'string'
      && REACTIONS.includes(value.emoji as (typeof REACTIONS)[number])
      && typeof value.nonce === 'string'
    ) {
      return { type: 'reaction', emoji: value.emoji, nonce: value.nonce };
    }
    if (value.type === 'chat' && typeof value.messageId === 'string') {
      return { type: 'chat', messageId: value.messageId };
    }
  } catch {
    return null;
  }
  return null;
}

export function connectionStatusMessage(state: ConferenceConnectionState): string {
  switch (state) {
    case 'connecting':
      return 'Connecting…';
    case 'connected':
      return 'Connected';
    case 'reconnecting':
      return 'Reconnecting…';
    case 'reconnected':
      return 'Connection restored';
    case 'disconnected':
      return 'Connection lost';
    case 'failed':
      return 'Unable to connect';
  }
}

export function participantPageCount(participantCount: number, pageSize = 16): number {
  return Math.max(1, Math.ceil(Math.max(0, participantCount) / pageSize));
}

export function clampParticipantPage(page: number, participantCount: number, pageSize = 16): number {
  return Math.min(Math.max(0, page), participantPageCount(participantCount, pageSize) - 1);
}

export function visibleParticipantRange(page: number, participantCount: number, pageSize = 16): {
  start: number;
  end: number;
} {
  const safePage = clampParticipantPage(page, participantCount, pageSize);
  const start = safePage * pageSize;
  return { start, end: Math.min(participantCount, start + pageSize) };
}

export function canUseHostControls(hostId: string, authenticatedUserId?: string | null): boolean {
  return Boolean(authenticatedUserId && hostId === authenticatedUserId);
}

export function mediaErrorMessage(error: unknown): string {
  const name = error instanceof DOMException ? error.name : '';
  if (name === 'NotAllowedError' || name === 'SecurityError') {
    return 'Camera or microphone permission was denied. Allow access in your browser settings and try again.';
  }
  if (name === 'NotFoundError' || name === 'DevicesNotFoundError') {
    return 'No camera or microphone was found.';
  }
  if (name === 'NotReadableError' || name === 'TrackStartError') {
    return 'A camera or microphone is already in use by another application.';
  }
  if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
    return 'This browser does not support camera and microphone access.';
  }
  return 'The selected media device could not be started.';
}

export function shouldAllowReaction(lastSentAt: number, now: number, minimumIntervalMs = 800): boolean {
  return now - lastSentAt >= minimumIntervalMs;
}

export function resolveSelectedDeviceId(
  selectedDeviceId: string,
  devices: Pick<MediaDeviceInfo, 'deviceId'>[],
): string {
  if (devices.some((device) => device.deviceId === selectedDeviceId)) return selectedDeviceId;
  return devices[0]?.deviceId ?? '';
}

export function updateRaisedHands(
  current: ReadonlySet<string>,
  identity: string,
  raised: boolean,
): Set<string> {
  const next = new Set(current);
  if (raised) next.add(identity);
  else next.delete(identity);
  return next;
}
