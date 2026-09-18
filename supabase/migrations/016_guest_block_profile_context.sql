-- Guests must never provision organization/workspace via ensure_user_profile_context.
-- Additive only. Migrations 001-015 remain immutable.

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

  IF public.is_guest_user(p_user_id) THEN
    RAISE EXCEPTION 'Guest sessions cannot create an organization';
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
