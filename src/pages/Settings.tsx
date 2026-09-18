import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  getUserOrganizationContext,
  inviteOrganizationMember,
  listAuditLogs,
  listInAppNotifications,
  listOrganizationMembers,
  loadOrganizationSettings,
  updateOrganizationMemberRole,
  updateOrganizationSettings,
  type AuditLogRow,
  type InAppNotification,
  type OrganizationMemberRow,
  type OrganizationSettings,
  type UserOrganizationContext,
} from '../lib/data-access';
import { isValidInviteEmail, normalizeInviteEmail } from '../lib/schedule-utils';

export default function Settings() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [tenant, setTenant] = useState<UserOrganizationContext | null>(null);
  const [members, setMembers] = useState<OrganizationMemberRow[]>([]);
  const [settings, setSettings] = useState<OrganizationSettings | null>(null);
  const [audit, setAudit] = useState<AuditLogRow[]>([]);
  const [notifications, setNotifications] = useState<InAppNotification[]>([]);
  const [emailConfigured, setEmailConfigured] = useState<boolean | null>(null);
  const [inviteEmail, setInviteEmail] = useState('');
  const [retentionDays, setRetentionDays] = useState(90);
  const [recordingsEnabled, setRecordingsEnabled] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const isAdmin = tenant?.role === 'owner' || tenant?.role === 'admin';

  useEffect(() => {
    let active = true;
    const load = async () => {
      if (!user?.id) return;
      try {
        const [context, memberRows, settingRow, auditRows, notificationRows] = await Promise.all([
          getUserOrganizationContext(user.id),
          listOrganizationMembers(),
          loadOrganizationSettings(),
          listAuditLogs().catch(() => []),
          listInAppNotifications().catch(() => []),
        ]);
        if (!active) return;
        setTenant(context);
        setMembers(memberRows);
        setSettings(settingRow);
        setRetentionDays(settingRow?.retention_days ?? 90);
        setRecordingsEnabled(settingRow?.recordings_enabled ?? true);
        setAudit(auditRows);
        setNotifications(notificationRows);
      } catch (loadError) {
        if (active) setError(loadError instanceof Error ? loadError.message : 'Unable to load organization settings.');
      } finally {
        if (active) setLoading(false);
      }
    };
    void load();
    const tokenEndpoint = import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT as string | undefined;
    if (tokenEndpoint) {
      void fetch(tokenEndpoint.replace(/\/livekit\/token(?:\?.*)?$/, '/notifications/status'))
        .then((response) => response.json())
        .then((payload: { emailConfigured?: boolean }) => {
          if (active) setEmailConfigured(Boolean(payload.emailConfigured));
        })
        .catch(() => {
          if (active) setEmailConfigured(false);
        });
    }
    return () => {
      active = false;
    };
  }, [user?.id]);

  if (loading) {
    return <div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-500">Loading settings…</div>;
  }

  return (
    <div className="min-h-screen bg-slate-50">
      <header className="sticky top-0 z-20 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center gap-4 px-4 py-4 sm:px-6">
          <button onClick={() => navigate('/')} className="flex h-10 w-10 items-center justify-center rounded-full border border-slate-200 bg-white" aria-label="Back to home">
            <ArrowLeft className="h-4 w-4" />
          </button>
          <div>
            <p className="text-xs uppercase tracking-[0.2em] text-slate-500">Settings</p>
            <h1 className="text-xl font-semibold text-slate-900">Organization and account</h1>
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-4 py-8 sm:px-6">
        {error && <div className="rounded-2xl border border-red-200 bg-red-50 p-4 text-sm text-red-700">{error}</div>}
        {notice && <div className="rounded-2xl border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-800">{notice}</div>}

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Profile</h2>
          <p className="mt-2 text-sm text-slate-600">{user?.full_name}</p>
          <p className="text-sm text-slate-500">{user?.email}</p>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Organization</h2>
          {tenant ? (
            <dl className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
              <div><dt className="text-slate-500">Name</dt><dd className="font-medium text-slate-900">{tenant.organization_name}</dd></div>
              <div><dt className="text-slate-500">Your role</dt><dd className="font-medium text-slate-900">{tenant.role}</dd></div>
              <div><dt className="text-slate-500">Workspace</dt><dd className="font-medium text-slate-900">{tenant.workspace_name || 'Default workspace'}</dd></div>
            </dl>
          ) : (
            <p className="mt-3 text-sm text-slate-500">No organization membership was found for this account.</p>
          )}
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Notifications</h2>
          <p className="mt-2 text-sm text-slate-600">
            {emailConfigured === false
              ? 'Email and SMS delivery are not configured on the API server. Reminder jobs stay queued and are never marked sent.'
              : emailConfigured
                ? 'An email provider is configured on the API server. Delivery still depends on that provider succeeding.'
                : 'Notification provider status could not be checked from this browser origin.'}
          </p>
          <ul className="mt-4 divide-y divide-slate-100">
            {notifications.length === 0 && <li className="py-3 text-sm text-slate-500">No in-app notifications yet.</li>}
            {notifications.map((item) => (
              <li key={item.id} className="py-3 text-sm">
                <strong className="block text-slate-900">{item.title}</strong>
                <span className="text-slate-500">{item.body}</span>
              </li>
            ))}
          </ul>
        </section>

        <section className="rounded-2xl border border-slate-200 bg-white p-6">
          <h2 className="text-lg font-semibold text-slate-900">Members</h2>
          {isAdmin && (
            <form
              className="mt-4 flex flex-col gap-3 sm:flex-row"
              onSubmit={(event) => {
                event.preventDefault();
                const email = normalizeInviteEmail(inviteEmail);
                if (!isValidInviteEmail(email)) return;
                void inviteOrganizationMember(email)
                  .then(() => { setInviteEmail(''); setNotice('Organization invitation saved.'); })
                  .catch((inviteError) => setError(inviteError instanceof Error ? inviteError.message : 'Invitation failed.'));
              }}
            >
              <input
                value={inviteEmail}
                onChange={(event) => setInviteEmail(event.target.value)}
                className="input-field min-w-0 flex-1"
                placeholder="Invite email"
                aria-label="Organization invite email"
              />
              <button type="submit" className="btn-primary" aria-label="Invite organization member">Invite member</button>
            </form>
          )}
          <ul className="mt-4 divide-y divide-slate-100">
            {members.map((member) => (
              <li key={member.id} className="flex items-center justify-between gap-3 py-3 text-sm">
                <span>
                  <strong className="block text-slate-900">{member.user_id === user?.id ? 'You' : member.user_id}</strong>
                  <span className="text-slate-500">{member.role}</span>
                </span>
                {isAdmin && member.role !== 'owner' && (
                  <select
                    value={member.role}
                    aria-label={`Change role for member ${member.user_id}`}
                    onChange={(event) => {
                      void updateOrganizationMemberRole(member.id, event.target.value)
                        .then(() => setNotice('Role updated.'))
                        .catch((roleError) => setError(roleError instanceof Error ? roleError.message : 'Role could not be changed.'));
                    }}
                    className="input-field w-auto"
                  >
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                    <option value="guest">guest</option>
                  </select>
                )}
              </li>
            ))}
          </ul>
        </section>

        {isAdmin && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Retention</h2>
            <form
              className="mt-4 space-y-4"
              onSubmit={(event) => {
                event.preventDefault();
                void updateOrganizationSettings(retentionDays, recordingsEnabled)
                  .then((saved) => { setSettings(saved); setNotice('Organization settings saved.'); })
                  .catch((saveError) => setError(saveError instanceof Error ? saveError.message : 'Settings could not be saved.'));
              }}
            >
              <label className="block text-sm" htmlFor="retention-days">
                Recording retention (days)
                <input id="retention-days" type="number" min={1} max={3650} value={retentionDays} onChange={(event) => setRetentionDays(Number(event.target.value))} className="input-field mt-1" />
              </label>
              <label className="flex items-center gap-2 text-sm" htmlFor="recordings-enabled">
                <input id="recordings-enabled" type="checkbox" checked={recordingsEnabled} onChange={(event) => setRecordingsEnabled(event.target.checked)} />
                Allow meeting recordings
              </label>
              <button type="submit" className="btn-primary" aria-label="Save organization settings">Save settings</button>
            </form>
            {settings && <p className="mt-3 text-xs text-slate-500">Current retention: {settings.retention_days} days.</p>}
          </section>
        )}

        {isAdmin && (
          <section className="rounded-2xl border border-slate-200 bg-white p-6">
            <h2 className="text-lg font-semibold text-slate-900">Audit log</h2>
            <ul className="mt-4 divide-y divide-slate-100">
              {audit.length === 0 && <li className="py-3 text-sm text-slate-500">No administrative events recorded yet.</li>}
              {audit.map((row) => (
                <li key={row.id} className="py-3 text-sm">
                  <strong className="text-slate-900">{row.action}</strong>
                  <span className="ml-2 text-slate-500">{row.resource_type} · {new Date(row.created_at).toLocaleString()}</span>
                </li>
              ))}
            </ul>
          </section>
        )}
      </main>
    </div>
  );
}
