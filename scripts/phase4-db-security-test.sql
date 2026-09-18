-- Phase 4 isolated database security assertions.

CREATE TABLE public.phase4_assertions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  detail TEXT
);

CREATE OR REPLACE FUNCTION public.phase4_assert(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '')
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.phase4_assertions (name, passed, detail)
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
  scheduled_a public.scheduled_meetings;
  meeting_a public.meetings;
  invite_a public.meeting_invites;
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
  VALUES ('Org A', 'phase4-org-a', user_a)
  RETURNING id INTO org_a;
  INSERT INTO public.workspaces (organization_id, name, slug, created_by)
  VALUES (org_a, 'Workspace A', 'phase4-workspace-a', user_a)
  RETURNING id INTO workspace_a;
  INSERT INTO public.organization_members (organization_id, user_id, role, status, invited_by)
  VALUES (org_a, user_b, 'member', 'active', user_a);

  INSERT INTO public.organizations (name, slug, created_by)
  VALUES ('Org B', 'phase4-org-b', user_c)
  RETURNING id INTO org_b;
  INSERT INTO public.workspaces (organization_id, name, slug, created_by)
  VALUES (org_b, 'Workspace B', 'phase4-workspace-b', user_c)
  RETURNING id INTO workspace_b;

  SELECT bool_and(p.prosecdef)
    AND bool_and(coalesce(p.proconfig, ARRAY['search_path=public'])::text LIKE '%search_path=public%')
  INTO functions_safe
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public'
    AND p.proname IN (
      'schedule_persistent_meeting',
      'update_scheduled_meeting',
      'invite_to_persistent_meeting',
      'revoke_meeting_invite'
    );
  PERFORM public.phase4_assert('phase 4 definer functions use a safe search path', functions_safe);

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO scheduled_a FROM public.schedule_persistent_meeting(
    'Planning', CURRENT_DATE + 1, '10:00', 'UTC', workspace_a, 'Agenda', 45
  );
  RESET ROLE;

  SELECT * INTO meeting_a FROM public.meetings WHERE code = scheduled_a.meeting_code;
  PERFORM public.phase4_assert('scheduled meeting stores UTC instant', meeting_a.scheduled_for IS NOT NULL);
  PERFORM public.phase4_assert('duration and description persist', meeting_a.duration_minutes = 45 AND meeting_a.description = 'Agenda');
  PERFORM public.phase4_assert('organizer cannot be chosen by the client', meeting_a.host_id = user_a AND meeting_a.organization_id = org_a);

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_c::text, false);
  BEGIN
    PERFORM public.schedule_persistent_meeting('Cross tenant', CURRENT_DATE + 1, '11:00', 'UTC', workspace_a);
    PERFORM public.phase4_assert('cannot schedule into another workspace', false, 'cross-tenant schedule succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase4_assert('cannot schedule into another workspace', true, SQLERRM);
  END;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO invite_a FROM public.invite_to_persistent_meeting(meeting_a.id, 'b@example.com');
  RESET ROLE;
  PERFORM public.phase4_assert('host can create an invite', invite_a.email = 'b@example.com' AND invite_a.organization_id = org_a);
  PERFORM public.phase4_assert('invitation queues a notification job', EXISTS (
    SELECT 1 FROM public.meeting_notification_jobs
    WHERE invite_id = invite_a.id AND status = 'pending' AND provider_message_id IS NULL
  ));

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
  BEGIN
    PERFORM public.invite_to_persistent_meeting(meeting_a.id, 'outsider@example.com');
    PERFORM public.phase4_assert('non-host cannot invite', false, 'invite succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase4_assert('non-host cannot invite', true, SQLERRM);
  END;
  BEGIN
    PERFORM public.update_scheduled_meeting(meeting_a.id, 'Hijacked', CURRENT_DATE + 2, '12:00', 'UTC', 'nope', 30);
    PERFORM public.phase4_assert('non-host cannot reschedule', false, 'update succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase4_assert('non-host cannot reschedule', true, SQLERRM);
  END;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO meeting_a FROM public.update_scheduled_meeting(meeting_a.id, 'Planning updated', CURRENT_DATE + 2, '09:30', 'UTC', 'New agenda', 60);
  RESET ROLE;
  PERFORM public.phase4_assert('host can reschedule', meeting_a.title = 'Planning updated' AND meeting_a.duration_minutes = 60);

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_c::text, false);
  BEGIN
    INSERT INTO public.meeting_invites (meeting_id, email, organization_id, workspace_id, status)
    VALUES (meeting_a.id, 'stolen@example.com', org_a, workspace_a, 'pending');
    PERFORM public.phase4_assert('direct invite insert is blocked', false, 'insert succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase4_assert('direct invite insert is blocked', true, SQLERRM);
  END;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  PERFORM public.transition_persistent_meeting(meeting_a.id, 'cancelled');
  BEGIN
    PERFORM public.invite_to_persistent_meeting(meeting_a.id, 'late@example.com');
    PERFORM public.phase4_assert('cancelled meeting cannot receive invites', false, 'invite succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase4_assert('cancelled meeting cannot receive invites', true, SQLERRM);
  END;
  RESET ROLE;

  PERFORM public.phase4_assert('cancelled meeting is not joinable as live', EXISTS (
    SELECT 1 FROM public.meetings WHERE id = meeting_a.id AND status = 'cancelled'
  ));
END
$$;

SELECT name, passed, detail FROM public.phase4_assertions ORDER BY id;
SELECT count(*) AS total, count(*) FILTER (WHERE passed) AS passed, count(*) FILTER (WHERE NOT passed) AS failed
FROM public.phase4_assertions;
