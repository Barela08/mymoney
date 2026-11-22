import * as webpush from 'web-push';
import { query } from './db';
import { APP_CONFIG } from './config';
import { sendEmail } from './email';
import { generateCampaignEmail } from './notificationEmailTemplates';

// Initialize web-push VAPID details
try {
  webpush.setVapidDetails(
    APP_CONFIG.vapid.subject,
    APP_CONFIG.vapid.publicKey,
    APP_CONFIG.vapid.privateKey
  );
} catch (e) {
  console.warn('[Push] Error configuring VAPID:', e);
}

export type NotificationCategory =
  | 'general'
  | 'income'
  | 'expense'
  | 'udhar'
  | 'repay'
  | 'settlement'
  | 'feedback'
  | 'complaint'
  | 'support'
  | 'announcement'
  | 'offer'
  | 'security'
  | 'system';

export type NotificationType =
  | 'info'
  | 'success'
  | 'warning'
  | 'error'
  | 'announcement'
  | 'offer'
  | 'reminder';

export interface CreateNotificationParams {
  userId: string;
  title: string;
  message: string;
  category?: NotificationCategory;
  type?: NotificationType;
  relatedEntityType?: string;
  relatedEntityId?: string;
  deepLink?: string;
  metadata?: Record<string, any>;
  channels?: Array<'in_app' | 'push' | 'email'>;
  skipPreferenceCheck?: boolean;
  emailOptions?: {
    subject?: string;
    html?: string;
    text?: string;
    actionText?: string;
  };
  campaignId?: string;
}

export interface UserPreferences {
  in_app_enabled: boolean;
  push_enabled: boolean;
  email_enabled: boolean;
  notify_income: boolean;
  notify_expense: boolean;
  notify_udhar: boolean;
  notify_support: boolean;
  notify_announcements: boolean;
  notify_offers: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  privacy_hide_amounts: boolean;
}

/**
 * Checks if current IST time falls in the user's quiet hours
 */
function isCurrentTimeInQuietHours(startTime: string, endTime: string): boolean {
  try {
    const now = new Date();
    // Convert to IST (UTC + 5:30)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(now.getTime() + istOffset);
    const curHour = istDate.getUTCHours();
    const curMin = istDate.getUTCMinutes();
    const curTotalMin = curHour * 60 + curMin;

    const [startH, startM] = startTime.split(':').map((n) => parseInt(n, 10));
    const [endH, endM] = endTime.split(':').map((n) => parseInt(n, 10));
    const startTotalMin = startH * 60 + (startM || 0);
    const endTotalMin = endH * 60 + (endM || 0);

    if (startTotalMin <= endTotalMin) {
      return curTotalMin >= startTotalMin && curTotalMin < endTotalMin;
    } else {
      // Overnight (e.g. 22:00 to 07:00)
      return curTotalMin >= startTotalMin || curTotalMin < endTotalMin;
    }
  } catch {
    return false;
  }
}

/**
 * Mask monetary values (₹500, ₹ 10,000, 5000) for privacy mode
 */
function maskFinancialData(text: string): string {
  return text.replace(/(?:₹|INR|\$)\s*[0-9,]+(?:\.[0-9]+)?/gi, '₹[Hidden]');
}

/**
 * Fetches user notification preferences or returns defaults
 */
export async function getUserNotificationPreferences(userId: string): Promise<UserPreferences> {
  const defaults: UserPreferences = {
    in_app_enabled: true,
    push_enabled: true,
    email_enabled: true,
    notify_income: true,
    notify_expense: true,
    notify_udhar: true,
    notify_support: true,
    notify_announcements: true,
    notify_offers: true,
    quiet_hours_enabled: false,
    quiet_hours_start: '22:00',
    quiet_hours_end: '07:00',
    privacy_hide_amounts: false,
  };

  try {
    const res = await query(
      `SELECT * FROM public.user_notification_preferences WHERE user_id = $1`,
      [userId]
    );
    if (res.rows.length > 0) {
      return { ...defaults, ...res.rows[0] };
    }
    // Auto-create defaults if missing
    await query(
      `INSERT INTO public.user_notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    ).catch(() => {});
    return defaults;
  } catch {
    return defaults;
  }
}

/**
 * Check if category is enabled in user preferences
 */
function isCategoryEnabled(prefs: UserPreferences, category: NotificationCategory): boolean {
  switch (category) {
    case 'income':
      return prefs.notify_income;
    case 'expense':
      return prefs.notify_expense;
    case 'udhar':
    case 'repay':
    case 'settlement':
      return prefs.notify_udhar;
    case 'feedback':
    case 'complaint':
    case 'support':
      return prefs.notify_support;
    case 'announcement':
      return prefs.notify_announcements;
    case 'offer':
      return prefs.notify_offers;
    case 'security':
    case 'system':
    case 'general':
    default:
      return true;
  }
}

/**
 * Create a multi-channel notification for a user
 */
export async function createNotification(params: CreateNotificationParams): Promise<{
  success: boolean;
  notificationId?: string;
  inAppDelivered: boolean;
  pushDelivered: number;
  emailDelivered: boolean;
}> {
  const {
    userId,
    title,
    message,
    category = 'general',
    type = 'info',
    relatedEntityType,
    relatedEntityId,
    deepLink,
    metadata = {},
    channels = ['in_app', 'push'],
    skipPreferenceCheck = false,
    emailOptions,
    campaignId,
  } = params;

  let inAppDelivered = false;
  let pushDelivered = 0;
  let emailDelivered = false;
  let notificationId: string | undefined;

  const prefs = await getUserNotificationPreferences(userId);
  const categoryAllowed = skipPreferenceCheck || isCategoryEnabled(prefs, category);
  const inQuietHours =
    !skipPreferenceCheck &&
    prefs.quiet_hours_enabled &&
    isCurrentTimeInQuietHours(prefs.quiet_hours_start, prefs.quiet_hours_end);

  // 1. IN-APP NOTIFICATION
  if (channels.includes('in_app') && (skipPreferenceCheck || (prefs.in_app_enabled && categoryAllowed))) {
    try {
      const insRes = await query(
        `INSERT INTO public.user_notifications 
         (user_id, title, message, category, type, related_entity_type, related_entity_id, deep_link, metadata)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
         RETURNING id`,
        [
          userId,
          title,
          message,
          category,
          type,
          relatedEntityType || null,
          relatedEntityId || null,
          deepLink || null,
          JSON.stringify(metadata),
        ]
      );
      if (insRes.rows.length > 0) {
        notificationId = insRes.rows[0].id;
        inAppDelivered = true;
        await query(
          `INSERT INTO public.notification_delivery_logs 
           (campaign_id, notification_id, user_id, channel, status)
           VALUES ($1, $2, $3, 'in_app', 'sent')`,
          [campaignId || null, notificationId, userId]
        ).catch(() => {});
      }
    } catch (e: any) {
      console.error('[NotificationService] In-App delivery failed:', e.message);
      await query(
        `INSERT INTO public.notification_delivery_logs 
         (campaign_id, user_id, channel, status, error_message)
         VALUES ($1, $2, 'in_app', 'failed', $3)`,
        [campaignId || null, userId, e.message]
      ).catch(() => {});
    }
  }

  // 2. MOBILE PUSH NOTIFICATION
  if (
    channels.includes('push') &&
    (skipPreferenceCheck || (prefs.push_enabled && categoryAllowed && !inQuietHours))
  ) {
    try {
      const subRes = await query(
        `SELECT id, endpoint, p256dh, auth FROM public.push_subscriptions WHERE user_id = $1`,
        [userId]
      );

      if (subRes.rows.length > 0) {
        const pushTitle = title;
        const pushBody = prefs.privacy_hide_amounts ? maskFinancialData(message) : message;

        const pushPayload = JSON.stringify({
          title: pushTitle,
          body: pushBody,
          icon: '/logo.jpg',
          badge: '/icon-192.png',
          tag: `notif-${category}`,
          data: {
            url: deepLink ? `/#${deepLink.replace(/^\//, '')}` : '/',
            notificationId: notificationId || null,
            category,
          },
        });

        for (const sub of subRes.rows) {
          try {
            await webpush.sendNotification(
              {
                endpoint: sub.endpoint,
                keys: {
                  p256dh: sub.p256dh,
                  auth: sub.auth,
                },
              },
              pushPayload
            );
            pushDelivered++;
            await query(
              `INSERT INTO public.notification_delivery_logs 
               (campaign_id, notification_id, user_id, channel, status)
               VALUES ($1, $2, $3, 'push', 'sent')`,
              [campaignId || null, notificationId || null, userId]
            ).catch(() => {});
          } catch (pushErr: any) {
            console.warn('[NotificationService] Web Push failed for subscription:', pushErr.statusCode);
            // 404 Not Found or 410 Gone means the subscription is no longer active
            if (pushErr.statusCode === 404 || pushErr.statusCode === 410) {
              await query(`DELETE FROM public.push_subscriptions WHERE id = $1`, [sub.id]).catch(() => {});
            }
            await query(
              `INSERT INTO public.notification_delivery_logs 
               (campaign_id, notification_id, user_id, channel, status, error_message)
               VALUES ($1, $2, $3, 'push', 'failed', $4)`,
              [campaignId || null, notificationId || null, userId, pushErr.message]
            ).catch(() => {});
          }
        }
      }
    } catch (e: any) {
      console.error('[NotificationService] Push delivery block error:', e.message);
    }
  }

  // 3. EMAIL NOTIFICATION
  if (
    channels.includes('email') &&
    (skipPreferenceCheck || (prefs.email_enabled && categoryAllowed && !inQuietHours))
  ) {
    try {
      const uRes = await query(
        `SELECT email, full_name FROM public.app_users WHERE id = $1`,
        [userId]
      );
      if (uRes.rows.length > 0 && uRes.rows[0].email) {
        const u = uRes.rows[0];
        let subject = emailOptions?.subject || title;
        let htmlContent = emailOptions?.html;
        let textContent = emailOptions?.text;

        if (!htmlContent) {
          const generated = generateCampaignEmail({
            userName: u.full_name || 'My Money User',
            userEmail: u.email,
            title,
            message,
            category,
            deepLink,
            actionText: emailOptions?.actionText || 'View in App',
          });
          htmlContent = generated.html;
          textContent = generated.text;
        }

        const sent = await sendEmail({
          to: u.email,
          subject,
          html: htmlContent,
          text: textContent || message,
        });

        if (sent) {
          emailDelivered = true;
          await query(
            `INSERT INTO public.notification_delivery_logs 
             (campaign_id, notification_id, user_id, channel, status)
             VALUES ($1, $2, $3, 'email', 'sent')`,
            [campaignId || null, notificationId || null, userId]
          ).catch(() => {});
        } else {
          await query(
            `INSERT INTO public.notification_delivery_logs 
             (campaign_id, notification_id, user_id, channel, status, error_message)
             VALUES ($1, $2, $3, 'email', 'failed', 'SMTP send failure')`,
            [campaignId || null, notificationId || null, userId]
          ).catch(() => {});
        }
      }
    } catch (e: any) {
      console.error('[NotificationService] Email delivery failed:', e.message);
    }
  }

  return {
    success: inAppDelivered || pushDelivered > 0 || emailDelivered,
    notificationId,
    inAppDelivered,
    pushDelivered,
    emailDelivered,
  };
}

// -------------------------------------------------------------
// Specialized Automated Trigger Helpers
// -------------------------------------------------------------

/**
 * Triggered when a new income/expense transaction is added
 */
export async function notifyTransactionCreated(
  userId: string,
  tx: {
    id: string;
    title: string;
    amount: number;
    type: 'income' | 'expense';
    category?: string;
    section?: string;
  }
) {
  const isIncome = tx.type === 'income';
  const category: NotificationCategory = isIncome ? 'income' : 'expense';
  const formattedAmount = `₹${Number(tx.amount).toLocaleString('en-IN')}`;

  const title = isIncome
    ? `Income Added: +${formattedAmount} 📈`
    : `Expense Recorded: -${formattedAmount} 💸`;

  const message = isIncome
    ? `You received ${formattedAmount} for "${tx.title}" in ${tx.section || 'General'}.`
    : `You spent ${formattedAmount} on "${tx.title}" (${tx.category || tx.section || 'Expense'}).`;

  // Route directly to the matching tab
  const deepLink = tx.section ? tx.section.toLowerCase() : 'all_transactions';

  await createNotification({
    userId,
    title,
    message,
    category,
    type: isIncome ? 'success' : 'info',
    relatedEntityType: 'transaction',
    relatedEntityId: tx.id,
    deepLink,
    channels: ['in_app', 'push'],
    metadata: { amount: tx.amount, type: tx.type, section: tx.section },
  });
}

/**
 * Triggered when a new Udhar transaction is created
 */
export async function notifyUdharCreated(params: {
  initiatorUserId: string;
  recipientUserId?: string | null;
  transactionId: string;
  contactName: string;
  amount: number;
  direction: 'given' | 'taken' | 'gave' | 'took';
  dueDate?: string | null;
}) {
  const formattedAmount = `₹${Number(params.amount).toLocaleString('en-IN')}`;
  const isGiven = params.direction === 'given' || params.direction === 'gave';

  // 1. Initiator notification
  await createNotification({
    userId: params.initiatorUserId,
    title: isGiven ? `Udhar Given: ${formattedAmount}` : `Udhar Taken: ${formattedAmount}`,
    message: isGiven
      ? `You gave ${formattedAmount} to ${params.contactName}. Khata ledger updated.`
      : `You took ${formattedAmount} from ${params.contactName}. Khata ledger updated.`,
    category: 'udhar',
    type: 'info',
    relatedEntityType: 'udhar_transaction',
    relatedEntityId: params.transactionId,
    deepLink: 'people',
    channels: ['in_app', 'push'],
  });

  // 2. Recipient notification if registered in My Money Manager
  if (params.recipientUserId) {
    await createNotification({
      userId: params.recipientUserId,
      title: isGiven ? `Udhar Recorded: ${formattedAmount}` : `Payment Recorded: ${formattedAmount}`,
      message: isGiven
        ? `You borrowed ${formattedAmount} from ${params.contactName}. View your Udhar ledger.`
        : `You lent ${formattedAmount} to ${params.contactName}. View your Udhar ledger.`,
      category: 'udhar',
      type: 'info',
      relatedEntityType: 'udhar_transaction',
      relatedEntityId: params.transactionId,
      deepLink: 'people',
      channels: ['in_app', 'push', 'email'],
    });
  }
}

/**
 * Triggered when two users connect via QR code
 */
export async function notifyQrConnected(params: {
  userAId: string;
  userAName: string;
  userBId: string;
  userBName: string;
}) {
  // 1. Notification for User A (Scanner)
  await createNotification({
    userId: params.userAId,
    title: `Connected with ${params.userBName} 🤝`,
    message: `You are now linked with ${params.userBName}. Mutual 2-way Udhar tracking and settlements are active.`,
    category: 'udhar',
    type: 'success',
    deepLink: 'people',
    channels: ['in_app', 'push'],
  });

  // 2. Notification for User B (Whose QR was scanned)
  await createNotification({
    userId: params.userBId,
    title: `New Friend Connected: ${params.userAName} 🤝`,
    message: `${params.userAName} scanned your QR code and connected with you! Added to your Saved People.`,
    category: 'udhar',
    type: 'success',
    deepLink: 'people',
    channels: ['in_app', 'push', 'email'],
  });
}

/**
 * Triggered when an Udhar repayment is recorded
 */
export async function notifyUdharRepayment(params: {
  initiatorUserId: string;
  recipientUserId?: string | null;
  repaymentId: string;
  contactName: string;
  repaymentAmount: number;
  remainingBalance: number;
  isFullySettled: boolean;
}) {
  const formattedRepayment = `₹${Number(params.repaymentAmount).toLocaleString('en-IN')}`;
  const formattedRemaining = `₹${Number(params.remainingBalance).toLocaleString('en-IN')}`;

  if (params.isFullySettled) {
    // 1. Fully settled congratulatory alert!
    const title = `🎉 Udhar Settled with ${params.contactName}! 💚`;
    const message = `Full repayment of ${formattedRepayment} completed. Remaining balance is ₹0. Udhar khata marked as settled.`;

    await createNotification({
      userId: params.initiatorUserId,
      title,
      message,
      category: 'settlement',
      type: 'success',
      relatedEntityType: 'udhar_repayment',
      relatedEntityId: params.repaymentId,
      deepLink: 'people',
      channels: ['in_app', 'push', 'email'],
    });

    // Auto-cancel / deactivate any pending reminder notifications for this contact
    await query(
      `UPDATE public.user_notifications 
       SET is_read = TRUE, metadata = metadata || '{"settled": true}'::jsonb 
       WHERE user_id = $1 AND category = 'udhar' AND related_entity_type = 'udhar_transaction'`,
      [params.initiatorUserId]
    ).catch(() => {});

    if (params.recipientUserId) {
      await createNotification({
        userId: params.recipientUserId,
        title,
        message: `Your Udhar balance of ${formattedRepayment} with ${params.contactName} is fully settled (₹0 balance).`,
        category: 'settlement',
        type: 'success',
        relatedEntityType: 'udhar_repayment',
        relatedEntityId: params.repaymentId,
        deepLink: 'people',
        channels: ['in_app', 'push', 'email'],
      });
    }
  } else {
    // Partial repayment alert with dynamic remaining balance
    const title = `Udhar Repayment Received: ${formattedRepayment}`;
    const message = `Payment of ${formattedRepayment} recorded for ${params.contactName}. Remaining balance: ${formattedRemaining}.`;

    await createNotification({
      userId: params.initiatorUserId,
      title,
      message,
      category: 'repay',
      type: 'info',
      relatedEntityType: 'udhar_repayment',
      relatedEntityId: params.repaymentId,
      deepLink: 'people',
      channels: ['in_app', 'push'],
    });

    if (params.recipientUserId) {
      await createNotification({
        userId: params.recipientUserId,
        title: `Payment Updated: ${formattedRepayment}`,
        message: `Repayment of ${formattedRepayment} applied. Your remaining balance is ${formattedRemaining}.`,
        category: 'repay',
        type: 'info',
        relatedEntityType: 'udhar_repayment',
        relatedEntityId: params.repaymentId,
        deepLink: 'people',
        channels: ['in_app', 'push'],
      });
    }
  }
}

/**
 * Triggered when a user submits feedback
 */
export async function notifyFeedbackSubmitted(
  userId: string,
  feedback: { id: string; rating: number; category?: string }
) {
  await createNotification({
    userId,
    title: 'Thank You for Your Feedback! 💚',
    message: `We received your ${feedback.rating}-star review. Your suggestions help us improve My Money Manager for everyone!`,
    category: 'feedback',
    type: 'success',
    relatedEntityType: 'feedback',
    relatedEntityId: feedback.id,
    deepLink: 'help:feedback',
    channels: ['in_app'],
  });
}

/**
 * Triggered when a complaint / support ticket is submitted
 */
export async function notifyComplaintSubmitted(
  userId: string,
  ticket: { id: string; subject: string; category?: string }
) {
  const shortId = ticket.id.slice(0, 8);
  await createNotification({
    userId,
    title: `Ticket Raised #${shortId}`,
    message: `Your complaint "${ticket.subject}" has been received. Our team will review and reply within 24-48 hours.`,
    category: 'complaint',
    type: 'info',
    relatedEntityType: 'support_ticket',
    relatedEntityId: ticket.id,
    deepLink: `help:ticket:${ticket.id}`,
    channels: ['in_app', 'email'],
  });
}

/**
 * Triggered when an admin replies to a support ticket
 */
export async function notifyAdminTicketReply(
  userId: string,
  ticket: { id: string; subject: string; replyText: string; adminName?: string }
) {
  const shortId = ticket.id.slice(0, 8);
  await createNotification({
    userId,
    title: `New Reply on Ticket #${shortId}`,
    message: `${ticket.adminName || 'Support Team'}: "${ticket.replyText.slice(0, 100)}${ticket.replyText.length > 100 ? '...' : ''}"`,
    category: 'support',
    type: 'info',
    relatedEntityType: 'support_ticket',
    relatedEntityId: ticket.id,
    deepLink: `help:ticket:${ticket.id}`,
    channels: ['in_app', 'push', 'email'],
    skipPreferenceCheck: true, // Support responses are vital communications
  });
}

// -------------------------------------------------------------
// Admin Campaign Dispatcher & Scheduler
// -------------------------------------------------------------

/**
 * Dispatches an admin notification campaign across selected channels
 */
export async function dispatchCampaign(campaignId: string): Promise<{
  success: boolean;
  totalTargets: number;
  deliveredCount: number;
  failedCount: number;
}> {
  const cRes = await query(`SELECT * FROM public.notification_campaigns WHERE id = $1`, [campaignId]);
  if (cRes.rows.length === 0) {
    throw new Error('Campaign not found');
  }

  const campaign = cRes.rows[0];
  await query(
    `UPDATE public.notification_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1`,
    [campaignId]
  );

  // Determine target users
  let userIds: string[] = [];

  if (campaign.target_type === 'all') {
    const allUsers = await query(`SELECT id FROM public.app_users`);
    userIds = allUsers.rows.map((r) => r.id);
  } else if (campaign.target_type === 'active') {
    const activeUsers = await query(
      `SELECT DISTINCT user_id as id FROM public.transactions 
       WHERE created_at > NOW() - INTERVAL '30 days'`
    );
    userIds = activeUsers.rows.map((r) => r.id);
  } else if (campaign.target_type === 'selected' && Array.isArray(campaign.target_user_ids)) {
    userIds = campaign.target_user_ids;
  }

  let deliveredCount = 0;
  let failedCount = 0;

  for (const uid of userIds) {
    try {
      const res = await createNotification({
        userId: uid,
        title: campaign.title,
        message: campaign.message,
        category: campaign.category,
        type: campaign.type,
        deepLink: campaign.deepLink || undefined,
        channels: campaign.channels,
        campaignId: campaign.id,
      });

      if (res.success) {
        deliveredCount++;
      } else {
        failedCount++;
      }
    } catch {
      failedCount++;
    }
  }

  // Also reflect in public.notifications so existing legacy banners show it
  if (campaign.channels.includes('in_app')) {
    await query(
      `INSERT INTO public.notifications (title, message, type, target_user_id, is_active, created_by)
       VALUES ($1, $2, $3, $4, TRUE, $5)`,
      [
        campaign.title,
        campaign.message,
        campaign.type,
        campaign.target_type === 'all' ? 'all' : userIds[0] || 'all',
        campaign.created_by || null,
      ]
    ).catch(() => {});
  }

  await query(
    `UPDATE public.notification_campaigns 
     SET status = 'sent', total_targets = $1, delivered_count = $2, failed_count = $3, sent_at = NOW(), updated_at = NOW() 
     WHERE id = $4`,
    [userIds.length, deliveredCount, failedCount, campaignId]
  );

  return {
    success: true,
    totalTargets: userIds.length,
    deliveredCount,
    failedCount,
  };
}

/**
 * Checks and processes scheduled campaigns that reached their send time
 */
export async function processScheduledCampaigns(): Promise<number> {
  const pending = await query(
    `SELECT id FROM public.notification_campaigns 
     WHERE status = 'scheduled' AND scheduled_for <= NOW()`
  );

  let processed = 0;
  for (const c of pending.rows) {
    try {
      await dispatchCampaign(c.id);
      processed++;
    } catch (e) {
      console.error('[NotificationService] Error executing scheduled campaign:', e);
    }
  }
  return processed;
}
