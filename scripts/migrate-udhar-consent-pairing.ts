import fs from 'fs';
import path from 'path';
import { pool, isDatabaseConfigured } from '../server/db';

/**
 * Applies the consent-based Udhar pairing migration.
 * Safe to re-run: every statement is idempotent and preserves existing data.
 */
async function run() {
  if (!isDatabaseConfigured) {
    console.error('DATABASE_URL is not configured. Cannot apply migration.');
    process.exitCode = 1;
    return;
  }

  const file = path.resolve(__dirname, 'migrations/20261125_udhar_consent_pairing.sql');
  const sql = fs.readFileSync(file, 'utf8');
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(sql);
    await client.query('COMMIT');
    console.log('Applied 20261125_udhar_consent_pairing.sql');
  } catch (err: any) {
    await client.query('ROLLBACK').catch(() => {});
    console.error('Migration failed:', err?.message || err);
    process.exitCode = 1;
  } finally {
    client.release();
    await pool.end().catch(() => {});
  }
}

run();
