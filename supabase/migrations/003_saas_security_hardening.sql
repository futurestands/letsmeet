CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.is_org_member(p_user_id UUID, p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = p_user_id
      AND om.organization_id = p_org_id
      AND om.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_org_owner_or_admin(p_user_id UUID, p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.organization_members om
    WHERE om.user_id = p_user_id
      AND om.organization_id = p_org_id
      AND om.status = 'active'
      AND om.role IN ('owner', 'admin')
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_user_id UUID, p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.workspaces w
    JOIN public.organization_members om ON om.organization_id = w.organization_id
    WHERE w.id = p_workspace_id
      AND om.user_id = p_user_id
      AND om.status = 'active'
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_in_org(p_workspace_id UUID, p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.workspaces w
    WHERE w.id = p_workspace_id
      AND w.organization_id = p_org_id
  );
$$;

CREATE OR REPLACE FUNCTION public.is_meeting_in_org(p_meeting_id UUID, p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = p_meeting_id
      AND m.organization_id = p_org_id
  );
$$;

REVOKE ALL ON FUNCTION public.is_org_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_org_owner_or_admin(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_member(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_workspace_in_org(UUID, UUID) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.is_meeting_in_org(UUID, UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_org_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_org_owner_or_admin(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_member(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_workspace_in_org(UUID, UUID) TO authenticated;
GRANT EXECUTE ON FUNCTION public.is_meeting_in_org(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.ensure_organization_owner_membership()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.created_by IS NULL THEN
    RAISE EXCEPTION 'Organization created_by is required';
  END IF;

  INSERT INTO public.organization_members (organization_id, user_id, role, status, invited_by)
  VALUES (NEW.id, NEW.created_by, 'owner', 'active', NEW.created_by)
  ON CONFLICT (organization_id, user_id) DO NOTHING;

  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_organization_owner_membership() FROM PUBLIC;

CREATE OR REPLACE FUNCTION public.prevent_organization_tenant_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Organization creator is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_membership_tenant_or_role_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Membership tenant and identity fields are immutable';
  END IF;
  IF OLD.role = 'owner' AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Owner role is immutable';
  END IF;
  IF NEW.role = 'owner' AND NEW.role IS DISTINCT FROM OLD.role THEN
    RAISE EXCEPTION 'Owner role can only be assigned by organization creation';
  END IF;
  IF NEW.role = 'admin'
     AND NEW.role IS DISTINCT FROM OLD.role
     AND NOT public.is_org_owner_or_admin(auth.uid(), OLD.organization_id) THEN
    RAISE EXCEPTION 'Only organization owners and admins can assign admin role';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_workspace_tenant_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Workspace tenant and creator are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_meeting_tenant_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.host_id IS DISTINCT FROM OLD.host_id THEN
    RAISE EXCEPTION 'Meeting tenant and host fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_scheduled_meeting_tenant_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.host_id IS DISTINCT FROM OLD.host_id THEN
    RAISE EXCEPTION 'Scheduled meeting tenant and host fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_participant_tenant_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.meeting_id IS DISTINCT FROM OLD.meeting_id
     OR NEW.user_id IS DISTINCT FROM OLD.user_id THEN
    RAISE EXCEPTION 'Participant tenant and identity fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_invite_tenant_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.meeting_id IS DISTINCT FROM OLD.meeting_id THEN
    RAISE EXCEPTION 'Invite tenant and meeting fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_subscription_tenant_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id THEN
    RAISE EXCEPTION 'Subscription organization is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_usage_tenant_changes()
RETURNS TRIGGER LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id THEN
    RAISE EXCEPTION 'Usage tenant fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_organization_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_membership_tenant_or_role_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_workspace_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_meeting_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_scheduled_meeting_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_participant_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_invite_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_subscription_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_usage_tenant_changes() FROM PUBLIC;

DROP TRIGGER IF EXISTS organizations_create_owner_membership ON public.organizations;
CREATE TRIGGER organizations_create_owner_membership AFTER INSERT ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.ensure_organization_owner_membership();
DROP TRIGGER IF EXISTS organizations_prevent_tenant_changes ON public.organizations;
CREATE TRIGGER organizations_prevent_tenant_changes BEFORE UPDATE ON public.organizations
FOR EACH ROW EXECUTE FUNCTION public.prevent_organization_tenant_changes();
DROP TRIGGER IF EXISTS organization_members_prevent_tenant_or_role_changes ON public.organization_members;
CREATE TRIGGER organization_members_prevent_tenant_or_role_changes BEFORE UPDATE ON public.organization_members
FOR EACH ROW EXECUTE FUNCTION public.prevent_membership_tenant_or_role_changes();
DROP TRIGGER IF EXISTS workspaces_prevent_tenant_changes ON public.workspaces;
CREATE TRIGGER workspaces_prevent_tenant_changes BEFORE UPDATE ON public.workspaces
FOR EACH ROW EXECUTE FUNCTION public.prevent_workspace_tenant_changes();
DROP TRIGGER IF EXISTS meetings_prevent_tenant_changes ON public.meetings;
CREATE TRIGGER meetings_prevent_tenant_changes BEFORE UPDATE ON public.meetings
FOR EACH ROW EXECUTE FUNCTION public.prevent_meeting_tenant_changes();
DROP TRIGGER IF EXISTS scheduled_meetings_prevent_tenant_changes ON public.scheduled_meetings;
CREATE TRIGGER scheduled_meetings_prevent_tenant_changes BEFORE UPDATE ON public.scheduled_meetings
FOR EACH ROW EXECUTE FUNCTION public.prevent_scheduled_meeting_tenant_changes();
DROP TRIGGER IF EXISTS meeting_participants_prevent_tenant_changes ON public.meeting_participants;
CREATE TRIGGER meeting_participants_prevent_tenant_changes BEFORE UPDATE ON public.meeting_participants
FOR EACH ROW EXECUTE FUNCTION public.prevent_participant_tenant_changes();
DROP TRIGGER IF EXISTS meeting_invites_prevent_tenant_changes ON public.meeting_invites;
CREATE TRIGGER meeting_invites_prevent_tenant_changes BEFORE UPDATE ON public.meeting_invites
FOR EACH ROW EXECUTE FUNCTION public.prevent_invite_tenant_changes();
DROP TRIGGER IF EXISTS subscriptions_prevent_tenant_changes ON public.subscriptions;
CREATE TRIGGER subscriptions_prevent_tenant_changes BEFORE UPDATE ON public.subscriptions
FOR EACH ROW EXECUTE FUNCTION public.prevent_subscription_tenant_changes();
DROP TRIGGER IF EXISTS usage_daily_prevent_tenant_changes ON public.usage_daily;
CREATE TRIGGER usage_daily_prevent_tenant_changes BEFORE UPDATE ON public.usage_daily
FOR EACH ROW EXECUTE FUNCTION public.prevent_usage_tenant_changes();

REVOKE ALL ON FUNCTION public.ensure_user_profile_context(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile_context(UUID, TEXT, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations for themselves" ON public.organizations;
DROP POLICY IF EXISTS "Organizations are viewable to members" ON public.organizations;
DROP POLICY IF EXISTS "Org owners and admins can update organizations" ON public.organizations;
CREATE POLICY "Users can create organizations for themselves" ON public.organizations FOR INSERT
WITH CHECK (auth.uid() IS NOT NULL AND created_by = auth.uid());
CREATE POLICY "Organizations are viewable to members" ON public.organizations FOR SELECT
USING (public.is_org_member(auth.uid(), id));
CREATE POLICY "Org owners and admins can update organizations" ON public.organizations FOR UPDATE
USING (public.is_org_owner_or_admin(auth.uid(), id))
WITH CHECK (public.is_org_owner_or_admin(auth.uid(), id));

DROP POLICY IF EXISTS "Organization members are viewable to org members" ON public.organization_members;
DROP POLICY IF EXISTS "Users can join their own org membership" ON public.organization_members;
DROP POLICY IF EXISTS "Owners and admins can create organization memberships" ON public.organization_members;
DROP POLICY IF EXISTS "Org owners and admins can update membership" ON public.organization_members;
CREATE POLICY "Organization members are viewable to org members" ON public.organization_members FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Owners and admins can create organization memberships" ON public.organization_members FOR INSERT
WITH CHECK (
  public.is_org_owner_or_admin(auth.uid(), organization_id)
  AND user_id <> auth.uid()
  AND role IN ('admin', 'member', 'guest')
  AND status = 'active'
  AND invited_by = auth.uid()
);
CREATE POLICY "Org owners and admins can update membership" ON public.organization_members FOR UPDATE
USING (public.is_org_owner_or_admin(auth.uid(), organization_id))
WITH CHECK (public.is_org_owner_or_admin(auth.uid(), organization_id) AND role IN ('admin', 'member', 'guest'));

DROP POLICY IF EXISTS "Workspaces are viewable by org members" ON public.workspaces;
DROP POLICY IF EXISTS "Org members can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Org owners and admins can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Org owners and admins can update workspaces" ON public.workspaces;
CREATE POLICY "Workspaces are viewable by org members" ON public.workspaces FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org owners and admins can create workspaces" ON public.workspaces FOR INSERT
WITH CHECK (created_by = auth.uid() AND public.is_org_owner_or_admin(auth.uid(), organization_id));
CREATE POLICY "Org owners and admins can update workspaces" ON public.workspaces FOR UPDATE
USING (public.is_org_owner_or_admin(auth.uid(), organization_id))
WITH CHECK (public.is_org_owner_or_admin(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Subscriptions are viewable to org members" ON public.subscriptions;
DROP POLICY IF EXISTS "Org owners and admins can manage subscriptions" ON public.subscriptions;
CREATE POLICY "Subscriptions are viewable to org members" ON public.subscriptions FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org owners and admins can manage subscriptions" ON public.subscriptions FOR ALL
USING (public.is_org_owner_or_admin(auth.uid(), organization_id))
WITH CHECK (public.is_org_owner_or_admin(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Usage data is viewable to org members" ON public.usage_daily;
DROP POLICY IF EXISTS "Org owners and admins can update usage data" ON public.usage_daily;
CREATE POLICY "Usage data is viewable to org members" ON public.usage_daily FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Org owners and admins can update usage data" ON public.usage_daily FOR ALL
USING (public.is_org_owner_or_admin(auth.uid(), organization_id))
WITH CHECK (
  public.is_org_owner_or_admin(auth.uid(), organization_id)
  AND (workspace_id IS NULL OR public.is_workspace_in_org(workspace_id, organization_id))
);

DROP POLICY IF EXISTS "Anyone can view meetings" ON public.meetings;
DROP POLICY IF EXISTS "Authenticated users can create meetings" ON public.meetings;
DROP POLICY IF EXISTS "Host can update meetings" ON public.meetings;
DROP POLICY IF EXISTS "Meeting records are viewable to org members" ON public.meetings;
DROP POLICY IF EXISTS "Authenticated users can create meetings in their org" ON public.meetings;
DROP POLICY IF EXISTS "Hosts can update meetings" ON public.meetings;
DROP POLICY IF EXISTS "Hosts can update meetings without tenant changes" ON public.meetings;
CREATE POLICY "Meeting records are viewable to org members" ON public.meetings FOR SELECT
USING (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Authenticated users can create meetings in their org" ON public.meetings FOR INSERT
WITH CHECK (
  auth.uid() = host_id
  AND organization_id IS NOT NULL AND workspace_id IS NOT NULL
  AND public.is_org_member(auth.uid(), organization_id)
  AND public.is_workspace_member(auth.uid(), workspace_id)
  AND public.is_workspace_in_org(workspace_id, organization_id)
);
CREATE POLICY "Hosts can update meetings without tenant changes" ON public.meetings FOR UPDATE
USING (auth.uid() = host_id AND public.is_org_member(auth.uid(), organization_id))
WITH CHECK (
  auth.uid() = host_id
  AND public.is_org_member(auth.uid(), organization_id)
  AND public.is_workspace_in_org(workspace_id, organization_id)
);

DROP POLICY IF EXISTS "Anyone can view scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Authenticated users can create scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Host can update scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Host can delete scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Scheduled meetings are viewable to org members" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Authenticated users can create scheduled meetings in their org" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Hosts can update scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Hosts can update scheduled meetings without tenant changes" ON public.scheduled_meetings;
CREATE POLICY "Scheduled meetings are viewable to org members" ON public.scheduled_meetings FOR SELECT
USING (organization_id IS NOT NULL AND public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Authenticated users can create scheduled meetings in their org" ON public.scheduled_meetings FOR INSERT
WITH CHECK (
  auth.uid() = host_id
  AND organization_id IS NOT NULL AND workspace_id IS NOT NULL
  AND public.is_org_member(auth.uid(), organization_id)
  AND public.is_workspace_member(auth.uid(), workspace_id)
  AND public.is_workspace_in_org(workspace_id, organization_id)
);
CREATE POLICY "Hosts can update scheduled meetings without tenant changes" ON public.scheduled_meetings FOR UPDATE
USING (auth.uid() = host_id AND public.is_org_member(auth.uid(), organization_id))
WITH CHECK (
  auth.uid() = host_id
  AND public.is_org_member(auth.uid(), organization_id)
  AND public.is_workspace_in_org(workspace_id, organization_id)
);
CREATE POLICY "Hosts can delete scheduled meetings" ON public.scheduled_meetings FOR DELETE
USING (auth.uid() = host_id AND public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Anyone can view participants" ON public.meeting_participants;
DROP POLICY IF EXISTS "Authenticated users can join meetings" ON public.meeting_participants;
DROP POLICY IF EXISTS "Participants are viewable when meeting access exists" ON public.meeting_participants;
DROP POLICY IF EXISTS "Users can join their own org membership" ON public.meeting_participants;
DROP POLICY IF EXISTS "Users can join a meeting in their org" ON public.meeting_participants;
DROP POLICY IF EXISTS "Users can join a meeting as a participant only" ON public.meeting_participants;
DROP POLICY IF EXISTS "Participants can update their own attendance state" ON public.meeting_participants;
CREATE POLICY "Participants are viewable when meeting access exists" ON public.meeting_participants FOR SELECT
USING ((public.is_org_member(auth.uid(), organization_id) AND public.is_meeting_in_org(meeting_id, organization_id)) OR user_id = auth.uid());
CREATE POLICY "Users can join a meeting as a participant only" ON public.meeting_participants FOR INSERT
WITH CHECK (
  user_id = auth.uid()
  AND organization_id IS NOT NULL AND workspace_id IS NOT NULL
  AND role = 'participant' AND status IN ('joined', 'waiting')
  AND public.is_org_member(auth.uid(), organization_id)
  AND EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = public.meeting_participants.meeting_id
      AND m.organization_id = public.meeting_participants.organization_id
      AND m.workspace_id = public.meeting_participants.workspace_id
  )
);
CREATE POLICY "Participants can update their own attendance state" ON public.meeting_participants FOR UPDATE
USING (user_id = auth.uid())
WITH CHECK (user_id = auth.uid() AND role = 'participant' AND status IN ('joined', 'muted', 'waiting', 'left', 'removed'));

DROP POLICY IF EXISTS "Anyone can view chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Chat is readable to meeting members" ON public.chat_messages;
DROP POLICY IF EXISTS "Meeting members can send chat messages" ON public.chat_messages;
CREATE POLICY "Chat is readable to meeting members" ON public.chat_messages FOR SELECT
USING (EXISTS (
  SELECT 1 FROM public.meetings m
  WHERE m.id = public.chat_messages.meeting_id
    AND m.organization_id = public.chat_messages.organization_id
    AND m.workspace_id = public.chat_messages.workspace_id
    AND public.is_org_member(auth.uid(), m.organization_id)
));
CREATE POLICY "Meeting members can send chat messages" ON public.chat_messages FOR INSERT
WITH CHECK (
  auth.uid() = user_id
  AND organization_id IS NOT NULL AND workspace_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = public.chat_messages.meeting_id
      AND m.organization_id = public.chat_messages.organization_id
      AND m.workspace_id = public.chat_messages.workspace_id
      AND public.is_org_member(auth.uid(), m.organization_id)
  )
);

DROP POLICY IF EXISTS "Anyone can view invites" ON public.meeting_invites;
DROP POLICY IF EXISTS "Authenticated users can create invites" ON public.meeting_invites;
DROP POLICY IF EXISTS "Invites are readable to org members" ON public.meeting_invites;
DROP POLICY IF EXISTS "Meeting hosts can create invites" ON public.meeting_invites;
DROP POLICY IF EXISTS "Meeting hosts and org admins can create invites" ON public.meeting_invites;
DROP POLICY IF EXISTS "Invites can be updated by hosts or org admins" ON public.meeting_invites;
CREATE POLICY "Invites are readable to org members" ON public.meeting_invites FOR SELECT
USING (public.is_org_member(auth.uid(), organization_id));
CREATE POLICY "Meeting hosts and org admins can create invites" ON public.meeting_invites FOR INSERT
WITH CHECK (
  organization_id IS NOT NULL AND workspace_id IS NOT NULL
  AND EXISTS (
    SELECT 1 FROM public.meetings m
    WHERE m.id = public.meeting_invites.meeting_id
      AND m.organization_id = public.meeting_invites.organization_id
      AND m.workspace_id = public.meeting_invites.workspace_id
      AND (m.host_id = auth.uid() OR public.is_org_owner_or_admin(auth.uid(), m.organization_id))
  )
);
CREATE POLICY "Invites can be updated by hosts or org admins" ON public.meeting_invites FOR UPDATE
USING (EXISTS (
  SELECT 1 FROM public.meetings m
  WHERE m.id = public.meeting_invites.meeting_id
    AND m.organization_id = public.meeting_invites.organization_id
    AND (m.host_id = auth.uid() OR public.is_org_owner_or_admin(auth.uid(), m.organization_id))
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.meetings m
  WHERE m.id = public.meeting_invites.meeting_id
    AND m.organization_id = public.meeting_invites.organization_id
    AND (m.host_id = auth.uid() OR public.is_org_owner_or_admin(auth.uid(), m.organization_id))
));

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_invites ENABLE ROW LEVEL SECURITY;
