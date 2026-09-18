-- Phase 2 isolated database security assertions.
-- Run only against a disposable PostgreSQL database.

CREATE TABLE IF NOT EXISTS public.phase2_assertions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  detail TEXT
);

CREATE OR REPLACE FUNCTION public.phase2_assert(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '')
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.phase2_assertions (name, passed, detail)
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
  org_b UUID;
  workspace_a UUID;
  workspace_b UUID;
  meeting_a public.meetings;
  scheduled_a public.scheduled_meetings;
  joined_a RECORD;
  joined_b RECORD;
  participant_count INTEGER;
  visible_count INTEGER;
  code_a TEXT;
  code_scheduled TEXT;
  definer_ok BOOLEAN;
  search_path_ok BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (user_a, 'a@example.com'),
    (user_b, 'b@example.com'),
    (user_c, 'c@example.com')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, email, full_name) VALUES
    (user_a, 'a@example.com', 'User A'),
    (user_b, 'b@example.com', 'User B'),
    (user_c, 'c@example.com', 'User C')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES ('Org A', 'org-a-phase2', user_a)
  RETURNING id INTO org_a;
  INSERT INTO public.workspaces (organization_id, name, slug, created_by)
  VALUES (org_a, 'Workspace A', 'workspace-a', user_a)
  RETURNING id INTO workspace_a;
  INSERT INTO public.organization_members (organization_id, user_id, role, status, invited_by)
  VALUES (org_a, user_b, 'member', 'active', user_a)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES ('Org B', 'org-b-phase2', user_c)
  RETURNING id INTO org_b;
  INSERT INTO public.workspaces (organization_id, name, slug, created_by)
  VALUES (org_b, 'Workspace B', 'workspace-b', user_c)
  RETURNING id INTO workspace_b;

  SELECT bool_and(p.prosecdef) AND bool_and(coalesce(p.proconfig, ARRAY['search_path=public'])::text LIKE '%search_path=public%')
  INTO definer_ok
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'create_persistent_meeting', 'schedule_persistent_meeting', 'join_persistent_meeting',
      'leave_persistent_meeting', 'transition_persistent_meeting', 'phase2_meeting_code'
    );
  PERFORM public.phase2_assert('security definer functions compile with search_path', coalesce(definer_ok, false));

  SELECT NOT has_function_privilege('authenticated', 'public.phase2_meeting_code()', 'execute')
  INTO search_path_ok;
  PERFORM public.phase2_assert('meeting code generator is not executable by authenticated', coalesce(search_path_ok, false));

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO meeting_a FROM public.create_persistent_meeting('Org A standup', workspace_a);
  RESET ROLE;

  PERFORM public.phase2_assert('user A creates meeting', meeting_a.id IS NOT NULL AND meeting_a.host_id = user_a);
  PERFORM public.phase2_assert('created meeting uses waiting status', meeting_a.status = 'waiting');
  PERFORM public.phase2_assert('server assigned tenant fields', meeting_a.organization_id = org_a AND meeting_a.workspace_id = workspace_a);
  PERFORM public.phase2_assert('meeting code is unique and well formed', meeting_a.code ~ '^LM-[A-Z0-9]{6}$');
  code_a := meeting_a.code;

  SELECT count(*) INTO participant_count
  FROM public.meeting_participants
  WHERE meeting_id = meeting_a.id AND user_id = user_a AND role = 'host';
  PERFORM public.phase2_assert('user A becomes host participant', participant_count = 1);

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
  SELECT * INTO joined_b FROM public.join_persistent_meeting(code_a);
  RESET ROLE;
  PERFORM public.phase2_assert('user B in same org joins', joined_b.meeting_id = meeting_a.id);
  PERFORM public.phase2_assert('user B becomes participant only', joined_b.participant_role = 'participant');

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_c::text, false);
  SELECT count(*) INTO visible_count FROM public.meetings WHERE id = meeting_a.id;
  RESET ROLE;
  PERFORM public.phase2_assert('user C cannot see meeting', visible_count = 0);

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_c::text, false);
    PERFORM public.join_persistent_meeting(code_a);
    RESET ROLE;
    PERFORM public.phase2_assert('user C cannot join meeting', false, 'join succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('user C cannot join meeting', true, SQLERRM);
  END;

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
    INSERT INTO public.meetings (code, title, host_id, organization_id, workspace_id, status)
    VALUES ('LM-FORGED1', 'Forged', user_b, org_b, workspace_b, 'live');
    RESET ROLE;
    PERFORM public.phase2_assert('user cannot fabricate host_id', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('user cannot fabricate host_id', true, SQLERRM);
  END;

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
    INSERT INTO public.meetings (code, title, host_id, organization_id, workspace_id, status)
    VALUES ('LM-FORGED2', 'Forged org', user_a, org_b, workspace_b, 'live');
    RESET ROLE;
    PERFORM public.phase2_assert('user cannot fabricate organization_id', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('user cannot fabricate organization_id', true, SQLERRM);
  END;

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
    INSERT INTO public.meetings (code, title, host_id, organization_id, workspace_id, status)
    VALUES ('LM-FORGED3', 'Forged workspace', user_a, org_a, workspace_b, 'live');
    RESET ROLE;
    PERFORM public.phase2_assert('user cannot fabricate workspace_id', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('user cannot fabricate workspace_id', true, SQLERRM);
  END;

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
    INSERT INTO public.meeting_participants (meeting_id, user_id, user_name, organization_id, workspace_id, role, status)
    VALUES (meeting_a.id, user_b, 'User B', org_a, workspace_a, 'host', 'joined');
    RESET ROLE;
    PERFORM public.phase2_assert('user cannot self-promote', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('user cannot self-promote', true, SQLERRM);
  END;

  BEGIN
    INSERT INTO public.meeting_participants (meeting_id, user_id, user_name, organization_id, workspace_id, role, status)
    VALUES (meeting_a.id, user_a, 'dup', org_a, workspace_a, 'host', 'joined');
    PERFORM public.phase2_assert('duplicate participant prevented', false, 'insert succeeded');
  EXCEPTION WHEN unique_violation THEN
    PERFORM public.phase2_assert('duplicate participant prevented', true, SQLERRM);
  END;

  SELECT count(*) = count(DISTINCT code) INTO definer_ok FROM public.meetings;
  PERFORM public.phase2_assert('meeting code uniqueness enforced', definer_ok);

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
    PERFORM public.join_persistent_meeting('not-a-code');
    RESET ROLE;
    PERFORM public.phase2_assert('invalid meeting code rejected', false, 'join succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('invalid meeting code rejected', true, SQLERRM);
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO scheduled_a FROM public.schedule_persistent_meeting('Planning', CURRENT_DATE + 1, '10:00', 'UTC', workspace_a);
  RESET ROLE;
  code_scheduled := scheduled_a.meeting_code;
  PERFORM public.phase2_assert('scheduled meeting created', scheduled_a.status = 'scheduled');

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
  SELECT * INTO joined_b FROM public.join_persistent_meeting(code_scheduled);
  RESET ROLE;
  PERFORM public.phase2_assert('scheduled to waiting works', joined_b.meeting_status = 'waiting');
  PERFORM public.phase2_assert('scheduled metadata remains consistent', EXISTS (
    SELECT 1 FROM public.scheduled_meetings WHERE meeting_code = code_scheduled AND status = 'waiting'
  ));

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO joined_a FROM public.join_persistent_meeting(code_scheduled);
  SELECT * INTO meeting_a FROM public.transition_persistent_meeting(joined_a.meeting_id, 'live');
  RESET ROLE;
  PERFORM public.phase2_assert('waiting to live works', meeting_a.status = 'live');
  PERFORM public.phase2_assert('scheduled row follows live', EXISTS (
    SELECT 1 FROM public.scheduled_meetings WHERE meeting_code = code_scheduled AND status = 'live'
  ));

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
    PERFORM public.transition_persistent_meeting(meeting_a.id, 'waiting');
    RESET ROLE;
    PERFORM public.phase2_assert('invalid lifecycle transitions fail', false, 'transition succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('invalid lifecycle transitions fail', true, SQLERRM);
  END;

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
    PERFORM public.transition_persistent_meeting(meeting_a.id, 'ended');
    RESET ROLE;
    PERFORM public.phase2_assert('non-host cannot transition meeting', false, 'transition succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('non-host cannot transition meeting', true, SQLERRM);
  END;

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
    UPDATE public.meetings SET status = 'ended' WHERE id = meeting_a.id;
    RESET ROLE;
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
  END;
  PERFORM public.phase2_assert('direct UPDATE cannot bypass lifecycle', EXISTS (
    SELECT 1 FROM public.meetings WHERE id = meeting_a.id AND status = 'live'
  ));

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
    INSERT INTO public.meeting_participants (meeting_id, user_id, user_name, organization_id, workspace_id, role, status)
    VALUES (meeting_a.id, user_c, 'User C', org_a, workspace_a, 'participant', 'joined');
    RESET ROLE;
    PERFORM public.phase2_assert('direct INSERT cannot bypass participant security', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('direct INSERT cannot bypass participant security', true, SQLERRM);
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
  PERFORM public.leave_persistent_meeting(meeting_a.id);
  RESET ROLE;
  PERFORM public.phase2_assert('leaving updates participant state', EXISTS (
    SELECT 1 FROM public.meeting_participants
    WHERE meeting_id = meeting_a.id AND user_id = user_b AND status = 'left' AND left_at IS NOT NULL
  ));
  PERFORM public.phase2_assert('host leave does not auto-end', EXISTS (
    SELECT 1 FROM public.meetings WHERE id = meeting_a.id AND status = 'live'
  ));

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO meeting_a FROM public.transition_persistent_meeting(meeting_a.id, 'ended');
  RESET ROLE;
  PERFORM public.phase2_assert('host ending meeting ends the meeting intentionally', meeting_a.status = 'ended');
  PERFORM public.phase2_assert('scheduled meeting metadata remains consistent', EXISTS (
    SELECT 1 FROM public.scheduled_meetings WHERE meeting_code = code_scheduled AND status = 'ended' AND ended_at IS NOT NULL
  ));

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
    PERFORM public.join_persistent_meeting(code_scheduled);
    RESET ROLE;
    PERFORM public.phase2_assert('ended meeting cannot be joined', false, 'join succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('ended meeting cannot be joined', true, SQLERRM);
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO scheduled_a FROM public.schedule_persistent_meeting('Cancelled later', CURRENT_DATE + 2, '11:00', 'UTC', workspace_a);
  SELECT id, code INTO meeting_a FROM public.meetings WHERE code = scheduled_a.meeting_code;
  SELECT * INTO meeting_a FROM public.transition_persistent_meeting(meeting_a.id, 'cancelled');
  RESET ROLE;
  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
    PERFORM public.join_persistent_meeting(meeting_a.code);
    RESET ROLE;
    PERFORM public.phase2_assert('cancelled meeting cannot be joined', false, 'join succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase2_assert('cancelled meeting cannot be joined', true, SQLERRM);
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_c::text, false);
  SELECT count(*) INTO visible_count FROM public.meetings WHERE organization_id = org_a;
  RESET ROLE;
  PERFORM public.phase2_assert('tenant isolation holds', visible_count = 0);
END
$$;

SELECT name, passed, detail FROM public.phase2_assertions ORDER BY id;
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE passed) AS passed,
  count(*) FILTER (WHERE NOT passed) AS failed
FROM public.phase2_assertions;
