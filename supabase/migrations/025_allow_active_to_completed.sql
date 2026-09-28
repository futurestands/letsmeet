-- Migration 025: Allow active -> completed in the recording state machine.
-- Rationale: LiveKit can report EGRESS_COMPLETE while the row is still 'active'
-- (e.g. egress ends without a prior stop request). Forward-only change; migration 022
-- is intentionally left as originally applied. Idempotent (CREATE OR REPLACE).
-- The trigger from 022 already points at this function, so no trigger DDL is needed.

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
      IF NEW.status NOT IN ('stopping', 'completed', 'failed') THEN
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
