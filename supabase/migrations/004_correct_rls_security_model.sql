-- Corrective migration for 003_saas_security_hardening.sql.
-- RLS policy expressions cannot reference OLD or NEW. Immutable tenant and
-- ownership fields are enforced by BEFORE UPDATE triggers instead.

CREATE OR REPLACE FUNCTION public.is_org_member(p_user_id UUID, p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.organization_members om
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
    SELECT 1
    FROM public.organization_members om
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
    JOIN public.organization_members om
      ON om.organization_id = w.organization_id
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
    SELECT 1
    FROM public.workspaces w
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
    SELECT 1
    FROM public.meetings m
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

CREATE OR REPLACE FUNCTION public.prevent_organization_tenant_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Organization creator is immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_workspace_tenant_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
    RAISE EXCEPTION 'Workspace tenant and creator are immutable';
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.prevent_meeting_tenant_changes()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
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
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.organization_id IS DISTINCT FROM OLD.organization_id
     OR NEW.workspace_id IS DISTINCT FROM OLD.workspace_id
     OR NEW.meeting_id IS DISTINCT FROM OLD.meeting_id THEN
    RAISE EXCEPTION 'Invite tenant and meeting fields are immutable';
  END IF;
  RETURN NEW;
END;
$$;

REVOKE ALL ON FUNCTION public.prevent_organization_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_workspace_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_meeting_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_scheduled_meeting_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_participant_tenant_changes() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.prevent_invite_tenant_changes() FROM PUBLIC;

DROP TRIGGER IF EXISTS organizations_prevent_tenant_changes ON public.organizations;
CREATE TRIGGER organizations_prevent_tenant_changes
BEFORE UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.prevent_organization_tenant_changes();

DROP TRIGGER IF EXISTS workspaces_prevent_tenant_changes ON public.workspaces;
CREATE TRIGGER workspaces_prevent_tenant_changes
BEFORE UPDATE ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.prevent_workspace_tenant_changes();

DROP TRIGGER IF EXISTS meetings_prevent_tenant_changes ON public.meetings;
CREATE TRIGGER meetings_prevent_tenant_changes
BEFORE UPDATE ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_meeting_tenant_changes();

DROP TRIGGER IF EXISTS scheduled_meetings_prevent_tenant_changes ON public.scheduled_meetings;
CREATE TRIGGER scheduled_meetings_prevent_tenant_changes
BEFORE UPDATE ON public.scheduled_meetings
FOR EACH ROW
EXECUTE FUNCTION public.prevent_scheduled_meeting_tenant_changes();

DROP TRIGGER IF EXISTS meeting_participants_prevent_tenant_changes ON public.meeting_participants;
CREATE TRIGGER meeting_participants_prevent_tenant_changes
BEFORE UPDATE ON public.meeting_participants
FOR EACH ROW
EXECUTE FUNCTION public.prevent_participant_tenant_changes();

DROP TRIGGER IF EXISTS meeting_invites_prevent_tenant_changes ON public.meeting_invites;
CREATE TRIGGER meeting_invites_prevent_tenant_changes
BEFORE UPDATE ON public.meeting_invites
FOR EACH ROW
EXECUTE FUNCTION public.prevent_invite_tenant_changes();

REVOKE ALL ON FUNCTION public.ensure_organization_owner_membership() FROM PUBLIC;
REVOKE ALL ON FUNCTION public.ensure_user_profile_context(UUID, TEXT, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ensure_user_profile_context(UUID, TEXT, TEXT) TO authenticated;

DROP POLICY IF EXISTS "Authenticated users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Users can create organizations for themselves" ON public.organizations;
CREATE POLICY "Users can create organizations for themselves" ON public.organizations
  FOR INSERT WITH CHECK (
    auth.uid() IS NOT NULL
    AND created_by = auth.uid()
  );

DROP POLICY IF EXISTS "Org owners and admins can update organizations" ON public.organizations;
CREATE POLICY "Org owners and admins can update organizations" ON public.organizations
  FOR UPDATE USING (
    public.is_org_owner_or_admin(auth.uid(), id)
  )
  WITH CHECK (
    public.is_org_owner_or_admin(auth.uid(), id)
  );

DROP POLICY IF EXISTS "Org owners and admins can update membership" ON public.organization_members;
CREATE POLICY "Org owners and admins can update membership" ON public.organization_members
  FOR UPDATE USING (
    public.is_org_owner_or_admin(auth.uid(), organization_id)
  )
  WITH CHECK (
    public.is_org_owner_or_admin(auth.uid(), organization_id)
    AND role IN ('member', 'guest')
  );

DROP POLICY IF EXISTS "Org owners and admins can update workspaces" ON public.workspaces;
CREATE POLICY "Org owners and admins can update workspaces" ON public.workspaces
  FOR UPDATE USING (
    public.is_org_owner_or_admin(auth.uid(), organization_id)
  )
  WITH CHECK (
    public.is_org_owner_or_admin(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "Hosts can update meetings without tenant changes" ON public.meetings;
CREATE POLICY "Hosts can update meetings without tenant changes" ON public.meetings
  FOR UPDATE USING (
    auth.uid() = host_id
    AND public.is_org_member(auth.uid(), organization_id)
  )
  WITH CHECK (
    auth.uid() = host_id
    AND public.is_org_member(auth.uid(), organization_id)
    AND public.is_workspace_in_org(workspace_id, organization_id)
  );

DROP POLICY IF EXISTS "Hosts can update scheduled meetings without tenant changes" ON public.scheduled_meetings;
CREATE POLICY "Hosts can update scheduled meetings without tenant changes" ON public.scheduled_meetings
  FOR UPDATE USING (
    auth.uid() = host_id
    AND public.is_org_member(auth.uid(), organization_id)
  )
  WITH CHECK (
    auth.uid() = host_id
    AND public.is_org_member(auth.uid(), organization_id)
    AND public.is_workspace_in_org(workspace_id, organization_id)
  );

DROP POLICY IF EXISTS "Participants can update their own attendance state" ON public.meeting_participants;
CREATE POLICY "Participants can update their own attendance state" ON public.meeting_participants
  FOR UPDATE USING (
    user_id = auth.uid()
  )
  WITH CHECK (
    user_id = auth.uid()
    AND role = 'participant'
    AND status IN ('joined', 'muted', 'waiting', 'left', 'removed')
  );

DROP POLICY IF EXISTS "Invites can be updated by hosts or org admins" ON public.meeting_invites;
CREATE POLICY "Invites can be updated by hosts or org admins" ON public.meeting_invites
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.meeting_invites.meeting_id
        AND m.organization_id = public.meeting_invites.organization_id
        AND (
          m.host_id = auth.uid()
          OR public.is_org_owner_or_admin(auth.uid(), m.organization_id)
        )
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.meeting_invites.meeting_id
        AND m.organization_id = public.meeting_invites.organization_id
        AND (
          m.host_id = auth.uid()
          OR public.is_org_owner_or_admin(auth.uid(), m.organization_id)
        )
    )
  );

-- Recreate the complete tenant policy set so this correction is safe after a
-- partial 003 execution as well as after a repaired full execution.
DROP POLICY IF EXISTS "Organizations are viewable to members" ON public.organizations;
CREATE POLICY "Organizations are viewable to members" ON public.organizations
  FOR SELECT USING (public.is_org_member(auth.uid(), id));

DROP POLICY IF EXISTS "Organization members are viewable to org members" ON public.organization_members;
CREATE POLICY "Organization members are viewable to org members" ON public.organization_members
  FOR SELECT USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Owners and admins can create organization memberships" ON public.organization_members;
DROP POLICY IF EXISTS "Users can join their own org membership" ON public.organization_members;
CREATE POLICY "Owners and admins can create organization memberships" ON public.organization_members
  FOR INSERT WITH CHECK (
    public.is_org_owner_or_admin(auth.uid(), organization_id)
    AND user_id <> auth.uid()
    AND role IN ('member', 'guest')
    AND status = 'active'
  );

DROP POLICY IF EXISTS "Workspaces are viewable by org members" ON public.workspaces;
CREATE POLICY "Workspaces are viewable by org members" ON public.workspaces
  FOR SELECT USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Org owners and admins can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Org members can create workspaces" ON public.workspaces;
CREATE POLICY "Org owners and admins can create workspaces" ON public.workspaces
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND public.is_org_owner_or_admin(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "Meeting records are viewable to org members" ON public.meetings;
CREATE POLICY "Meeting records are viewable to org members" ON public.meetings
  FOR SELECT USING (
    organization_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "Authenticated users can create meetings in their org" ON public.meetings;
CREATE POLICY "Authenticated users can create meetings in their org" ON public.meetings
  FOR INSERT WITH CHECK (
    auth.uid() = host_id
    AND organization_id IS NOT NULL
    AND workspace_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
    AND public.is_workspace_member(auth.uid(), workspace_id)
    AND public.is_workspace_in_org(workspace_id, organization_id)
  );

DROP POLICY IF EXISTS "Scheduled meetings are viewable to org members" ON public.scheduled_meetings;
CREATE POLICY "Scheduled meetings are viewable to org members" ON public.scheduled_meetings
  FOR SELECT USING (
    organization_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "Authenticated users can create scheduled meetings in their org" ON public.scheduled_meetings;
CREATE POLICY "Authenticated users can create scheduled meetings in their org" ON public.scheduled_meetings
  FOR INSERT WITH CHECK (
    auth.uid() = host_id
    AND organization_id IS NOT NULL
    AND workspace_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
    AND public.is_workspace_member(auth.uid(), workspace_id)
    AND public.is_workspace_in_org(workspace_id, organization_id)
  );

DROP POLICY IF EXISTS "Hosts can delete scheduled meetings" ON public.scheduled_meetings;
CREATE POLICY "Hosts can delete scheduled meetings" ON public.scheduled_meetings
  FOR DELETE USING (
    auth.uid() = host_id
    AND public.is_org_member(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "Participants are viewable when meeting access exists" ON public.meeting_participants;
CREATE POLICY "Participants are viewable when meeting access exists" ON public.meeting_participants
  FOR SELECT USING (
    (
      public.is_org_member(auth.uid(), organization_id)
      AND public.is_meeting_in_org(meeting_id, organization_id)
    )
    OR user_id = auth.uid()
  );

DROP POLICY IF EXISTS "Users can join a meeting as a participant only" ON public.meeting_participants;
DROP POLICY IF EXISTS "Users can join a meeting in their org" ON public.meeting_participants;
CREATE POLICY "Users can join a meeting as a participant only" ON public.meeting_participants
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND organization_id IS NOT NULL
    AND workspace_id IS NOT NULL
    AND role = 'participant'
    AND status IN ('joined', 'waiting')
    AND public.is_org_member(auth.uid(), organization_id)
    AND public.is_meeting_in_org(meeting_id, organization_id)
    AND public.is_workspace_in_org(workspace_id, organization_id)
  );

DROP POLICY IF EXISTS "Chat is readable to meeting members" ON public.chat_messages;
CREATE POLICY "Chat is readable to meeting members" ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.chat_messages.meeting_id
        AND m.organization_id = public.chat_messages.organization_id
        AND public.is_org_member(auth.uid(), m.organization_id)
    )
  );

DROP POLICY IF EXISTS "Meeting members can send chat messages" ON public.chat_messages;
CREATE POLICY "Meeting members can send chat messages" ON public.chat_messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND organization_id IS NOT NULL
    AND workspace_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.chat_messages.meeting_id
        AND m.organization_id = public.chat_messages.organization_id
        AND m.workspace_id = public.chat_messages.workspace_id
        AND public.is_org_member(auth.uid(), m.organization_id)
    )
  );

DROP POLICY IF EXISTS "Invites are readable to org members" ON public.meeting_invites;
CREATE POLICY "Invites are readable to org members" ON public.meeting_invites
  FOR SELECT USING (public.is_org_member(auth.uid(), organization_id));

DROP POLICY IF EXISTS "Meeting hosts and org admins can create invites" ON public.meeting_invites;
DROP POLICY IF EXISTS "Meeting hosts can create invites" ON public.meeting_invites;
CREATE POLICY "Meeting hosts and org admins can create invites" ON public.meeting_invites
  FOR INSERT WITH CHECK (
    organization_id IS NOT NULL
    AND workspace_id IS NOT NULL
    AND EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.meeting_invites.meeting_id
        AND m.organization_id = public.meeting_invites.organization_id
        AND m.workspace_id = public.meeting_invites.workspace_id
        AND (
          m.host_id = auth.uid()
          OR public.is_org_owner_or_admin(auth.uid(), m.organization_id)
        )
    )
  );

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_invites ENABLE ROW LEVEL SECURITY;
