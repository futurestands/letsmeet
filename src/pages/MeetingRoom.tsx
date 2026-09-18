import { useCallback, useEffect, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Lock, Play, Video } from 'lucide-react';
import ConferenceRoom from '../components/ConferenceRoom';
import { useAuth } from '../contexts/AuthContext';
import {
  findMeetingByCode,
  joinMeetingByShareLink,
  joinPersistentMeeting,
  leavePersistentMeeting,
  transitionPersistentMeeting,
  type JoinedMeeting,
  type MeetingSummary,
} from '../lib/data-access';
import type { PreJoinSettings } from '../lib/conference-utils';
import { isValidMeetingCode, meetingJoinPath, normalizeMeetingCode } from '../lib/meeting-utils';
import { supabase } from '../lib/supabase';

type MeetingLocationState = {
  preJoinSettings?: PreJoinSettings;
};

const defaultSettings: PreJoinSettings = {
  audioEnabled: false,
  videoEnabled: false,
  audioDeviceId: '',
  videoDeviceId: '',
  audioOutputDeviceId: '',
};

export default function MeetingRoom() {
  const navigate = useNavigate();
  const location = useLocation();
  const { meetingCode: routeCode } = useParams();
  const { user, isGuest } = useAuth();
  const leaveInFlight = useRef(false);
  const settings = (location.state as MeetingLocationState | null)?.preJoinSettings;
  const [meeting, setMeeting] = useState<JoinedMeeting | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [mediaSession, setMediaSession] = useState(0);
  const [pageError, setPageError] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const livekitUrl = import.meta.env.VITE_LIVEKIT_URL as string | undefined;
  const livekitTokenEndpoint = import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT as string | undefined;
  const code = normalizeMeetingCode(routeCode ?? '');
  const isHost = Boolean(meeting && user && meeting.host_id === user.id);
  const persistentMeetingId = meeting?.id ?? null;
  const persistentMeetingCode = meeting?.code ?? null;
  const persistentMeetingStatus = meeting?.status ?? null;

  useEffect(() => {
    if (!settings && isValidMeetingCode(code)) {
      navigate(meetingJoinPath(code), { replace: true });
    }
  }, [code, navigate, settings]);

  useEffect(() => {
    if (!settings || !user?.id || !isValidMeetingCode(code)) return undefined;
    let active = true;

    const joinPromise = isGuest
      ? joinMeetingByShareLink(code, user.full_name || 'Meeting guest')
      : joinPersistentMeeting(code);

    void Promise.all([joinPromise, findMeetingByCode(code).catch(() => null)])
      .then(([resolved, persisted]) => {
        if (active) setMeeting({ ...resolved, ...(persisted ?? {}) });
      })
      .catch((error) => {
        if (active) setPageError(error instanceof Error ? error.message : 'Unable to load this meeting.');
      });

    return () => {
      active = false;
    };
  }, [code, isGuest, settings, user?.full_name, user?.id]);

  useEffect(() => {
    if (!persistentMeetingId || !user?.id) return undefined;

    const channel = supabase
      .channel(`meeting-state:${persistentMeetingId}:${user.id}`)
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'meetings', filter: `id=eq.${persistentMeetingId}` },
        (payload) => {
          const next = payload.new as MeetingSummary;
          setMeeting((current) => current ? { ...current, ...next } : current);
          if (next.status === 'ended' || next.status === 'cancelled') setToken(null);
        },
      )
      .on(
        'postgres_changes',
        { event: 'UPDATE', schema: 'public', table: 'meeting_participants', filter: `user_id=eq.${user.id}` },
        (payload) => {
          const participant = payload.new as { meeting_id?: string; status?: string };
          if (participant.meeting_id === persistentMeetingId && participant.status === 'removed') {
            setToken(null);
            setPageError('The host removed you from this meeting.');
          }
        },
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [persistentMeetingId, user?.id]);

  const requestMediaToken = useCallback(async (remount = false) => {
    if (!persistentMeetingCode || persistentMeetingStatus !== 'live' || !livekitTokenEndpoint) return;
    setPageError(null);
    const { data } = await supabase.auth.getSession();
    const accessToken = data.session?.access_token;
    if (!accessToken) throw new Error('Your session expired. Sign in again.');
    const response = await fetch(`${livekitTokenEndpoint}?room=${encodeURIComponent(persistentMeetingCode)}`, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });
    const payload = await response.json() as { token?: string; error?: string };
    if (!response.ok || !payload.token) throw new Error(payload.error || 'Meeting authorization failed.');
    setToken(payload.token);
    if (remount) setMediaSession((value) => value + 1);
  }, [livekitTokenEndpoint, persistentMeetingCode, persistentMeetingStatus]);

  useEffect(() => {
    if (!persistentMeetingCode || persistentMeetingStatus !== 'live' || !livekitTokenEndpoint) return undefined;
    let active = true;

    const authorize = async () => {
      try {
        setPageError(null);
        const { data } = await supabase.auth.getSession();
        const accessToken = data.session?.access_token;
        if (!accessToken) throw new Error('Your session expired. Sign in again.');
        const response = await fetch(`${livekitTokenEndpoint}?room=${encodeURIComponent(persistentMeetingCode)}`, {
          headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
        });
        const payload = await response.json() as { token?: string; error?: string };
        if (!response.ok || !payload.token) throw new Error(payload.error || 'Meeting authorization failed.');
        if (active) setToken(payload.token);
      } catch (error) {
        if (active) setPageError(error instanceof Error ? error.message : 'Unable to connect to this meeting.');
      }
    };

    void authorize();
    return () => {
      active = false;
    };
  }, [livekitTokenEndpoint, persistentMeetingCode, persistentMeetingStatus]);

  const startMeeting = async () => {
    if (!meeting || busy) return;
    setBusy(true);
    setActionError(null);
    try {
      const next = await transitionPersistentMeeting(meeting.id, 'live');
      setMeeting({ ...meeting, ...next });
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to start the meeting.');
    } finally {
      setBusy(false);
    }
  };

  const leaveMeeting = useCallback(async () => {
    if (!meeting || leaveInFlight.current) return;
    leaveInFlight.current = true;
    try {
      await leavePersistentMeeting(meeting.id);
      navigate('/');
    } catch {
      leaveInFlight.current = false;
      setActionError('Unable to leave the meeting. Try again.');
    }
  }, [meeting, navigate]);

  const endMeeting = useCallback(async () => {
    if (!meeting || leaveInFlight.current) return;
    leaveInFlight.current = true;
    try {
      await transitionPersistentMeeting(meeting.id, 'ended');
      navigate(`/meetings/${meeting.id}`);
    } catch {
      leaveInFlight.current = false;
      setActionError('Unable to end the meeting. Try again.');
    }
  }, [meeting, navigate]);

  if (!settings) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">Opening device check…</div>;
  }

  if (pageError) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="max-w-md rounded-3xl border border-red-900 bg-slate-900 p-8 text-center">
          <h1 className="text-2xl font-semibold">Meeting unavailable</h1>
          <p className="mt-3 text-sm text-slate-300" role="alert">{pageError}</p>
          <div className="mt-6 flex justify-center gap-3">
            <button onClick={() => navigate(meetingJoinPath(code), { replace: true })} className="btn-primary">Try again</button>
            <button onClick={() => navigate('/meetings')} className="btn-secondary">Meetings</button>
          </div>
        </div>
      </div>
    );
  }

  if (!meeting) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">Checking meeting access…</div>;
  }

  if (meeting.status === 'ended' || meeting.status === 'cancelled') {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center">
          <h1 className="text-2xl font-semibold">This meeting has {meeting.status}</h1>
          <p className="mt-3 text-sm text-slate-300">The live room is closed. Its details remain available in meeting history.</p>
          <button onClick={() => navigate(`/meetings/${meeting.id}`)} className="btn-primary mt-6">View details</button>
        </div>
      </div>
    );
  }

  if (meeting.status !== 'live') {
    return (
      <div className="min-h-screen bg-slate-950 text-white">
        <header className="border-b border-slate-800 px-6 py-4">
          <div className="mx-auto flex max-w-5xl items-center gap-4">
            <button onClick={() => navigate('/meetings')} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-700 bg-slate-900" aria-label="Back to meetings">
              <ArrowLeft className="h-4 w-4" />
            </button>
            <div><h1 className="font-semibold">{meeting.title}</h1><p className="text-xs text-slate-400">{meeting.code}</p></div>
          </div>
        </header>
        <main className="mx-auto flex max-w-xl flex-col items-center px-6 py-24 text-center">
          <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-blue-600/20 text-blue-300">
            <Video className="h-9 w-9" />
          </div>
          <h2 className="mt-6 text-3xl font-bold">{isHost ? 'Ready to start?' : 'Waiting for the host'}</h2>
          <p className="mt-3 text-slate-400">
            {isHost ? 'Your camera and microphone choices are ready. Start when everyone is prepared.' : 'You will connect automatically when the host starts the meeting.'}
          </p>
          {meeting.is_locked && <p className="mt-4 flex items-center gap-2 text-sm text-amber-300"><Lock className="h-4 w-4" /> This meeting is locked</p>}
          {actionError && <p className="mt-4 text-sm text-red-300" role="alert">{actionError}</p>}
          <div className="mt-8 flex gap-3">
            {isHost && (
              <button onClick={() => void startMeeting()} disabled={busy} className="btn-primary">
                <Play className="mr-2 h-4 w-4" /> {busy ? 'Starting…' : 'Start meeting'}
              </button>
            )}
            <button onClick={() => void leaveMeeting()} className="btn-secondary">Leave</button>
          </div>
        </main>
      </div>
    );
  }

  if (!livekitUrl || !livekitTokenEndpoint) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 px-6 text-white">
        <div className="max-w-md rounded-3xl border border-amber-900 bg-slate-900 p-8 text-center">
          <h1 className="text-2xl font-semibold">Media service unavailable</h1>
          <p className="mt-3 text-sm text-slate-300">LiveKit is not configured for this environment. The persistent meeting remains available.</p>
          <button onClick={() => navigate('/meetings')} className="btn-primary mt-6">Back to meetings</button>
        </div>
      </div>
    );
  }

  if (!token) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-950 text-slate-300">Authorizing secure media…</div>;
  }

  return (
    <ConferenceRoom
      key={`${meeting.id}:${mediaSession}`}
      meeting={meeting}
      user={user!}
      token={token}
      serverUrl={livekitUrl}
      tokenEndpoint={livekitTokenEndpoint}
      settings={settings ?? defaultSettings}
      onMeetingChange={(next) => setMeeting((current) => current ? { ...current, ...next } : current)}
      onLeave={() => void leaveMeeting()}
      onEnd={() => void endMeeting()}
      onForcedDisconnect={(kind) => {
        if (kind === 'removed') {
          setToken(null);
          setPageError('The host removed you from this meeting.');
          return;
        }
        if (kind === 'room-closed') {
          setToken(null);
        }
      }}
      onRequestReconnect={() => {
        void requestMediaToken(true).catch((error) => {
          setPageError(error instanceof Error ? error.message : 'Unable to reconnect to this meeting.');
        });
      }}
    />
  );
}
