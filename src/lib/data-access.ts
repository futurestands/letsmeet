import { supabase } from './supabase';

export type MeetingSummary = {
  id: string;
  code: string;
  title: string;
  host_id: string;
  status?: string | null;
  created_at?: string | null;
  started_at?: string | null;
  ended_at?: string | null;
  organization_id?: string | null;
  workspace_id?: string | null;
};

export type ScheduledMeetingSummary = {
  id: string;
  title: string;
  date: string;
  time: string;
  host_id: string;
  meeting_code?: string | null;
  created_at?: string | null;
  status?: string | null;
};

export async function listMeetingsForUser(userId: string): Promise<MeetingSummary[]> {
  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('host_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data ?? []) as MeetingSummary[];
}

export async function listScheduledMeetingsForUser(userId: string): Promise<ScheduledMeetingSummary[]> {
  const { data, error } = await supabase
    .from('scheduled_meetings')
    .select('*')
    .eq('host_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data ?? []) as ScheduledMeetingSummary[];
}

export async function findMeetingByCode(code: string): Promise<MeetingSummary | null> {
  const normalizedCode = String(code || '').trim();
  if (!normalizedCode) return null;

  const { data, error } = await supabase
    .from('meetings')
    .select('*')
    .eq('code', normalizedCode)
    .maybeSingle();

  if (error && error.code !== 'PGRST116') {
    throw error;
  }

  return (data as MeetingSummary | null) ?? null;
}

export async function createMeetingRecord(input: {
  title: string;
  hostId: string;
  code: string;
  status?: string;
  organizationId?: string | null;
  workspaceId?: string | null;
}) {
  const payload: Record<string, string | null | undefined> = {
    title: input.title,
    code: input.code,
    host_id: input.hostId,
    status: input.status ?? 'live',
  };

  if (input.organizationId) payload.organization_id = input.organizationId;
  if (input.workspaceId) payload.workspace_id = input.workspaceId;

  const { data, error } = await supabase
    .from('meetings')
    .insert(payload)
    .select()
    .maybeSingle();

  if (error) {
    const compatiblePayload: Record<string, string | boolean | null | undefined> = {
      title: input.title,
      code: input.code,
      host_id: input.hostId,
      is_active: true,
    };

    if (input.organizationId) compatiblePayload.organization_id = input.organizationId;
    if (input.workspaceId) compatiblePayload.workspace_id = input.workspaceId;

    const fallback = await supabase
      .from('meetings')
      .insert(compatiblePayload)
      .select()
      .maybeSingle();

    if (fallback.error) throw fallback.error;
    return fallback.data;
  }

  return data;
}

export async function createScheduledMeeting(input: {
  title: string;
  date: string;
  time: string;
  hostId: string;
  code?: string | null;
  organizationId?: string | null;
  workspaceId?: string | null;
}) {
  const payload: Record<string, string | null | undefined> = {
    title: input.title,
    date: input.date,
    time: input.time,
    host_id: input.hostId,
    duration: '30',
    status: 'scheduled',
  };

  if (input.code) payload.meeting_code = input.code;
  if (input.organizationId) payload.organization_id = input.organizationId;
  if (input.workspaceId) payload.workspace_id = input.workspaceId;

  const { data, error } = await supabase
    .from('scheduled_meetings')
    .insert(payload)
    .select()
    .maybeSingle();

  if (error) {
    const fallback: Record<string, string | null | undefined> = {
      title: input.title,
      date: input.date,
      time: input.time,
      host_id: input.hostId,
      duration: '30',
      meeting_type: 'video',
    };

    if (input.code) fallback.meeting_code = input.code;
    if (input.organizationId) fallback.organization_id = input.organizationId;
    if (input.workspaceId) fallback.workspace_id = input.workspaceId;

    const fallbackResult = await supabase
      .from('scheduled_meetings')
      .insert(fallback)
      .select()
      .maybeSingle();

    if (fallbackResult.error) throw fallbackResult.error;
    return fallbackResult.data;
  }

  return data;
}
