import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Check, Clock3, Copy, Globe, Link2, Video } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserOrganizationContext, findMeetingByCode, inviteToPersistentMeeting, schedulePersistentMeeting } from '../lib/data-access';
import { meetingJoinPath } from '../lib/meeting-utils';
import {
  detectUserTimeZone,
  formatDurationMinutes,
  formatZonedDateTime,
  MEETING_DURATION_OPTIONS,
  parseInviteEmails,
  timeZonesForSelector,
  wallTimeInTimeZoneToUtc,
} from '../lib/schedule-utils';

export default function ScheduleMeeting() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const defaultZone = detectUserTimeZone();
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [timezone, setTimezone] = useState(defaultZone);
  const [durationMinutes, setDurationMinutes] = useState(30);
  const [inviteText, setInviteText] = useState('');
  const [meetingCode, setMeetingCode] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [scheduledFor, setScheduledFor] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [inviteNote, setInviteNote] = useState<string | null>(null);

  const timeZones = useMemo(() => timeZonesForSelector(timezone), [timezone]);
  const previewInstant = useMemo(() => {
    try {
      if (!date || !time) return null;
      return wallTimeInTimeZoneToUtc(date, time, timezone);
    } catch {
      return null;
    }
  }, [date, time, timezone]);

  const canSave = title.trim().length > 0 && date && time && !saving;

  const handleSave = async () => {
    if (!canSave || !user?.id) return;
    try {
      setSaving(true);
      setSaveError(null);
      setInviteNote(null);
      const context = await getUserOrganizationContext(user.id);
      const meetingEntry = await schedulePersistentMeeting({
        title: title.trim(),
        date,
        time,
        timezone,
        workspaceId: context?.workspace_id,
        description: description.trim() || null,
        durationMinutes,
      });
      const nextCode = meetingEntry.meeting_code ?? '';
      const emails = parseInviteEmails(inviteText);
      if (nextCode && emails.length > 0) {
        const meeting = await findMeetingByCode(nextCode);
        if (meeting) {
          const results = await Promise.allSettled(emails.map((email) => inviteToPersistentMeeting(meeting.id, email)));
          const failed = results.filter((result) => result.status === 'rejected').length;
          setInviteNote(failed === 0
            ? `${emails.length} invitation${emails.length === 1 ? '' : 's'} queued. Email delivery waits on a configured provider.`
            : `${emails.length - failed} invitation${emails.length - failed === 1 ? '' : 's'} queued. ${failed} could not be saved.`);
        }
      }
      setMeetingCode(nextCode);
      setScheduledFor(meetingEntry.scheduled_for ?? previewInstant?.toISOString() ?? null);
      setShareLink(`${window.location.origin}${window.location.pathname}#${meetingJoinPath(nextCode)}`);
      setCopied(false);
    } catch (error: unknown) {
      // Improve error reporting to show the real message from Supabase/Postgres
      const postgrestError = error as { message?: string; error_description?: string };
      const message = postgrestError?.message || postgrestError?.error_description || (error instanceof Error ? error.message : null);
      setSaveError(message || 'Failed to save this meeting.');
    } finally {
      setSaving(false);
    }
  };

  const handleCopyLink = async () => {
    if (!shareLink) return;
    try {
      await navigator.clipboard.writeText(shareLink);
      setCopied(true);
    } catch {
      setCopied(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/80 backdrop-blur-sm">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6">
          <button
            onClick={() => navigate('/')}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300"
            aria-label="Back to home"
          >
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Schedule</p>
            <h1 className="text-xl font-semibold text-slate-900">Plan a meeting</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-4 py-8 sm:px-6 sm:py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
          <div className="mb-6 flex items-center gap-3 text-blue-600">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100">
              <CalendarDays className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500">Workspace event</p>
              <h2 className="text-2xl font-bold text-slate-900">Schedule a video call</h2>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="meeting-title">Title</label>
              <input id="meeting-title" value={title} onChange={(event) => setTitle(event.target.value)} className="input-field" placeholder="Weekly product review" />
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="meeting-description">Description</label>
              <textarea id="meeting-description" value={description} onChange={(event) => setDescription(event.target.value)} className="input-field min-h-24" placeholder="Optional agenda or context" />
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="meeting-date">Date</label>
                <input id="meeting-date" type="date" value={date} onChange={(event) => setDate(event.target.value)} className="input-field" />
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="meeting-time">Start time</label>
                <input id="meeting-time" type="time" value={time} onChange={(event) => setTime(event.target.value)} className="input-field" />
              </div>
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="meeting-timezone">Timezone</label>
                <select id="meeting-timezone" value={timezone} onChange={(event) => setTimezone(event.target.value)} className="input-field">
                  {timeZones.map((zone) => <option key={zone} value={zone}>{zone}</option>)}
                </select>
              </div>
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="meeting-duration">Duration</label>
                <select id="meeting-duration" value={durationMinutes} onChange={(event) => setDurationMinutes(Number(event.target.value))} className="input-field">
                  {MEETING_DURATION_OPTIONS.map((minutes) => <option key={minutes} value={minutes}>{formatDurationMinutes(minutes)}</option>)}
                </select>
              </div>
            </div>
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700" htmlFor="meeting-invites">Invite people</label>
              <textarea id="meeting-invites" value={inviteText} onChange={(event) => setInviteText(event.target.value)} className="input-field min-h-20" placeholder="colleague@company.com, teammate@company.com" />
              <p className="mt-2 text-xs text-slate-500">Invitations are stored in your workspace. Email sending stays pending until a notification provider is configured on the server.</p>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-2 text-sm font-medium text-slate-700">Summary</p>
              <div className="space-y-2 text-sm text-slate-600">
                <div className="flex items-center gap-2"><Video className="h-4 w-4 text-blue-600" />{title || 'Untitled meeting'}</div>
                <div className="flex items-center gap-2"><CalendarDays className="h-4 w-4 text-blue-600" />{previewInstant ? formatZonedDateTime(previewInstant, timezone) : 'Choose a date and time'}</div>
                <div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-blue-600" />{formatDurationMinutes(durationMinutes)}</div>
                <div className="flex items-center gap-2"><Globe className="h-4 w-4 text-blue-600" />Stored as UTC · shown in {timezone}</div>
              </div>
            </div>

            {saveError && <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">{saveError}</div>}
            {inviteNote && <div className="rounded-2xl border border-blue-200 bg-blue-50 p-3 text-sm text-blue-800">{inviteNote}</div>}

            {shareLink && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="mb-2 text-sm font-medium text-emerald-700">Invitation link</p>
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-white px-3 py-2">
                  <Link2 className="h-4 w-4 shrink-0 text-emerald-600" />
                  <input readOnly value={shareLink} className="min-w-0 flex-1 border-0 bg-transparent text-sm text-slate-700 outline-none" />
                </div>
                {scheduledFor && <p className="mt-3 text-sm text-emerald-800">{formatZonedDateTime(scheduledFor, detectUserTimeZone())}</p>}
                <div className="mt-4 flex flex-wrap justify-end gap-3">
                  <button onClick={() => void handleCopyLink()} className="btn-secondary">
                    {copied ? <><Check className="h-4 w-4" /> Copied</> : <><Copy className="h-4 w-4" /> Copy link</>}
                  </button>
                  <button onClick={() => navigate(meetingJoinPath(meetingCode))} className="btn-primary">Open meeting</button>
                </div>
              </div>
            )}

            <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
              <button onClick={() => navigate('/')} className="btn-secondary">Cancel</button>
              <button onClick={() => void handleSave()} disabled={!canSave} className="btn-primary disabled:cursor-not-allowed disabled:opacity-50">
                {saving ? 'Saving…' : 'Save event'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
