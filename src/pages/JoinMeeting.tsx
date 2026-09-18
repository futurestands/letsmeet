import { useEffect, useRef, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, Link2, Video } from 'lucide-react';
import { joinPersistentMeeting } from '../lib/data-access';
import { isValidMeetingCode, meetingRoomPath, normalizeMeetingCode } from '../lib/meeting-utils';

export default function JoinMeeting() {
  const navigate = useNavigate();
  const { meetingCode: routeCode } = useParams();
  const [meetingCode, setMeetingCode] = useState(routeCode ?? '');
  const [error, setError] = useState<string | null>(null);
  const [joining, setJoining] = useState(false);
  const autoJoinStarted = useRef(false);

  const joinMeeting = async (rawCode = meetingCode) => {
    const normalizedCode = normalizeMeetingCode(rawCode);
    if (!isValidMeetingCode(normalizedCode)) {
      setError('Enter a valid six-character meeting code.');
      return;
    }

    try {
      setJoining(true);
      setError(null);
      const meeting = await joinPersistentMeeting(normalizedCode);
      navigate(meetingRoomPath(meeting.code), { replace: true });
    } catch (joinError) {
      setError(joinError instanceof Error ? joinError.message : 'Unable to join this meeting.');
    } finally {
      setJoining(false);
    }
  };

  useEffect(() => {
    if (!routeCode || autoJoinStarted.current) return;
    autoJoinStarted.current = true;
    setMeetingCode(routeCode);

    const autoJoin = async () => {
      const normalizedCode = normalizeMeetingCode(routeCode);
      if (!isValidMeetingCode(normalizedCode)) {
        setError('Enter a valid six-character meeting code.');
        return;
      }
      try {
        setJoining(true);
        const meeting = await joinPersistentMeeting(normalizedCode);
        navigate(meetingRoomPath(meeting.code), { replace: true });
      } catch (joinError) {
        setError(joinError instanceof Error ? joinError.message : 'Unable to join this meeting.');
      } finally {
        setJoining(false);
      }
    };

    void autoJoin();
  }, [navigate, routeCode]);

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <button
            onClick={() => navigate('/')}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Join</p>
            <h1 className="text-xl font-semibold text-slate-900">Enter a meeting code</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto flex max-w-xl items-center justify-center px-6 py-16">
        <div className="w-full rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center justify-center gap-3 text-blue-600">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100">
              <Video className="h-6 w-6" />
            </div>
            <h2 className="text-2xl font-bold text-slate-900">Join a meeting</h2>
          </div>

          <form
            className="space-y-6"
            onSubmit={(event) => {
              event.preventDefault();
              void joinMeeting();
            }}
          >
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                value={meetingCode}
                onChange={(event) => setMeetingCode(event.target.value)}
                placeholder="LM-ABC123"
                autoComplete="off"
                className="input-field pl-10"
                disabled={joining}
              />
            </div>

            <button type="submit" disabled={joining} className="btn-primary w-full disabled:cursor-wait disabled:opacity-60">
              {joining ? 'Joining...' : 'Join now'}
            </button>
            {error && <p className="text-sm text-red-600" role="alert">{error}</p>}
            {joining && !error && (
              <p className="text-sm text-slate-500">Checking meeting access and creating your participant record...</p>
            )}
          </form>
        </div>
      </main>
    </div>
  );
}
