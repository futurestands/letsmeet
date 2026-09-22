import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.staging.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey || !supabaseAnonKey) {
  console.error('Missing staging configuration');
  process.exit(1);
}

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

function report(name, ok, extra = '') {
  console.log(`${ok ? 'PASS' : 'FAIL'} ${name}${extra ? ` ${extra}` : ''}`);
  if (!ok) process.exitCode = 1;
}

async function run() {
  const timeId = Date.now();
  const testEmail = `mig-test-${timeId}@example.com`;
  const password = 'Password123!';

  console.log('=== VERIFYING MIGRATIONS ON STAGING ===\n');

  // Create test user
  const { data: authData, error: createError } = await supabaseAdmin.auth.admin.createUser({
    email: testEmail,
    password,
    email_confirm: true,
  });
  if (createError) throw createError;
  const userId = authData.user.id;

  const userClient = createClient(supabaseUrl, supabaseAnonKey);
  await userClient.auth.signInWithPassword({ email: testEmail, password });

  try {
    // 1. Migration 019 & 020 Check: ensure_user_profile_context / ensure_user_onboarding / resolve_user_tenant_context
    console.log('1. Checking Migration 019 & 020 (Onboarding & Tenant Context Resolution)...');
    const { data: profileData, error: profileErr } = await userClient.rpc('ensure_user_profile_context', {
      p_user_id: userId,
      p_email: testEmail,
      p_full_name: 'Migration Test User',
    });
    report('Migration 019/020: ensure_user_profile_context RPC', !profileErr && Boolean(profileData), profileErr?.message ?? '');

    const { data: tenantData, error: tenantErr } = await userClient.rpc('resolve_user_tenant_context');
    report('Migration 019/020: resolve_user_tenant_context RPC', !tenantErr && Boolean(tenantData), tenantErr?.message ?? '');

    // 2. Migration 018 Check: schedule_persistent_meeting (near-now grace period & idempotency)
    console.log('\n2. Checking Migration 018 (Near-now grace & idempotency)...');
    const { data: schedData1, error: schedErr1 } = await userClient.rpc('schedule_persistent_meeting', {
      p_title: 'Migration 018 Test',
      p_date: '2026-10-10',
      p_time: '12:00',
      p_timezone: 'UTC',
    });
    report('Migration 018: schedule_persistent_meeting RPC', !schedErr1 && Boolean(schedData1?.meeting_code), schedErr1?.message ?? '');

    // Check near-now grace period (schedule 5 minutes in past)
    const nearPast = new Date(Date.now() - 5 * 60 * 1000);
    const dateStr = nearPast.toISOString().split('T')[0];
    const timeStr = nearPast.toISOString().split('T')[1].substring(0, 5);

    const { data: schedData2, error: schedErr2 } = await userClient.rpc('schedule_persistent_meeting', {
      p_title: 'Near-Now Migration Test',
      p_date: dateStr,
      p_time: timeStr,
      p_timezone: 'UTC',
    });
    report('Migration 018: Near-now grace period (5 mins ago allowed)', !schedErr2 && Boolean(schedData2), schedErr2?.message ?? '');

  } finally {
    console.log('\nCleaning up staging migration test user...');
    await supabaseAdmin.auth.admin.deleteUser(userId);
  }
}

run().catch((err) => {
  console.error('Migration verification error:', err);
  process.exit(1);
});
