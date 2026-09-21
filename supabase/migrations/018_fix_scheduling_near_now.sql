-- Fix Schedule Meeting failure for meetings scheduled very close to "now".
-- Allows a 10-minute grace period for scheduled start times in the past.
-- This handles clock drift and users spending time on the schedule page.

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

  -- Allow 10-minute grace period for "near-now" scheduling
  IF v_scheduled_for < NOW() - INTERVAL '10 minutes' THEN
    RAISE EXCEPTION 'Meeting time must be in the future (or within 10 minutes of now)';
  END IF;

  -- Idempotency check: avoid duplicates if the user double-clicks or retries
  SELECT sm.* INTO v_scheduled
  FROM public.meetings m
  JOIN public.scheduled_meetings sm ON sm.meeting_code = m.code
  WHERE m.host_id = v_user_id
    AND m.title = trim(p_title)
    AND m.scheduled_for = v_scheduled_for
    AND m.status NOT IN ('ended', 'cancelled')
    AND m.created_at > NOW() - INTERVAL '1 minute'
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

REVOKE ALL ON FUNCTION public.schedule_persistent_meeting(TEXT, DATE, TEXT, TEXT, UUID, TEXT, INTEGER) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.schedule_persistent_meeting(TEXT, DATE, TEXT, TEXT, UUID, TEXT, INTEGER) TO authenticated;
