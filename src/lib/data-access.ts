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

const meetingSelect = 'id, code, title, host_id, status, created_at, scheduled_for, started_at, ended_at, organization_id, workspace_id, is_locked, locked_at';
const scheduledMeetingSelect = 'id, title, date, time, timezone, host_id, meeting_code, created_at, scheduled_for, status, organization_id, workspace_id';
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

export async function listChatMessages(meetingId: string): Promise<ChatMessage[]> {
  const { data, error } = await supabase
    .from('chat_messages')
    .select('id, meeting_id, user_id, user_name, message, created_at')
    .eq('meeting_id', meetingId)
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
}): Promise<ScheduledMeetingSummary> {
  const { data, error } = await supabase.rpc('schedule_persistent_meeting', {
    p_title: input.title,
    p_date: input.date,
    p_time: input.time,
    p_timezone: input.timezone,
    p_workspace_id: input.workspaceId ?? null,
  });
  if (error) throw error;
  return data as ScheduledMeetingSummary;
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
