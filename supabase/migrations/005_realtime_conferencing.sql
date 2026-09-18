-- Phase 3 realtime conferencing support.
-- Durable chat, meeting locking, and host moderation remain database-authoritative.

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS is_locked BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS locked_at TIMESTAMPTZ;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meetings;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
    BEGIN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_participants;
    EXCEPTION WHEN duplicate_object THEN
      NULL;
    END;
  END IF;
END
$$;

CREATE INDEX IF NOT EXISTS idx_chat_messages_meeting_created
  ON public.chat_messages (meeting_id, created_at DESC);

CREATE OR REPLACE FUNCTION public.enforce_meeting_lock_on_participant_insert()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
BEGIN
  SELECT * INTO v_meeting
  FROM public.meetings
  WHERE id = NEW.meeting_id;

  IF v_meeting.is_locked
     AND NEW.user_id IS DISTINCT FROM v_meeting.host_id
     AND NOT EXISTS (
       SELECT 1
       FROM public.meeting_participants mp
       WHERE mp.meeting_id = NEW.meeting_id
         AND mp.user_id = NEW.user_id
     ) THEN
    RAISE EXCEPTION 'Meeting is locked';
  END IF;

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS meeting_participants_enforce_lock ON public.meeting_participants;
CREATE TRIGGER meeting_participants_enforce_lock
  BEFORE INSERT ON public.meeting_participants
  FOR EACH ROW
  EXECUTE FUNCTION public.enforce_meeting_lock_on_participant_insert();

CREATE OR REPLACE FUNCTION public.send_persistent_chat(
  p_meeting_id UUID,
  p_message TEXT
)
RETURNS public.chat_messages
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_meeting public.meetings;
  v_name TEXT;
  v_chat public.chat_messages;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  IF NULLIF(trim(p_message), '') IS NULL THEN
    RAISE EXCEPTION 'Message is required';
  END IF;
  IF length(trim(p_message)) > 2000 THEN
    RAISE EXCEPTION 'Message is too long';
  END IF;

  SELECT * INTO v_meeting
  FROM public.meetings
  WHERE id = p_meeting_id
    AND status IN ('waiting', 'live');
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting is not available for chat';
  END IF;

  IF v_meeting.host_id IS DISTINCT FROM v_user_id
     AND NOT EXISTS (
       SELECT 1
       FROM public.meeting_participants mp
       WHERE mp.meeting_id = v_meeting.id
         AND mp.user_id = v_user_id
         AND mp.organization_id = v_meeting.organization_id
         AND mp.workspace_id = v_meeting.workspace_id
         AND mp.status IN ('joined', 'waiting', 'muted')
     ) THEN
    RAISE EXCEPTION 'Meeting access denied';
  END IF;

  SELECT COALESCE(u.full_name, 'Meeting participant') INTO v_name
  FROM public.users u
  WHERE u.id = v_user_id;

  INSERT INTO public.chat_messages (
    meeting_id, user_id, user_name, message, organization_id, workspace_id
  )
  VALUES (
    v_meeting.id, v_user_id, v_name, trim(p_message),
    v_meeting.organization_id, v_meeting.workspace_id
  )
  RETURNING * INTO v_chat;

  RETURN v_chat;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_persistent_meeting_lock(
  p_meeting_id UUID,
  p_locked BOOLEAN
)
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

  UPDATE public.meetings
  SET is_locked = p_locked,
      locked_at = CASE WHEN p_locked THEN NOW() ELSE NULL END,
      updated_at = NOW()
  WHERE id = p_meeting_id
    AND host_id = auth.uid()
    AND status IN ('waiting', 'live')
  RETURNING * INTO v_meeting;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Only the active meeting host can change the lock';
  END IF;

  RETURN v_meeting;
END;
$$;

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
  IF p_action NOT IN ('mute', 'remove') THEN
    RAISE EXCEPTION 'Unsupported moderation action';
  END IF;

  UPDATE public.meeting_participants
  SET status = CASE WHEN p_action = 'remove' THEN 'removed' ELSE 'muted' END,
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

REVOKE ALL ON FUNCTION public.enforce_meeting_lock_on_participant_insert() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_persistent_chat(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_persistent_meeting_lock(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.moderate_persistent_participant(UUID, UUID, TEXT) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.send_persistent_chat(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_persistent_meeting_lock(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_persistent_participant(UUID, UUID, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Chat is readable to meeting members" ON public.chat_messages;
DROP POLICY IF EXISTS "Meeting members can send chat messages" ON public.chat_messages;

CREATE POLICY "Persistent chat is readable to meeting participants"
ON public.chat_messages
FOR SELECT
USING (
  EXISTS (
    SELECT 1
    FROM public.meetings m
    WHERE m.id = public.chat_messages.meeting_id
      AND m.organization_id = public.chat_messages.organization_id
      AND m.workspace_id = public.chat_messages.workspace_id
      AND (
        m.host_id = auth.uid()
        OR EXISTS (
          SELECT 1
          FROM public.meeting_participants mp
          WHERE mp.meeting_id = m.id
            AND mp.user_id = auth.uid()
            AND mp.organization_id = m.organization_id
            AND mp.workspace_id = m.workspace_id
        )
      )
  )
);
