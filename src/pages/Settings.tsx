import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bell, Lock, Moon, Shield, UserCog } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();

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
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Settings</p>
            <h1 className="text-xl font-semibold text-slate-900">Account preferences</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-4xl px-6 py-10">
        <div className="rounded-3xl border border-slate-200 bg-white p-8 shadow-sm">
          <div className="mb-8 flex items-center gap-4">
            <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gradient-to-br from-blue-500 to-indigo-600 text-xl font-bold text-white">
              {user?.full_name?.slice(0, 2).toUpperCase() ?? 'US'}
            </div>
            <div>
              <h2 className="text-2xl font-bold text-slate-900">{user?.full_name ?? 'User profile'}</h2>
              <p className="text-slate-500">{user?.email ?? 'No email available'}</p>
            </div>
          </div>

          <div className="grid gap-4 md:grid-cols-2">
            {[
              { icon: UserCog, title: 'Profile', description: 'Update your display name and contact information.' },
              { icon: Bell, title: 'Notifications', description: 'Choose when you receive meeting reminders and updates.' },
              { icon: Moon, title: 'Appearance', description: 'Switch between light and dark themes.' },
              { icon: Lock, title: 'Security', description: 'Manage password and device access settings.' },
              { icon: Shield, title: 'Privacy', description: 'Review your data controls and visibility preferences.' },
            ].map(({ icon: Icon, title, description }) => (
              <div key={title} className="rounded-2xl border border-slate-200 bg-slate-50 p-5">
                <div className="mb-3 flex h-11 w-11 items-center justify-center rounded-xl bg-white text-blue-600 shadow-sm">
                  <Icon className="h-5 w-5" />
                </div>
                <h3 className="text-lg font-semibold text-slate-900">{title}</h3>
                <p className="mt-2 text-sm text-slate-600">{description}</p>
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
}
