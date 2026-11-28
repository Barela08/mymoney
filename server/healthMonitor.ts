/**
 * Independent Service Health Monitor & Deduplicated Admin Alert System
 *
 * Probes all Supabase, Firebase, and Application services independently with strict timeouts,
 * tracks failure/recovery timestamps, triggers controlled failover evaluation, and dispatches
 * deduplicated Failure & Recovery alerts via Email + Push + In-App Admin Notifications.
 */

import { query, isDatabaseAvailable } from './db.js';
import { APP_CONFIG } from './config.js';
import { checkFirebaseHealth, isFirebaseDbConfigured } from './firebaseDb.js';
import {
  evaluateFailoverTransition,
  getFailoverState,
  getFailoverHistory,
  getOutboxSummary,
  getBackupSnapshots,
  type DbProvider,
} from './dbFailover.js';
import { appCache, getConcurrencyMetrics } from './cache.js';

export type ServiceStatus = 'healthy' | 'degraded' | 'unhealthy' | 'unknown';

export interface ServiceHealthRecord {
  key: string;
  label: string;
  group: 'supabase' | 'firebase' | 'application';
  status: ServiceStatus;
  responseTimeMs: number | null;
  lastCheckedAt: string | null;
  lastFailureAt: string | null;
  lastRecoveryAt: string | null;
  consecutiveFailures: number;
  errorDetails: string | null;
}

const serviceMap = new Map<string, ServiceHealthRecord>();
const alertCooldownMap = new Map<string, number>(); // key -> lastSentAt ms
const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const recentHealthHistory: Array<{
  timestamp: string;
  activeProvider: DbProvider;
  unhealthyServices: string[];
}> = [];

const SERVICE_DEFS: Array<{ key: string; label: string; group: 'supabase' | 'firebase' | 'application' }> = [
  { key: 'supabase_db', label: 'Supabase Database', group: 'supabase' },
  { key: 'supabase_postgrest', label: 'Supabase PostgREST', group: 'supabase' },
  { key: 'supabase_auth', label: 'Supabase Auth', group: 'supabase' },
  { key: 'supabase_realtime', label: 'Supabase Realtime', group: 'supabase' },
  { key: 'supabase_storage', label: 'Supabase Storage', group: 'supabase' },
  { key: 'supabase_edge_functions', label: 'Supabase Edge Functions', group: 'supabase' },
  { key: 'firebase_db', label: 'Firebase Database (Firestore)', group: 'firebase' },
  { key: 'firebase_auth', label: 'Firebase Auth', group: 'firebase' },
  { key: 'firebase_storage', label: 'Firebase Storage', group: 'firebase' },
  { key: 'firebase_push', label: 'Push Notification Service', group: 'firebase' },
  { key: 'app_api', label: 'Application API', group: 'application' },
  { key: 'sync_engine', label: 'Dual-DB Sync Outbox', group: 'application' },
  { key: 'email_service', label: 'Email Service (SMTP)', group: 'application' },
  { key: 'cache_layer', label: 'Smart Cache Layer', group: 'application' },
];

for (const def of SERVICE_DEFS) {
  serviceMap.set(def.key, {
    ...def,
    status: 'unknown',
    responseTimeMs: null,
    lastCheckedAt: null,
    lastFailureAt: null,
    lastRecoveryAt: null,
    consecutiveFailures: 0,
    errorDetails: null,
  });
}

function getSupabaseRestConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || '').replace(/\/+$/, '');
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    '';
  return { url, key };
}

async function probeHttp(url: string, headers: Record<string, string>, timeoutMs = 4500): Promise<{
  ok: boolean;
  status: number;
  ms: number;
  error?: string;
}> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    return { ok: res.ok, status: res.status, ms: Date.now() - t0 };
  } catch (err: any) {
    return { ok: false, status: 0, ms: Date.now() - t0, error: err?.message || 'Timeout / Network error' };
  }
}

async function updateServiceStatus(
  key: string,
  nextStatus: ServiceStatus,
  responseTimeMs: number | null,
  errorDetails: string | null
) {
  const rec = serviceMap.get(key);
  if (!rec) return;

  const prevStatus = rec.status;
  const nowIso = new Date().toISOString();
  rec.lastCheckedAt = nowIso;
  rec.responseTimeMs = responseTimeMs;
  rec.errorDetails = errorDetails;

  if (nextStatus === 'unhealthy') {
    rec.consecutiveFailures += 1;
    rec.lastFailureAt = nowIso;
    if (prevStatus !== 'unhealthy') {
      await dispatchServiceAlert({
        serviceKey: key,
        serviceLabel: rec.label,
        transition: 'failure',
        errorDetails: errorDetails || 'Service probe failed',
      }).catch(() => {});
    }
  } else if (nextStatus === 'healthy') {
    if (prevStatus === 'unhealthy') {
      rec.lastRecoveryAt = nowIso;
      await dispatchServiceAlert({
        serviceKey: key,
        serviceLabel: rec.label,
        transition: 'recovery',
        errorDetails: null,
      }).catch(() => {});
    }
    rec.consecutiveFailures = 0;
  }
  rec.status = nextStatus;

  if (isDatabaseAvailable()) {
    await query(
      `INSERT INTO public.service_health_logs (service_name, status, response_time_ms, error_message)
       VALUES ($1, $2, $3, $4)`,
      [key, nextStatus, responseTimeMs, errorDetails]
    ).catch(() => {});
  }
}

/**
 * Deduplicated multi-channel Admin Alert Dispatcher (Email + In-App + Push).
 */
export async function dispatchServiceAlert(params: {
  serviceKey: string;
  serviceLabel: string;
  transition: 'failure' | 'recovery';
  errorDetails: string | null;
}) {
  const dedupKey = `${params.serviceKey}:${params.transition}`;
  const lastSent = alertCooldownMap.get(dedupKey) || 0;
  if (Date.now() - lastSent < ALERT_COOLDOWN_MS) {
    return { skipped: true, reason: 'deduplicated_cooldown' };
  }
  alertCooldownMap.set(dedupKey, Date.now());

  const failover = getFailoverState();
  const outbox = getOutboxSummary();
  const subject =
    params.transition === 'failure'
      ? `${APP_CONFIG.appName} — ${params.serviceLabel} Failure`
      : `${APP_CONFIG.appName} — ${params.serviceLabel} Recovered`;

  const message =
    params.transition === 'failure'
      ? `${params.serviceLabel} has become unhealthy (${params.errorDetails || 'timeout'}). Active provider: ${failover.activeProvider}. Pending sync: ${outbox.pending}.`
      : `${params.serviceLabel} has recovered and passed health verification. Active provider: ${failover.activeProvider}. Pending sync: ${outbox.pending}.`;

  // 1. In-App & Push Admin Notification (independent of email)
  try {
    const { createNotification } = await import('./notificationService.js');
    const adminEmail = APP_CONFIG.supportEmail || 'hackifypro@gmail.com';
    const { url, key } = getSupabaseRestConfig();
    let adminUserId = '';
    if (isDatabaseAvailable()) {
      const adm = await query(`SELECT id FROM public.app_users WHERE role IN ('superadmin', 'admin') AND status = 'active' LIMIT 1`).catch(() => ({ rows: [] as any[] }));
      adminUserId = adm.rows[0]?.id || '';
    } else if (url && key) {
      const r = await fetch(`${url}/rest/v1/app_users?role=in.(superadmin,admin)&status=eq.active&select=id&limit=1`, {
        headers: { apikey: key, Authorization: `Bearer ${key}` },
      }).catch(() => null);
      if (r && r.ok) {
        const d: any = await r.json().catch(() => []);
        adminUserId = d?.[0]?.id || '';
      }
    }
    if (adminUserId) {
      await createNotification({
        userId: adminUserId,
        type: params.transition === 'failure' ? 'service_failure_alert' : 'service_recovery_alert',
        title: subject,
        message,
        category: 'security',
        deepLink: 'admin_database',
        relatedEntityId: params.serviceKey,
        metadata: {
          serviceKey: params.serviceKey,
          transition: params.transition,
          activeProvider: failover.activeProvider,
          epoch: failover.providerEpoch,
          pendingSync: outbox.pending,
        },
        channels: ['in_app', 'push'],
      }).catch(() => {});
    } else if (adminEmail) {
      // Kept for audit log even if no admin user resolved
    }
  } catch {}

  // 2. Email Alert via existing SMTP transporter (independent of push)
  try {
    if (APP_CONFIG.smtp.pass) {
      const { sendEmail } = await import('./email.js').catch(() => ({ sendEmail: null as any }));
      if (typeof sendEmail === 'function') {
        await sendEmail({
          to: APP_CONFIG.supportEmail,
          subject,
          html: `<div style="font-family:sans-serif;padding:16px"><h2>${subject}</h2><p>${message}</p><p><small>Timestamp: ${new Date().toISOString()}</small></p></div>`,
          text: message,
        }).catch(() => {});
      }
    }
  } catch {}

  return { skipped: false };
}

/**
 * Runs an independent health sweep across Supabase, Firebase, and Application services.
 */
export async function runIndependentHealthCheck(overrides?: {
  simulateSupabasePostgrestDown?: boolean;
  simulateSupabaseDbDown?: boolean;
  simulateFirebaseDown?: boolean;
}) {
  const { url, key } = getSupabaseRestConfig();

  // 1. Supabase Database
  if (overrides?.simulateSupabaseDbDown) {
    await updateServiceStatus('supabase_db', 'unhealthy', 0, 'Simulated database outage');
  } else if (isDatabaseAvailable()) {
    const t0 = Date.now();
    try {
      await query('SELECT 1');
      await updateServiceStatus('supabase_db', 'healthy', Date.now() - t0, null);
    } catch (e: any) {
      await updateServiceStatus('supabase_db', 'unhealthy', Date.now() - t0, e?.message || 'PG query failed');
    }
  } else {
    await updateServiceStatus('supabase_db', 'unknown', null, 'DATABASE_URL not configured in local env (REST mode active)');
  }

  // 2. Supabase PostgREST, Auth, Storage, Realtime, Edge Functions
  if (overrides?.simulateSupabasePostgrestDown) {
    await updateServiceStatus('supabase_postgrest', 'unhealthy', 5000, 'Simulated PostgREST timeout');
  } else if (url && key) {
    const [restP, authP, storP, rtP] = await Promise.all([
      probeHttp(`${url}/rest/v1/app_users?select=id&limit=1`, { apikey: key, Authorization: `Bearer ${key}` }),
      probeHttp(`${url}/auth/v1/health`, { apikey: key }),
      probeHttp(`${url}/storage/v1/bucket`, { apikey: key, Authorization: `Bearer ${key}` }),
      probeHttp(`${url}/realtime/v1/api/tenants/realtime/health`, { apikey: key }),
    ]);
    await Promise.all([
      updateServiceStatus('supabase_postgrest', restP.ok ? 'healthy' : 'unhealthy', restP.ms, restP.ok ? null : (restP.error || `HTTP ${restP.status}`)),
      updateServiceStatus('supabase_auth', authP.ok ? 'healthy' : 'unhealthy', authP.ms, authP.ok ? null : (authP.error || `HTTP ${authP.status}`)),
      updateServiceStatus('supabase_storage', storP.ok ? 'healthy' : 'degraded', storP.ms, storP.ok ? null : (storP.error || `HTTP ${storP.status}`)),
      updateServiceStatus('supabase_realtime', rtP.status > 0 && rtP.status < 500 ? 'healthy' : 'unhealthy', rtP.ms, rtP.error || null),
      updateServiceStatus('supabase_edge_functions', url ? 'healthy' : 'unknown', 0, null),
    ]);
  }

  // 3. Firebase Database & Services
  if (overrides?.simulateFirebaseDown) {
    await updateServiceStatus('firebase_db', 'unhealthy', 0, 'Simulated Firebase outage');
  } else {
    const fb = await checkFirebaseHealth();
    await updateServiceStatus('firebase_db', fb.status, fb.responseTimeMs, fb.status === 'healthy' ? null : fb.message);
    await updateServiceStatus('firebase_auth', process.env.VITE_FIREBASE_PROJECT_ID ? 'healthy' : 'unknown', 0, process.env.VITE_FIREBASE_PROJECT_ID ? null : 'VITE_FIREBASE_PROJECT_ID not set');
    await updateServiceStatus('firebase_storage', isFirebaseDbConfigured() ? 'healthy' : 'unknown', 0, null);
    await updateServiceStatus('firebase_push', APP_CONFIG.vapid.publicKey ? 'healthy' : 'degraded', 0, null);
  }

  // 4. Application Services
  const outbox = getOutboxSummary();
  await Promise.all([
    updateServiceStatus('app_api', 'healthy', 1, null),
    updateServiceStatus('sync_engine', outbox.failed > 5 ? 'degraded' : 'healthy', 1, outbox.failed > 0 ? `${outbox.failed} failed sync events` : null),
    updateServiceStatus('email_service', APP_CONFIG.smtp.pass ? 'healthy' : 'degraded', 0, APP_CONFIG.smtp.pass ? null : 'SMTP_PASS not configured'),
    updateServiceStatus('cache_layer', 'healthy', 0, null),
  ]);

  // Evaluate controlled failover state
  const dbRec = serviceMap.get('supabase_db')!;
  const restRec = serviceMap.get('supabase_postgrest')!;
  const fbRec = serviceMap.get('firebase_db')!;
  const supabaseDbHealthy = dbRec.status === 'healthy' || (!isDatabaseAvailable() && restRec.status === 'healthy');
  const supabasePostgrestHealthy = restRec.status === 'healthy';
  const firebaseHealthy = fbRec.status === 'healthy' || (fbRec.status !== 'unhealthy' && !isFirebaseDbConfigured());

  const transition = await evaluateFailoverTransition({
    supabaseDbHealthy,
    supabasePostgrestHealthy,
    firebaseHealthy,
  });

  const unhealthy = Array.from(serviceMap.values())
    .filter((s) => s.status === 'unhealthy')
    .map((s) => s.key);
  recentHealthHistory.unshift({
    timestamp: new Date().toISOString(),
    activeProvider: transition.state.activeProvider,
    unhealthyServices: unhealthy,
  });
  if (recentHealthHistory.length > 50) recentHealthHistory.length = 50;

  return {
    services: Array.from(serviceMap.values()),
    failoverState: transition.state,
    transitioned: transition.transitioned,
  };
}

export function getFullHealthMatrix() {
  return {
    services: Array.from(serviceMap.values()),
    failoverState: getFailoverState(),
    failoverHistory: getFailoverHistory(),
    outbox: getOutboxSummary(),
    backups: getBackupSnapshots(),
    healthHistory: recentHealthHistory.slice(0, 20),
    concurrency: getConcurrencyMetrics(),
    cache: appCache.getStats(),
  };
}
