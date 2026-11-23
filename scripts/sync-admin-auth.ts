import { query } from '../server/db';
import { hashPassword } from '../server/security';

async function syncAllAuthTables() {
  console.log('--- Syncing Supabase auth.users & public.profiles ---');
  const targetEmail = 'hackifypro@gmail.com';
  const targetPassword = 'Nilu@2006';

  const hash = await hashPassword(targetPassword);

  // 1. Update auth.users
  try {
    const authUserUpdate = await query(
      `UPDATE auth.users 
       SET email = $1,
           encrypted_password = $2,
           email_confirmed_at = NOW(),
           raw_app_meta_data = raw_app_meta_data || '{"provider":"email","providers":["email"],"role":"superadmin"}'::jsonb,
           raw_user_meta_data = raw_user_meta_data || '{"full_name":"HackifyPro Administrator","role":"superadmin"}'::jsonb,
           updated_at = NOW()
       WHERE id = 'c2acb234-abbb-49fe-b612-e6d5d108e2dd' OR email = 'admin@mymoney.com' OR email = $1
       RETURNING id, email`,
      [targetEmail, hash]
    );
    console.log('auth.users updated:', JSON.stringify(authUserUpdate.rows, null, 2));
  } catch (err: any) {
    console.warn('auth.users update notice:', err.message);
  }

  // 2. Check and update public.profiles if exists
  try {
    const profUpdate = await query(
      `UPDATE public.profiles 
       SET email = $1, role = 'superadmin', status = 'active', updated_at = NOW() 
       WHERE id = 'c2acb234-abbb-49fe-b612-e6d5d108e2dd' OR email = 'admin@mymoney.com' OR email = $1
       RETURNING *`,
      [targetEmail]
    );
    console.log('public.profiles updated:', JSON.stringify(profUpdate.rows, null, 2));
  } catch (err: any) {
    console.warn('public.profiles update notice:', err.message);
  }

  // 3. Verify public.app_users
  const appUsersRes = await query(
    `SELECT id, email, full_name, role, status FROM public.app_users WHERE email = $1`,
    [targetEmail]
  );
  console.log('public.app_users verified:', JSON.stringify(appUsersRes.rows, null, 2));
}

syncAllAuthTables()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
