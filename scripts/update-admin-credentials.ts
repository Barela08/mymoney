import { query } from '../server/db';
import { hashPassword } from '../server/security';

async function updateAdminCredentials() {
  console.log('--- Updating Admin Credentials ---');
  const targetEmail = 'hackifypro@gmail.com';
  const targetPassword = 'Nilu@2006';

  const hash = await hashPassword(targetPassword);
  console.log('Bcrypt password hash computed successfully.');

  // Check if hackifypro@gmail.com exists
  const existing = await query(
    'SELECT id, email, full_name, role FROM public.app_users WHERE LOWER(email) = LOWER($1)',
    [targetEmail]
  );

  if (existing.rows.length > 0) {
    // Update existing row
    await query(
      `UPDATE public.app_users 
       SET full_name = 'HackifyPro Administrator',
           password_hash = $1,
           role = 'superadmin',
           status = 'active',
           email_verified = TRUE,
           force_password_reset = FALSE,
           failed_login_attempts = 0,
           locked_until = NULL,
           updated_at = NOW()
       WHERE id = $2`,
      [hash, existing.rows[0].id]
    );
    console.log(`Updated existing user (${targetEmail}) to superadmin with new password.`);
  } else {
    // Check if previous default admin (admin@mymoney.com) exists
    const prevAdmin = await query(
      'SELECT id, email FROM public.app_users WHERE LOWER(email) = $1',
      ['admin@mymoney.com']
    );

    if (prevAdmin.rows.length > 0) {
      await query(
        `UPDATE public.app_users 
         SET email = $1,
             full_name = 'HackifyPro Administrator',
             password_hash = $2,
             role = 'superadmin',
             status = 'active',
             email_verified = TRUE,
             force_password_reset = FALSE,
             failed_login_attempts = 0,
             locked_until = NULL,
             updated_at = NOW()
         WHERE id = $3`,
        [targetEmail, hash, prevAdmin.rows[0].id]
      );
      console.log(`Updated previous admin account ID ${prevAdmin.rows[0].id} to ${targetEmail} with new password.`);
    } else {
      // Insert new superadmin
      await query(
        `INSERT INTO public.app_users (
          email, full_name, password_hash, role, status, email_verified, force_password_reset, failed_login_attempts, created_at, updated_at
        ) VALUES (
          $1, 'HackifyPro Administrator', $2, 'superadmin', 'active', TRUE, FALSE, 0, NOW(), NOW()
        )`,
        [targetEmail, hash]
      );
      console.log(`Created new superadmin account: ${targetEmail}`);
    }
  }

  // Also verify that admin@mymoney.com is either updated or has same password if needed
  const finalCheck = await query(
    `SELECT id, full_name, email, role, status, email_verified, force_password_reset 
     FROM public.app_users 
     WHERE LOWER(email) = LOWER($1)`,
    [targetEmail]
  );

  console.log('Verified database record:', JSON.stringify(finalCheck.rows, null, 2));
}

updateAdminCredentials()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error('Failed to update admin credentials:', e);
    process.exit(1);
  });
