import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import * as webpushModule from 'web-push';
import { query, isDatabaseConfigured } from './db';
import { APP_CONFIG } from './config';
import { sendEmail } from './email';
import { generateCampaignEmail } from './notificationEmailTemplates';
import { detectPlatformCompatibility, isValidPushEndpoint } from '../src/lib/pwaUtils';

const webpush = (webpushModule as any).default || webpushModule;

// Initialize web-push VAPID details (private key stays strictly server-side)
try {
  if (APP_CONFIG.vapid.publicKey && APP_CONFIG.vapid.privateKey) {
    webpush.setVapidDetails(
      APP_CONFIG.vapid.subject,
      APP_CONFIG.vapid.publicKey,
      APP_CONFIG.vapid.privateKey
    );
  }
} catch (e) {
  console.warn('[Push] Error configuring VAPID:', e);
}

export type NotificationCategory =
  | 'general'
  | 'income'
  | 'expense'
  | 'budget'
  | 'bill'
  | 'anomaly'
  | 'low_balance'
  | 'savings'
  | 'receipt'
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
  dedupeKey?: string;
  tag?: string;
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
  notify_budget: boolean;
  notify_bills: boolean;
  notify_udhar: boolean;
  notify_savings: boolean;
  notify_receipts: boolean;
  notify_security: boolean;
  notify_support: boolean;
  notify_announcements: boolean;
  notify_offers: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  /** Default true: hide sensitive rupee amounts from lock-screen push previews unless user opts in */
  privacy_hide_amounts: boolean;
}

export interface StoredPushSubscription {
  id: string;
  user_id: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  user_agent: string | null;
  device_name: string;
  browser: string;
  os: string;
  is_active: boolean;
  failure_count: number;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface SafePushSubscriptionView {
  id: string;
  device_name: string;
  browser: string;
  os: string;
  endpoint_preview: string;
  endpoint_hash: string;
  is_active: boolean;
  last_used_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface DeliveryLogRecord {
  id: string;
  notification_id: string | null;
  channel: 'in_app' | 'push' | 'email';
  status: 'sent' | 'failed' | 'suppressed';
  error_message: string | null;
  created_at: string;
}

interface LocalUserPushStore {
  preferences: UserPreferences;
  subscriptions: StoredPushSubscription[];
  dedupeKeys: Record<string, number>;
  deliveryLogs: DeliveryLogRecord[];
}

const DEFAULT_PREFERENCES: UserPreferences = {
  in_app_enabled: true,
  push_enabled: true,
  email_enabled: true,
  notify_income: true,
  notify_expense: true,
  notify_budget: true,
  notify_bills: true,
  notify_udhar: true,
  notify_savings: true,
  notify_receipts: true,
  notify_security: true,
  notify_support: true,
  notify_announcements: true,
  notify_offers: true,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  privacy_hide_amounts: true,
};

// Path-confined per-user fallback store when DATABASE_URL is absent (dev / sandbox)
const PUSH_FALLBACK_DIR = path.resolve(process.cwd(), '.data', 'push-notifications');

function safeUserPushFile(userId: string): string {
  const safeId = crypto.createHash('sha256').update(String(userId || 'unknown')).digest('hex');
  const resolved = path.resolve(PUSH_FALLBACK_DIR, `${safeId}.json`);
  if (!resolved.startsWith(PUSH_FALLBACK_DIR + path.sep)) {
    throw new Error('Invalid storage path');
  }
  return resolved;
}

function readLocalStore(userId: string): LocalUserPushStore {
  try {
    const file = safeUserPushFile(userId);
    if (fs.existsSync(file)) {
      const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
      return {
        preferences: { ...DEFAULT_PREFERENCES, ...(parsed.preferences || {}) },
        subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
        dedupeKeys: parsed.dedupeKeys && typeof parsed.dedupeKeys === 'object' ? parsed.dedupeKeys : {},
        deliveryLogs: Array.isArray(parsed.deliveryLogs) ? parsed.deliveryLogs : [],
      };
    }
  } catch {
    // Fallback to clean defaults
  }
  return {
    preferences: { ...DEFAULT_PREFERENCES },
    subscriptions: [],
    dedupeKeys: {},
    deliveryLogs: [],
  };
}

function writeLocalStore(userId: string, store: LocalUserPushStore): void {
  try {
    fs.mkdirSync(PUSH_FALLBACK_DIR, { recursive: true });
    // Prune stale dedupe keys older than 35 days and cap delivery logs to 50
    const cutoff = Date.now() - 35 * 24 * 60 * 60 * 1000;
    const prunedDedupe: Record<string, number> = {};
    for (const [k, ts] of Object.entries(store.dedupeKeys)) {
      if (typeof ts === 'number' && ts >= cutoff) {
        prunedDedupe[k] = ts;
      }
    }
    store.dedupeKeys = prunedDedupe;
    store.deliveryLogs = store.deliveryLogs.slice(0, 50);
    const file = safeUserPushFile(userId);
    fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Push] Local fallback write notice:', err);
  }
}

export function hashEndpoint(endpoint: string): string {
  return crypto.createHash('sha256').update(endpoint).digest('hex').slice(0, 24);
}

function formatEndpointPreview(endpoint: string): string {
  try {
    const parsed = new URL(endpoint);
    const tail = endpoint.slice(-10);
    return `${parsed.hostname}/…${tail}`;
  } catch {
    return 'push-endpoint';
  }
}

export function toSafeSubscriptionView(sub: StoredPushSubscription): SafePushSubscriptionView {
  return {
    id: sub.id,
    device_name: sub.device_name || `${sub.browser || 'Browser'} on ${sub.os || 'Device'}`,
    browser: sub.browser || 'Browser',
    os: sub.os || 'Device',
    endpoint_preview: formatEndpointPreview(sub.endpoint),
    endpoint_hash: hashEndpoint(sub.endpoint),
    is_active: sub.is_active !== false,
    last_used_at: sub.last_used_at || null,
    created_at: sub.created_at,
    updated_at: sub.updated_at,
  };
}

/**
 * Checks if current IST time falls in the user's quiet hours
 */
export function isCurrentTimeInQuietHours(
  startTime: string,
  endTime: string,
  nowDate: Date = new Date()
): boolean {
  try {
    // Convert to IST (UTC + 5:30)
    const istOffset = 5.5 * 60 * 60 * 1000;
    const istDate = new Date(nowDate.getTime() + istOffset);
    const curHour = istDate.getUTCHours();
    const curMin = istDate.getUTCMinutes();
    const curTotalMin = curHour * 60 + curMin;

    const [startH, startM] = startTime.split(':').map((n) => parseInt(n, 10));
    const [endH, endM] = endTime.split(':').map((n) => parseInt(n, 10));
    if (!Number.isFinite(startH) || !Number.isFinite(endH)) return false;
    const startTotalMin = startH * 60 + (Number.isFinite(startM) ? startM : 0);
    const endTotalMin = endH * 60 + (Number.isFinite(endM) ? endM : 0);

    if (startTotalMin <= endTotalMin) {
      return curTotalMin >= startTotalMin && curTotalMin < endTotalMin;
    }
    // Overnight (e.g. 22:00 to 07:00)
    return curTotalMin >= startTotalMin || curTotalMin < endTotalMin;
  } catch {
    return false;
  }
}

/**
 * Mask monetary values (₹500, ₹10,000, INR 2500) for lock-screen privacy mode
 */
export function maskFinancialData(text: string): string {
  return text.replace(/(?:₹|INR|Rs\.?|\$)\s*[0-9,]+(?:\.[0-9]+)?/gi, '₹••••');
}

/**
 * Normalize a deep link to a safe same-origin SPA URL
 */
export function buildSafeDeepLinkUrl(deepLink?: string): string {
  if (!deepLink || !deepLink.trim()) return '/';
  const clean = deepLink.trim();
  const pathRoutes = new Set([
    '/ai-assistant',
    '/expense-calendar',
    '/smart-alerts',
    '/receipt-scanner',
    '/net-worth',
    '/safe-to-spend',
  ]);
  if (pathRoutes.has(clean)) return clean;
  if (clean.startsWith('/#')) return clean;
  if (clean.startsWith('/')) {
    const slug = clean.replace(/^\/+/, '');
    return slug ? `/#${slug}` : '/';
  }
  return `/#${clean}`;
}

/**
 * Fetches user notification preferences or returns safe privacy-first defaults
 */
export async function getUserNotificationPreferences(userId: string): Promise<UserPreferences> {
  try {
    const res = await query(
      `SELECT * FROM public.user_notification_preferences WHERE user_id = $1`,
      [userId]
    );
    if (res.rows.length > 0) {
      return { ...DEFAULT_PREFERENCES, ...res.rows[0] };
    }
    await query(
      `INSERT INTO public.user_notification_preferences (user_id, privacy_hide_amounts)
       VALUES ($1, TRUE)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId]
    ).catch(() => {});
    return { ...DEFAULT_PREFERENCES };
  } catch {
    const local = readLocalStore(userId);
    return { ...DEFAULT_PREFERENCES, ...local.preferences };
  }
}

/**
 * Persists user notification preferences in PostgreSQL (with local fallback when DB unavailable)
 */
export async function updateUserNotificationPreferences(
  userId: string,
  patch: Partial<UserPreferences>
): Promise<UserPreferences> {
  const current = await getUserNotificationPreferences(userId);
  const next: UserPreferences = {
    in_app_enabled: patch.in_app_enabled !== undefined ? Boolean(patch.in_app_enabled) : current.in_app_enabled,
    push_enabled: patch.push_enabled !== undefined ? Boolean(patch.push_enabled) : current.push_enabled,
    email_enabled: patch.email_enabled !== undefined ? Boolean(patch.email_enabled) : current.email_enabled,
    notify_income: patch.notify_income !== undefined ? Boolean(patch.notify_income) : current.notify_income,
    notify_expense: patch.notify_expense !== undefined ? Boolean(patch.notify_expense) : current.notify_expense,
    notify_budget: patch.notify_budget !== undefined ? Boolean(patch.notify_budget) : current.notify_budget,
    notify_bills: patch.notify_bills !== undefined ? Boolean(patch.notify_bills) : current.notify_bills,
    notify_udhar: patch.notify_udhar !== undefined ? Boolean(patch.notify_udhar) : current.notify_udhar,
    notify_savings: patch.notify_savings !== undefined ? Boolean(patch.notify_savings) : current.notify_savings,
    notify_receipts: patch.notify_receipts !== undefined ? Boolean(patch.notify_receipts) : current.notify_receipts,
    notify_security: patch.notify_security !== undefined ? Boolean(patch.notify_security) : current.notify_security,
    notify_support: patch.notify_support !== undefined ? Boolean(patch.notify_support) : current.notify_support,
    notify_announcements:
      patch.notify_announcements !== undefined ? Boolean(patch.notify_announcements) : current.notify_announcements,
    notify_offers: patch.notify_offers !== undefined ? Boolean(patch.notify_offers) : current.notify_offers,
    quiet_hours_enabled:
      patch.quiet_hours_enabled !== undefined ? Boolean(patch.quiet_hours_enabled) : current.quiet_hours_enabled,
    quiet_hours_start:
      typeof patch.quiet_hours_start === 'string' && /^\d{2}:\d{2}$/.test(patch.quiet_hours_start.trim())
        ? patch.quiet_hours_start.trim()
        : current.quiet_hours_start,
    quiet_hours_end:
      typeof patch.quiet_hours_end === 'string' && /^\d{2}:\d{2}$/.test(patch.quiet_hours_end.trim())
        ? patch.quiet_hours_end.trim()
        : current.quiet_hours_end,
    privacy_hide_amounts:
      patch.privacy_hide_amounts !== undefined ? Boolean(patch.privacy_hide_amounts) : current.privacy_hide_amounts,
  };

  // Persist to PostgreSQL (try extended columns first, gracefully fall back to legacy columns if migration not run yet)
  try {
    const upRes = await query(
      `INSERT INTO public.user_notification_preferences (
        user_id, in_app_enabled, push_enabled, email_enabled,
        notify_income, notify_expense, notify_budget, notify_bills,
        notify_udhar, notify_savings, notify_receipts, notify_security,
        notify_support, notify_announcements, notify_offers,
        quiet_hours_enabled, quiet_hours_start, quiet_hours_end, privacy_hide_amounts,
        updated_at
      ) VALUES (
        $1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19, NOW()
      )
      ON CONFLICT (user_id) DO UPDATE SET
        in_app_enabled = EXCLUDED.in_app_enabled,
        push_enabled = EXCLUDED.push_enabled,
        email_enabled = EXCLUDED.email_enabled,
        notify_income = EXCLUDED.notify_income,
        notify_expense = EXCLUDED.notify_expense,
        notify_budget = EXCLUDED.notify_budget,
        notify_bills = EXCLUDED.notify_bills,
        notify_udhar = EXCLUDED.notify_udhar,
        notify_savings = EXCLUDED.notify_savings,
        notify_receipts = EXCLUDED.notify_receipts,
        notify_security = EXCLUDED.notify_security,
        notify_support = EXCLUDED.notify_support,
        notify_announcements = EXCLUDED.notify_announcements,
        notify_offers = EXCLUDED.notify_offers,
        quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
        quiet_hours_start = EXCLUDED.quiet_hours_start,
        quiet_hours_end = EXCLUDED.quiet_hours_end,
        privacy_hide_amounts = EXCLUDED.privacy_hide_amounts,
        updated_at = NOW()
      RETURNING *`,
      [
        userId,
        next.in_app_enabled,
        next.push_enabled,
        next.email_enabled,
        next.notify_income,
        next.notify_expense,
        next.notify_budget,
        next.notify_bills,
        next.notify_udhar,
        next.notify_savings,
        next.notify_receipts,
        next.notify_security,
        next.notify_support,
        next.notify_announcements,
        next.notify_offers,
        next.quiet_hours_enabled,
        next.quiet_hours_start,
        next.quiet_hours_end,
        next.privacy_hide_amounts,
      ]
    );
    if (upRes.rows.length > 0) {
      return { ...next, ...upRes.rows[0] };
    }
  } catch {
    // Fallback to legacy schema columns if extended columns are not yet migrated, else local store
    try {
      await query(
        `INSERT INTO public.user_notification_preferences (
          user_id, in_app_enabled, push_enabled, email_enabled,
          notify_income, notify_expense, notify_udhar, notify_support,
          notify_announcements, notify_offers,
          quiet_hours_enabled, quiet_hours_start, quiet_hours_end, privacy_hide_amounts,
          updated_at
        ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
        ON CONFLICT (user_id) DO UPDATE SET
          in_app_enabled = EXCLUDED.in_app_enabled,
          push_enabled = EXCLUDED.push_enabled,
          email_enabled = EXCLUDED.email_enabled,
          notify_income = EXCLUDED.notify_income,
          notify_expense = EXCLUDED.notify_expense,
          notify_udhar = EXCLUDED.notify_udhar,
          notify_support = EXCLUDED.notify_support,
          notify_announcements = EXCLUDED.notify_announcements,
          notify_offers = EXCLUDED.notify_offers,
          quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
          quiet_hours_start = EXCLUDED.quiet_hours_start,
          quiet_hours_end = EXCLUDED.quiet_hours_end,
          privacy_hide_amounts = EXCLUDED.privacy_hide_amounts,
          updated_at = NOW()`,
        [
          userId,
          next.in_app_enabled,
          next.push_enabled,
          next.email_enabled,
          next.notify_income,
          next.notify_expense,
          next.notify_udhar,
          next.notify_support,
          next.notify_announcements,
          next.notify_offers,
          next.quiet_hours_enabled,
          next.quiet_hours_start,
          next.quiet_hours_end,
          next.privacy_hide_amounts,
        ]
      );
    } catch {
      // Persist to local store below
    }
  }

  const local = readLocalStore(userId);
  local.preferences = next;
  writeLocalStore(userId, local);
  return next;
}

/**
 * Registers or updates a Web Push subscription for an authenticated user (supports multiple devices).
 */
export async function registerPushSubscription(params: {
  userId: string;
  endpoint: string;
  p256dh: string;
  auth: string;
  userAgent?: string | null;
  deviceName?: string | null;
}): Promise<{ success: boolean; subscription?: SafePushSubscriptionView; error?: string }> {
  const endpoint = (params.endpoint || '').trim();
  const p256dh = (params.p256dh || '').trim();
  const auth = (params.auth || '').trim();

  if (!isValidPushEndpoint(endpoint)) {
    return { success: false, error: 'Push endpoint must be a valid public HTTPS URL.' };
  }
  if (p256dh.length < 16 || p256dh.length > 512 || auth.length < 8 || auth.length > 256) {
    return { success: false, error: 'Invalid cryptographic push subscription keys.' };
  }

  const ua = (params.userAgent || '').slice(0, 500);
  const compat = detectPlatformCompatibility(ua);
  const deviceName = (params.deviceName || compat.deviceLabel || 'Web Device').trim().slice(0, 120);
  const nowIso = new Date().toISOString();

  try {
    const res = await query(
      `INSERT INTO public.push_subscriptions
         (user_id, endpoint, p256dh, auth, user_agent, device_name, browser, os, is_active, failure_count, last_used_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, TRUE, 0, NOW(), NOW())
       ON CONFLICT (endpoint) DO UPDATE SET
         user_id = EXCLUDED.user_id,
         p256dh = EXCLUDED.p256dh,
         auth = EXCLUDED.auth,
         user_agent = EXCLUDED.user_agent,
         device_name = EXCLUDED.device_name,
         browser = EXCLUDED.browser,
         os = EXCLUDED.os,
         is_active = TRUE,
         failure_count = 0,
         last_used_at = NOW(),
         updated_at = NOW()
       RETURNING *`,
      [params.userId, endpoint, p256dh, auth, ua || null, deviceName, compat.browserLabel, compat.osLabel]
    );
    if (res.rows.length > 0) {
      return { success: true, subscription: toSafeSubscriptionView(res.rows[0]) };
    }
  } catch {
    // Try legacy table columns if migration hasn't added device_name/browser/os yet
    try {
      const legacy = await query(
        `INSERT INTO public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent, updated_at)
         VALUES ($1, $2, $3, $4, $5, NOW())
         ON CONFLICT (endpoint) DO UPDATE SET
           user_id = EXCLUDED.user_id,
           p256dh = EXCLUDED.p256dh,
           auth = EXCLUDED.auth,
           user_agent = EXCLUDED.user_agent,
           updated_at = NOW()
         RETURNING *`,
        [params.userId, endpoint, p256dh, auth, ua || null]
      );
      if (legacy.rows.length > 0) {
        const row = legacy.rows[0];
        return {
          success: true,
          subscription: toSafeSubscriptionView({
            ...row,
            device_name: deviceName,
            browser: compat.browserLabel,
            os: compat.osLabel,
            is_active: true,
            failure_count: 0,
            last_used_at: nowIso,
          }),
        };
      }
    } catch {
      // Fallback to local per-user storage in sandbox/offline-DB environments
    }
  }

  const local = readLocalStore(params.userId);
  const existingIdx = local.subscriptions.findIndex((s) => s.endpoint === endpoint);
  const record: StoredPushSubscription = {
    id: existingIdx >= 0 ? local.subscriptions[existingIdx].id : crypto.randomUUID(),
    user_id: params.userId,
    endpoint,
    p256dh,
    auth,
    user_agent: ua || null,
    device_name: deviceName,
    browser: compat.browserLabel,
    os: compat.osLabel,
    is_active: true,
    failure_count: 0,
    last_used_at: nowIso,
    created_at: existingIdx >= 0 ? local.subscriptions[existingIdx].created_at : nowIso,
    updated_at: nowIso,
  };

  if (existingIdx >= 0) {
    local.subscriptions[existingIdx] = record;
  } else {
    local.subscriptions.unshift(record);
  }
  writeLocalStore(params.userId, local);

  return { success: true, subscription: toSafeSubscriptionView(record) };
}

/**
 * Lists all active push subscriptions strictly owned by `userId`.
 */
export async function listUserPushSubscriptions(userId: string): Promise<SafePushSubscriptionView[]> {
  const raw = await getRawUserPushSubscriptions(userId);
  return raw.map(toSafeSubscriptionView);
}

async function getRawUserPushSubscriptions(userId: string): Promise<StoredPushSubscription[]> {
  try {
    const res = await query(
      `SELECT * FROM public.push_subscriptions WHERE user_id = $1 ORDER BY updated_at DESC`,
      [userId]
    );
    return res.rows.map((row: any) => {
      const compat = detectPlatformCompatibility(row.user_agent || '');
      return {
        id: String(row.id),
        user_id: String(row.user_id),
        endpoint: String(row.endpoint),
        p256dh: String(row.p256dh),
        auth: String(row.auth),
        user_agent: row.user_agent || null,
        device_name: row.device_name || compat.deviceLabel,
        browser: row.browser || compat.browserLabel,
        os: row.os || compat.osLabel,
        is_active: row.is_active !== false,
        failure_count: Number(row.failure_count) || 0,
        last_used_at: row.last_used_at || null,
        created_at: row.created_at || new Date().toISOString(),
        updated_at: row.updated_at || new Date().toISOString(),
      };
    });
  } catch {
    return readLocalStore(userId).subscriptions.filter((s) => s.user_id === userId && s.is_active !== false);
  }
}

/**
 * Removes a push subscription by endpoint strictly owned by `userId`.
 */
export async function removePushSubscriptionByEndpoint(
  userId: string,
  endpoint: string
): Promise<{ deleted: boolean }> {
  const cleanEndpoint = (endpoint || '').trim();
  if (!cleanEndpoint) return { deleted: false };

  let deletedFromDb = false;
  try {
    const res = await query(
      `DELETE FROM public.push_subscriptions WHERE user_id = $1 AND endpoint = $2 RETURNING id`,
      [userId, cleanEndpoint]
    );
    deletedFromDb = res.rows.length > 0;
  } catch {
    // Fallback below
  }

  const local = readLocalStore(userId);
  const before = local.subscriptions.length;
  local.subscriptions = local.subscriptions.filter((s) => s.endpoint !== cleanEndpoint);
  const deletedFromLocal = local.subscriptions.length < before;
  if (deletedFromLocal) {
    writeLocalStore(userId, local);
  }

  return { deleted: deletedFromDb || deletedFromLocal };
}

/**
 * Removes a specific device push subscription by ID strictly owned by `userId` (anti-IDOR).
 */
export async function removePushSubscriptionById(
  userId: string,
  subscriptionId: string
): Promise<{ deleted: boolean }> {
  const cleanId = (subscriptionId || '').trim();
  if (!cleanId) return { deleted: false };

  let deletedFromDb = false;
  try {
    const res = await query(
      `DELETE FROM public.push_subscriptions WHERE id = $1 AND user_id = $2 RETURNING id`,
      [cleanId, userId]
    );
    deletedFromDb = res.rows.length > 0;
  } catch {
    // Fallback below
  }

  const local = readLocalStore(userId);
  const before = local.subscriptions.length;
  local.subscriptions = local.subscriptions.filter(
    (s) => !(s.id === cleanId && s.user_id === userId)
  );
  const deletedFromLocal = local.subscriptions.length < before;
  if (deletedFromLocal) {
    writeLocalStore(userId, local);
  }

  return { deleted: deletedFromDb || deletedFromLocal };
}

/**
 * Returns real push infrastructure readiness & recent delivery status for the user.
 */
export async function getPushDeliveryStatus(userId: string): Promise<{
  vapidConfigured: boolean;
  vapidPersistent: boolean;
  activeDeviceCount: number;
  recentDeliveryLogs: DeliveryLogRecord[];
}> {
  const devices = await listUserPushSubscriptions(userId);
  let logs: DeliveryLogRecord[] = [];
  try {
    const res = await query(
      `SELECT id, notification_id, channel, status, error_message, created_at
       FROM public.notification_delivery_logs
       WHERE user_id = $1 AND channel = 'push'
       ORDER BY created_at DESC
       LIMIT 10`,
      [userId]
    );
    logs = res.rows;
  } catch {
    logs = readLocalStore(userId).deliveryLogs.filter((l) => l.channel === 'push').slice(0, 10);
  }

  return {
    vapidConfigured: Boolean(APP_CONFIG.vapid.publicKey && APP_CONFIG.vapid.privateKey),
    vapidPersistent: APP_CONFIG.vapid.isPersistent,
    activeDeviceCount: devices.length,
    recentDeliveryLogs: logs,
  };
}

/**
 * Check if category is enabled in user preferences
 */
export function isCategoryEnabled(prefs: UserPreferences, category: NotificationCategory): boolean {
  switch (category) {
    case 'income':
      return prefs.notify_income;
    case 'expense':
      return prefs.notify_expense;
    case 'budget':
    case 'anomaly':
    case 'low_balance':
      return prefs.notify_budget;
    case 'bill':
      return prefs.notify_bills;
    case 'savings':
      return prefs.notify_savings;
    case 'receipt':
      return prefs.notify_receipts;
    case 'udhar':
    case 'repay':
    case 'settlement':
      return prefs.notify_udhar;
    case 'security':
      return prefs.notify_security;
    case 'feedback':
    case 'complaint':
    case 'support':
      return prefs.notify_support;
    case 'announcement':
      return prefs.notify_announcements;
    case 'offer':
      return prefs.notify_offers;
    case 'system':
    case 'general':
    default:
      return true;
  }
}

/**
 * Checks whether an event with `dedupeKey` was already processed for this user.
 */
async function hasDuplicateEvent(userId: string, dedupeKey?: string): Promise<boolean> {
  if (!dedupeKey) return false;
  try {
    const res = await query(
      `SELECT id FROM public.user_notifications
       WHERE user_id = $1 AND (dedupe_key = $2 OR metadata->>'dedupeKey' = $2)
       LIMIT 1`,
      [userId, dedupeKey]
    );
    if (res.rows.length > 0) return true;
  } catch {
    // Check local fallback below
  }
  const local = readLocalStore(userId);
  return Boolean(local.dedupeKeys[dedupeKey]);
}

function recordLocalDedupeKey(userId: string, dedupeKey?: string): void {
  if (!dedupeKey) return;
  const local = readLocalStore(userId);
  local.dedupeKeys[dedupeKey] = Date.now();
  writeLocalStore(userId, local);
}

function appendLocalDeliveryLog(userId: string, log: Omit<DeliveryLogRecord, 'id' | 'created_at'>): void {
  const local = readLocalStore(userId);
  local.deliveryLogs.unshift({
    id: crypto.randomUUID(),
    ...log,
    created_at: new Date().toISOString(),
  });
  writeLocalStore(userId, local);
}

/**
 * Create a multi-channel notification for a user with deduplication, quiet hours,
 * lock-screen privacy masking, and real Web Push delivery across all active devices.
 */
export async function createNotification(params: CreateNotificationParams): Promise<{
  success: boolean;
  deduplicated?: boolean;
  notificationId?: string;
  inAppDelivered: boolean;
  pushDelivered: number;
  pushFailed: number;
  deviceCount: number;
  suppressedByQuietHours?: boolean;
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
    dedupeKey,
    tag,
    metadata = {},
    channels = ['in_app', 'push'],
    skipPreferenceCheck = false,
    emailOptions,
    campaignId,
  } = params;

  // Deduplication guard: never send duplicate notifications for the same event
  if (dedupeKey && (await hasDuplicateEvent(userId, dedupeKey))) {
    return {
      success: true,
      deduplicated: true,
      inAppDelivered: false,
      pushDelivered: 0,
      pushFailed: 0,
      deviceCount: 0,
      emailDelivered: false,
    };
  }

  let inAppDelivered = false;
  let pushDelivered = 0;
  let pushFailed = 0;
  let deviceCount = 0;
  let emailDelivered = false;
  let notificationId: string | undefined;

  const prefs = await getUserNotificationPreferences(userId);
  const categoryAllowed = skipPreferenceCheck || isCategoryEnabled(prefs, category);
  // Security alerts can bypass quiet hours if critical
  const inQuietHours =
    !skipPreferenceCheck &&
    category !== 'security' &&
    prefs.quiet_hours_enabled &&
    isCurrentTimeInQuietHours(prefs.quiet_hours_start, prefs.quiet_hours_end);

  const enrichedMetadata = dedupeKey ? { ...metadata, dedupeKey } : metadata;

  // 1. IN-APP NOTIFICATION
  if (channels.includes('in_app') && (skipPreferenceCheck || (prefs.in_app_enabled && categoryAllowed))) {
    try {
      let insRes;
      try {
        insRes = await query(
          `INSERT INTO public.user_notifications
           (user_id, title, message, category, type, related_entity_type, related_entity_id, deep_link, dedupe_key, metadata)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10)
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
            dedupeKey || null,
            JSON.stringify(enrichedMetadata),
          ]
        );
      } catch {
        // Legacy table fallback without dedupe_key column
        insRes = await query(
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
            JSON.stringify(enrichedMetadata),
          ]
        );
      }
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
    } catch {
      // Do not log sensitive financial content
      appendLocalDeliveryLog(userId, {
        notification_id: null,
        channel: 'in_app',
        status: 'failed',
        error_message: 'Database unavailable for in-app storage',
      });
    }
  }

  // 2. REAL WEB PUSH NOTIFICATION (Delivered to all active user devices via Web Push VAPID)
  if (channels.includes('push')) {
    const subs = await getRawUserPushSubscriptions(userId);
    deviceCount = subs.length;

    if (inQuietHours && subs.length > 0) {
      appendLocalDeliveryLog(userId, {
        notification_id: notificationId || null,
        channel: 'push',
        status: 'suppressed',
        error_message: 'Suppressed during quiet hours',
      });
    } else if (
      subs.length > 0 &&
      (skipPreferenceCheck || (prefs.push_enabled && categoryAllowed))
    ) {
      const pushTitle = prefs.privacy_hide_amounts ? maskFinancialData(title) : title;
      const pushBody = prefs.privacy_hide_amounts ? maskFinancialData(message) : message;
      const targetUrl = buildSafeDeepLinkUrl(deepLink);
      const notifTag = tag || (dedupeKey ? `mm-${dedupeKey.slice(0, 80)}` : `mm-${category}`);
      const timestamp = Date.now();

      const pushPayload = JSON.stringify({
        title: pushTitle,
        body: pushBody,
        icon: '/icon-192.png',
        badge: '/icon-192.png',
        tag: notifTag,
        category,
        timestamp,
        requireInteraction: category === 'security' || type === 'error',
        data: {
          url: targetUrl,
          notificationId: notificationId || null,
          category,
          dedupeKey: dedupeKey || null,
          timestamp,
        },
      });

      for (const sub of subs) {
        try {
          await webpush.sendNotification(
            {
              endpoint: sub.endpoint,
              keys: {
                p256dh: sub.p256dh,
                auth: sub.auth,
              },
            },
            pushPayload,
            { TTL: 60 * 60 * 12 } // 12 hours TTL
          );
          pushDelivered++;

          await query(
            `UPDATE public.push_subscriptions SET last_used_at = NOW(), failure_count = 0 WHERE id = $1`,
            [sub.id]
          ).catch(() => {});

          await query(
            `INSERT INTO public.notification_delivery_logs
             (campaign_id, notification_id, user_id, channel, status)
             VALUES ($1, $2, $3, 'push', 'sent')`,
            [campaignId || null, notificationId || null, userId]
          ).catch(() => {
            appendLocalDeliveryLog(userId, {
              notification_id: notificationId || null,
              channel: 'push',
              status: 'sent',
              error_message: null,
            });
          });
        } catch (pushErr: any) {
          pushFailed++;
          const statusCode = Number(pushErr?.statusCode) || 0;
          const safeError = statusCode ? `Web Push HTTP ${statusCode}` : 'Web Push delivery error';

          // Automatically clean up expired or invalid subscriptions (404 Not Found / 410 Gone)
          if (statusCode === 404 || statusCode === 410) {
            await removePushSubscriptionById(userId, sub.id);
          } else {
            await query(
              `UPDATE public.push_subscriptions SET failure_count = COALESCE(failure_count, 0) + 1 WHERE id = $1`,
              [sub.id]
            ).catch(() => {});
          }

          await query(
            `INSERT INTO public.notification_delivery_logs
             (campaign_id, notification_id, user_id, channel, status, error_message)
             VALUES ($1, $2, $3, 'push', 'failed', $4)`,
            [campaignId || null, notificationId || null, userId, safeError]
          ).catch(() => {
            appendLocalDeliveryLog(userId, {
              notification_id: notificationId || null,
              channel: 'push',
              status: 'failed',
              error_message: safeError,
            });
          });
        }
      }
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
        const subject = emailOptions?.subject || title;
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
        }
      }
    } catch {
      // Do not log sensitive email content
    }
  }

  if (dedupeKey) {
    recordLocalDedupeKey(userId, dedupeKey);
  }

  return {
    success: inAppDelivered || pushDelivered > 0 || emailDelivered || inQuietHours,
    notificationId,
    inAppDelivered,
    pushDelivered,
    pushFailed,
    deviceCount,
    suppressedByQuietHours: inQuietHours || undefined,
    emailDelivered,
  };
}

// -------------------------------------------------------------
// Specialized Automated Trigger Helpers
// -------------------------------------------------------------

/**
 * Triggered when a new income/expense transaction is saved
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

  const title = isIncome ? 'Income Saved' : 'Transaction Saved';
  const message = isIncome
    ? `Your income of ${formattedAmount} for "${tx.title}" has been recorded.`
    : `Your expense of ${formattedAmount} for "${tx.title}" has been recorded.`;

  const deepLink = tx.section ? tx.section.toLowerCase() : 'all_transactions';

  return createNotification({
    userId,
    title,
    message,
    category,
    type: isIncome ? 'success' : 'info',
    relatedEntityType: 'transaction',
    relatedEntityId: tx.id,
    deepLink,
    dedupeKey: `tx:${tx.id}`,
    tag: `tx-${tx.id}`,
    channels: ['in_app', 'push'],
    metadata: { type: tx.type, section: tx.section },
  });
}

/**
 * Triggered for financial intelligence alerts (budget thresholds, anomalies, recurring bills,
 * low available balance, savings goal milestones, Udhar reminders, receipt confirmations, security alerts)
 */
export async function notifyFinancialAlert(params: {
  userId: string;
  title: string;
  message: string;
  category:
    | 'budget'
    | 'bill'
    | 'anomaly'
    | 'low_balance'
    | 'savings'
    | 'udhar'
    | 'receipt'
    | 'security';
  severity?: 'info' | 'warning' | 'critical' | 'success';
  deepLink?: string;
  dedupeKey: string;
  relatedEntityId?: string;
}) {
  const typeMap: Record<string, NotificationType> = {
    critical: 'error',
    warning: 'warning',
    success: 'success',
    info: 'info',
  };

  const defaultDeepLinks: Record<string, string> = {
    budget: 'budget',
    bill: 'recurring_bills',
    anomaly: '/smart-alerts',
    low_balance: '/safe-to-spend',
    savings: 'savings_goals',
    udhar: 'people',
    receipt: '/receipt-scanner',
    security: 'settings',
  };

  return createNotification({
    userId: params.userId,
    title: params.title.slice(0, 140),
    message: params.message.slice(0, 320),
    category: params.category,
    type: typeMap[params.severity || 'info'] || 'info',
    relatedEntityType: params.category,
    relatedEntityId: params.relatedEntityId,
    deepLink: params.deepLink || defaultDeepLinks[params.category] || '/smart-alerts',
    dedupeKey: params.dedupeKey,
    tag: `alert-${params.dedupeKey.slice(0, 70)}`,
    channels: ['in_app', 'push'],
  });
}

/**
 * Triggered on critical account security events (password changed, all sessions revoked, etc.)
 */
export async function notifySecurityAlert(params: {
  userId: string;
  title: string;
  message: string;
  dedupeKey?: string;
}) {
  return createNotification({
    userId: params.userId,
    title: params.title,
    message: params.message,
    category: 'security',
    type: 'warning',
    deepLink: 'settings',
    dedupeKey: params.dedupeKey,
    tag: `security-${Date.now()}`,
    channels: ['in_app', 'push'],
  });
}

/**
 * Triggered when a new Udhar transaction is created
 */
export async function notifyUdharCreated(params: {
  initiatorUserId: string;
  initiatorName?: string;
  recipientUserId?: string | null;
  transactionId: string;
  contactName: string;
  amount: number;
  direction: 'given' | 'taken' | 'gave' | 'took';
  dueDate?: string | null;
}) {
  const formattedAmount = `₹${Number(params.amount).toLocaleString('en-IN')}`;
  const isGiven = params.direction === 'given' || params.direction === 'gave';
  const initiatorDisplayName = params.initiatorName || 'Friend';

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
    dedupeKey: `udhar-init:${params.transactionId}`,
    channels: ['in_app', 'push'],
  });

  if (params.recipientUserId) {
    await createNotification({
      userId: params.recipientUserId,
      title: isGiven ? `Udhar Recorded: ${formattedAmount}` : `Payment Recorded: ${formattedAmount}`,
      message: isGiven
        ? `You borrowed ${formattedAmount} from ${initiatorDisplayName}. View your Udhar ledger.`
        : `You lent ${formattedAmount} to ${initiatorDisplayName}. View your Udhar ledger.`,
      category: 'udhar',
      type: 'info',
      relatedEntityType: 'udhar_transaction',
      relatedEntityId: params.transactionId,
      deepLink: 'people',
      dedupeKey: `udhar-recip:${params.transactionId}`,
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
  await createNotification({
    userId: params.userAId,
    title: `Connected with ${params.userBName}`,
    message: `You are now linked with ${params.userBName}. Mutual 2-way Udhar tracking and settlements are active.`,
    category: 'udhar',
    type: 'success',
    deepLink: 'people',
    channels: ['in_app', 'push'],
  });

  await createNotification({
    userId: params.userBId,
    title: `New Friend Connected: ${params.userAName}`,
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
  initiatorName?: string;
  recipientUserId?: string | null;
  repaymentId: string;
  contactName: string;
  repaymentAmount: number;
  remainingBalance: number;
  isFullySettled: boolean;
}) {
  const formattedRepayment = `₹${Number(params.repaymentAmount).toLocaleString('en-IN')}`;
  const formattedRemaining = `₹${Number(params.remainingBalance).toLocaleString('en-IN')}`;
  const initiatorDisplayName = params.initiatorName || 'Friend';

  if (params.isFullySettled) {
    const title = `Udhar Settled with ${params.contactName}`;
    const message = `Full repayment of ${formattedRepayment} completed. Remaining balance is ₹0.`;

    await createNotification({
      userId: params.initiatorUserId,
      title,
      message,
      category: 'settlement',
      type: 'success',
      relatedEntityType: 'udhar_repayment',
      relatedEntityId: params.repaymentId,
      deepLink: 'people',
      dedupeKey: `udhar-repay-init:${params.repaymentId}`,
      channels: ['in_app', 'push', 'email'],
    });

    await query(
      `UPDATE public.user_notifications
       SET is_read = TRUE, metadata = metadata || '{"settled": true}'::jsonb
       WHERE user_id = $1 AND category = 'udhar' AND related_entity_type = 'udhar_transaction'`,
      [params.initiatorUserId]
    ).catch(() => {});

    if (params.recipientUserId) {
      await createNotification({
        userId: params.recipientUserId,
        title: `Udhar Settled with ${initiatorDisplayName}`,
        message: `Your Udhar balance of ${formattedRepayment} with ${initiatorDisplayName} is fully settled (₹0 balance).`,
        category: 'settlement',
        type: 'success',
        relatedEntityType: 'udhar_repayment',
        relatedEntityId: params.repaymentId,
        deepLink: 'people',
        dedupeKey: `udhar-repay-recip:${params.repaymentId}`,
        channels: ['in_app', 'push', 'email'],
      });
    }
  } else {
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
      dedupeKey: `udhar-repay-init:${params.repaymentId}`,
      channels: ['in_app', 'push'],
    });

    if (params.recipientUserId) {
      await createNotification({
        userId: params.recipientUserId,
        title: `Payment Updated: ${formattedRepayment}`,
        message: `Repayment of ${formattedRepayment} logged by ${initiatorDisplayName}. Your remaining balance is ${formattedRemaining}.`,
        category: 'repay',
        type: 'info',
        relatedEntityType: 'udhar_repayment',
        relatedEntityId: params.repaymentId,
        deepLink: 'people',
        dedupeKey: `udhar-repay-recip:${params.repaymentId}`,
        channels: ['in_app', 'push'],
      });
    }
  }
}

/**
 * Triggered when a user submits feedback.
 * Sends in-app + push notification to the submitting user.
 */
export async function notifyFeedbackSubmitted(
  userId: string,
  feedback: { id: string; rating: number; category?: string }
) {
  await createNotification({
    userId,
    title: 'Thank You for Your Feedback',
    message: `We received your ${feedback.rating}-star review. Your suggestions help us improve My Money Manager!`,
    category: 'feedback',
    type: 'success',
    relatedEntityType: 'feedback',
    relatedEntityId: feedback.id,
    deepLink: 'help:feedback',
    channels: ['in_app', 'push'],
  });
}

/**
 * Triggered when any user submits feedback — notifies ALL admin users.
 * Sends in-app + push notification to each admin/superadmin.
 */
export async function notifyAdminNewFeedback(opts: {
  feedbackId: string;
  feedbackDbId: string;
  submitterName: string;
  submitterEmail: string;
  rating: number;
  category?: string;
  message: string;
}): Promise<void> {
  try {
    // Fetch all active admin and superadmin user IDs
    const adminsRes = await query(
      `SELECT id FROM public.app_users WHERE role IN ('admin', 'superadmin') AND status = 'active'`
    );

    if (adminsRes.rows.length === 0) return;

    const stars = '⭐'.repeat(Math.max(1, Math.min(5, opts.rating)));
    const shortMsg = opts.message.length > 80 ? opts.message.slice(0, 80) + '…' : opts.message;

    for (const admin of adminsRes.rows) {
      await createNotification({
        userId: admin.id,
        title: `New Feedback Received ${stars}`,
        message: `${opts.submitterName} (${opts.submitterEmail}) left a ${opts.rating}-star review in "${opts.category || 'General'}": "${shortMsg}"`,
        category: 'feedback',
        type: 'info',
        relatedEntityType: 'feedback',
        relatedEntityId: opts.feedbackDbId,
        deepLink: 'admin:feedback',
        channels: ['in_app', 'push'],
        skipPreferenceCheck: true, // Admin alerts are always delivered
      }).catch((e) =>
        console.warn(`[notifyAdminNewFeedback] Failed for admin ${admin.id}:`, e?.message)
      );
    }
  } catch (e: any) {
    console.warn('[notifyAdminNewFeedback] Error fetching admin list:', e?.message);
  }
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
    skipPreferenceCheck: true,
  });
}

// -------------------------------------------------------------
// Admin Campaign Dispatcher & Scheduler
// -------------------------------------------------------------

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

  let userIds: string[] = [];

  if (campaign.target_type === 'all') {
    const allUsers = await query(`SELECT id FROM public.app_users`);
    userIds = allUsers.rows.map((r) => r.id);
  } else if (campaign.target_type === 'installed') {
    const installedUsers = await query(
      `SELECT DISTINCT user_id as id FROM public.installed_devices WHERE is_installed = TRUE
       UNION
       SELECT DISTINCT user_id as id FROM public.push_subscriptions WHERE is_active = TRUE`
    );
    userIds = installedUsers.rows.map((r) => r.id);
  } else if (campaign.target_type === 'push_subscribed') {
    const pushUsers = await query(
      `SELECT DISTINCT user_id as id FROM public.push_subscriptions WHERE is_active = TRUE`
    );
    userIds = pushUsers.rows.map((r) => r.id);
  } else if (campaign.target_type === 'admins') {
    const adminUsers = await query(
      `SELECT id FROM public.app_users WHERE LOWER(role) IN ('superadmin', 'admin')`
    );
    userIds = adminUsers.rows.map((r) => r.id);
  } else if (campaign.target_type === 'specific' && (campaign.target_user_id || (campaign.target_user_ids && campaign.target_user_ids[0]))) {
    userIds = [campaign.target_user_id || campaign.target_user_ids[0]];
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
        dedupeKey: `campaign:${campaign.id}:${uid}`,
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

// ==============================================================================
// PWA Installed User & Device Registration
// ==============================================================================

export interface RecordDeviceInstallationParams {
  userId: string;
  deviceType?: string;
  browser?: string;
  os?: string;
  userAgent?: string;
  isInstalled?: boolean;
  installationStatus?: string;
  pushPermission?: string;
  pushSubscriptionStatus?: string;
  ipAddress?: string;
}

// In-memory fallback cache for resilience when PostgreSQL is offline or mocking
const localInstalledDevices = new Map<string, any>();

export async function recordDeviceInstallation(
  params: RecordDeviceInstallationParams
): Promise<{ success: boolean; isNewInstall: boolean; record: any }> {
  const {
    userId,
    deviceType = 'desktop',
    browser = 'Chrome',
    os = 'Unknown OS',
    userAgent = '',
    isInstalled = false,
    installationStatus = isInstalled ? 'installed_pwa' : 'browser',
    pushPermission = 'default',
    pushSubscriptionStatus = 'none',
    ipAddress = '',
  } = params;

  if (!userId) {
    throw new Error('userId is required for device installation registration');
  }

  let isNewInstall = false;
  const now = new Date();
  const installedAt = isInstalled ? now.toISOString() : null;

  if (isDatabaseConfigured) {
    try {
      // Check if device already exists to detect first-time PWA install
      const existing = await query(
        `SELECT id, is_installed, installed_at FROM public.installed_devices
         WHERE user_id = $1 AND browser = $2 AND os = $3 AND device_type = $4`,
        [userId, browser, os, deviceType]
      );

      if (existing.rows.length > 0) {
        const prev = existing.rows[0];
        if (!prev.is_installed && isInstalled) {
          isNewInstall = true;
        }

        const updateRes = await query(
          `UPDATE public.installed_devices
           SET 
             installation_status = $1,
             is_installed = $2,
             installed_at = COALESCE(installed_at, $3),
             last_active_at = NOW(),
             push_permission = $4,
             push_subscription_status = $5,
             user_agent = $6,
             ip_address = $7,
             updated_at = NOW()
           WHERE id = $8
           RETURNING *`,
          [
            installationStatus,
            isInstalled,
            installedAt,
            pushPermission,
            pushSubscriptionStatus,
            userAgent,
            ipAddress,
            prev.id,
          ]
        );

        const record = updateRes.rows[0];

        // If user newly installed PWA, notify administrators
        if (isNewInstall) {
          recordAdminNotification({
            eventType: 'pwa_install',
            title: 'PWA Installed by User',
            message: `User has installed My Money Manager on ${browser} (${os}, ${deviceType}).`,
            userId,
            metadata: { deviceType, browser, os, installedAt },
          }).catch(() => {});
        }

        return { success: true, isNewInstall, record };
      } else {
        if (isInstalled) {
          isNewInstall = true;
        }

        const insertRes = await query(
          `INSERT INTO public.installed_devices
           (user_id, device_type, browser, os, user_agent, installation_status, is_installed, installed_at, last_active_at, push_permission, push_subscription_status, ip_address)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, NOW(), $9, $10, $11)
           RETURNING *`,
          [
            userId,
            deviceType,
            browser,
            os,
            userAgent,
            installationStatus,
            isInstalled,
            installedAt,
            pushPermission,
            pushSubscriptionStatus,
            ipAddress,
          ]
        );

        const record = insertRes.rows[0];

        if (isNewInstall) {
          recordAdminNotification({
            eventType: 'pwa_install',
            title: 'PWA Installed by User',
            message: `User has installed My Money Manager on ${browser} (${os}, ${deviceType}).`,
            userId,
            metadata: { deviceType, browser, os, installedAt },
          }).catch(() => {});
        }

        return { success: true, isNewInstall, record };
      }
    } catch {
      // Fallback to in-memory below
    }
  }

  // In-memory fallback
    const key = `${userId}:${browser}:${os}:${deviceType}`;
    const prev = localInstalledDevices.get(key);
    if (!prev?.is_installed && isInstalled) {
      isNewInstall = true;
    }
    const record = {
      id: prev?.id || `dev_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      user_id: userId,
      device_type: deviceType,
      browser,
      os,
      user_agent: userAgent,
      installation_status: installationStatus,
      is_installed: isInstalled,
      installed_at: prev?.installed_at || (isInstalled ? now.toISOString() : null),
      last_active_at: now.toISOString(),
      push_permission: pushPermission,
      push_subscription_status: pushSubscriptionStatus,
      last_delivery_result: prev?.last_delivery_result || 'none',
    };
    localInstalledDevices.set(key, record);
    return { success: true, isNewInstall, record };
  }
}

export async function getAdminInstalledDevices(filters?: {
  search?: string;
  deviceType?: string;
  installedOnly?: boolean;
  pushPermission?: string;
}): Promise<any[]> {
  try {
    const res = await query(`
      SELECT 
        d.id,
        d.user_id,
        COALESCE(u.full_name, u.email, 'Anonymous User') as user_name,
        u.email as user_email,
        d.device_type,
        d.browser,
        d.os,
        d.installation_status,
        d.is_installed,
        d.installed_at,
        d.last_active_at,
        d.push_permission,
        d.push_subscription_status,
        d.last_delivery_result,
        d.created_at,
        d.updated_at
      FROM public.installed_devices d
      LEFT JOIN public.app_users u ON d.user_id = u.id
      ORDER BY d.last_active_at DESC
      LIMIT 200
    `);

    if (res.rows && res.rows.length > 0) {
      let rows = res.rows;
      if (filters?.installedOnly) {
        rows = rows.filter((r) => r.is_installed);
      }
      if (filters?.search) {
        const q = filters.search.toLowerCase();
        rows = rows.filter(
          (r) =>
            r.user_name?.toLowerCase().includes(q) ||
            r.user_email?.toLowerCase().includes(q) ||
            r.user_id?.toLowerCase().includes(q) ||
            r.browser?.toLowerCase().includes(q) ||
            r.os?.toLowerCase().includes(q)
        );
      }
      return rows;
    }
  } catch (err) {
    // If DB table not queried or empty, check in-memory devices
  }

  // Fallback to in-memory devices
  const list = Array.from(localInstalledDevices.values());
  return list;
}

// ==============================================================================
// Two-Way Notification System: User-to-Admin & Admin Preferences
// ==============================================================================

export interface AdminNotificationRecord {
  id: string;
  event_type: 'new_user' | 'pwa_install' | 'support_ticket' | 'critical_alert' | 'push_failure';
  title: string;
  message: string;
  user_id?: string;
  user_email?: string;
  metadata?: Record<string, any>;
  is_read: boolean;
  read_at?: string | null;
  created_at: string;
}

const localAdminNotifications: AdminNotificationRecord[] = [];
let localAdminPreferences = {
  alert_new_user_registration: true,
  alert_app_installation: true,
  alert_support_ticket: true,
  alert_critical_security: true,
  alert_push_failure: true,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  delivery_channel: 'push_and_inapp',
};

export async function recordAdminNotification(params: {
  eventType: 'new_user' | 'pwa_install' | 'support_ticket' | 'critical_alert' | 'push_failure';
  title: string;
  message: string;
  userId?: string;
  userEmail?: string;
  metadata?: Record<string, any>;
}): Promise<boolean> {
  const { eventType, title, message, userId, userEmail, metadata = {} } = params;

  try {
    await query(
      `INSERT INTO public.admin_notifications
       (event_type, title, message, user_id, user_email, metadata, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, NOW())`,
      [eventType, title, message, userId || null, userEmail || null, JSON.stringify(metadata)]
    );
  } catch {
    localAdminNotifications.unshift({
      id: `anot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
      event_type: eventType,
      title,
      message,
      user_id: userId,
      user_email: userEmail,
      metadata,
      is_read: false,
      created_at: new Date().toISOString(),
    });
  }

  // Check admin alert preference & quiet hours before dispatching live push to admins
  const prefs = await getAdminNotificationPreferences();
  const isAlertEnabled =
    (eventType === 'new_user' && prefs.alert_new_user_registration) ||
    (eventType === 'pwa_install' && prefs.alert_app_installation) ||
    (eventType === 'support_ticket' && prefs.alert_support_ticket) ||
    (eventType === 'critical_alert' && prefs.alert_critical_security) ||
    (eventType === 'push_failure' && prefs.alert_push_failure);

  if (!isAlertEnabled) {
    return true;
  }

  // Find all administrators
  try {
    const admins = await query(
      `SELECT id FROM public.app_users WHERE LOWER(role) IN ('superadmin', 'admin')`
    );
    for (const a of admins.rows) {
      createNotification({
        userId: a.id,
        title: `[Admin Alert] ${title}`,
        message,
        category: 'security',
        type: eventType === 'critical_alert' ? 'error' : 'info',
        channels: prefs.delivery_channel === 'inapp_only' ? ['in_app'] : ['in_app', 'push'],
        deepLink: 'admin',
        skipPreferenceCheck: true,
      }).catch(() => {});
    }
  } catch {}

  return true;
}

export async function getAdminNotifications(limit = 50): Promise<AdminNotificationRecord[]> {
  try {
    const res = await query(
      `SELECT * FROM public.admin_notifications
       ORDER BY created_at DESC
       LIMIT $1`,
      [limit]
    );
    if (res.rows && res.rows.length > 0) {
      return res.rows;
    }
  } catch {}
  return localAdminNotifications.slice(0, limit);
}

export async function markAdminNotificationRead(id: string): Promise<boolean> {
  try {
    await query(
      `UPDATE public.admin_notifications SET is_read = TRUE, read_at = NOW() WHERE id = $1`,
      [id]
    );
  } catch {
    const found = localAdminNotifications.find((n) => n.id === id);
    if (found) {
      found.is_read = true;
      found.read_at = new Date().toISOString();
    }
  }
  return true;
}

export async function markAllAdminNotificationsRead(): Promise<boolean> {
  try {
    await query(`UPDATE public.admin_notifications SET is_read = TRUE, read_at = NOW() WHERE is_read = FALSE`);
  } catch {
    localAdminNotifications.forEach((n) => {
      n.is_read = true;
      n.read_at = new Date().toISOString();
    });
  }
  return true;
}

export async function getAdminNotificationPreferences(adminId?: string): Promise<any> {
  try {
    const res = await query(`SELECT * FROM public.admin_notification_preferences LIMIT 1`);
    if (res.rows && res.rows.length > 0) {
      return res.rows[0];
    }
  } catch {}
  return localAdminPreferences;
}

export async function saveAdminNotificationPreferences(payload: any, adminId?: string): Promise<any> {
  localAdminPreferences = {
    ...localAdminPreferences,
    ...payload,
  };

  try {
    const res = await query(
      `INSERT INTO public.admin_notification_preferences
       (admin_id, alert_new_user_registration, alert_app_installation, alert_support_ticket, alert_critical_security, alert_push_failure, quiet_hours_enabled, quiet_hours_start, quiet_hours_end, delivery_channel, updated_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (admin_id) DO UPDATE SET
         alert_new_user_registration = EXCLUDED.alert_new_user_registration,
         alert_app_installation = EXCLUDED.alert_app_installation,
         alert_support_ticket = EXCLUDED.alert_support_ticket,
         alert_critical_security = EXCLUDED.alert_critical_security,
         alert_push_failure = EXCLUDED.alert_push_failure,
         quiet_hours_enabled = EXCLUDED.quiet_hours_enabled,
         quiet_hours_start = EXCLUDED.quiet_hours_start,
         quiet_hours_end = EXCLUDED.quiet_hours_end,
         delivery_channel = EXCLUDED.delivery_channel,
         updated_at = NOW()
       RETURNING *`,
      [
        adminId || '00000000-0000-0000-0000-000000000000',
        Boolean(payload.alert_new_user_registration ?? true),
        Boolean(payload.alert_app_installation ?? true),
        Boolean(payload.alert_support_ticket ?? true),
        Boolean(payload.alert_critical_security ?? true),
        Boolean(payload.alert_push_failure ?? true),
        Boolean(payload.quiet_hours_enabled ?? false),
        payload.quiet_hours_start || '22:00',
        payload.quiet_hours_end || '07:00',
        payload.delivery_channel || 'push_and_inapp',
      ]
    );
    if (res.rows && res.rows.length > 0) {
      return res.rows[0];
    }
  } catch {}

  return localAdminPreferences;
}
