import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';
import * as webpush from 'web-push';
import { query, isDatabaseConfigured, isDatabaseAvailable } from './db.js';
import { APP_CONFIG } from './config.js';
import { sendEmail } from './email.js';
import { getRenderedCustomTemplateIfActive } from './emailTemplateService.js';
import { generateCampaignEmail } from './notificationEmailTemplates.js';
import { detectPlatformCompatibility, isValidPushEndpoint } from '../src/lib/pwaUtils.js';
import { getPublishedSiteConfig } from './siteControlCenter.js';
import {
  listAllAppUsersFallback,
  insertUserNotificationFallback,
  createBroadcastBannerFallback,
  updateCampaignFallback,
  listCampaignsFallback,
  updateConnectionRequestNotificationsFallback,
  sbRestRequest,
} from './supabaseRestFallback.js';

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
  audience?: 'user' | 'admin' | 'staff';
  iconUrl?: string;
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
  sound_enabled: boolean;
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
  sound_enabled: true,
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
  notify_offers: false,
  quiet_hours_enabled: false,
  quiet_hours_start: '22:00',
  quiet_hours_end: '07:00',
  privacy_hide_amounts: true,
};

// Path-confined per-user fallback store when DATABASE_URL is absent (dev / sandbox / Vercel tmpdir)
const PRIMARY_PUSH_FALLBACK_DIR = path.resolve(process.cwd(), '.data', 'push-notifications');
const TMP_PUSH_FALLBACK_DIR = path.resolve(os.tmpdir(), 'mymoney-push-notifications');
const memoryPushStore = new Map<string, LocalUserPushStore>();

function resolveWritablePushDir(): string {
  try {
    if (!fs.existsSync(PRIMARY_PUSH_FALLBACK_DIR)) {
      fs.mkdirSync(PRIMARY_PUSH_FALLBACK_DIR, { recursive: true });
    }
    fs.accessSync(PRIMARY_PUSH_FALLBACK_DIR, fs.constants.W_OK);
    return PRIMARY_PUSH_FALLBACK_DIR;
  } catch {
    try {
      if (!fs.existsSync(TMP_PUSH_FALLBACK_DIR)) {
        fs.mkdirSync(TMP_PUSH_FALLBACK_DIR, { recursive: true });
      }
      return TMP_PUSH_FALLBACK_DIR;
    } catch {
      return PRIMARY_PUSH_FALLBACK_DIR;
    }
  }
}

function safeUserPushFile(baseDir: string, userId: string): string {
  const safeId = crypto.createHash('sha256').update(String(userId || 'unknown')).digest('hex');
  const resolved = path.resolve(baseDir, `${safeId}.json`);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('Invalid storage path');
  }
  return resolved;
}

function readLocalStore(userId: string): LocalUserPushStore {
  for (const dir of [PRIMARY_PUSH_FALLBACK_DIR, TMP_PUSH_FALLBACK_DIR]) {
    try {
      const file = safeUserPushFile(dir, userId);
      if (fs.existsSync(file)) {
        const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
        const store: LocalUserPushStore = {
          preferences: { ...DEFAULT_PREFERENCES, ...(parsed.preferences || {}) },
          subscriptions: Array.isArray(parsed.subscriptions) ? parsed.subscriptions : [],
          dedupeKeys: parsed.dedupeKeys && typeof parsed.dedupeKeys === 'object' ? parsed.dedupeKeys : {},
          deliveryLogs: Array.isArray(parsed.deliveryLogs) ? parsed.deliveryLogs : [],
        };
        memoryPushStore.set(userId, store);
        return store;
      }
    } catch {
      // Try next dir or memory fallback
    }
  }
  const cached = memoryPushStore.get(userId);
  if (cached) {
    return {
      preferences: { ...DEFAULT_PREFERENCES, ...cached.preferences },
      subscriptions: [...cached.subscriptions],
      dedupeKeys: { ...cached.dedupeKeys },
      deliveryLogs: [...cached.deliveryLogs],
    };
  }
  return {
    preferences: { ...DEFAULT_PREFERENCES },
    subscriptions: [],
    dedupeKeys: {},
    deliveryLogs: [],
  };
}

function writeLocalStore(userId: string, store: LocalUserPushStore): void {
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
  memoryPushStore.set(userId, store);
  try {
    const baseDir = resolveWritablePushDir();
    const file = safeUserPushFile(baseDir, userId);
    fs.writeFileSync(file, JSON.stringify(store, null, 2), 'utf8');
  } catch (err) {
    console.warn('[Push] Local fallback write notice:', (err as Error)?.message || err);
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
 * Mask monetary values (₹500, ₹10,000, INR 2500) and private Udhar details for lock-screen privacy mode
 */
export function maskFinancialData(text: string, maskUdharDetails: boolean = false): string {
  let out = String(text || '').replace(/(?:₹|INR|Rs\.?|\$)\s*[0-9,]+(?:\.[0-9]+)?/gi, '₹••••');
  if (maskUdharDetails) {
    out = out
      .replace(/^([A-Z][a-zA-Z0-9 ._-]{1,40}?)\s+(requested|recorded|settled|sent|paid|accepted|added)\b/g, 'A contact $2')
      .replace(/\b(to|from|with|for)\s+([A-Z][a-zA-Z0-9 ._-]{1,40}?)(?=[.,!?]|$|\s+via|\s+is|\s+recorded|\s+completed|\s+logged)/g, '$1 a contact')
      .replace(/\bby\s+([A-Z][a-zA-Z0-9 ._-]{1,40}?)(?=[.,!?]|$)/g, 'by a contact');
  }
  return out;
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
    '/notifications',
    '/receipt-scanner',
    '/net-worth',
    '/safe-to-spend',
    '/myadmin',
    '/mystaff',
  ]);
  if (pathRoutes.has(clean) || clean.startsWith('/myadmin/') || clean.startsWith('/mystaff/')) {
    return clean;
  }
  if (clean === 'admin') return '/myadmin';
  if (clean === 'staff') return '/mystaff';
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
  const local = readLocalStore(userId);
  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `SELECT * FROM public.user_notification_preferences WHERE user_id = $1`,
        [userId]
      );
      if (res.rows.length > 0) {
        const row = res.rows[0];
        return {
          ...DEFAULT_PREFERENCES,
          ...row,
          sound_enabled:
            typeof row.sound_enabled === 'boolean'
              ? row.sound_enabled
              : local.preferences.sound_enabled ?? DEFAULT_PREFERENCES.sound_enabled,
        };
      }
      await query(
        `INSERT INTO public.user_notification_preferences (user_id, privacy_hide_amounts)
         VALUES ($1, TRUE)
         ON CONFLICT (user_id) DO NOTHING`,
        [userId]
      ).catch(() => {});
      return { ...DEFAULT_PREFERENCES, ...local.preferences };
    } catch {
      // fall through to Supabase REST / local store
    }
  } else {
    const sbRes = await sbRestRequest<any[]>(
      `user_notification_preferences?user_id=eq.${encodeURIComponent(userId)}&select=*&limit=1`
    );
    if (sbRes.ok && Array.isArray(sbRes.data) && sbRes.data.length > 0) {
      const row = sbRes.data[0];
      return {
        ...DEFAULT_PREFERENCES,
        ...row,
        sound_enabled:
          typeof row.sound_enabled === 'boolean'
            ? row.sound_enabled
            : local.preferences.sound_enabled ?? DEFAULT_PREFERENCES.sound_enabled,
      };
    }
  }
  return { ...DEFAULT_PREFERENCES, ...local.preferences };
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
    sound_enabled: patch.sound_enabled !== undefined ? Boolean(patch.sound_enabled) : current.sound_enabled,
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

  const local = readLocalStore(userId);
  local.preferences = next;
  writeLocalStore(userId, local);

  if (isDatabaseAvailable()) {
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
        return { ...next, ...upRes.rows[0], sound_enabled: next.sound_enabled };
      }
    } catch {
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
        // Local store already persisted above
      }
    }
  } else {
    await sbRestRequest('user_notification_preferences?on_conflict=user_id', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates,return=minimal',
      body: {
        user_id: userId,
        in_app_enabled: next.in_app_enabled,
        push_enabled: next.push_enabled,
        email_enabled: next.email_enabled,
        notify_income: next.notify_income,
        notify_expense: next.notify_expense,
        notify_udhar: next.notify_udhar,
        notify_support: next.notify_support,
        notify_announcements: next.notify_announcements,
        notify_offers: next.notify_offers,
        quiet_hours_enabled: next.quiet_hours_enabled,
        quiet_hours_start: next.quiet_hours_start,
        quiet_hours_end: next.quiet_hours_end,
        privacy_hide_amounts: next.privacy_hide_amounts,
        updated_at: new Date().toISOString(),
      },
    }).catch(() => {});
  }

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

  if (isDatabaseAvailable()) {
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
        // Fallback to Supabase REST + local storage below
      }
    }
  }

  // Persist to Supabase REST push_subscriptions table when direct PG is unavailable
  const sbUpsert = await sbRestRequest<any[]>('push_subscriptions?on_conflict=endpoint', {
    method: 'POST',
    prefer: 'resolution=merge-duplicates,return=representation',
    body: {
      user_id: params.userId,
      endpoint,
      p256dh,
      auth,
      user_agent: ua || null,
      updated_at: nowIso,
    },
  }).catch(() => ({ ok: false, data: null as any }));

  const sbRow = sbUpsert.ok && Array.isArray(sbUpsert.data) ? sbUpsert.data[0] : null;
  const local = readLocalStore(params.userId);
  const existingIdx = local.subscriptions.findIndex((s) => s.endpoint === endpoint);
  const record: StoredPushSubscription = {
    id: sbRow?.id || (existingIdx >= 0 ? local.subscriptions[existingIdx].id : crypto.randomUUID()),
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
    created_at: sbRow?.created_at || (existingIdx >= 0 ? local.subscriptions[existingIdx].created_at : nowIso),
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
  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `SELECT * FROM public.push_subscriptions WHERE user_id = $1 ORDER BY updated_at DESC`,
        [userId]
      );
      if (res.rows.length > 0) {
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
      }
    } catch {
      // Fall through to Supabase REST & local store
    }
  }

  const byEndpoint = new Map<string, StoredPushSubscription>();
  const localSubs = readLocalStore(userId).subscriptions.filter(
    (s) => s.user_id === userId && s.is_active !== false
  );
  for (const s of localSubs) {
    byEndpoint.set(s.endpoint, s);
  }

  const sbRes = await sbRestRequest<any[]>(
    `push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&select=id,user_id,endpoint,p256dh,auth,user_agent,created_at,updated_at&order=updated_at.desc`
  ).catch(() => ({ ok: false, data: null as any }));

  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (!row?.endpoint) continue;
      const compat = detectPlatformCompatibility(row.user_agent || '');
      const existing = byEndpoint.get(String(row.endpoint));
      byEndpoint.set(String(row.endpoint), {
        id: String(row.id),
        user_id: String(row.user_id),
        endpoint: String(row.endpoint),
        p256dh: String(row.p256dh),
        auth: String(row.auth),
        user_agent: row.user_agent || existing?.user_agent || null,
        device_name: existing?.device_name || compat.deviceLabel,
        browser: existing?.browser || compat.browserLabel,
        os: existing?.os || compat.osLabel,
        is_active: true,
        failure_count: existing?.failure_count || 0,
        last_used_at: existing?.last_used_at || null,
        created_at: row.created_at || existing?.created_at || new Date().toISOString(),
        updated_at: row.updated_at || existing?.updated_at || new Date().toISOString(),
      });
    }
  }

  return Array.from(byEndpoint.values());
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
  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `DELETE FROM public.push_subscriptions WHERE user_id = $1 AND endpoint = $2 RETURNING id`,
        [userId, cleanEndpoint]
      );
      deletedFromDb = res.rows.length > 0;
    } catch {
      // Fallback below
    }
  } else {
    const sbDel = await sbRestRequest(
      `push_subscriptions?user_id=eq.${encodeURIComponent(userId)}&endpoint=eq.${encodeURIComponent(cleanEndpoint)}`,
      { method: 'DELETE' }
    ).catch(() => ({ ok: false }));
    if (sbDel.ok) deletedFromDb = true;
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
  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `DELETE FROM public.push_subscriptions WHERE id = $1 AND user_id = $2 RETURNING id`,
        [cleanId, userId]
      );
      deletedFromDb = res.rows.length > 0;
    } catch {
      // Fallback below
    }
  } else {
    const sbDel = await sbRestRequest(
      `push_subscriptions?id=eq.${encodeURIComponent(cleanId)}&user_id=eq.${encodeURIComponent(userId)}`,
      { method: 'DELETE' }
    ).catch(() => ({ ok: false }));
    if (sbDel.ok) deletedFromDb = true;
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
  if (isDatabaseAvailable()) {
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
  } else {
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
      let insRes: { rows: any[] } = { rows: [] };
      if (isDatabaseAvailable()) {
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
      } else {
        const fbRow = await insertUserNotificationFallback({
          user_id: userId,
          title,
          message,
          category,
          type,
          related_entity_type: relatedEntityType || null,
          related_entity_id: relatedEntityId || null,
          deep_link: deepLink || null,
          dedupe_key: dedupeKey || null,
          metadata: enrichedMetadata,
        });
        notificationId = fbRow?.id;
        inAppDelivered = true;
        appendLocalDeliveryLog(userId, {
          notification_id: notificationId || null,
          channel: 'in_app',
          status: 'sent',
          error_message: null,
        });
      }
    } catch {
      try {
        const fbRow = await insertUserNotificationFallback({
          user_id: userId,
          title,
          message,
          category,
          type,
          related_entity_type: relatedEntityType || null,
          related_entity_id: relatedEntityId || null,
          deep_link: deepLink || null,
          dedupe_key: dedupeKey || null,
          metadata: enrichedMetadata,
        });
        notificationId = fbRow?.id;
        inAppDelivered = true;
      } catch {
        appendLocalDeliveryLog(userId, {
          notification_id: null,
          channel: 'in_app',
          status: 'failed',
          error_message: 'Database unavailable for in-app storage',
        });
      }
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
      const isUdharCategory = category === 'udhar' || category === 'repay' || category === 'settlement';
      const pushTitle = prefs.privacy_hide_amounts ? maskFinancialData(title, isUdharCategory) : title;
      const pushBody = prefs.privacy_hide_amounts ? maskFinancialData(message, isUdharCategory) : message;
      const targetUrl = buildSafeDeepLinkUrl(deepLink);
      const timestamp = Date.now();
      const notifTag =
        tag ||
        (dedupeKey
          ? `mm-${dedupeKey.slice(0, 80)}`
          : `mm-${category}-${notificationId || timestamp}`);
      const soundMuted = Boolean(inQuietHours || prefs.sound_enabled === false);

      const isConnRequest = metadata?.actionType === 'udhar_connection_request';
      const siteCfg = await getPublishedSiteConfig().catch(() => null);
      const audience = params.audience || 'user';
      const resolvedIcon =
        params.iconUrl ||
        (audience === 'admin'
          ? siteCfg?.notifications?.adminIconUrl || '/admin-icon-192.png'
          : audience === 'staff'
          ? siteCfg?.notifications?.staffIconUrl || '/staff-icon-192.png'
          : siteCfg?.notifications?.userIconUrl || '/icon-192.png');
      const resolvedBadge =
        audience === 'admin' ? '/admin-badge-96.png' : '/notification-badge-96.png';

      const pushPayload = JSON.stringify({
        title: pushTitle,
        body: pushBody,
        icon: resolvedIcon,
        badge: resolvedBadge,
        tag: notifTag,
        category,
        type,
        audience,
        timestamp,
        renotify: true,
        silent: soundMuted,
        vibrate: soundMuted ? undefined : [200, 80, 200],
        soundEnabled: !soundMuted,
        requireInteraction: category === 'security' || type === 'error' || isConnRequest,
        actions: isConnRequest
          ? [
              { action: 'accept', title: 'Accept' },
              { action: 'reject', title: 'Reject' },
            ]
          : undefined,
        data: {
          url: targetUrl,
          audience,
          notificationId: notificationId || null,
          category,
          type,
          dedupeKey: dedupeKey || null,
          deepLink: deepLink || null,
          actionType: metadata?.actionType || null,
          connectionId: metadata?.connectionId || relatedEntityId || null,
          connectionMethod: metadata?.connectionMethod || null,
          timestamp,
          soundEnabled: !soundMuted,
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

          if (isDatabaseAvailable()) {
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
          } else {
            appendLocalDeliveryLog(userId, {
              notification_id: notificationId || null,
              channel: 'push',
              status: 'sent',
              error_message: null,
            });
          }
        } catch (pushErr: any) {
          pushFailed++;
          const statusCode = Number(pushErr?.statusCode) || 0;
          const safeError = statusCode ? `Web Push HTTP ${statusCode}` : 'Web Push delivery error';

          // Automatically clean up expired or invalid subscriptions (404 Not Found / 410 Gone)
          if (statusCode === 404 || statusCode === 410) {
            await removePushSubscriptionById(userId, sub.id);
          } else if (isDatabaseAvailable()) {
            await query(
              `UPDATE public.push_subscriptions SET failure_count = COALESCE(failure_count, 0) + 1 WHERE id = $1`,
              [sub.id]
            ).catch(() => {});
          }

          if (isDatabaseAvailable()) {
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
          } else {
            appendLocalDeliveryLog(userId, {
              notification_id: notificationId || null,
              channel: 'push',
              status: 'failed',
              error_message: safeError,
            });
          }
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
      let recipientUser: { email: string; full_name?: string } | null = null;
      if (isDatabaseAvailable()) {
        const uRes = await query(
          `SELECT email, full_name FROM public.app_users WHERE id = $1`,
          [userId]
        );
        if (uRes.rows.length > 0 && uRes.rows[0].email) {
          recipientUser = uRes.rows[0];
        }
      }
      if (!recipientUser) {
        const sbUserRes = await sbRestRequest<Array<{ email: string; full_name?: string }>>(
          `app_users?id=eq.${encodeURIComponent(userId)}&select=email,full_name&limit=1`
        );
        if (sbUserRes.ok && Array.isArray(sbUserRes.data) && sbUserRes.data[0]?.email) {
          recipientUser = sbUserRes.data[0];
        }
      }
      if (!recipientUser) {
        const fallbackUsers = await listAllAppUsersFallback();
        const found = fallbackUsers.find((u) => u.id === userId && u.email);
        if (found?.email) {
          recipientUser = { email: found.email, full_name: found.full_name };
        }
      }
      if (recipientUser && recipientUser.email) {
        const u = recipientUser;
        let subject = emailOptions?.subject || title;
        let htmlContent = emailOptions?.html;
        let textContent = emailOptions?.text;

        if (!htmlContent) {
          const tmplSlug = campaignId ? 'campaign-announcement' : 'notification-alert';
          const safeActionPath = buildSafeDeepLinkUrl(deepLink);
          const fullActionUrl = `${(APP_CONFIG.appBaseUrl || '').replace(/\/$/, '')}${safeActionPath}`;
          const customNotifTmpl = await getRenderedCustomTemplateIfActive(tmplSlug, {
            user_name: u.full_name || 'My Money User',
            user_email: u.email,
            title,
            message,
            category,
            action_url: fullActionUrl,
            action_text: emailOptions?.actionText || 'View in App',
          });

          if (customNotifTmpl) {
            subject = emailOptions?.subject || customNotifTmpl.subject || title;
            htmlContent = customNotifTmpl.html;
            textContent = customNotifTmpl.text;
          } else {
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
        }

        const sent = await sendEmail({
          to: u.email,
          subject,
          html: htmlContent,
          text: textContent || message,
          emailType: `notification_${category}`,
          recipientName: u.full_name || 'My Money User',
          userId,
        });

        if (sent) {
          emailDelivered = true;
          if (isDatabaseAvailable()) {
            await query(
              `INSERT INTO public.notification_delivery_logs
               (campaign_id, notification_id, user_id, channel, status)
               VALUES ($1, $2, $3, 'email', 'sent')`,
              [campaignId || null, notificationId || null, userId]
            ).catch(() => {});
          } else {
            appendLocalDeliveryLog(userId, {
              notification_id: notificationId || null,
              channel: 'email',
              status: 'sent',
              error_message: null,
            });
          }
        } else {
          appendLocalDeliveryLog(userId, {
            notification_id: notificationId || null,
            channel: 'email',
            status: 'failed',
            error_message: 'Email dispatch failed or SMTP password not configured',
          });
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
    channels: ['in_app', 'push', 'email'],
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
    channels: ['in_app', 'push', 'email'],
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
    channels: ['in_app', 'push', 'email'],
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
  skipEmail?: boolean;
}) {
  const formattedAmount = `₹${Number(params.amount).toLocaleString('en-IN')}`;
  const isGiven = params.direction === 'given' || params.direction === 'gave';
  const initiatorDisplayName = params.initiatorName || 'Friend';
  const initChannels: Array<'in_app' | 'push' | 'email'> = params.skipEmail
    ? ['in_app', 'push']
    : ['in_app', 'push', 'email'];

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
    channels: initChannels,
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
      channels: initChannels,
    });
  }
}

/**
 * Triggered when User A connects with User B directly via QR Code or Confirmation Code (Method B).
 * Sends an informational-only notification to User B (never Accept/Reject buttons).
 */
export async function notifyQrConnected(params: {
  userAId: string;
  userAName: string;
  userAAvatar?: string | null;
  userBId: string;
  userBName: string;
  connectionMethod?: 'QR_CODE' | 'CONFIRMATION_CODE';
  connectionId?: string | null;
}) {
  const connectionMethod: 'QR_CODE' | 'CONFIRMATION_CODE' =
    params.connectionMethod === 'CONFIRMATION_CODE' ? 'CONFIRMATION_CODE' : 'QR_CODE';
  const methodLabel = connectionMethod === 'CONFIRMATION_CODE' ? 'Confirmation Code' : 'QR Code';
  const connectedAt = new Date().toISOString();
  const actorName = String(params.userAName || 'A My Money Manager user').trim();

  await createNotification({
    userId: params.userBId,
    title: 'New People Connection',
    message: `${actorName} added you using your ${methodLabel}.`,
    category: 'udhar',
    type: 'success',
    relatedEntityType: 'user_connection',
    relatedEntityId: params.connectionId || params.userAId,
    deepLink: 'people',
    dedupeKey: `qr-conn:${params.connectionId || `${params.userBId}:${params.userAId}`}:${Date.now()}`,
    metadata: {
      actionType: 'udhar_qr_connected',
      informationalOnly: true,
      connectionMethod,
      methodLabel,
      initiatorUserId: params.userAId,
      initiatorName: actorName,
      initiatorAvatar: params.userAAvatar || null,
      connectedAt,
      connectionId: params.connectionId || null,
    },
    channels: ['in_app', 'push'],
  });
}

/**
 * Updates in-app notification metadata when a Method A connection request is accepted, rejected, cancelled, or auto-resolved.
 */
export async function updateConnectionRequestNotificationsState(params: {
  requestId?: string | null;
  requesterId?: string | null;
  receiverId?: string | null;
  status: 'accepted' | 'rejected' | 'cancelled';
}) {
  const now = new Date().toISOString();
  const requestId = params.requestId ? String(params.requestId) : null;
  const requesterId = params.requesterId ? String(params.requesterId) : null;
  const receiverId = params.receiverId ? String(params.receiverId) : null;

  if (isDatabaseAvailable()) {
    try {
      if (requestId) {
        await query(
          `UPDATE public.user_notifications
           SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('requestStatus', $2::text, 'resolvedAt', $3::text),
               is_read = TRUE,
               read_at = COALESCE(read_at, NOW())
           WHERE is_deleted = FALSE
             AND (
               related_entity_id = $1
               OR metadata->>'connectionId' = $1
               OR metadata->>'requestId' = $1
             )
             AND (metadata->>'actionType' = 'udhar_connection_request' OR related_entity_type = 'user_connection')`,
          [requestId, params.status, now]
        ).catch(() => {});
      }
      if (requesterId && receiverId) {
        await query(
          `UPDATE public.user_notifications
           SET metadata = COALESCE(metadata, '{}'::jsonb) || jsonb_build_object('requestStatus', $3::text, 'resolvedAt', $4::text),
               is_read = TRUE,
               read_at = COALESCE(read_at, NOW())
           WHERE is_deleted = FALSE
             AND user_id = $2
             AND metadata->>'actionType' = 'udhar_connection_request'
             AND COALESCE(metadata->>'requestStatus', 'pending') = 'pending'
             AND (metadata->>'requesterId' = $1 OR related_entity_id = $1)`,
          [requesterId, receiverId, params.status, now]
        ).catch(() => {});
      }
    } catch {
      // Fall through to REST/local fallback update
    }
  }

  await updateConnectionRequestNotificationsFallback(params).catch(() => {});
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
      channels: ['in_app', 'push', 'email'],
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
        channels: ['in_app', 'push', 'email'],
      });
    }
  }
}

/**
 * Triggered when a user submits feedback.
 * Sends in-app + external push notification to the submitting user (rich confirmation email is dispatched via sendFeedbackSubmissionEmails).
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
    let adminRows: Array<{ id: string }> = [];
    if (isDatabaseAvailable()) {
      try {
        const adminsRes = await query(
          `SELECT id FROM public.app_users WHERE LOWER(role) IN ('admin', 'superadmin') AND (status IS NULL OR status = 'active')`
        );
        adminRows = adminsRes.rows || [];
      } catch {
        adminRows = [];
      }
    }

    if (adminRows.length === 0) {
      const fbUsers = await listAllAppUsersFallback();
      adminRows = fbUsers
        .filter((u) => ['admin', 'superadmin'].includes(String(u.role || '').toLowerCase()))
        .map((u) => ({ id: u.id }));
    }

    if (adminRows.length === 0) return;

    const stars = '⭐'.repeat(Math.max(1, Math.min(5, opts.rating)));
    const shortMsg = opts.message.length > 80 ? opts.message.slice(0, 80) + '…' : opts.message;

    for (const admin of adminRows) {
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
        skipPreferenceCheck: true,
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
 * (Rich confirmation email is dispatched via sendComplaintSubmissionEmails / sendSupportTicketSubmissionEmails)
 */
export async function notifyComplaintSubmitted(
  userId: string,
  ticket: { id: string; subject: string; category?: string; ticketType?: 'complaint' | 'support' }
) {
  const shortId = ticket.id.slice(0, 8);
  const isSupport = ticket.ticketType === 'support';
  await createNotification({
    userId,
    title: isSupport ? `Support Request #${shortId}` : `Ticket Raised #${shortId}`,
    message: isSupport
      ? `Your support request "${ticket.subject}" has been received. Our team will review and reply shortly.`
      : `Your complaint "${ticket.subject}" has been received. Our team will review and reply within 24-48 hours.`,
    category: isSupport ? 'support' : 'complaint',
    type: 'info',
    relatedEntityType: 'support_ticket',
    relatedEntityId: ticket.id,
    deepLink: `help:ticket:${ticket.id}`,
    channels: ['in_app', 'push'],
  });
}

/**
 * Triggered when any user raises a complaint or support ticket — notifies ALL admin users via in-app + external push.
 */
export async function notifyAdminNewSupportTicket(opts: {
  ticketId: string;
  ticketNumber: string;
  ticketType: 'complaint' | 'support';
  submitterName: string;
  submitterEmail: string;
  category?: string;
  subject: string;
}): Promise<void> {
  try {
    let adminRows: Array<{ id: string }> = [];
    if (isDatabaseAvailable()) {
      try {
        const adminsRes = await query(
          `SELECT id FROM public.app_users WHERE LOWER(role) IN ('admin', 'superadmin') AND (status IS NULL OR status = 'active')`
        );
        adminRows = adminsRes.rows || [];
      } catch {
        adminRows = [];
      }
    }

    if (adminRows.length === 0) {
      const fbUsers = await listAllAppUsersFallback();
      adminRows = fbUsers
        .filter((u) => ['admin', 'superadmin'].includes(String(u.role || '').toLowerCase()))
        .map((u) => ({ id: u.id }));
    }

    if (adminRows.length === 0) return;

    const label = opts.ticketType === 'complaint' ? 'Complaint' : 'Support Ticket';
    for (const admin of adminRows) {
      await createNotification({
        userId: admin.id,
        title: `New ${label} #${opts.ticketNumber}`,
        message: `${opts.submitterName} (${opts.submitterEmail}): "${opts.subject}" [${opts.category || 'General'}]`,
        category: opts.ticketType,
        type: opts.ticketType === 'complaint' ? 'warning' : 'info',
        relatedEntityType: 'support_ticket',
        relatedEntityId: opts.ticketId,
        deepLink: 'admin:support',
        channels: ['in_app', 'push'],
        skipPreferenceCheck: true,
      }).catch((e) =>
        console.warn(`[notifyAdminNewSupportTicket] Failed for admin ${admin.id}:`, e?.message)
      );
    }
  } catch (e: any) {
    console.warn('[notifyAdminNewSupportTicket] Error:', e?.message);
  }
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

// In-memory campaign storage for environments where DB is offline
export const localCampaigns = new Map<string, any>();

// -------------------------------------------------------------
// Admin Campaign Dispatcher & Scheduler
// -------------------------------------------------------------

export async function dispatchCampaign(campaignId: string): Promise<{
  success: boolean;
  totalTargets: number;
  deliveredCount: number;
  failedCount: number;
}> {
  let campaign: any = null;
  if (isDatabaseAvailable()) {
    try {
      const cRes = await query(`SELECT * FROM public.notification_campaigns WHERE id = $1`, [campaignId]);
      if (cRes.rows && cRes.rows.length > 0) {
        campaign = cRes.rows[0];
      }
    } catch {}
  }

  if (!campaign) {
    campaign = localCampaigns.get(campaignId);
  }

  if (!campaign) {
    try {
      const fbCampaigns = await listCampaignsFallback();
      campaign = fbCampaigns.find((c) => c.id === campaignId) || null;
    } catch {}
  }

  if (!campaign) {
    campaign = {
      id: campaignId,
      target_type: 'installed',
      title: 'Campaign',
      message: 'Campaign message',
      channels: ['in_app'],
      status: 'sending',
    };
  }

  await query(
    `UPDATE public.notification_campaigns SET status = 'sending', updated_at = NOW() WHERE id = $1`,
    [campaignId]
  ).catch(() => {});

  let userIds: string[] = [];

  if (campaign.target_type === 'all') {
    if (isDatabaseAvailable()) {
      try {
        const allUsers = await query(`SELECT id FROM public.app_users WHERE status IS NULL OR status = 'active'`);
        userIds = allUsers.rows.map((r) => r.id);
      } catch {}
    }
    if (userIds.length === 0) {
      const fbUsers = await listAllAppUsersFallback();
      userIds = fbUsers.map((u) => u.id);
    }
  } else if (campaign.target_type === 'installed') {
    if (isDatabaseAvailable()) {
      try {
        const installedUsers = await query(
          `SELECT DISTINCT user_id as id FROM public.installed_devices WHERE is_installed = TRUE
           UNION
           SELECT DISTINCT user_id as id FROM public.push_subscriptions WHERE is_active = TRUE`
        );
        userIds = installedUsers.rows.map((r) => r.id);
      } catch {}
    }
    if (userIds.length === 0) {
      const sbSubs = await sbRestRequest<any[]>('push_subscriptions?select=user_id').catch(() => ({
        ok: false,
        data: null as any,
      }));
      if (sbSubs.ok && Array.isArray(sbSubs.data)) {
        for (const r of sbSubs.data) {
          if (r?.user_id) userIds.push(String(r.user_id));
        }
      }
      for (const dev of localInstalledDevices.values()) {
        if (dev?.is_installed && dev?.user_id) userIds.push(dev.user_id);
      }
      for (const [uid, store] of memoryPushStore.entries()) {
        if (store.subscriptions.some((s) => s.is_active !== false)) {
          userIds.push(uid);
        }
      }
    }
    if (userIds.length === 0) {
      const fbUsers = await listAllAppUsersFallback();
      userIds = fbUsers.map((u) => u.id);
    }
  } else if (campaign.target_type === 'push_subscribed') {
    if (isDatabaseAvailable()) {
      try {
        const pushUsers = await query(
          `SELECT DISTINCT user_id as id FROM public.push_subscriptions WHERE is_active = TRUE`
        );
        userIds = pushUsers.rows.map((r) => r.id);
      } catch {}
    }
    if (userIds.length === 0) {
      const sbSubs = await sbRestRequest<any[]>('push_subscriptions?select=user_id').catch(() => ({
        ok: false,
        data: null as any,
      }));
      if (sbSubs.ok && Array.isArray(sbSubs.data)) {
        for (const r of sbSubs.data) {
          if (r?.user_id) userIds.push(String(r.user_id));
        }
      }
      for (const [uid, store] of memoryPushStore.entries()) {
        if (store.subscriptions.some((s) => s.is_active !== false)) {
          userIds.push(uid);
        }
      }
    }
    if (userIds.length === 0) {
      const fbUsers = await listAllAppUsersFallback();
      userIds = fbUsers.map((u) => u.id);
    }
  } else if (campaign.target_type === 'admins') {
    if (isDatabaseAvailable()) {
      try {
        const adminUsers = await query(
          `SELECT id FROM public.app_users WHERE LOWER(role) IN ('superadmin', 'admin')`
        );
        userIds = adminUsers.rows.map((r) => r.id);
      } catch {}
    }
    if (userIds.length === 0) {
      const fbUsers = await listAllAppUsersFallback();
      userIds = fbUsers
        .filter((u) => ['superadmin', 'admin'].includes(String(u.role || '').toLowerCase()))
        .map((u) => u.id);
    }
  } else if (campaign.target_type === 'specific' && (campaign.target_user_id || (campaign.target_user_ids && campaign.target_user_ids[0]))) {
    userIds = [campaign.target_user_id || campaign.target_user_ids[0]];
  } else if (campaign.target_type === 'active') {
    if (isDatabaseAvailable()) {
      try {
        const activeUsers = await query(
          `SELECT DISTINCT user_id as id FROM public.transactions
           WHERE created_at > NOW() - INTERVAL '30 days'`
        );
        userIds = activeUsers.rows.map((r) => r.id);
      } catch {}
    }
    if (userIds.length === 0) {
      const fbUsers = await listAllAppUsersFallback();
      userIds = fbUsers.map((u) => u.id);
    }
  } else if (campaign.target_type === 'selected' && Array.isArray(campaign.target_user_ids)) {
    userIds = campaign.target_user_ids;
  }

  userIds = Array.from(new Set(userIds.filter(Boolean)));
  const channels = Array.isArray(campaign.channels) && campaign.channels.length > 0 ? campaign.channels : ['in_app'];

  let deliveredCount = 0;
  let failedCount = 0;

  for (const uid of userIds) {
    try {
      const res = await createNotification({
        userId: uid,
        title: campaign.title,
        message: campaign.message,
        category: campaign.category || 'announcement',
        type: campaign.type || 'announcement',
        deepLink: campaign.deep_link || campaign.deepLink || undefined,
        channels,
        campaignId: campaign.id,
        dedupeKey: `campaign:${campaign.id}:${uid}`,
        skipPreferenceCheck: campaign.target_type === 'all' && channels.includes('in_app'),
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

  if (channels.includes('in_app')) {
    const targetAudienceFlag = campaign.target_type === 'all' ? 'all' : userIds[0] || 'all';
    if (isDatabaseAvailable()) {
      await query(
        `INSERT INTO public.notifications (title, message, type, target_user_id, is_active, created_by)
         VALUES ($1, $2, $3, $4, TRUE, $5)`,
        [
          campaign.title,
          campaign.message,
          campaign.type || 'announcement',
          targetAudienceFlag,
          campaign.created_by || null,
        ]
      ).catch(() => {});
    }
    await createBroadcastBannerFallback({
      title: campaign.title,
      message: campaign.message,
      type: campaign.type || 'announcement',
      target_user_id: targetAudienceFlag,
      created_by: campaign.created_by || null,
      category: campaign.category || 'announcement',
      deep_link: campaign.deep_link || campaign.deepLink || 'dashboard',
    }).catch(() => {});
  }

  const sentAt = new Date().toISOString();
  await query(
    `UPDATE public.notification_campaigns
     SET status = 'sent', total_targets = $1, delivered_count = $2, failed_count = $3, sent_at = NOW(), updated_at = NOW()
     WHERE id = $4`,
    [userIds.length, deliveredCount, failedCount, campaignId]
  ).catch(() => {});

  await updateCampaignFallback(campaignId, {
    status: 'sent',
    total_targets: userIds.length,
    delivered_count: deliveredCount,
    failed_count: failedCount,
    sent_at: sentAt,
  }).catch(() => {});

  if (localCampaigns.has(campaignId)) {
    localCampaigns.set(campaignId, {
      ...localCampaigns.get(campaignId),
      status: 'sent',
      total_targets: userIds.length,
      delivered_count: deliveredCount,
      failed_count: failedCount,
      sent_at: sentAt,
    });
  }

  return {
    success: true,
    totalTargets: userIds.length,
    deliveredCount,
    failedCount,
  };
}

export async function processScheduledCampaigns(): Promise<number> {
  if (!isDatabaseAvailable()) return 0;
  try {
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
  } catch {
    return 0;
  }
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

        const record = updateRes.rows && updateRes.rows[0];
        if (record) {
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

        const record = insertRes.rows && insertRes.rows[0];
        if (record) {
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
  let list = Array.from(localInstalledDevices.values());
  if (filters?.installedOnly) {
    list = list.filter((r) => r.is_installed);
  }
  if (filters?.deviceType) {
    list = list.filter((r) => r.device_type === filters.deviceType);
  }
  if (filters?.pushPermission) {
    list = list.filter((r) => r.push_permission === filters.pushPermission);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    list = list.filter(
      (r) =>
        r.user_name?.toLowerCase().includes(q) ||
        r.user_email?.toLowerCase().includes(q) ||
        r.user_id?.toLowerCase().includes(q) ||
        r.browser?.toLowerCase().includes(q) ||
        r.os?.toLowerCase().includes(q)
    );
  }
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

  const localRecord: AdminNotificationRecord = {
    id: `anot_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`,
    event_type: eventType,
    title,
    message,
    user_id: userId,
    user_email: userEmail,
    metadata,
    is_read: false,
    created_at: new Date().toISOString(),
  };
  localAdminNotifications.unshift(localRecord);

  try {
    await query(
      `INSERT INTO public.admin_notifications
       (event_type, title, message, user_id, user_email, metadata, is_read, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, FALSE, NOW())`,
      [eventType, title, message, userId || null, userEmail || null, JSON.stringify(metadata)]
    );
  } catch {
    // Already tracked in localAdminNotifications
  }

  // Check Control Center admin notification category toggles + admin preferences
  const siteCfg = await getPublishedSiteConfig().catch(() => null);
  const ccAdminCats = siteCfg?.notifications?.categories?.admin || {};
  const categoryKeyMap: Record<string, string> = {
    new_user: 'new_user',
    pwa_install: 'app_installations',
    support_ticket: 'support_tickets',
    critical_alert: 'security_alerts',
    push_failure: 'system_errors',
  };
  const ccEnabled = ccAdminCats[categoryKeyMap[eventType]] !== false;

  const prefs = await getAdminNotificationPreferences();
  const isAlertEnabled =
    ccEnabled &&
    ((eventType === 'new_user' && prefs.alert_new_user_registration) ||
      (eventType === 'pwa_install' && prefs.alert_app_installation) ||
      (eventType === 'support_ticket' && prefs.alert_support_ticket) ||
      (eventType === 'critical_alert' && prefs.alert_critical_security) ||
      (eventType === 'push_failure' && prefs.alert_push_failure));

  if (!isAlertEnabled) {
    return true;
  }

  const adminAppLabel = siteCfg?.notifications?.adminAppName || 'Admin Alert';
  const adminIconUrl = siteCfg?.notifications?.adminIconUrl || '/admin-icon-192.png';

  // Find all administrators (strictly admin/superadmin, NOT staff)
  try {
    let adminRows: Array<{ id: string }> = [];
    if (isDatabaseAvailable()) {
      const admins = await query(
        `SELECT id FROM public.app_users WHERE LOWER(role) IN ('superadmin', 'admin')`
      );
      adminRows = admins.rows || [];
    }
    if (adminRows.length === 0) {
      const fbUsers = await listAllAppUsersFallback();
      adminRows = fbUsers
        .filter((u) => ['superadmin', 'admin'].includes(String(u.role || '').toLowerCase()))
        .map((u) => ({ id: u.id }));
    }
    for (const a of adminRows) {
      createNotification({
        userId: a.id,
        title: `[${adminAppLabel}] ${title}`,
        message,
        category: 'security',
        type: eventType === 'critical_alert' ? 'error' : 'info',
        audience: 'admin',
        iconUrl: adminIconUrl,
        channels: prefs.delivery_channel === 'inapp_only' ? ['in_app'] : ['in_app', 'push'],
        deepLink: '/myadmin',
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

/**
 * Dispatches an immediate, deduplicated in-app Welcome Notification
 * whenever a new user registers via Email/Password or Google Sign-In.
 */
export async function dispatchNewUserWelcomeNotification(params: {
  userId: string;
  fullName?: string | null;
  email: string;
  provider?: 'email' | 'google';
}): Promise<{ success: boolean; notificationId?: string; deduplicated?: boolean }> {
  const firstName =
    String(params.fullName || '')
      .trim()
      .split(/\s+/)[0] ||
    String(params.email || '').split('@')[0] ||
    'Friend';

  return createNotification({
    userId: params.userId,
    title: 'Welcome to My Money Manager!',
    message: `Hi ${firstName}, your account is ready! Start tracking daily expenses, managing room budgets, scanning receipts, and settling Udhar via QR.`,
    category: 'system',
    type: 'success',
    relatedEntityType: 'user_registration',
    relatedEntityId: params.userId,
    deepLink: 'dashboard',
    dedupeKey: `welcome_in_app:${params.userId}`,
    channels: ['in_app'],
    skipPreferenceCheck: true,
    metadata: {
      event: 'welcome_signup',
      provider: params.provider || 'email',
      email: String(params.email || '').toLowerCase().trim(),
    },
  });
}

// ==============================================================================
// Staff-Isolated Notification System (/mystaff audience ONLY)
// ==============================================================================

export interface StaffNotificationRecord {
  id: string;
  staff_user_id: string | null; // null = broadcast to all active staff
  event_type: 'assigned_task' | 'task_updates' | 'announcements' | 'support_queue' | 'account_alerts';
  title: string;
  message: string;
  deep_link: string;
  metadata?: Record<string, any>;
  is_read: boolean;
  read_by: string[];
  created_at: string;
}

const STAFF_NOTIFS_FILE = path.resolve(PRIMARY_PUSH_FALLBACK_DIR, 'staff-notifications.json');
const TMP_STAFF_NOTIFS_FILE = path.resolve(TMP_PUSH_FALLBACK_DIR, 'staff-notifications.json');
let memoryStaffNotifications: StaffNotificationRecord[] | null = null;

function readStaffNotifs(): StaffNotificationRecord[] {
  if (memoryStaffNotifications) return memoryStaffNotifications;
  for (const target of [STAFF_NOTIFS_FILE, TMP_STAFF_NOTIFS_FILE]) {
    try {
      if (fs.existsSync(target)) {
        const parsed = JSON.parse(fs.readFileSync(target, 'utf8'));
        if (Array.isArray(parsed)) {
          memoryStaffNotifications = parsed;
          return parsed;
        }
      }
    } catch {}
  }
  memoryStaffNotifications = [];
  return [];
}

function writeStaffNotifs(items: StaffNotificationRecord[]): void {
  const sliced = items.slice(0, 200);
  memoryStaffNotifications = sliced;
  try {
    const dir = resolveWritablePushDir();
    fs.writeFileSync(path.resolve(dir, 'staff-notifications.json'), JSON.stringify(sliced, null, 2), 'utf8');
  } catch {}
}

export async function recordStaffNotification(params: {
  staffUserId?: string | null;
  eventType: StaffNotificationRecord['event_type'];
  title: string;
  message: string;
  deepLink?: string;
  metadata?: Record<string, any>;
}): Promise<StaffNotificationRecord> {
  const siteCfg = await getPublishedSiteConfig().catch(() => null);
  const catEnabled = siteCfg?.notifications?.categories?.staff?.[params.eventType] !== false;
  const staffAppName = siteCfg?.notifications?.staffAppName || 'My Money Manager Staff';
  const staffIconUrl = siteCfg?.notifications?.staffIconUrl || '/staff-icon-192.png';

  const record: StaffNotificationRecord = {
    id: `snot_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
    staff_user_id: params.staffUserId || null,
    event_type: params.eventType,
    title: params.title,
    message: params.message,
    deep_link: params.deepLink || '/mystaff',
    metadata: {
      ...(params.metadata || {}),
      audience: 'staff',
      appName: staffAppName,
      iconUrl: staffIconUrl,
    },
    is_read: false,
    read_by: [],
    created_at: new Date().toISOString(),
  };

  if (!catEnabled) return record;

  const list = readStaffNotifs();
  list.unshift(record);
  writeStaffNotifs(list);

  // Also dispatch Web Push if target staff user has subscribed devices on /mystaff
  if (params.staffUserId) {
    createNotification({
      userId: params.staffUserId,
      title: `[${staffAppName}] ${params.title}`,
      message: params.message,
      category: 'support',
      type: 'info',
      audience: 'staff',
      iconUrl: staffIconUrl,
      deepLink: params.deepLink || '/mystaff',
      channels: ['push'],
      skipPreferenceCheck: true,
      metadata: {
        audience: 'staff',
        staffNotificationId: record.id,
        ...(params.metadata || {}),
      },
    }).catch(() => {});
  }

  return record;
}

export async function getStaffNotifications(staffUserId: string, limit = 50): Promise<StaffNotificationRecord[]> {
  const all = readStaffNotifs();
  return all
    .filter((n) => !n.staff_user_id || n.staff_user_id === staffUserId)
    .slice(0, limit)
    .map((n) => ({
      ...n,
      is_read: n.is_read || n.read_by.includes(staffUserId),
    }));
}

export async function markStaffNotificationRead(id: string, staffUserId: string): Promise<boolean> {
  const all = readStaffNotifs();
  let changed = false;
  for (const n of all) {
    if (n.id === id && (!n.staff_user_id || n.staff_user_id === staffUserId)) {
      if (!n.read_by.includes(staffUserId)) n.read_by.push(staffUserId);
      if (n.staff_user_id === staffUserId) n.is_read = true;
      changed = true;
    }
  }
  if (changed) writeStaffNotifs(all);
  return changed;
}

export async function markAllStaffNotificationsRead(staffUserId: string): Promise<boolean> {
  const all = readStaffNotifs();
  for (const n of all) {
    if (!n.staff_user_id || n.staff_user_id === staffUserId) {
      if (!n.read_by.includes(staffUserId)) n.read_by.push(staffUserId);
      if (n.staff_user_id === staffUserId) n.is_read = true;
    }
  }
  writeStaffNotifs(all);
  return true;
}
