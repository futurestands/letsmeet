import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Check, Clock3, Copy, Link2, Users, Video } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  findMeetingById,
  inviteToPersistentMeeting,
  listInvitesForMeeting,
  listParticipantsForMeeting,
  listScheduledMeetingsForUser,
  revokeMeetingInvite,
  transitionPersistentMeeting,
  updateScheduledMeeting,
  type MeetingInvite,
  type MeetingSummary,
  type ParticipantSummary,
  type ScheduledMeetingSummary,
} from '../lib/data-access';
import { isJoinableMeetingStatus, isValidMeetingTransition, meetingJoinPath } from '../lib/meeting-utils';
import {
  canManageScheduledMeeting,
  detectUserTimeZone,
  formatDurationMinutes,
  formatZonedDateTime,
  MEETING_DURATION_OPTIONS,
  parseInviteEmails,
  timeZonesForSelector,
} from '../lib/schedule-utils';

export default function MeetingDetails() {
  const navigate = useNavigate();
  const { meetingId } = useParams();
  const { user } = useAuth();
  const [meeting, setMeeting] = useState<MeetingSummary | null>(null);
  const [scheduled, setScheduled] = useState<ScheduledMeetingSummary | null>(null);
  const [participants, setParticipants] = useState<ParticipantSummary[]>([]);
  const [invites, setInvites] = useState<MeetingInvite[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [copied, setCopied] = useState(false);
  const [inviteText, setInviteText] = useState('');
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [timezone, setTimezone] = useState(detectUserTimeZone());
  const [durationMinutes, setDurationMinutes] = useState(30);

  const timeZones = useMemo(() => timeZonesForSelector(timezone), [timezone]);
  const viewerZone = detectUserTimeZone();

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
        const [people, inviteRows, scheduledRows] = await Promise.all([
          listParticipantsForMeeting(row.id),
          listInvitesForMeeting(row.id),
          listScheduledMeetingsForUser(),
        ]);
        if (!active) return;
        const scheduledRow = scheduledRows.find((item) => item.meeting_code === row.code) ?? null;
        setMeeting(row);
        setScheduled(scheduledRow);
        setParticipants(people);
        setInvites(inviteRows);
        setTitle(row.title);
        setDescription(row.description ?? scheduledRow?.description ?? '');
        setDate(scheduledRow?.date ?? '');
        setTime(scheduledRow?.time ?? '');
        setTimezone(scheduledRow?.timezone || viewerZone);
        setDurationMinutes(row.duration_minutes ?? scheduledRow?.duration_minutes ?? 30);
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
  }, [meetingId, viewerZone]);

  const cancelMeeting = async () => {
    if (!meeting || busy) return;
    setBusy(true);
    try {
      const next = await transitionPersistentMeeting(meeting.id, 'cancelled');
      setMeeting(next);
      setEditing(false);
    } catch (cancelError) {
      setError(cancelError instanceof Error ? cancelError.message : 'Unable to cancel this meeting.');
    } finally {
      setBusy(false);
    }
  };

  const saveEdits = async () => {
    if (!meeting || busy || !date || !time) return;
    setBusy(true);
    setError(null);
    try {
      const next = await updateScheduledMeeting({
        meetingId: meeting.id,
        title: title.trim(),
        date,
        time,
        timezone,
        description: description.trim() || null,
        durationMinutes,
      });
      setMeeting(next);
      setScheduled((current) => current ? {
        ...current,
        title: next.title,
        date,
        time,
        timezone,
        description: next.description,
        duration_minutes: next.duration_minutes,
        scheduled_for: next.scheduled_for,
      } : current);
      setEditing(false);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : 'Unable to update this meeting.');
    } finally {
      setBusy(false);
    }
  };

  const sendInvites = async () => {
    if (!meeting || busy) return;
    const emails = parseInviteEmails(inviteText);
    if (emails.length === 0) return;
    setBusy(true);
    setError(null);
    try {
      const created = await Promise.all(emails.map((email) => inviteToPersistentMeeting(meeting.id, email)));
      setInvites((current) => {
        const next = [...current];
        for (const invite of created) {
          const index = next.findIndex((item) => item.email === invite.email);
          if (index >= 0) next[index] = invite;
          else next.push(invite);
        }
        return next;
      });
      setInviteText('');
    } catch (inviteError) {
      setError(inviteError instanceof Error ? inviteError.message : 'Unable to save invitations.');
    } finally {
      setBusy(false);
    }
  };

  const revokeInvite = async (inviteId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const revoked = await revokeMeetingInvite(inviteId);
      setInvites((current) => current.map((item) => item.id === revoked.id ? revoked : item));
    } catch (revokeError) {
      setError(revokeError instanceof Error ? revokeError.message : 'Unable to revoke that invitation.');
    } finally {
      setBusy(false);
    }
  };

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Loading meeting details…</div>;
  }

  if (error && !meeting) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-50 px-6">
        <div className="max-w-md rounded-3xl border border-red-200 bg-white p-8 text-center">
          <h1 className="text-2xl font-semibold text-slate-900">Meeting unavailable</h1>
          <p className="mt-3 text-sm text-slate-600">{error}</p>
          <button onClick={() => navigate('/meetings')} className="btn-primary mt-6">Back to meetings</button>
        </div>
      </div>
    );
  }

  if (!meeting) return null;

  const organizer = participants.find((participant) => participant.user_id === meeting.host_id);
  const isHost = user?.id === meeting.host_id;
  const canManage = canManageScheduledMeeting({ userId: user?.id, hostId: meeting.host_id });
  const canJoin = isJoinableMeetingStatus(meeting.status);
  const canCancel = isHost && isValidMeetingTransition(meeting.status, 'cancelled');
  const canEdit = canManage && ['scheduled', 'waiting'].includes(meeting.status);
  const shareLink = typeof window === 'undefined'
    ? ''
    : `${window.location.origin}${window.location.pathname}#${meetingJoinPath(meeting.code)}`;

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white/90">
        <div className="mx-auto flex max-w-4xl items-center gap-4 px-4 py-5 sm:px-6">
          <button onClick={() => navigate('/meetings')} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white" aria-label="Back to meetings">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div className="min-w-0">
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Meeting details</p>
            <h1 className="truncate text-2xl font-bold text-slate-900">{meeting.title}</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl space-y-6 px-4 py-8 sm:px-6 sm:py-10">
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-blue-700">{meeting.status}</p>
              <p className="mt-3 flex items-center gap-2 text-sm text-slate-600"><Video className="h-4 w-4" /> {meeting.code}</p>
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                <CalendarDays className="h-4 w-4" />
                {meeting.scheduled_for
                  ? `${formatZonedDateTime(meeting.scheduled_for, viewerZone)} · organizer ${scheduled?.timezone || 'UTC'}`
                  : 'Not scheduled'}
              </p>
              <p className="mt-2 flex items-center gap-2 text-sm text-slate-600">
                <Clock3 className="h-4 w-4" />
                {formatDurationMinutes(meeting.duration_minutes)}
              </p>
              <p className="mt-2 text-sm text-slate-600">Organizer: {organizer?.user_name || 'Workspace host'}</p>
              {meeting.description && <p className="mt-4 max-w-2xl text-sm leading-6 text-slate-600">{meeting.description}</p>}
            </div>
            <div className="flex flex-wrap gap-3">
              {canJoin && (
                <button onClick={() => navigate(meetingJoinPath(meeting.code))} className="btn-primary">Join meeting</button>
              )}
              {canEdit && (
                <button onClick={() => setEditing((value) => !value)} className="btn-secondary">{editing ? 'Close editor' : 'Edit / reschedule'}</button>
              )}
              {canCancel && (
                <button onClick={() => void cancelMeeting()} disabled={busy} className="btn-secondary disabled:opacity-50">Cancel meeting</button>
              )}
            </div>
          </div>
        </section>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
          <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold text-slate-900"><Link2 className="h-5 w-5" /> Invitation</h2>
          <div className="flex flex-col gap-3 sm:flex-row">
            <input readOnly value={shareLink} className="input-field min-w-0 flex-1" />
            <button
              onClick={() => {
                void navigator.clipboard.writeText(shareLink).then(() => setCopied(true));
              }}
              className="btn-secondary"
            >
              {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy link</>}
            </button>
          </div>
          {canManage && isJoinableMeetingStatus(meeting.status) && (
            <div className="mt-4 flex flex-col gap-3 sm:flex-row">
              <input
                value={inviteText}
                onChange={(event) => setInviteText(event.target.value)}
                className="input-field min-w-0 flex-1"
                placeholder="Add emails, separated by commas"
              />
              <button onClick={() => void sendInvites()} disabled={busy} className="btn-primary disabled:opacity-50">Add invites</button>
            </div>
          )}
          <ul className="mt-4 divide-y divide-slate-100">
            {invites.length === 0 && <li className="py-3 text-sm text-slate-500">No invitation records yet. Share the link or add emails.</li>}
            {invites.map((invite) => (
              <li key={invite.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>
                  <strong className="block text-slate-900">{invite.email}</strong>
                  <span className="text-slate-500">{invite.status}</span>
                </span>
                {canManage && invite.status !== 'revoked' && (
                  <button onClick={() => void revokeInvite(invite.id)} className="text-sm font-semibold text-red-600">Revoke</button>
                )}
              </li>
            ))}
          </ul>
        </section>

        {editing && canEdit && (
          <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <h2 className="mb-4 text-lg font-semibold text-slate-900">Reschedule</h2>
            <div className="space-y-4">
              <input value={title} onChange={(event) => setTitle(event.target.value)} className="input-field" aria-label="Title" />
              <textarea value={description} onChange={(event) => setDescription(event.target.value)} className="input-field min-h-24" aria-label="Description" />
              <div className="grid gap-4 sm:grid-cols-2">
                <input type="date" value={date} onChange={(event) => setDate(event.target.value)} className="input-field" aria-label="Date" />
                <input type="time" value={time} onChange={(event) => setTime(event.target.value)} className="input-field" aria-label="Time" />
                <select value={timezone} onChange={(event) => setTimezone(event.target.value)} className="input-field" aria-label="Timezone">
                  {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
                <select value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} className="input-field" aria-label="Duration">
                  {MEETING_DURATION_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{formatDurationMinutes(minutes)}</option>)}
                </select>
              </div>
              <button onClick={() => void saveEdits()} disabled={busy} className="btn-primary disabled:opacity-50">Save changes</button>
            </div>
          </section>
        )}

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
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
