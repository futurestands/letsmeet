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

export function participantPageCount(participantCount: number, pageSize = GALLERY_PAGE_SIZE): number {
  return Math.max(1, Math.ceil(Math.max(0, participantCount) / pageSize));
}

export function clampParticipantPage(page: number, participantCount: number, pageSize = GALLERY_PAGE_SIZE): number {
  return Math.min(Math.max(0, page), participantPageCount(participantCount, pageSize) - 1);
}

export function visibleParticipantRange(page: number, participantCount: number, pageSize = GALLERY_PAGE_SIZE): {
  start: number;
  end: number;
} {
  const safePage = clampParticipantPage(page, participantCount, pageSize);
  const start = safePage * pageSize;
  return { start, end: Math.min(participantCount, start + pageSize) };
}

export function pageIndexForIdentity(
  orderedIdentities: readonly string[],
  identity: string,
  pageSize = GALLERY_PAGE_SIZE,
): number | null {
  const index = orderedIdentities.indexOf(identity);
  if (index < 0) return null;
  return Math.floor(index / pageSize);
}

/**
 * Camera identities that should stay subscribed for the current gallery page.
 * Screen-share tracks are managed separately and must remain subscribed.
 */
export function cameraSubscriptionIdentities(input: {
  orderedIdentities: readonly string[];
  page: number;
  pinnedIdentity?: string | null;
  pageSize?: number;
}): Set<string> {
  const pageSize = input.pageSize ?? GALLERY_PAGE_SIZE;
  const range = visibleParticipantRange(input.page, input.orderedIdentities.length, pageSize);
  const visible = new Set(input.orderedIdentities.slice(range.start, range.end));
  if (input.pinnedIdentity) visible.add(input.pinnedIdentity);
  return visible;
}

export function preferredRemoteVideoQuality(input: {
  identity: string;
  pinnedIdentity?: string | null;
  speakerIdentities: ReadonlySet<string>;
  subscribedIdentities: ReadonlySet<string>;
}): 'high' | 'low' | 'off' {
  if (!input.subscribedIdentities.has(input.identity)) return 'off';
  if (input.pinnedIdentity === input.identity) return 'high';
  if (input.speakerIdentities.has(input.identity)) return 'high';
  return 'low';
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

export const LIVEKIT_TOKEN_TTL_SECONDS = 6 * 60 * 60;

/** Max camera tiles rendered (and subscribed) per gallery page. Audio stays independent via RoomAudioRenderer. */
export const GALLERY_PAGE_SIZE = 16;

export type ConferenceDisconnectKind = 'network' | 'removed' | 'room-closed' | 'client';

export type ParticipantTileOrderInput = {
  identity: string;
  isLocal: boolean;
  name?: string | null;
  speaking?: boolean;
  pinned?: boolean;
};

export type AudioTrackDescriptor = {
  participantId: string;
  isMicrophone: boolean;
  isAudible: boolean;
};

export function compareParticipantTiles(
  left: ParticipantTileOrderInput,
  right: ParticipantTileOrderInput,
): number {
  if (left.isLocal !== right.isLocal) return left.isLocal ? -1 : 1;
  const leftPinned = Boolean(left.pinned);
  const rightPinned = Boolean(right.pinned);
  if (leftPinned !== rightPinned) return leftPinned ? -1 : 1;
  const leftSpeaking = Boolean(left.speaking);
  const rightSpeaking = Boolean(right.speaking);
  if (leftSpeaking !== rightSpeaking) return leftSpeaking ? -1 : 1;
  return (left.name || left.identity).localeCompare(right.name || right.identity);
}

export function isActiveSpeaker(identity: string, speakerIdentities: ReadonlySet<string>): boolean {
  return speakerIdentities.has(identity);
}

export function describeAudioTrack(input: {
  identity: string;
  muted: boolean;
  source?: string | null;
}): AudioTrackDescriptor {
  const source = String(input.source ?? 'microphone').toLowerCase();
  return {
    participantId: input.identity,
    isMicrophone: source === 'microphone' || source === 'audio' || source === '',
    isAudible: !input.muted,
  };
}

export function classifyDisconnectReason(reason: unknown): ConferenceDisconnectKind {
  const numeric = typeof reason === 'number' ? reason : Number.NaN;
  const label = String(reason ?? '').toUpperCase();
  if (numeric === 4 || label.includes('PARTICIPANT_REMOVED')) return 'removed';
  if (numeric === 5 || numeric === 10 || label.includes('ROOM_DELETED') || label.includes('ROOM_CLOSED')) {
    return 'room-closed';
  }
  if (numeric === 1 || label.includes('CLIENT_INITIATED')) return 'client';
  return 'network';
}

export function shouldAttemptReconnect(kind: ConferenceDisconnectKind): boolean {
  return kind === 'network';
}

export function shouldEndMeetingOnDisconnect(kind: ConferenceDisconnectKind): boolean {
  void kind;
  return false;
}

export function shouldLeaveMeetingOnDisconnect(kind: ConferenceDisconnectKind): boolean {
  return kind === 'removed' || kind === 'client';
}

export function shouldShowConnectionBanner(state: ConferenceConnectionState): boolean {
  return state === 'connecting'
    || state === 'reconnecting'
    || state === 'reconnected'
    || state === 'disconnected'
    || state === 'failed';
}

export function isVideoTrackSourceScreenShare(source?: string | null): boolean {
  if (!source) return false;
  const str = String(source).toLowerCase();
  return str === 'screen_share' || str === 'screen_share_audio' || str === 'screenshare';
}

export function videoTransformStyle(input: { isLocal: boolean; isScreenShare: boolean }): 'none' | 'scaleX(-1)' {
  if (input.isScreenShare) return 'none';
  return input.isLocal ? 'scaleX(-1)' : 'none';
}

export function videoObjectFitStyle(isScreenShare: boolean): 'contain' | 'cover' {
  return isScreenShare ? 'contain' : 'cover';
}

export function nextLiveKitTokenRefreshDelayMs(
  issuedAtMs: number,
  nowMs: number,
  ttlSeconds = LIVEKIT_TOKEN_TTL_SECONDS,
  leadSeconds = 30 * 60,
): number {
  const refreshAt = issuedAtMs + Math.max(60, ttlSeconds - leadSeconds) * 1000;
  return Math.max(5_000, refreshAt - nowMs);
}

export function liveKitReconnectDelayMs(retryCount: number): number | null {
  if (retryCount > 10) return null;
  return Math.min(500 * (2 ** retryCount), 8_000);
}
