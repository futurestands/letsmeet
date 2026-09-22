import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.staging.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  console.error('Missing staging configuration');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function report(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function run() {
  const timeId = Date.now();
  const hostEmail = `mute-host-${timeId}@example.com`;
  const participantEmail = `mute-part-${timeId}@example.com`;
  const password = 'Password123!';

  console.log('--- TEST 1: IDEMPOTENCY / DUPLICATE SCHEDULING SUBMIT ---');
  const hostAuth = await supabaseAdmin.auth.admin.createUser({
    email: hostEmail,
    password,
    email_confirm: true,
  });
  const hostId = hostAuth.data.user.id;

  const partAuth = await supabaseAdmin.auth.admin.createUser({
    email: participantEmail,
    password,
    email_confirm: true,
  });
  const partId = partAuth.data.user.id;

  const hostClient = createClient(supabaseUrl, supabaseAnonKey);
  await hostClient.auth.signInWithPassword({ email: hostEmail, password });
  await hostClient.rpc('ensure_user_profile_context', { p_user_id: hostId, p_email: hostEmail, p_full_name: 'Host User' });

  const partClient = createClient(supabaseUrl, supabaseAnonKey);
  await partClient.auth.signInWithPassword({ email: participantEmail, password });
  await partClient.rpc('ensure_user_profile_context', { p_user_id: partId, p_email: participantEmail, p_full_name: 'Part User' });

  try {
    // 1. Submit scheduling request 1
    const { data: schedule1, error: err1 } = await hostClient.rpc('schedule_persistent_meeting', {
      p_title: 'Idempotent Meeting',
      p_date: '2026-11-15',
      p_time: '10:00',
      p_timezone: 'UTC',
    });
    report('First schedule submission', Boolean(schedule1?.meeting_code && !err1), err1?.message ?? '');

    // 2. Immediately submit identical scheduling request 2
    const { data: schedule2, error: err2 } = await hostClient.rpc('schedule_persistent_meeting', {
      p_title: 'Idempotent Meeting',
      p_date: '2026-11-15',
      p_time: '10:00',
      p_timezone: 'UTC',
    });
    report('Second schedule submission', Boolean(schedule2?.meeting_code && !err2), err2?.message ?? '');

    report(
      'Idempotency match (same meeting returned)',
      schedule1?.meeting_code === schedule2?.meeting_code && schedule1?.id === schedule2?.id,
    );

    // Verify row count in meetings
    const { data: meetingRows } = await supabaseAdmin
      .from('meetings')
      .select('id')
      .eq('host_id', hostId)
      .eq('title', 'Idempotent Meeting');
    report('No duplicate meeting rows created', meetingRows?.length === 1, `count=${meetingRows?.length}`);

    console.log('\n--- TEST 2: DURABLE HOST MUTE SURVIVAL ACROSS REJOIN / RECONNECT ---');

    // Create persistent meeting
    const { data: liveCreated, error: createErr } = await hostClient.rpc('create_persistent_meeting', {
      p_title: 'Durable Mute Meeting',
    });
    report('Host meeting created', Boolean(liveCreated?.code && !createErr), createErr?.message ?? '');
    const meetingCode = liveCreated.code;

    // Host invites participant
    const { error: inviteErr } = await hostClient.rpc('invite_to_persistent_meeting', {
      p_meeting_id: liveCreated.id,
      p_email: participantEmail,
    });
    report('Host invites participant', !inviteErr, inviteErr?.message ?? '');

    // Host starts meeting
    await hostClient.rpc('transition_persistent_meeting', {
      p_meeting_id: liveCreated.id,
      p_status: 'live',
    });

    // Participant joins meeting
    const { data: joinData, error: joinErr } = await partClient.rpc('join_persistent_meeting', {
      p_code: meetingCode,
    });
    const joinRow = Array.isArray(joinData) ? joinData[0] : joinData;
    report('Participant join', joinRow?.participant_status === 'joined', joinErr?.message ?? '');

    // Host mutes participant
    const { error: muteErr } = await hostClient.rpc('moderate_persistent_participant', {
      p_meeting_id: liveCreated.id,
      p_participant_user_id: partId,
      p_action: 'mute',
    });
    report('Host mutes participant', !muteErr, muteErr?.message ?? '');

    // Check participant status in DB
    const { data: pCheck1 } = await supabaseAdmin
      .from('meeting_participants')
      .select('status')
      .eq('meeting_id', liveCreated.id)
      .eq('user_id', partId)
      .single();
    report('Participant DB status is muted', pCheck1?.status === 'muted', `status=${pCheck1?.status}`);

    // Participant attempts to rejoin meeting via join_persistent_meeting
    const { data: rejoinData } = await partClient.rpc('join_persistent_meeting', {
      p_code: meetingCode,
    });
    const rejoinRow = Array.isArray(rejoinData) ? rejoinData[0] : rejoinData;
    report('Rejoin preserves muted status in returned row', rejoinRow?.participant_status === 'muted', `status=${rejoinRow?.participant_status}`);

    const { data: pCheck2 } = await supabaseAdmin
      .from('meeting_participants')
      .select('status')
      .eq('meeting_id', liveCreated.id)
      .eq('user_id', partId)
      .single();
    report('Rejoin preserves muted status in DB', pCheck2?.status === 'muted', `status=${pCheck2?.status}`);

    // Host unmutes participant
    const { error: unmuteErr } = await hostClient.rpc('moderate_persistent_participant', {
      p_meeting_id: liveCreated.id,
      p_participant_user_id: partId,
      p_action: 'unmute',
    });
    report('Host unmutes participant (or API endpoint)', !unmuteErr, unmuteErr?.message ?? '');

    const { data: pCheck3 } = await supabaseAdmin
      .from('meeting_participants')
      .select('status')
      .eq('meeting_id', liveCreated.id)
      .eq('user_id', partId)
      .single();
    report('Participant DB status restored to joined', pCheck3?.status === 'joined', `status=${pCheck3?.status}`);

  } finally {
    console.log('\nCleaning up test users...');
    await supabaseAdmin.auth.admin.deleteUser(hostId);
    await supabaseAdmin.auth.admin.deleteUser(partId);
  }
}

run().catch((err) => {
  console.error('Test execution error:', err);
  process.exit(1);
});
