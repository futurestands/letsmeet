import { useEffect, useMemo, useState } from 'react';
import { CalendarDays, ChevronRight, Clock3, Video } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import {
  getUserOrganizationContext,
  listMeetingsForUser,
  listMyParticipations,
  listScheduledMeetingsForUser,
  type MeetingSummary,
  type ScheduledMeetingSummary,
  type UserOrganizationContext,
} from '../lib/data-access';
import {
  destinationForMeeting,
  isActiveMeetingStatus,
  isJoinableMeetingStatus,
  isPastMeetingStatus,
  meetingDetailsPath,
  type MeetingHistoryFilter,
} from '../lib/meeting-utils';
import { detectUserTimeZone, formatZonedDateTime } from '../lib/schedule-utils';

const filters: { id: MeetingHistoryFilter; label: string }[] = [
  { id: 'upcoming', label: 'Upcoming' },
  { id: 'active', label: 'Active' },
  { id: 'past', label: 'Past' },
  { id: 'hosted', label: 'Hosted' },
  { id: 'joined', label: 'Joined' },
];

export default function Meetings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [scheduled, setScheduled] = useState<ScheduledMeetingSummary[]>([]);
  const [joinedIds, setJoinedIds] = useState<Set<string>>(new Set());
  const [context, setContext] = useState<UserOrganizationContext | null>(null);
  const [filter, setFilter] = useState<MeetingHistoryFilter>('upcoming');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    Promise.all([
      listMeetingsForUser(),
      listScheduledMeetingsForUser(),
      listMyParticipations(),
      user?.id ? getUserOrganizationContext(user.id) : Promise.resolve(null),
    ])
      .then(([meetingRows, scheduledRows, participationRows, tenant]) => {
        if (!active) return;
        setMeetings(meetingRows);
        setScheduled(scheduledRows);
        setJoinedIds(new Set(participationRows.map((row) => row.meeting_id)));
        setContext(tenant);
      })
      .catch(() => {
        if (active) setError('Unable to load meeting history right now.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [user?.id]);

  const visibleMeetings = useMemo(() => {
    const byFilter = meetings.filter((meeting) => {
      if (filter === 'upcoming') return meeting.status === 'scheduled';
      if (filter === 'active') return isActiveMeetingStatus(meeting.status);
      if (filter === 'past') return isPastMeetingStatus(meeting.status);
      if (filter === 'hosted') return meeting.host_id === user?.id;
      return joinedIds.has(meeting.id);
    });
    return byFilter;
  }, [filter, joinedIds, meetings, user?.id]);

  const upcomingScheduled = scheduled.filter((item) => item.status === 'scheduled' || item.status === 'waiting');

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="border-b border-slate-200 bg-white/90">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-5">
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">
              {context ? `${context.organization_name} · ${context.workspace_name ?? 'Default workspace'}` : 'Workspace'}
            </p>
            <h1 className="text-2xl font-bold text-slate-900">Meetings</h1>
          </div>
          <div className="flex gap-3">
            <button onClick={() => navigate('/schedule')} className="btn-secondary">Schedule</button>
            <button onClick={() => navigate('/')} className="btn-secondary">Back home</button>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-6xl space-y-8 px-6 py-10">
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700" role="alert">{error}</div>}

        <div className="flex flex-wrap gap-2">
          {filters.map((item) => (
            <button
              key={item.id}
              onClick={() => setFilter(item.id)}
              className={`rounded-full px-4 py-2 text-sm font-semibold ${filter === item.id ? 'bg-blue-600 text-white' : 'border border-slate-200 bg-white text-slate-600'}`}
            >
              {item.label}
            </button>
          ))}
        </div>

        {loading ? (
          <div className="rounded-3xl border border-slate-200 bg-white p-8 text-slate-500">Loading meeting history...</div>
        ) : (
          <>
            {filter === 'upcoming' && (
              <section>
                <h2 className="mb-4 text-xl font-semibold text-slate-900">Scheduled</h2>
                {upcomingScheduled.length === 0 ? (
                  <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-sm text-slate-500">No upcoming meetings yet.</div>
                ) : (
                  <div className="grid gap-4 md:grid-cols-2">
                    {upcomingScheduled.map((item) => (
                      <button
                        key={item.id}
                        onClick={() => navigate(meetingDetailsPath(item.id))}
                        className="flex items-center justify-between rounded-2xl border border-slate-200 bg-white p-5 text-left shadow-sm transition hover:border-blue-300"
                      >
                        <span>
                          <span className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-500">
                            <CalendarDays className="h-4 w-4" />
                            {item.scheduled_for
                              ? formatZonedDateTime(item.scheduled_for, detectUserTimeZone())
                              : `${item.date} · ${item.time} ${item.timezone}`}
                          </span>
                          <strong className="mt-2 block text-lg text-slate-900">{item.title}</strong>
                          <span className="mt-1 block text-sm text-blue-700">{item.meeting_code}</span>
                        </span>
                        <ChevronRight className="h-5 w-5 text-slate-400" />
                      </button>
                    ))}
                  </div>
                )}
              </section>
            )}

            <section>
              <h2 className="mb-4 text-xl font-semibold text-slate-900">
                {filters.find((item) => item.id === filter)?.label} meetings
              </h2>
              {visibleMeetings.length === 0 ? (
                <div className="rounded-3xl border border-dashed border-slate-300 p-8 text-sm text-slate-500">No meetings in this view.</div>
              ) : (
                <div className="overflow-hidden rounded-3xl border border-slate-200 bg-white shadow-sm">
                  {visibleMeetings.map((item) => (
                    <button
                      key={item.id}
                      onClick={() => navigate(destinationForMeeting(item))}
                      className="flex w-full items-center justify-between border-b border-slate-100 p-5 text-left last:border-0 hover:bg-slate-50"
                    >
                      <span>
                        <span className="flex items-center gap-2 text-xs uppercase tracking-[0.12em] text-slate-500">
                          <Video className="h-4 w-4" />
                          {item.status}
                          <Clock3 className="ml-2 h-4 w-4" />
                          {item.created_at ? new Date(item.created_at).toLocaleString() : 'Recently'}
                        </span>
                        <strong className="mt-2 block text-lg text-slate-900">{item.title}</strong>
                        <span className="mt-1 block text-sm text-blue-700">{item.code}</span>
                      </span>
                      <span className="text-sm font-semibold text-blue-700">
                        {isJoinableMeetingStatus(item.status) ? 'Join' : 'View'}
                      </span>
                    </button>
                  ))}
                </div>
              )}
            </section>
          </>
        )}
      </main>
    </div>
  );
}
