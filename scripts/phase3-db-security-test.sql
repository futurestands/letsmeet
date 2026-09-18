-- Phase 3 isolated database security assertions.
-- Run only against a disposable PostgreSQL database.

CREATE TABLE public.phase3_assertions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  detail TEXT
);

CREATE OR REPLACE FUNCTION public.phase3_assert(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '')
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.phase3_assertions (name, passed, detail)
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
  user_d UUID := '44444444-4444-4444-4444-444444444444';
  org_a UUID;
  org_b UUID;
  workspace_a UUID;
  workspace_b UUID;
  meeting_a public.meetings;
  joined RECORD;
  chat public.chat_messages;
  participant public.meeting_participants;
  row_count INTEGER;
  functions_safe BOOLEAN;
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (user_a, 'a@example.com'),
    (user_b, 'b@example.com'),
    (user_c, 'c@example.com'),
    (user_d, 'd@example.com');
  INSERT INTO public.users (id, email, full_name) VALUES
    (user_a, 'a@example.com', 'User A'),
    (user_b, 'b@example.com', 'User B'),
    (user_c, 'c@example.com', 'User C'),
    (user_d, 'd@example.com', 'User D');

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES ('Org A', 'phase3-org-a', user_a)
  RETURNING id INTO org_a;
  INSERT INTO public.workspaces (organization_id, name, slug, created_by)
  VALUES (org_a, 'Workspace A', 'phase3-workspace-a', user_a)
  RETURNING id INTO workspace_a;
  INSERT INTO public.organization_members (organization_id, user_id, role, status, invited_by)
  VALUES
    (org_a, user_b, 'member', 'active', user_a),
    (org_a, user_d, 'member', 'active', user_a);

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES ('Org B', 'phase3-org-b', user_c)
  RETURNING id INTO org_b;
  INSERT INTO public.workspaces (organization_id, name, slug, created_by)
  VALUES (org_b, 'Workspace B', 'phase3-workspace-b', user_c)
  RETURNING id INTO workspace_b;

  SELECT bool_and(p.prosecdef)
    AND bool_and(coalesce(p.proconfig, ARRAY['search_path=public'])::text LIKE '%search_path=public%')
  INTO functions_safe
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'send_persistent_chat',
      'set_persistent_meeting_lock',
      'moderate_persistent_participant'
    );
  PERFORM public.phase3_assert('phase 3 definer functions use a safe search path', coalesce(functions_safe, false));

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO meeting_a FROM public.create_persistent_meeting('Phase 3 room', workspace_a);
  SELECT * INTO meeting_a FROM public.transition_persistent_meeting(meeting_a.id, 'live');
  SELECT * INTO chat FROM public.send_persistent_chat(meeting_a.id, ' Hello team ');
  RESET ROLE;

  PERFORM public.phase3_assert('host sends persistent chat', chat.message = 'Hello team');
  PERFORM public.phase3_assert('chat identity and tenant are server derived',
    chat.user_id = user_a
    AND chat.user_name = 'User A'
    AND chat.organization_id = org_a
    AND chat.workspace_id = workspace_a
  );

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
  SELECT * INTO joined FROM public.join_persistent_meeting(meeting_a.code);
  SELECT * INTO chat FROM public.send_persistent_chat(meeting_a.id, 'Participant message');
  RESET ROLE;
  PERFORM public.phase3_assert('active participant sends chat', chat.user_id = user_b);

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_d::text, false);
    PERFORM public.send_persistent_chat(meeting_a.id, 'same org outsider');
    RESET ROLE;
    PERFORM public.phase3_assert('same-org nonparticipant cannot send chat', false, 'send succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase3_assert('same-org nonparticipant cannot send chat', true, SQLERRM);
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_d::text, false);
  SELECT count(*) INTO row_count FROM public.chat_messages WHERE meeting_id = meeting_a.id;
  RESET ROLE;
  PERFORM public.phase3_assert('same-org nonparticipant cannot read chat', row_count = 0);

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_c::text, false);
    PERFORM public.send_persistent_chat(meeting_a.id, 'cross tenant');
    RESET ROLE;
    PERFORM public.phase3_assert('cross-tenant user cannot send chat', false, 'send succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase3_assert('cross-tenant user cannot send chat', true, SQLERRM);
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_c::text, false);
  SELECT count(*) INTO row_count FROM public.chat_messages WHERE meeting_id = meeting_a.id;
  RESET ROLE;
  PERFORM public.phase3_assert('cross-tenant user cannot read chat', row_count = 0);

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
    INSERT INTO public.chat_messages (
      meeting_id, user_id, user_name, message, organization_id, workspace_id
    ) VALUES (
      meeting_a.id, user_b, 'Forged name', 'bypass', org_a, workspace_a
    );
    RESET ROLE;
    PERFORM public.phase3_assert('direct chat insert is blocked', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase3_assert('direct chat insert is blocked', true, SQLERRM);
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO meeting_a FROM public.set_persistent_meeting_lock(meeting_a.id, true);
  RESET ROLE;
  PERFORM public.phase3_assert('host can lock meeting', meeting_a.is_locked AND meeting_a.locked_at IS NOT NULL);

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_d::text, false);
    PERFORM public.join_persistent_meeting(meeting_a.code);
    RESET ROLE;
    PERFORM public.phase3_assert('locked meeting blocks new participant', false, 'join succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase3_assert('locked meeting blocks new participant', true, SQLERRM);
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
  SELECT * INTO joined FROM public.join_persistent_meeting(meeting_a.code);
  RESET ROLE;
  PERFORM public.phase3_assert('locked meeting allows existing participant to reconnect', joined.meeting_id = meeting_a.id);

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
    PERFORM public.set_persistent_meeting_lock(meeting_a.id, false);
    RESET ROLE;
    PERFORM public.phase3_assert('non-host cannot change meeting lock', false, 'lock changed');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase3_assert('non-host cannot change meeting lock', true, SQLERRM);
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO participant
  FROM public.moderate_persistent_participant(meeting_a.id, user_b, 'mute');
  RESET ROLE;
  PERFORM public.phase3_assert('host can mute participant state', participant.status = 'muted');

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
    PERFORM public.moderate_persistent_participant(meeting_a.id, user_a, 'remove');
    RESET ROLE;
    PERFORM public.phase3_assert('non-host cannot moderate', false, 'moderation succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase3_assert('non-host cannot moderate', true, SQLERRM);
  END;

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
    PERFORM public.moderate_persistent_participant(meeting_a.id, user_a, 'remove');
    RESET ROLE;
    PERFORM public.phase3_assert('host cannot moderate self', false, 'moderation succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase3_assert('host cannot moderate self', true, SQLERRM);
  END;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO participant
  FROM public.moderate_persistent_participant(meeting_a.id, user_b, 'remove');
  RESET ROLE;
  PERFORM public.phase3_assert('host can remove participant state',
    participant.status = 'removed' AND participant.left_at IS NOT NULL
  );

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
    PERFORM public.join_persistent_meeting(meeting_a.code);
    RESET ROLE;
    PERFORM public.phase3_assert('removed participant cannot rejoin', false, 'join succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase3_assert('removed participant cannot rejoin', true, SQLERRM);
  END;

  BEGIN
    SET ROLE authenticated;
    PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
    PERFORM public.send_persistent_chat(meeting_a.id, repeat('x', 2001));
    RESET ROLE;
    PERFORM public.phase3_assert('oversized chat message is rejected', false, 'send succeeded');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    PERFORM public.phase3_assert('oversized chat message is rejected', true, SQLERRM);
  END;
END
$$;

SELECT name, passed, detail FROM public.phase3_assertions ORDER BY id;
SELECT
  count(*) AS total,
  count(*) FILTER (WHERE passed) AS passed,
  count(*) FILTER (WHERE NOT passed) AS failed
FROM public.phase3_assertions;
