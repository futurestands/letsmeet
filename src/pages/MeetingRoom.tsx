import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import {
  ArrowLeft,
  Camera,
  Hand,
  MessageSquare,
  Mic,
  Monitor,
  PhoneOff,
  Settings2,
  Sparkles,
  Users,
  Video,
} from 'lucide-react';
import {
  createLocalTracks,
  Room,
  RoomEvent,
} from 'livekit-client';
import { useAuth } from '../contexts/AuthContext';

interface ParticipantCard {
  id: string;
  name: string;
  accent: string;
  active: boolean;
  role: string;
  status: string;
}

const cardAccents = ['from-blue-500 to-indigo-500', 'from-violet-500 to-fuchsia-500', 'from-emerald-500 to-teal-500'];

export default function MeetingRoom() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const { user } = useAuth();
  const roomRef = useRef<Room | null>(null);
  const meetingCode = searchParams.get('code') ?? 'LETSMEET';
  const mode = searchParams.get('mode') ?? 'join';
  const livekitUrl = import.meta.env.VITE_LIVEKIT_URL as string | undefined;
  const livekitTokenEndpoint = import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT as string | undefined;
  const livekitConfigured = Boolean(livekitUrl && livekitTokenEndpoint);

  const [participants, setParticipants] = useState<ParticipantCard[]>([
    {
      id: 'local-demo',
      name: user?.full_name || 'You',
      accent: cardAccents[0],
      active: true,
      role: 'Host',
      status: 'Ready',
    },
  ]);
  const [connectionState, setConnectionState] = useState<'demo' | 'connecting' | 'connected' | 'error'>(
    livekitConfigured ? 'connecting' : 'demo',
  );
  const [connectionMessage, setConnectionMessage] = useState(
    livekitConfigured ? 'Connecting to the LiveKit room...' : 'Demo mode enabled. Configure LiveKit to connect real participants.',
  );
  const [connectionError, setConnectionError] = useState<string | null>(null);

  const meetingNotes = useMemo(
    () =>
      mode === 'new'
        ? ['Start the meeting and add your agenda items here.']
        : ['Join the meeting and capture the key discussion points here.'],
    [mode],
  );

  useEffect(() => {
    if (!livekitConfigured) {
      return;
    }

    let cancelled = false;
    let room: Room | null = null;

    const syncParticipants = () => {
      if (!roomRef.current) return;
      const currentRoom = roomRef.current;
      const nextParticipants: ParticipantCard[] = [
        {
          id: currentRoom.localParticipant.identity || 'local',
          name: user?.full_name || currentRoom.localParticipant.identity || 'You',
          accent: cardAccents[0],
          active: true,
          role: 'Host',
          status: currentRoom.state === 'connected' ? 'Connected' : 'Ready',
        },
        ...Array.from(currentRoom.remoteParticipants.values()).map((participant, index) => ({
          id: participant.identity,
          name: participant.name || participant.identity,
          accent: cardAccents[(index % (cardAccents.length - 1)) + 1] ?? cardAccents[1],
          active: false,
          role: 'Participant',
          status: 'Connected',
        })),
      ];

      setParticipants(nextParticipants);
    };

    const connectToLivekit = async () => {
      if (!livekitUrl || !livekitTokenEndpoint) {
        return;
      }

      setConnectionState('connecting');
      setConnectionError(null);
      setConnectionMessage('Connecting to the LiveKit room...');

      try {
        const identity = encodeURIComponent(user?.id || 'guest-user');
        const displayName = encodeURIComponent(user?.full_name || 'Guest User');
        const tokenUrl = `${livekitTokenEndpoint}${livekitTokenEndpoint.includes('?') ? '&' : '?'}room=${encodeURIComponent(meetingCode)}&identity=${identity}&name=${displayName}`;

        const tokenResponse = await fetch(tokenUrl);
        const tokenPayload = (await tokenResponse.json()) as { token?: string; error?: string };

        if (!tokenResponse.ok || !tokenPayload.token) {
          throw new Error(tokenPayload.error || 'Unable to retrieve a LiveKit token.');
        }

        room = new Room({
          adaptiveStream: true,
          dynacast: true,
          reconnectPolicy: {
            nextRetryDelayInMs: () => 1000,
          },
        });

        roomRef.current = room;

        room.on(RoomEvent.Connected, () => {
          if (cancelled) return;
          setConnectionState('connected');
          setConnectionMessage('Connected to the LiveKit room.');
          setConnectionError(null);
          syncParticipants();
        });

        room.on(RoomEvent.ParticipantConnected, syncParticipants);
        room.on(RoomEvent.ParticipantDisconnected, syncParticipants);
        room.on(RoomEvent.ActiveSpeakersChanged, syncParticipants);
        room.on(RoomEvent.TrackSubscribed, syncParticipants);
        room.on(RoomEvent.TrackUnsubscribed, syncParticipants);
        room.on(RoomEvent.Disconnected, () => {
          if (cancelled) return;
          setConnectionState('error');
          setConnectionMessage('Disconnected from the LiveKit room.');
        });

        await room.connect(livekitUrl, tokenPayload.token);

        const localTracks = await createLocalTracks({
          audio: true,
          video: false,
        });

        await Promise.all(localTracks.map((track) => room!.localParticipant.publishTrack(track)));

        if (cancelled) {
          await room.disconnect();
          return;
        }

        syncParticipants();
      } catch (error) {
        if (cancelled) {
          return;
        }

        setConnectionState('error');
        setConnectionMessage('LiveKit connection failed.');
        setConnectionError(error instanceof Error ? error.message : 'Unknown LiveKit error.');
      }
    };

    void connectToLivekit();

    return () => {
      cancelled = true;
      if (room) {
        void room.disconnect();
      }
      roomRef.current = null;
    };
  }, [livekitConfigured, livekitTokenEndpoint, livekitUrl, meetingCode, user?.full_name, user?.id]);

  return (
    <div className="min-h-screen bg-slate-950 text-white">
      <header className="border-b border-slate-800 bg-slate-950/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto flex max-w-7xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-4">
            <button
              onClick={() => navigate('/')}
              className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-200 transition hover:border-slate-500 hover:text-white"
              aria-label="Back to home"
            >
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div>
              <p className="text-xs uppercase tracking-[0.2em] text-slate-400">
                {mode === 'new' ? 'New Meeting' : 'Joined Meeting'}
              </p>
              <h1 className="text-lg font-semibold">{meetingCode}</h1>
            </div>
          </div>

          <div className="flex items-center gap-2 text-sm text-slate-300">
            <div
              className={`flex items-center gap-2 rounded-full border px-3 py-1.5 ${
                connectionState === 'connected'
                  ? 'border-emerald-500/30 bg-emerald-500/10 text-emerald-300'
                  : connectionState === 'connecting'
                    ? 'border-amber-500/30 bg-amber-500/10 text-amber-300'
                    : 'border-slate-700 bg-slate-900 text-slate-300'
              }`}
            >
              <span className={`h-2 w-2 rounded-full ${connectionState === 'connected' ? 'bg-emerald-400' : connectionState === 'connecting' ? 'bg-amber-400' : 'bg-slate-500'}`} />
              {connectionState === 'connected' ? 'LiveKit connected' : connectionState === 'connecting' ? 'Connecting...' : 'Demo mode'}
            </div>
            <button className="rounded-full border border-slate-700 bg-slate-900 p-2 transition hover:border-slate-500">
              <Settings2 className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-7xl px-6 py-8">
        <div className="mb-6 flex items-center justify-between rounded-2xl border border-slate-800 bg-slate-900/70 p-4">
          <div>
            <p className="text-sm text-slate-400">Meeting status</p>
            <p className="text-xl font-semibold">{participants.length} people are in this meeting</p>
          </div>
          <button className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
            Invite
          </button>
        </div>

        <div className="mb-4 rounded-2xl border border-slate-800 bg-slate-900/60 p-4 text-sm text-slate-300">
          {connectionMessage}
          {connectionError && <div className="mt-2 text-red-300">{connectionError}</div>}
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.6fr_0.7fr]">
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/50">
            <div className="grid gap-4 md:grid-cols-2">
              {participants.map((participant) => (
                <div
                  key={participant.id}
                  className={`relative overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br ${participant.accent} p-[1px]`}
                >
                  <div className="flex h-56 flex-col justify-between rounded-2xl bg-slate-950/90 p-4">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-slate-900/80 px-2 py-1 text-xs text-slate-300">
                        {participant.role}
                      </span>
                      <div className="flex gap-2">
                        <div className="rounded-full border border-slate-700 bg-slate-900 p-2">
                          <Mic className="h-4 w-4 text-white" />
                        </div>
                        <div className="rounded-full border border-slate-700 bg-slate-900 p-2">
                          <Camera className="h-4 w-4 text-white" />
                        </div>
                      </div>
                    </div>

                    <div className="flex items-center gap-3">
                      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-slate-200 to-slate-500 font-semibold text-slate-950">
                        {participant.name.slice(0, 2).toUpperCase()}
                      </div>
                      <div>
                        <p className="font-medium">{participant.name}</p>
                        <p className="text-sm text-slate-400">Video on · {participant.status}</p>
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </section>

          <aside className="space-y-6">
            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <Users className="h-5 w-5 text-blue-400" /> Participants
              </h2>
              <ul className="space-y-3 text-sm text-slate-300">
                {participants.map((participant) => (
                  <li key={participant.id} className="flex items-center justify-between rounded-xl bg-slate-800 px-3 py-2">
                    <span>{participant.name}</span>
                    <span className="text-slate-400">{participant.status}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-violet-400" /> Meeting notes
              </h2>
              <div className="space-y-3 text-sm text-slate-300">
                {meetingNotes.map((note) => (
                  <p key={note}>• {note}</p>
                ))}
              </div>
            </div>
          </aside>
        </div>

        <div className="mt-8 flex items-center justify-center gap-3">
          {[{ icon: Mic, label: 'Mic' }, { icon: Camera, label: 'Camera' }, { icon: Monitor, label: 'Share' }, { icon: MessageSquare, label: 'Chat' }, { icon: Hand, label: 'Raise hand' }].map(
            ({ icon: Icon, label }) => (
              <button
                key={label}
                className="flex h-14 w-14 items-center justify-center rounded-full border border-slate-700 bg-slate-900 text-slate-200 transition hover:border-slate-500 hover:bg-slate-800"
                aria-label={label}
              >
                <Icon className="h-5 w-5" />
              </button>
            ),
          )}

          <button
            onClick={() => navigate('/')}
            className="ml-4 flex h-14 w-14 items-center justify-center rounded-full bg-red-600 text-white transition hover:bg-red-500"
            aria-label="Leave meeting"
          >
            <PhoneOff className="h-5 w-5" />
          </button>
        </div>

        <div className="mt-6 text-center text-sm text-slate-400">
          <div className="inline-flex items-center gap-2 rounded-full border border-slate-700 bg-slate-900 px-4 py-2">
            <Video className="h-4 w-4 text-blue-400" />
            Meeting code: <span className="font-medium text-white">{meetingCode}</span>
          </div>
        </div>
      </main>
    </div>
  );
}
