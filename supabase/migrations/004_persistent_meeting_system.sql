-- Phase 2 persistent meeting system.
-- Additive only. Migrations 001-003 remain immutable.

DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.meetings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.meetings DROP CONSTRAINT %I', r.conname);
  END LOOP;

  FOR r IN
    SELECT conname
    FROM pg_constraint
    WHERE conrelid = 'public.scheduled_meetings'::regclass
      AND contype = 'c'
      AND pg_get_constraintdef(oid) ILIKE '%status%'
  LOOP
    EXECUTE format('ALTER TABLE public.scheduled_meetings DROP CONSTRAINT %I', r.conname);
  END LOOP;
END
$$;

ALTER TABLE public.meetings
  ADD CONSTRAINT meetings_status_check
  CHECK (status IN ('scheduled', 'waiting', 'live', 'ended', 'cancelled'));

ALTER TABLE public.scheduled_meetings
  ADD CONSTRAINT scheduled_meetings_status_check
  CHECK (status IN ('scheduled', 'waiting', 'live', 'ended', 'cancelled'));

ALTER TABLE public.scheduled_meetings
  ADD COLUMN IF NOT EXISTS timezone TEXT NOT NULL DEFAULT 'UTC',
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS started_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS ended_at TIMESTAMPTZ;

DROP INDEX IF EXISTS public.idx_meeting_participants_meeting_user;
CREATE UNIQUE INDEX idx_meeting_participants_meeting_user
  ON public.meeting_participants (meeting_id, user_id);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'meeting_participants_meeting_user_key'
      AND conrelid = 'public.meeting_participants'::regclass
  ) THEN
    ALTER TABLE public.meeting_participants
      ADD CONSTRAINT meeting_participants_meeting_user_key
      UNIQUE USING INDEX idx_meeting_participants_meeting_user;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_meetings_status_created
  ON public.meetings (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meetings_host_created
  ON public.meetings (host_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_host_date
  ON public.scheduled_meetings (host_id, date, time);
CREATE UNIQUE INDEX IF NOT EXISTS idx_scheduled_meetings_code
  ON public.scheduled_meetings (meeting_code)
  WHERE meeting_code IS NOT NULL;

CREATE OR REPLACE FUNCTION public.phase2_meeting_code()
RETURNS TEXT
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_alphabet TEXT := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  v_bytes BYTEA;
  v_code TEXT;
  i INTEGER;
BEGIN
  LOOP
    v_bytes := gen_random_bytes(6);
    v_code := 'LM-';
    FOR i IN 0..5 LOOP
      v_code := v_code || substr(v_alphabet, (get_byte(v_bytes, i) % 32) + 1, 1);
    END LOOP;
    EXIT WHEN NOT EXISTS (SELECT 1 FROM public.meetings m WHERE m.code = v_code)
      AND NOT EXISTS (SELECT 1 FROM public.scheduled_meetings sm WHERE sm.meeting_code = v_code);
  END LOOP;
  RETURN v_code;
END;
$$;

CREATE OR REPLACE FUNCTION public.sync_scheduled_meeting_lifecycle(p_meeting public.meetings)
RETURNS VOID
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE public.scheduled_meetings
  SET status = p_meeting.status,
      started_at = CASE
        WHEN p_meeting.status = 'live' THEN COALESCE(started_at, p_meeting.started_at, NOW())
        ELSE started_at
      END,
      ended_at = CASE
        WHEN p_meeting.status IN ('ended', 'cancelled') THEN COALESCE(ended_at, p_meeting.ended_at, NOW())
        ELSE ended_at
      END,
      updated_at = NOW()
  WHERE meeting_code = p_meeting.code;
END;
$$;

CREATE OR REPLACE FUNCTION public.reject_client_meeting_writes()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF current_user IN ('authenticated', 'anon') THEN
    RAISE EXCEPTION 'Meeting records must be changed through the persistent meeting API';
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

DROP TRIGGER IF EXISTS meetings_reject_client_writes ON public.meetings;
CREATE TRIGGER meetings_reject_client_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_client_meeting_writes();

DROP TRIGGER IF EXISTS scheduled_meetings_reject_client_writes ON public.scheduled_meetings;
CREATE TRIGGER scheduled_meetings_reject_client_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.scheduled_meetings
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_client_meeting_writes();

DROP TRIGGER IF EXISTS meeting_participants_reject_client_writes ON public.meeting_participants;
CREATE TRIGGER meeting_participants_reject_client_writes
  BEFORE INSERT OR UPDATE OR DELETE ON public.meeting_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.reject_client_meeting_writes();

CREATE OR REPLACE FUNCTION public.resolve_user_tenant_context(p_workspace_id UUID DEFAULT NULL)
RETURNS TABLE (organization_id UUID, workspace_id UUID)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_workspace_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  -- Phase 2 uses the user's oldest active membership as the current tenant.
  -- Clients cannot choose another organization.
  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_user_id AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'An active organization membership is required';
  END IF;

  IF p_workspace_id IS NULL THEN
    SELECT w.id INTO v_workspace_id
    FROM public.workspaces w
    WHERE w.organization_id = v_org_id
    ORDER BY w.created_at ASC
    LIMIT 1;
  ELSE
    SELECT w.id INTO v_workspace_id
    FROM public.workspaces w
    WHERE w.id = p_workspace_id
      AND w.organization_id = v_org_id
      AND public.is_workspace_member(v_user_id, w.id);
  END IF;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'A workspace in the active organization is required';
  END IF;

  organization_id := v_org_id;
  workspace_id := v_workspace_id;
  RETURN NEXT;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_persistent_meeting(
  p_title TEXT DEFAULT 'New meeting',
  p_workspace_id UUID DEFAULT NULL
)
RETURNS public.meetings
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_workspace_id UUID;
  v_meeting public.meetings;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT t.organization_id, t.workspace_id INTO v_org_id, v_workspace_id
  FROM public.resolve_user_tenant_context(p_workspace_id) t;

  INSERT INTO public.meetings (code, title, host_id, organization_id, workspace_id, status)
  VALUES (
    public.phase2_meeting_code(),
    COALESCE(NULLIF(trim(p_title), ''), 'New meeting'),
    v_user_id,
    v_org_id,
    v_workspace_id,
    'waiting'
  )
  RETURNING * INTO v_meeting;

  INSERT INTO public.meeting_participants (
    meeting_id, user_id, user_name, organization_id, workspace_id, role, status, joined_at, left_at
  )
  SELECT v_meeting.id, v_user_id, COALESCE(u.full_name, 'Meeting host'), v_org_id, v_workspace_id, 'host', 'joined', NOW(), NULL
  FROM public.users u
  WHERE u.id = v_user_id
  ON CONFLICT ON CONSTRAINT meeting_participants_meeting_user_key DO UPDATE
    SET role = 'host',
        status = 'joined',
        left_at = NULL,
        updated_at = NOW();

  RETURN v_meeting;
END;
$$;

CREATE OR REPLACE FUNCTION public.schedule_persistent_meeting(
  p_title TEXT,
  p_date DATE,
  p_time TEXT,
  p_timezone TEXT DEFAULT 'UTC',
  p_workspace_id UUID DEFAULT NULL
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF NULLIF(trim(p_title), '') IS NULL OR p_date IS NULL OR NULLIF(trim(p_time), '') IS NULL THEN
    RAISE EXCEPTION 'Title, date, and time are required';
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

  INSERT INTO public.meetings (code, title, host_id, organization_id, workspace_id, status, scheduled_for)
  VALUES (v_code, trim(p_title), v_user_id, v_org_id, v_workspace_id, 'scheduled', v_scheduled_for);

  INSERT INTO public.scheduled_meetings (
    title, date, time, host_id, meeting_code, organization_id, workspace_id, status, timezone, scheduled_for
  )
  VALUES (
    trim(p_title), p_date, trim(p_time), v_user_id, v_code, v_org_id, v_workspace_id, 'scheduled', v_tz, v_scheduled_for
  )
  RETURNING * INTO v_scheduled;

  RETURN v_scheduled;
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
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_code IS NULL OR upper(trim(p_code)) !~ '^LM-[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION 'Meeting code is invalid';
  END IF;

  SELECT * INTO v_meeting
  FROM public.meetings m
  WHERE m.code = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;
  IF v_meeting.status IN ('ended', 'cancelled') THEN
    RAISE EXCEPTION 'Meeting is no longer joinable';
  END IF;
  IF NOT public.is_org_member(v_user_id, v_meeting.organization_id)
     OR NOT public.is_workspace_member(v_user_id, v_meeting.workspace_id) THEN
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
  FROM public.users u
  WHERE u.id = v_user_id;

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
        role = CASE
          WHEN v_meeting.host_id = v_user_id THEN 'host'
          ELSE public.meeting_participants.role
        END,
        joined_at = COALESCE(public.meeting_participants.joined_at, NOW()),
        left_at = NULL,
        updated_at = NOW()
  RETURNING * INTO v_participant;

  IF v_participant.status = 'removed' THEN
    RAISE EXCEPTION 'Meeting access denied';
  END IF;

  RETURN QUERY SELECT
    v_meeting.id, v_meeting.code, v_meeting.title, v_meeting.host_id,
    v_meeting.organization_id, v_meeting.workspace_id, v_meeting.status,
    v_meeting.scheduled_for, v_meeting.started_at, v_meeting.ended_at, v_meeting.created_at,
    v_participant.id, v_participant.role, v_participant.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.leave_persistent_meeting(p_meeting_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  UPDATE public.meeting_participants
  SET status = 'left',
      left_at = COALESCE(left_at, NOW()),
      updated_at = NOW()
  WHERE meeting_id = p_meeting_id
    AND user_id = v_user_id
    AND status IS DISTINCT FROM 'removed';

  RETURN FOUND;
END;
$$;

CREATE OR REPLACE FUNCTION public.transition_persistent_meeting(p_meeting_id UUID, p_status TEXT)
RETURNS public.meetings
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT * INTO v_meeting
  FROM public.meetings
  WHERE id = p_meeting_id AND host_id = auth.uid();
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the meeting host can change lifecycle state';
  END IF;

  IF p_status NOT IN ('waiting', 'live', 'ended', 'cancelled') THEN
    RAISE EXCEPTION 'Invalid lifecycle state';
  END IF;
  IF NOT (
    (v_meeting.status = 'scheduled' AND p_status IN ('waiting', 'cancelled')) OR
    (v_meeting.status = 'waiting' AND p_status IN ('live', 'cancelled', 'ended')) OR
    (v_meeting.status = 'live' AND p_status IN ('ended', 'cancelled'))
  ) THEN
    RAISE EXCEPTION 'Invalid lifecycle transition';
  END IF;

  UPDATE public.meetings
  SET status = p_status,
      started_at = CASE WHEN p_status = 'live' THEN COALESCE(started_at, NOW()) ELSE started_at END,
      ended_at = CASE WHEN p_status IN ('ended', 'cancelled') THEN COALESCE(ended_at, NOW()) ELSE ended_at END,
      updated_at = NOW()
  WHERE id = p_meeting_id
  RETURNING * INTO v_meeting;

  PERFORM public.sync_scheduled_meeting_lifecycle(v_meeting);
  RETURN v_meeting;
END;
$$;

REVOKE ALL ON FUNCTION public.phase2_meeting_code() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.sync_scheduled_meeting_lifecycle(public.meetings) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.reject_client_meeting_writes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_user_tenant_context(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_persistent_meeting(TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.schedule_persistent_meeting(TEXT, DATE, TEXT, TEXT, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_persistent_meeting(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.leave_persistent_meeting(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.transition_persistent_meeting(UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.resolve_user_tenant_context(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_persistent_meeting(TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.schedule_persistent_meeting(TEXT, DATE, TEXT, TEXT, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_persistent_meeting(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.leave_persistent_meeting(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.transition_persistent_meeting(UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can create meetings in their org" ON public.meetings;
DROP POLICY IF EXISTS "Hosts can update meetings without tenant changes" ON public.meetings;
DROP POLICY IF EXISTS "Persistent meetings are readable to org members" ON public.meetings;

DROP POLICY IF EXISTS "Authenticated users can create scheduled meetings in their org" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Hosts can update scheduled meetings without tenant changes" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Hosts can delete scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Persistent scheduled meetings are readable to org members" ON public.scheduled_meetings;

DROP POLICY IF EXISTS "Users can join a meeting as a participant only" ON public.meeting_participants;
DROP POLICY IF EXISTS "Participants can update their own attendance state" ON public.meeting_participants;
