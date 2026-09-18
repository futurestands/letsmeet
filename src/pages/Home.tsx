import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Video, Calendar, Users, Shield, Zap, MessageSquare, Monitor, Hand, Smile, Play, Mic, Camera, LogOut } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { createPersistentMeeting, getUserOrganizationContext, listMeetingsForUser, listScheduledMeetingsForUser, type UserOrganizationContext } from '../lib/data-access';
import { destinationForMeeting, meetingJoinPath, normalizeMeetingCode } from '../lib/meeting-utils';

interface ScheduledMeetingSummary {
  title: string;
  date: string;
  time: string;
  meeting_code?: string | null;
}

export default function Home() {
  const navigate = useNavigate();
  const { user, signOut } = useAuth();
  const [meetingCode, setMeetingCode] = useState('');
  const [showJoinModal, setShowJoinModal] = useState(false);
  const [scheduledMeetings, setScheduledMeetings] = useState<ScheduledMeetingSummary[]>([]);
  const [recentMeetings, setRecentMeetings] = useState<{ id: string; code: string; title: string; status?: string | null }[]>([]);
  const [workspaceId, setWorkspaceId] = useState<string | null>(null);
  const [tenant, setTenant] = useState<UserOrganizationContext | null>(null);
  const [loadingMeetings, setLoadingMeetings] = useState(true);
  const [actionError, setActionError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let active = true;

    const loadMeetings = async () => {
      if (!user?.id) {
        if (active) {
          setScheduledMeetings([]);
          setLoadingMeetings(false);
        }
        return;
      }

      try {
        const [rows, meetings, context] = await Promise.all([
          listScheduledMeetingsForUser(),
          listMeetingsForUser(),
          getUserOrganizationContext(user.id),
        ]);
        if (!active) return;

        setWorkspaceId(context?.workspace_id ?? null);
        setTenant(context);
        setRecentMeetings(meetings.slice(0, 6));

        setScheduledMeetings(
          rows.map((row) => ({
            title: row.title,
            date: row.date,
            time: row.time,
            meeting_code: row.meeting_code ?? undefined,
          })),
        );
      } catch (error) {
        console.error('Failed to load scheduled meetings', error);
        if (active) {
          setScheduledMeetings([]);
        }
      } finally {
        if (active) {
          setLoadingMeetings(false);
        }
      }
    };

    void loadMeetings();

    return () => {
      active = false;
    };
  }, [user?.id]);

  const start = async () => {
    if (!user?.id || starting) return;
    try {
      setStarting(true);
      setActionError(null);
      const meeting = await createPersistentMeeting('New meeting', workspaceId);
      navigate(meetingJoinPath(meeting.code));
    } catch (error) {
      setActionError(error instanceof Error ? error.message : 'Unable to start the meeting.');
    } finally {
      setStarting(false);
    }
  };

  const join = () => {
    const normalizedCode = normalizeMeetingCode(meetingCode);
    if (normalizedCode !== 'LM-INVALID') {
      navigate(meetingJoinPath(normalizedCode));
    }
  };
  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-50 via-white to-blue-50">
      <nav className="fixed top-0 left-0 right-0 z-50 glass-effect border-b border-gray-100">
        <div className="max-w-7xl mx-auto px-6 h-16 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-9 h-9 bg-gradient-to-br from-[#1a73e8] to-[#6c63ff] rounded-xl flex items-center justify-center"><Video className="w-5 h-5 text-white" /></div>
            <span className="text-xl font-bold text-gray-900">LeTs<span className="text-[#1a73e8]">Meet</span></span>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => setShowJoinModal(true)} className="btn-secondary text-sm">Join</button>
            <button onClick={start} disabled={starting} className="btn-primary text-sm disabled:cursor-wait disabled:opacity-60">{starting ? 'Creating...' : 'Start Meeting'}</button>
            {user && (<div className="relative group"><button className="w-9 h-9 bg-[#1a73e8] rounded-full flex items-center justify-center text-white font-semibold text-sm">{user.full_name?.charAt(0).toUpperCase()||'U'}</button><div className="absolute right-0 top-full mt-2 bg-white rounded-xl shadow-lg border border-gray-100 py-2 w-48 opacity-0 invisible group-hover:opacity-100 group-hover:visible transition-all"><div className="px-4 py-2 border-b border-gray-100"><p className="text-sm font-medium truncate">{user.full_name}</p><p className="text-xs text-gray-500 truncate">{user.email}</p></div><button onClick={() => navigate('/settings')} className="w-full px-4 py-2 text-left text-sm hover:bg-gray-50">Settings</button><button onClick={signOut} className="w-full px-4 py-2 text-left text-sm text-red-600 hover:bg-red-50 flex items-center gap-2"><LogOut className="w-4 h-4"/>Sign Out</button></div></div>)}
          </div>
        </div>
      </nav>
      <section className="pt-32 pb-20 px-6">
        <div className="max-w-7xl mx-auto grid lg:grid-cols-2 gap-16 items-center">
          <div className="space-y-8">
            <div className="inline-flex items-center gap-2 bg-[#e8f0fe] text-[#1a73e8] px-4 py-2 rounded-full text-sm font-medium"><Zap className="w-4 h-4"/>Built for team-first collaboration</div>
            <h1 className="text-5xl lg:text-6xl font-bold text-gray-900 leading-tight">Video meetings, <span className="text-transparent bg-clip-text bg-gradient-to-r from-[#1a73e8] to-[#6c63ff]">reimagined</span></h1>
            <p className="text-lg text-gray-600 max-w-lg">Secure, tenant-aware conferencing for organizations and workspaces.</p>
            {tenant && (
              <p className="text-sm text-slate-500">Current workspace: <span className="font-semibold text-slate-700">{tenant.organization_name} · {tenant.workspace_name ?? 'Default workspace'}</span></p>
            )}
            <div className="flex gap-4">
              <button onClick={start} disabled={starting} className="btn-primary flex items-center gap-2 px-8 py-3.5 disabled:cursor-wait disabled:opacity-60"><Play className="w-5 h-5"/>{starting ? 'Creating...' : 'Start a meeting'}</button>
              <button onClick={() => navigate('/schedule')} className="btn-secondary flex items-center gap-2 px-8 py-3.5"><Calendar className="w-5 h-5"/>Schedule</button>
            </div>
          </div>
          <div className="bg-gradient-to-br from-gray-900 to-gray-800 rounded-3xl p-4 shadow-2xl">
            <div className="grid grid-cols-1 gap-3">
              <div className="rounded-2xl border border-slate-700 bg-slate-900/80 p-4">
                <div className="mb-4 flex items-center justify-between">
                  <span className="text-sm font-medium text-slate-300">Meeting ready</span>
                  <span className="rounded-full border border-emerald-500/40 bg-emerald-500/10 px-2 py-1 text-xs text-emerald-300">Live</span>
                </div>
                <div className="mb-3 flex items-center gap-3">
                  <div className="flex h-12 w-12 items-center justify-center rounded-full bg-gradient-to-br from-[#1a73e8] to-[#6c63ff] font-semibold text-white">
                    {user?.full_name?.slice(0, 2).toUpperCase() || 'ME'}
                  </div>
                  <div>
                    <p className="font-medium text-white">{user?.full_name || 'Your workspace'}</p>
                    <p className="text-sm text-slate-400">Ready to host a meeting</p>
                  </div>
                </div>
                <div className="flex gap-3 pt-2">
                  {[Mic, Camera, Monitor].map((Icon, index) => (
                    <div key={index} className="flex h-10 w-10 items-center justify-center rounded-full bg-slate-800 text-slate-200">
                      <Icon className="h-4 w-4" />
                    </div>
                  ))}
                </div>
              </div>
            </div>
          </div>
        </div>
      </section>
      {actionError && <div className="mx-auto max-w-7xl px-6"><div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{actionError}</div></div>}
      {recentMeetings.length > 0 && (
        <section className="px-6 pt-8">
          <div className="mx-auto max-w-7xl rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
            <div className="mb-4 flex items-center justify-between"><h2 className="text-2xl font-bold text-gray-900">Recent meetings</h2><button onClick={() => navigate('/meetings')} className="text-sm font-semibold text-blue-700">View all</button></div>
            <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
              {recentMeetings.map((meeting) => <button key={meeting.id} onClick={() => navigate(destinationForMeeting(meeting))} className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50"><p className="text-xs font-semibold uppercase tracking-[0.14em] text-slate-500">{meeting.status}</p><h3 className="mt-2 font-semibold text-slate-900">{meeting.title}</h3><p className="mt-1 text-sm text-blue-700">{meeting.code}</p></button>)}
            </div>
          </div>
        </section>
      )}
      {!loadingMeetings && scheduledMeetings.length > 0 && (
        <section className="px-6 pt-8">
          <div className="max-w-7xl mx-auto">
            <div className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
              <div className="mb-4 flex items-center justify-between gap-4">
                <h2 className="text-2xl font-bold text-gray-900">Upcoming meetings</h2>
                <span className="rounded-full bg-blue-100 px-3 py-1 text-xs font-semibold uppercase tracking-[0.15em] text-blue-700">
                  {scheduledMeetings.length} saved
                </span>
              </div>
              <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
                {scheduledMeetings.map((meeting) => (
                  <button
                    key={`${meeting.meeting_code ?? meeting.title}-${meeting.date}-${meeting.time}`}
                    onClick={() => meeting.meeting_code
                      ? navigate(meetingJoinPath(meeting.meeting_code))
                      : navigate('/meetings')}
                    className="rounded-2xl border border-slate-200 bg-slate-50 p-4 text-left transition hover:border-blue-200 hover:bg-blue-50"
                  >
                    <p className="text-sm font-medium text-slate-500">{meeting.date}</p>
                    <h3 className="mt-2 text-lg font-semibold text-slate-900">{meeting.title}</h3>
                    <p className="mt-1 text-sm text-slate-600">{meeting.time}</p>
                    <p className="mt-3 text-xs font-medium uppercase tracking-[0.12em] text-blue-700">{meeting.meeting_code ?? 'No code'}</p>
                  </button>
                ))}
              </div>
            </div>
          </div>
        </section>
      )}

      {!loadingMeetings && scheduledMeetings.length === 0 && (
        <section className="px-6 pt-8">
          <div className="max-w-7xl mx-auto">
            <div className="rounded-3xl border border-dashed border-slate-200 bg-white p-6 text-sm text-slate-600 shadow-sm">
              No scheduled meetings yet. Create a plan to keep the next session organized.
            </div>
          </div>
        </section>
      )}

      <section id="features" className="py-20 px-6">
        <div className="max-w-7xl mx-auto text-center mb-16"><h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">Everything you need</h2></div>
        <div className="max-w-7xl mx-auto grid md:grid-cols-2 lg:grid-cols-3 gap-6">
          {[{icon:Users,t:'Workspace-first design',d:'Organized around teams and tenant boundaries'},{icon:Shield,t:'Security by default',d:'Protected access and meeting validation'},{icon:MessageSquare,t:'Real-time collaboration',d:'Live chat and meeting coordination'},{icon:Monitor,t:'Screen sharing',d:'Enterprise-ready meeting workflows'},{icon:Hand,t:'Moderation controls',d:'Planned host and attendee management'},{icon:Smile,t:'AI roadmap',d:'Conversation intelligence planned for later phases'}].map((f,i)=>(
            <div key={i} className="card p-6 hover:scale-[1.02] transition-transform"><h3 className="font-semibold text-gray-900 mb-2">{f.t}</h3><p className="text-sm text-gray-600">{f.d}</p></div>
          ))}
        </div>
      </section>
      <section id="pricing" className="py-20 px-6 bg-gray-50">
        <div className="max-w-7xl mx-auto text-center mb-16"><h2 className="text-3xl lg:text-4xl font-bold text-gray-900 mb-4">Simple pricing</h2></div>
        <div className="max-w-5xl mx-auto grid md:grid-cols-3 gap-8">
          <div className="card p-8"><h3 className="text-xl font-semibold mb-2">Free</h3><div className="mb-6"><span className="text-4xl font-bold"></span><span className="text-gray-500">/mo</span></div><ul className="space-y-2 mb-8 text-sm text-gray-600"><li>Core conferencing access</li><li>Single workspace</li><li>Standard security</li></ul><button onClick={start} className="btn-secondary w-full">Get started</button></div>
          <div className="card p-8 border-2 border-[#1a73e8] relative"><div className="absolute -top-3 left-1/2 -translate-x-1/2 bg-[#1a73e8] text-white text-xs font-semibold px-3 py-1 rounded-full">Popular</div><h3 className="text-xl font-semibold mb-2">Pro</h3><div className="mb-6"><span className="text-4xl font-bold"></span><span className="text-gray-500">/user/mo</span></div><ul className="space-y-2 mb-8 text-sm text-gray-600"><li>Expanded collaboration</li><li>Advanced scheduling</li><li>AI-ready roadmap</li></ul><button onClick={start} className="btn-primary w-full">Start trial</button></div>
          <div className="card p-8"><h3 className="text-xl font-semibold mb-2">Enterprise</h3><div className="mb-6"><span className="text-4xl font-bold">Custom</span></div><ul className="space-y-2 mb-8 text-sm text-gray-600"><li>Multi-workspace scale</li><li>Role-based controls</li><li>Custom deployment needs</li></ul><button className="btn-secondary w-full">Contact sales</button></div>
        </div>
      </section>
      <footer className="border-t border-gray-100 py-12 px-6 text-center"><p className="text-sm text-gray-400">© 2026 LeTsMeet. All rights reserved.</p></footer>
      {showJoinModal && (<div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50" onClick={()=>setShowJoinModal(false)}><div className="bg-white rounded-2xl p-8 w-full max-w-md shadow-2xl" onClick={e=>e.stopPropagation()}><h3 className="text-xl font-bold mb-2">Join a meeting</h3><input type="text" placeholder="Meeting code" value={meetingCode} onChange={e=>setMeetingCode(e.target.value)} className="input-field mb-4" onKeyDown={e=>e.key==='Enter'&&join()}/><div className="flex gap-3"><button onClick={()=>setShowJoinModal(false)} className="btn-secondary flex-1">Cancel</button><button onClick={join} className="btn-primary flex-1">Join</button></div></div></div>)}
    </div>
  );
}
