import { query } from '../server/db';

async function migrate() {
  console.log('🚀 [Migration] Starting Complete Notification System Schema Migration...');

  try {
    // Drop in-progress tables if they had failed fkeys
    await query(`
      DROP TABLE IF EXISTS public.notification_delivery_logs CASCADE;
      DROP TABLE IF EXISTS public.push_subscriptions CASCADE;
      DROP TABLE IF EXISTS public.user_notifications CASCADE;
      DROP TABLE IF EXISTS public.user_notification_preferences CASCADE;
      DROP TABLE IF EXISTS public.notification_campaigns CASCADE;
    `);

    // 1. User Notifications table (personal in-app notifications)
    console.log('Creating table: public.user_notifications...');
    await query(`
      CREATE TABLE public.user_notifications (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'general',
        type VARCHAR(50) NOT NULL DEFAULT 'info',
        related_entity_type VARCHAR(50) NULL,
        related_entity_id TEXT NULL,
        deep_link TEXT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        read_at TIMESTAMPTZ NULL,
        is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
        deleted_at TIMESTAMPTZ NULL,
        metadata JSONB DEFAULT '{}'::jsonb,
        expires_at TIMESTAMPTZ NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // Indexes for user_notifications
    await query(`
      CREATE INDEX idx_user_notifications_user_active 
      ON public.user_notifications(user_id, is_deleted, created_at DESC);

      CREATE INDEX idx_user_notifications_user_read 
      ON public.user_notifications(user_id, is_read) 
      WHERE is_deleted = FALSE;

      CREATE INDEX idx_user_notifications_related 
      ON public.user_notifications(related_entity_type, related_entity_id);
    `);

    // 2. User Notification Preferences table
    console.log('Creating table: public.user_notification_preferences...');
    await query(`
      CREATE TABLE public.user_notification_preferences (
        user_id UUID PRIMARY KEY,
        in_app_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        push_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        email_enabled BOOLEAN NOT NULL DEFAULT TRUE,
        notify_income BOOLEAN NOT NULL DEFAULT TRUE,
        notify_expense BOOLEAN NOT NULL DEFAULT TRUE,
        notify_udhar BOOLEAN NOT NULL DEFAULT TRUE,
        notify_support BOOLEAN NOT NULL DEFAULT TRUE,
        notify_announcements BOOLEAN NOT NULL DEFAULT TRUE,
        notify_offers BOOLEAN NOT NULL DEFAULT TRUE,
        quiet_hours_enabled BOOLEAN NOT NULL DEFAULT FALSE,
        quiet_hours_start VARCHAR(10) DEFAULT '22:00',
        quiet_hours_end VARCHAR(10) DEFAULT '07:00',
        privacy_hide_amounts BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );
    `);

    // 3. Web Push Subscriptions table
    console.log('Creating table: public.push_subscriptions...');
    await query(`
      CREATE TABLE public.push_subscriptions (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        user_id UUID NOT NULL,
        endpoint TEXT NOT NULL UNIQUE,
        p256dh TEXT NOT NULL,
        auth TEXT NOT NULL,
        user_agent TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_push_subscriptions_user 
      ON public.push_subscriptions(user_id);
    `);

    // 4. Notification Campaigns (Admin broadcasts, scheduled blasts)
    console.log('Creating table: public.notification_campaigns...');
    await query(`
      CREATE TABLE public.notification_campaigns (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        title TEXT NOT NULL,
        message TEXT NOT NULL,
        category VARCHAR(50) NOT NULL DEFAULT 'announcement',
        type VARCHAR(50) NOT NULL DEFAULT 'announcement',
        channels TEXT[] NOT NULL DEFAULT '{"in_app"}',
        target_type VARCHAR(50) NOT NULL DEFAULT 'all',
        target_user_ids UUID[] NULL,
        deep_link TEXT NULL,
        status VARCHAR(50) NOT NULL DEFAULT 'sent',
        scheduled_for TIMESTAMPTZ NULL,
        sent_at TIMESTAMPTZ NULL,
        created_by UUID NULL,
        total_targets INT DEFAULT 0,
        delivered_count INT DEFAULT 0,
        failed_count INT DEFAULT 0,
        metadata JSONB DEFAULT '{}'::jsonb,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_notification_campaigns_status 
      ON public.notification_campaigns(status, scheduled_for);
    `);

    // 5. Notification Delivery Logs (multi-channel tracking)
    console.log('Creating table: public.notification_delivery_logs...');
    await query(`
      CREATE TABLE public.notification_delivery_logs (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        campaign_id UUID NULL REFERENCES public.notification_campaigns(id) ON DELETE CASCADE,
        notification_id UUID NULL REFERENCES public.user_notifications(id) ON DELETE SET NULL,
        user_id UUID NOT NULL,
        channel VARCHAR(20) NOT NULL,
        status VARCHAR(30) NOT NULL DEFAULT 'sent',
        error_message TEXT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
      );

      CREATE INDEX idx_notif_logs_user 
      ON public.notification_delivery_logs(user_id, created_at DESC);

      CREATE INDEX idx_notif_logs_campaign 
      ON public.notification_delivery_logs(campaign_id);
    `);

    // 6. Ensure all existing app users have a default notification preferences record
    console.log('Initializing default preferences for all users in public.app_users...');
    await query(`
      INSERT INTO public.user_notification_preferences (user_id)
      SELECT id FROM public.app_users
      ON CONFLICT (user_id) DO NOTHING;
    `);

    // 7. Seed initial welcome notifications for all existing users from existing announcement
    console.log('Seeding initial welcome notification for existing users...');
    const usersRes = await query(`SELECT id, full_name, email FROM public.app_users`);
    for (const u of usersRes.rows) {
      await query(
        `INSERT INTO public.user_notifications 
         (user_id, title, message, category, type, deep_link, metadata)
         VALUES ($1, $2, $3, 'announcement', 'announcement', 'dashboard', $4)`,
        [
          u.id,
          '🎉 Welcome to My Money Manager! 💚',
          `Hi ${u.full_name || 'there'}! Welcome to My Money Manager, a product of HackifyPro. Personal finance, simplified. Track your expenses, manage Udhar khata, and build smart financial habits.`,
          JSON.stringify({ isWelcome: true, sender: 'HackifyPro Team' }),
        ]
      );
    }

    console.log(`✅ [Migration] Complete Notification System Schema created successfully! Seeded ${usersRes.rows.length} welcome notifications.`);
    process.exit(0);
  } catch (err) {
    console.error('❌ [Migration Failed]:', err);
    process.exit(1);
  }
}

migrate();
