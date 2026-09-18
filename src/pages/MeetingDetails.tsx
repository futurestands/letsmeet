import { useEffect, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Clock3, Users, Video } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  findMeetingById,
  listParticipantsForMeeting,
  transitionPersistentMeeting,
  type MeetingSummary,
  type ParticipantSummary,
} from '../lib/data-access';
import { isJoinableMeetingStatus, isValidMeetingTransition, meetingJoinPath } from '../lib/meeting-utils';

export default function MeetingDetails() {
  const navigate = useNavigate();
  const { meetingId } = useParams();
  const { user } = useAuth();
  const [meeting, setMeeting] = useState<MeetingSummary | null>(null);
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!meetingId) {
        setError('Meeting not found.');
        setLoading(false);
        return;
      }
      try {
        const row = await findMeetingById(meetingId);
        if (!row) throw new Error('Meeting not found or you do not have access to it.');
        const people = await listParticipantsForMeeting(row.id);
        if (!active) return;
        setMeeting(row);
        setParticipants(people);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load this meeting.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    return () => {
      active = false;
    };
  }, [meetingId]);

  const cancelMeeting = async () => {
    if (!meeting || busy) return;
    setBusy(true);
    try {
      const next = await transitionPersistentMeeting(meeting.id, 'cancelled');
      setMeeting(next);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Unable to cancel this meeting.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Loading meeting details...</div>;
  }

  if (error || !meeting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md rounded-3xl border border-red-200 bg-white p-8 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Meeting unavailable</h1>
          <p className="mt-3 text-sm text-slate-600">{error ?? 'This meeting could not be found.'}</p>
          <button onClick={() => navigate('/meetings')} className="btn-primary mt-6">Back to meetings</button>
        </div>
      </div>
    );
  }

  const isHost = user?.id === meeting.host_id;
  const canJoin = isJoinableMeetingStatus(meeting.status);
  const canCancel = isHost && isValidMeetingTransition(meeting.status, 'cancelled');

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white/90">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-6 py-5">
          <button onClick={() => navigate('/meetings')} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white" aria-label="Back to meetings">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Meeting details</p>
            <h1 className="text-2xl font-bold text-slate-900">{meeting.title}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-6 py-10">
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">{meeting.status}</p>
              <p className="mt-3 flex items-center gap-2 text-sm text-slate-600"><Video className="h-4 w-4" /> {meeting.code}</p>
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><CalendarDays className="h-4 w-4" /> {meeting.scheduled_for ? new Date(meeting.scheduled_for).toLocaleString() : 'Not scheduled'}</p>
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-600"><Clock3 className="h-4 w-4" /> Created {meeting.created_at ? new Date(meeting.created_at).toLocaleString() : 'recently'}</p>
            </div>
            <div className="flex gap-3">
              {canJoin && (
                <button onClick={() => navigate(meetingJoinPath(meeting.code))} className="btn-primary">Join meeting</button>
              )}
              {canCancel && (
                <button onClick={() => void cancelMeeting()} disabled={busy} className="btn-secondary disabled:opacity-50">Cancel</button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900"><Users className="h-5 w-5" /> Participants</h2>
          {participants.length === 0 ? (
            <p className="text-sm text-slate-500">No participant history is available yet.</p>
          ) : (
            <ul className="divide-y divide-slate-100">
              {participants.map((participant) => (
                <li key={participant.id} className="flex items-center justify-between py-3 text-sm">
                  <span>
                    <strong className="block text-slate-900">{participant.user_name}</strong>
                    <span className="text-slate-500">{participant.role}</span>
                  </span>
                  <span className="text-slate-500">{participant.status}</span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </main>
    </div>
  );
}
