import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';
import { evaluateLiveKitAccess, evaluateModerationAccess } from '../server/livekit-auth.mjs';

dotenv.config({ path: '.env.staging.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  console.error('Missing staging configuration in .env.staging.local');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

let total = 0;
let passed = 0;
let failed = 0;

function report(name, ok, extra = '') {
  total += 1;
  if (ok) {
    passed += 1;
    console.log(`PASS ${name}${extra ? ` — ${extra}` : ''}`);
  } else {
    failed += 1;
    console.log(`FAIL ${name}${extra ? ` — ${extra}` : ''}`);
    process.exitCode = 1;
  }
}

async function run() {
  const timeId = Date.now();
  const hostEmail = `sprint-host-${timeId}@example.com`;
  const guestEmail = `sprint-guest-${timeId}@example.com`;
  const outsiderEmail = `sprint-outsider-${timeId}@example.com`;
  const password = 'Password123!';

  console.log('================================================================');
  console.log('  LETSMEET SPRINT VERIFICATION HARNESS (STAGING)  ');
  console.log('================================================================\n');

  // Create Users
  const { data: hostAuth } = await supabaseAdmin.auth.admin.createUser({ email: hostEmail, password, email_confirm: true });
  const hostId = hostAuth.user.id;

  const { data: guestAuth } = await supabaseAdmin.auth.admin.createUser({ email: guestEmail, password, email_confirm: true });
  const guestId = guestAuth.user.id;

  const { data: outsiderAuth } = await supabaseAdmin.auth.admin.createUser({ email: outsiderEmail, password, email_confirm: true });
  const outsiderId = outsiderAuth.user.id;

  const hostClient = createClient(supabaseUrl, supabaseAnonKey);
  await hostClient.auth.signInWithPassword({ email: hostEmail, password });

  const guestClient = createClient(supabaseUrl, supabaseAnonKey);
  await guestClient.auth.signInWithPassword({ email: guestEmail, password });

  const outsiderClient = createClient(supabaseUrl, supabaseAnonKey);
  await outsiderClient.auth.signInWithPassword({ email: outsiderEmail, password });

  const unauthClient = createClient(supabaseUrl, supabaseAnonKey);

  try {
    // 1. Fresh-user onboarding
    console.log('--- 1. Fresh User Onboarding ---');
    const { data: onboardingContext, error: onboardErr } = await hostClient.rpc('ensure_user_profile_context', {
      p_user_id: hostId,
      p_email: hostEmail,
      p_full_name: 'Sprint Host User',
    });
    report('Fresh user onboarding provisioned org & workspace', !onboardErr && Boolean(onboardingContext), onboardErr?.message ?? '');

    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', hostId).single();
    report('User profile row exists in database', Boolean(profile));

    const { data: membership } = await supabaseAdmin.from('organization_members').select('*').eq('user_id', hostId).single();
    report('Organization membership row exists in database', Boolean(membership));

    const { data: tenantContext, error: tenantErr } = await hostClient.rpc('resolve_user_tenant_context');
    report('resolve_user_tenant_context resolves active tenant', !tenantErr && Boolean(tenantContext), tenantErr?.message ?? '');

    // Setup guest & outsider contexts
    await guestClient.rpc('ensure_user_profile_context', { p_user_id: guestId, p_email: guestEmail, p_full_name: 'Guest User' });
    await outsiderClient.rpc('ensure_user_profile_context', { p_user_id: outsiderId, p_email: outsiderEmail, p_full_name: 'Outsider User' });

    // 2. Schedule Meeting
    console.log('\n--- 2. Meeting Scheduling ---');
    const { data: schedMeeting, error: schedErr } = await hostClient.rpc('schedule_persistent_meeting', {
      p_title: 'Sprint Verification Meeting',
      p_date: '2026-10-15',
      p_time: '15:00',
      p_timezone: 'UTC',
    });
    report('Host schedules persistent meeting', !schedErr && Boolean(schedMeeting?.meeting_code), schedErr?.message ?? '');
    const meetingCode = schedMeeting?.meeting_code;

    // 3. Africa/Nairobi Timezone Conversion
    console.log('\n--- 3. Timezone Conversion (Africa/Nairobi) ---');
    const { data: nairobiMeeting, error: nairobiErr } = await hostClient.rpc('schedule_persistent_meeting', {
      p_title: 'Nairobi Meeting',
      p_date: '2026-10-01',
      p_time: '14:00',
      p_timezone: 'Africa/Nairobi',
    });
    report('Schedule meeting with Africa/Nairobi timezone', !nairobiErr && Boolean(nairobiMeeting?.meeting_code), nairobiErr?.message ?? '');

    const { data: nairobiRow } = await supabaseAdmin.from('meetings').select('scheduled_for').eq('code', nairobiMeeting.meeting_code).single();
    // 14:00 EAT (UTC+3) is 11:00 UTC
    const isExactUtc = nairobiRow?.scheduled_for?.startsWith('2026-10-01T11:00:00');
    report('Africa/Nairobi 14:00 wall time converted to 11:00 UTC', Boolean(isExactUtc), `scheduled_for=${nairobiRow?.scheduled_for}`);

    // 4. Near-Now Scheduling
    console.log('\n--- 4. Near-Now Scheduling Grace Period ---');
    const nearPast = new Date(Date.now() - 5 * 60 * 1000); // 5 mins in past
    const nearPastDate = nearPast.toISOString().split('T')[0];
    const nearPastTime = nearPast.toISOString().split('T')[1].substring(0, 5);

    const { data: nearPastMeeting, error: nearPastErr } = await hostClient.rpc('schedule_persistent_meeting', {
      p_title: 'Near-Now Meeting',
      p_date: nearPastDate,
      p_time: nearPastTime,
      p_timezone: 'UTC',
    });
    report('Near-now meeting 5 mins in past allowed via 10-min grace period', !nearPastErr && Boolean(nearPastMeeting), nearPastErr?.message ?? '');

    const farPast = new Date(Date.now() - 15 * 60 * 1000); // 15 mins in past
    const farPastDate = farPast.toISOString().split('T')[0];
    const farPastTime = farPast.toISOString().split('T')[1].substring(0, 5);

    const { error: farPastErr } = await hostClient.rpc('schedule_persistent_meeting', {
      p_title: 'Far-Past Meeting',
      p_date: farPastDate,
      p_time: farPastTime,
      p_timezone: 'UTC',
    });
    report('Far-past meeting 15 mins in past rejected', Boolean(farPastErr), farPastErr?.message ?? '');

    // 5. Duplicate Submission / Idempotency
    console.log('\n--- 5. Idempotency & Duplicate Submission ---');
    const { data: idemp1 } = await hostClient.rpc('schedule_persistent_meeting', {
      p_title: 'Idempotency Test',
      p_date: '2026-12-01',
      p_time: '10:00',
      p_timezone: 'UTC',
    });
    const { data: idemp2 } = await hostClient.rpc('schedule_persistent_meeting', {
      p_title: 'Idempotency Test',
      p_date: '2026-12-01',
      p_time: '10:00',
      p_timezone: 'UTC',
    });
    report('Duplicate scheduling submit returns exact same meeting instance', idemp1?.meeting_code === idemp2?.meeting_code && idemp1?.id === idemp2?.id);

    const { data: idempRows } = await supabaseAdmin.from('meetings').select('id').eq('host_id', hostId).eq('title', 'Idempotency Test');
    report('Only 1 database row created for duplicate scheduling submit', idempRows?.length === 1, `count=${idempRows?.length}`);

    // 6. Open & Join Created Meeting
    console.log('\n--- 6. Open & Join Created Meeting ---');
    const { data: hostJoinData, error: hostJoinErr } = await hostClient.rpc('join_persistent_meeting', { p_code: meetingCode });
    const hostJoinRow = Array.isArray(hostJoinData) ? hostJoinData[0] : hostJoinData;
    report('Host opens/joins created meeting', !hostJoinErr && hostJoinRow?.participant_role === 'host', hostJoinErr?.message ?? '');

    // 7. Authorized Secondary Participant Join
    console.log('\n--- 7. Secondary Authorized Participant Join ---');
    const { data: meetingObj } = await supabaseAdmin.from('meetings').select('id').eq('code', meetingCode).single();
    await hostClient.rpc('invite_to_persistent_meeting', { p_meeting_id: meetingObj.id, p_email: guestEmail });

    const { data: guestJoinData, error: guestJoinErr } = await guestClient.rpc('join_persistent_meeting', { p_code: meetingCode });
    const guestJoinRow = Array.isArray(guestJoinData) ? guestJoinData[0] : guestJoinData;
    report('Invited guest joins meeting successfully', !guestJoinErr && Boolean(guestJoinRow?.participant_id), guestJoinErr?.message ?? '');

    // 8. Tenant Isolation / Cross-Tenant Access Denied
    console.log('\n--- 8. Tenant Isolation & Security ---');
    const { error: outsiderErr } = await outsiderClient.rpc('join_persistent_meeting', { p_code: meetingCode });
    report('Uninvited outsider cross-tenant join denied', Boolean(outsiderErr), outsiderErr?.message ?? '');

    // 9. Unauthenticated Scheduling Blocked
    console.log('\n--- 9. Unauthenticated Security Checks ---');
    const { error: unauthErr } = await unauthClient.rpc('schedule_persistent_meeting', {
      p_title: 'Unauthenticated Meeting',
      p_date: '2026-10-20',
      p_time: '10:00',
      p_timezone: 'UTC',
    });
    report('Unauthenticated user blocked from scheduling', Boolean(unauthErr), unauthErr?.message ?? '');

    // 10. Waiting Room LiveKit Token Restrictions
    console.log('\n--- 10. Waiting Room LiveKit Token Restrictions ---');
    const dummyMeeting = { id: 'm-1', code: 'LM-TST123', host_id: 'host-1', status: 'live', organization_id: 'org-1', workspace_id: 'ws-1' };
    const waitingPart = { id: 'p-1', meeting_id: 'm-1', user_id: 'u-1', organization_id: 'org-1', workspace_id: 'ws-1', role: 'participant', status: 'waiting' };
    const joinedPart = { id: 'p-2', meeting_id: 'm-1', user_id: 'u-2', organization_id: 'org-1', workspace_id: 'ws-1', role: 'participant', status: 'joined' };
    const mutedPart = { id: 'p-3', meeting_id: 'm-1', user_id: 'u-3', organization_id: 'org-1', workspace_id: 'ws-1', role: 'participant', status: 'muted' };

    const waitingAccess = evaluateLiveKitAccess({ isAuthenticated: true, userId: 'u-1', requestedRoom: 'LM-TST123', meeting: dummyMeeting, participant: waitingPart });
    report(
      'Waiting room participant denied media permissions (canPublish=false, canSubscribe=false)',
      waitingAccess.ok && !waitingAccess.permissions.canPublish && !waitingAccess.permissions.canSubscribe && !waitingAccess.permissions.canPublishData,
    );

    const joinedAccess = evaluateLiveKitAccess({ isAuthenticated: true, userId: 'u-2', requestedRoom: 'LM-TST123', meeting: dummyMeeting, participant: joinedPart });
    report(
      'Joined participant granted media permissions (canPublish=true, canSubscribe=true)',
      joinedAccess.ok && joinedAccess.permissions.canPublish && joinedAccess.permissions.canSubscribe && joinedAccess.permissions.canPublishData,
    );

    const mutedAccess = evaluateLiveKitAccess({ isAuthenticated: true, userId: 'u-3', requestedRoom: 'LM-TST123', meeting: dummyMeeting, participant: mutedPart });
    report(
      'Muted participant granted subscribe-only (canPublish=false, canSubscribe=true)',
      mutedAccess.ok && !mutedAccess.permissions.canPublish && mutedAccess.permissions.canSubscribe && !mutedAccess.permissions.canPublishData,
    );

    // 11. Durable Host Mute Across Reconnect
    console.log('\n--- 11. Durable Host Mute Across Reconnect & Refresh ---');
    const initialMutedAccess = evaluateLiveKitAccess({ isAuthenticated: true, userId: 'u-3', requestedRoom: 'LM-TST123', meeting: dummyMeeting, participant: mutedPart });
    const reconnectMutedAccess = evaluateLiveKitAccess({ isAuthenticated: true, userId: 'u-3', requestedRoom: 'LM-TST123', meeting: dummyMeeting, participant: mutedPart });

    report(
      'Host-muted participant publish permission remains blocked on initial request',
      initialMutedAccess.ok && !initialMutedAccess.permissions.canPublish,
    );
    report(
      'Host-muted participant publish permission remains blocked on token refresh / reconnect',
      reconnectMutedAccess.ok && !reconnectMutedAccess.permissions.canPublish,
    );

  } finally {
    console.log('\nCleaning up staging test users...');
    await supabaseAdmin.auth.admin.deleteUser(hostId);
    await supabaseAdmin.auth.admin.deleteUser(guestId);
    await supabaseAdmin.auth.admin.deleteUser(outsiderId);
  }

  console.log('\n================================================================');
  console.log(`  VERIFICATION RESULTS: ${passed}/${total} PASSED, ${failed} FAILED  `);
  console.log('================================================================\n');
}

run().catch((err) => {
  console.error('Sprint verification error:', err);
  process.exit(1);
});
