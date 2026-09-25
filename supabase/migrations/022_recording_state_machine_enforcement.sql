-- Migration 022: Database-level recording state machine transition enforcement and atomic start concurrency index.
-- Additive and corrective.

-- 1. Atomic Start Concurrency: Ensure only ONE active/starting/stopping recording can exist per meeting in PostgreSQL
CREATE UNIQUE INDEX IF NOT EXISTS idx_one_active_recording_per_meeting
  ON public.meeting_recordings (meeting_id)
  WHERE status IN ('starting', 'active', 'stopping');

-- 2. State machine transition validator function
CREATE OR REPLACE FUNCTION public.enforce_recording_status_transition()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  -- Idempotent self-transition (no status change) is always allowed
  IF NEW.status IS NOT DISTINCT FROM OLD.status THEN
    RETURN NEW;
  END IF;

  -- Validate allowed transitions from OLD.status to NEW.status
  CASE OLD.status
    WHEN 'queued' THEN
      IF NEW.status NOT IN ('starting', 'cancelled', 'failed') THEN
        RAISE EXCEPTION 'Illegal recording status transition from queued to %', NEW.status;
      END IF;
    WHEN 'starting' THEN
      IF NEW.status NOT IN ('active', 'failed', 'cancelled') THEN
        RAISE EXCEPTION 'Illegal recording status transition from starting to %', NEW.status;
      END IF;
    WHEN 'active' THEN
      IF NEW.status NOT IN ('stopping', 'failed') THEN
        RAISE EXCEPTION 'Illegal recording status transition from active to %', NEW.status;
      END IF;
    WHEN 'stopping' THEN
      IF NEW.status NOT IN ('completed', 'failed', 'active') THEN
        RAISE EXCEPTION 'Illegal recording status transition from stopping to %', NEW.status;
      END IF;
    WHEN 'failed' THEN
      IF NEW.status NOT IN ('queued', 'starting') THEN
        RAISE EXCEPTION 'Illegal recording status transition from failed to %', NEW.status;
      END IF;
    WHEN 'completed' THEN
      RAISE EXCEPTION 'Illegal recording status transition from completed to % (terminal state)', NEW.status;
    WHEN 'cancelled' THEN
      RAISE EXCEPTION 'Illegal recording status transition from cancelled to % (terminal state)', NEW.status;
    ELSE
      RAISE EXCEPTION 'Unknown recording status %', OLD.status;
  END CASE;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.enforce_recording_status_transition() FROM PUBLIC;

-- 3. Trigger on meeting_recordings
DROP TRIGGER IF EXISTS trg_enforce_recording_status_transition ON public.meeting_recordings;
CREATE TRIGGER trg_enforce_recording_status_transition
BEFORE UPDATE OF status ON public.meeting_recordings
FOR EACH ROW
EXECUTE FUNCTION public.enforce_recording_status_transition();
