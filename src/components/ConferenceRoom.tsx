import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Camera,
  CameraOff,
  ChevronDown,
  Hand,
  Lock,
  LockOpen,
  LogOut,
  MessageSquare,
  Mic,
  MicOff,
  MonitorUp,
  MoreHorizontal,
  PhoneOff,
  Smile,
  Users,
} from 'lucide-react';
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useConnectionState,
  useDataChannel,
  useLocalParticipant,
  useRoomContext,
} from '@livekit/components-react';
import { ConnectionState, Room, RoomEvent, VideoPresets } from 'livekit-client';
import type { User } from '../lib/supabase';
import type { ChatMessage, JoinedMeeting, MeetingSummary } from '../lib/data-access';
import {
  listChatMessages,
  sendPersistentChat,
  setPersistentMeetingLock,
} from '../lib/data-access';
import {
  connectionStatusMessage,
  decodeConferenceEvent,
  encodeConferenceEvent,
  mediaErrorMessage,
  REACTIONS,
  shouldAllowReaction,
  updateRaisedHands,
  type ConferenceConnectionState,
  type PreJoinSettings,
} from '../lib/conference-utils';
import { supabase } from '../lib/supabase';
import { useMediaDevices } from '../hooks/useMediaDevices';
import MeetingSidePanel, { type MeetingPanel } from './MeetingSidePanel';
import ParticipantGrid from './ParticipantGrid';

type ConferenceRoomProps = {
  meeting: JoinedMeeting;
  user: User;
  token: string;
  serverUrl: string;
  tokenEndpoint: string;
  settings: PreJoinSettings;
  onMeetingChange: (meeting: MeetingSummary) => void;
  onLeave: () => void;
  onEnd: () => void;
};

type ReactionOverlay = {
  id: string;
  emoji: string;
  name: string;
};

function mapConnectionState(state: ConnectionState): ConferenceConnectionState {
  if (state === ConnectionState.Connected) return 'connected';
  if (state === ConnectionState.Reconnecting) return 'reconnecting';
  if (state === ConnectionState.Disconnected) return 'disconnected';
  return 'connecting';
}

function ConferenceExperience({
  meeting,
  user,
  tokenEndpoint,
  settings,
  onMeetingChange,
  onLeave,
  onEnd,
  mediaFailure,
}: Omit<ConferenceRoomProps, 'token' | 'serverUrl'> & { mediaFailure: string | null }) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const {
    localParticipant,
    isMicrophoneEnabled,
    isCameraEnabled,
    isScreenShareEnabled,
  } = useLocalParticipant();
  const devices = useMediaDevices();
  const [panel, setPanel] = useState<MeetingPanel>(null);
  const [raisedHands, setRaisedHands] = useState<Set<string>>(new Set());
  const [handRaised, setHandRaised] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [reactions, setReactions] = useState<ReactionOverlay[]>([]);
  const [showReactions, setShowReactions] = useState(false);
  const [showDevices, setShowDevices] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  const [chatError, setChatError] = useState<string | null>(null);
  const [sendingChat, setSendingChat] = useState(false);
  const [busyControl, setBusyControl] = useState<string | null>(null);
  const [connectionRestored, setConnectionRestored] = useState(false);
  const lastReactionAt = useRef(0);
  const reactionNonce = useRef(0);
  const panelRef = useRef<MeetingPanel>(null);
  const isHost = meeting.host_id === user.id;

  const selectPanel = (next: MeetingPanel) => {
    panelRef.current = next;
    setPanel(next);
    if (next === 'chat') setUnread(0);
  };

  const refreshMessages = useCallback(async () => {
    try {
      const rows = await listChatMessages(meeting.id);
      setMessages(rows);
      if (panelRef.current !== 'chat') setUnread((value) => value + 1);
    } catch {
      setChatError('Messages could not be refreshed.');
    }
  }, [meeting.id]);

  const addReaction = useCallback((identity: string, emoji: string, id: string) => {
    const participant = room.getParticipantByIdentity(identity);
    const reaction = { id, emoji, name: participant?.name || (identity === user.id ? user.full_name : 'Participant') };
    setReactions((items) => [...items.slice(-7), reaction]);
    window.setTimeout(() => {
      setReactions((items) => items.filter((item) => item.id !== id));
    }, 2800);
  }, [room, user.full_name, user.id]);

  const onDataMessage = useCallback((message: { payload: Uint8Array; from?: { identity: string } }) => {
    const event = decodeConferenceEvent(message.payload);
    const identity = message.from?.identity;
    if (!event || !identity) return;

    if (event.type === 'hand') {
      setRaisedHands((current) => updateRaisedHands(current, identity, event.raised));
    } else if (event.type === 'reaction') {
      addReaction(identity, event.emoji, `${identity}-${event.nonce}`);
    } else if (event.type === 'chat') {
      void refreshMessages();
    }
  }, [addReaction, refreshMessages]);

  const { send: sendEvent } = useDataChannel('letsmeet.events', onDataMessage);

  useEffect(() => {
    void listChatMessages(meeting.id).then(setMessages).catch(() => setChatError('Chat history could not be loaded.'));
  }, [meeting.id]);

  useEffect(() => {
    if (connectionState === ConnectionState.Connected && settings.audioOutputDeviceId) {
      void room.switchActiveDevice('audiooutput', settings.audioOutputDeviceId).catch(() => {
        setActionError('The selected speaker could not be activated.');
      });
    }
  }, [connectionState, room, settings.audioOutputDeviceId]);

  useEffect(() => {
    let timer: number | undefined;
    const handleReconnected = () => {
      setConnectionRestored(true);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setConnectionRestored(false), 3000);
    };
    room.on(RoomEvent.Reconnected, handleReconnected);
    return () => {
      room.off(RoomEvent.Reconnected, handleReconnected);
      if (timer) window.clearTimeout(timer);
    };
  }, [room]);

  const toggleMicrophone = async () => {
    try {
      setActionError(null);
      await localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled, {
        deviceId: settings.audioDeviceId || undefined,
      });
    } catch {
      setActionError('The microphone could not be changed. Check browser permissions and the selected device.');
    }
  };

  const toggleCamera = async () => {
    try {
      setActionError(null);
      await localParticipant.setCameraEnabled(!isCameraEnabled, {
        deviceId: settings.videoDeviceId || undefined,
        resolution: VideoPresets.h720.resolution,
      });
    } catch {
      setActionError('The camera could not be changed. Check browser permissions and the selected device.');
    }
  };

  const toggleScreenShare = async () => {
    try {
      setActionError(null);
      await localParticipant.setScreenShareEnabled(!isScreenShareEnabled);
    } catch {
      setActionError('Screen sharing was cancelled or is not supported by this browser.');
    }
  };

  const toggleHand = async () => {
    const raised = !handRaised;
    setHandRaised(raised);
    setRaisedHands((current) => updateRaisedHands(current, user.id, raised));
    await sendEvent(encodeConferenceEvent({ type: 'hand', raised }), { reliable: true });
  };

  const sendReaction = async (emoji: string, eventTimestamp: number) => {
    if (!shouldAllowReaction(lastReactionAt.current, eventTimestamp)) return;
    lastReactionAt.current = eventTimestamp;
    reactionNonce.current += 1;
    const nonce = `${Math.floor(eventTimestamp)}-${reactionNonce.current}`;
    addReaction(user.id, emoji, `${user.id}-${nonce}`);
    await sendEvent(encodeConferenceEvent({ type: 'reaction', emoji, nonce }), { reliable: false });
    setShowReactions(false);
  };

  const sendChat = async (message: string) => {
    try {
      setSendingChat(true);
      setChatError(null);
      const saved = await sendPersistentChat(meeting.id, message);
      setMessages((items) => [...items, saved]);
      await sendEvent(encodeConferenceEvent({ type: 'chat', messageId: saved.id }), { reliable: true });
    } catch {
      setChatError('Your message could not be sent.');
    } finally {
      setSendingChat(false);
    }
  };

  const moderate = async (identity: string, action: 'mute' | 'remove') => {
    if (!isHost || busyControl) return;
    setBusyControl(`${action}:${identity}`);
    setActionError(null);
    try {
      const { data } = await supabase.auth.getSession();
      const accessToken = data.session?.access_token;
      if (!accessToken) throw new Error('Session expired');
      const moderationEndpoint = tokenEndpoint.replace(/\/token(?:\?.*)?$/, '/moderate');
      const response = await fetch(moderationEndpoint, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ room: meeting.code, targetIdentity: identity, action }),
      });
      const payload = await response.json() as { error?: string };
      if (!response.ok) throw new Error(payload.error || 'Moderation failed');
    } catch {
      setActionError(`The participant could not be ${action === 'mute' ? 'muted' : 'removed'}.`);
    } finally {
      setBusyControl(null);
    }
  };

  const toggleLock = async () => {
    if (!isHost || busyControl) return;
    setBusyControl('lock');
    try {
      const next = await setPersistentMeetingLock(meeting.id, !meeting.is_locked);
      onMeetingChange(next);
    } catch {
      setActionError('The meeting lock could not be changed.');
    } finally {
      setBusyControl(null);
    }
  };

  const connection = connectionRestored && connectionState === ConnectionState.Connected
    ? 'reconnected'
    : mapConnectionState(connectionState);
  const connectionMessage = connectionStatusMessage(connection);

  return (
    <div className="relative flex h-dvh min-h-[38rem] flex-col overflow-hidden bg-slate-950 text-white" data-lk-theme="default">
      <RoomAudioRenderer />
      <StartAudio label="Enable meeting audio" className="absolute left-1/2 top-20 z-50 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-xl" />

      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950/95 px-4 py-3 sm:px-6">
        <div className="min-w-0">
          <h1 className="truncate font-semibold">{meeting.title}</h1>
          <p className="text-xs text-slate-400">{meeting.code}</p>
        </div>
        <div className="flex items-center gap-2 text-xs text-slate-300" aria-live="polite">
          <span className={`h-2 w-2 rounded-full ${connection === 'connected' || connection === 'reconnected' ? 'bg-emerald-400' : connection === 'reconnecting' ? 'bg-amber-400' : 'bg-red-400'}`} />
          <span className="hidden sm:inline">{connectionMessage}</span>
          {meeting.is_locked && <Lock className="h-4 w-4 text-amber-300" aria-label="Meeting locked" />}
        </div>
      </header>

      {(actionError || mediaFailure || connection === 'reconnecting' || connection === 'disconnected' || connection === 'reconnected') && (
        <div className="shrink-0 border-b border-slate-800 bg-slate-900 px-4 py-2 text-center text-sm text-amber-200" role="status">
          {actionError || mediaFailure || connectionMessage}
        </div>
      )}

      <div className="flex min-h-0 flex-1 flex-col md:flex-row">
        <ParticipantGrid
          hostId={meeting.host_id}
          raisedHands={raisedHands}
          canModerate={isHost}
          onModerate={(identity, action) => void moderate(identity, action)}
        />
        <MeetingSidePanel
          panel={panel}
          hostId={meeting.host_id}
          currentUserId={user.id}
          messages={messages}
          raisedHands={raisedHands}
          sending={sendingChat}
          error={chatError}
          onClose={() => selectPanel(null)}
          onSend={(message) => void sendChat(message)}
        />
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex items-end justify-center gap-3 px-4">
        {reactions.map((reaction) => (
          <div key={reaction.id} className="animate-bounce rounded-full bg-slate-900/90 px-3 py-2 text-center shadow-xl">
            <span className="text-2xl">{reaction.emoji}</span>
            <span className="ml-2 text-xs text-slate-300">{reaction.name}</span>
          </div>
        ))}
      </div>

      <footer className="relative z-40 flex shrink-0 items-center justify-start gap-2 overflow-x-auto border-t border-slate-800 bg-slate-950 px-2 py-3 sm:justify-center sm:gap-3 sm:px-6">
        <button onClick={() => void toggleMicrophone()} className={`meeting-control ${isMicrophoneEnabled ? '' : 'meeting-control-off'}`} aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'} title={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}>
          {isMicrophoneEnabled ? <Mic /> : <MicOff />}
        </button>
        <button onClick={() => void toggleCamera()} className={`meeting-control ${isCameraEnabled ? '' : 'meeting-control-off'}`} aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'} title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}>
          {isCameraEnabled ? <Camera /> : <CameraOff />}
        </button>
        <button onClick={() => void toggleScreenShare()} className={`meeting-control ${isScreenShareEnabled ? 'meeting-control-active' : ''}`} aria-label={isScreenShareEnabled ? 'Stop screen sharing' : 'Share screen'} title={isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}>
          <MonitorUp />
        </button>
        <button onClick={() => selectPanel(panel === 'participants' ? null : 'participants')} className={`meeting-control hidden sm:flex ${panel === 'participants' ? 'meeting-control-active' : ''}`} aria-label="Toggle participants" title="Participants">
          <Users />
        </button>
        <button onClick={() => selectPanel(panel === 'chat' ? null : 'chat')} className={`meeting-control relative ${panel === 'chat' ? 'meeting-control-active' : ''}`} aria-label="Toggle meeting chat" title="Chat">
          <MessageSquare />
          {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold">{Math.min(unread, 99)}</span>}
        </button>
        <button onClick={() => void toggleHand()} className={`meeting-control ${handRaised ? 'meeting-control-active' : ''}`} aria-label={handRaised ? 'Lower hand' : 'Raise hand'} title={handRaised ? 'Lower hand' : 'Raise hand'}>
          <Hand />
        </button>

        <div className="relative">
          <button onClick={() => setShowReactions((value) => !value)} className="meeting-control" aria-label="Show reactions" title="Reactions">
            <Smile />
          </button>
          {showReactions && (
            <div className="absolute bottom-16 left-1/2 flex -translate-x-1/2 gap-1 rounded-2xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
              {REACTIONS.map((emoji) => (
                <button key={emoji} onClick={(event) => void sendReaction(emoji, event.timeStamp)} className="rounded-xl p-2 text-2xl hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400" aria-label={`Send ${emoji} reaction`}>{emoji}</button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button onClick={() => setShowDevices((value) => !value)} className="meeting-control" aria-label="Device settings" title="Device settings">
            <MoreHorizontal />
          </button>
          {showDevices && (
            <div className="absolute bottom-16 right-0 w-72 space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-4 text-sm shadow-2xl">
              {[
                { label: 'Microphone', kind: 'audioinput' as const, items: devices.microphones },
                { label: 'Camera', kind: 'videoinput' as const, items: devices.cameras },
                ...(devices.outputSelectionSupported ? [{ label: 'Speaker', kind: 'audiooutput' as const, items: devices.speakers }] : []),
              ].map(({ label, kind, items }) => (
                <label key={kind} className="block">
                  <span className="mb-1 block text-xs text-slate-400">{label}</span>
                  <div className="relative">
                    <select onChange={(event) => void room.switchActiveDevice(kind, event.target.value).catch(() => setActionError(`${label} could not be changed.`))} className="w-full appearance-none rounded-xl border border-slate-700 bg-slate-950 px-3 py-2 pr-8 text-white">
                      {items.map((device, index) => <option key={device.deviceId || index} value={device.deviceId}>{device.label || `${label} ${index + 1}`}</option>)}
                    </select>
                    <ChevronDown className="pointer-events-none absolute right-2 top-2.5 h-4 w-4 text-slate-400" />
                  </div>
                </label>
              ))}
              {isHost && (
                <button onClick={() => void toggleLock()} disabled={busyControl === 'lock'} className="flex w-full items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-left hover:bg-slate-800">
                  {meeting.is_locked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />}
                  {meeting.is_locked ? 'Unlock meeting' : 'Lock meeting'}
                </button>
              )}
            </div>
          )}
        </div>

        <button onClick={onLeave} className="meeting-control" aria-label="Leave meeting" title="Leave meeting">
          <LogOut />
        </button>
        {isHost && (
          <button onClick={onEnd} className="meeting-control meeting-control-leave" aria-label="End meeting for everyone" title="End meeting for everyone">
            <PhoneOff />
          </button>
        )}
      </footer>
    </div>
  );
}

export default function ConferenceRoom({
  meeting,
  user,
  token,
  serverUrl,
  tokenEndpoint,
  settings,
  onMeetingChange,
  onLeave,
  onEnd,
}: ConferenceRoomProps) {
  const [mediaFailure, setMediaFailure] = useState<string | null>(null);
  const room = useMemo(() => new Room({
    adaptiveStream: true,
    dynacast: true,
    publishDefaults: {
      simulcast: true,
      videoSimulcastLayers: [VideoPresets.h180, VideoPresets.h360],
    },
  }), []);

  return (
    <LiveKitRoom
      room={room}
      token={token}
      serverUrl={serverUrl}
      connect
      audio={settings.audioEnabled ? { deviceId: settings.audioDeviceId || undefined } : false}
      video={settings.videoEnabled ? { deviceId: settings.videoDeviceId || undefined, resolution: VideoPresets.h720.resolution } : false}
      connectOptions={{ autoSubscribe: true }}
      onMediaDeviceFailure={(_, kind) => {
        setMediaFailure(`${kind === 'videoinput' ? 'Camera' : 'Microphone'} access failed. Check the selected device and browser permissions.`);
      }}
      onError={(error) => setMediaFailure(mediaErrorMessage(error))}
    >
      <ConferenceExperience
        meeting={meeting}
        user={user}
        tokenEndpoint={tokenEndpoint}
        settings={settings}
        onMeetingChange={onMeetingChange}
        onLeave={onLeave}
        onEnd={onEnd}
        mediaFailure={mediaFailure}
      />
    </LiveKitRoom>
  );
}
