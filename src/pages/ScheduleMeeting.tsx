import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Check, Clock3, Copy, Link2, Video } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { getUserOrganizationContext, schedulePersistentMeeting } from '../lib/data-access';
import { meetingJoinPath } from '../lib/meeting-utils';

export default function ScheduleMeeting() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [date, setDate] = useState('');
  const [time, setTime] = useState('');
  const [title, setTitle] = useState('');
  const [meetingCode, setMeetingCode] = useState('');
  const [shareLink, setShareLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const canSave = title.trim().length > 0 && date && time;

  const handleSave = async () => {
    if (!canSave || !user?.id) return;

    try {
      setSaving(true);
      setSaveError(null);

      const context = await getUserOrganizationContext(user.id);
      const meetingEntry = await schedulePersistentMeeting({
        title: title.trim(),
        date,
        time,
        timezone: Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC',
        workspaceId: context?.workspace_id,
      });
      const nextCode = meetingEntry.meeting_code ?? '';

      const generatedLink = `${window.location.origin}${window.location.pathname}#${meetingJoinPath(nextCode)}`;

      setMeetingCode(nextCode);
      setShareLink(generatedLink);
      setCopied(false);
    } catch (error) {
      console.error('Failed to save scheduled meeting', error);
      setSaveError(error instanceof Error ? error.message : 'Failed to save this meeting.');
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
      <header className="border-b border-slate-200 bg-white/80 backdrop-blur-sm sticky top-0 z-20">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-6 py-4">
          <button
            onClick={() => navigate('/')}
            className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-700 transition hover:border-slate-300 hover:text-slate-900"
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

      <main className="mx-auto max-w-3xl px-6 py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-6 flex items-center gap-3 text-blue-600">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-blue-100">
              <CalendarDays className="h-6 w-6" />
            </div>
            <div>
              <p className="text-sm text-slate-500">New event</p>
              <h2 className="text-2xl font-bold text-slate-900">Schedule a video call</h2>
            </div>
          </div>

          <div className="space-y-6">
            <div>
              <label className="mb-2 block text-sm font-medium text-slate-700">Title</label>
              <input
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                className="input-field"
                placeholder="Meeting title"
              />
            </div>

            <div className="grid gap-6 md:grid-cols-2">
              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Date</label>
                <input
                  type="date"
                  value={date}
                  onChange={(event) => setDate(event.target.value)}
                  className="input-field"
                />
              </div>

              <div>
                <label className="mb-2 block text-sm font-medium text-slate-700">Time</label>
                <input
                  type="time"
                  value={time}
                  onChange={(event) => setTime(event.target.value)}
                  className="input-field"
                />
              </div>
            </div>

            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
              <p className="mb-2 text-sm font-medium text-slate-700">Summary</p>
              <div className="space-y-2 text-sm text-slate-600">
                <div className="flex items-center gap-2">
                  <Video className="h-4 w-4 text-blue-600" />
                  {title || 'Untitled meeting'}
                </div>
                <div className="flex items-center gap-2">
                  <CalendarDays className="h-4 w-4 text-blue-600" />
                  {date || 'Choose a date'}
                </div>
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-blue-600" />
                  {time || 'Choose a time'}
                </div>
              </div>
            </div>

            {saveError && (
              <div className="rounded-2xl border border-red-200 bg-red-50 p-3 text-sm text-red-700">
                {saveError}
              </div>
            )}

            {shareLink && (
              <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4">
                <p className="mb-2 text-sm font-medium text-emerald-700">Shareable meeting link</p>
                <div className="flex items-center gap-3 rounded-xl border border-emerald-200 bg-white px-3 py-2">
                  <Link2 className="h-4 w-4 text-emerald-600" />
                  <input
                    readOnly
                    value={shareLink}
                    className="flex-1 border-0 bg-transparent text-sm text-slate-700 outline-none"
                  />
                </div>
                <div className="mt-4 flex flex-wrap justify-end gap-3">
                  <button onClick={handleCopyLink} className="btn-secondary">
                    {copied ? (
                      <>
                        <Check className="h-4 w-4" /> Copied
                      </>
                    ) : (
                      <>
                        <Copy className="h-4 w-4" /> Copy link
                      </>
                    )}
                  </button>
                  <button
                    onClick={() => navigate(meetingJoinPath(meetingCode))}
                    className="btn-primary"
                  >
                    Open meeting
                  </button>
                </div>
              </div>
            )}

            <div className="flex justify-end gap-3">
              <button onClick={() => navigate('/')} className="btn-secondary">
                Cancel
              </button>
              <button onClick={handleSave} disabled={!canSave || saving} className="btn-primary disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? 'Saving...' : 'Save event'}
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
