-- Recordings, transcripts, AI jobs, analytics, audit, and organization administration.
-- Additive only. Migrations 001-009 remain immutable.

CREATE TABLE IF NOT EXISTS public.organization_settings (
  organization_id UUID PRIMARY KEY REFERENCES public.organizations(id) ON DELETE CASCADE,
  retention_days INTEGER NOT NULL DEFAULT 90 CHECK (retention_days BETWEEN 1 AND 3650),
  recordings_enabled BOOLEAN NOT NULL DEFAULT TRUE,
  transcription_enabled BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.organization_invites (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('admin', 'member', 'guest')),
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'revoked')),
  invited_by UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, email)
);

CREATE TABLE IF NOT EXISTS public.audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  actor_id UUID REFERENCES public.users(id),
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  metadata JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_recordings (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  started_by UUID NOT NULL REFERENCES public.users(id),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'starting', 'active', 'processing', 'completed', 'failed')),
  egress_id TEXT,
  storage_provider TEXT,
  storage_key TEXT,
  playback_url TEXT,
  error TEXT,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_transcripts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  recording_id UUID REFERENCES public.meeting_recordings(id) ON DELETE SET NULL,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  provider TEXT,
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'unconfigured')),
  content TEXT,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_transcript_segments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  transcript_id UUID NOT NULL REFERENCES public.meeting_transcripts(id) ON DELETE CASCADE,
  speaker_user_id UUID REFERENCES public.users(id),
  speaker_name TEXT,
  started_ms INTEGER NOT NULL DEFAULT 0,
  ended_ms INTEGER NOT NULL DEFAULT 0,
  body TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_ai_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  requested_by UUID NOT NULL REFERENCES public.users(id),
  job_type TEXT NOT NULL CHECK (job_type IN (
    'summary', 'executive_summary', 'action_items', 'decisions', 'topics', 'transcript_qa'
  )),
  status TEXT NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'unconfigured')),
  prompt TEXT,
  result JSONB,
  error TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  completed_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS public.meeting_attendance_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  event_type TEXT NOT NULL CHECK (event_type IN ('join', 'leave', 'remove')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.in_app_notifications (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  meeting_id UUID REFERENCES public.meetings(id) ON DELETE CASCADE,
  read_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_audit_logs_org_created
  ON public.audit_logs (organization_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_recordings_meeting_status
  ON public.meeting_recordings (meeting_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcripts_meeting
  ON public.meeting_transcripts (meeting_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_transcript_segments_search
  ON public.meeting_transcript_segments (transcript_id, started_ms);
CREATE INDEX IF NOT EXISTS idx_ai_jobs_meeting
  ON public.meeting_ai_jobs (meeting_id, status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_attendance_meeting_user
  ON public.meeting_attendance_events (meeting_id, user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_in_app_notifications_user
  ON public.in_app_notifications (user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_org_invites_email
  ON public.organization_invites (email, status);
CREATE INDEX IF NOT EXISTS idx_organization_members_user
  ON public.organization_members (user_id, organization_id);

ALTER TABLE public.organization_settings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_invites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_recordings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_transcripts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_transcript_segments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_ai_jobs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_attendance_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.in_app_notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.require_meeting_access(p_meeting_id UUID)
RETURNS public.meetings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_meeting public.meetings;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;
  IF v_meeting.status = 'cancelled' THEN
    RAISE EXCEPTION 'This meeting is no longer available';
  END IF;
  IF v_meeting.host_id IS DISTINCT FROM v_user_id
     AND NOT public.is_org_member(v_user_id, v_meeting.organization_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.meeting_participants mp
       WHERE mp.meeting_id = v_meeting.id AND mp.user_id = v_user_id
     )
     AND NOT EXISTS (
       SELECT 1 FROM public.meeting_invites i
       JOIN public.users u ON lower(u.email) = i.email
       WHERE i.meeting_id = v_meeting.id AND u.id = v_user_id AND i.status IN ('pending', 'accepted')
     ) THEN
    RAISE EXCEPTION 'Meeting access denied';
  END IF;
  RETURN v_meeting;
END;
$$;

CREATE OR REPLACE FUNCTION public.write_audit_log(
  p_organization_id UUID,
  p_action TEXT,
  p_resource_type TEXT,
  p_resource_id TEXT,
  p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  INSERT INTO public.audit_logs (organization_id, actor_id, action, resource_type, resource_id, metadata)
  VALUES (p_organization_id, auth.uid(), p_action, p_resource_type, p_resource_id, COALESCE(p_metadata, '{}'::jsonb));
END;
$$;

CREATE OR REPLACE FUNCTION public.request_meeting_recording(p_meeting_id UUID)
RETURNS public.meeting_recordings
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_row public.meeting_recordings;
BEGIN
  v_meeting := public.require_active_meeting_participant(p_meeting_id);
  IF v_meeting.host_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the host can start recording';
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.meeting_recordings
    WHERE meeting_id = v_meeting.id AND status IN ('queued', 'starting', 'active', 'processing')
  ) THEN
    RAISE EXCEPTION 'A recording is already in progress';
  END IF;

  INSERT INTO public.meeting_recordings (
    meeting_id, organization_id, workspace_id, started_by, status
  )
  VALUES (
    v_meeting.id, v_meeting.organization_id, v_meeting.workspace_id, auth.uid(), 'queued'
  )
  RETURNING * INTO v_row;

  PERFORM public.write_audit_log(v_meeting.organization_id, 'recording.requested', 'meeting_recording', v_row.id::text, jsonb_build_object('meeting_id', v_meeting.id));
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_stop_recording(p_recording_id UUID)
RETURNS public.meeting_recordings
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_row public.meeting_recordings;
  v_meeting public.meetings;
BEGIN
  SELECT * INTO v_row FROM public.meeting_recordings WHERE id = p_recording_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Recording not found';
  END IF;
  v_meeting := public.require_meeting_access(v_row.meeting_id);
  IF v_meeting.host_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the host can stop recording';
  END IF;
  IF v_row.status NOT IN ('queued', 'starting', 'active') THEN
    RAISE EXCEPTION 'This recording cannot be stopped';
  END IF;
  UPDATE public.meeting_recordings
  SET status = CASE WHEN status = 'queued' THEN 'failed' ELSE 'processing' END,
      error = CASE WHEN status = 'queued' THEN 'Stopped before an egress provider was available' ELSE error END,
      ended_at = NOW(),
      updated_at = NOW()
  WHERE id = v_row.id
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.request_meeting_ai_job(
  p_meeting_id UUID,
  p_job_type TEXT,
  p_prompt TEXT DEFAULT NULL
)
RETURNS public.meeting_ai_jobs
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_row public.meeting_ai_jobs;
BEGIN
  IF p_job_type NOT IN ('summary', 'executive_summary', 'action_items', 'decisions', 'topics', 'transcript_qa') THEN
    RAISE EXCEPTION 'Unsupported AI job type';
  END IF;
  v_meeting := public.require_meeting_access(p_meeting_id);
  IF NOT EXISTS (
    SELECT 1 FROM public.meeting_transcripts
    WHERE meeting_id = v_meeting.id AND status = 'completed'
  ) AND p_job_type <> 'transcript_qa' THEN
    -- still allow queueing; processor will fail honestly if no transcript exists
    NULL;
  END IF;

  INSERT INTO public.meeting_ai_jobs (
    meeting_id, organization_id, workspace_id, requested_by, job_type, prompt, status
  )
  VALUES (
    v_meeting.id, v_meeting.organization_id, v_meeting.workspace_id, auth.uid(), p_job_type, NULLIF(trim(COALESCE(p_prompt, '')), ''), 'queued'
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_organization_member(p_email TEXT, p_role TEXT DEFAULT 'member')
RETURNS public.organization_invites
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := lower(trim(p_email));
  v_role TEXT := COALESCE(NULLIF(trim(p_role), ''), 'member');
  v_org UUID;
  v_invite public.organization_invites;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Invitation email is invalid';
  END IF;
  IF v_role NOT IN ('admin', 'member', 'guest') THEN
    RAISE EXCEPTION 'Role is invalid';
  END IF;

  SELECT organization_id INTO v_org
  FROM public.organization_members
  WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')
  ORDER BY created_at
  LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Only organization owners or admins can invite members';
  END IF;

  INSERT INTO public.organization_invites (organization_id, email, role, invited_by)
  VALUES (v_org, v_email, v_role, auth.uid())
  ON CONFLICT (organization_id, email)
  DO UPDATE
    SET status = CASE WHEN public.organization_invites.status = 'revoked' THEN 'pending' ELSE public.organization_invites.status END,
        role = EXCLUDED.role,
        updated_at = NOW()
  RETURNING * INTO v_invite;

  PERFORM public.write_audit_log(v_org, 'organization.invite', 'organization_invite', v_invite.id::text, jsonb_build_object('email', v_email, 'role', v_role));
  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_organization_member_role(p_member_id UUID, p_role TEXT)
RETURNS public.organization_members
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_member public.organization_members;
  v_actor public.organization_members;
BEGIN
  IF p_role NOT IN ('admin', 'member', 'guest') THEN
    RAISE EXCEPTION 'Role is invalid';
  END IF;
  SELECT * INTO v_member FROM public.organization_members WHERE id = p_member_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Member not found';
  END IF;
  SELECT * INTO v_actor
  FROM public.organization_members
  WHERE organization_id = v_member.organization_id AND user_id = auth.uid() AND status = 'active';
  IF NOT FOUND OR v_actor.role NOT IN ('owner', 'admin') THEN
    RAISE EXCEPTION 'Only organization owners or admins can change roles';
  END IF;
  IF v_member.role = 'owner' THEN
    RAISE EXCEPTION 'The organization owner role cannot be changed this way';
  END IF;

  UPDATE public.organization_members
  SET role = p_role, updated_at = NOW()
  WHERE id = v_member.id
  RETURNING * INTO v_member;
  PERFORM public.write_audit_log(v_member.organization_id, 'organization.role_change', 'organization_member', v_member.id::text, jsonb_build_object('role', p_role));
  RETURN v_member;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_organization_settings(p_retention_days INTEGER, p_recordings_enabled BOOLEAN)
RETURNS public.organization_settings
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_org UUID;
  v_row public.organization_settings;
BEGIN
  SELECT organization_id INTO v_org
  FROM public.organization_members
  WHERE user_id = auth.uid() AND status = 'active' AND role IN ('owner', 'admin')
  ORDER BY created_at
  LIMIT 1;
  IF v_org IS NULL THEN
    RAISE EXCEPTION 'Only organization owners or admins can update settings';
  END IF;
  IF p_retention_days IS NULL OR p_retention_days < 1 OR p_retention_days > 3650 THEN
    RAISE EXCEPTION 'Retention days are invalid';
  END IF;

  INSERT INTO public.organization_settings (organization_id, retention_days, recordings_enabled)
  VALUES (v_org, p_retention_days, COALESCE(p_recordings_enabled, TRUE))
  ON CONFLICT (organization_id) DO UPDATE
    SET retention_days = EXCLUDED.retention_days,
        recordings_enabled = EXCLUDED.recordings_enabled,
        updated_at = NOW()
  RETURNING * INTO v_row;
  PERFORM public.write_audit_log(v_org, 'organization.settings', 'organization_settings', v_org::text, jsonb_build_object('retention_days', p_retention_days));
  RETURN v_row;
END;
$$;

DROP POLICY IF EXISTS "Org settings readable to members" ON public.organization_settings;
CREATE POLICY "Org settings readable to members" ON public.organization_settings
FOR SELECT USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Org invites readable to admins" ON public.organization_invites;
CREATE POLICY "Org invites readable to admins" ON public.organization_invites
FOR SELECT USING (public.is_org_owner_or_admin(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Audit logs readable to admins" ON public.audit_logs;
CREATE POLICY "Audit logs readable to admins" ON public.audit_logs
FOR SELECT USING (public.is_org_owner_or_admin(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Recordings readable to meeting members" ON public.meeting_recordings;
CREATE POLICY "Recordings readable to meeting members" ON public.meeting_recordings
FOR SELECT USING (
  public.is_org_member(auth.uid(), organization_id)
  OR EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meeting_recordings.meeting_id AND mp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Transcripts readable to meeting members" ON public.meeting_transcripts;
CREATE POLICY "Transcripts readable to meeting members" ON public.meeting_transcripts
FOR SELECT USING (
  public.is_org_member(auth.uid(), organization_id)
  OR EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meeting_transcripts.meeting_id AND mp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Transcript segments readable with transcript" ON public.meeting_transcript_segments;
CREATE POLICY "Transcript segments readable with transcript" ON public.meeting_transcript_segments
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meeting_transcripts t
    WHERE t.id = meeting_transcript_segments.transcript_id
      AND (
        public.is_org_member(auth.uid(), t.organization_id)
        OR EXISTS (
          SELECT 1 FROM public.meeting_participants mp
          WHERE mp.meeting_id = t.meeting_id AND mp.user_id = auth.uid()
        )
      )
  )
);

DROP POLICY IF EXISTS "AI jobs readable to meeting members" ON public.meeting_ai_jobs;
CREATE POLICY "AI jobs readable to meeting members" ON public.meeting_ai_jobs
FOR SELECT USING (
  public.is_org_member(auth.uid(), organization_id)
  OR EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meeting_ai_jobs.meeting_id AND mp.user_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Attendance readable to org members" ON public.meeting_attendance_events;
CREATE POLICY "Attendance readable to org members" ON public.meeting_attendance_events
FOR SELECT USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Users can read their in-app notifications" ON public.in_app_notifications;
CREATE POLICY "Users can read their in-app notifications" ON public.in_app_notifications
FOR SELECT USING (user_id = auth.uid());

REVOKE ALL ON FUNCTION public.require_meeting_access(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.write_audit_log(UUID, TEXT, TEXT, TEXT, JSONB) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_meeting_recording(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_stop_recording(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.request_meeting_ai_job(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invite_organization_member(TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_organization_member_role(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_organization_settings(INTEGER, BOOLEAN) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.request_meeting_recording(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_stop_recording(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.request_meeting_ai_job(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_organization_member(TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_organization_member_role(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_organization_settings(INTEGER, BOOLEAN) TO authenticated;

GRANT SELECT ON public.organization_settings TO authenticated;
GRANT SELECT ON public.organization_invites TO authenticated;
GRANT SELECT ON public.audit_logs TO authenticated;
GRANT SELECT ON public.meeting_recordings TO authenticated;
GRANT SELECT ON public.meeting_transcripts TO authenticated;
GRANT SELECT ON public.meeting_transcript_segments TO authenticated;
GRANT SELECT ON public.meeting_ai_jobs TO authenticated;
GRANT SELECT ON public.meeting_attendance_events TO authenticated;
GRANT SELECT ON public.in_app_notifications TO authenticated;
