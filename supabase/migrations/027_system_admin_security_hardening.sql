-- Migration 027: System Admin Security Hardening & Direct RPC Privilege Escalation Prevention
-- Additive and corrective.

-- 1. Parameterless is_system_admin RPC (Always derives auth.uid() internally to prevent parameter substitution attacks)
CREATE OR REPLACE FUNCTION public.is_system_admin(p_user_id UUID DEFAULT NULL)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  -- SECURITY INVARIANT: Derive identity strictly from auth.uid().
  -- Ignore caller-supplied p_user_id parameter to prevent direct PostgREST RPC parameter substitution attacks.
  v_user_id UUID := auth.uid();
BEGIN
  IF v_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = v_user_id
  );
END;
$$;

REVOKE ALL ON FUNCTION public.is_system_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_admin(UUID) TO authenticated;

-- Internal helper function requiring explicit user_id (for server-side service-role calls only)
CREATE OR REPLACE FUNCTION public.is_system_admin_for_user(p_user_id UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF p_user_id IS NULL THEN
    RETURN FALSE;
  END IF;

  RETURN EXISTS (
    SELECT 1 FROM public.platform_admins WHERE user_id = p_user_id
  );
END;
$$;

-- REVOKE client execution on internal helper to prevent PostgREST parameter substitution attacks
REVOKE ALL ON FUNCTION public.is_system_admin_for_user(UUID) FROM PUBLIC, authenticated, anon;
GRANT EXECUTE ON FUNCTION public.is_system_admin_for_user(UUID) TO service_role;

-- 2. Client-Facing parameterless get_system_overview_metrics RPC
CREATE OR REPLACE FUNCTION public.get_system_overview_metrics(p_user_id UUID DEFAULT NULL)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := COALESCE(auth.uid(), p_user_id);
  v_total_users INT;
  v_active_users INT;
  v_suspended_users INT;
  v_total_orgs INT;
  v_active_orgs INT;
  v_suspended_orgs INT;
  v_live_meetings INT;
  v_scheduled_meetings INT;
  v_completed_meetings INT;
  v_total_recordings INT;
  v_completed_recordings INT;
  v_failed_recordings INT;
BEGIN
  IF NOT public.is_system_admin_for_user(v_user_id) THEN
    RAISE EXCEPTION 'Unauthorized: System admin privileges required';
  END IF;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'active'), COUNT(*) FILTER (WHERE status = 'suspended')
    INTO v_total_users, v_active_users, v_suspended_users FROM public.users;

  SELECT COUNT(*), COUNT(*) FILTER (WHERE COALESCE(status, 'active') = 'active'), COUNT(*) FILTER (WHERE status = 'suspended')
    INTO v_total_orgs, v_active_orgs, v_suspended_orgs FROM public.organizations;

  SELECT
    COUNT(*) FILTER (WHERE status = 'live'),
    COUNT(*) FILTER (WHERE status IN ('waiting', 'scheduled')),
    COUNT(*) FILTER (WHERE status = 'ended')
    INTO v_live_meetings, v_scheduled_meetings, v_completed_meetings FROM public.meetings;

  SELECT
    COUNT(*),
    COUNT(*) FILTER (WHERE status = 'completed'),
    COUNT(*) FILTER (WHERE status = 'failed')
    INTO v_total_recordings, v_completed_recordings, v_failed_recordings FROM public.meeting_recordings;

  RETURN jsonb_build_object(
    'users', jsonb_build_object(
      'total', v_total_users,
      'active', v_active_users,
      'suspended', v_suspended_users
    ),
    'organizations', jsonb_build_object(
      'total', v_total_orgs,
      'active', v_active_orgs,
      'suspended', v_suspended_orgs
    ),
    'meetings', jsonb_build_object(
      'live', v_live_meetings,
      'scheduled', v_scheduled_meetings,
      'completed', v_completed_meetings
    ),
    'recordings', jsonb_build_object(
      'total', v_total_recordings,
      'completed', v_completed_recordings,
      'failed', v_failed_recordings
    )
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_system_overview_metrics(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.get_system_overview_metrics(UUID) TO authenticated;

-- 3. Audit Log Immutability Trigger (Prevents UPDATE or DELETE on system_audit_logs)
CREATE OR REPLACE FUNCTION public.prevent_system_audit_log_modification()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RAISE EXCEPTION 'System audit logs are immutable and cannot be modified or deleted';
END;
$$;

DROP TRIGGER IF EXISTS trg_prevent_system_audit_log_modification ON public.system_audit_logs;
CREATE TRIGGER trg_prevent_system_audit_log_modification
BEFORE UPDATE OR DELETE ON public.system_audit_logs
FOR EACH ROW
EXECUTE FUNCTION public.prevent_system_audit_log_modification();

-- 4. Atomic Admin Action RPCs (Mutation + Audit in Single Transaction)
CREATE OR REPLACE FUNCTION public.admin_suspend_user(
  p_target_user_id UUID,
  p_suspend BOOLEAN,
  p_reason TEXT DEFAULT 'System Admin administrative action'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_new_status TEXT;
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Unauthorized: System admin privileges required';
  END IF;

  IF p_target_user_id = v_admin_id THEN
    RAISE EXCEPTION 'System administrators cannot suspend their own account';
  END IF;

  v_new_status := CASE WHEN p_suspend THEN 'suspended' ELSE 'active' END;

  UPDATE public.users
  SET status = v_new_status,
      updated_at = NOW()
  WHERE id = p_target_user_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target user not found';
  END IF;

  -- Atomic Audit Logging inside same transaction
  INSERT INTO public.system_audit_logs (
    admin_user_id,
    action,
    target_type,
    target_id,
    reason,
    created_at
  ) VALUES (
    v_admin_id,
    CASE WHEN p_suspend THEN 'ADMIN_SUSPENDED_USER' ELSE 'ADMIN_REACTIVATED_USER' END,
    'user',
    p_target_user_id::TEXT,
    p_reason,
    NOW()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'targetUserId', p_target_user_id,
    'status', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suspend_user(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_suspend_user(UUID, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_suspend_organization(
  p_target_org_id UUID,
  p_suspend BOOLEAN,
  p_reason TEXT DEFAULT 'System Admin administrative action'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_new_status TEXT;
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Unauthorized: System admin privileges required';
  END IF;

  v_new_status := CASE WHEN p_suspend THEN 'suspended' ELSE 'active' END;

  UPDATE public.organizations
  SET status = v_new_status,
      updated_at = NOW()
  WHERE id = p_target_org_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Target organization not found';
  END IF;

  -- Atomic Audit Logging inside same transaction
  INSERT INTO public.system_audit_logs (
    admin_user_id,
    action,
    target_type,
    target_id,
    organization_id,
    reason,
    created_at
  ) VALUES (
    v_admin_id,
    CASE WHEN p_suspend THEN 'ADMIN_SUSPENDED_ORGANIZATION' ELSE 'ADMIN_REACTIVATED_ORGANIZATION' END,
    'organization',
    p_target_org_id::TEXT,
    p_target_org_id,
    p_reason,
    NOW()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'targetOrgId', p_target_org_id,
    'status', v_new_status
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_suspend_organization(UUID, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_suspend_organization(UUID, BOOLEAN, TEXT) TO authenticated;

CREATE OR REPLACE FUNCTION public.admin_set_feature_flag(
  p_key TEXT,
  p_enabled BOOLEAN,
  p_reason TEXT DEFAULT 'Feature flag updated by System Admin'
)
RETURNS JSONB
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_admin_id UUID := auth.uid();
  v_key TEXT := UPPER(TRIM(p_key));
BEGIN
  IF NOT public.is_system_admin() THEN
    RAISE EXCEPTION 'Unauthorized: System admin privileges required';
  END IF;

  UPDATE public.feature_flags
  SET enabled = p_enabled,
      updated_by = v_admin_id,
      updated_at = NOW()
  WHERE key = v_key;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Feature flag key not found';
  END IF;

  -- Atomic Audit Logging
  INSERT INTO public.system_audit_logs (
    admin_user_id,
    action,
    target_type,
    target_id,
    reason,
    metadata,
    created_at
  ) VALUES (
    v_admin_id,
    'ADMIN_CHANGED_FEATURE_FLAG',
    'feature_flag',
    v_key,
    p_reason,
    jsonb_build_object('enabled', p_enabled),
    NOW()
  );

  RETURN jsonb_build_object(
    'ok', true,
    'key', v_key,
    'enabled', p_enabled
  );
END;
$$;

REVOKE ALL ON FUNCTION public.admin_set_feature_flag(TEXT, BOOLEAN, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.admin_set_feature_flag(TEXT, BOOLEAN, TEXT) TO authenticated;

-- 5. Harden platform_admins RLS (Non-recursive check)
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "Platform admins viewable by system admins" ON public.platform_admins;
DROP POLICY IF EXISTS "Platform admins viewable by authenticated users" ON public.platform_admins;
CREATE POLICY "Platform admins viewable by authenticated users" ON public.platform_admins
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Platform admins managed strictly by system admins" ON public.platform_admins;
CREATE POLICY "Platform admins managed strictly by system admins" ON public.platform_admins
  FOR ALL USING (public.is_system_admin())
  WITH CHECK (public.is_system_admin());
