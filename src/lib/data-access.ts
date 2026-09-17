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
  organization_id?: string | null;
  workspace_id?: string | null;
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

export async function getUserOrganizationContext(userId: string): Promise<UserOrganizationContext | null> {
  if (!userId) {
    return null;
  }

  const { data: membership, error: membershipError } = await supabase
    .from('organization_members')
    .select('organization_id, role, status, created_at')
    .eq('user_id', userId)
    .eq('status', 'active')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (membershipError && membershipError.code !== 'PGRST116') {
    throw membershipError;
  }

  if (!membership) {
    return null;
  }

  const { data: organization, error: organizationError } = await supabase
    .from('organizations')
    .select('id, name, slug')
    .eq('id', membership.organization_id)
    .maybeSingle();

  if (organizationError) {
    throw organizationError;
  }

  if (!organization) {
    return null;
  }

  const { data: workspace, error: workspaceError } = await supabase
    .from('workspaces')
    .select('id, name, slug')
    .eq('organization_id', membership.organization_id)
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (workspaceError && workspaceError.code !== 'PGRST116') {
    throw workspaceError;
  }

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

export async function listMeetingsForUser(userId: string): Promise<MeetingSummary[]> {
  const { data, error } = await supabase
    .from('meetings')
    .select('id, code, title, host_id, status, created_at, started_at, ended_at, organization_id, workspace_id')
    .eq('host_id', userId)
    .order('created_at', { ascending: false })
    .limit(20);

  if (error) throw error;
  return (data ?? []) as MeetingSummary[];
}

export async function listScheduledMeetingsForUser(userId: string): Promise<ScheduledMeetingSummary[]> {
  const { data, error } = await supabase
    .from('scheduled_meetings')
    .select('id, title, date, time, host_id, meeting_code, created_at, status, organization_id, workspace_id')
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
    .select('id, code, title, host_id, status, created_at, started_at, ended_at, organization_id, workspace_id')
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
    organization_id: input.organizationId ?? null,
    workspace_id: input.workspaceId ?? null,
  };

  const { data, error } = await supabase
    .from('meetings')
    .insert(payload)
    .select('id, code, title, host_id, status, organization_id, workspace_id, created_at')
    .maybeSingle();

  if (error) throw error;
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
    meeting_code: input.code ?? null,
    organization_id: input.organizationId ?? null,
    workspace_id: input.workspaceId ?? null,
  };

  const { data, error } = await supabase
    .from('scheduled_meetings')
    .insert(payload)
    .select('id, title, date, time, host_id, meeting_code, status, organization_id, workspace_id, created_at')
    .maybeSingle();

  if (error) throw error;
  return data;
}
