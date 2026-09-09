import { useMemo } from 'react';
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

export default function MeetingRoom() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const meetingCode = searchParams.get('code') ?? 'LETSMEET';
  const mode = searchParams.get('mode') ?? 'join';

  const participants = useMemo(
    () => [
      { name: 'You', accent: 'from-blue-500 to-indigo-500', active: true },
      { name: 'Maya', accent: 'from-emerald-500 to-teal-500', active: false },
      { name: 'Noah', accent: 'from-violet-500 to-fuchsia-500', active: false },
      { name: 'Jules', accent: 'from-orange-500 to-amber-500', active: false },
    ],
    [],
  );

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
            <div className="flex items-center gap-2 rounded-full border border-emerald-500/30 bg-emerald-500/10 px-3 py-1.5">
              <span className="h-2 w-2 rounded-full bg-emerald-400" />
              Recording
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
            <p className="text-xl font-semibold">Everyone is here</p>
          </div>
          <button className="rounded-full bg-blue-600 px-4 py-2 text-sm font-medium text-white transition hover:bg-blue-500">
            Invite
          </button>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.6fr_0.7fr]">
          <section className="rounded-3xl border border-slate-800 bg-slate-900 p-4 shadow-2xl shadow-slate-950/50">
            <div className="grid gap-4 md:grid-cols-2">
              {participants.map((participant) => (
                <div
                  key={participant.name}
                  className={`relative overflow-hidden rounded-2xl border border-slate-700 bg-gradient-to-br ${participant.accent} p-[1px]`}
                >
                  <div className="flex h-56 flex-col justify-between rounded-2xl bg-slate-950/90 p-4">
                    <div className="flex items-center justify-between">
                      <span className="rounded-full bg-slate-900/80 px-2 py-1 text-xs text-slate-300">
                        {participant.active ? 'Host' : 'Participant'}
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
                        <p className="text-sm text-slate-400">Video on</p>
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
                  <li key={participant.name} className="flex items-center justify-between rounded-xl bg-slate-800 px-3 py-2">
                    <span>{participant.name}</span>
                    <span className="text-slate-400">{participant.active ? 'Speaking' : 'Listening'}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="rounded-3xl border border-slate-800 bg-slate-900 p-5">
              <h2 className="mb-4 flex items-center gap-2 text-lg font-semibold">
                <Sparkles className="h-5 w-5 text-violet-400" /> Meeting notes
              </h2>
              <div className="space-y-3 text-sm text-slate-300">
                <p>• Review the launch checklist before the client demo.</p>
                <p>• Share the product roadmap with the stakeholders.</p>
                <p>• Capture a summary of decisions made in the meeting.</p>
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
