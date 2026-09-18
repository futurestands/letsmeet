-- Publish meeting reactions to Realtime for reliable overlay delivery.
-- Additive only. Migrations 001-012 remain immutable.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_publication WHERE pubname = 'supabase_realtime') THEN
    IF NOT EXISTS (
      SELECT 1 FROM pg_publication_tables
      WHERE pubname = 'supabase_realtime' AND schemaname = 'public' AND tablename = 'meeting_reactions'
    ) THEN
      ALTER PUBLICATION supabase_realtime ADD TABLE public.meeting_reactions;
    END IF;
  END IF;
END
$$;
