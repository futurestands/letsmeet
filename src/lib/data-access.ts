import { supabase } from './supabase';
import { isValidMeetingCode, normalizeMeetingCode, type MeetingStatus, type ParticipantRole } from './meeting-utils';

export type ParticipantStatus = 'joined' | 'muted' | 'waiting' | 'left' | 'removed';

export type MeetingSummary = {
  id: string;
  code: string;
  title: string;
  host_id: string;
  status: MeetingStatus;
  created_at?: string | null;
  scheduled_for?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  organization_id: string;
  workspace_id: string;
  is_locked?: boolean;
  locked_at?: string | null;
  description?: string | null;
  duration_minutes?: number | null;
};

export type ScheduledMeetingSummary = {
  id: string;
  title: string;
  date: string;
  time: string;
  timezone: string;
  host_id: string;
  meeting_code?: string | null;
  created_at?: string | null;
  scheduled_for?: string | null;
  status: MeetingStatus;
  organization_id: string;
  workspace_id: string;
  description?: string | null;
  duration_minutes?: number | null;
};

export type ParticipantSummary = {
  id: string;
  meeting_id: string;
  user_id: string;
  user_name: string;
  role: ParticipantRole;
  status: ParticipantStatus;
  joined_at?: string | null;
  left_at?: string | null;
};

export type UserOrganizationContext = {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  workspace_id: string | null;
  workspace_name: string | null;
  workspace_slug: string | null;
  role: string;
  status: string;
};

export type JoinedMeeting = MeetingSummary & {
  participant_id: string;
  participant_role: ParticipantRole;
  participant_status: ParticipantStatus;
};

export type ChatMessage = {
  id: string;
  meeting_id: string;
  user_id: string;
  user_name: string;
  message: string;
  created_at: string;
};

export type MeetingInvite = {
  id: string;
  meeting_id: string;
  email: string;
  status: 'pending' | 'accepted' | 'declined' | 'revoked';
  invited_user_id?: string | null;
  invited_by?: string | null;
  created_at?: string | null;
};

const meetingSelect = 'id, code, title, host_id, status, created_at, scheduled_for, started_at, ended_at, organization_id, workspace_id, is_locked, locked_at, description, duration_minutes';
const scheduledMeetingSelect = 'id, title, date, time, timezone, host_id, meeting_code, created_at, scheduled_for, status, organization_id, workspace_id, description, duration_minutes';
const participantSelect = 'id, meeting_id, user_id, user_name, role, status, joined_at, left_at';

function asMeetingSummary(row: MeetingSummary | null): MeetingSummary | null {
  return row ?? null;
}

export async function getUserOrganizationContext(userId: string): Promise<UserOrganizationContext | null> {
  if (!userId) return null;

  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('organization_id, role, status, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError && membershipError.code !== 'PGRST116') throw membershipError;
  if (!membership) return null;

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('id', membership.organization_id)
    .maybeSingle();
  if (organizationError) throw organizationError;
  if (!organization) return null;

  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id, name, slug')
    .eq('organization_id', membership.organization_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();
  if (workspaceError && workspaceError.code !== 'PGRST116') throw workspaceError;

  return {
    organization_id: organization.id,
    organization_name: organization.name,
    organization_slug: organization.slug,
    workspace_id: workspace?.id ?? null,
    workspace_name: workspace?.name ?? null,
    workspace_slug: workspace?.slug ?? null,
    role: membership.role,
    status: membership.status,
  };
}

export async function listMeetingsForUser(): Promise<MeetingSummary[]> {
  const { data, error } = await supabase
    .from('meetings')
    .select(meetingSelect)
    .order('created_at', { ascending: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as MeetingSummary[];
}

export async function listScheduledMeetingsForUser(): Promise<ScheduledMeetingSummary[]> {
  const { data, error } = await supabase
    .from('scheduled_meetings')
    .select(scheduledMeetingSelect)
    .order('scheduled_for', { ascending: true, nullsFirst: false })
    .limit(100);
  if (error) throw error;
  return (data ?? []) as ScheduledMeetingSummary[];
}

export async function listMyParticipations(): Promise<ParticipantSummary[]> {
  const { data: sessionData } = await supabase.auth.getSession();
  const userId = sessionData.session?.user?.id;
  if (!userId) return [];

  const { data, error } = await supabase
    .from('meeting_participants')
    .select(participantSelect)
    .eq('user_id', userId)
    .order('joined_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return (data ?? []) as ParticipantSummary[];
}

export async function findMeetingByCode(code: string): Promise<MeetingSummary | null> {
  const normalizedCode = normalizeMeetingCode(code);
  if (!isValidMeetingCode(normalizedCode)) return null;
  const { data, error } = await supabase
    .from('meetings')
    .select(meetingSelect)
    .eq('code', normalizedCode)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return asMeetingSummary(data as MeetingSummary | null);
}

export async function findMeetingById(id: string): Promise<MeetingSummary | null> {
  if (!id) return null;
  const { data, error } = await supabase.from('meetings').select(meetingSelect).eq('id', id).maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return asMeetingSummary(data as MeetingSummary | null);
}

export async function listParticipantsForMeeting(meetingId: string): Promise<ParticipantSummary[]> {
  const { data, error } = await supabase
    .from('meeting_participants')
    .select(participantSelect)
    .eq('meeting_id', meetingId)
    .order('joined_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as ParticipantSummary[];
}

export type MeetingPoll = {
  id: string;
  meeting_id: string;
  question: string;
  status: 'open' | 'closed';
  anonymous: boolean;
  created_at: string;
};

export type MeetingPollOption = {
  id: string;
  poll_id: string;
  label: string;
  position: number;
};

export type MeetingQuestion = {
  id: string;
  meeting_id: string;
  user_id: string;
  user_name: string;
  body: string;
  status: 'open' | 'answered' | 'dismissed';
  upvote_count: number;
  created_at: string;
};

export type MeetingNotes = {
  meeting_id: string;
  content: string;
  version: number;
  updated_at: string;
};

export type MeetingRecording = {
  id: string;
  meeting_id: string;
  status: 'queued' | 'starting' | 'active' | 'processing' | 'completed' | 'failed';
  playback_url?: string | null;
  error?: string | null;
  created_at: string;
};

export type MeetingAiJob = {
  id: string;
  meeting_id: string;
  job_type: string;
  status: 'queued' | 'processing' | 'completed' | 'failed' | 'unconfigured';
  prompt?: string | null;
  result?: Record<string, unknown> | null;
  error?: string | null;
  created_at: string;
};

export type WhiteboardPage = {
  id: string;
  meeting_id: string;
  title: string;
  page_index: number;
};

export type WhiteboardOp = {
  id: string;
  page_id: string;
  seq: number;
  op: { type: string; points?: number[][]; color?: string };
  created_at: string;
};

export type OrganizationMemberRow = {
  id: string;
  user_id: string;
  role: string;
  status: string;
};

export type OrganizationSettings = {
  organization_id: string;
  retention_days: number;
  recordings_enabled: boolean;
};

export type AuditLogRow = {
  id: string;
  action: string;
  resource_type: string;
  created_at: string;
};

export type InAppNotification = {
  id: string;
  title: string;
  body: string;
  meeting_id?: string | null;
  read_at?: string | null;
  created_at: string;
};

export async function listChatMessages(meetingId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, meeting_id, user_id, user_name, message, created_at, deleted_at')
    .eq('meeting_id', meetingId)
    .is('deleted_at', null)
    .order('created_at', { ascending: false })
    .limit(200);
  if (error) throw error;
  return ((data ?? []) as ChatMessage[]).reverse();
}

export async function sendPersistentChat(meetingId: string, message: string): Promise<ChatMessage> {
  const { data, error } = await supabase.rpc('send_persistent_chat', {
    p_meeting_id: meetingId,
    p_message: message,
  });
  if (error) throw error;
  return data as ChatMessage;
}

export async function setPersistentMeetingLock(meetingId: string, locked: boolean): Promise<MeetingSummary> {
  const { data, error } = await supabase.rpc('set_persistent_meeting_lock', {
    p_meeting_id: meetingId,
    p_locked: locked,
  });
  if (error) throw error;
  return data as MeetingSummary;
}

export async function createPersistentMeeting(title = 'New meeting', workspaceId?: string | null): Promise<MeetingSummary> {
  const { data, error } = await supabase.rpc('create_persistent_meeting', {
    p_title: title,
    p_workspace_id: workspaceId ?? null,
  });
  if (error) throw error;
  return data as MeetingSummary;
}

export async function schedulePersistentMeeting(input: {
  title: string;
  date: string;
  time: string;
  timezone: string;
  workspaceId?: string | null;
  description?: string | null;
  durationMinutes?: number;
}): Promise<ScheduledMeetingSummary> {
  const { data, error } = await supabase.rpc('schedule_persistent_meeting', {
    p_title: input.title,
    p_date: input.date,
    p_time: input.time,
    p_timezone: input.timezone,
    p_workspace_id: input.workspaceId ?? null,
    p_description: input.description ?? null,
    p_duration_minutes: input.durationMinutes ?? 30,
  });
  if (error) {
    console.error('RPC schedule_persistent_meeting failed:', error);
    throw error;
  }
  return data as ScheduledMeetingSummary;
}

export async function updateScheduledMeeting(input: {
  meetingId: string;
  title: string;
  date: string;
  time: string;
  timezone: string;
  description?: string | null;
  durationMinutes?: number;
}): Promise<MeetingSummary> {
  const { data, error } = await supabase.rpc('update_scheduled_meeting', {
    p_meeting_id: input.meetingId,
    p_title: input.title,
    p_date: input.date,
    p_time: input.time,
    p_timezone: input.timezone,
    p_description: input.description ?? null,
    p_duration_minutes: input.durationMinutes ?? 30,
  });
  if (error) throw error;
  return data as MeetingSummary;
}

export async function listInvitesForMeeting(meetingId: string): Promise<MeetingInvite[]> {
  const { data, error } = await supabase
    .from('meeting_invites')
    .select('id, meeting_id, email, status, invited_user_id, invited_by, created_at')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MeetingInvite[];
}

export async function inviteToPersistentMeeting(meetingId: string, email: string): Promise<MeetingInvite> {
  const { data, error } = await supabase.rpc('invite_to_persistent_meeting', {
    p_meeting_id: meetingId,
    p_email: email,
  });
  if (error) {
    console.error('RPC invite_to_persistent_meeting failed:', error);
    throw error;
  }
  return data as MeetingInvite;
}

export async function revokeMeetingInvite(inviteId: string): Promise<MeetingInvite> {
  const { data, error } = await supabase.rpc('revoke_meeting_invite', { p_invite_id: inviteId });
  if (error) throw error;
  return data as MeetingInvite;
}

function mapJoinedMeeting(row: Record<string, string>): JoinedMeeting {
  return {
    id: row.meeting_id,
    code: row.meeting_code,
    title: row.title,
    host_id: row.host_id,
    organization_id: row.organization_id,
    workspace_id: row.workspace_id,
    status: row.meeting_status as MeetingStatus,
    scheduled_for: row.scheduled_for,
    started_at: row.started_at,
    ended_at: row.ended_at,
    created_at: row.created_at,
    participant_id: row.participant_id,
    participant_role: row.participant_role as ParticipantRole,
    participant_status: row.participant_status as ParticipantStatus,
  };
}

export async function joinPersistentMeeting(code: string): Promise<JoinedMeeting> {
  const normalizedCode = normalizeMeetingCode(code);
  if (!isValidMeetingCode(normalizedCode)) {
    throw new Error('Enter a valid six-character meeting code.');
  }

  const { data, error } = await supabase.rpc('join_persistent_meeting', { p_code: normalizedCode });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, string> | null;
  if (!row) throw new Error('Meeting could not be joined.');
  return mapJoinedMeeting(row);
}

export async function leavePersistentMeeting(meetingId: string): Promise<void> {
  const { error } = await supabase.rpc('leave_persistent_meeting', { p_meeting_id: meetingId });
  if (error) throw error;
}

export async function transitionPersistentMeeting(meetingId: string, status: MeetingStatus): Promise<MeetingSummary> {
  const { data, error } = await supabase.rpc('transition_persistent_meeting', {
    p_meeting_id: meetingId,
    p_status: status,
  });
  if (error) throw error;
  return data as MeetingSummary;
}

export async function lookupJoinableMeeting(code: string): Promise<MeetingSummary> {
  const normalizedCode = normalizeMeetingCode(code);
  if (!isValidMeetingCode(normalizedCode)) {
    throw new Error('Enter a valid six-character meeting code.');
  }
  const { data, error } = await supabase.rpc('lookup_joinable_meeting', { p_code: normalizedCode });
  if (error) throw error;
  return data as MeetingSummary;
}

export async function lookupMeetingShareLink(code: string): Promise<MeetingSummary> {
  const normalizedCode = normalizeMeetingCode(code);
  if (!isValidMeetingCode(normalizedCode)) {
    throw new Error('Enter a valid six-character meeting code.');
  }
  const { data, error } = await supabase.rpc('lookup_meeting_share_link', { p_code: normalizedCode });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as MeetingSummary | null;
  if (!row) throw new Error('Meeting not found or you do not have access to it.');
  return row;
}

export async function joinMeetingByShareLink(code: string, displayName: string): Promise<JoinedMeeting> {
  const normalizedCode = normalizeMeetingCode(code);
  if (!isValidMeetingCode(normalizedCode)) {
    throw new Error('Enter a valid six-character meeting code.');
  }
  const { data, error } = await supabase.rpc('join_meeting_by_share_link', {
    p_code: normalizedCode,
    p_display_name: displayName,
  });
  if (error) throw error;
  const row = (Array.isArray(data) ? data[0] : data) as Record<string, string> | null;
  if (!row) throw new Error('Meeting could not be joined.');
  return mapJoinedMeeting(row);
}

export type GuestMeetingPreview = {
  code: string;
  title: string;
  status: string;
};

export async function previewGuestMeeting(code: string): Promise<GuestMeetingPreview> {
  const normalizedCode = normalizeMeetingCode(code);
  if (!isValidMeetingCode(normalizedCode)) {
    throw new Error('Enter a valid six-character meeting code.');
  }
  const endpoint = import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT as string | undefined;
  if (!endpoint) throw new Error('Meeting preview is unavailable.');
  const previewUrl = endpoint.replace(/\/api\/livekit\/token\/?$/, '/api/guest/meeting-preview');
  const response = await fetch(`${previewUrl}?room=${encodeURIComponent(normalizedCode)}`);
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(body.error ?? 'Unable to open this meeting.'));
  }
  return body as GuestMeetingPreview;
}

export async function createGuestJoinSession(code: string, displayName: string): Promise<{
  access_token: string;
  refresh_token: string;
  user: { id: string; displayName: string; guest: boolean };
  meeting: GuestMeetingPreview;
}> {
  const normalizedCode = normalizeMeetingCode(code);
  if (!isValidMeetingCode(normalizedCode)) {
    throw new Error('Enter a valid six-character meeting code.');
  }
  const endpoint = import.meta.env.VITE_LIVEKIT_TOKEN_ENDPOINT as string | undefined;
  if (!endpoint) throw new Error('Guest join is unavailable.');
  const sessionUrl = endpoint.replace(/\/api\/livekit\/token\/?$/, '/api/guest/session');
  const response = await fetch(sessionUrl, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ room: normalizedCode, displayName }),
  });
  const body = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(String(body.error ?? 'Unable to start a guest session.'));
  }
  return body;
}

export async function acceptMeetingInvite(meetingId: string): Promise<MeetingInvite> {
  const { data, error } = await supabase.rpc('accept_meeting_invite', { p_meeting_id: meetingId });
  if (error) throw error;
  return data as MeetingInvite;
}

export async function deletePersistentChat(messageId: string): Promise<void> {
  const { error } = await supabase.rpc('delete_persistent_chat', { p_message_id: messageId });
  if (error) throw error;
}

export async function markChatRead(meetingId: string): Promise<void> {
  const { error } = await supabase.rpc('mark_chat_read', { p_meeting_id: meetingId });
  if (error) throw error;
}

export async function sendMeetingReaction(meetingId: string, emoji: string) {
  const { data, error } = await supabase.rpc('send_meeting_reaction', { p_meeting_id: meetingId, p_emoji: emoji });
  if (error) throw error;
  return data;
}

export async function setHandRaised(meetingId: string, raised: boolean): Promise<boolean> {
  const { data, error } = await supabase.rpc('set_hand_raised', { p_meeting_id: meetingId, p_raised: raised });
  if (error) throw error;
  return Boolean(data);
}

export async function clearRaisedHands(meetingId: string): Promise<void> {
  const { error } = await supabase.rpc('clear_raised_hands', { p_meeting_id: meetingId });
  if (error) throw error;
}

export async function listRaisedHands(meetingId: string): Promise<{ user_id: string }[]> {
  const { data, error } = await supabase
    .from('meeting_hand_raises')
    .select('user_id')
    .eq('meeting_id', meetingId)
    .order('raised_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as { user_id: string }[];
}

export async function listMeetingPolls(meetingId: string): Promise<MeetingPoll[]> {
  const { data, error } = await supabase
    .from('meeting_polls')
    .select('id, meeting_id, question, status, anonymous, created_at')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MeetingPoll[];
}

export async function listPollOptions(pollId: string): Promise<MeetingPollOption[]> {
  const { data, error } = await supabase
    .from('meeting_poll_options')
    .select('id, poll_id, label, position')
    .eq('poll_id', pollId)
    .order('position', { ascending: true });
  if (error) throw error;
  return (data ?? []) as MeetingPollOption[];
}

export async function createMeetingPoll(meetingId: string, question: string, options: string[], anonymous: boolean) {
  const { data, error } = await supabase.rpc('create_meeting_poll', {
    p_meeting_id: meetingId,
    p_question: question,
    p_options: options,
    p_anonymous: anonymous,
  });
  if (error) throw error;
  return data as MeetingPoll;
}

export async function closeMeetingPoll(pollId: string) {
  const { data, error } = await supabase.rpc('close_meeting_poll', { p_poll_id: pollId });
  if (error) throw error;
  return data as MeetingPoll;
}

export async function voteMeetingPoll(pollId: string, optionId: string) {
  const { error } = await supabase.rpc('vote_meeting_poll', { p_poll_id: pollId, p_option_id: optionId });
  if (error) throw error;
}

export async function listMeetingQuestions(meetingId: string): Promise<MeetingQuestion[]> {
  const { data, error } = await supabase
    .from('meeting_questions')
    .select('id, meeting_id, user_id, user_name, body, status, upvote_count, created_at')
    .eq('meeting_id', meetingId)
    .order('upvote_count', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MeetingQuestion[];
}

export async function askMeetingQuestion(meetingId: string, body: string) {
  const { data, error } = await supabase.rpc('ask_meeting_question', { p_meeting_id: meetingId, p_body: body });
  if (error) throw error;
  return data as MeetingQuestion;
}

export async function moderateMeetingQuestion(questionId: string, status: MeetingQuestion['status']) {
  const { data, error } = await supabase.rpc('moderate_meeting_question', { p_question_id: questionId, p_status: status });
  if (error) throw error;
  return data as MeetingQuestion;
}

export async function upvoteMeetingQuestion(questionId: string) {
  const { data, error } = await supabase.rpc('upvote_meeting_question', { p_question_id: questionId });
  if (error) throw error;
  return data as MeetingQuestion;
}

export async function loadMeetingNotes(meetingId: string): Promise<MeetingNotes | null> {
  const { data, error } = await supabase
    .from('meeting_notes')
    .select('meeting_id, content, version, updated_at')
    .eq('meeting_id', meetingId)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as MeetingNotes | null) ?? null;
}

export async function saveMeetingNotes(meetingId: string, content: string, version: number) {
  const { data, error } = await supabase.rpc('save_meeting_notes', {
    p_meeting_id: meetingId,
    p_content: content,
    p_version: version,
  });
  if (error) throw error;
  return data as MeetingNotes;
}

export async function ensureWhiteboardPage(meetingId: string) {
  const { data, error } = await supabase.rpc('ensure_whiteboard_page', { p_meeting_id: meetingId });
  if (error) throw error;
  return data as WhiteboardPage;
}

export async function listWhiteboardOps(pageId: string): Promise<WhiteboardOp[]> {
  const { data, error } = await supabase
    .from('meeting_whiteboard_ops')
    .select('id, page_id, seq, op, created_at')
    .eq('page_id', pageId)
    .order('seq', { ascending: true })
    .limit(2000);
  if (error) throw error;
  return (data ?? []) as WhiteboardOp[];
}

export async function appendWhiteboardOp(pageId: string, op: WhiteboardOp['op']) {
  const { data, error } = await supabase.rpc('append_whiteboard_op', { p_page_id: pageId, p_op: op });
  if (error) throw error;
  return data as WhiteboardOp;
}

export async function requestMeetingRecording(meetingId: string) {
  const { data, error } = await supabase.rpc('request_meeting_recording', { p_meeting_id: meetingId });
  if (error) throw error;
  return data as MeetingRecording;
}

export async function requestStopRecording(recordingId: string) {
  const { data, error } = await supabase.rpc('request_stop_recording', { p_recording_id: recordingId });
  if (error) throw error;
  return data as MeetingRecording;
}

export async function listMeetingRecordings(meetingId: string): Promise<MeetingRecording[]> {
  const { data, error } = await supabase
    .from('meeting_recordings')
    .select('id, meeting_id, status, playback_url, error, created_at')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false });
  if (error) throw error;
  return (data ?? []) as MeetingRecording[];
}

export async function requestMeetingAiJob(meetingId: string, jobType: string, prompt?: string) {
  const { data, error } = await supabase.rpc('request_meeting_ai_job', {
    p_meeting_id: meetingId,
    p_job_type: jobType,
    p_prompt: prompt ?? null,
  });
  if (error) throw error;
  return data as MeetingAiJob;
}

export async function listMeetingAiJobs(meetingId: string): Promise<MeetingAiJob[]> {
  const { data, error } = await supabase
    .from('meeting_ai_jobs')
    .select('id, meeting_id, job_type, status, prompt, result, error, created_at')
    .eq('meeting_id', meetingId)
    .order('created_at', { ascending: false })
    .limit(20);
  if (error) throw error;
  return (data ?? []) as MeetingAiJob[];
}

export async function listOrganizationMembers(): Promise<OrganizationMemberRow[]> {
  const { data, error } = await supabase
    .from('organization_members')
    .select('id, user_id, role, status')
    .eq('status', 'active')
    .order('created_at', { ascending: true });
  if (error) throw error;
  return (data ?? []) as OrganizationMemberRow[];
}

export async function inviteOrganizationMember(email: string, role = 'member') {
  const { data, error } = await supabase.rpc('invite_organization_member', { p_email: email, p_role: role });
  if (error) throw error;
  return data;
}

export async function updateOrganizationMemberRole(memberId: string, role: string) {
  const { data, error } = await supabase.rpc('update_organization_member_role', { p_member_id: memberId, p_role: role });
  if (error) throw error;
  return data;
}

export async function loadOrganizationSettings(): Promise<OrganizationSettings | null> {
  const { data, error } = await supabase
    .from('organization_settings')
    .select('organization_id, retention_days, recordings_enabled')
    .limit(1)
    .maybeSingle();
  if (error && error.code !== 'PGRST116') throw error;
  return (data as OrganizationSettings | null) ?? null;
}

export async function updateOrganizationSettings(retentionDays: number, recordingsEnabled: boolean) {
  const { data, error } = await supabase.rpc('update_organization_settings', {
    p_retention_days: retentionDays,
    p_recordings_enabled: recordingsEnabled,
  });
  if (error) throw error;
  return data as OrganizationSettings;
}

export async function listAuditLogs(): Promise<AuditLogRow[]> {
  const { data, error } = await supabase
    .from('audit_logs')
    .select('id, action, resource_type, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as AuditLogRow[];
}

export async function listInAppNotifications(): Promise<InAppNotification[]> {
  const { data, error } = await supabase
    .from('in_app_notifications')
    .select('id, title, body, meeting_id, read_at, created_at')
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throw error;
  return (data ?? []) as InAppNotification[];
}
