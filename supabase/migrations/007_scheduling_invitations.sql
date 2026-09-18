-- Phase 4 scheduling, invitations, and notification jobs.
-- Additive only. Migrations 001-006 remain immutable.

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS description TEXT,
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 30;

ALTER TABLE public.scheduled_meetings
  ADD COLUMN IF NOT EXISTS duration_minutes INTEGER NOT NULL DEFAULT 30;

ALTER TABLE public.meeting_invites
  ADD COLUMN IF NOT EXISTS invited_user_id UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS invited_by UUID REFERENCES public.users(id),
  ADD COLUMN IF NOT EXISTS revoked_at TIMESTAMPTZ;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meeting_invites_status_check'
      AND conrelid = 'public.meeting_invites'::regclass
  ) THEN
    ALTER TABLE public.meeting_invites
      ADD CONSTRAINT meeting_invites_status_check
      CHECK (status IN ('pending', 'accepted', 'declined', 'revoked'));
  END IF;
END
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_meeting_invites_meeting_email_unique
  ON public.meeting_invites (meeting_id, email);

CREATE TABLE IF NOT EXISTS public.meeting_notification_jobs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  invite_id UUID REFERENCES public.meeting_invites(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  channel TEXT NOT NULL CHECK (channel IN ('email', 'in_app')),
  template TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'sent', 'failed', 'cancelled')),
  scheduled_for TIMESTAMPTZ NOT NULL,
  attempt_count INTEGER NOT NULL DEFAULT 0,
  last_error TEXT,
  provider TEXT,
  provider_message_id TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE public.meeting_notification_jobs ENABLE ROW LEVEL SECURITY;

CREATE INDEX IF NOT EXISTS idx_notification_jobs_pending
  ON public.meeting_notification_jobs (status, scheduled_for);

DROP POLICY IF EXISTS "Notification jobs are readable to org members" ON public.meeting_notification_jobs;
CREATE POLICY "Notification jobs are readable to org members"
ON public.meeting_notification_jobs
FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));

CREATE OR REPLACE TRIGGER meeting_notification_jobs_set_updated_at
BEFORE UPDATE ON public.meeting_notification_jobs
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE FUNCTION public.phase4_can_manage_meeting(p_meeting public.meetings)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p_meeting.host_id = auth.uid()
    OR public.is_org_owner_or_admin(auth.uid(), p_meeting.organization_id);
$$;

DROP FUNCTION IF EXISTS public.schedule_persistent_meeting(TEXT, DATE, TEXT, TEXT, UUID);

CREATE OR REPLACE FUNCTION public.schedule_persistent_meeting(
  p_title TEXT,
  p_date DATE,
  p_time TEXT,
  p_timezone TEXT DEFAULT 'UTC',
  p_workspace_id UUID DEFAULT NULL,
  p_description TEXT DEFAULT NULL,
  p_duration_minutes INTEGER DEFAULT 30
)
RETURNS public.scheduled_meetings
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_workspace_id UUID;
  v_code TEXT;
  v_tz TEXT;
  v_scheduled_for TIMESTAMPTZ;
  v_scheduled public.scheduled_meetings;
  v_duration INTEGER := COALESCE(p_duration_minutes, 30);
  v_description TEXT := NULLIF(trim(COALESCE(p_description, '')), '');
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF NULLIF(trim(p_title), '') IS NULL OR p_date IS NULL OR NULLIF(trim(p_time), '') IS NULL THEN
    RAISE EXCEPTION 'Title, date, and time are required';
  END IF;
  IF v_duration NOT IN (15, 30, 45, 60, 90, 120) THEN
    RAISE EXCEPTION 'Duration is invalid';
  END IF;

  SELECT t.organization_id, t.workspace_id INTO v_org_id, v_workspace_id
  FROM public.resolve_user_tenant_context(p_workspace_id) t;

  v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');
  BEGIN
    v_scheduled_for := (p_date::TIMESTAMP + trim(p_time)::TIME) AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid meeting date, time, or timezone';
  END;

  v_code := public.phase2_meeting_code();

  INSERT INTO public.meetings (
    code, title, host_id, organization_id, workspace_id, status, scheduled_for, description, duration_minutes
  )
  VALUES (
    v_code, trim(p_title), v_user_id, v_org_id, v_workspace_id, 'scheduled', v_scheduled_for, v_description, v_duration
  );

  INSERT INTO public.scheduled_meetings (
    title, date, time, host_id, meeting_code, organization_id, workspace_id, status, timezone, scheduled_for, description, duration, duration_minutes
  )
  VALUES (
    trim(p_title), p_date, trim(p_time), v_user_id, v_code, v_org_id, v_workspace_id, 'scheduled', v_tz, v_scheduled_for, v_description, v_duration::TEXT, v_duration
  )
  RETURNING * INTO v_scheduled;

  INSERT INTO public.meeting_participants (
    meeting_id, user_id, user_name, organization_id, workspace_id, role, status, joined_at
  )
  SELECT m.id, v_user_id, COALESCE(u.full_name, 'Meeting host'), v_org_id, v_workspace_id, 'host', 'waiting', NOW()
  FROM public.meetings m
  JOIN public.users u ON u.id = v_user_id
  WHERE m.code = v_code
  ON CONFLICT ON CONSTRAINT meeting_participants_meeting_user_key DO NOTHING;

  RETURN v_scheduled;
END;
$$;

CREATE OR REPLACE FUNCTION public.update_scheduled_meeting(
  p_meeting_id UUID,
  p_title TEXT,
  p_date DATE,
  p_time TEXT,
  p_timezone TEXT,
  p_description TEXT DEFAULT NULL,
  p_duration_minutes INTEGER DEFAULT 30
)
RETURNS public.meetings
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_tz TEXT;
  v_scheduled_for TIMESTAMPTZ;
  v_duration INTEGER := COALESCE(p_duration_minutes, 30);
  v_description TEXT := NULLIF(trim(COALESCE(p_description, '')), '');
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF v_duration NOT IN (15, 30, 45, 60, 90, 120) THEN
    RAISE EXCEPTION 'Duration is invalid';
  END IF;

  SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;
  IF NOT public.phase4_can_manage_meeting(v_meeting) THEN
    RAISE EXCEPTION 'Only the organizer can change this meeting';
  END IF;
  IF v_meeting.status NOT IN ('scheduled', 'waiting') THEN
    RAISE EXCEPTION 'This meeting can no longer be rescheduled';
  END IF;

  v_tz := COALESCE(NULLIF(trim(p_timezone), ''), 'UTC');
  BEGIN
    v_scheduled_for := (p_date::TIMESTAMP + trim(p_time)::TIME) AT TIME ZONE v_tz;
  EXCEPTION WHEN OTHERS THEN
    RAISE EXCEPTION 'Invalid meeting date, time, or timezone';
  END;

  UPDATE public.meetings
  SET title = trim(p_title),
      description = v_description,
      duration_minutes = v_duration,
      scheduled_for = v_scheduled_for,
      updated_at = NOW()
  WHERE id = v_meeting.id
  RETURNING * INTO v_meeting;

  UPDATE public.scheduled_meetings
  SET title = trim(p_title),
      date = p_date,
      time = trim(p_time),
      timezone = v_tz,
      scheduled_for = v_scheduled_for,
      description = v_description,
      duration = v_duration::TEXT,
      duration_minutes = v_duration,
      updated_at = NOW()
  WHERE meeting_code = v_meeting.code;

  RETURN v_meeting;
END;
$$;

CREATE OR REPLACE FUNCTION public.invite_to_persistent_meeting(
  p_meeting_id UUID,
  p_email TEXT
)
RETURNS public.meeting_invites
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_email TEXT := lower(trim(p_email));
  v_invite public.meeting_invites;
  v_user UUID;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF v_email IS NULL OR v_email !~ '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$' THEN
    RAISE EXCEPTION 'Invitation email is invalid';
  END IF;

  SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;
  IF NOT public.phase4_can_manage_meeting(v_meeting) THEN
    RAISE EXCEPTION 'Only the organizer can invite people to this meeting';
  END IF;
  IF v_meeting.status IN ('ended', 'cancelled') THEN
    RAISE EXCEPTION 'This meeting is no longer active';
  END IF;

  SELECT id INTO v_user FROM public.users WHERE lower(email) = v_email;

  INSERT INTO public.meeting_invites (
    meeting_id, email, status, organization_id, workspace_id, invited_user_id, invited_by
  )
  VALUES (
    v_meeting.id, v_email, 'pending', v_meeting.organization_id, v_meeting.workspace_id, v_user, auth.uid()
  )
  ON CONFLICT (meeting_id, email)
  DO UPDATE
    SET status = CASE WHEN public.meeting_invites.status = 'revoked' THEN 'pending' ELSE public.meeting_invites.status END,
        invited_user_id = COALESCE(EXCLUDED.invited_user_id, public.meeting_invites.invited_user_id),
        revoked_at = CASE WHEN public.meeting_invites.status = 'revoked' THEN NULL ELSE public.meeting_invites.revoked_at END,
        updated_at = NOW()
  RETURNING * INTO v_invite;

  INSERT INTO public.meeting_notification_jobs (
    meeting_id, invite_id, organization_id, workspace_id, channel, template, status, scheduled_for
  )
  VALUES (
    v_meeting.id,
    v_invite.id,
    v_meeting.organization_id,
    v_meeting.workspace_id,
    'email',
    'meeting_invitation',
    'pending',
    COALESCE(v_meeting.scheduled_for - INTERVAL '15 minutes', NOW())
  );

  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_meeting_invite(
  p_invite_id UUID
)
RETURNS public.meeting_invites
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_invite public.meeting_invites;
  v_meeting public.meetings;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT * INTO v_invite FROM public.meeting_invites WHERE id = p_invite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  SELECT * INTO v_meeting FROM public.meetings WHERE id = v_invite.meeting_id;
  IF NOT public.phase4_can_manage_meeting(v_meeting) THEN
    RAISE EXCEPTION 'Only the organizer can revoke this invitation';
  END IF;

  UPDATE public.meeting_invites
  SET status = 'revoked',
      revoked_at = NOW(),
      updated_at = NOW()
  WHERE id = v_invite.id
  RETURNING * INTO v_invite;

  UPDATE public.meeting_notification_jobs
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE invite_id = v_invite.id
    AND status IN ('pending', 'processing');

  RETURN v_invite;
END;
$$;

DROP POLICY IF EXISTS "Meeting hosts and org admins can create invites" ON public.meeting_invites;
DROP POLICY IF EXISTS "Invites can be updated by hosts or org admins" ON public.meeting_invites;

REVOKE ALL ON FUNCTION public.phase4_can_manage_meeting(public.meetings) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_persistent_meeting(TEXT, DATE, TEXT, TEXT, UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_scheduled_meeting(UUID, TEXT, DATE, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invite_to_persistent_meeting(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_meeting_invite(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.schedule_persistent_meeting(TEXT, DATE, TEXT, TEXT, UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_scheduled_meeting(UUID, TEXT, DATE, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_to_persistent_meeting(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_meeting_invite(UUID) TO authenticated;
GRANT SELECT ON public.meeting_notification_jobs TO authenticated;
