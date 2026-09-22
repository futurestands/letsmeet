-- Fix host mute & waiting room durability: preserve 'muted' and 'waiting' status across joins, share-link joins, and reconnects.
-- Also align moderate_persistent_participant RPC with unmute and admit actions.

CREATE OR REPLACE FUNCTION public.moderate_persistent_participant(
  p_meeting_id UUID,
  p_participant_user_id UUID,
  p_action TEXT
)
RETURNS public.meeting_participants
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_participant public.meeting_participants;
BEGIN
  IF auth.uid() IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  SELECT * INTO v_meeting
  FROM public.meetings
  WHERE id = p_meeting_id
    AND host_id = auth.uid()
    AND status IN ('waiting', 'live');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the active meeting host can moderate participants';
  END IF;
  IF p_participant_user_id = v_meeting.host_id THEN
    RAISE EXCEPTION 'The host cannot be moderated';
  END IF;
  IF p_action NOT IN ('mute', 'unmute', 'remove', 'admit') THEN
    RAISE EXCEPTION 'Unsupported moderation action';
  END IF;

  UPDATE public.meeting_participants
  SET status = CASE
        WHEN p_action = 'remove' THEN 'removed'
        WHEN p_action IN ('unmute', 'admit') THEN 'joined'
        ELSE 'muted'
      END,
      left_at = CASE WHEN p_action = 'remove' THEN NOW() ELSE left_at END,
      updated_at = NOW()
  WHERE meeting_id = v_meeting.id
    AND user_id = p_participant_user_id
    AND organization_id = v_meeting.organization_id
    AND workspace_id = v_meeting.workspace_id
    AND role <> 'host'
    AND status IN ('joined', 'waiting', 'muted')
  RETURNING * INTO v_participant;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Participant not found';
  END IF;

  RETURN v_participant;
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
          WHEN public.meeting_participants.status IN ('removed', 'muted', 'waiting')
               AND v_meeting.host_id IS DISTINCT FROM v_user_id
            THEN public.meeting_participants.status
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
  WHERE meeting_id = v_meeting.id AND email = v_email AND status = 'pending';

  RETURN QUERY SELECT
    v_meeting.id, v_meeting.code, v_meeting.title, v_meeting.host_id,
    v_meeting.organization_id, v_meeting.workspace_id, v_meeting.status,
    v_meeting.scheduled_for, v_meeting.started_at, v_meeting.ended_at, v_meeting.created_at,
    v_participant.id, v_participant.role, v_participant.status;
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
          WHEN public.meeting_participants.status IN ('removed', 'muted', 'waiting')
            THEN public.meeting_participants.status
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

REVOKE ALL ON FUNCTION public.moderate_persistent_participant(UUID, UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.moderate_persistent_participant(UUID, UUID, TEXT) TO authenticated;
