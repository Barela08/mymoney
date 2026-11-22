import { query } from '../server/db';

async function seedAndOptimizeDatabase() {
  console.log('====================================================');
  console.log('🚀 MY MONEY MANAGER — HIGH-PERFORMANCE SEED & OPTIMIZE');
  console.log('====================================================');

  try {
    // 1. High-Performance Query Indexes
    console.log('\n[1/4] Applying High-Performance Database Indexes...');
    const indexes = [
      // Transactions
      `CREATE INDEX IF NOT EXISTS idx_transactions_user_date ON public.transactions(user_id, transaction_date DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_category ON public.transactions(user_id, category);`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_type ON public.transactions(user_id, transaction_type);`,
      `CREATE INDEX IF NOT EXISTS idx_transactions_deleted ON public.transactions(user_id, is_deleted);`,
      
      // Budgets, Savings & Bills
      `CREATE INDEX IF NOT EXISTS idx_user_budgets_user ON public.user_budgets(user_id);`,
      `CREATE INDEX IF NOT EXISTS idx_savings_goals_user ON public.savings_goals(user_id, is_completed);`,
      `CREATE INDEX IF NOT EXISTS idx_recurring_bills_user ON public.recurring_bills(user_id, is_active);`,
      
      // Notifications
      `CREATE INDEX IF NOT EXISTS idx_user_notifications_user_unread ON public.user_notifications(user_id, is_read, created_at DESC);`,
      `CREATE INDEX IF NOT EXISTS idx_notifications_target ON public.notifications(target_user_id, is_active);`,
      
      // Udhar & Contacts
      `CREATE INDEX IF NOT EXISTS idx_udhar_contacts_user ON public.udhar_contacts(user_id, name);`,
      `CREATE INDEX IF NOT EXISTS idx_udhar_tx_user ON public.udhar_transactions(user_id, status);`,
      `CREATE INDEX IF NOT EXISTS idx_udhar_tx_counterpart ON public.udhar_transactions(counterpart_user_id, status);`,
      
      // Users & Security
      `CREATE INDEX IF NOT EXISTS idx_app_users_email ON public.app_users(email);`,
      `CREATE INDEX IF NOT EXISTS idx_app_users_role ON public.app_users(role);`,
      `CREATE INDEX IF NOT EXISTS idx_security_audit_user ON public.security_audit_logs(user_id, created_at DESC);`
    ];

    for (const sql of indexes) {
      await query(sql);
    }
    console.log('  ✅ 15 Query Optimization Indexes verified & applied.');

    // 2. Verify / Seed Default Core Sections
    console.log('\n[2/4] Verifying Default Expense Sections...');
    const defaultSections = [
      { id: 'home', name: 'Home Money', icon: 'Home', description: 'Money received and spent for home', display_order: 1 },
      { id: 'room', name: 'Room Expenses', icon: 'DoorOpen', description: 'Gas, grocery, room rent & power bill', display_order: 2 },
      { id: 'food', name: 'Food & Dining', icon: 'Utensils', description: 'Restaurant, snacks, beverages & delivery', display_order: 3 },
      { id: 'other', name: 'Other Expenses', icon: 'ShoppingBag', description: 'Shopping, travel, medical & personal', display_order: 4 },
      { id: 'people', name: 'People (Udhar)', icon: 'Users', description: 'Money given & received from people', display_order: 5 }
    ];

    for (const sec of defaultSections) {
      await query(
        `INSERT INTO public.sections (id, name, icon, description, display_order, is_enabled)
         VALUES ($1, $2, $3, $4, $5, TRUE)
         ON CONFLICT (id) DO UPDATE SET
           name = EXCLUDED.name,
           icon = EXCLUDED.icon,
           description = EXCLUDED.description,
           is_enabled = TRUE`,
        [sec.id, sec.name, sec.icon, sec.description, sec.display_order]
      );
    }
    console.log('  ✅ 5 Core Application Sections verified & seeded.');

    // 3. Verify / Seed App Settings
    console.log('\n[3/4] Verifying Application Settings...');
    const defaultSettings = [
      { key: 'app_name', value: { text: 'My Money Manager' } },
      { key: 'brand_subtitle', value: { text: 'by HackifyPro' } },
      { key: 'support_email', value: { text: 'hackifypro@gmail.com' } },
      { key: 'support_phone', value: { text: '+91 74149 35405' } },
      { key: 'allow_registration', value: { enabled: true } },
      { key: 'maintenance_mode', value: { isEnabled: false, message: 'Under scheduled maintenance.' } }
    ];

    for (const s of defaultSettings) {
      await query(
        `INSERT INTO public.app_settings (key, value)
         VALUES ($1, $2)
         ON CONFLICT (key) DO NOTHING`,
        [s.key, JSON.stringify(s.value)]
      );
    }
    console.log('  ✅ System Application Settings verified & seeded.');

    // 4. Verify Database Integrity & Counts
    console.log('\n[4/4] Verifying Database Health & Table Records...');
    const userCountRes = await query(`SELECT COUNT(*) as count FROM public.app_users`);
    const txCountRes = await query(`SELECT COUNT(*) as count FROM public.transactions WHERE is_deleted = FALSE`);
    const contactCountRes = await query(`SELECT COUNT(*) as count FROM public.udhar_contacts`);
    const notifCountRes = await query(`SELECT COUNT(*) as count FROM public.user_notifications`);

    console.log(`  📊 Registered Users: ${userCountRes.rows[0].count}`);
    console.log(`  📊 Active Transactions: ${txCountRes.rows[0].count}`);
    console.log(`  📊 Saved Contacts: ${contactCountRes.rows[0].count}`);
    console.log(`  📊 In-App Notifications: ${notifCountRes.rows[0].count}`);

    console.log('\n====================================================');
    console.log('🎉 ALL TABLES, INDEXES & SEED DATA VERIFIED 100% READY!');
    console.log('====================================================');
  } catch (err: any) {
    console.error('❌ Error during seed and optimize:', err.message);
  } finally {
    process.exit(0);
  }
}

seedAndOptimizeDatabase();
