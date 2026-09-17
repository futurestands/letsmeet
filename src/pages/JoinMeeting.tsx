import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Link2, Video } from 'lucide-react';
import { normalizeMeetingCode } from '../lib/meeting-utils';

export default function JoinMeeting() {
  const navigate = useNavigate();
  const [meetingCode, setMeetingCode] = useState('');

  const joinMeeting = () => {
    const normalizedCode = normalizeMeetingCode(meetingCode);
    if (normalizedCode !== 'LM-INVALID') {
      navigate(`/meet?code=${encodeURIComponent(normalizedCode)}`);
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

          <div className="space-y-6">
            <div className="relative">
              <Link2 className="absolute left-3 top-1/2 -translate-y-1/2 h-5 w-5 text-slate-400" />
              <input
                type="text"
                value={meetingCode}
                onChange={(event) => setMeetingCode(event.target.value)}
                placeholder="Meeting code"
                className="input-field pl-10"
              />
            </div>

            <button onClick={joinMeeting} className="btn-primary w-full">
              Join now
            </button>
          </div>
        </div>
      </main>
    </div>
  );
}
