import { query } from '../server/db';

async function checkTables() {
  const tables = await query(`
    SELECT table_name 
    FROM information_schema.tables 
    WHERE table_schema = 'public' 
    ORDER BY table_name;
  `);
  console.log('All public tables:', tables.rows.map(r => r.table_name));

  // Check columns of feedbacks if exists
  const fbCols = await query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'feedbacks';
  `);
  console.log('feedbacks columns:', fbCols.rows);

  // Check columns of support_tickets if exists
  const stCols = await query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'support_tickets';
  `);
  console.log('support_tickets columns:', stCols.rows);

  // Check columns of support_ticket_replies if exists
  const strCols = await query(`
    SELECT column_name, data_type 
    FROM information_schema.columns 
    WHERE table_schema = 'public' AND table_name = 'support_ticket_replies';
  `);
  console.log('support_ticket_replies columns:', strCols.rows);
}

checkTables()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Check failed:', err);
    process.exit(1);
  });
