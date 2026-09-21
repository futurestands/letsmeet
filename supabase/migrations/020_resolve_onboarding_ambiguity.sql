-- Final resolution for "organization_id is ambiguous" and self-healing onboarding.
-- This migration redefines the core context functions with explicit naming to prevent PL/pgSQL collisions.

-- 1. Redefine onboarding with very distinct return names
-- Drop first because return type names are changing
DROP FUNCTION IF EXISTS public.ensure_user_onboarding(UUID, TEXT, TEXT);

CREATE OR REPLACE FUNCTION public.ensure_user_onboarding(
  p_user_id UUID DEFAULT auth.uid(),
  p_email TEXT DEFAULT NULL,
  p_full_name TEXT DEFAULT NULL
)
RETURNS TABLE (out_org_id UUID, out_workspace_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := COALESCE(p_user_id, auth.uid());
  v_email TEXT;
  v_full_name TEXT;
  v_org_id UUID;
  v_workspace_id UUID;
  v_slug TEXT;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required for onboarding';
  END IF;

  -- Ensure user row exists
  IF p_email IS NOT NULL AND p_full_name IS NOT NULL THEN
    INSERT INTO public.users (id, email, full_name)
    VALUES (v_user_id, lower(p_email), p_full_name)
    ON CONFLICT (id) DO NOTHING;
  END IF;

  -- Check for existing active membership
  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_user_id AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;

  -- Provision personal organization if missing
  IF v_org_id IS NULL THEN
    IF public.is_guest_user(v_user_id) THEN
       RAISE EXCEPTION 'Guest sessions cannot be auto-onboarded to an organization';
    END IF;

    SELECT u.email, u.full_name INTO v_email, v_full_name FROM public.users u WHERE u.id = v_user_id;
    v_full_name := COALESCE(v_full_name, p_full_name, 'My');
    v_slug := lower(regexp_replace(v_full_name, '[^a-z0-9]+', '-', 'g')) || '-' || substr(md5(random()::text), 1, 6);

    INSERT INTO public.organizations (name, slug, created_by)
    VALUES (v_full_name || ' Workspace', v_slug, v_user_id)
    ON CONFLICT (slug) DO NOTHING
    RETURNING id INTO v_org_id;

    IF v_org_id IS NULL THEN
      SELECT o.id INTO v_org_id FROM public.organizations o WHERE o.created_by = v_user_id ORDER BY o.created_at DESC LIMIT 1;
    END IF;

    IF v_org_id IS NOT NULL THEN
      INSERT INTO public.organization_members (organization_id, user_id, role, status, invited_by)
      VALUES (v_org_id, v_user_id, 'owner', 'active', v_user_id)
      ON CONFLICT (organization_id, user_id) DO NOTHING;
    END IF;
  END IF;

  -- Ensure at least one workspace exists
  IF v_org_id IS NOT NULL THEN
    SELECT w.id INTO v_workspace_id
    FROM public.workspaces w
    WHERE w.organization_id = v_org_id
    ORDER BY w.created_at ASC
    LIMIT 1;

    IF v_workspace_id IS NULL THEN
      INSERT INTO public.workspaces (organization_id, name, slug, created_by)
      VALUES (v_org_id, 'General', 'general-' || substr(md5(random()::text), 1, 6), v_user_id)
      ON CONFLICT (organization_id, slug) DO NOTHING
      RETURNING id INTO v_workspace_id;

      IF v_workspace_id IS NULL THEN
        SELECT w.id INTO v_workspace_id FROM public.workspaces w WHERE w.organization_id = v_org_id ORDER BY w.created_at ASC LIMIT 1;
      END IF;
    END IF;
  END IF;

  IF v_org_id IS NULL OR v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'User onboarding failed: could not establish organization context';
  END IF;

  out_org_id := v_org_id;
  out_workspace_id := v_workspace_id;
  RETURN NEXT;
END;
$$;

-- 2. Redefine profile context to map names explicitly
CREATE OR REPLACE FUNCTION public.ensure_user_profile_context(p_user_id UUID, p_email TEXT, p_full_name TEXT)
RETURNS TABLE (organization_id UUID, workspace_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN QUERY
    SELECT t.out_org_id, t.out_workspace_id
    FROM public.ensure_user_onboarding(p_user_id, p_email, p_full_name) t;
END;
$$;

-- 3. Redefine tenant context resolution to be ambiguity-safe
DROP FUNCTION IF EXISTS public.resolve_user_tenant_context(UUID);

CREATE OR REPLACE FUNCTION public.resolve_user_tenant_context(p_workspace_id UUID DEFAULT NULL)
RETURNS TABLE (organization_id UUID, workspace_id UUID)
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_org_id UUID;
  v_workspace_id UUID;
BEGIN
  IF v_user_id IS NULL THEN
    RAISE EXCEPTION 'Authentication is required';
  END IF;

  -- Try existing membership
  SELECT om.organization_id INTO v_org_id
  FROM public.organization_members om
  WHERE om.user_id = v_user_id AND om.status = 'active'
  ORDER BY om.created_at ASC
  LIMIT 1;

  -- Auto-onboard if missing
  IF v_org_id IS NULL AND NOT public.is_guest_user(v_user_id) THEN
    SELECT t.out_org_id, t.out_workspace_id INTO v_org_id, v_workspace_id
    FROM public.ensure_user_onboarding(v_user_id) t;
  END IF;

  IF v_org_id IS NULL THEN
    RAISE EXCEPTION 'An active organization membership is required';
  END IF;

  -- Resolve workspace
  IF p_workspace_id IS NULL THEN
    IF v_workspace_id IS NULL THEN
      SELECT w.id INTO v_workspace_id
      FROM public.workspaces w
      WHERE w.organization_id = v_org_id
      ORDER BY w.created_at ASC
      LIMIT 1;
    END IF;
  ELSE
    SELECT w.id INTO v_workspace_id
    FROM public.workspaces w
    WHERE w.id = p_workspace_id
      AND w.organization_id = v_org_id
      AND (
        w.created_by = v_user_id
        OR EXISTS (SELECT 1 FROM public.organization_members om2 WHERE om2.organization_id = v_org_id AND om2.user_id = v_user_id AND om2.status = 'active')
      );
  END IF;

  IF v_workspace_id IS NULL THEN
    RAISE EXCEPTION 'A workspace in the active organization is required';
  END IF;

  -- Use explicit assignments to return columns
  organization_id := v_org_id;
  workspace_id := v_workspace_id;
  RETURN NEXT;
END;
$$;

REVOKE ALL ON FUNCTION public.ensure_user_onboarding(UUID, TEXT, TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.resolve_user_tenant_context(UUID) FROM PUBLIC;

GRANT EXECUTE ON FUNCTION public.ensure_user_onboarding(UUID, TEXT, TEXT) TO authenticated;
GRANT EXECUTE ON FUNCTION public.resolve_user_tenant_context(UUID) TO authenticated;
