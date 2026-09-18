import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Camera, Hand, MessageSquare, Mic, Monitor, PhoneOff, Play, Video } from 'lucide-react';
import { createLocalTracks, Room, RoomEvent } from 'livekit-client';
import { useAuth } from '../contexts/AuthContext';
import { supabase } from '../lib/supabase';
import {
  findMeetingByCode,
  joinPersistentMeeting,
  leavePersistentMeeting,
  listParticipantsForMeeting,
  transitionPersistentMeeting,
  type JoinedMeeting,
  type ParticipantSummary,
} from '../lib/data-access';
import { isJoinableMeetingStatus, isValidMeetingCode, normalizeMeetingCode } from '../lib/meeting-utils';

const cardAccents = ['from-blue-500 to-indigo-500', 'from-emerald-500 to-teal-500', 'from-amber-500 to-orange-500', 'from-rose-500 to-pink-500'];
type ConnectionState = 'idle' | 'unavailable' | 'connecting' | 'connected' | 'error';

export default function MeetingRoom() {
  const navigate = useNavigate();
  const { meetingCode: routeCode } = useParams();
  const { user } = useAuth();
  const roomRef = useRef<Room | null>(null);
  const leaveInFlight = useRef(false);
  const [meeting, setMeeting] = useState<JoinedMeeting | null>(null);
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);
  const [connectionState, setConnectionState] = useState<ConnectionState>('idle');
  const [connectionMessage, setConnectionMessage] = useState('Waiting for the host to start the meeting.');
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const livekitUrl = import.meta.env.VITE_LIVEKIT_URL as string | undefined;
  const livekitTokenEndpoint = import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT as string | undefined;
  const isHost = Boolean(meeting && user && meeting.host_id === user.id);
  const livekitReady = Boolean(livekitUrl && livekitTokenEndpoint);
  const meetingId = meeting?.id ?? null;
  const meetingCode = meeting?.code ?? null;
  const meetingStatus = meeting?.status ?? null;

  useEffect(() => {
    let active = true;
    const loadMeeting = async () => {
      if (!user?.id) return;
      const code = normalizeMeetingCode(routeCode ?? '');
      if (!isValidMeetingCode(code)) {
        setPageError('This meeting link is invalid.');
        return;
      }

      try {
        setPageError(null);
        const resolved = await joinPersistentMeeting(code);
        if (!active) return;
        setMeeting(resolved);
        const rows = await listParticipantsForMeeting(resolved.id);
        if (active) setParticipants(rows.filter((row) => ['joined', 'muted', 'waiting'].includes(row.status)));
      } catch (error) {
        if (active) setPageError(error instanceof Error ? error.message : 'Unable to load this meeting.');
      }
    };

    void loadMeeting();
    return () => {
      active = false;
    };
  }, [routeCode, user?.id]);

  useEffect(() => {
    if (!meetingId || !meetingCode || !meetingStatus || !isJoinableMeetingStatus(meetingStatus)) return undefined;

    let active = true;
    const refresh = async () => {
      try {
        const latest = await findMeetingByCode(meetingCode);
        if (!latest || !active) return;
        const rows = await listParticipantsForMeeting(latest.id);
        if (!active) return;
        setMeeting((current) => current ? { ...current, ...latest } : current);
        setParticipants(rows.filter((row) => ['joined', 'muted', 'waiting'].includes(row.status)));
      } catch {
        // Keep the current room state if a background refresh fails.
      }
    };

    const timer = window.setInterval(() => {
      void refresh();
    }, 4000);
    return () => {
      active = false;
      window.clearInterval(timer);
    };
  }, [meetingId, meetingCode, meetingStatus]);

  useEffect(() => {
    if (!meetingCode || meetingStatus !== 'live' || !user || !livekitReady) return undefined;

    let cancelled = false;
    let room: Room | null = null;
    const connectToLivekit = async () => {
      setConnectionState('connecting');
      setConnectionMessage('Connecting to the meeting room...');
      setConnectionError(null);
      try {
        const { data: sessionData } = await supabase.auth.getSession();
        const accessToken = sessionData.session?.access_token;
        if (!accessToken) throw new Error('Your session has expired. Sign in again to join.');

        const tokenResponse = await fetch(`${livekitTokenEndpoint}?room=${encodeURIComponent(meetingCode)}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        const tokenPayload = (await tokenResponse.json()) as { token?: string; error?: string };
        if (!tokenResponse.ok || !tokenPayload.token) throw new Error(tokenPayload.error || 'Unable to authorize the meeting room.');

        room = new Room({ adaptiveStream: true, dynacast: true, reconnectPolicy: { nextRetryDelayInMs: () => 1000 } });
        roomRef.current = room;
        room.on(RoomEvent.Connected, () => {
          if (cancelled) return;
          setConnectionState('connected');
          setConnectionMessage('Connected to the meeting room.');
        });
        room.on(RoomEvent.Disconnected, () => {
          if (!cancelled) {
            setConnectionState('error');
            setConnectionMessage('The media connection was interrupted.');
          }
        });
        await room.connect(livekitUrl as string, tokenPayload.token);
        const localTracks = await createLocalTracks({ audio: true, video: false });
        await Promise.all(localTracks.map((track) => room!.localParticipant.publishTrack(track)));
      } catch (error) {
        if (!cancelled) {
          setConnectionState('error');
          setConnectionMessage('LiveKit connection failed.');
          setConnectionError(error instanceof Error ? error.message : 'Unable to connect to the meeting.');
        }
      }
    };

    const timer = window.setTimeout(() => {
      void connectToLivekit();
    }, 0);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
      if (room) void room.disconnect();
      roomRef.current = null;
    };
  }, [livekitReady, livekitTokenEndpoint, livekitUrl, meetingCode, meetingStatus, user]);

  const disconnectMedia = async () => {
    if (roomRef.current) {
      await roomRef.current.disconnect();
      roomRef.current = null;
    }
  };

  const leave = async () => {
    if (!meeting || leaveInFlight.current) return;
    leaveInFlight.current = true;
    setBusy(true);
    try {
      await leavePersistentMeeting(meeting.id);
      await disconnectMedia();
      navigate('/');
    } catch (error) {
      leaveInFlight.current = false;
      setActionError(error instanceof Error ? error.message : 'Unable to leave the meeting.');
    } finally {
      setBusy(false);
    }
  };

  const startMeeting = async () => {
    if (!meeting || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const liveMeeting = await transitionPersistentMeeting(meeting.id, 'live');
      setMeeting({ ...meeting, ...liveMeeting });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to start the meeting.');
    } finally {
      setBusy(false);
    }
  };

  const endMeeting = async () => {
    if (!meeting || leaveInFlight.current) return;
    leaveInFlight.current = true;
    setBusy(true);
    try {
      await transitionPersistentMeeting(meeting.id, 'ended');
      await disconnectMedia();
      navigate(`/meetings/${meeting.id}`);
    } catch (error) {
      leaveInFlight.current = false;
      setActionError(error instanceof Error ? error.message : 'Unable to end the meeting.');
    } finally {
      setBusy(false);
    }
  };

  if (pageError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="max-w-md rounded-3xl border border-red-900 bg-slate-900 p-8 text-center">
          <h1 className="text-2xl font-semibold">Meeting unavailable</h1>
          <p className="mt-3 text-sm text-slate-300">{pageError}</p>
          <button onClick={() => navigate('/meetings')} className="btn-primary mt-6">View meetings</button>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-200">Loading meeting...</div>;
  }

  if (meeting.status === 'ended' || meeting.status === 'cancelled') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
          <h1 className="text-2xl font-semibold">This meeting has {meeting.status}</h1>
          <p className="mt-3 text-sm text-slate-300">The room is closed. You can review the meeting from history.</p>
          <button onClick={() => navigate(`/meetings/${meeting.id}`)} className="btn-primary mt-6">View details</button>
        </div>
      </div>
    );
  }

  const waitingForHost = meeting.status !== 'live';
  const mediaState = waitingForHost
    ? 'idle'
    : livekitReady
      ? connectionState
      : 'unavailable';
  const mediaMessage = waitingForHost
    ? 'The host has not started the meeting yet.'
    : livekitReady
      ? connectionMessage
      : 'Meeting access is ready. LiveKit is not configured in this environment.';

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="sticky top-0 z-20 border-b border-slate-800 bg-slate-950/90 backdrop-blur-sm">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate('/')} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900" aria-label="Back home">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">{isHost ? 'Host view' : 'Participant view'}</p>
              <h1 className="text-lg font-semibold">{meeting.title}</h1>
              <p className="text-xs text-slate-500">{meeting.code}</p>
            </div>
          </div>
          <span className="rounded-full border border-slate-700 bg-slate-900 px-3 py-1.5 text-xs uppercase tracking-[0.12em] text-slate-300">{meeting.status}</span>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div>
            <p className="text-sm text-slate-400">{waitingForHost ? 'Waiting room' : 'Live meeting'}</p>
            <p className="text-xl font-semibold">{participants.length} participant{participants.length === 1 ? '' : 's'}</p>
          </div>
          <div className="flex items-center gap-3 text-sm">
            <span className={`h-2 w-2 rounded-full ${mediaState === 'connected' ? 'bg-emerald-400' : mediaState === 'connecting' ? 'bg-amber-400' : 'bg-slate-500'}`} />
            {mediaMessage}
          </div>
        </div>

        {(connectionError || actionError) && (
          <div className="mb-4 rounded-2xl border border-red-900 bg-red-950/40 p-4 text-sm text-red-200" role="alert">
            {actionError || connectionError}
          </div>
        )}

        {waitingForHost && (
          <div className="mb-6 rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
            <h2 className="text-2xl font-semibold">Ready when you are</h2>
            <p className="mt-2 text-sm text-slate-400">
              {isHost ? 'Start the meeting when your participants are ready. Leaving will not end it.' : 'You are in the waiting room. The host will start the meeting shortly.'}
            </p>
            {isHost && (
              <button onClick={() => void startMeeting()} disabled={busy || meeting.status !== 'waiting'} className="btn-primary mt-6 disabled:cursor-not-allowed disabled:opacity-50">
                <Play className="mr-2 h-4 w-4" />
                {busy ? 'Starting...' : 'Start meeting'}
              </button>
            )}
          </div>
        )}

        <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-2xl">
          {participants.length === 0 ? (
            <div className="flex min-h-64 items-center justify-center text-slate-400">Waiting for participants...</div>
          ) : (
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {participants.map((participant, index) => (
                <div key={participant.id} className={`rounded-2xl bg-gradient-to-br ${cardAccents[index % cardAccents.length]} p-px`}>
                  <div className="flex min-h-56 flex-col justify-between rounded-2xl bg-slate-950/95 p-4">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-slate-900 px-2 py-1 text-xs text-slate-300">{participant.role}</span>
                      <span className="text-xs text-slate-400">{participant.status}</span>
                    </div>
                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-slate-200 font-semibold text-slate-950">
                        {participant.user_name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium">{participant.user_name}</p>
                        <p className="text-sm text-slate-400">{participant.user_id === user?.id ? 'You' : 'In this meeting'}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>

        <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
          {[{ icon: Mic, label: 'Mic' }, { icon: Camera, label: 'Camera' }, { icon: Monitor, label: 'Share' }, { icon: MessageSquare, label: 'Chat' }, { icon: Hand, label: 'Raise hand' }].map(({ icon: Icon, label }) => (
            <button key={label} className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-200" aria-label={label} disabled>
              <Icon className="h-5 w-5" />
            </button>
          ))}
          <button onClick={() => void leave()} disabled={busy} className="ml-2 flex h-14 items-center justify-center rounded-full bg-slate-800 px-5 text-sm font-semibold text-white disabled:opacity-50">
            Leave
          </button>
          {isHost && (
            <button onClick={() => void endMeeting()} disabled={busy} className="flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white disabled:opacity-50" aria-label="End meeting">
              <PhoneOff className="h-5 w-5" />
            </button>
          )}
        </div>
        <div className="mt-6 text-center text-sm text-slate-400">
          <span className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2">
            <Video className="h-4 w-4 text-blue-400" /> {meeting.code}
          </span>
        </div>
      </main>
    </div>
  );
}
