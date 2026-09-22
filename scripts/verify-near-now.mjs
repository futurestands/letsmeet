import { createClient } from '@supabase/supabase-js';
import dotenv from 'dotenv';

dotenv.config({ path: '.env.staging.local' });

const supabaseUrl = process.env.VITE_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supabaseAnonKey = process.env.VITE_SUPABASE_ANON_KEY;

const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

async function run() {
  const testEmail = `test-near-now-${Date.now()}@example.com`;
  const userId = (await supabaseAdmin.auth.admin.createUser({ email: testEmail, password: 'password123', email_confirm: true })).data.user.id;

  const userClient = createClient(supabaseUrl, supabaseAnonKey);
  await userClient.auth.signInWithPassword({ email: testEmail, password: 'password123' });
  await userClient.rpc('ensure_user_profile_context', { p_user_id: userId, p_email: testEmail, p_full_name: 'Near Now User' });

  try {
    const now = new Date();
    // Schedule 5 minutes in the past
    const nearPast = new Date(now.getTime() - 5 * 60 * 1000);
    const dateStr = nearPast.toISOString().split('T')[0];
    const timeStr = nearPast.toISOString().split('T')[1].substring(0, 5);

    console.log(`Attempting to schedule meeting at ${dateStr} ${timeStr} UTC (approx 5 mins ago)...`);
    const { data: meeting, error } = await userClient.rpc('schedule_persistent_meeting', {
      p_title: 'Near Now Test',
      p_date: dateStr,
      p_time: timeStr,
      p_timezone: 'UTC'
    });

    if (error) {
      console.log('SCHEDULE FAILED (UNEXPECTED if within grace):', error.message);
    } else {
      console.log('SCHEDULE SUCCEEDED (GRACE PERIOD WORKING):', meeting.id || meeting.meeting_code);
    }

    // Schedule 15 minutes in the past
    const farPast = new Date(now.getTime() - 15 * 60 * 1000);
    const dateStr2 = farPast.toISOString().split('T')[0];
    const timeStr2 = farPast.toISOString().split('T')[1].substring(0, 5);

    console.log(`Attempting to schedule meeting at ${dateStr2} ${timeStr2} UTC (approx 15 mins ago)...`);
    const { error: error2 } = await userClient.rpc('schedule_persistent_meeting', {
      p_title: 'Far Past Test',
      p_date: dateStr2,
      p_time: timeStr2,
      p_timezone: 'UTC'
    });

    if (error2) {
      console.log('SCHEDULE FAILED (EXPECTED):', error2.message);
    } else {
      console.log('SCHEDULE SUCCEEDED (UNEXPECTED, grace period too long?):');
    }

  } finally {
    await supabaseAdmin.auth.admin.deleteUser(userId);
  }
}

run().catch(console.error);
