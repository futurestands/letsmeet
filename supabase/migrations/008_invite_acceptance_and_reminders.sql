-- Phase 4 completion: invite acceptance, reminder jobs, and lookup by code.
-- Additive only. Migrations 001-007 remain immutable.

ALTER TABLE public.meeting_notification_jobs
  ADD COLUMN IF NOT EXISTS recipient TEXT,
  ADD COLUMN IF NOT EXISTS next_attempt_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS sent_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS idempotency_key TEXT,
  ADD COLUMN IF NOT EXISTS max_attempts INTEGER NOT NULL DEFAULT 5;

ALTER TABLE public.meeting_notification_jobs
  DROP CONSTRAINT IF EXISTS meeting_notification_jobs_channel_check;
ALTER TABLE public.meeting_notification_jobs
  ADD CONSTRAINT meeting_notification_jobs_channel_check
  CHECK (channel IN ('email', 'sms', 'in_app'));

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conname = 'meeting_notification_jobs_idempotency_key'
      AND conrelid = 'public.meeting_notification_jobs'::regclass
  ) THEN
    ALTER TABLE public.meeting_notification_jobs
      ADD CONSTRAINT meeting_notification_jobs_idempotency_key UNIQUE (idempotency_key);
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_notification_jobs_next_attempt
  ON public.meeting_notification_jobs (status, next_attempt_at);

CREATE INDEX IF NOT EXISTS idx_meeting_invites_email_status
  ON public.meeting_invites (email, status);

CREATE INDEX IF NOT EXISTS idx_meetings_scheduled_for
  ON public.meetings (scheduled_for)
  WHERE scheduled_for IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_meetings_code_status
  ON public.meetings (code, status);

CREATE INDEX IF NOT EXISTS idx_meeting_participants_user_meeting
  ON public.meeting_participants (user_id, meeting_id);

CREATE OR REPLACE FUNCTION public.enqueue_notification_job(
  p_meeting_id UUID,
  p_invite_id UUID,
  p_organization_id UUID,
  p_workspace_id UUID,
  p_channel TEXT,
  p_template TEXT,
  p_recipient TEXT,
  p_scheduled_for TIMESTAMPTZ,
  p_idempotency_key TEXT
)
RETURNS UUID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_id UUID;
BEGIN
  IF p_idempotency_key IS NULL OR p_scheduled_for IS NULL THEN
    RETURN NULL;
  END IF;
  IF p_scheduled_for < NOW() - INTERVAL '1 minute' THEN
    RETURN NULL;
  END IF;

  INSERT INTO public.meeting_notification_jobs (
    meeting_id, invite_id, organization_id, workspace_id, channel, template, status,
    scheduled_for, next_attempt_at, recipient, idempotency_key
  )
  VALUES (
    p_meeting_id, p_invite_id, p_organization_id, p_workspace_id, p_channel, p_template, 'pending',
    p_scheduled_for, p_scheduled_for, p_recipient, p_idempotency_key
  )
  ON CONFLICT ON CONSTRAINT meeting_notification_jobs_idempotency_key
  DO UPDATE
    SET status = CASE
          WHEN public.meeting_notification_jobs.status IN ('cancelled', 'failed') THEN 'pending'
          ELSE public.meeting_notification_jobs.status
        END,
        scheduled_for = CASE
          WHEN public.meeting_notification_jobs.status IN ('cancelled', 'failed') THEN EXCLUDED.scheduled_for
          ELSE public.meeting_notification_jobs.scheduled_for
        END,
        next_attempt_at = CASE
          WHEN public.meeting_notification_jobs.status IN ('cancelled', 'failed') THEN EXCLUDED.next_attempt_at
          ELSE public.meeting_notification_jobs.next_attempt_at
        END,
        last_error = CASE
          WHEN public.meeting_notification_jobs.status IN ('cancelled', 'failed') THEN NULL
          ELSE public.meeting_notification_jobs.last_error
        END,
        attempt_count = CASE
          WHEN public.meeting_notification_jobs.status IN ('cancelled', 'failed') THEN 0
          ELSE public.meeting_notification_jobs.attempt_count
        END,
        invite_id = COALESCE(EXCLUDED.invite_id, public.meeting_notification_jobs.invite_id),
        recipient = COALESCE(EXCLUDED.recipient, public.meeting_notification_jobs.recipient),
        updated_at = NOW()
  RETURNING id INTO v_id;

  RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.enqueue_meeting_reminders(p_meeting public.meetings)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_host_email TEXT;
BEGIN
  IF p_meeting.scheduled_for IS NULL OR p_meeting.status IN ('ended', 'cancelled') THEN
    RETURN;
  END IF;

  SELECT email INTO v_host_email FROM public.users WHERE id = p_meeting.host_id;

  PERFORM public.enqueue_notification_job(
    p_meeting.id, NULL, p_meeting.organization_id, p_meeting.workspace_id,
    'in_app', 'reminder_24h', v_host_email, p_meeting.scheduled_for - INTERVAL '24 hours',
    p_meeting.id::text || ':reminder_24h:in_app'
  );
  PERFORM public.enqueue_notification_job(
    p_meeting.id, NULL, p_meeting.organization_id, p_meeting.workspace_id,
    'email', 'reminder_24h', v_host_email, p_meeting.scheduled_for - INTERVAL '24 hours',
    p_meeting.id::text || ':reminder_24h:email'
  );
  PERFORM public.enqueue_notification_job(
    p_meeting.id, NULL, p_meeting.organization_id, p_meeting.workspace_id,
    'in_app', 'reminder_1h', v_host_email, p_meeting.scheduled_for - INTERVAL '1 hour',
    p_meeting.id::text || ':reminder_1h:in_app'
  );
  PERFORM public.enqueue_notification_job(
    p_meeting.id, NULL, p_meeting.organization_id, p_meeting.workspace_id,
    'email', 'reminder_1h', v_host_email, p_meeting.scheduled_for - INTERVAL '1 hour',
    p_meeting.id::text || ':reminder_1h:email'
  );
  PERFORM public.enqueue_notification_job(
    p_meeting.id, NULL, p_meeting.organization_id, p_meeting.workspace_id,
    'in_app', 'reminder_15m', v_host_email, p_meeting.scheduled_for - INTERVAL '15 minutes',
    p_meeting.id::text || ':reminder_15m:in_app'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_joinable_meeting(p_code TEXT)
RETURNS public.meetings
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_meeting public.meetings;
  v_email TEXT;
  v_invited BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_code IS NULL OR upper(trim(p_code)) !~ '^LM-[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION 'Meeting code is invalid';
  END IF;

  SELECT * INTO v_meeting FROM public.meetings WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;

  SELECT lower(email) INTO v_email FROM public.users WHERE id = v_user_id;
  SELECT EXISTS (
    SELECT 1 FROM public.meeting_invites
    WHERE meeting_id = v_meeting.id
      AND email = v_email
      AND status IN ('pending', 'accepted')
  ) INTO v_invited;

  IF NOT public.is_org_member(v_user_id, v_meeting.organization_id)
     AND NOT v_invited THEN
    RAISE EXCEPTION 'Meeting access denied';
  END IF;

  RETURN v_meeting;
END;
$$;

CREATE OR REPLACE FUNCTION public.accept_meeting_invite(p_meeting_id UUID)
RETURNS public.meeting_invites
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_email TEXT;
  v_invite public.meeting_invites;
  v_meeting public.meetings;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  SELECT lower(email) INTO v_email FROM public.users WHERE id = v_user_id;
  SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;
  IF v_meeting.status IN ('ended', 'cancelled') THEN
    RAISE EXCEPTION 'This meeting is no longer active';
  END IF;

  UPDATE public.meeting_invites
  SET status = 'accepted',
      invited_user_id = v_user_id,
      updated_at = NOW()
  WHERE meeting_id = p_meeting_id
    AND email = v_email
    AND status IN ('pending', 'accepted')
  RETURNING * INTO v_invite;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invitation not found';
  END IF;
  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.fail_notification_job(p_job_id UUID, p_error TEXT)
RETURNS public.meeting_notification_jobs
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.meeting_notification_jobs;
BEGIN
  UPDATE public.meeting_notification_jobs
  SET attempt_count = attempt_count + 1,
      last_error = left(COALESCE(p_error, 'Delivery failed'), 500),
      status = CASE WHEN attempt_count + 1 >= max_attempts THEN 'failed' ELSE 'pending' END,
      next_attempt_at = CASE
        WHEN attempt_count + 1 >= max_attempts THEN next_attempt_at
        ELSE NOW() + (INTERVAL '1 minute' * power(2, GREATEST(attempt_count, 0)))
      END,
      updated_at = NOW()
  WHERE id = p_job_id
    AND status IN ('pending', 'processing')
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

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
  v_meeting public.meetings;
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

  IF v_scheduled_for < NOW() THEN
    RAISE EXCEPTION 'Meeting time must be in the future';
  END IF;

  SELECT sm.* INTO v_scheduled
  FROM public.meetings m
  JOIN public.scheduled_meetings sm ON sm.meeting_code = m.code
  WHERE m.host_id = v_user_id
    AND m.title = trim(p_title)
    AND m.scheduled_for = v_scheduled_for
    AND m.status NOT IN ('ended', 'cancelled')
    AND m.created_at > NOW() - INTERVAL '30 seconds'
  ORDER BY m.created_at DESC
  LIMIT 1;
  IF FOUND THEN
    RETURN v_scheduled;
  END IF;

  v_code := public.phase2_meeting_code();

  INSERT INTO public.meetings (
    code, title, host_id, organization_id, workspace_id, status, scheduled_for, description, duration_minutes
  )
  VALUES (
    v_code, trim(p_title), v_user_id, v_org_id, v_workspace_id, 'scheduled', v_scheduled_for, v_description, v_duration
  )
  RETURNING * INTO v_meeting;

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
  SELECT v_meeting.id, v_user_id, COALESCE(u.full_name, 'Meeting host'), v_org_id, v_workspace_id, 'host', 'waiting', NOW()
  FROM public.users u
  WHERE u.id = v_user_id
  ON CONFLICT ON CONSTRAINT meeting_participants_meeting_user_key DO NOTHING;

  PERFORM public.enqueue_meeting_reminders(v_meeting);

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

  IF v_scheduled_for < NOW() THEN
    RAISE EXCEPTION 'Meeting time must be in the future';
  END IF;

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

  UPDATE public.meeting_notification_jobs
  SET status = 'cancelled',
      updated_at = NOW()
  WHERE meeting_id = v_meeting.id
    AND template LIKE 'reminder_%'
    AND status IN ('pending', 'processing');

  PERFORM public.enqueue_meeting_reminders(v_meeting);

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

  PERFORM public.enqueue_notification_job(
    v_meeting.id, v_invite.id, v_meeting.organization_id, v_meeting.workspace_id,
    'email', 'meeting_invitation', v_email, NOW(),
    v_invite.id::text || ':invitation:email'
  );
  PERFORM public.enqueue_notification_job(
    v_meeting.id, v_invite.id, v_meeting.organization_id, v_meeting.workspace_id,
    'in_app', 'meeting_invitation', v_email, NOW(),
    v_invite.id::text || ':invitation:in_app'
  );
  IF v_meeting.scheduled_for IS NOT NULL THEN
    PERFORM public.enqueue_notification_job(
      v_meeting.id, v_invite.id, v_meeting.organization_id, v_meeting.workspace_id,
      'email', 'reminder_1h', v_email, v_meeting.scheduled_for - INTERVAL '1 hour',
      v_invite.id::text || ':reminder_1h:email'
    );
    PERFORM public.enqueue_notification_job(
      v_meeting.id, v_invite.id, v_meeting.organization_id, v_meeting.workspace_id,
      'email', 'reminder_15m', v_email, v_meeting.scheduled_for - INTERVAL '15 minutes',
      v_invite.id::text || ':reminder_15m:email'
    );
  END IF;

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
      idempotency_key = CASE
        WHEN idempotency_key IS NULL THEN NULL
        ELSE idempotency_key || ':revoked:' || id::text
      END,
      updated_at = NOW()
  WHERE invite_id = v_invite.id
    AND status IN ('pending', 'processing', 'sent');

  RETURN v_invite;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_persistent_meeting(p_code TEXT)
RETURNS TABLE (
  meeting_id UUID,
  meeting_code TEXT,
  title TEXT,
  host_id UUID,
  organization_id UUID,
  workspace_id UUID,
  meeting_status TEXT,
  scheduled_for TIMESTAMPTZ,
  started_at TIMESTAMPTZ,
  ended_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ,
  participant_id UUID,
  participant_role TEXT,
  participant_status TEXT
)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_meeting public.meetings;
  v_participant public.meeting_participants;
  v_name TEXT;
  v_role TEXT;
  v_status TEXT;
  v_email TEXT;
  v_invited BOOLEAN := FALSE;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_code IS NULL OR upper(trim(p_code)) !~ '^LM-[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION 'Meeting code is invalid';
  END IF;

  SELECT * INTO v_meeting FROM public.meetings m WHERE m.code = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;
  IF v_meeting.status IN ('ended', 'cancelled') THEN
    RAISE EXCEPTION 'Meeting is no longer joinable';
  END IF;

  SELECT lower(email) INTO v_email FROM public.users WHERE id = v_user_id;
  SELECT EXISTS (
    SELECT 1 FROM public.meeting_invites i
    WHERE i.meeting_id = v_meeting.id AND i.email = v_email AND i.status IN ('pending', 'accepted')
  ) INTO v_invited;

  IF NOT public.is_org_member(v_user_id, v_meeting.organization_id)
     AND NOT public.is_workspace_member(v_user_id, v_meeting.workspace_id)
     AND NOT v_invited THEN
    RAISE EXCEPTION 'Meeting access denied';
  END IF;

  SELECT * INTO v_participant
  FROM public.meeting_participants mp
  WHERE mp.meeting_id = v_meeting.id AND mp.user_id = v_user_id;
  IF FOUND AND v_participant.status = 'removed' THEN
    RAISE EXCEPTION 'Meeting access denied';
  END IF;

  IF v_meeting.status = 'scheduled' THEN
    UPDATE public.meetings
    SET status = 'waiting', updated_at = NOW()
    WHERE id = v_meeting.id AND status = 'scheduled'
    RETURNING * INTO v_meeting;
    PERFORM public.sync_scheduled_meeting_lifecycle(v_meeting);
  END IF;

  SELECT COALESCE(u.full_name, 'Meeting participant') INTO v_name
  FROM public.users u WHERE u.id = v_user_id;

  v_role := CASE WHEN v_meeting.host_id = v_user_id THEN 'host' ELSE 'participant' END;
  v_status := CASE
    WHEN v_meeting.host_id = v_user_id THEN 'joined'
    WHEN v_meeting.status = 'live' THEN 'joined'
    ELSE 'waiting'
  END;

  INSERT INTO public.meeting_participants (
    meeting_id, user_id, user_name, organization_id, workspace_id, role, status, joined_at, left_at
  )
  VALUES (
    v_meeting.id, v_user_id, v_name, v_meeting.organization_id, v_meeting.workspace_id,
    v_role, v_status, NOW(), NULL
  )
  ON CONFLICT ON CONSTRAINT meeting_participants_meeting_user_key DO UPDATE
    SET user_name = EXCLUDED.user_name,
        status = CASE
          WHEN public.meeting_participants.status = 'removed' THEN public.meeting_participants.status
          WHEN v_meeting.host_id = v_user_id THEN 'joined'
          WHEN v_meeting.status = 'live' THEN 'joined'
          ELSE 'waiting'
        END,
        role = CASE WHEN v_meeting.host_id = v_user_id THEN 'host' ELSE public.meeting_participants.role END,
        joined_at = COALESCE(public.meeting_participants.joined_at, NOW()),
        left_at = NULL,
        updated_at = NOW()
  RETURNING * INTO v_participant;

  IF v_participant.status = 'removed' THEN
    RAISE EXCEPTION 'Meeting access denied';
  END IF;

  UPDATE public.meeting_invites
  SET status = 'accepted', invited_user_id = v_user_id, updated_at = NOW()
  WHERE public.meeting_invites.meeting_id = v_meeting.id AND email = v_email AND status = 'pending';

  RETURN QUERY SELECT
    v_meeting.id, v_meeting.code, v_meeting.title, v_meeting.host_id,
    v_meeting.organization_id, v_meeting.workspace_id, v_meeting.status,
    v_meeting.scheduled_for, v_meeting.started_at, v_meeting.ended_at, v_meeting.created_at,
    v_participant.id, v_participant.role, v_participant.status;
END;
$$;

REVOKE ALL ON FUNCTION public.enqueue_notification_job(UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, TIMESTAMPTZ, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.enqueue_meeting_reminders(public.meetings) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_joinable_meeting(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.accept_meeting_invite(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.fail_notification_job(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_persistent_meeting(TEXT, DATE, TEXT, TEXT, UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.update_scheduled_meeting(UUID, TEXT, DATE, TEXT, TEXT, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.invite_to_persistent_meeting(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.revoke_meeting_invite(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_persistent_meeting(TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.lookup_joinable_meeting(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.accept_meeting_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_persistent_meeting(TEXT, DATE, TEXT, TEXT, UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.update_scheduled_meeting(UUID, TEXT, DATE, TEXT, TEXT, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.invite_to_persistent_meeting(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.revoke_meeting_invite(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_persistent_meeting(TEXT) TO authenticated;

DROP POLICY IF EXISTS "Invited users can view invited meetings" ON public.meetings;
CREATE POLICY "Invited users can view invited meetings" ON public.meetings
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meeting_invites i
    JOIN public.users u ON lower(u.email) = i.email
    WHERE i.meeting_id = public.meetings.id
      AND u.id = auth.uid()
      AND i.status IN ('pending', 'accepted')
  )
);
