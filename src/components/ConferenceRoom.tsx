import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ClipboardList,
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
  FiberManualRecord,
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
import { ConnectionState, Room, RoomEvent, Track, VideoPresets } from 'livekit-client';
import type { User } from '../lib/supabase';
import type { ChatMessage, JoinedMeeting, MeetingSummary } from '../lib/data-access';
import {
  clearRaisedHands,
  deletePersistentChat,
  listChatMessages,
  listRaisedHands,
  markChatRead,
  sendMeetingReaction,
  sendPersistentChat,
  setHandRaised as persistHandRaised,
  setPersistentMeetingLock,
} from '../lib/data-access';
import {
  connectionStatusMessage,
  classifyDisconnectReason,
  decodeConferenceEvent,
  encodeConferenceEvent,
  liveKitReconnectDelayMs,
  mediaErrorMessage,
  REACTIONS,
  shouldAllowReaction,
  shouldAttemptReconnect,
  shouldLeaveMeetingOnDisconnect,
  shouldShowConnectionBanner,
  updateRaisedHands,
  type ConferenceConnectionState,
  type ConferenceDisconnectKind,
  type PreJoinSettings,
} from '../lib/conference-utils';
import { supabase } from '../lib/supabase';
import { useMediaDevices } from '../hooks/useMediaDevices';
import MeetingSidePanel, { type MeetingPanel } from './MeetingSidePanel';
import MeetingToolsPanel from './MeetingToolsPanel';
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
  onForcedDisconnect?: (kind: ConferenceDisconnectKind) => void;
  onRequestReconnect?: () => void;
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
  onForcedDisconnect,
  onRequestReconnect,
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
  const [toolsOpen, setToolsOpen] = useState(false);
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
  const [hostMuteNotice, setHostMuteNotice] = useState<string | null>(null);
  const [recordings, setRecordings] = useState<MeetingRecording[]>([]);
  const [participantCount, setParticipantCount] = useState(1);
  const lastReactionAt = useRef(0);
  const reactionNonce = useRef(0);
  const panelRef = useRef<MeetingPanel>(null);
  const isHost = meeting.host_id === user.id;

  useEffect(() => {
    const updateCount = () => {
      setParticipantCount(room.numParticipants + 1);
    };
    room.on(RoomEvent.ParticipantConnected, updateCount);
    room.on(RoomEvent.ParticipantDisconnected, updateCount);
    updateCount();
    return () => {
      room.off(RoomEvent.ParticipantConnected, updateCount);
      room.off(RoomEvent.ParticipantDisconnected, updateCount);
    };
  }, [room]);

  useEffect(() => {
    void listMeetingRecordings(meeting.id).then(setRecordings).catch(() => undefined);
    const channel = supabase
      .channel(`recording-status:${meeting.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_recordings', filter: `meeting_id=eq.${meeting.id}` }, () => {
        void listMeetingRecordings(meeting.id).then(setRecordings);
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [meeting.id]);

  const activeRecording = recordings.find((r) => ['starting', 'active'].includes(r.status));

  const selectPanel = (next: MeetingPanel) => {
    panelRef.current = next;
    setPanel(next);
    setToolsOpen(false);
    if (next === 'chat') {
      setUnread(0);
      void markChatRead(meeting.id).catch(() => undefined);
    }
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
    void listRaisedHands(meeting.id).then((rows) => {
      setRaisedHands(new Set(rows.map((row) => row.user_id)));
      setHandRaised(rows.some((row) => row.user_id === user.id));
    }).catch(() => undefined);
  }, [meeting.id, user.id]);

  useEffect(() => {
    const channel = supabase
      .channel(`conference-data:${meeting.id}`)
      .on('postgres_changes', { event: '*', schema: 'public', table: 'chat_messages', filter: `meeting_id=eq.${meeting.id}` }, () => {
        void refreshMessages();
      })
      .on('postgres_changes', { event: '*', schema: 'public', table: 'meeting_hand_raises', filter: `meeting_id=eq.${meeting.id}` }, () => {
        void listRaisedHands(meeting.id).then((rows) => {
          setRaisedHands(new Set(rows.map((row) => row.user_id)));
          setHandRaised(rows.some((row) => row.user_id === user.id));
        });
      })
      .on('postgres_changes', { event: 'INSERT', schema: 'public', table: 'meeting_reactions', filter: `meeting_id=eq.${meeting.id}` }, (payload) => {
        const row = payload.new as { user_id?: string; emoji?: string; id?: string };
        if (row?.user_id && row?.emoji) {
          addReaction(row.user_id, row.emoji, row.id || `${row.user_id}-${Date.now()}`);
        }
      })
      .subscribe();
    return () => {
      void supabase.removeChannel(channel);
    };
  }, [addReaction, meeting.id, refreshMessages, user.id]);

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
      setActionError(null);
      if (timer) window.clearTimeout(timer);
      timer = window.setTimeout(() => setConnectionRestored(false), 3000);
    };
    const handleDisconnected = (reason?: unknown) => {
      const kind = classifyDisconnectReason(reason);
      if (shouldLeaveMeetingOnDisconnect(kind) || kind === 'room-closed') {
        onForcedDisconnect?.(kind);
      }
    };
    const handleTrackMuted = (publication: { source?: Track.Source }, participant?: { isLocal?: boolean }) => {
      if (participant?.isLocal && publication.source === Track.Source.Microphone) {
        setHostMuteNotice('Your microphone was muted.');
      }
    };
    room.on(RoomEvent.Reconnected, handleReconnected);
    room.on(RoomEvent.Disconnected, handleDisconnected);
    room.on(RoomEvent.TrackMuted, handleTrackMuted);
    return () => {
      room.off(RoomEvent.Reconnected, handleReconnected);
      room.off(RoomEvent.Disconnected, handleDisconnected);
      room.off(RoomEvent.TrackMuted, handleTrackMuted);
      if (timer) window.clearTimeout(timer);
    };
  }, [onForcedDisconnect, room]);

  const toggleMicrophone = async () => {
    try {
      setActionError(null);
      setHostMuteNotice(null);
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
    try {
      await persistHandRaised(meeting.id, raised);
      await sendEvent(encodeConferenceEvent({ type: 'hand', raised }), { reliable: true });
    } catch {
      setActionError('Your hand state could not be saved.');
    }
  };

  const sendReaction = async (emoji: string, eventTimestamp: number) => {
    if (!shouldAllowReaction(lastReactionAt.current, eventTimestamp)) return;
    lastReactionAt.current = eventTimestamp;
    reactionNonce.current += 1;
    const nonce = `${Math.floor(eventTimestamp)}-${reactionNonce.current}`;
    addReaction(user.id, emoji, `${user.id}-${nonce}`);
    try {
      await sendMeetingReaction(meeting.id, emoji);
      await sendEvent(encodeConferenceEvent({ type: 'reaction', emoji, nonce }), { reliable: true });
    } catch {
      setActionError('The reaction could not be saved.');
    }
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

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      if (showReactions) {
        setShowReactions(false);
        return;
      }
      if (showDevices) {
        setShowDevices(false);
        return;
      }
      if (toolsOpen) {
        setToolsOpen(false);
        return;
      }
      if (panel) {
        panelRef.current = null;
        setPanel(null);
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [panel, showDevices, showReactions, toolsOpen]);

  const connection = connectionRestored && connectionState === ConnectionState.Connected
    ? 'reconnected'
    : mapConnectionState(connectionState);
  const connectionMessage = connectionStatusMessage(connection);

  return (
    <div className="relative flex h-dvh min-h-0 flex-col overflow-hidden bg-slate-950 text-white" data-lk-theme="default">
      <RoomAudioRenderer />
      <StartAudio label="Enable meeting audio" className="absolute left-1/2 top-20 z-50 -translate-x-1/2 rounded-full bg-blue-600 px-4 py-2 text-sm font-semibold text-white shadow-xl" />

      <header className="flex shrink-0 items-center justify-between border-b border-slate-800 bg-slate-950/95 px-4 py-3 sm:px-6">
        <div className="flex min-w-0 items-center gap-3">
          <div className="min-w-0">
            <h1 className="truncate font-semibold">{meeting.title}</h1>
            <p className="text-xs text-slate-400">{meeting.code} · {participantCount} {participantCount === 1 ? 'participant' : 'participants'}</p>
          </div>
          {activeRecording && (
            <div className="flex items-center gap-1.5 rounded-full bg-red-600/15 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-red-400 border border-red-500/20">
              <FiberManualRecord className="h-2.5 w-2.5 animate-pulse" />
              Recording
            </div>
          )}
        </div>
        <div className="flex min-w-0 items-center gap-2 text-xs text-slate-300" aria-live="polite">
          <span className={`h-2 w-2 shrink-0 rounded-full ${connection === 'connected' || connection === 'reconnected' ? 'bg-emerald-400' : connection === 'reconnecting' ? 'bg-amber-400' : 'bg-red-400'}`} />
          <span className="max-w-[9.5rem] truncate sm:max-w-none">{connectionMessage}</span>
          {meeting.is_locked && <Lock className="h-4 w-4 shrink-0 text-amber-300" aria-label="Meeting locked" />}
        </div>
      </header>

      {(actionError || mediaFailure || hostMuteNotice || shouldShowConnectionBanner(connection)) && (
        <div className="shrink-0 border-b border-slate-800 bg-slate-900 px-4 py-2 text-center text-sm text-amber-200" role="status">
          <span>{actionError || mediaFailure || hostMuteNotice || connectionMessage}</span>
          {connection === 'disconnected' && shouldAttemptReconnect(classifyDisconnectReason('network')) && onRequestReconnect && (
            <button type="button" onClick={onRequestReconnect} className="ml-3 rounded-full bg-blue-600 px-3 py-1 text-xs font-semibold text-white">
              Reconnect
            </button>
          )}
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
          moderatingIdentity={busyControl}
          onClose={() => selectPanel(null)}
          onSend={(message) => void sendChat(message)}
          onModerate={isHost ? (identity, action) => void moderate(identity, action) : undefined}
          onDeleteMessage={(messageId) => {
            void deletePersistentChat(messageId)
              .then(() => setMessages((items) => items.filter((item) => item.id !== messageId)))
              .catch(() => setChatError('The message could not be removed.'));
          }}
          onClearHands={isHost ? () => {
            void clearRaisedHands(meeting.id)
              .then(() => { setRaisedHands(new Set()); setHandRaised(false); })
              .catch(() => setActionError('Raised hands could not be cleared.'));
          } : undefined}
        />
        {toolsOpen && (
          <MeetingToolsPanel meetingId={meeting.id} isHost={isHost} tokenEndpoint={tokenEndpoint} />
        )}
      </div>

      <div className="pointer-events-none absolute inset-x-0 bottom-24 z-30 flex items-end justify-center gap-3 px-4">
        {reactions.map((reaction) => (
          <div key={reaction.id} className="animate-bounce rounded-full bg-slate-900/90 px-3 py-2 text-center shadow-xl">
            <span className="text-2xl">{reaction.emoji}</span>
            <span className="ml-2 text-xs text-slate-300">{reaction.name}</span>
          </div>
        ))}
      </div>

      <footer className="relative z-40 flex shrink-0 items-center justify-start gap-2 overflow-x-auto border-t border-slate-800 bg-slate-950 px-2 py-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] sm:justify-center sm:gap-3 sm:px-6">
        <button onClick={() => void toggleMicrophone()} className={`meeting-control ${isMicrophoneEnabled ? '' : 'meeting-control-off'}`} aria-label={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'} title={isMicrophoneEnabled ? 'Mute microphone' : 'Unmute microphone'}>
          {isMicrophoneEnabled ? <Mic /> : <MicOff />}
        </button>
        <button onClick={() => void toggleCamera()} className={`meeting-control ${isCameraEnabled ? '' : 'meeting-control-off'}`} aria-label={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'} title={isCameraEnabled ? 'Turn off camera' : 'Turn on camera'}>
          {isCameraEnabled ? <Camera /> : <CameraOff />}
        </button>
        <button onClick={() => void toggleScreenShare()} className={`meeting-control ${isScreenShareEnabled ? 'meeting-control-active' : ''}`} aria-label={isScreenShareEnabled ? 'Stop screen sharing' : 'Share screen'} title={isScreenShareEnabled ? 'Stop sharing' : 'Share screen'}>
          <MonitorUp />
        </button>
        <button onClick={() => selectPanel(panel === 'participants' ? null : 'participants')} className={`meeting-control ${panel === 'participants' ? 'meeting-control-active' : ''}`} aria-label="Toggle participants" aria-expanded={panel === 'participants'} title="Participants">
          <Users />
        </button>
        <button onClick={() => selectPanel(panel === 'chat' ? null : 'chat')} className={`meeting-control relative ${panel === 'chat' ? 'meeting-control-active' : ''}`} aria-label="Toggle meeting chat" aria-expanded={panel === 'chat'} title="Chat">
          <MessageSquare />
          {unread > 0 && <span className="absolute -right-1 -top-1 flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold">{Math.min(unread, 99)}</span>}
        </button>
        <button
          onClick={() => {
            setPanel(null);
            panelRef.current = null;
            setToolsOpen((value) => !value);
          }}
          className={`meeting-control ${toolsOpen ? 'meeting-control-active' : ''}`}
          aria-label="Toggle collaboration tools"
          aria-expanded={toolsOpen}
          title="Polls, Q&A, notes"
        >
          <ClipboardList />
        </button>
        <button onClick={() => void toggleHand()} className={`meeting-control ${handRaised ? 'meeting-control-active' : ''}`} aria-label={handRaised ? 'Lower hand' : 'Raise hand'} title={handRaised ? 'Lower hand' : 'Raise hand'}>
          <Hand />
        </button>

        <div className="relative">
          <button onClick={() => setShowReactions((value) => !value)} className="meeting-control" aria-label="Show reactions" aria-expanded={showReactions} aria-haspopup="menu" title="Reactions">
            <Smile />
          </button>
          {showReactions && (
            <div role="menu" className="absolute bottom-16 left-1/2 z-50 flex max-w-[calc(100vw-2rem)] -translate-x-1/2 flex-wrap justify-center gap-1 rounded-2xl border border-slate-700 bg-slate-900 p-2 shadow-2xl">
              <p className="w-full px-2 pb-1 text-center text-[10px] text-slate-400">Reactions are short-lived overlays for everyone in the call.</p>
              {REACTIONS.map((emoji) => (
                <button key={emoji} role="menuitem" onClick={(event) => void sendReaction(emoji, event.timeStamp)} className="rounded-xl p-2 text-2xl hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400" aria-label={`Send ${emoji} reaction`}>{emoji}</button>
              ))}
            </div>
          )}
        </div>

        <div className="relative">
          <button onClick={() => setShowDevices((value) => !value)} className="meeting-control" aria-label="Device settings" aria-expanded={showDevices} aria-haspopup="dialog" title="Device settings">
            <MoreHorizontal />
          </button>
          {showDevices && (
            <div role="dialog" aria-label="Device settings" className="absolute bottom-16 right-0 z-50 w-[min(18rem,calc(100vw-1.5rem))] space-y-3 rounded-2xl border border-slate-700 bg-slate-900 p-4 text-sm shadow-2xl">
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
                <button onClick={() => void toggleLock()} disabled={busyControl === 'lock'} className="flex w-full items-center gap-2 rounded-xl border border-slate-700 px-3 py-2 text-left hover:bg-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
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
  onForcedDisconnect,
  onRequestReconnect,
}: ConferenceRoomProps) {
  const [mediaFailure, setMediaFailure] = useState<string | null>(null);
  const room = useMemo(() => new Room({
    adaptiveStream: true,
    dynacast: true,
    disconnectOnPageLeave: true,
    reconnectPolicy: {
      nextRetryDelayInMs: (context) => liveKitReconnectDelayMs(context.retryCount),
    },
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
      connectOptions={{ autoSubscribe: true, maxRetries: 10 }}
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
        onForcedDisconnect={onForcedDisconnect}
        onRequestReconnect={onRequestReconnect}
        mediaFailure={mediaFailure}
      />
    </LiveKitRoom>
  );
}
