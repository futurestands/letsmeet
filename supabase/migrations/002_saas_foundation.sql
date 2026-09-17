CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

CREATE TABLE IF NOT EXISTS public.organizations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT NOT NULL UNIQUE,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.organization_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'member', 'guest')),
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('invited', 'active', 'disabled')),
  invited_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, user_id)
);

CREATE TABLE IF NOT EXISTS public.workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  slug TEXT NOT NULL,
  created_by UUID REFERENCES public.users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, slug)
);

CREATE TABLE IF NOT EXISTS public.subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  plan TEXT NOT NULL DEFAULT 'starter',
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('trial', 'active', 'paused', 'cancelled', 'expired')),
  seats INTEGER NOT NULL DEFAULT 10,
  started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  ends_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.usage_daily (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID NOT NULL REFERENCES public.organizations(id) ON DELETE CASCADE,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  metric TEXT NOT NULL,
  usage_date DATE NOT NULL,
  value NUMERIC(20, 4) NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (organization_id, workspace_id, metric, usage_date)
);

ALTER TABLE public.meetings
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
  ADD COLUMN IF NOT EXISTS scheduled_for TIMESTAMPTZ,
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.scheduled_meetings
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'live', 'ended', 'cancelled')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.meeting_participants
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id),
  ADD COLUMN IF NOT EXISTS role TEXT NOT NULL DEFAULT 'participant' CHECK (role IN ('host', 'co-host', 'moderator', 'participant')),
  ADD COLUMN IF NOT EXISTS status TEXT NOT NULL DEFAULT 'joined' CHECK (status IN ('joined', 'muted', 'waiting', 'left', 'removed')),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.chat_messages
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

ALTER TABLE public.meeting_invites
  ADD COLUMN IF NOT EXISTS organization_id UUID REFERENCES public.organizations(id),
  ADD COLUMN IF NOT EXISTS workspace_id UUID REFERENCES public.workspaces(id),
  ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW();

CREATE INDEX IF NOT EXISTS idx_organizations_slug ON public.organizations(slug);
CREATE INDEX IF NOT EXISTS idx_organization_members_org_user ON public.organization_members(organization_id, user_id);
CREATE INDEX IF NOT EXISTS idx_organization_members_user ON public.organization_members(user_id);
CREATE INDEX IF NOT EXISTS idx_workspaces_org ON public.workspaces(organization_id);
CREATE INDEX IF NOT EXISTS idx_subscriptions_org ON public.subscriptions(organization_id);
CREATE INDEX IF NOT EXISTS idx_usage_daily_org_date ON public.usage_daily(organization_id, usage_date);
CREATE INDEX IF NOT EXISTS idx_meetings_org_workspace ON public.meetings(organization_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_meetings_code ON public.meetings(code);
CREATE INDEX IF NOT EXISTS idx_scheduled_meetings_org_workspace ON public.scheduled_meetings(organization_id, workspace_id);
CREATE INDEX IF NOT EXISTS idx_meeting_participants_meeting_user ON public.meeting_participants(meeting_id, user_id);
CREATE INDEX IF NOT EXISTS idx_chat_meeting ON public.chat_messages(meeting_id, created_at);
CREATE INDEX IF NOT EXISTS idx_invites_meeting_email ON public.meeting_invites(meeting_id, email);

CREATE OR REPLACE FUNCTION public.is_org_member(p_user_id UUID, p_org_id UUID)
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
  );
$$;

CREATE OR REPLACE FUNCTION public.is_workspace_member(p_user_id UUID, p_workspace_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE
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

CREATE OR REPLACE FUNCTION public.ensure_user_profile_context(p_user_id UUID, p_email TEXT, p_full_name TEXT)
RETURNS TABLE (organization_id UUID, workspace_id UUID)
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email TEXT := COALESCE(p_email, '');
  v_full_name TEXT := COALESCE(p_full_name, 'User');
  v_org_id UUID;
  v_workspace_id UUID;
  v_slug TEXT;
BEGIN
  IF p_user_id IS NULL OR p_user_id <> auth.uid() THEN
    RAISE EXCEPTION 'Unauthorized user context update';
  END IF;

  INSERT INTO public.users (id, email, full_name, avatar_url, created_at)
  VALUES (p_user_id, v_email, v_full_name, NULL, NOW())
  ON CONFLICT (id) DO NOTHING;

  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = p_user_id
    AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;

  IF v_org_id IS NULL THEN
    v_slug := lower(regexp_replace(COALESCE(v_full_name, 'workspace'), '[^a-z0-9]+', '-', 'g'));
    v_slug := trim(both '-' from v_slug);
    IF v_slug = '' THEN
      v_slug := 'workspace';
    END IF;
    v_slug := v_slug || '-' || substr(md5(random()::text), 1, 6);

    INSERT INTO public.organizations (name, slug, created_by)
    VALUES (
      COALESCE(v_full_name, 'Workspace') || ' Workspace',
      v_slug,
      p_user_id
    )
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO v_org_id;

    IF v_org_id IS NULL THEN
      SELECT id INTO v_org_id
      FROM public.organizations
      WHERE created_by = p_user_id
      ORDER BY created_at DESC
      LIMIT 1;
    END IF;

    IF v_org_id IS NOT NULL THEN
      INSERT INTO public.organization_members (organization_id, user_id, role, status, invited_by)
      VALUES (v_org_id, p_user_id, 'owner', 'active', p_user_id)
      ON CONFLICT (organization_id, user_id) DO NOTHING;
    END IF;
  END IF;

  IF v_org_id IS NOT NULL THEN
    SELECT w.id INTO v_workspace_id
    FROM public.workspaces w
    WHERE w.organization_id = v_org_id
    ORDER BY w.created_at ASC
    LIMIT 1;

    IF v_workspace_id IS NULL THEN
      INSERT INTO public.workspaces (organization_id, name, slug, created_by)
      VALUES (
        v_org_id,
        'Default Workspace',
        'default-' || substr(md5(random()::text), 1, 6),
        p_user_id
      )
      ON CONFLICT (organization_id, slug) DO NOTHING
      RETURNING id INTO v_workspace_id;

      IF v_workspace_id IS NULL THEN
        SELECT id INTO v_workspace_id
        FROM public.workspaces
        WHERE organization_id = v_org_id
        ORDER BY created_at ASC
        LIMIT 1;
      END IF;
    END IF;
  END IF;

  RETURN QUERY SELECT v_org_id, v_workspace_id;
END;
$$;

CREATE OR REPLACE TRIGGER organizations_set_updated_at
BEFORE UPDATE ON public.organizations
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER organization_members_set_updated_at
BEFORE UPDATE ON public.organization_members
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER workspaces_set_updated_at
BEFORE UPDATE ON public.workspaces
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER subscriptions_set_updated_at
BEFORE UPDATE ON public.subscriptions
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER usage_daily_set_updated_at
BEFORE UPDATE ON public.usage_daily
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER meeting_participants_set_updated_at
BEFORE UPDATE ON public.meeting_participants
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER chat_messages_set_updated_at
BEFORE UPDATE ON public.chat_messages
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER meeting_invites_set_updated_at
BEFORE UPDATE ON public.meeting_invites
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER meetings_set_updated_at
BEFORE UPDATE ON public.meetings
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

CREATE OR REPLACE TRIGGER scheduled_meetings_set_updated_at
BEFORE UPDATE ON public.scheduled_meetings
FOR EACH ROW
EXECUTE FUNCTION public.set_updated_at();

ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organizations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.organization_members ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.subscriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.usage_daily ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Users can view all users" ON public.users;
DROP POLICY IF EXISTS "Users can update own profile" ON public.users;
DROP POLICY IF EXISTS "Users can insert own profile" ON public.users;
CREATE POLICY "Users can view own profile" ON public.users
  FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users can update own profile" ON public.users
  FOR UPDATE USING (auth.uid() = id) WITH CHECK (auth.uid() = id);
CREATE POLICY "Users can insert own profile" ON public.users
  FOR INSERT WITH CHECK (auth.uid() = id);

DROP POLICY IF EXISTS "Organizations are viewable to members" ON public.organizations;
DROP POLICY IF EXISTS "Organization members manage membership" ON public.organization_members;
DROP POLICY IF EXISTS "Workspaces are viewable by org members" ON public.workspaces;
DROP POLICY IF EXISTS "Subscriptions are scoped to org" ON public.subscriptions;
DROP POLICY IF EXISTS "Usage is scoped to org" ON public.usage_daily;

CREATE POLICY "Organizations are viewable to members" ON public.organizations
  FOR SELECT USING (
    public.is_org_member(auth.uid(), id)
  );
CREATE POLICY "Authenticated users can create organizations" ON public.organizations
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);
CREATE POLICY "Org owners and admins can update organizations" ON public.organizations
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.organizations.id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
        AND om.role IN ('owner', 'admin')
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.organizations.id
        AND om.user_id = auth.uid()
        AND om.status = 'active'
        AND om.role IN ('owner', 'admin')
    )
  );

CREATE POLICY "Organization members are viewable to org members" ON public.organization_members
  FOR SELECT USING (
    public.is_org_member(auth.uid(), organization_id)
  );
CREATE POLICY "Users can join their own org membership" ON public.organization_members
  FOR INSERT WITH CHECK (
    user_id = auth.uid() OR EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.organization_members.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  );
CREATE POLICY "Org owners and admins can update membership" ON public.organization_members
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.organization_members.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.organization_members.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  );

CREATE POLICY "Workspaces are viewable by org members" ON public.workspaces
  FOR SELECT USING (
    public.is_org_member(auth.uid(), organization_id)
  );
CREATE POLICY "Org members can create workspaces" ON public.workspaces
  FOR INSERT WITH CHECK (
    public.is_org_member(auth.uid(), organization_id)
  );
CREATE POLICY "Org owners and admins can update workspaces" ON public.workspaces
  FOR UPDATE USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.workspaces.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.workspaces.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  );

CREATE POLICY "Subscriptions are viewable to org members" ON public.subscriptions
  FOR SELECT USING (
    public.is_org_member(auth.uid(), organization_id)
  );
CREATE POLICY "Org owners and admins can manage subscriptions" ON public.subscriptions
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.subscriptions.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.subscriptions.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  );

CREATE POLICY "Usage data is viewable to org members" ON public.usage_daily
  FOR SELECT USING (
    public.is_org_member(auth.uid(), organization_id)
  );
CREATE POLICY "Org owners and admins can update usage data" ON public.usage_daily
  FOR ALL USING (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.usage_daily.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.organization_members om
      WHERE om.organization_id = public.usage_daily.organization_id
        AND om.user_id = auth.uid()
        AND om.role IN ('owner', 'admin')
        AND om.status = 'active'
    )
  );

DROP POLICY IF EXISTS "Anyone can view meetings" ON public.meetings;
DROP POLICY IF EXISTS "Authenticated users can create meetings" ON public.meetings;
DROP POLICY IF EXISTS "Host can update meetings" ON public.meetings;
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
  );
CREATE POLICY "Hosts can update meetings" ON public.meetings
  FOR UPDATE USING (
    auth.uid() = host_id
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.organization_id = public.meetings.organization_id
          AND om.user_id = auth.uid()
          AND om.role IN ('owner', 'admin')
          AND om.status = 'active'
      )
    )
  )
  WITH CHECK (
    auth.uid() = host_id
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.organization_id = public.meetings.organization_id
          AND om.user_id = auth.uid()
          AND om.role IN ('owner', 'admin')
          AND om.status = 'active'
      )
    )
  );

DROP POLICY IF EXISTS "Anyone can view scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Authenticated users can create scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Host can update scheduled meetings" ON public.scheduled_meetings;
DROP POLICY IF EXISTS "Host can delete scheduled meetings" ON public.scheduled_meetings;
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
  );
CREATE POLICY "Hosts can update scheduled meetings" ON public.scheduled_meetings
  FOR UPDATE USING (
    auth.uid() = host_id
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.organization_id = public.scheduled_meetings.organization_id
          AND om.user_id = auth.uid()
          AND om.role IN ('owner', 'admin')
          AND om.status = 'active'
      )
    )
  )
  WITH CHECK (
    auth.uid() = host_id
    OR (
      organization_id IS NOT NULL
      AND EXISTS (
        SELECT 1
        FROM public.organization_members om
        WHERE om.organization_id = public.scheduled_meetings.organization_id
          AND om.user_id = auth.uid()
          AND om.role IN ('owner', 'admin')
          AND om.status = 'active'
      )
    )
  );
CREATE POLICY "Hosts can delete scheduled meetings" ON public.scheduled_meetings
  FOR DELETE USING (auth.uid() = host_id);

DROP POLICY IF EXISTS "Anyone can view participants" ON public.meeting_participants;
DROP POLICY IF EXISTS "Authenticated users can join meetings" ON public.meeting_participants;
CREATE POLICY "Participants are viewable when meeting access exists" ON public.meeting_participants
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.meeting_participants.meeting_id
        AND m.organization_id IS NOT NULL
        AND public.is_org_member(auth.uid(), m.organization_id)
    )
    OR user_id = auth.uid()
  );
CREATE POLICY "Users can join a meeting in their org" ON public.meeting_participants
  FOR INSERT WITH CHECK (
    user_id = auth.uid()
    AND EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.meeting_participants.meeting_id
        AND m.organization_id IS NOT NULL
        AND public.is_org_member(auth.uid(), m.organization_id)
    )
  );

DROP POLICY IF EXISTS "Anyone can view chat messages" ON public.chat_messages;
DROP POLICY IF EXISTS "Authenticated users can send messages" ON public.chat_messages;
CREATE POLICY "Chat is readable to meeting members" ON public.chat_messages
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.chat_messages.meeting_id
        AND m.organization_id IS NOT NULL
        AND public.is_org_member(auth.uid(), m.organization_id)
    )
  );
CREATE POLICY "Meeting members can send chat messages" ON public.chat_messages
  FOR INSERT WITH CHECK (
    auth.uid() = user_id
    AND EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.chat_messages.meeting_id
        AND m.organization_id IS NOT NULL
        AND public.is_org_member(auth.uid(), m.organization_id)
    )
  );

DROP POLICY IF EXISTS "Anyone can view invites" ON public.meeting_invites;
DROP POLICY IF EXISTS "Authenticated users can create invites" ON public.meeting_invites;
CREATE POLICY "Invites are readable to org members" ON public.meeting_invites
  FOR SELECT USING (
    EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.meeting_invites.meeting_id
        AND m.organization_id IS NOT NULL
        AND public.is_org_member(auth.uid(), m.organization_id)
    )
  );
CREATE POLICY "Meeting hosts can create invites" ON public.meeting_invites
  FOR INSERT WITH CHECK (
    EXISTS (
      SELECT 1
      FROM public.meetings m
      WHERE m.id = public.meeting_invites.meeting_id
        AND m.organization_id IS NOT NULL
        AND m.host_id = auth.uid()
    )
  );
