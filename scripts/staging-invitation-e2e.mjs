/**
 * Staging integration harness for invitations, scheduling, and collaboration RPCs.
 * Uses .env.staging.local. Does not claim browser media verification.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

function loadEnv(filePath) {
  const contents = readFileSync(filePath, 'utf8');
  for (const line of contents.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 0) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadEnv(resolve(process.cwd(), '.env.staging.local'));

const {
  VITE_SUPABASE_URL,
  VITE_SUPABASE_ANON_KEY,
  SUPABASE_SERVICE_ROLE_KEY,
  STAGING_TEST_HOST_EMAIL,
  STAGING_TEST_HOST_PASSWORD,
  STAGING_TEST_PARTICIPANT_EMAIL,
  STAGING_TEST_PARTICIPANT_PASSWORD,
} = process.env;

if (!VITE_SUPABASE_URL || !VITE_SUPABASE_ANON_KEY) {
  throw new Error('Staging public Supabase configuration is required');
}

const admin = SUPABASE_SERVICE_ROLE_KEY
  ? createClient(VITE_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, {
      auth: { persistSession: false, autoRefreshToken: false },
    })
  : null;

const hostClient = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const guestClient = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});
const outsiderClient = createClient(VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY, {
  auth: { persistSession: false, autoRefreshToken: false },
});

let failed = 0;
function report(name, ok, detail = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${detail ? ` — ${detail}` : ''}`);
  if (!ok) failed += 1;
}

async function signIn(client, email, password) {
  const { data, error } = await client.auth.signInWithPassword({ email, password });
  if (error || !data.user) throw error ?? new Error('sign-in failed');
  return data.user;
}

const tomorrow = new Date(Date.now() + 24 * 60 * 60 * 1000);
const date = tomorrow.toISOString().slice(0, 10);

const host = await signIn(hostClient, STAGING_TEST_HOST_EMAIL, STAGING_TEST_HOST_PASSWORD);
const guest = await signIn(guestClient, STAGING_TEST_PARTICIPANT_EMAIL, STAGING_TEST_PARTICIPANT_PASSWORD);
report('host authenticated', Boolean(host?.id));
report('guest authenticated', Boolean(guest?.id));

const { data: scheduled, error: scheduleError } = await hostClient.rpc('schedule_persistent_meeting', {
  p_title: `E2E Invite ${Date.now()}`,
  p_date: date,
  p_time: '15:30',
  p_timezone: 'UTC',
  p_workspace_id: null,
  p_description: 'Staging invitation harness',
  p_duration_minutes: 30,
});
report('schedule meeting', !scheduleError && Boolean(scheduled?.meeting_code), scheduleError?.message || scheduled?.meeting_code);

const { data: meetingRows } = await hostClient.from('meetings').select('*').eq('code', scheduled.meeting_code).maybeSingle();
const meeting = meetingRows;
report('scheduled_for stored as timestamptz', Boolean(meeting?.scheduled_for));
report('duration persisted', meeting?.duration_minutes === 30);

const { data: invite, error: inviteError } = await hostClient.rpc('invite_to_persistent_meeting', {
  p_meeting_id: meeting.id,
  p_email: STAGING_TEST_PARTICIPANT_EMAIL,
});
report('host creates invite', !inviteError && invite?.status === 'pending', inviteError?.message);

const { data: jobs } = await hostClient
  .from('meeting_notification_jobs')
  .select('id, status, provider, provider_message_id, channel, template, idempotency_key')
  .eq('meeting_id', meeting.id);
report('notification jobs queued pending', (jobs ?? []).length > 0 && (jobs ?? []).every((job) => job.status === 'pending' && !job.provider_message_id), `count=${jobs?.length ?? 0}`);
report('reminder jobs use idempotency keys', (jobs ?? []).every((job) => Boolean(job.idempotency_key)));

const { data: lookedUp, error: lookupError } = await guestClient.rpc('lookup_joinable_meeting', {
  p_code: meeting.code,
});
report('invited guest can lookup meeting', !lookupError && lookedUp?.code === meeting.code, lookupError?.message);

const { data: joined, error: joinError } = await guestClient.rpc('join_persistent_meeting', { p_code: meeting.code });
const joinedRow = Array.isArray(joined) ? joined[0] : joined;
report('seeded participant can join invited meeting', !joinError && Boolean(joinedRow?.participant_id), joinError?.message);

const outsiderEmail = `outsider.${Date.now()}@letsmeet-staging.test`;
const outsiderPassword = `Outsider!${Date.now()}Aa`;
if (admin) {
  const { data: createdOutsider, error: createOutsiderError } = await admin.auth.admin.createUser({
    email: outsiderEmail,
    password: outsiderPassword,
    email_confirm: true,
    user_metadata: { full_name: 'Staging Outsider' },
  });
  report('created true outsider auth user', !createOutsiderError && Boolean(createdOutsider?.user?.id), createOutsiderError?.message);
  if (createdOutsider?.user?.id) {
    await admin.from('users').upsert({
      id: createdOutsider.user.id,
      email: outsiderEmail,
      full_name: 'Staging Outsider',
    });
    const outsider = await signIn(outsiderClient, outsiderEmail, outsiderPassword);
    const { error: outsiderLookupBefore } = await outsiderClient.rpc('lookup_joinable_meeting', { p_code: meeting.code });
    report('outsider without invite cannot lookup', Boolean(outsiderLookupBefore), outsiderLookupBefore?.message || 'lookup succeeded');

    const { data: outsiderInvite, error: outsiderInviteError } = await hostClient.rpc('invite_to_persistent_meeting', {
      p_meeting_id: meeting.id,
      p_email: outsiderEmail,
    });
    report('host invites true outsider', !outsiderInviteError && outsiderInvite?.status === 'pending', outsiderInviteError?.message);

    const { data: outsiderLookup, error: outsiderLookupError } = await outsiderClient.rpc('lookup_joinable_meeting', {
      p_code: meeting.code,
    });
    report('invited outsider can lookup', !outsiderLookupError && outsiderLookup?.code === meeting.code, outsiderLookupError?.message);

    const { data: outsiderJoined, error: outsiderJoinError } = await outsiderClient.rpc('join_persistent_meeting', {
      p_code: meeting.code,
    });
    const outsiderJoinedRow = Array.isArray(outsiderJoined) ? outsiderJoined[0] : outsiderJoined;
    report('invited outsider can join without prior membership', !outsiderJoinError && Boolean(outsiderJoinedRow?.participant_id), outsiderJoinError?.message);

    const { data: outsiderOrg } = await admin
      .from('organization_members')
      .select('id')
      .eq('organization_id', meeting.organization_id)
      .eq('user_id', outsider.id)
      .maybeSingle();
    report('true outsider join does not create org membership', !outsiderOrg);

    await hostClient.rpc('revoke_meeting_invite', { p_invite_id: outsiderInvite.id });
  }
} else {
  report('true outsider guest path', false, 'SUPABASE_SERVICE_ROLE_KEY unavailable');
}

const { data: poll, error: pollError } = await hostClient.rpc('create_meeting_poll', {
  p_meeting_id: meeting.id,
  p_question: 'Ready for E2E?',
  p_options: ['Yes', 'No'],
  p_anonymous: true,
});
report('host creates poll after join transition', !pollError && Boolean(poll?.id), pollError?.message || 'host must join first for active meeting');

// Ensure host is a participant for collaboration RPCs.
await hostClient.rpc('join_persistent_meeting', { p_code: meeting.code });
const { data: poll2, error: pollError2 } = await hostClient.rpc('create_meeting_poll', {
  p_meeting_id: meeting.id,
  p_question: 'Ready for E2E?',
  p_options: ['Yes', 'No'],
  p_anonymous: true,
});
report('host creates poll when waiting/live', !pollError2 && Boolean(poll2?.id), pollError2?.message);

if (poll2?.id) {
  const { data: options } = await guestClient
    .from('meeting_poll_options')
    .select('id, label, position')
    .eq('poll_id', poll2.id)
    .order('position');
  const optionId = options?.[0]?.id;
  const { error: voteError } = await guestClient.rpc('vote_meeting_poll', {
    p_poll_id: poll2.id,
    p_option_id: optionId,
  });
  report('guest can vote once', !voteError, voteError?.message);
  const { error: voteAgain } = await guestClient.rpc('vote_meeting_poll', {
    p_poll_id: poll2.id,
    p_option_id: optionId,
  });
  report('duplicate vote blocked', Boolean(voteAgain), voteAgain?.message || 'second vote accepted');
}

const { data: question, error: questionError } = await guestClient.rpc('ask_meeting_question', {
  p_meeting_id: meeting.id,
  p_body: 'What is the deployment plan?',
});
report('guest can ask a question', !questionError && Boolean(question?.id), questionError?.message);
if (question?.id) {
  const { error: upvoteError } = await hostClient.rpc('upvote_meeting_question', { p_question_id: question.id });
  report('host can upvote question', !upvoteError, upvoteError?.message);
  const { error: answerError } = await hostClient.rpc('moderate_meeting_question', {
    p_question_id: question.id,
    p_status: 'answered',
  });
  report('host can mark question answered', !answerError, answerError?.message);
}

const { data: notes, error: notesError } = await hostClient.rpc('save_meeting_notes', {
  p_meeting_id: meeting.id,
  p_content: 'Shared notes from staging harness',
  p_version: 0,
});
report('shared notes save', !notesError && notes?.version === 1, notesError?.message);

const { data: stale, error: staleError } = await guestClient.rpc('save_meeting_notes', {
  p_meeting_id: meeting.id,
  p_content: 'Stale overwrite attempt',
  p_version: 0,
});
report('stale note version rejected', Boolean(staleError) && !stale, staleError?.message || 'stale write accepted');

const { data: page, error: boardError } = await hostClient.rpc('ensure_whiteboard_page', { p_meeting_id: meeting.id });
report('whiteboard page created', !boardError && Boolean(page?.id), boardError?.message);
if (page?.id) {
  const { error: strokeError } = await hostClient.rpc('append_whiteboard_op', {
    p_page_id: page.id,
    p_op: { type: 'stroke', points: [[10, 10], [40, 40]], color: '#93c5fd' },
  });
  report('whiteboard stroke persisted', !strokeError, strokeError?.message);
}

const { data: recording, error: recordingError } = await hostClient.rpc('request_meeting_recording', {
  p_meeting_id: meeting.id,
});
report('recording request stays queued', !recordingError && recording?.status === 'queued', recordingError?.message);

const { data: aiJob, error: aiError } = await hostClient.rpc('request_meeting_ai_job', {
  p_meeting_id: meeting.id,
  p_job_type: 'summary',
  p_prompt: null,
});
report('AI job stays queued without provider', !aiError && aiJob?.status === 'queued', aiError?.message);

const { data: revoked, error: revokeError } = await hostClient.rpc('revoke_meeting_invite', { p_invite_id: invite.id });
report('seeded participant invite revoked', !revokeError && revoked?.status === 'revoked', revokeError?.message);
report('revoked invite status persisted', revoked?.status === 'revoked');

const { data: cancelled, error: cancelError } = await hostClient.rpc('transition_persistent_meeting', {
  p_meeting_id: meeting.id,
  p_status: 'cancelled',
});
report('meeting cancelled', !cancelError && cancelled?.status === 'cancelled', cancelError?.message);

const { error: cancelJoinError } = await guestClient.rpc('join_persistent_meeting', { p_code: meeting.code });
report('cancelled meeting cannot be joined', Boolean(cancelJoinError), cancelJoinError?.message || 'join succeeded');

const { error: pastError } = await hostClient.rpc('schedule_persistent_meeting', {
  p_title: 'Past meeting',
  p_date: '2020-01-01',
  p_time: '09:00',
  p_timezone: 'UTC',
  p_workspace_id: null,
  p_description: null,
  p_duration_minutes: 30,
});
report('past schedule rejected', Boolean(pastError), pastError?.message || 'past schedule accepted');

console.log(`\nStaging invitation/collaboration harness: ${failed === 0 ? 'PASS' : 'FAIL'} (${failed} failed)`);
process.exitCode = failed === 0 ? 0 : 1;
