-- Migration 026: System Administration Console Foundation (V1)
-- Additive and corrective.

-- 1. Platform Admins Table
CREATE TABLE IF NOT EXISTS public.platform_admins (
  user_id UUID PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  role TEXT NOT NULL CHECK (role IN ('system_admin', 'platform_operator', 'platform_support', 'auditor')) DEFAULT 'system_admin',
  granted_by UUID REFERENCES public.users(id),
  granted_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. System Admin Helper Function
CREATE OR REPLACE FUNCTION public.is_system_admin(p_user_id UUID DEFAULT auth.uid())
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

REVOKE ALL ON FUNCTION public.is_system_admin(UUID) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.is_system_admin(UUID) TO authenticated;

-- 3. Add Suspension Status columns to users and organizations if missing
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'users' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.users ADD COLUMN status TEXT CHECK (status IN ('active', 'suspended')) DEFAULT 'active';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'organizations' AND column_name = 'status'
  ) THEN
    ALTER TABLE public.organizations ADD COLUMN status TEXT CHECK (status IN ('active', 'suspended')) DEFAULT 'active';
  END IF;
END $$;

-- 4. Login Events Table
CREATE TABLE IF NOT EXISTS public.login_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES public.users(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (event_type IN ('login_success', 'login_failed', 'logout', 'session_created', 'session_revoked', 'account_suspended', 'account_reactivated')),
  ip_address TEXT,
  user_agent TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_login_events_user ON public.login_events(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_login_events_type ON public.login_events(event_type, created_at DESC);

-- 5. Platform Activity Events Table
CREATE TABLE IF NOT EXISTS public.platform_activity_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  actor_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  event_type TEXT NOT NULL,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  resource_type TEXT,
  resource_id TEXT,
  details JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_platform_activity_created ON public.platform_activity_events(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_platform_activity_org ON public.platform_activity_events(organization_id, created_at DESC);

-- 6. System Audit Logs Table
CREATE TABLE IF NOT EXISTS public.system_audit_logs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  admin_user_id UUID REFERENCES public.users(id) ON DELETE SET NULL,
  action TEXT NOT NULL,
  target_type TEXT NOT NULL,
  target_id TEXT,
  organization_id UUID REFERENCES public.organizations(id) ON DELETE SET NULL,
  reason TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  ip_address TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_system_audit_admin ON public.system_audit_logs(admin_user_id, created_at DESC);

-- 7. Billing Plans & Payments Tables
CREATE TABLE IF NOT EXISTS public.billing_plans (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  price_cents INT NOT NULL DEFAULT 0,
  currency TEXT NOT NULL DEFAULT 'USD',
  billing_interval TEXT NOT NULL CHECK (billing_interval IN ('monthly', 'yearly')) DEFAULT 'monthly',
  max_users INT NOT NULL DEFAULT 10,
  max_participants INT NOT NULL DEFAULT 50,
  max_duration_minutes INT NOT NULL DEFAULT 60,
  recording_enabled BOOLEAN NOT NULL DEFAULT true,
  transcription_enabled BOOLEAN NOT NULL DEFAULT false,
  ai_enabled BOOLEAN NOT NULL DEFAULT false,
  entitlements JSONB DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.billing_payments (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  organization_id UUID REFERENCES public.organizations(id) ON DELETE CASCADE,
  amount_cents INT NOT NULL,
  currency TEXT NOT NULL DEFAULT 'USD',
  status TEXT NOT NULL CHECK (status IN ('succeeded', 'failed', 'pending', 'refunded')) DEFAULT 'pending',
  provider TEXT NOT NULL DEFAULT 'manual',
  external_payment_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Default Plans if not present
INSERT INTO public.billing_plans (id, name, price_cents, billing_interval, max_users, max_participants, max_duration_minutes, recording_enabled, transcription_enabled, ai_enabled)
VALUES
  ('free', 'Free Starter', 0, 'monthly', 5, 25, 45, false, false, false),
  ('pro', 'Pro Team', 2900, 'monthly', 25, 100, 180, true, true, false),
  ('enterprise', 'Enterprise Unlimited', 9900, 'monthly', 500, 500, 1440, true, true, true)
ON CONFLICT (id) DO NOTHING;

-- 8. Feature Flags Table
CREATE TABLE IF NOT EXISTS public.feature_flags (
  key TEXT PRIMARY KEY,
  enabled BOOLEAN NOT NULL DEFAULT true,
  description TEXT,
  target_scope TEXT NOT NULL CHECK (target_scope IN ('global', 'plan', 'organization', 'user')) DEFAULT 'global',
  target_id TEXT,
  metadata JSONB DEFAULT '{}'::jsonb,
  updated_by UUID REFERENCES public.users(id) ON DELETE SET NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

-- Seed Default Feature Flags
INSERT INTO public.feature_flags (key, enabled, description, target_scope)
VALUES
  ('RECORDING', true, 'Enable live recording capability', 'global'),
  ('GUEST_JOIN', true, 'Enable unauthenticated guest shared-link join', 'global'),
  ('WHITEBOARD', true, 'Enable collaborative whiteboard', 'global'),
  ('POLLS', true, 'Enable in-meeting polls and Q&A', 'global'),
  ('TRANSCRIPTION', false, 'Enable AI transcript generation', 'global'),
  ('AI_ASSISTANT', false, 'Enable AI meeting summary and action items', 'global')
ON CONFLICT (key) DO NOTHING;

-- 9. System Admin Overview Metrics RPC
CREATE OR REPLACE FUNCTION public.get_system_overview_metrics(p_user_id UUID DEFAULT auth.uid())
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID := COALESCE(p_user_id, auth.uid());
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
  IF NOT public.is_system_admin(v_user_id) THEN
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

-- 10. Enable RLS on New Tables
ALTER TABLE public.platform_admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.login_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.platform_activity_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.system_audit_logs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feature_flags ENABLE ROW LEVEL SECURITY;

-- 11. RLS Policies
-- platform_admins
DROP POLICY IF EXISTS "Platform admins viewable by system admins" ON public.platform_admins;
CREATE POLICY "Platform admins viewable by system admins" ON public.platform_admins
  FOR SELECT USING (public.is_system_admin(auth.uid()));

-- login_events
DROP POLICY IF EXISTS "Users can view own login events or system admin" ON public.login_events;
CREATE POLICY "Users can view own login events or system admin" ON public.login_events
  FOR SELECT USING (user_id = auth.uid() OR public.is_system_admin(auth.uid()));

DROP POLICY IF EXISTS "System can insert login events" ON public.login_events;
CREATE POLICY "System can insert login events" ON public.login_events
  FOR INSERT WITH CHECK (auth.uid() IS NOT NULL);

-- platform_activity_events
DROP POLICY IF EXISTS "Activity viewable by system admin" ON public.platform_activity_events;
CREATE POLICY "Activity viewable by system admin" ON public.platform_activity_events
  FOR SELECT USING (public.is_system_admin(auth.uid()));

-- system_audit_logs
DROP POLICY IF EXISTS "System audit logs viewable strictly by system admins" ON public.system_audit_logs;
CREATE POLICY "System audit logs viewable strictly by system admins" ON public.system_audit_logs
  FOR SELECT USING (public.is_system_admin(auth.uid()));

-- billing_plans
DROP POLICY IF EXISTS "Billing plans viewable by authenticated users" ON public.billing_plans;
CREATE POLICY "Billing plans viewable by authenticated users" ON public.billing_plans
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Billing plans managed by system admins" ON public.billing_plans;
CREATE POLICY "Billing plans managed by system admins" ON public.billing_plans
  FOR ALL USING (public.is_system_admin(auth.uid()));

-- billing_payments
DROP POLICY IF EXISTS "Billing payments viewable by org members or system admins" ON public.billing_payments;
CREATE POLICY "Billing payments viewable by org members or system admins" ON public.billing_payments
  FOR SELECT USING (
    public.is_system_admin(auth.uid()) OR EXISTS (
      SELECT 1 FROM public.organization_members om
      WHERE om.organization_id = public.billing_payments.organization_id AND om.user_id = auth.uid()
    )
  );

-- feature_flags
DROP POLICY IF EXISTS "Feature flags viewable by authenticated users" ON public.feature_flags;
CREATE POLICY "Feature flags viewable by authenticated users" ON public.feature_flags
  FOR SELECT USING (auth.uid() IS NOT NULL);

DROP POLICY IF EXISTS "Feature flags managed by system admins" ON public.feature_flags;
CREATE POLICY "Feature flags managed by system admins" ON public.feature_flags
  FOR ALL USING (public.is_system_admin(auth.uid()));
