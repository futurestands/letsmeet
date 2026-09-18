-- Guest share-link join without organization membership.
-- Additive only. Migrations 001-014 remain immutable.

CREATE OR REPLACE FUNCTION public.is_guest_user(p_user_id UUID DEFAULT auth.uid())
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid UUID := COALESCE(p_user_id, auth.uid());
BEGIN
  IF v_uid IS NULL THEN
    RETURN FALSE;
  END IF;

  IF v_uid = auth.uid()
     AND COALESCE((auth.jwt() -> 'user_metadata' ->> 'guest')::boolean, FALSE) THEN
    RETURN TRUE;
  END IF;

  RETURN EXISTS (
    SELECT 1
    FROM public.users u
    WHERE u.id = v_uid
      AND lower(u.email) LIKE 'guest-%@guest.letsmeet.invalid'
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_guest_profile(p_display_name TEXT)
RETURNS public.users
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_name TEXT := left(trim(COALESCE(p_display_name, '')), 80);
  v_email TEXT;
  v_row public.users;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF v_name IS NULL OR length(v_name) < 2 THEN
    RAISE EXCEPTION 'Enter a display name to join as a guest';
  END IF;
  IF NOT public.is_guest_user(v_user_id) THEN
    RAISE EXCEPTION 'Only guest sessions can use ensure_guest_profile';
  END IF;

  SELECT email INTO v_email FROM auth.users WHERE id = v_user_id;
  INSERT INTO public.users (id, email, full_name, created_at)
  VALUES (v_user_id, COALESCE(v_email, v_user_id::text || '@guest.letsmeet.invalid'), v_name, NOW())
  ON CONFLICT (id) DO UPDATE
    SET full_name = EXCLUDED.full_name
  RETURNING * INTO v_row;

  -- Guests must never receive organization membership via this path.
  DELETE FROM public.organization_members
  WHERE user_id = v_user_id
    AND organization_id IN (
      SELECT id FROM public.organizations WHERE created_by = v_user_id
    )
    AND role = 'owner'
    AND invited_by = v_user_id;

  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.lookup_meeting_share_link(p_code TEXT)
RETURNS TABLE (
  id UUID,
  code TEXT,
  title TEXT,
  status TEXT,
  host_id UUID,
  organization_id UUID,
  workspace_id UUID,
  scheduled_for TIMESTAMPTZ
)
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF p_code IS NULL OR upper(trim(p_code)) !~ '^LM-[A-Z0-9]{6}$' THEN
    RAISE EXCEPTION 'Meeting code is invalid';
  END IF;

  SELECT * INTO v_meeting FROM public.meetings WHERE code = upper(trim(p_code));
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;
  IF v_meeting.status IN ('ended', 'cancelled') THEN
    RAISE EXCEPTION 'This meeting is no longer joinable';
  END IF;
  IF v_meeting.status NOT IN ('scheduled', 'waiting', 'live') THEN
    RAISE EXCEPTION 'This meeting is not available';
  END IF;

  RETURN QUERY SELECT
    v_meeting.id,
    v_meeting.code,
    v_meeting.title,
    v_meeting.status,
    v_meeting.host_id,
    v_meeting.organization_id,
    v_meeting.workspace_id,
    v_meeting.scheduled_for;
END;
$$;

CREATE OR REPLACE FUNCTION public.join_meeting_by_share_link(
  p_code TEXT,
  p_display_name TEXT DEFAULT NULL
)
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
  v_status TEXT;
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
  IF v_meeting.status NOT IN ('scheduled', 'waiting', 'live') THEN
    RAISE EXCEPTION 'Meeting is not available';
  END IF;

  -- Share-link guests may join without org membership. Existing org/invite join still works via join_persistent_meeting.
  IF NOT public.is_guest_user(v_user_id)
     AND NOT public.is_org_member(v_user_id, v_meeting.organization_id)
     AND NOT public.is_workspace_member(v_user_id, v_meeting.workspace_id)
     AND NOT EXISTS (
       SELECT 1 FROM public.meeting_invites i
       JOIN public.users u ON lower(u.email) = i.email
       WHERE i.meeting_id = v_meeting.id
         AND u.id = v_user_id
         AND i.status IN ('pending', 'accepted')
     ) THEN
    RAISE EXCEPTION 'Meeting access denied';
  END IF;

  SELECT * INTO v_participant
  FROM public.meeting_participants mp
  WHERE mp.meeting_id = v_meeting.id AND mp.user_id = v_user_id;
  IF FOUND AND v_participant.status = 'removed' THEN
    RAISE EXCEPTION 'Meeting access denied';
  END IF;

  IF v_meeting.host_id = v_user_id THEN
    RAISE EXCEPTION 'Hosts should use the standard join path';
  END IF;

  IF public.is_guest_user(v_user_id) THEN
    PERFORM public.ensure_guest_profile(COALESCE(p_display_name, 'Meeting guest'));
  END IF;

  IF v_meeting.status = 'scheduled' THEN
    UPDATE public.meetings
    SET status = 'waiting', updated_at = NOW()
    WHERE id = v_meeting.id AND status = 'scheduled'
    RETURNING * INTO v_meeting;
  END IF;

  SELECT COALESCE(NULLIF(trim(p_display_name), ''), u.full_name, 'Meeting guest')
  INTO v_name
  FROM public.users u
  WHERE u.id = v_user_id;

  v_status := CASE WHEN v_meeting.status = 'live' THEN 'joined' ELSE 'waiting' END;

  INSERT INTO public.meeting_participants (
    meeting_id, user_id, user_name, organization_id, workspace_id, role, status, joined_at, left_at
  )
  VALUES (
    v_meeting.id, v_user_id, left(v_name, 80), v_meeting.organization_id, v_meeting.workspace_id,
    'participant', v_status, NOW(), NULL
  )
  ON CONFLICT ON CONSTRAINT meeting_participants_meeting_user_key DO UPDATE
    SET user_name = EXCLUDED.user_name,
        status = CASE
          WHEN public.meeting_participants.status = 'removed' THEN public.meeting_participants.status
          WHEN v_meeting.status = 'live' THEN 'joined'
          ELSE 'waiting'
        END,
        role = 'participant',
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

REVOKE ALL ON FUNCTION public.is_guest_user(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_guest_profile(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.lookup_meeting_share_link(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.join_meeting_by_share_link(TEXT, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.is_guest_user(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_guest_profile(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.lookup_meeting_share_link(TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.join_meeting_by_share_link(TEXT, TEXT) TO authenticated;
