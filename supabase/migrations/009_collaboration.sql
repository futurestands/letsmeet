-- Phase 5 collaboration: chat moderation, reactions, hands, polls, Q&A, notes, whiteboard.
-- Additive only. Migrations 001-008 remain immutable.

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS deleted_by UUID REFERENCES public.users(id);

ALTER TABLE public.meeting_participants
  ADD COLUMN IF NOT EXISTS last_read_chat_at TIMESTAMPTZ;

CREATE TABLE IF NOT EXISTS public.meeting_reactions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  user_name TEXT NOT NULL,
  emoji TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_hand_raises (
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  user_name TEXT NOT NULL,
  raised_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (meeting_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.meeting_polls (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  created_by UUID NOT NULL REFERENCES public.users(id),
  question TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  anonymous BOOLEAN NOT NULL DEFAULT FALSE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_poll_options (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  poll_id UUID NOT NULL REFERENCES public.meeting_polls(id) ON DELETE CASCADE,
  label TEXT NOT NULL,
  position INTEGER NOT NULL,
  UNIQUE (poll_id, position)
);

CREATE TABLE IF NOT EXISTS public.meeting_poll_votes (
  poll_id UUID NOT NULL REFERENCES public.meeting_polls(id) ON DELETE CASCADE,
  option_id UUID NOT NULL REFERENCES public.meeting_poll_options(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (poll_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.meeting_questions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  user_name TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'answered', 'dismissed')),
  upvote_count INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_question_votes (
  question_id UUID NOT NULL REFERENCES public.meeting_questions(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (question_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.meeting_notes (
  meeting_id UUID PRIMARY KEY REFERENCES public.meetings(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  content TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL DEFAULT 1,
  updated_by UUID REFERENCES public.users(id),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.meeting_whiteboard_pages (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  title TEXT NOT NULL DEFAULT 'Board',
  page_index INTEGER NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (meeting_id, page_index)
);

CREATE TABLE IF NOT EXISTS public.meeting_whiteboard_ops (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  page_id UUID NOT NULL REFERENCES public.meeting_whiteboard_pages(id) ON DELETE CASCADE,
  meeting_id UUID NOT NULL REFERENCES public.meetings(id) ON DELETE CASCADE,
  organization_id UUID NOT NULL REFERENCES public.organizations(id),
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id),
  user_id UUID NOT NULL REFERENCES public.users(id),
  seq BIGINT GENERATED ALWAYS AS IDENTITY,
  op JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_meeting_created_live
  ON public.chat_messages (meeting_id, created_at)
  WHERE deleted_at IS NULL;
CREATE INDEX IF NOT EXISTS idx_meeting_reactions_meeting_created
  ON public.meeting_reactions (meeting_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_hand_raises_meeting
  ON public.meeting_hand_raises (meeting_id, raised_at);
CREATE INDEX IF NOT EXISTS idx_meeting_polls_meeting
  ON public.meeting_polls (meeting_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_meeting_questions_meeting
  ON public.meeting_questions (meeting_id, status, upvote_count DESC);
CREATE INDEX IF NOT EXISTS idx_whiteboard_ops_page_seq
  ON public.meeting_whiteboard_ops (page_id, seq);

ALTER TABLE public.meeting_reactions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_hand_raises ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_polls ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_poll_options ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_poll_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_questions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_question_votes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_notes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_whiteboard_pages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_whiteboard_ops ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.require_active_meeting_participant(p_meeting_id UUID)
RETURNS public.meetings
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
    RAISE EXCEPTION 'Authentication is required';
  END IF;
  SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Meeting not found';
  END IF;
  IF v_meeting.status NOT IN ('waiting', 'live') THEN
    RAISE EXCEPTION 'Meeting is not available';
  END IF;
  IF v_meeting.host_id IS DISTINCT FROM v_user_id
     AND NOT EXISTS (
       SELECT 1 FROM public.meeting_participants mp
       WHERE mp.meeting_id = v_meeting.id
         AND mp.user_id = v_user_id
         AND mp.organization_id = v_meeting.organization_id
         AND mp.workspace_id = v_meeting.workspace_id
         AND mp.status IN ('joined', 'waiting', 'muted')
     ) THEN
    RAISE EXCEPTION 'Meeting access denied';
  END IF;
  RETURN v_meeting;
END;
$$;

CREATE OR REPLACE FUNCTION public.delete_persistent_chat(p_message_id UUID)
RETURNS public.chat_messages
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_chat public.chat_messages;
  v_meeting public.meetings;
BEGIN
  SELECT * INTO v_chat FROM public.chat_messages WHERE id = p_message_id AND deleted_at IS NULL;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Message not found';
  END IF;
  v_meeting := public.require_active_meeting_participant(v_chat.meeting_id);
  IF v_meeting.host_id IS DISTINCT FROM auth.uid() AND v_chat.user_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the host or the sender can remove this message';
  END IF;
  UPDATE public.chat_messages
  SET deleted_at = NOW(), deleted_by = auth.uid()
  WHERE id = v_chat.id
  RETURNING * INTO v_chat;
  RETURN v_chat;
END;
$$;

CREATE OR REPLACE FUNCTION public.mark_chat_read(p_meeting_id UUID)
RETURNS VOID
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  PERFORM public.require_active_meeting_participant(p_meeting_id);
  UPDATE public.meeting_participants
  SET last_read_chat_at = NOW(), updated_at = NOW()
  WHERE meeting_id = p_meeting_id AND user_id = auth.uid();
END;
$$;

CREATE OR REPLACE FUNCTION public.send_meeting_reaction(p_meeting_id UUID, p_emoji TEXT)
RETURNS public.meeting_reactions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_name TEXT;
  v_row public.meeting_reactions;
BEGIN
  IF p_emoji IS NULL OR p_emoji NOT IN ('👍', '👏', '❤️', '😂', '🎉', '😮') THEN
    RAISE EXCEPTION 'Reaction is not supported';
  END IF;
  v_meeting := public.require_active_meeting_participant(p_meeting_id);
  IF EXISTS (
    SELECT 1 FROM public.meeting_reactions
    WHERE meeting_id = p_meeting_id AND user_id = auth.uid() AND created_at > NOW() - INTERVAL '800 milliseconds'
  ) THEN
    RAISE EXCEPTION 'Please wait before sending another reaction';
  END IF;
  SELECT COALESCE(full_name, 'Participant') INTO v_name FROM public.users WHERE id = auth.uid();
  INSERT INTO public.meeting_reactions (meeting_id, organization_id, workspace_id, user_id, user_name, emoji)
  VALUES (v_meeting.id, v_meeting.organization_id, v_meeting.workspace_id, auth.uid(), v_name, p_emoji)
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.set_hand_raised(p_meeting_id UUID, p_raised BOOLEAN)
RETURNS BOOLEAN
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_name TEXT;
BEGIN
  v_meeting := public.require_active_meeting_participant(p_meeting_id);
  SELECT COALESCE(full_name, 'Participant') INTO v_name FROM public.users WHERE id = auth.uid();
  IF p_raised THEN
    INSERT INTO public.meeting_hand_raises (meeting_id, user_id, organization_id, workspace_id, user_name, raised_at)
    VALUES (v_meeting.id, auth.uid(), v_meeting.organization_id, v_meeting.workspace_id, v_name, NOW())
    ON CONFLICT (meeting_id, user_id)
    DO UPDATE SET raised_at = NOW(), user_name = EXCLUDED.user_name;
    RETURN TRUE;
  END IF;
  DELETE FROM public.meeting_hand_raises WHERE meeting_id = v_meeting.id AND user_id = auth.uid();
  RETURN FALSE;
END;
$$;

CREATE OR REPLACE FUNCTION public.clear_raised_hands(p_meeting_id UUID)
RETURNS INTEGER
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_count INTEGER;
BEGIN
  v_meeting := public.require_active_meeting_participant(p_meeting_id);
  IF v_meeting.host_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the host can clear raised hands';
  END IF;
  DELETE FROM public.meeting_hand_raises WHERE meeting_id = v_meeting.id;
  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.create_meeting_poll(
  p_meeting_id UUID,
  p_question TEXT,
  p_options TEXT[],
  p_anonymous BOOLEAN DEFAULT FALSE
)
RETURNS public.meeting_polls
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_poll public.meeting_polls;
  v_index INTEGER;
BEGIN
  v_meeting := public.require_active_meeting_participant(p_meeting_id);
  IF v_meeting.host_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the host can create a poll';
  END IF;
  IF NULLIF(trim(p_question), '') IS NULL THEN
    RAISE EXCEPTION 'Poll question is required';
  END IF;
  IF p_options IS NULL OR array_length(p_options, 1) IS NULL OR array_length(p_options, 1) < 2 OR array_length(p_options, 1) > 8 THEN
    RAISE EXCEPTION 'Polls require between 2 and 8 options';
  END IF;

  INSERT INTO public.meeting_polls (
    meeting_id, organization_id, workspace_id, created_by, question, anonymous
  )
  VALUES (
    v_meeting.id, v_meeting.organization_id, v_meeting.workspace_id, auth.uid(), trim(p_question), COALESCE(p_anonymous, FALSE)
  )
  RETURNING * INTO v_poll;

  FOR v_index IN 1 .. array_length(p_options, 1) LOOP
    IF NULLIF(trim(p_options[v_index]), '') IS NULL THEN
      RAISE EXCEPTION 'Poll options cannot be empty';
    END IF;
    INSERT INTO public.meeting_poll_options (poll_id, label, position)
    VALUES (v_poll.id, trim(p_options[v_index]), v_index);
  END LOOP;

  RETURN v_poll;
END;
$$;

CREATE OR REPLACE FUNCTION public.close_meeting_poll(p_poll_id UUID)
RETURNS public.meeting_polls
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poll public.meeting_polls;
  v_meeting public.meetings;
BEGIN
  SELECT * INTO v_poll FROM public.meeting_polls WHERE id = p_poll_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Poll not found';
  END IF;
  v_meeting := public.require_active_meeting_participant(v_poll.meeting_id);
  IF v_meeting.host_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the host can close a poll';
  END IF;
  UPDATE public.meeting_polls
  SET status = 'closed', updated_at = NOW()
  WHERE id = v_poll.id
  RETURNING * INTO v_poll;
  RETURN v_poll;
END;
$$;

CREATE OR REPLACE FUNCTION public.vote_meeting_poll(p_poll_id UUID, p_option_id UUID)
RETURNS public.meeting_poll_votes
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_poll public.meeting_polls;
  v_vote public.meeting_poll_votes;
BEGIN
  SELECT * INTO v_poll FROM public.meeting_polls WHERE id = p_poll_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Poll not found';
  END IF;
  PERFORM public.require_active_meeting_participant(v_poll.meeting_id);
  IF v_poll.status <> 'open' THEN
    RAISE EXCEPTION 'This poll is closed';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.meeting_poll_options WHERE id = p_option_id AND poll_id = p_poll_id) THEN
    RAISE EXCEPTION 'Poll option is invalid';
  END IF;
  INSERT INTO public.meeting_poll_votes (poll_id, option_id, user_id)
  VALUES (p_poll_id, p_option_id, auth.uid())
  ON CONFLICT (poll_id, user_id) DO NOTHING
  RETURNING * INTO v_vote;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'You have already voted in this poll';
  END IF;
  RETURN v_vote;
END;
$$;

CREATE OR REPLACE FUNCTION public.ask_meeting_question(p_meeting_id UUID, p_body TEXT)
RETURNS public.meeting_questions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_name TEXT;
  v_row public.meeting_questions;
BEGIN
  IF NULLIF(trim(p_body), '') IS NULL OR length(trim(p_body)) > 1000 THEN
    RAISE EXCEPTION 'Enter a question up to 1000 characters';
  END IF;
  v_meeting := public.require_active_meeting_participant(p_meeting_id);
  SELECT COALESCE(full_name, 'Participant') INTO v_name FROM public.users WHERE id = auth.uid();
  INSERT INTO public.meeting_questions (
    meeting_id, organization_id, workspace_id, user_id, user_name, body
  )
  VALUES (
    v_meeting.id, v_meeting.organization_id, v_meeting.workspace_id, auth.uid(), v_name, trim(p_body)
  )
  RETURNING * INTO v_row;
  RETURN v_row;
END;
$$;

CREATE OR REPLACE FUNCTION public.moderate_meeting_question(p_question_id UUID, p_status TEXT)
RETURNS public.meeting_questions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_question public.meeting_questions;
  v_meeting public.meetings;
BEGIN
  IF p_status NOT IN ('open', 'answered', 'dismissed') THEN
    RAISE EXCEPTION 'Question status is invalid';
  END IF;
  SELECT * INTO v_question FROM public.meeting_questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found';
  END IF;
  v_meeting := public.require_active_meeting_participant(v_question.meeting_id);
  IF v_meeting.host_id IS DISTINCT FROM auth.uid() THEN
    RAISE EXCEPTION 'Only the host can moderate questions';
  END IF;
  UPDATE public.meeting_questions
  SET status = p_status, updated_at = NOW()
  WHERE id = v_question.id
  RETURNING * INTO v_question;
  RETURN v_question;
END;
$$;

CREATE OR REPLACE FUNCTION public.upvote_meeting_question(p_question_id UUID)
RETURNS public.meeting_questions
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_question public.meeting_questions;
BEGIN
  SELECT * INTO v_question FROM public.meeting_questions WHERE id = p_question_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Question not found';
  END IF;
  PERFORM public.require_active_meeting_participant(v_question.meeting_id);
  INSERT INTO public.meeting_question_votes (question_id, user_id)
  VALUES (p_question_id, auth.uid())
  ON CONFLICT (question_id, user_id) DO NOTHING;
  IF FOUND THEN
    UPDATE public.meeting_questions
    SET upvote_count = upvote_count + 1, updated_at = NOW()
    WHERE id = p_question_id
    RETURNING * INTO v_question;
  ELSE
    SELECT * INTO v_question FROM public.meeting_questions WHERE id = p_question_id;
  END IF;
  RETURN v_question;
END;
$$;

CREATE OR REPLACE FUNCTION public.save_meeting_notes(p_meeting_id UUID, p_content TEXT, p_version INTEGER)
RETURNS public.meeting_notes
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_notes public.meeting_notes;
BEGIN
  v_meeting := public.require_active_meeting_participant(p_meeting_id);
  IF length(COALESCE(p_content, '')) > 20000 THEN
    RAISE EXCEPTION 'Notes are too long';
  END IF;

  INSERT INTO public.meeting_notes (meeting_id, organization_id, workspace_id, content, version, updated_by)
  VALUES (v_meeting.id, v_meeting.organization_id, v_meeting.workspace_id, COALESCE(p_content, ''), 1, auth.uid())
  ON CONFLICT (meeting_id) DO UPDATE
    SET content = EXCLUDED.content,
        version = public.meeting_notes.version + 1,
        updated_by = auth.uid(),
        updated_at = NOW()
    WHERE public.meeting_notes.version = COALESCE(p_version, public.meeting_notes.version)
  RETURNING * INTO v_notes;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Notes were updated by someone else. Refresh and try again.';
  END IF;
  RETURN v_notes;
END;
$$;

CREATE OR REPLACE FUNCTION public.ensure_whiteboard_page(p_meeting_id UUID)
RETURNS public.meeting_whiteboard_pages
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
  v_page public.meeting_whiteboard_pages;
BEGIN
  v_meeting := public.require_active_meeting_participant(p_meeting_id);
  SELECT * INTO v_page
  FROM public.meeting_whiteboard_pages
  WHERE meeting_id = v_meeting.id
  ORDER BY page_index
  LIMIT 1;
  IF FOUND THEN
    RETURN v_page;
  END IF;
  INSERT INTO public.meeting_whiteboard_pages (
    meeting_id, organization_id, workspace_id, title, page_index
  )
  VALUES (
    v_meeting.id, v_meeting.organization_id, v_meeting.workspace_id, 'Board 1', 0
  )
  RETURNING * INTO v_page;
  RETURN v_page;
END;
$$;

CREATE OR REPLACE FUNCTION public.append_whiteboard_op(p_page_id UUID, p_op JSONB)
RETURNS public.meeting_whiteboard_ops
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_page public.meeting_whiteboard_pages;
  v_meeting public.meetings;
  v_op public.meeting_whiteboard_ops;
  v_type TEXT;
BEGIN
  SELECT * INTO v_page FROM public.meeting_whiteboard_pages WHERE id = p_page_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Whiteboard page not found';
  END IF;
  v_meeting := public.require_active_meeting_participant(v_page.meeting_id);
  v_type := COALESCE(p_op->>'type', '');
  IF v_type NOT IN ('stroke', 'clear', 'undo', 'redo') THEN
    RAISE EXCEPTION 'Unsupported whiteboard operation';
  END IF;
  INSERT INTO public.meeting_whiteboard_ops (
    page_id, meeting_id, organization_id, workspace_id, user_id, op
  )
  VALUES (
    v_page.id, v_meeting.id, v_meeting.organization_id, v_meeting.workspace_id, auth.uid(), p_op
  )
  RETURNING * INTO v_op;
  RETURN v_op;
END;
$$;

DROP POLICY IF EXISTS "Collaboration rows are readable to meeting members" ON public.meeting_reactions;
CREATE POLICY "Collaboration rows are readable to meeting members" ON public.meeting_reactions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meeting_reactions.meeting_id
      AND mp.user_id = auth.uid()
      AND mp.status IN ('joined', 'waiting', 'muted')
  )
  OR EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_reactions.meeting_id AND m.host_id = auth.uid())
);

DROP POLICY IF EXISTS "Hands are readable to meeting members" ON public.meeting_hand_raises;
CREATE POLICY "Hands are readable to meeting members" ON public.meeting_hand_raises
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meeting_hand_raises.meeting_id AND mp.user_id = auth.uid()
      AND mp.status IN ('joined', 'waiting', 'muted')
  )
  OR EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_hand_raises.meeting_id AND m.host_id = auth.uid())
);

DROP POLICY IF EXISTS "Polls are readable to meeting members" ON public.meeting_polls;
CREATE POLICY "Polls are readable to meeting members" ON public.meeting_polls
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meeting_polls.meeting_id AND mp.user_id = auth.uid()
      AND mp.status IN ('joined', 'waiting', 'muted')
  )
  OR EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_polls.meeting_id AND m.host_id = auth.uid())
);

DROP POLICY IF EXISTS "Poll options are readable to meeting members" ON public.meeting_poll_options;
CREATE POLICY "Poll options are readable to meeting members" ON public.meeting_poll_options
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meeting_polls p
    JOIN public.meeting_participants mp ON mp.meeting_id = p.meeting_id
    WHERE p.id = meeting_poll_options.poll_id AND mp.user_id = auth.uid()
      AND mp.status IN ('joined', 'waiting', 'muted')
  )
  OR EXISTS (
    SELECT 1 FROM public.meeting_polls p
    JOIN public.meetings m ON m.id = p.meeting_id
    WHERE p.id = meeting_poll_options.poll_id AND m.host_id = auth.uid()
  )
);

DROP POLICY IF EXISTS "Poll votes are readable when not anonymous" ON public.meeting_poll_votes;
CREATE POLICY "Poll votes are readable when not anonymous" ON public.meeting_poll_votes
FOR SELECT USING (
  user_id = auth.uid()
  OR EXISTS (
    SELECT 1 FROM public.meeting_polls p
    JOIN public.meetings m ON m.id = p.meeting_id
    WHERE p.id = meeting_poll_votes.poll_id
      AND p.anonymous = FALSE
      AND (
        m.host_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.meeting_participants mp
          WHERE mp.meeting_id = p.meeting_id AND mp.user_id = auth.uid()
            AND mp.status IN ('joined', 'waiting', 'muted')
        )
      )
  )
);

DROP POLICY IF EXISTS "Questions are readable to meeting members" ON public.meeting_questions;
CREATE POLICY "Questions are readable to meeting members" ON public.meeting_questions
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meeting_questions.meeting_id AND mp.user_id = auth.uid()
      AND mp.status IN ('joined', 'waiting', 'muted')
  )
  OR EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_questions.meeting_id AND m.host_id = auth.uid())
);

DROP POLICY IF EXISTS "Question votes are readable to owners" ON public.meeting_question_votes;
CREATE POLICY "Question votes are readable to owners" ON public.meeting_question_votes
FOR SELECT USING (user_id = auth.uid());

DROP POLICY IF EXISTS "Notes are readable to meeting members" ON public.meeting_notes;
CREATE POLICY "Notes are readable to meeting members" ON public.meeting_notes
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meeting_notes.meeting_id AND mp.user_id = auth.uid()
      AND mp.status IN ('joined', 'waiting', 'muted')
  )
  OR EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_notes.meeting_id AND m.host_id = auth.uid())
);

DROP POLICY IF EXISTS "Whiteboard pages are readable to meeting members" ON public.meeting_whiteboard_pages;
CREATE POLICY "Whiteboard pages are readable to meeting members" ON public.meeting_whiteboard_pages
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meeting_whiteboard_pages.meeting_id AND mp.user_id = auth.uid()
      AND mp.status IN ('joined', 'waiting', 'muted')
  )
  OR EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_whiteboard_pages.meeting_id AND m.host_id = auth.uid())
);

DROP POLICY IF EXISTS "Whiteboard ops are readable to meeting members" ON public.meeting_whiteboard_ops;
CREATE POLICY "Whiteboard ops are readable to meeting members" ON public.meeting_whiteboard_ops
FOR SELECT USING (
  EXISTS (
    SELECT 1 FROM public.meeting_participants mp
    WHERE mp.meeting_id = meeting_whiteboard_ops.meeting_id AND mp.user_id = auth.uid()
      AND mp.status IN ('joined', 'waiting', 'muted')
  )
  OR EXISTS (SELECT 1 FROM public.meetings m WHERE m.id = meeting_whiteboard_ops.meeting_id AND m.host_id = auth.uid())
);

REVOKE ALL ON FUNCTION public.require_active_meeting_participant(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.delete_persistent_chat(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.mark_chat_read(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.send_meeting_reaction(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.set_hand_raised(UUID, BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.clear_raised_hands(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.create_meeting_poll(UUID, TEXT, TEXT[], BOOLEAN) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.close_meeting_poll(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.vote_meeting_poll(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ask_meeting_question(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.moderate_meeting_question(UUID, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.upvote_meeting_question(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.save_meeting_notes(UUID, TEXT, INTEGER) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_whiteboard_page(UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.append_whiteboard_op(UUID, JSONB) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.delete_persistent_chat(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.mark_chat_read(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.send_meeting_reaction(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.set_hand_raised(UUID, BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.clear_raised_hands(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.create_meeting_poll(UUID, TEXT, TEXT[], BOOLEAN) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_meeting_poll(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.vote_meeting_poll(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ask_meeting_question(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.moderate_meeting_question(UUID, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.upvote_meeting_question(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.save_meeting_notes(UUID, TEXT, INTEGER) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ensure_whiteboard_page(UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.append_whiteboard_op(UUID, JSONB) TO authenticated;

GRANT SELECT ON public.meeting_reactions TO authenticated;
GRANT SELECT ON public.meeting_hand_raises TO authenticated;
GRANT SELECT ON public.meeting_polls TO authenticated;
GRANT SELECT ON public.meeting_poll_options TO authenticated;
GRANT SELECT ON public.meeting_poll_votes TO authenticated;
GRANT SELECT ON public.meeting_questions TO authenticated;
GRANT SELECT ON public.meeting_question_votes TO authenticated;
GRANT SELECT ON public.meeting_notes TO authenticated;
GRANT SELECT ON public.meeting_whiteboard_pages TO authenticated;
GRANT SELECT ON public.meeting_whiteboard_ops TO authenticated;
