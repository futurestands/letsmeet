-- Production hardening: extra indexes, notification claim, and audit on lifecycle.
-- Additive only. Migrations 001-010 remain immutable.

CREATE INDEX IF NOT EXISTS idx_meeting_invites_meeting_status
  ON public.meeting_invites (meeting_id, status);

CREATE INDEX IF NOT EXISTS idx_meetings_org_status_scheduled
  ON public.meetings (organization_id, status, scheduled_for);

CREATE INDEX IF NOT EXISTS idx_poll_votes_poll
  ON public.meeting_poll_votes (poll_id);

CREATE INDEX IF NOT EXISTS idx_whiteboard_ops_meeting_seq
  ON public.meeting_whiteboard_ops (meeting_id, seq);

CREATE INDEX IF NOT EXISTS idx_in_app_notifications_unread
  ON public.in_app_notifications (user_id, created_at DESC)
  WHERE read_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_chat_messages_meeting_id_created
  ON public.chat_messages (meeting_id, created_at)
  WHERE deleted_at IS NULL;

CREATE OR REPLACE FUNCTION public.claim_notification_job(p_job_id UUID)
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
  SET status = 'processing',
      updated_at = NOW()
  WHERE id = p_job_id
    AND status = 'pending'
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.complete_notification_job(
  p_job_id UUID,
  p_provider TEXT,
  p_provider_message_id TEXT DEFAULT NULL
)
RETURNS public.meeting_notification_jobs
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_job public.meeting_notification_jobs;
BEGIN
  IF NULLIF(trim(p_provider), '') IS NULL THEN
    RAISE EXCEPTION 'A delivery provider is required to mark a notification sent';
  END IF;

  UPDATE public.meeting_notification_jobs
  SET status = 'sent',
      provider = trim(p_provider),
      provider_message_id = NULLIF(trim(COALESCE(p_provider_message_id, '')), ''),
      sent_at = NOW(),
      last_error = NULL,
      updated_at = NOW()
  WHERE id = p_job_id
    AND status IN ('pending', 'processing')
  RETURNING * INTO v_job;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notification job could not be completed';
  END IF;
  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_notification_job(p_job_id UUID)
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
  SET status = 'pending',
      updated_at = NOW()
  WHERE id = p_job_id
    AND status = 'processing'
  RETURNING * INTO v_job;
  RETURN v_job;
END;
$$;

CREATE OR REPLACE FUNCTION public.audit_sensitive_meeting_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.status IS DISTINCT FROM OLD.status AND NEW.status IN ('cancelled', 'ended') THEN
    PERFORM public.write_audit_log(
      NEW.organization_id,
      'meeting.' || NEW.status,
      'meeting',
      NEW.id::text,
      jsonb_build_object('code', NEW.code, 'from', OLD.status)
    );
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meetings_audit_status ON public.meetings;
CREATE TRIGGER meetings_audit_status
AFTER UPDATE OF status ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION public.audit_sensitive_meeting_change();

CREATE OR REPLACE FUNCTION public.audit_invite_change()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.write_audit_log(
    NEW.organization_id,
    CASE
      WHEN TG_OP = 'INSERT' THEN 'meeting.invite'
      WHEN NEW.status = 'revoked' THEN 'meeting.invite_revoked'
      ELSE 'meeting.invite_updated'
    END,
    'meeting_invite',
    NEW.id::text,
    jsonb_build_object('meeting_id', NEW.meeting_id, 'status', NEW.status)
  );
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_invites_audit ON public.meeting_invites;
CREATE TRIGGER meeting_invites_audit
AFTER INSERT OR UPDATE OF status ON public.meeting_invites
FOR EACH ROW
EXECUTE FUNCTION public.audit_invite_change();

REVOKE ALL ON FUNCTION public.claim_notification_job(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.complete_notification_job(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.release_notification_job(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_sensitive_meeting_change() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.audit_invite_change() FROM PUBLIC;
