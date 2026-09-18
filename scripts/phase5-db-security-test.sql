-- Phase 5/6 isolated database security assertions.

CREATE TABLE public.phase5_assertions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  detail TEXT
);

CREATE OR REPLACE FUNCTION public.phase5_assert(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '')
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.phase5_assertions (name, passed, detail)
  VALUES (p_name, p_ok, p_detail);
END;
$$;

GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO authenticated;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO authenticated;

DO $$
DECLARE
  user_a UUID := '11111111-1111-1111-1111-111111111111';
  user_b UUID := '22222222-2222-2222-2222-222222222222';
  user_c UUID := '33333333-3333-3333-3333-333333333333';
  org_a UUID;
  workspace_a UUID;
  scheduled_a public.scheduled_meetings;
  meeting_a public.meetings;
  poll_a public.meeting_polls;
  option_a UUID;
  question_a public.meeting_questions;
  notes_a public.meeting_notes;
  recording_a public.meeting_recordings;
  ai_a public.meeting_ai_jobs;
  functions_safe BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (user_a, 'a@example.com'),
    (user_b, 'b@example.com'),
    (user_c, 'c@example.com');
  INSERT INTO public.users (id, email, full_name) VALUES
    (user_a, 'a@example.com', 'User A'),
    (user_b, 'b@example.com', 'User B'),
    (user_c, 'c@example.com', 'User C');

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES ('Org A', 'phase5-org-a', user_a)
  RETURNING id INTO org_a;
  INSERT INTO public.workspaces (organization_id, name, slug, created_by)
  VALUES (org_a, 'Workspace A', 'phase5-workspace-a', user_a)
  RETURNING id INTO workspace_a;
  INSERT INTO public.organization_members (organization_id, user_id, role, status, invited_by)
  VALUES (org_a, user_b, 'member', 'active', user_a);

  SELECT bool_and(p.prosecdef)
    AND bool_and(coalesce(p.proconfig, ARRAY['search_path=public'])::text LIKE '%search_path=public%')
  INTO functions_safe
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_meeting_poll',
      'vote_meeting_poll',
      'ask_meeting_question',
      'save_meeting_notes',
      'request_meeting_recording',
      'request_meeting_ai_job',
      'lookup_joinable_meeting'
    );
  PERFORM public.phase5_assert('collaboration definer functions use a safe search path', functions_safe);

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO scheduled_a FROM public.schedule_persistent_meeting(
    'Collab', CURRENT_DATE + 1, '10:00', 'UTC', workspace_a, 'Agenda', 30
  );
  RESET ROLE;
  SELECT * INTO meeting_a FROM public.meetings WHERE code = scheduled_a.meeting_code;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  PERFORM public.join_persistent_meeting(meeting_a.code);
  SELECT * INTO poll_a FROM public.create_meeting_poll(meeting_a.id, 'Ready?', ARRAY['Yes', 'No'], TRUE);
  SELECT id INTO option_a FROM public.meeting_poll_options WHERE poll_id = poll_a.id ORDER BY position LIMIT 1;
  PERFORM public.vote_meeting_poll(poll_a.id, option_a);
  SELECT * INTO question_a FROM public.ask_meeting_question(meeting_a.id, 'What is the deadline?');
  SELECT * INTO notes_a FROM public.save_meeting_notes(meeting_a.id, 'Shared notes', 0);
  PERFORM public.set_hand_raised(meeting_a.id, TRUE);
  SELECT * INTO recording_a FROM public.request_meeting_recording(meeting_a.id);
  SELECT * INTO ai_a FROM public.request_meeting_ai_job(meeting_a.id, 'summary', NULL);
  RESET ROLE;

  PERFORM public.phase5_assert('host can create a poll after joining', poll_a.question = 'Ready?' AND poll_a.anonymous);
  PERFORM public.phase5_assert('recording remains queued without egress', recording_a.status = 'queued' AND recording_a.playback_url IS NULL);
  PERFORM public.phase5_assert('AI jobs remain queued without a provider', ai_a.status = 'queued' AND ai_a.result IS NULL);
  PERFORM public.phase5_assert('shared notes persist with a server version', notes_a.version = 1);
  PERFORM public.phase5_assert('hand raise persists for the participant', EXISTS (
    SELECT 1 FROM public.meeting_hand_raises WHERE meeting_id = meeting_a.id AND user_id = user_a
  ));

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  BEGIN
    PERFORM public.vote_meeting_poll(poll_a.id, option_a);
    PERFORM public.phase5_assert('duplicate votes are rejected', false, 'second vote succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase5_assert('duplicate votes are rejected', true, SQLERRM);
  END;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_c::text, false);
  BEGIN
    PERFORM public.vote_meeting_poll(poll_a.id, option_a);
    PERFORM public.phase5_assert('outsider cannot vote', false, 'vote succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase5_assert('outsider cannot vote', true, SQLERRM);
  END;
  BEGIN
    INSERT INTO public.meeting_poll_votes (poll_id, option_id, user_id)
    VALUES (poll_a.id, option_a, user_c);
    PERFORM public.phase5_assert('direct poll vote insert is blocked', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase5_assert('direct poll vote insert is blocked', true, SQLERRM);
  END;
  BEGIN
    UPDATE public.meeting_recordings SET status = 'completed' WHERE id = recording_a.id;
    PERFORM public.phase5_assert('direct recording completion is blocked', NOT FOUND, 'update applied');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase5_assert('direct recording completion is blocked', true, SQLERRM);
  END;
  RESET ROLE;

  PERFORM public.phase5_assert('queued recording was not marked complete', EXISTS (
    SELECT 1 FROM public.meeting_recordings WHERE id = recording_a.id AND status = 'queued'
  ));
END
$$;

SELECT name, passed, detail FROM public.phase5_assertions ORDER BY id;
SELECT count(*) AS total, count(*) FILTER (WHERE passed) AS passed, count(*) FILTER (WHERE NOT passed) AS failed
FROM public.phase5_assertions;
