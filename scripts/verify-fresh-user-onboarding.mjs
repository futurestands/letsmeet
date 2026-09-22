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

async function run() {
  const testEmail = `fresh-test-${Date.now()}@example.com`;
  const testPassword = 'password123';
  const testName = 'Fresh Test User';

  console.log(`Creating fresh test user: ${testEmail}`);
  const { data: authData, error: authError } = await supabaseAdmin.auth.admin.createUser({
    email: testEmail,
    password: testPassword,
    email_confirm: true
  });

  if (authError) {
    console.error('Failed to create auth user:', authError);
    process.exit(1);
  }

  const userId = authData.user.id;
  console.log(`User ID: ${userId}`);

  const userClient = createClient(supabaseUrl, supabaseAnonKey);
  const { error: signInError } = await userClient.auth.signInWithPassword({
    email: testEmail,
    password: testPassword
  });

  if (signInError) {
    console.error('Failed to sign in:', signInError);
    await supabaseAdmin.auth.admin.deleteUser(userId);
    process.exit(1);
  }

  console.log('Signed in as fresh user.');

  try {
    // 1. Trigger Onboarding
    console.log('Calling ensure_user_profile_context (Onboarding)...');
    const { data: contextArray, error: contextError } = await userClient.rpc('ensure_user_profile_context', {
      p_user_id: userId,
      p_email: testEmail,
      p_full_name: testName
    });

    if (contextError) {
      console.error('RPC ensure_user_profile_context FAILED:', contextError);
      throw contextError;
    }
    const context = Array.isArray(contextArray) ? contextArray[0] : contextArray;
    console.log('PROFILE/CONTEXT PROVISIONED:', context);

    // 2. Verify Database Rows
    const { data: profile } = await supabaseAdmin.from('users').select('*').eq('id', userId).single();
    console.log('PROFILE CHECK:', profile ? 'PASS' : 'FAIL');

    const { data: membership } = await supabaseAdmin.from('organization_members').select('*').eq('user_id', userId).single();
    console.log('MEMBERSHIP CHECK:', membership ? 'PASS' : 'FAIL');

    if (membership) {
        const { data: org } = await supabaseAdmin.from('organizations').select('*').eq('id', membership.organization_id).single();
        console.log('ORGANIZATION CHECK:', org ? 'PASS' : 'FAIL');

        const { data: workspace } = await supabaseAdmin.from('workspaces').select('*').eq('organization_id', membership.organization_id).single();
        console.log('WORKSPACE CHECK:', workspace ? 'PASS' : 'FAIL');
    }

    // 3. Resolve Tenant Context
    console.log('Calling resolve_user_tenant_context...');
    const { data: tenantArray, error: tenantError } = await userClient.rpc('resolve_user_tenant_context');
    if (tenantError) {
        console.error('RPC resolve_user_tenant_context FAILED:', tenantError);
        throw tenantError;
    }
    const tenantContext = Array.isArray(tenantArray) ? tenantArray[0] : tenantArray;
    console.log('TENANT CONTEXT RESOLVED:', tenantContext);

    // 4. Schedule Meeting
    console.log('Calling schedule_persistent_meeting...');
    const { data: meeting, error: scheduleError } = await userClient.rpc('schedule_persistent_meeting', {
      p_title: 'Verification Meeting',
      p_date: '2026-10-01',
      p_time: '14:00',
      p_timezone: 'Africa/Nairobi'
    });

    if (scheduleError) {
      console.error('SCHEDULE FAILED:', scheduleError);
      throw scheduleError;
    }

    // schedule_persistent_meeting returns scheduled_meetings row, which has meeting_code
    // We need to find the ID of the row in the meetings table.
    const mCode = meeting.meeting_code;
    console.log('MEETING SCHEDULED SUCCESS (CODE):', mCode);

    // 5. Verify Persistence via ADMIN
    const { data: adminMeetingRow } = await supabaseAdmin.from('meetings').select('*').eq('code', mCode).maybeSingle();
    console.log('MEETING EXISTS (ADMIN CHECK):', adminMeetingRow ? 'PASS' : 'FAIL');

    // 6. Verify Persistence via USER (RLS)
    const { data: meetingRow } = await userClient.from('meetings').select('*').eq('code', mCode).maybeSingle();
    console.log('MEETING VISIBLE TO USER (RLS CHECK):', meetingRow ? 'PASS' : 'FAIL');

    if (meetingRow) {
        console.log('MEETING SCHEDULED_FOR (UTC):', meetingRow.scheduled_for);
    } else if (adminMeetingRow) {
        console.log('MEETING IS HIDDEN BY RLS. Check organization_id and membership.');
        console.log('Meeting Org ID:', adminMeetingRow.organization_id);
        const { data: userMember } = await supabaseAdmin.from('organization_members').select('*').eq('user_id', userId).eq('organization_id', adminMeetingRow.organization_id).maybeSingle();
        console.log('User membership in that Org:', userMember ? 'EXISTS' : 'MISSING');
        if (userMember) {
            console.log('Membership status:', userMember.status);
        }
    }

  } catch (err) {
    console.error('FULL FLOW TEST FAILED:', err.message);
  } finally {
    console.log('Cleaning up...');
    await supabaseAdmin.auth.admin.deleteUser(userId);
  }
}

run().catch(console.error);
