import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, CalendarDays, Clock3, Video } from 'lucide-react';

export default function ScheduleMeeting() {
  const navigate = useNavigate();
  const [date, setDate] = useState('2026-09-12');
  const [time, setTime] = useState('09:00');
  const [title, setTitle] = useState('Team sync');

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
                  {date}
                </div>
                <div className="flex items-center gap-2">
                  <Clock3 className="h-4 w-4 text-blue-600" />
                  {time}
                </div>
              </div>
            </div>

            <div className="flex justify-end gap-3">
              <button onClick={() => navigate('/')} className="btn-secondary">
                Cancel
              </button>
              <button onClick={() => navigate('/')} className="btn-primary">
                Save event
              </button>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}
