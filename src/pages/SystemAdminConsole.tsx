import { useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import {
  Activity,
  AlertTriangle,
  CheckCircle,
  Database,
  Flag,
  Globe,
  Layers,
  Lock,
  RefreshCw,
  Server,
  Shield,
  ShieldAlert,
  Users,
  Video,
} from 'lucide-react';

interface OverviewMetrics {
  users: { total: number; active: number; suspended: number };
  organizations: { total: number; active: number; suspended: number };
  meetings: { live: number; scheduled: number; completed: number };
  recordings: { total: number; completed: number; failed: number };
}

interface UserItem {
  id: string;
  email: string;
  full_name: string | null;
  status: string;
  created_at: string;
}

interface OrgItem {
  id: string;
  name: string;
  slug: string;
  status: string;
  created_at: string;
}

interface LiveMeetingItem {
  id: string;
  code: string;
  title: string;
  status: string;
  created_at: string;
}

interface AuditLogItem {
  id: string;
  admin_user_id: string;
  action: string;
  target_type: string;
  target_id: string;
  reason: string;
  created_at: string;
}

interface FeatureFlagItem {
  key: string;
  enabled: boolean;
  description: string;
  target_scope: string;
}

export default function SystemAdminConsole() {
  const [activeTab, setActiveTab] = useState<'overview' | 'users' | 'orgs' | 'live' | 'audit' | 'flags' | 'health' | 'billing'>('overview');
  const [loading, setLoading] = useState(true);
  const [unauthorized, setUnauthorized] = useState(false);
  const [metrics, setMetrics] = useState<OverviewMetrics | null>(null);
  const [users, setUsers] = useState<UserItem[]>([]);
  const [orgs, setOrgs] = useState<OrgItem[]>([]);
  const [liveMeetings, setLiveMeetings] = useState<LiveMeetingItem[]>([]);
  const [auditLogs, setAuditLogs] = useState<AuditLogItem[]>([]);
  const [flags, setFlags] = useState<FeatureFlagItem[]>([]);
  const [health, setHealth] = useState<Record<string, { status: string; note: string }> | null>(null);
  const [userSearch, setUserSearch] = useState('');
  const [actionNotice, setActionNotice] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);

  const tokenEndpoint = import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT || 'http://localhost:3001/api/livekit/token';
  const apiBase = tokenEndpoint.replace(/\/livekit\/token(?:\?.*)?$/, '');

  const getAuthToken = async () => {
    const { data } = await supabase.auth.getSession();
    return data.session?.access_token || null;
  };

  useEffect(() => {
    let active = true;
    async function loadConsoleData() {
      if (unauthorized) return;
      const token = await getAuthToken();
      if (!token || !active) return;

      if (activeTab === 'overview') {
        setLoading(true);
        try {
          const res = await fetch(`${apiBase}/system-admin/overview`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          if (res.status === 403 || res.status === 401) {
            setUnauthorized(true);
            return;
          }
          const data = await res.json();
          if (data.ok && active) setMetrics(data.metrics);
        } catch {
          setUnauthorized(true);
        } finally {
          if (active) setLoading(false);
        }
      } else if (activeTab === 'users') {
        try {
          const res = await fetch(`${apiBase}/system-admin/users?search=${encodeURIComponent(userSearch)}`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (data.ok && active) setUsers(data.users);
        } catch { /* ignore */ }
      } else if (activeTab === 'orgs') {
        try {
          const res = await fetch(`${apiBase}/system-admin/organizations`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (data.ok && active) setOrgs(data.organizations);
        } catch { /* ignore */ }
      } else if (activeTab === 'live') {
        try {
          const res = await fetch(`${apiBase}/system-admin/live-meetings`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (data.ok && active) setLiveMeetings(data.liveMeetings);
        } catch { /* ignore */ }
      } else if (activeTab === 'audit') {
        try {
          const res = await fetch(`${apiBase}/system-admin/audit-logs`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (data.ok && active) setAuditLogs(data.auditLogs);
        } catch { /* ignore */ }
      } else if (activeTab === 'flags') {
        try {
          const res = await fetch(`${apiBase}/system-admin/feature-flags`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (data.ok && active) setFlags(data.flags);
        } catch { /* ignore */ }
      } else if (activeTab === 'health') {
        try {
          const res = await fetch(`${apiBase}/system-admin/health`, {
            headers: { Authorization: `Bearer ${token}` },
          });
          const data = await res.json();
          if (data.ok && active) setHealth(data.services);
        } catch { /* ignore */ }
      }
    }

    void loadConsoleData();
    return () => { active = false; };
  }, [activeTab, userSearch, unauthorized, apiBase, refreshTrigger]);

  const toggleUserSuspend = async (userId: string, currentStatus: string) => {
    const token = await getAuthToken();
    if (!token) return;
    const suspend = currentStatus !== 'suspended';
    try {
      const res = await fetch(`${apiBase}/system-admin/users/suspend`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetUserId: userId, suspend, reason: 'Console Action' }),
      });
      if (res.ok) {
        setActionNotice(`User status updated to ${suspend ? 'suspended' : 'active'}.`);
        setRefreshTrigger((prev) => prev + 1);
      }
    } catch {
      setActionNotice('Failed to update user status.');
    }
  };

  const toggleFlag = async (key: string, currentEnabled: boolean) => {
    const token = await getAuthToken();
    if (!token) return;
    try {
      const res = await fetch(`${apiBase}/system-admin/feature-flags`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ key, enabled: !currentEnabled, reason: 'Console Toggle' }),
      });
      if (res.ok) {
        setActionNotice(`Feature flag ${key} ${!currentEnabled ? 'enabled' : 'disabled'}.`);
        setRefreshTrigger((prev) => prev + 1);
      }
    } catch {
      setActionNotice('Failed to update feature flag.');
    }
  };

  if (unauthorized) {
    return (
      <div className="flex min-h-screen items-center justify-center bg-slate-950 p-6 text-slate-100">
        <div className="max-w-md rounded-xl border border-red-800 bg-slate-900 p-8 text-center shadow-2xl">
          <ShieldAlert className="mx-auto mb-4 h-16 w-16 text-red-500 animate-pulse" />
          <h1 className="text-2xl font-bold text-white">403 Unauthorized</h1>
          <p className="mt-2 text-sm text-slate-400">
            System Admin privileges are required to access the LeTsMeet Platform Administration Console. Your account does not have platform-level administrative rights.
          </p>
          <a href="#/" className="mt-6 inline-block rounded-lg bg-blue-600 px-5 py-2.5 text-sm font-medium text-white hover:bg-blue-500 transition-colors">
            Return to Application
          </a>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 font-sans">
      {/* Top Console Navigation Bar */}
      <header className="border-b border-slate-800 bg-slate-900/80 px-6 py-4 backdrop-blur-md">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <Shield className="h-7 w-7 text-blue-500" />
            <div>
              <h1 className="text-lg font-semibold text-white tracking-wide">LeTsMeet System Admin Console</h1>
              <p className="text-xs text-slate-400">Platform Operations & Telemetry Control</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className="inline-flex items-center gap-1.5 rounded-full bg-emerald-950/80 border border-emerald-800 px-3 py-1 text-xs font-medium text-emerald-400">
              <CheckCircle className="h-3.5 w-3.5" /> Platform Active
            </span>
            <button
              onClick={() => setRefreshTrigger((prev) => prev + 1)}
              className="rounded-lg border border-slate-700 bg-slate-800 p-2 text-slate-300 hover:bg-slate-700 hover:text-white transition-colors"
              title="Refresh Telemetry"
            >
              <RefreshCw className="h-4 w-4" />
            </button>
          </div>
        </div>
      </header>

      {/* Main Console Container */}
      <div className="flex min-h-[calc(100vh-73px)]">
        {/* Sidebar Nav */}
        <aside className="w-64 border-r border-slate-800 bg-slate-900/40 p-4">
          <nav className="space-y-1">
            <button
              onClick={() => setActiveTab('overview')}
              className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${activeTab === 'overview' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
            >
              <Activity className="h-4 w-4" /> Overview
            </button>
            <button
              onClick={() => setActiveTab('users')}
              className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${activeTab === 'users' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
            >
              <Users className="h-4 w-4" /> Users
            </button>
            <button
              onClick={() => setActiveTab('orgs')}
              className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${activeTab === 'orgs' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
            >
              <Globe className="h-4 w-4" /> Organizations
            </button>
            <button
              onClick={() => setActiveTab('live')}
              className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${activeTab === 'live' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
            >
              <Video className="h-4 w-4" /> Live Meetings
            </button>
            <button
              onClick={() => setActiveTab('audit')}
              className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${activeTab === 'audit' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
            >
              <Lock className="h-4 w-4" /> System Audit Logs
            </button>
            <button
              onClick={() => setActiveTab('flags')}
              className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${activeTab === 'flags' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
            >
              <Flag className="h-4 w-4" /> Feature Flags
            </button>
            <button
              onClick={() => setActiveTab('health')}
              className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${activeTab === 'health' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
            >
              <Server className="h-4 w-4" /> Service Health
            </button>
            <button
              onClick={() => setActiveTab('billing')}
              className={`flex w-full items-center gap-3 rounded-lg px-3.5 py-2.5 text-sm font-medium transition-colors ${activeTab === 'billing' ? 'bg-blue-600 text-white' : 'text-slate-400 hover:bg-slate-800/60 hover:text-slate-200'}`}
            >
              <Layers className="h-4 w-4" /> Plans & Billing
            </button>
          </nav>
        </aside>

        {/* Workspace Area */}
        <main className="flex-1 p-8">
          {actionNotice && (
            <div className="mb-6 rounded-lg border border-blue-800 bg-blue-950/60 p-4 text-sm text-blue-200 flex items-center justify-between">
              <span>{actionNotice}</span>
              <button onClick={() => setActionNotice(null)} className="text-blue-400 hover:text-white">Dismiss</button>
            </div>
          )}

          {loading && activeTab === 'overview' ? (
            <div className="flex items-center justify-center p-12">
              <div className="h-8 w-8 animate-spin rounded-full border-4 border-blue-500 border-t-transparent" />
            </div>
          ) : (
            <>
              {/* TAB 1: OVERVIEW */}
              {activeTab === 'overview' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-bold text-white">System Metrics & Platform Telemetry</h2>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-2 lg:grid-cols-4">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-medium uppercase tracking-wider">Total Users</span>
                        <Users className="h-5 w-5 text-blue-400" />
                      </div>
                      <div className="text-3xl font-extrabold text-white">{metrics?.users?.total ?? 0}</div>
                      <div className="mt-2 text-xs text-emerald-400">{metrics?.users?.active ?? 0} Active • {metrics?.users?.suspended ?? 0} Suspended</div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-medium uppercase tracking-wider">Organizations</span>
                        <Globe className="h-5 w-5 text-emerald-400" />
                      </div>
                      <div className="text-3xl font-extrabold text-white">{metrics?.organizations?.total ?? 0}</div>
                      <div className="mt-2 text-xs text-slate-400">{metrics?.organizations?.active ?? 0} Active Tenants</div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-medium uppercase tracking-wider">Live Meetings</span>
                        <Video className="h-5 w-5 text-rose-400 animate-pulse" />
                      </div>
                      <div className="text-3xl font-extrabold text-white">{metrics?.meetings?.live ?? 0}</div>
                      <div className="mt-2 text-xs text-slate-400">{metrics?.meetings?.completed ?? 0} Completed Meetings</div>
                    </div>

                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg">
                      <div className="flex items-center justify-between text-slate-400 mb-2">
                        <span className="text-xs font-medium uppercase tracking-wider">Recordings</span>
                        <Database className="h-5 w-5 text-purple-400" />
                      </div>
                      <div className="text-3xl font-extrabold text-white">{metrics?.recordings?.total ?? 0}</div>
                      <div className="mt-2 text-xs text-emerald-400">{metrics?.recordings?.completed ?? 0} Completed • {metrics?.recordings?.failed ?? 0} Failed</div>
                    </div>
                  </div>
                </div>
              )}

              {/* TAB 2: USERS */}
              {activeTab === 'users' && (
                <div className="space-y-6">
                  <div className="flex items-center justify-between">
                    <h2 className="text-xl font-bold text-white">Global User Directory</h2>
                    <input
                      type="text"
                      placeholder="Search email or name..."
                      value={userSearch}
                      onChange={(e) => setUserSearch(e.target.value)}
                      className="rounded-lg border border-slate-700 bg-slate-900 px-4 py-2 text-sm text-white focus:border-blue-500 focus:outline-none"
                    />
                  </div>
                  <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
                    <table className="w-full text-left text-sm text-slate-300">
                      <thead className="border-b border-slate-800 bg-slate-900/80 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <tr>
                          <th className="px-6 py-3.5">User</th>
                          <th className="px-6 py-3.5">Status</th>
                          <th className="px-6 py-3.5">Created Date</th>
                          <th className="px-6 py-3.5 text-right">Actions</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y border-slate-800 divide-slate-800">
                        {users.map((u) => (
                          <tr key={u.id} className="hover:bg-slate-800/40">
                            <td className="px-6 py-4">
                              <div className="font-medium text-white">{u.full_name || 'Unnamed User'}</div>
                              <div className="text-xs text-slate-400">{u.email}</div>
                            </td>
                            <td className="px-6 py-4">
                              <span className={`inline-flex rounded-full px-2.5 py-0.5 text-xs font-medium ${u.status === 'suspended' ? 'bg-red-950 text-red-400 border border-red-800' : 'bg-emerald-950 text-emerald-400 border border-emerald-800'}`}>
                                {u.status || 'active'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-xs text-slate-400">{new Date(u.created_at).toLocaleDateString()}</td>
                            <td className="px-6 py-4 text-right">
                              <button
                                onClick={() => void toggleUserSuspend(u.id, u.status)}
                                className={`rounded px-3 py-1 text-xs font-medium transition-colors ${u.status === 'suspended' ? 'bg-emerald-600 text-white hover:bg-emerald-500' : 'bg-red-600/80 text-white hover:bg-red-500'}`}
                              >
                                {u.status === 'suspended' ? 'Reactivate' : 'Suspend'}
                              </button>
                            </td>
                          </tr>
                        ))}
                        {users.length === 0 && (
                          <tr><td colSpan={4} className="p-8 text-center text-slate-500">No users found</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 3: ORGANIZATIONS */}
              {activeTab === 'orgs' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-bold text-white">Global Organizations</h2>
                  <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
                    <table className="w-full text-left text-sm text-slate-300">
                      <thead className="border-b border-slate-800 bg-slate-900/80 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <tr>
                          <th className="px-6 py-3.5">Organization</th>
                          <th className="px-6 py-3.5">Slug</th>
                          <th className="px-6 py-3.5">Status</th>
                          <th className="px-6 py-3.5">Created Date</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {orgs.map((o) => (
                          <tr key={o.id} className="hover:bg-slate-800/40">
                            <td className="px-6 py-4 font-medium text-white">{o.name}</td>
                            <td className="px-6 py-4 font-mono text-xs text-slate-400">{o.slug}</td>
                            <td className="px-6 py-4">
                              <span className="inline-flex rounded-full bg-emerald-950 border border-emerald-800 px-2.5 py-0.5 text-xs font-medium text-emerald-400">
                                {o.status || 'active'}
                              </span>
                            </td>
                            <td className="px-6 py-4 text-xs text-slate-400">{new Date(o.created_at).toLocaleDateString()}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 4: LIVE MEETINGS */}
              {activeTab === 'live' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-bold text-white">Live Meetings Monitor</h2>
                  <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
                    <table className="w-full text-left text-sm text-slate-300">
                      <thead className="border-b border-slate-800 bg-slate-900/80 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <tr>
                          <th className="px-6 py-3.5">Meeting Code</th>
                          <th className="px-6 py-3.5">Title</th>
                          <th className="px-6 py-3.5">Status</th>
                          <th className="px-6 py-3.5">Started At</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {liveMeetings.map((m) => (
                          <tr key={m.id} className="hover:bg-slate-800/40">
                            <td className="px-6 py-4 font-mono text-xs text-blue-400">{m.code}</td>
                            <td className="px-6 py-4 font-medium text-white">{m.title}</td>
                            <td className="px-6 py-4">
                              <span className="inline-flex items-center gap-1 rounded-full bg-rose-950 border border-rose-800 px-2.5 py-0.5 text-xs font-medium text-rose-400">
                                <span className="h-1.5 w-1.5 rounded-full bg-rose-500 animate-ping" /> Live
                              </span>
                            </td>
                            <td className="px-6 py-4 text-xs text-slate-400">{new Date(m.created_at).toLocaleTimeString()}</td>
                          </tr>
                        ))}
                        {liveMeetings.length === 0 && (
                          <tr><td colSpan={4} className="p-8 text-center text-slate-500">No active meetings currently live</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 5: AUDIT LOGS */}
              {activeTab === 'audit' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-bold text-white">System Audit Trail</h2>
                  <div className="overflow-x-auto rounded-xl border border-slate-800 bg-slate-900/60 shadow-lg">
                    <table className="w-full text-left text-sm text-slate-300">
                      <thead className="border-b border-slate-800 bg-slate-900/80 text-xs font-semibold uppercase tracking-wider text-slate-400">
                        <tr>
                          <th className="px-6 py-3.5">Timestamp</th>
                          <th className="px-6 py-3.5">Admin ID</th>
                          <th className="px-6 py-3.5">Action</th>
                          <th className="px-6 py-3.5">Target</th>
                          <th className="px-6 py-3.5">Reason</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800">
                        {auditLogs.map((a) => (
                          <tr key={a.id} className="hover:bg-slate-800/40">
                            <td className="px-6 py-4 text-xs text-slate-400">{new Date(a.created_at).toLocaleString()}</td>
                            <td className="px-6 py-4 font-mono text-xs text-slate-400">{a.admin_user_id}</td>
                            <td className="px-6 py-4 font-semibold text-blue-400">{a.action}</td>
                            <td className="px-6 py-4 text-xs text-slate-300">{a.target_type}: {a.target_id}</td>
                            <td className="px-6 py-4 text-xs text-slate-400">{a.reason || '—'}</td>
                          </tr>
                        ))}
                        {auditLogs.length === 0 && (
                          <tr><td colSpan={5} className="p-8 text-center text-slate-500">No system audit events recorded yet</td></tr>
                        )}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {/* TAB 6: FEATURE FLAGS */}
              {activeTab === 'flags' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-bold text-white">Platform Feature Flags</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {flags.map((f) => (
                      <div key={f.key} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg flex flex-col justify-between">
                        <div>
                          <div className="flex items-center justify-between mb-2">
                            <span className="font-mono text-sm font-bold text-white">{f.key}</span>
                            <span className={`inline-flex rounded-full px-2 py-0.5 text-xs font-semibold ${f.enabled ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-slate-800 text-slate-400'}`}>
                              {f.enabled ? 'Enabled' : 'Disabled'}
                            </span>
                          </div>
                          <p className="text-xs text-slate-400 mb-4">{f.description}</p>
                        </div>
                        <button
                          onClick={() => void toggleFlag(f.key, f.enabled)}
                          className={`w-full rounded-lg px-3 py-2 text-xs font-medium transition-colors ${f.enabled ? 'bg-red-950 text-red-400 hover:bg-red-900 border border-red-800' : 'bg-emerald-950 text-emerald-400 hover:bg-emerald-900 border border-emerald-800'}`}
                        >
                          {f.enabled ? 'Disable Flag' : 'Enable Flag'}
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 7: SERVICE HEALTH */}
              {activeTab === 'health' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-bold text-white">Platform Subsystem Health</h2>
                  <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                    {health && Object.entries(health).map(([svc, info]) => (
                      <div key={svc} className="rounded-xl border border-slate-800 bg-slate-900/60 p-5 shadow-lg">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-sm font-bold uppercase text-white tracking-wider">{svc}</span>
                          <span className={`inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium ${info.status === 'HEALTHY' ? 'bg-emerald-950 text-emerald-400 border border-emerald-800' : 'bg-amber-950 text-amber-400 border border-amber-800'}`}>
                            {info.status === 'HEALTHY' ? <CheckCircle className="h-3 w-3" /> : <AlertTriangle className="h-3 w-3" />} {info.status}
                          </span>
                        </div>
                        <p className="text-xs text-slate-400">{info.note}</p>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* TAB 8: BILLING */}
              {activeTab === 'billing' && (
                <div className="space-y-6">
                  <h2 className="text-xl font-bold text-white">Subscription Plans & Payment Foundation</h2>
                  <div className="rounded-xl border border-amber-800/80 bg-amber-950/40 p-4 text-sm text-amber-200 flex items-center gap-3">
                    <AlertTriangle className="h-5 w-5 text-amber-400 shrink-0" />
                    <span><strong>BILLING PROVIDER NOT CONFIGURED:</strong> Payment gateway provider (Stripe/Flutterwave) is not connected in this environment. Subscription plans are active for entitlement enforcement.</span>
                  </div>
                  <div className="grid grid-cols-1 gap-6 sm:grid-cols-3">
                    <div className="rounded-xl border border-slate-800 bg-slate-900/60 p-6 shadow-lg">
                      <h3 className="text-lg font-bold text-white">Free Starter</h3>
                      <div className="mt-2 text-2xl font-extrabold text-blue-400">$0 <span className="text-xs text-slate-400 font-normal">/ mo</span></div>
                      <ul className="mt-4 space-y-2 text-xs text-slate-300">
                        <li>• Max 5 users</li>
                        <li>• Max 25 participants</li>
                        <li>• Max 45 min duration</li>
                        <li>• Recording disabled</li>
                      </ul>
                    </div>

                    <div className="rounded-xl border border-blue-800 bg-blue-950/40 p-6 shadow-lg relative">
                      <span className="absolute top-3 right-3 rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-bold text-white uppercase tracking-wide">Popular</span>
                      <h3 className="text-lg font-bold text-white">Pro Team</h3>
                      <div className="mt-2 text-2xl font-extrabold text-blue-400">$29 <span className="text-xs text-slate-400 font-normal">/ mo</span></div>
                      <ul className="mt-4 space-y-2 text-xs text-slate-300">
                        <li>• Max 25 users</li>
                        <li>• Max 100 participants</li>
                        <li>• Max 180 min duration</li>
                        <li>• Recording enabled</li>
                      </ul>
                    </div>

                    <div className="rounded-xl border border-purple-800 bg-purple-950/40 p-6 shadow-lg">
                      <h3 className="text-lg font-bold text-white">Enterprise Unlimited</h3>
                      <div className="mt-2 text-2xl font-extrabold text-purple-400">$99 <span className="text-xs text-slate-400 font-normal">/ mo</span></div>
                      <ul className="mt-4 space-y-2 text-xs text-slate-300">
                        <li>• Max 500 users</li>
                        <li>• Max 500 participants</li>
                        <li>• Max 1440 min duration</li>
                        <li>• Recording, Transcription & AI enabled</li>
                      </ul>
                    </div>
                  </div>
                </div>
              )}
            </>
          )}
        </main>
      </div>
    </div>
  );
}
