-- Migration 028: System Admin Final Security Hardening & Information Disclosure Remediation
-- Additive and corrective.

-- 1. Fix platform_admins Information Disclosure (Block SELECT for non-system-admins)
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins viewable by authenticated users" ON public.platform_admins;
DROP POLICY IF EXISTS "Platform admins viewable by system admins" ON public.platform_admins;
DROP POLICY IF EXISTS "Platform admins readable strictly by system admins" ON public.platform_admins;
DROP POLICY IF EXISTS "Platform admins managed strictly by system admins" ON public.platform_admins;

CREATE POLICY "Platform admins readable strictly by system admins" ON public.platform_admins
  FOR SELECT USING (public.is_system_admin());

CREATE POLICY "Platform admins managed strictly by system admins" ON public.platform_admins
  FOR ALL USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());

-- 2. Client-Facing can_manage_recordings RPC (Parameterless user_id — derives auth.uid() internally)
DROP FUNCTION IF EXISTS public.can_manage_recordings(UUID, UUID);
DROP FUNCTION IF EXISTS public.can_manage_recordings(UUID);

CREATE OR REPLACE FUNCTION public.can_manage_recordings(p_meeting_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := auth.uid();
  v_meeting public.meetings;
BEGIN
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  RETURN v_meeting.host_id = v_user_id OR public.is_org_owner_or_admin(v_user_id, v_meeting.organization_id);
END;
$$;

REVOKE ALL ON FUNCTION public.can_manage_recordings(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.can_manage_recordings(UUID) TO authenticated;

-- Internal helper function requiring explicit user_id (for server-side service-role calls)
CREATE OR REPLACE FUNCTION public.can_manage_recordings_for_user(p_meeting_id UUID, p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_meeting public.meetings;
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  SELECT * INTO v_meeting FROM public.meetings WHERE id = p_meeting_id;
  IF NOT FOUND THEN
    RETURN FALSE;
  END IF;

  RETURN v_meeting.host_id = p_user_id OR public.is_org_owner_or_admin(p_user_id, v_meeting.organization_id);
END;
$$;

-- REVOKE client execution on internal helper to prevent PostgREST parameter substitution attacks
REVOKE ALL ON FUNCTION public.can_manage_recordings_for_user(UUID, UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.can_manage_recordings_for_user(UUID, UUID) TO service_role;

-- 3. Restrict system_audit_logs INSERT permissions (Direct INSERT by ordinary users denied)
ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "System audit logs insertable by system admins or SECURITY DEFINER" ON public.system_audit_logs;
DROP POLICY IF EXISTS "System audit logs insertable strictly by system admins" ON public.system_audit_logs;

CREATE POLICY "System audit logs insertable strictly by system admins" ON public.system_audit_logs
  FOR INSERT WITH CHECK (public.is_system_admin());

-- 4. Set search_path = public on legacy rls_auto_enable function
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM pg_proc p JOIN pg_namespace n ON p.pronamespace = n.oid
    WHERE n.nspname = 'public' AND p.proname = 'rls_auto_enable'
  ) THEN
    ALTER FUNCTION public.rls_auto_enable() SET search_path = public;
  END IF;
END $$;
