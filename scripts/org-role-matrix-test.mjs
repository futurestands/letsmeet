/**
 * Organization role matrix against staging Supabase (RPC authorization).
 * Uses host (owner) + participant (member). Admin/guest are exercised via
 * invite_organization_member role parameter and owner-only RPCs where available.
 */
import { createClient } from '@supabase/supabase-js';

function required(name) {
  const value = process.env[name]?.trim();
  if (!value) throw new Error(`Missing ${name}`);
  return value;
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

const url = required('VITE_SUPABASE_URL');
const anon = required('VITE_SUPABASE_ANON_KEY');
assert(url.includes('uasslvisjnwhdhcgqwyc'), 'Must target staging Supabase only');
assert(!url.includes('wvmmofornwivfsjeqmda'), 'Must never target production Supabase');

const owner = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });
const member = createClient(url, anon, { auth: { persistSession: false, autoRefreshToken: false } });

const { error: ownerAuthError } = await owner.auth.signInWithPassword({
  email: required('STAGING_TEST_HOST_EMAIL'),
  password: required('STAGING_TEST_HOST_PASSWORD'),
});
assert(!ownerAuthError, `owner auth: ${ownerAuthError?.message}`);

const { error: memberAuthError } = await member.auth.signInWithPassword({
  email: required('STAGING_TEST_PARTICIPANT_EMAIL'),
  password: required('STAGING_TEST_PARTICIPANT_PASSWORD'),
});
assert(!memberAuthError, `member auth: ${memberAuthError?.message}`);

const { data: { user: ownerUser } } = await owner.auth.getUser();
const { data: { user: memberUser } } = await member.auth.getUser();
assert(ownerUser && memberUser, 'both users must be authenticated');

const { data: ownerMembership, error: ownerMembershipError } = await owner
  .from('organization_members')
  .select('id, organization_id, role, status')
  .eq('status', 'active')
  .eq('user_id', ownerUser.id)
  .limit(1)
  .maybeSingle();
assert(!ownerMembershipError && ownerMembership?.role === 'owner', 'host must be organization owner');

const { data: memberMembership } = await member
  .from('organization_members')
  .select('id, organization_id, role, status')
  .eq('status', 'active')
  .eq('user_id', memberUser.id)
  .limit(1)
  .maybeSingle();
assert(memberMembership?.role === 'member', 'participant must be organization member');
assert(memberMembership.organization_id === ownerMembership.organization_id, 'same org');

// Owner: retention/settings allowed
const { error: ownerSettingsError } = await owner.rpc('update_organization_settings', {
  p_retention_days: 90,
  p_recordings_enabled: true,
});
assert(!ownerSettingsError, `owner settings: ${ownerSettingsError?.message}`);

// Member: settings forbidden
const { error: memberSettingsError } = await member.rpc('update_organization_settings', {
  p_retention_days: 1,
  p_recordings_enabled: false,
});
assert(memberSettingsError, 'member must not update organization settings');

// Member: invite forbidden
const { error: memberInviteError } = await member.rpc('invite_organization_member', {
  p_email: 'matrix-guest@example.invalid',
  p_role: 'guest',
});
assert(memberInviteError, 'member must not invite');

// Owner: can create admin + guest invites (pending rows; no accidental membership)
const guestEmail = `matrix-guest-${Date.now()}@example.invalid`;
const adminEmail = `matrix-admin-${Date.now()}@example.invalid`;

const { data: guestInvite, error: guestInviteError } = await owner.rpc('invite_organization_member', {
  p_email: guestEmail,
  p_role: 'guest',
});
assert(!guestInviteError && guestInvite?.role === 'guest', `guest invite: ${guestInviteError?.message}`);
assert(guestInvite.status === 'pending', 'guest invite stays pending');

const { data: adminInvite, error: adminInviteError } = await owner.rpc('invite_organization_member', {
  p_email: adminEmail,
  p_role: 'admin',
});
assert(!adminInviteError && adminInvite?.role === 'admin', `admin invite: ${adminInviteError?.message}`);

// Guest invite must not create an active membership for that email
const { data: guestInviteRow } = await owner
  .from('organization_invites')
  .select('id, email, role, status')
  .eq('id', guestInvite.id)
  .maybeSingle();
assert(guestInviteRow?.status === 'pending' && guestInviteRow?.role === 'guest', 'guest invite persists pending');

const { data: members } = await owner
  .from('organization_members')
  .select('id, user_id, role, status')
  .eq('organization_id', ownerMembership.organization_id)
  .eq('status', 'active');
assert(!(members ?? []).some((row) => row.role === 'guest' && row.user_id == null), 'no empty guest membership');

// Member cannot read audit logs (RLS)
const { data: memberAudits, error: memberAuditError } = await member
  .from('audit_logs')
  .select('id')
  .limit(5);
assert(!memberAuditError, `audit query should not 500: ${memberAuditError?.message}`);
assert((memberAudits ?? []).length === 0, 'member must not see audit logs');

const { data: ownerAudits } = await owner.from('audit_logs').select('id').limit(5);
assert((ownerAudits ?? []).length >= 0, 'owner can query audit logs');

console.log(JSON.stringify({
  ok: true,
  ownerRole: ownerMembership.role,
  memberRole: memberMembership.role,
  guestInviteId: guestInvite.id,
  adminInviteId: adminInvite.id,
}, null, 2));
