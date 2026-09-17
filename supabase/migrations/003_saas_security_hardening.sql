CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.is_org_owner_or_admin(p_user_id UUID, p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
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

CREATE OR REPLACE FUNCTION public.is_workspace_in_org(p_workspace_id UUID, p_org_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
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
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.meetings m
    WHERE m.id = p_meeting_id
      AND m.organization_id = p_org_id
  );
$$;

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

DROP TRIGGER IF EXISTS organizations_create_owner_membership ON public.organizations;
CREATE TRIGGER organizations_create_owner_membership
AFTER INSERT ON public.organizations
FOR EACH ROW
WHEN (NEW.created_by IS NOT NULL)
EXECUTE FUNCTION public.ensure_organization_owner_membership();

DROP POLICY IF EXISTS "Users can create organizations" ON public.organizations;
DROP POLICY IF EXISTS "Organizations are viewable to members" ON public.organizations;
DROP POLICY IF EXISTS "Org owners and admins can update organizations" ON public.organizations;

CREATE POLICY "Users can create organizations for themselves" ON public.organizations
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND created_by IS NOT NULL
  );

CREATE POLICY "Organizations are viewable to members" ON public.organizations
  FOR SELECT USING (
    public.is_org_member(auth.uid(), id)
  );

CREATE POLICY "Org owners and admins can update organizations" ON public.organizations
  FOR UPDATE USING (
    public.is_org_owner_or_admin(auth.uid(), id)
  )
  WITH CHECK (
    created_by = OLD.created_by
    AND public.is_org_owner_or_admin(auth.uid(), id)
  );

DROP POLICY IF EXISTS "Organization members are viewable to org members" ON public.organization_members;
DROP POLICY IF EXISTS "Users can join their own org membership" ON public.organization_members;
DROP POLICY IF EXISTS "Org owners and admins can update membership" ON public.organization_members;

CREATE POLICY "Organization members are viewable to org members" ON public.organization_members
  FOR SELECT USING (
    public.is_org_member(auth.uid(), organization_id)
  );

CREATE POLICY "Owners and admins can create organization memberships" ON public.organization_members
  FOR INSERT WITH CHECK (
    public.is_org_owner_or_admin(auth.uid(), organization_id)
    AND user_id <> auth.uid()
    AND role IN ('member', 'guest')
    AND status = 'active'
  );

CREATE POLICY "Org owners and admins can update membership" ON public.organization_members
  FOR UPDATE USING (
    public.is_org_owner_or_admin(auth.uid(), organization_id)
  )
  WITH CHECK (
    public.is_org_owner_or_admin(auth.uid(), organization_id)
    AND user_id = OLD.user_id
    AND organization_id = OLD.organization_id
    AND role IN ('member', 'guest')
  );

DROP POLICY IF EXISTS "Workspaces are viewable by org members" ON public.workspaces;
DROP POLICY IF EXISTS "Org members can create workspaces" ON public.workspaces;
DROP POLICY IF EXISTS "Org owners and admins can update workspaces" ON public.workspaces;

CREATE POLICY "Workspaces are viewable by org members" ON public.workspaces
  FOR SELECT USING (
    public.is_org_member(auth.uid(), organization_id)
  );

CREATE POLICY "Org owners and admins can create workspaces" ON public.workspaces
  FOR INSERT WITH CHECK (
    created_by = auth.uid()
    AND public.is_org_owner_or_admin(auth.uid(), organization_id)
  );

CREATE POLICY "Org owners and admins can update workspaces" ON public.workspaces
  FOR UPDATE USING (
    public.is_org_owner_or_admin(auth.uid(), organization_id)
  )
  WITH CHECK (
    created_by = OLD.created_by
    AND organization_id = OLD.organization_id
    AND public.is_org_owner_or_admin(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "Meeting records are viewable to org members" ON public.meetings;
DROP POLICY IF EXISTS "Authenticated users can create meetings in their org" ON public.meetings;
DROP POLICY IF EXISTS "Hosts can update meetings" ON public.meetings;

CREATE POLICY "Meeting records are viewable to org members" ON public.meetings
  FOR SELECT USING (
    organization_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
  );

CREATE POLICY "Authenticated users can create meetings in their org" ON public.meetings
  FOR INSERT WITH CHECK (
    auth.uid() = host_id
    AND organization_id IS NOT NULL
    AND workspace_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
    AND public.is_workspace_member(auth.uid(), workspace_id)
    AND public.is_workspace_in_org(workspace_id, organization_id)
  );

CREATE POLICY "Hosts can update meetings without tenant changes" ON public.meetings
  FOR UPDATE USING (
    auth.uid() = host_id
    AND public.is_org_member(auth.uid(), organization_id)
  )
  WITH CHECK (
    auth.uid() = host_id
    AND organization_id = OLD.organization_id
    AND workspace_id = OLD.workspace_id
    AND host_id = OLD.host_id
    AND public.is_org_member(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "Scheduled meetings are viewable to org members" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Authenticated users can create scheduled meetings in their org" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Hosts can update scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Hosts can delete scheduled meetings" ON public.scheduled_meetings;

CREATE POLICY "Scheduled meetings are viewable to org members" ON public.scheduled_meetings
  FOR SELECT USING (
    organization_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
  );

CREATE POLICY "Authenticated users can create scheduled meetings in their org" ON public.scheduled_meetings
  FOR INSERT WITH CHECK (
    auth.uid() = host_id
    AND organization_id IS NOT NULL
    AND workspace_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
    AND public.is_workspace_member(auth.uid(), workspace_id)
    AND public.is_workspace_in_org(workspace_id, organization_id)
  );

CREATE POLICY "Hosts can update scheduled meetings without tenant changes" ON public.scheduled_meetings
  FOR UPDATE USING (
    auth.uid() = host_id
    AND public.is_org_member(auth.uid(), organization_id)
  )
  WITH CHECK (
    auth.uid() = host_id
    AND organization_id = OLD.organization_id
    AND workspace_id = OLD.workspace_id
    AND host_id = OLD.host_id
    AND public.is_org_member(auth.uid(), organization_id)
  );

CREATE POLICY "Hosts can delete scheduled meetings" ON public.scheduled_meetings
  FOR DELETE USING (
    auth.uid() = host_id
    AND public.is_org_member(auth.uid(), organization_id)
  );

DROP POLICY IF EXISTS "Participants are viewable when meeting access exists" ON public.meeting_participants;
DROP POLICY IF EXISTS "Users can join a meeting in their org" ON public.meeting_participants;

CREATE POLICY "Participants are viewable when meeting access exists" ON public.meeting_participants
  FOR SELECT USING (
    (
      public.is_org_member(auth.uid(), organization_id)
      AND public.is_meeting_in_org(meeting_id, organization_id)
    )
    OR user_id = auth.uid()
  );

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

CREATE POLICY "Participants can update their own attendance state" ON public.meeting_participants
  FOR UPDATE USING (
    user_id = auth.uid()
  )
  WITH CHECK (
    user_id = OLD.user_id
    AND organization_id = OLD.organization_id
    AND workspace_id = OLD.workspace_id
    AND meeting_id = OLD.meeting_id
    AND role = 'participant'
  );

DROP POLICY IF EXISTS "Chat is readable to meeting members" ON public.chat_messages;
DROP POLICY IF EXISTS "Meeting members can send chat messages" ON public.chat_messages;

CREATE POLICY "Chat is readable to meeting members" ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.chat_messages.meeting_id
        AND public.is_org_member(auth.uid(), m.organization_id)
        AND public.is_meeting_in_org(m.id, m.organization_id)
    )
  );

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
DROP POLICY IF EXISTS "Meeting hosts can create invites" ON public.meeting_invites;

CREATE POLICY "Invites are readable to org members" ON public.meeting_invites
  FOR SELECT USING (
    organization_id IS NOT NULL
    AND public.is_org_member(auth.uid(), organization_id)
  );

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
    organization_id = OLD.organization_id
    AND workspace_id = OLD.workspace_id
    AND meeting_id = OLD.meeting_id
    AND EXISTS (
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

ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.scheduled_meetings ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.chat_messages ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.meeting_invites ENABLE ROW LEVEL SECURITY;
