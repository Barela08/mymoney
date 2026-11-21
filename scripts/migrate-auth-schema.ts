import pg from 'pg';
import bcrypt from 'bcryptjs';
import fs from 'fs';
import path from 'path';

// Parse .env manually
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  console.warn('Notice parsing .env:', e);
}

const connectionString = process.env.DATABASE_URL || '';
if (!connectionString) {
  console.error('DATABASE_URL is not set in environment or .env');
  process.exit(1);
}

async function migrate() {
  const client = new pg.Client({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });

  await client.connect();
  console.log('Connected to PostgreSQL for Auth Migration...');

  const sql = `
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
    CREATE EXTENSION IF NOT EXISTS "pgcrypto";

    -- 1. USERS TABLE
    CREATE TABLE IF NOT EXISTS public.app_users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      full_name TEXT NOT NULL,
      email TEXT NOT NULL UNIQUE,
      phone TEXT,
      password_hash TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'admin', 'superadmin')),
      status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deactivated')),
      email_verified BOOLEAN NOT NULL DEFAULT FALSE,
      avatar_url TEXT,
      force_password_reset BOOLEAN NOT NULL DEFAULT FALSE,
      failed_login_attempts INT NOT NULL DEFAULT 0,
      locked_until TIMESTAMPTZ,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_login_at TIMESTAMPTZ,
      last_login_ip TEXT,
      password_changed_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_app_users_email ON public.app_users(LOWER(email));
    CREATE INDEX IF NOT EXISTS idx_app_users_role ON public.app_users(role);
    CREATE INDEX IF NOT EXISTS idx_app_users_status ON public.app_users(status);

    -- 2. PASSWORD RESETS TABLE
    CREATE TABLE IF NOT EXISTS public.password_resets (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
      token_hash TEXT NOT NULL,
      expires_at TIMESTAMPTZ NOT NULL,
      used BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      used_at TIMESTAMPTZ,
      ip_address TEXT,
      user_agent TEXT
    );

    CREATE INDEX IF NOT EXISTS idx_password_resets_token_hash ON public.password_resets(token_hash);
    CREATE INDEX IF NOT EXISTS idx_password_resets_user_id ON public.password_resets(user_id);
    CREATE INDEX IF NOT EXISTS idx_password_resets_expires ON public.password_resets(expires_at);

    -- 3. USER SESSIONS TABLE
    CREATE TABLE IF NOT EXISTS public.user_sessions (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES public.app_users(id) ON DELETE CASCADE,
      session_token_hash TEXT NOT NULL UNIQUE,
      user_agent TEXT,
      ip_address TEXT,
      expires_at TIMESTAMPTZ NOT NULL,
      is_revoked BOOLEAN NOT NULL DEFAULT FALSE,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      last_active_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_user_sessions_token_hash ON public.user_sessions(session_token_hash);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id ON public.user_sessions(user_id);
    CREATE INDEX IF NOT EXISTS idx_user_sessions_expires_at ON public.user_sessions(expires_at);

    -- 4. SECURITY AUDIT LOGS TABLE
    CREATE TABLE IF NOT EXISTS public.security_audit_logs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      event_type TEXT NOT NULL,
      user_id UUID,
      user_email TEXT,
      actor_role TEXT NOT NULL DEFAULT 'user',
      ip_address TEXT,
      details JSONB NOT NULL DEFAULT '{}'::jsonb,
      created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    );

    CREATE INDEX IF NOT EXISTS idx_audit_created ON public.security_audit_logs(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_audit_event ON public.security_audit_logs(event_type);
  `;

  await client.query(sql);
  console.log('Core Auth Tables created or verified successfully!');

  // Seed default admin user
  const adminEmail = 'admin@mymoney.com';
  const adminPass = 'Admin@Sec2026!Master';
  const adminSalt = await bcrypt.genSalt(12);
  const adminHash = await bcrypt.hash(adminPass, adminSalt);

  const existingAdmin = await client.query('SELECT id, email, role FROM public.app_users WHERE LOWER(email) = $1', [adminEmail.toLowerCase()]);
  if (existingAdmin.rows.length === 0) {
    await client.query(`
      INSERT INTO public.app_users (
        full_name, email, phone, password_hash, role, status, email_verified, password_changed_at
      ) VALUES ($1, $2, $3, $4, $5, $6, $7, NOW())
    `, [
      'Security Administrator',
      adminEmail.toLowerCase(),
      '+91 7414934540',
      adminHash,
      'admin',
      'active',
      true,
    ]);
    console.log(`Seeded default admin (${adminEmail}) with secure bcrypt hash!`);
  } else {
    // Ensure role is admin
    await client.query('UPDATE public.app_users SET role = $1, status = $2 WHERE LOWER(email) = $3', ['admin', 'active', adminEmail.toLowerCase()]);
    console.log(`Verified default admin (${adminEmail}) role is admin.`);
  }

  // Also check if any existing users in public.profiles need migration
  try {
    const profiles = await client.query('SELECT * FROM public.profiles');
    console.log(`Found ${profiles.rows.length} existing profile(s) in public.profiles.`);
    for (const p of profiles.rows) {
      if (!p.email) continue;
      const chk = await client.query('SELECT id FROM public.app_users WHERE LOWER(email) = $1', [p.email.toLowerCase()]);
      if (chk.rows.length === 0) {
        // If profile had a display_password, hash it properly with bcrypt
        const rawPass = p.display_password || 'SecureDefault@2026';
        const h = await bcrypt.hash(rawPass, 12);
        await client.query(`
          INSERT INTO public.app_users (
            id, full_name, email, password_hash, role, status, email_verified, created_at
          ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)
          ON CONFLICT (id) DO NOTHING
        `, [
          p.id,
          p.email.split('@')[0],
          p.email.toLowerCase(),
          h,
          p.role === 'admin' ? 'admin' : 'user',
          p.status || 'active',
          true,
          p.created_at || new Date().toISOString(),
        ]);
        console.log(`Migrated user ${p.email} to app_users.`);
      }
    }
  } catch (err) {
    console.warn('Profile migration notice:', err);
  }

  // REMOVE display_password column from public.profiles if present (Security cleanup)
  try {
    await client.query('ALTER TABLE public.profiles DROP COLUMN IF EXISTS display_password;');
    console.log('Cleaned up and removed display_password column from public.profiles!');
  } catch (err) {
    console.warn('Cleanup notice:', err);
  }

  console.log('Migration finished successfully!');
  await client.end();
}

migrate().catch((err) => {
  console.error('Migration failed:', err);
  process.exit(1);
});
