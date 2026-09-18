-- Provider queue / token-path indexes. Additive only. Migrations 001-013 remain immutable.

CREATE INDEX IF NOT EXISTS idx_notification_jobs_claimable
  ON public.meeting_notification_jobs (status, scheduled_for, next_attempt_at)
  WHERE status IN ('pending', 'processing');

CREATE INDEX IF NOT EXISTS idx_ai_jobs_status_created
  ON public.meeting_ai_jobs (status, created_at)
  WHERE status IN ('queued', 'processing');

CREATE INDEX IF NOT EXISTS idx_transcripts_status_meeting
  ON public.meeting_transcripts (status, meeting_id);

CREATE INDEX IF NOT EXISTS idx_recordings_status_created
  ON public.meeting_recordings (status, created_at DESC)
  WHERE status IN ('queued', 'starting', 'active', 'processing');

CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting_status
  ON public.meeting_participants (meeting_id, status);
