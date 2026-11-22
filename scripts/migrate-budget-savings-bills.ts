import { query } from '../server/db';

async function migrate() {
  console.log('🚀 [Migration] Creating tables for Budgets, Savings Goals, and Recurring Bills...');

  try {
    // 1. user_budgets table
    console.log('Creating table: public.user_budgets...');
    await query(`
      CREATE TABLE IF NOT EXISTS public.user_budgets (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        category VARCHAR(50) NOT NULL,
        monthly_limit NUMERIC(14, 2) NOT NULL CHECK (monthly_limit > 0),
        alert_threshold INTEGER NOT NULL DEFAULT 85 CHECK (alert_threshold > 0 AND alert_threshold <= 100),
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        CONSTRAINT uq_user_budget_category UNIQUE(user_id, category)
      );

      CREATE INDEX IF NOT EXISTS idx_user_budgets_user ON public.user_budgets(user_id);
    `);

    // 2. savings_goals table
    console.log('Creating table: public.savings_goals...');
    await query(`
      CREATE TABLE IF NOT EXISTS public.savings_goals (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        title VARCHAR(250) NOT NULL,
        target_amount NUMERIC(14, 2) NOT NULL CHECK (target_amount > 0),
        current_amount NUMERIC(14, 2) NOT NULL DEFAULT 0 CHECK (current_amount >= 0),
        target_date DATE NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'general',
        notes TEXT NULL,
        is_completed BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_savings_goals_user ON public.savings_goals(user_id, is_completed);
    `);

    // 3. recurring_bills table
    console.log('Creating table: public.recurring_bills...');
    await query(`
      CREATE TABLE IF NOT EXISTS public.recurring_bills (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        title VARCHAR(250) NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'other',
        amount NUMERIC(14, 2) NOT NULL CHECK (amount > 0),
        frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
        due_day INTEGER NOT NULL DEFAULT 1 CHECK (due_day >= 1 AND due_day <= 31),
        next_due_date DATE NULL,
        reminder_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        is_active BOOLEAN NOT NULL DEFAULT TRUE,
        last_paid_date DATE NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX IF NOT EXISTS idx_recurring_bills_user ON public.recurring_bills(user_id, is_active);
    `);

    console.log('✅ [Migration Completed] user_budgets, savings_goals, recurring_bills created successfully!');
    process.exit(0);
  } catch (err: any) {
    console.error('❌ [Migration Error]:', err);
    process.exit(1);
  }
}

migrate();
