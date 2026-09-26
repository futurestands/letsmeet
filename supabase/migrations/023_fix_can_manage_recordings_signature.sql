-- Migration 023: Fix can_manage_recordings signature to accept optional p_user_id.
-- Additive and corrective.

CREATE OR REPLACE FUNCTION public.can_manage_recordings(
  p_meeting_id UUID,
  p_user_id UUID DEFAULT auth.uid()
)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := COALESCE(p_user_id, auth.uid());
  v_meeting public.meetings;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  -- Only host or org admin/owner can manage recordings
  RETURN v_meeting.host_id = v_user_id OR public.is_org_owner_or_admin(v_user_id, v_meeting.organization_id);
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_recordings(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_recordings(UUID, UUID) TO authenticated;
