-- Harden recording and transcription lifecycle with updated statuses and helper functions.
-- Additive and corrective.

-- 1. Update meeting_recordings status check
ALTER TABLE public.meeting_recordings DROP CONSTRAINT IF EXISTS meeting_recordings_status_check;
ALTER TABLE public.meeting_recordings ADD CONSTRAINT meeting_recordings_status_check
  CHECK (status IN ('queued', 'starting', 'active', 'stopping', 'completed', 'failed', 'cancelled'));

-- 2. Ensure meeting_transcripts has robust status check
ALTER TABLE public.meeting_transcripts DROP CONSTRAINT IF EXISTS meeting_transcripts_status_check;
ALTER TABLE public.meeting_transcripts ADD CONSTRAINT meeting_transcripts_status_check
  CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'unconfigured'));

-- 3. Ensure meeting_ai_jobs has robust status check
ALTER TABLE public.meeting_ai_jobs DROP CONSTRAINT IF EXISTS meeting_ai_jobs_status_check;
ALTER TABLE public.meeting_ai_jobs ADD CONSTRAINT meeting_ai_jobs_status_check
  CHECK (status IN ('queued', 'processing', 'completed', 'failed', 'unconfigured'));

-- 4. Helper function to check if a user can manage recordings
CREATE OR REPLACE FUNCTION public.can_manage_recordings(p_meeting_id UUID)
RETURNS BOOLEAN
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

REVOKE ALL ON FUNCTION public.can_manage_recordings(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_recordings(UUID) TO authenticated;

-- 5. Audit sensitive recording changes
CREATE OR REPLACE FUNCTION public.audit_recording_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status THEN
    PERFORM public.write_audit_log(
      NEW.organization_id,
      'recording.' || NEW.status,
      'meeting_recording',
      NEW.id::text,
      jsonb_build_object('meeting_id', NEW.meeting_id, 'from', OLD.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_recordings_audit ON public.meeting_recordings;
CREATE TRIGGER meeting_recordings_audit
AFTER UPDATE OF status ON public.meeting_recordings
FOR EACH ROW
EXECUTE FUNCTION public.audit_recording_change();

-- 6. Helper function to request meeting transcription
CREATE OR REPLACE FUNCTION public.request_meeting_transcription(p_meeting_id UUID, p_recording_id UUID DEFAULT NULL)
RETURNS public.meeting_transcripts
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_row public.meeting_transcripts;
BEGIN
  v_meeting := public.require_meeting_access(p_meeting_id);

  -- Only host or admin
  IF v_meeting.host_id IS DISTINCT FROM auth.uid() AND NOT public.is_org_owner_or_admin(auth.uid(), v_meeting.organization_id) THEN
    RAISE EXCEPTION 'Only the host or admin can request transcription';
  END IF;

  INSERT INTO public.meeting_transcripts (
    meeting_id, recording_id, organization_id, workspace_id, status
  )
  VALUES (
    v_meeting.id, p_recording_id, v_meeting.organization_id, v_meeting.workspace_id, 'queued'
  )
  RETURNING * INTO v_row;

  PERFORM public.write_audit_log(v_meeting.organization_id, 'transcription.requested', 'meeting_transcript', v_row.id::text, jsonb_build_object('meeting_id', v_meeting.id));
  RETURN v_row;
END;
$$;

REVOKE ALL ON FUNCTION public.request_meeting_transcription(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.request_meeting_transcription(UUID, UUID) TO authenticated;

REVOKE ALL ON FUNCTION public.audit_recording_change() FROM PUBLIC;
