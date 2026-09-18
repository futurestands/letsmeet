-- Add collaboration tables to Supabase Realtime publication.
-- Additive only. Migrations 001-011 remain immutable.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meeting_polls'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_polls;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meeting_poll_options'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_poll_options;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meeting_poll_votes'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_poll_votes;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meeting_questions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_questions;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meeting_notes'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_notes;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meeting_whiteboard_ops'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_whiteboard_ops;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'chat_messages'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.chat_messages;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meeting_hand_raises'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_hand_raises;
    END IF;
  END IF;
END
$$;
