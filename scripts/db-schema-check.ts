import { query } from '../server/db';

async function main() {
  try {
    const tables = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public' 
      ORDER BY table_name
    `);
    console.log('Tables:', tables.rows.map(r => r.table_name));

    const cols = await query(`
      SELECT column_name, data_type, is_nullable 
      FROM information_schema.columns 
      WHERE table_schema = 'public' AND table_name = 'app_users'
      ORDER BY ordinal_position
    `);
    console.log('app_users columns:', cols.rows);
  } catch (e) {
    console.error('Error:', e);
  } finally {
    process.exit(0);
  }
}

main();
