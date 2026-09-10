import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, ArrowRight, CalendarClock, ShieldCheck, Sparkles } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Auth() {
  const navigate = useNavigate();
  const { signIn, signUp } = useAuth();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    if (isSignUp) {
      const { error } = await signUp(email, password, fullName);
      if (error) setError(error.message || 'Failed to sign up');
      else navigate('/');
    } else {
      const { error } = await signIn(email, password);
      if (error) setError(error.message || 'Failed to sign in');
      else navigate('/');
    }
    setLoading(false);
  };

  const switchMode = (nextIsSignUp: boolean) => {
    setIsSignUp(nextIsSignUp);
    setError('');
    setFullName('');
    setEmail('');
    setPassword('');
  };

  return (
    <div className="min-h-screen bg-[radial-gradient(circle_at_top_left,_rgba(96,165,250,0.18),_transparent_25%),linear-gradient(135deg,_#f8fafc_0%,_#edf4ff_100%)] flex items-center justify-center p-4 sm:p-6">
      <div className="w-full max-w-5xl rounded-[2rem] border border-white/70 bg-white/70 p-4 shadow-[0_24px_80px_rgba(37,99,235,0.12)] backdrop-blur-xl sm:p-6 md:p-8">
        <div className="grid items-center gap-6 md:grid-cols-[1.1fr_0.9fr]">
          <div className="rounded-[1.5rem] bg-gradient-to-br from-slate-900 via-slate-800 to-[#1a73e8] p-6 text-white shadow-xl sm:p-8">
            <div className="mb-6 flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-white/10 ring-1 ring-white/20">
                <Video className="h-6 w-6" />
              </div>
              <div>
                <p className="text-xs uppercase tracking-[0.2em] text-blue-100">Meet smarter</p>
                <h1 className="text-2xl font-bold">LeTs<span className="text-blue-200">Meet</span></h1>
              </div>
            </div>

            <div className="mb-6">
              <p className="text-3xl font-semibold leading-tight">Create a better way to meet.</p>
              <p className="mt-3 max-w-md text-sm text-blue-100/90">
                Host focused video calls, plan meetings ahead of time, and keep everyone aligned in one place.
              </p>
            </div>

            <div className="space-y-3">
              {[
                { icon: CalendarClock, title: 'Schedule with ease', text: 'Set up meetings in seconds and keep everything organized.' },
                { icon: ShieldCheck, title: 'Trusted access', text: 'Secure sign-in with a clean, simple experience for every user.' },
                { icon: Sparkles, title: 'Built for focus', text: 'Fast workflows and a clear layout that keeps the next step obvious.' },
              ].map(({ icon: Icon, title, text }) => (
                <div key={title} className="flex items-start gap-3 rounded-2xl border border-white/10 bg-white/5 p-3">
                  <div className="mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl bg-blue-400/20 text-blue-100">
                    <Icon className="h-4 w-4" />
                  </div>
                  <div>
                    <p className="font-medium">{title}</p>
                    <p className="text-sm text-blue-100/80">{text}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-[1.5rem] border border-slate-200 bg-white p-5 shadow-sm sm:p-6">
            <div className="mb-6 inline-flex w-full rounded-full bg-slate-100 p-1">
              <button
                type="button"
                onClick={() => switchMode(false)}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${!isSignUp ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                Sign in
              </button>
              <button
                type="button"
                onClick={() => switchMode(true)}
                className={`flex-1 rounded-full px-4 py-2 text-sm font-semibold transition ${isSignUp ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500'}`}
              >
                Create account
              </button>
            </div>

            <div className="mb-6">
              <p className="text-sm font-medium uppercase tracking-[0.18em] text-slate-400">{isSignUp ? 'Join us' : 'Welcome back'}</p>
              <h2 className="mt-2 text-2xl font-bold text-slate-900">{isSignUp ? 'Create your account' : 'Sign in to LeTsMeet'}</h2>
            </div>

            <form onSubmit={handleSubmit} className="space-y-4">
              {isSignUp && (
                <div>
                  <label htmlFor="fullName" className="mb-2 block text-sm font-medium text-slate-700">Full name</label>
                  <input
                    id="fullName"
                    type="text"
                    value={fullName}
                    onChange={(e) => setFullName(e.target.value)}
                    placeholder="Enter your full name"
                    className="input-field"
                    autoComplete="name"
                    required
                  />
                </div>
              )}

              <div>
                <label htmlFor="email" className="mb-2 block text-sm font-medium text-slate-700">Email</label>
                <input
                  id="email"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="name@example.com"
                  className="input-field"
                  autoComplete="email"
                  required
                />
              </div>

              <div>
                <label htmlFor="password" className="mb-2 block text-sm font-medium text-slate-700">Password</label>
                <input
                  id="password"
                  type="password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder={isSignUp ? 'Create a password' : 'Enter your password'}
                  className="input-field"
                  autoComplete={isSignUp ? 'new-password' : 'current-password'}
                  required
                  minLength={6}
                />
              </div>

              {error && (
                <div className="rounded-xl border border-red-200 bg-red-50 p-3">
                  <p className="text-sm text-red-600">{error}</p>
                </div>
              )}

              <button type="submit" disabled={loading} className="btn-primary w-full gap-2 disabled:opacity-60">
                {loading ? 'Processing...' : <>{isSignUp ? 'Create Account' : 'Sign In'}<ArrowRight className="h-4 w-4" /></>}
              </button>
            </form>

            <div className="mt-6 text-center text-sm text-slate-500">
              {isSignUp ? 'Already have an account?' : "Don't have an account?"}{' '}
              <button
                type="button"
                onClick={() => switchMode(!isSignUp)}
                className="font-semibold text-[#1a73e8] transition hover:text-[#1c5fd6]"
              >
                {isSignUp ? 'Sign in' : 'Sign up'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
