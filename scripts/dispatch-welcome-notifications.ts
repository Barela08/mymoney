import { query } from '../server/db';
import { sendWelcomeEmail } from '../server/email';

async function main() {
  console.log('================================================================');
  console.log('MY MONEY MANAGER — DISPATCH WELCOME NOTIFICATIONS TO REAL USERS');
  console.log('================================================================\n');

  // 1. IN-APP BROADCAST WELCOME NOTIFICATION
  console.log('--- 1. Creating In-App Welcome Announcement ---');

  // Deactivate old test notifications
  await query(`
    UPDATE public.notifications 
    SET is_active = false 
    WHERE title LIKE '%Test%' OR title LIKE '%E2E%'
  `);
  console.log('✓ Cleaned up old test notifications');

  // Insert official high-quality Welcome Announcement
  const notifTitle = '🎉 Welcome to My Money Manager! 💚';
  const notifMessage =
    'Welcome aboard! Personal finance, simplified. Track your daily expenses, manage Udhar khata, calculate split bills & investments, and build smarter financial habits — all in one place. Proudly crafted for you by HackifyPro.';

  const insertNotifRes = await query(`
    INSERT INTO public.notifications (
      title, message, type, target_user_id, is_active, created_at
    ) VALUES (
      $1, $2, 'announcement', 'all', true, NOW()
    ) RETURNING id, title, type, target_user_id, is_active, created_at
  `, [notifTitle, notifMessage]);

  console.log('✅ In-App Welcome Notification Created:');
  console.log('   ID:', insertNotifRes.rows[0].id);
  console.log('   Title:', insertNotifRes.rows[0].title);
  console.log('   Target:', insertNotifRes.rows[0].target_user_id);
  console.log('   Active:', insertNotifRes.rows[0].is_active);

  // 2. IDENTIFY ALL REAL USERS
  console.log('\n--- 2. Identifying Real Registered Users ---');

  // Query auth.users and app_users, excluding internal test domains
  const usersRes = await query(`
    SELECT DISTINCT ON (LOWER(TRIM(u.email)))
      u.id,
      LOWER(TRIM(u.email)) as email,
      COALESCE(
        NULLIF(TRIM(au.full_name), ''),
        NULLIF(TRIM(u.raw_user_meta_data->>'full_name'), ''),
        SPLIT_PART(u.email, '@', 1)
      ) as full_name,
      u.created_at
    FROM auth.users u
    LEFT JOIN public.app_users au ON au.id = u.id
    WHERE u.email NOT LIKE '%@mymoney-test.com'
      AND u.email NOT LIKE '%@mymoney.com'
      AND u.email NOT LIKE '%test%'
    ORDER BY LOWER(TRIM(u.email)), u.created_at ASC
  `);

  const realUsers = usersRes.rows;
  console.log(`Found ${realUsers.length} real registered user(s):`);
  realUsers.forEach((user: any, idx: number) => {
    console.log(`  ${idx + 1}. ${user.full_name} <${user.email}> (ID: ${user.id})`);
  });

  if (realUsers.length === 0) {
    console.log('No real users found to dispatch emails to.');
    process.exit(0);
  }

  // 3. SEND WELCOME EMAILS
  console.log('\n--- 3. Sending Personalized Welcome Emails via Verified SMTP ---');

  const results: any[] = [];

  for (const user of realUsers) {
    console.log(`\nDispatching welcome email to ${user.full_name} <${user.email}>...`);
    try {
      const res = await sendWelcomeEmail(user.email, user.full_name, user.id, true);
      console.log(`   Result: ${res.success ? '✅ SENT' : '❌ FAILED'}`);
      console.log(`   Status: ${res.status}`);
      if (res.logId) console.log(`   Dispatch Log ID: ${res.logId}`);
      results.push({
        email: user.email,
        name: user.full_name,
        success: res.success,
        status: res.status,
        logId: res.logId,
        message: res.message,
      });
    } catch (err: any) {
      console.error(`   Error sending to ${user.email}:`, err.message);
      results.push({
        email: user.email,
        name: user.full_name,
        success: false,
        status: 'error',
        error: err.message,
      });
    }
  }

  // 4. SUMMARY
  console.log('\n================================================================');
  console.log('DISPATCH SUMMARY:');
  console.log('================================================================');
  console.log(`In-App Notification: Live for all users (ID: ${insertNotifRes.rows[0].id})`);
  console.log(`Total Real Users Processed: ${realUsers.length}`);
  const sentCount = results.filter(r => r.success).length;
  console.log(`Emails Dispatched Successfully: ${sentCount}/${realUsers.length}`);
  results.forEach(r => {
    console.log(` - ${r.name} (${r.email}): ${r.success ? 'Delivered' : 'Failed'}`);
  });
  console.log('================================================================\n');

  process.exit(0);
}

main().catch(err => {
  console.error('Fatal dispatch error:', err);
  process.exit(1);
});
