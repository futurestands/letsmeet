-- Phase 6+ isolated security assertions for invites, collaboration, recordings, AI, orgs.

CREATE TABLE public.phase6_assertions (
  id SERIAL PRIMARY KEY,
  name TEXT NOT NULL,
  passed BOOLEAN NOT NULL,
  detail TEXT
);

CREATE OR REPLACE FUNCTION public.phase6_assert(p_name TEXT, p_ok BOOLEAN, p_detail TEXT DEFAULT '')
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.phase6_assertions (name, passed, detail)
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
  invite_c public.meeting_invites;
  job_a public.meeting_notification_jobs;
  claimed public.meeting_notification_jobs;
  recording_a public.meeting_recordings;
  ai_a public.meeting_ai_jobs;
  member_b public.organization_members;
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
  VALUES ('Org A', 'phase6-org-a', user_a)
  RETURNING id INTO org_a;
  INSERT INTO public.workspaces (organization_id, name, slug, created_by)
  VALUES (org_a, 'Workspace A', 'phase6-workspace-a', user_a)
  RETURNING id INTO workspace_a;
  INSERT INTO public.organization_members (organization_id, user_id, role, status, invited_by)
  VALUES (org_a, user_b, 'member', 'active', user_a)
  RETURNING * INTO member_b;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO scheduled_a FROM public.schedule_persistent_meeting(
    'Phase6', CURRENT_DATE + 2, '11:00', 'UTC', workspace_a, 'Security agenda', 45
  );
  RESET ROLE;
  SELECT * INTO meeting_a FROM public.meetings WHERE code = scheduled_a.meeting_code;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO invite_c FROM public.invite_to_persistent_meeting(meeting_a.id, 'c@example.com');
  RESET ROLE;
  PERFORM public.phase6_assert('invite queues pending notification without provider delivery', EXISTS (
    SELECT 1 FROM public.meeting_notification_jobs
    WHERE invite_id = invite_c.id AND status = 'pending' AND provider_message_id IS NULL
  ));

  SELECT * INTO job_a FROM public.meeting_notification_jobs
  WHERE invite_id = invite_c.id AND channel = 'in_app'
  ORDER BY created_at LIMIT 1;

  SELECT * INTO claimed FROM public.claim_notification_job(job_a.id);
  PERFORM public.phase6_assert('notification job can enter processing', claimed.status = 'processing');
  BEGIN
    PERFORM public.complete_notification_job(job_a.id, NULL, NULL);
    PERFORM public.phase6_assert('complete without provider is rejected', false, 'completed');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase6_assert('complete without provider is rejected', true, SQLERRM);
  END;
  SELECT * INTO claimed FROM public.release_notification_job(job_a.id);
  PERFORM public.phase6_assert('processing job can return to pending', claimed.status = 'pending');

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_c::text, false);
  PERFORM public.join_persistent_meeting(meeting_a.code);
  BEGIN
    PERFORM public.request_meeting_recording(meeting_a.id);
    PERFORM public.phase6_assert('guest cannot start recording', false, 'recording started');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase6_assert('guest cannot start recording', true, SQLERRM);
  END;
  BEGIN
    PERFORM public.request_meeting_ai_job(meeting_a.id, 'summary', NULL);
    -- guest participant may queue AI for a meeting they joined; unauthorized outsider must fail elsewhere
    PERFORM public.phase6_assert('joined guest may queue AI for accessible meeting', true);
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase6_assert('joined guest may queue AI for accessible meeting', false, SQLERRM);
  END;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  SELECT * INTO recording_a FROM public.request_meeting_recording(meeting_a.id);
  SELECT * INTO ai_a FROM public.request_meeting_ai_job(meeting_a.id, 'transcript_qa', 'What was decided?');
  PERFORM public.revoke_meeting_invite(invite_c.id);
  RESET ROLE;
  PERFORM public.phase6_assert('recording stays queued without egress', recording_a.status = 'queued');
  PERFORM public.phase6_assert('AI stays queued without provider', ai_a.status = 'queued');
  PERFORM public.phase6_assert('revoke marks invite revoked', EXISTS (
    SELECT 1 FROM public.meeting_invites WHERE id = invite_c.id AND status = 'revoked'
  ));

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_c::text, false);
  BEGIN
    PERFORM public.lookup_joinable_meeting(meeting_a.code);
    PERFORM public.phase6_assert('revoked invite cannot look up meeting', false, 'lookup succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase6_assert('revoked invite cannot look up meeting', true, SQLERRM);
  END;
  BEGIN
    PERFORM public.update_organization_settings(30, TRUE);
    PERFORM public.phase6_assert('non-admin cannot update organization settings', false, 'settings updated');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase6_assert('non-admin cannot update organization settings', true, SQLERRM);
  END;
  BEGIN
    PERFORM public.update_organization_member_role(member_b.id, 'admin');
    PERFORM public.phase6_assert('non-admin cannot promote members', false, 'role changed');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase6_assert('non-admin cannot promote members', true, SQLERRM);
  END;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_b::text, false);
  BEGIN
    PERFORM public.update_organization_member_role(member_b.id, 'admin');
    PERFORM public.phase6_assert('member cannot self-promote', false, 'self promotion succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase6_assert('member cannot self-promote', true, SQLERRM);
  END;
  RESET ROLE;

  SET ROLE authenticated;
  PERFORM set_config('request.jwt.claim.sub', user_a::text, false);
  PERFORM public.transition_persistent_meeting(meeting_a.id, 'cancelled');
  BEGIN
    PERFORM public.join_persistent_meeting(meeting_a.code);
    PERFORM public.phase6_assert('cancelled meeting cannot be joined', false, 'join succeeded');
  EXCEPTION WHEN OTHERS THEN
    PERFORM public.phase6_assert('cancelled meeting cannot be joined', true, SQLERRM);
  END;
  RESET ROLE;

  PERFORM public.phase6_assert('cancel writes an audit log', EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE resource_id = meeting_a.id::text AND action = 'meeting.cancelled'
  ));
  PERFORM public.phase6_assert('invite writes an audit log', EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE resource_type = 'meeting_invite' AND resource_id = invite_c.id::text
  ));
  PERFORM public.phase6_assert('audit logs do not store secrets', NOT EXISTS (
    SELECT 1 FROM public.audit_logs
    WHERE metadata::text ILIKE '%service_role%'
       OR metadata::text ILIKE '%api_secret%'
       OR metadata::text ILIKE '%password%'
  ));
END
$$;

SELECT name, passed, detail FROM public.phase6_assertions ORDER BY id;
SELECT count(*) AS total, count(*) FILTER (WHERE passed) AS passed, count(*) FILTER (WHERE NOT passed) AS failed
FROM public.phase6_assertions;
