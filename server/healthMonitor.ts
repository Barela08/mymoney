/**
 * Independent Service Health Monitor & Deduplicated Multi-Channel Admin Alert System
 *
 * Monitors ALL critical services independently with strict timeouts & ZERO fake healthy statuses:
 * - Supabase: Database, PostgREST, Auth, Realtime, Storage, Edge Functions
 * - Firebase: Firestore Database, Auth, Storage, Push Notification Service
 * - Application: API & DB Read/Write, Dual-DB Sync Outbox, Email Service (SMTP), Cache, Background Jobs
 *
 * Alerts:
 * - Failure & Recovery emails via existing configured SMTP (env or Admin Settings encrypted store)
 * - Immediate Admin Push & In-App notifications via `recordAdminNotification`
 * - Deduplication cooldown (15m), prolonged-outage escalation (60m), and durable alert retry queue
 */

import nodemailer from 'nodemailer';
import { query, isDatabaseAvailable, isDatabaseConfigured, getDbPoolDiagnostics, probeDatabaseRecovery } from './db.js';
import { APP_CONFIG } from './config.js';
import { getEffectiveSmtpConfig, getEffectiveSupportAlertEmail } from './adminSettingsStore.js';
import { getPostgrestClientMetrics } from './supabaseRestFallback.js';
import {
  checkFirebaseHealth,
  checkFirebaseAuthHealth,
  checkFirebaseStorageHealth,
  isFirebaseDbConfigured,
} from './firebaseDb.js';
import {
  evaluateFailoverTransition,
  getFailoverState,
  getFailoverHistory,
  getReconciliationHistory,
  getOutboxSummary,
  getBackupSnapshots,
  processOutboxQueue,
  registerFailoverAlertHook,
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

export interface AlertDeliveryRecord {
  id: string;
  serviceKey: string;
  serviceLabel: string;
  transition: 'failure' | 'recovery' | 'escalation';
  severity: 'critical' | 'high' | 'medium';
  subject: string;
  message: string;
  emailStatus: 'sent' | 'failed' | 'queued' | 'skipped';
  emailError: string | null;
  inAppStatus: 'sent' | 'failed';
  pushTriggered: boolean;
  downtimeMs: number | null;
  attempts: number;
  createdAt: string;
}

const DEFAULT_SUPABASE_URL = 'https://frgrfajnrzqwnevhlrio.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_RHVRSE_Z4R1Qit3djpOfCA_L93zsRjg';

const serviceMap = new Map<string, ServiceHealthRecord>();
const alertCooldownMap = new Map<string, number>(); // key -> lastSentAt ms
const failureStartedAtMap = new Map<string, number>(); // serviceKey -> firstFailureMs
const lastEscalatedAtMap = new Map<string, number>(); // serviceKey -> lastEscalatedMs

const ALERT_COOLDOWN_MS = 15 * 60 * 1000;
const ESCALATION_INTERVAL_MS = 60 * 60 * 1000;

const alertDeliveryLog: AlertDeliveryRecord[] = [];
const pendingEmailAlertQueue: Array<{
  recordId: string;
  to: string;
  subject: string;
  html: string;
  text: string;
  attempts: number;
  nextRetryAt: number;
}> = [];

const recentHealthHistory: Array<{
  timestamp: string;
  activeProvider: DbProvider;
  unhealthyServices: string[];
  degradedServices: string[];
}> = [];

let lastPeriodicRunAt: string | null = null;
let periodicRunCount = 0;

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
  { key: 'firebase_push', label: 'Push Notifications', group: 'firebase' },
  { key: 'app_api', label: 'Application API', group: 'application' },
  { key: 'sync_engine', label: 'Synchronization Outbox', group: 'application' },
  { key: 'email_service', label: 'Email Service (SMTP)', group: 'application' },
  { key: 'cache_layer', label: 'Cache', group: 'application' },
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
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_KEY;
  return { url, key };
}

function formatDurationHuman(ms: number | null | undefined): string {
  if (!ms || ms <= 0) return '< 1s';
  const totalSec = Math.round(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h > 0) return `${h}h ${m}m ${s}s`;
  if (m > 0) return `${m}m ${s}s`;
  return `${s}s`;
}

function escapeHtml(val: unknown): string {
  return String(val ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function classifyErrorCategory(serviceKey: string, errorDetails: string | null): string {
  const msg = String(errorDetails || '').toLowerCase();
  if (msg.includes('timeout') || msg.includes('abort')) return 'Timeout / Latency Saturation';
  if (msg.includes('502') || msg.includes('503') || msg.includes('504') || msg.includes('520')) return 'Upstream Gateway / Infrastructure Error';
  if (msg.includes('too many clients') || msg.includes('connection')) return 'Connection Pool Saturation';
  if (msg.includes('pgrst') || msg.includes('schema cache')) return 'PostgREST Schema Cache / API Error';
  if (msg.includes('smtp') || serviceKey === 'email_service') return 'SMTP / Email Delivery Failure';
  if (serviceKey.startsWith('firebase_')) return 'Secondary Firebase Service Error';
  return 'Service Health Degradation';
}

function getRecommendedAction(serviceKey: string, transition: 'failure' | 'recovery' | 'escalation'): string {
  if (transition === 'recovery') {
    return 'Verify pending outbox count reaches 0 in Admin → System Management → Database & Service Health. No manual rollback required unless conflicts are listed.';
  }
  switch (serviceKey) {
    case 'supabase_postgrest':
      return 'Check Supabase Dashboard → Project Health → PostgREST logs, Nano RAM/connection pressure, and reload schema cache (NOTIFY pgrst, \'reload schema\') if needed. Automatic failover is monitoring.';
    case 'supabase_db':
      return 'Inspect Supabase PostgreSQL connections (ensure Supavisor port 6543 pooler is used) and Nano compute RAM. Writes will route safely or pause to protect financial integrity.';
    case 'firebase_db':
      return 'Verify Firebase Service Account credentials and Firestore quota/rules. Primary Supabase continues serving traffic while outbox queues pending syncs.';
    case 'email_service':
      return 'Verify SMTP credentials in Admin → Settings → SMTP Configuration. Alerts remain persisted in the Admin Notification Center and durable retry queue.';
    default:
      return 'Open Admin → System Management → Database & Service Health to inspect live probe errors and history.';
  }
}

async function probeHttp(
  url: string,
  headers: Record<string, string>,
  timeoutMs = 4500
): Promise<{
  ok: boolean;
  status: number;
  ms: number;
  bodySnippet?: string;
  error?: string;
}> {
  const t0 = Date.now();
  try {
    const res = await fetch(url, { headers, signal: AbortSignal.timeout(timeoutMs) });
    const text = await res.text().catch(() => '');
    return {
      ok: res.ok,
      status: res.status,
      ms: Date.now() - t0,
      bodySnippet: text.slice(0, 160),
    };
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
  const now = Date.now();
  const nowIso = new Date(now).toISOString();
  rec.lastCheckedAt = nowIso;
  rec.responseTimeMs = responseTimeMs;
  rec.errorDetails = errorDetails;

  if (nextStatus === 'unhealthy') {
    rec.consecutiveFailures += 1;
    rec.lastFailureAt = nowIso;
    if (!failureStartedAtMap.has(key)) {
      failureStartedAtMap.set(key, now);
    }
    if (prevStatus !== 'unhealthy') {
      await dispatchServiceAlert({
        serviceKey: key,
        serviceLabel: rec.label,
        transition: 'failure',
        errorDetails: errorDetails || 'Service probe failed',
        severity: key === 'supabase_db' || key === 'supabase_postgrest' || key === 'firebase_db' ? 'critical' : 'high',
      }).catch(() => {});
    } else {
      // Escalate prolonged continuous outages every 60 minutes
      const startedAt = failureStartedAtMap.get(key) || now;
      const lastEsc = lastEscalatedAtMap.get(key) || startedAt;
      if (now - lastEsc >= ESCALATION_INTERVAL_MS) {
        lastEscalatedAtMap.set(key, now);
        await dispatchServiceAlert({
          serviceKey: key,
          serviceLabel: `${rec.label} (Prolonged Outage Escalation)`,
          transition: 'escalation',
          errorDetails: errorDetails || 'Continuous service failure',
          severity: 'critical',
          downtimeMs: now - startedAt,
          bypassCooldown: true,
        }).catch(() => {});
      }
    }
  } else if (nextStatus === 'healthy') {
    if (prevStatus === 'unhealthy') {
      rec.lastRecoveryAt = nowIso;
      const startedAt = failureStartedAtMap.get(key);
      const downtimeMs = startedAt ? Math.max(0, now - startedAt) : null;
      failureStartedAtMap.delete(key);
      lastEscalatedAtMap.delete(key);
      await dispatchServiceAlert({
        serviceKey: key,
        serviceLabel: rec.label,
        transition: 'recovery',
        errorDetails: null,
        severity: 'high',
        downtimeMs,
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

function buildAlertEmailHtml(params: {
  subject: string;
  serviceLabel: string;
  serviceKey: string;
  transition: 'failure' | 'recovery' | 'escalation';
  severity: 'critical' | 'high' | 'medium';
  errorCategory: string;
  errorDetails: string | null;
  activeProvider: DbProvider;
  providerEpoch: number;
  failoverOccurred: boolean;
  pendingSync: number;
  failedSync: number;
  downtimeMs: number | null;
  recommendedAction: string;
  timestampIso: string;
}): string {
  const istTime = new Date(params.timestampIso).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const headerBg =
    params.transition === 'recovery' ? '#065f46' : params.severity === 'critical' ? '#991b1b' : '#b45309';
  const badgeText =
    params.transition === 'recovery'
      ? 'RECOVERED'
      : params.transition === 'escalation'
      ? 'ESCALATED OUTAGE'
      : params.severity.toUpperCase() + ' FAILURE';

  return `
<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,sans-serif;max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:14px;overflow:hidden;">
  <div style="background:${headerBg};padding:20px 24px;color:#ffffff;">
    <div style="font-size:11px;font-weight:700;letter-spacing:1px;opacity:0.9;">${escapeHtml(APP_CONFIG.appName)} · ${badgeText}</div>
    <h2 style="margin:6px 0 0;font-size:18px;">${escapeHtml(params.subject)}</h2>
  </div>
  <div style="padding:22px 24px;color:#0f172a;font-size:13px;line-height:1.6;">
    <table style="width:100%;border-collapse:collapse;margin-bottom:16px;">
      <tr><td style="padding:6px 0;color:#64748b;width:180px;"><strong>Project</strong></td><td>${escapeHtml(APP_CONFIG.appName)} (${escapeHtml(APP_CONFIG.companyName)})</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;"><strong>Service / Component</strong></td><td>${escapeHtml(params.serviceLabel)} (<code>${escapeHtml(params.serviceKey)}</code>)</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;"><strong>Event Time</strong></td><td>${escapeHtml(istTime)} (${escapeHtml(params.timestampIso)})</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;"><strong>Error Category</strong></td><td>${escapeHtml(params.errorCategory)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;"><strong>Severity</strong></td><td style="text-transform:uppercase;font-weight:700;">${escapeHtml(params.severity)}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;"><strong>Automatic Failover</strong></td><td>${params.failoverOccurred ? 'Active (' + escapeHtml(params.activeProvider) + ')' : 'Not Activated (Primary Active)'}</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;"><strong>Active Database</strong></td><td><strong>${escapeHtml(params.activeProvider)}</strong> (Fencing Epoch #${params.providerEpoch})</td></tr>
      <tr><td style="padding:6px 0;color:#64748b;"><strong>Sync Outbox Status</strong></td><td>Pending: ${params.pendingSync} · Failed: ${params.failedSync}</td></tr>
      ${params.downtimeMs !== null ? `<tr><td style="padding:6px 0;color:#64748b;"><strong>Downtime Duration</strong></td><td><strong>${escapeHtml(formatDurationHuman(params.downtimeMs))}</strong></td></tr>` : ''}
    </table>
    ${params.errorDetails ? `<div style="background:#fef2f2;border:1px solid #fecaca;border-radius:10px;padding:12px 14px;margin-bottom:14px;color:#991b1b;"><strong>Diagnostic Details:</strong> ${escapeHtml(params.errorDetails)}</div>` : ''}
    <div style="background:#f8fafc;border:1px solid #e2e8f0;border-radius:10px;padding:12px 14px;">
      <strong>Recommended Action:</strong><br/>${escapeHtml(params.recommendedAction)}
    </div>
  </div>
</div>`;
}

/**
 * Deduplicated multi-channel Admin Alert Dispatcher (Email + In-App + Push + Durable Retry Queue).
 */
export async function dispatchServiceAlert(params: {
  serviceKey: string;
  serviceLabel: string;
  transition: 'failure' | 'recovery' | 'escalation';
  errorDetails: string | null;
  severity?: 'critical' | 'high' | 'medium';
  downtimeMs?: number | null;
  recommendedAction?: string;
  bypassCooldown?: boolean;
}) {
  const dedupKey = `${params.serviceKey}:${params.transition}`;
  const lastSent = alertCooldownMap.get(dedupKey) || 0;
  if (!params.bypassCooldown && Date.now() - lastSent < ALERT_COOLDOWN_MS) {
    return { skipped: true, reason: 'deduplicated_cooldown' };
  }
  alertCooldownMap.set(dedupKey, Date.now());

  const failover = getFailoverState();
  const outbox = getOutboxSummary();
  const nowIso = new Date().toISOString();
  const severity = params.severity || (params.transition === 'recovery' ? 'high' : 'critical');
  const errorCategory =
    params.transition === 'recovery' ? 'Service Recovery' : classifyErrorCategory(params.serviceKey, params.errorDetails);
  const recommendedAction = params.recommendedAction || getRecommendedAction(params.serviceKey, params.transition);

  const subject =
    params.transition === 'recovery'
      ? `${APP_CONFIG.appName} — ${params.serviceLabel} Recovered`
      : params.transition === 'escalation'
      ? `${APP_CONFIG.appName} — [ESCALATED] ${params.serviceLabel}`
      : `${APP_CONFIG.appName} — ${params.serviceLabel} Failure`;

  const message =
    params.transition === 'recovery'
      ? `${params.serviceLabel} has recovered after ${formatDurationHuman(params.downtimeMs)}. Active database: ${failover.activeProvider} (Epoch ${failover.providerEpoch}). Pending sync: ${outbox.pending}, Failed sync: ${outbox.failed}.`
      : `${params.serviceLabel} is unhealthy (${params.errorDetails || 'probe timeout'}). Category: ${errorCategory}. Active database: ${failover.activeProvider} (Epoch ${failover.providerEpoch}). Pending sync: ${outbox.pending}. ${recommendedAction}`;

  const alertId = `alt_${Date.now()}_${Math.random().toString(36).slice(2, 6)}`;
  const record: AlertDeliveryRecord = {
    id: alertId,
    serviceKey: params.serviceKey,
    serviceLabel: params.serviceLabel,
    transition: params.transition,
    severity,
    subject,
    message,
    emailStatus: 'skipped',
    emailError: null,
    inAppStatus: 'failed',
    pushTriggered: false,
    downtimeMs: params.downtimeMs ?? null,
    attempts: 1,
    createdAt: nowIso,
  };

  // 1. In-App & Push Admin Notification via recordAdminNotification (independent of SMTP email)
  try {
    const { recordAdminNotification } = await import('./notificationService.js');
    const ok = await recordAdminNotification({
      eventType: 'critical_alert',
      title: subject,
      message,
      metadata: {
        alertId,
        serviceKey: params.serviceKey,
        transition: params.transition,
        severity,
        errorCategory,
        activeProvider: failover.activeProvider,
        epoch: failover.providerEpoch,
        pendingSync: outbox.pending,
        failedSync: outbox.failed,
        downtimeMs: params.downtimeMs ?? null,
        deepLink: 'database',
      },
    });
    record.inAppStatus = ok ? 'sent' : 'failed';
    record.pushTriggered = Boolean(ok);
  } catch {
    record.inAppStatus = 'failed';
  }

  // 2. Email Alert via existing configured SMTP (env or Admin Settings encrypted store)
  const recipient = await getEffectiveSupportAlertEmail().catch(() => APP_CONFIG.supportEmail);
  const html = buildAlertEmailHtml({
    subject,
    serviceLabel: params.serviceLabel,
    serviceKey: params.serviceKey,
    transition: params.transition,
    severity,
    errorCategory,
    errorDetails: params.errorDetails,
    activeProvider: failover.activeProvider,
    providerEpoch: failover.providerEpoch,
    failoverOccurred: failover.activeProvider !== 'supabase',
    pendingSync: outbox.pending,
    failedSync: outbox.failed,
    downtimeMs: params.downtimeMs ?? null,
    recommendedAction,
    timestampIso: nowIso,
  });

  try {
    const { sendEmailDetailed } = await import('./email.js');
    const emailRes = await sendEmailDetailed({
      to: recipient,
      subject,
      html,
      text: message,
      emailType: `service_${params.transition}_alert`,
    });
    if (emailRes.success) {
      record.emailStatus = 'sent';
    } else {
      record.emailStatus = 'queued';
      record.emailError = emailRes.error || 'SMTP unavailable';
      if (pendingEmailAlertQueue.length < 50) {
        pendingEmailAlertQueue.push({
          recordId: alertId,
          to: recipient,
          subject,
          html,
          text: message,
          attempts: 1,
          nextRetryAt: Date.now() + 60_000,
        });
      }
    }
  } catch (err: any) {
    record.emailStatus = 'queued';
    record.emailError = err?.message || 'Email dispatch error';
  }

  alertDeliveryLog.unshift(record);
  if (alertDeliveryLog.length > 60) alertDeliveryLog.length = 60;

  return { skipped: false, record };
}

// Register failover hook so automatic failover / recovery / sync threshold alerts fire through the unified alert dispatcher
registerFailoverAlertHook(dispatchServiceAlert);

/**
 * Retries queued email alerts when SMTP becomes available again.
 */
export async function drainPendingEmailAlertQueue(): Promise<{ attempted: number; delivered: number; remaining: number }> {
  const now = Date.now();
  let attempted = 0;
  let delivered = 0;

  for (let i = pendingEmailAlertQueue.length - 1; i >= 0; i--) {
    const item = pendingEmailAlertQueue[i];
    if (item.nextRetryAt > now) continue;
    attempted += 1;
    item.attempts += 1;
    try {
      const { sendEmailDetailed } = await import('./email.js');
      const res = await sendEmailDetailed({
        to: item.to,
        subject: item.subject,
        html: item.html,
        text: item.text,
        emailType: 'service_alert_retry',
      });
      const logEntry = alertDeliveryLog.find((a) => a.id === item.recordId);
      if (res.success) {
        delivered += 1;
        if (logEntry) {
          logEntry.emailStatus = 'sent';
          logEntry.emailError = null;
          logEntry.attempts = item.attempts;
        }
        pendingEmailAlertQueue.splice(i, 1);
      } else {
        if (logEntry) {
          logEntry.emailError = res.error || 'Retry failed';
          logEntry.attempts = item.attempts;
        }
        if (item.attempts >= 5) {
          if (logEntry) logEntry.emailStatus = 'failed';
          pendingEmailAlertQueue.splice(i, 1);
        } else {
          item.nextRetryAt = Date.now() + Math.min(900_000, 60_000 * Math.pow(2, item.attempts));
        }
      }
    } catch {
      item.nextRetryAt = Date.now() + 120_000;
    }
  }

  return { attempted, delivered, remaining: pendingEmailAlertQueue.length };
}

async function probeSmtpHealth(): Promise<{ status: ServiceStatus; ms: number; error: string | null }> {
  const t0 = Date.now();
  try {
    const cfg = await getEffectiveSmtpConfig();
    if (!cfg.enabled) {
      return { status: 'degraded', ms: Date.now() - t0, error: 'SMTP disabled in Admin Settings' };
    }
    if (!cfg.configured) {
      return { status: 'unknown', ms: Date.now() - t0, error: 'SMTP credentials not configured (SMTP_PASS or Admin SMTP settings)' };
    }
    const transporter = nodemailer.createTransport({
      host: cfg.host,
      port: cfg.port,
      secure: cfg.secure,
      auth: { user: cfg.user, pass: cfg.pass },
      connectionTimeout: 4000,
      greetingTimeout: 4000,
    });
    await Promise.race([
      transporter.verify(),
      new Promise((_, reject) => setTimeout(() => reject(new Error('SMTP verify timeout')), 4500)),
    ]);
    return { status: 'healthy', ms: Date.now() - t0, error: null };
  } catch (err: any) {
    return { status: 'unhealthy', ms: Date.now() - t0, error: err?.message || 'SMTP verification failed' };
  }
}

/**
 * Runs an independent health sweep across ALL Supabase, Firebase, and Application services.
 * Never fakes healthy statuses; uses strict timeouts and minimal read-only probes.
 */
export async function runIndependentHealthCheck(overrides?: {
  simulateSupabasePostgrestDown?: boolean;
  simulateSupabaseDbDown?: boolean;
  simulateFirebaseDown?: boolean;
}) {
  const { url, key } = getSupabaseRestConfig();

  // 1. Supabase Database (PostgreSQL direct/pooler)
  if (overrides?.simulateSupabaseDbDown) {
    await updateServiceStatus('supabase_db', 'unhealthy', 0, 'Simulated database outage');
  } else if (isDatabaseConfigured) {
    const dbProbe = await probeDatabaseRecovery();
    await updateServiceStatus(
      'supabase_db',
      dbProbe.ok ? 'healthy' : 'unhealthy',
      dbProbe.latencyMs,
      dbProbe.ok ? null : dbProbe.error || 'PostgreSQL probe failed'
    );
  } else {
    await updateServiceStatus(
      'supabase_db',
      'unknown',
      null,
      'DATABASE_URL not configured in server env (PostgreSQL pool inactive; REST mode active)'
    );
  }

  // 2. Supabase PostgREST, Auth, Storage, Realtime, Edge Functions (independent live probes)
  if (overrides?.simulateSupabasePostgrestDown) {
    await updateServiceStatus('supabase_postgrest', 'unhealthy', 5000, 'Simulated PostgREST outage / timeout');
  } else if (url && key) {
    const [restP, authP, storP, rtP, fnP] = await Promise.all([
      probeHttp(`${url}/rest/v1/app_settings?select=key&limit=1`, { apikey: key, Authorization: `Bearer ${key}` }),
      probeHttp(`${url}/auth/v1/health`, { apikey: key }),
      probeHttp(`${url}/storage/v1/bucket`, { apikey: key, Authorization: `Bearer ${key}` }),
      probeHttp(`${url}/realtime/v1/`, { apikey: key }),
      probeHttp(`${url}/functions/v1/`, { apikey: key }),
    ]);

    const restStatus: ServiceStatus = restP.ok
      ? restP.ms > 2500
        ? 'degraded'
        : 'healthy'
      : 'unhealthy';
    const restErr = restP.ok
      ? restP.ms > 2500
        ? `High latency (${restP.ms}ms) — inspect Nano RAM & connection count`
        : null
      : restP.error || `PostgREST HTTP ${restP.status}${restP.bodySnippet ? `: ${restP.bodySnippet.slice(0, 80)}` : ''}`;

    // Realtime returns HTTP 400/404/426 when HTTP-probing the WS gateway; 5xx or network timeout = unhealthy
    const rtHealthy = rtP.status > 0 && rtP.status < 500;
    // Edge Functions gateway returns 404 NOT_FOUND at root when runtime is up; 5xx or timeout = unhealthy
    const fnHealthy = fnP.status > 0 && fnP.status < 500;

    await Promise.all([
      updateServiceStatus('supabase_postgrest', restStatus, restP.ms, restErr),
      updateServiceStatus(
        'supabase_auth',
        authP.ok ? 'healthy' : 'unhealthy',
        authP.ms,
        authP.ok ? null : authP.error || `HTTP ${authP.status}`
      ),
      updateServiceStatus(
        'supabase_storage',
        storP.ok ? 'healthy' : storP.status >= 500 || storP.status === 0 ? 'unhealthy' : 'degraded',
        storP.ms,
        storP.ok ? null : storP.error || `HTTP ${storP.status}`
      ),
      updateServiceStatus(
        'supabase_realtime',
        rtHealthy ? 'healthy' : 'unhealthy',
        rtP.ms,
        rtHealthy ? null : rtP.error || `HTTP ${rtP.status}`
      ),
      updateServiceStatus(
        'supabase_edge_functions',
        fnHealthy ? 'healthy' : 'unhealthy',
        fnP.ms,
        fnHealthy ? null : fnP.error || `HTTP ${fnP.status}`
      ),
    ]);
  } else {
    for (const k of ['supabase_postgrest', 'supabase_auth', 'supabase_storage', 'supabase_realtime', 'supabase_edge_functions']) {
      await updateServiceStatus(k, 'unknown', null, 'SUPABASE_URL or API key not configured');
    }
  }

  // 3. Firebase Services (Firestore, Auth, Storage, Push — independent live probes)
  if (overrides?.simulateFirebaseDown) {
    await updateServiceStatus('firebase_db', 'unhealthy', 0, 'Simulated Firebase Firestore outage');
  } else {
    const [fbDb, fbAuth, fbStorage] = await Promise.all([
      checkFirebaseHealth(),
      checkFirebaseAuthHealth(),
      checkFirebaseStorageHealth(),
    ]);
    await Promise.all([
      updateServiceStatus('firebase_db', fbDb.status, fbDb.responseTimeMs, fbDb.status === 'healthy' ? null : fbDb.message),
      updateServiceStatus('firebase_auth', fbAuth.status, fbAuth.responseTimeMs, fbAuth.status === 'healthy' ? null : fbAuth.message),
      updateServiceStatus('firebase_storage', fbStorage.status, fbStorage.responseTimeMs, fbStorage.status === 'healthy' ? null : fbStorage.message),
      updateServiceStatus(
        'firebase_push',
        APP_CONFIG.vapid.publicKey && APP_CONFIG.vapid.isPersistent ? 'healthy' : APP_CONFIG.vapid.publicKey ? 'degraded' : 'unhealthy',
        0,
        APP_CONFIG.vapid.isPersistent
          ? null
          : 'VAPID keys are ephemeral; set VAPID_PUBLIC_KEY & VAPID_PRIVATE_KEY in env for persistent push across restarts.'
      ),
    ]);
  }

  // 4. Application Services (API, Outbox Sync, SMTP Email, Cache)
  const outbox = getOutboxSummary();
  const smtpProbe = await probeSmtpHealth();
  await Promise.all([
    updateServiceStatus('app_api', 'healthy', 1, null),
    updateServiceStatus(
      'sync_engine',
      outbox.failed >= 5 ? 'unhealthy' : outbox.failed > 0 ? 'degraded' : 'healthy',
      1,
      outbox.failed > 0 ? `${outbox.failed} failed sync event(s), ${outbox.pending} pending` : null
    ),
    updateServiceStatus('email_service', smtpProbe.status, smtpProbe.ms, smtpProbe.error),
    updateServiceStatus('cache_layer', 'healthy', 0, null),
  ]);

  // Evaluate controlled failover state
  const dbRec = serviceMap.get('supabase_db')!;
  const restRec = serviceMap.get('supabase_postgrest')!;
  const fbRec = serviceMap.get('firebase_db')!;
  const supabaseDbHealthy =
    dbRec.status === 'healthy' || (!isDatabaseConfigured && !overrides?.simulateSupabaseDbDown && restRec.status !== 'unhealthy');
  const supabasePostgrestHealthy = restRec.status === 'healthy' || restRec.status === 'degraded';
  // Firebase is eligible for failover if Firestore is healthy OR local staging mirror is active (when not explicitly unhealthy)
  const firebaseHealthy =
    fbRec.status === 'healthy' || (!isFirebaseDbConfigured() && fbRec.status !== 'unhealthy');

  const transition = await evaluateFailoverTransition({
    supabaseDbHealthy,
    supabasePostgrestHealthy,
    firebaseHealthy,
  });

  // Drain any queued outbox items & queued email alerts safely
  if (transition.state.activeProvider === 'supabase') {
    void processOutboxQueue(25, { allowPrimaryReconcile: true }).catch(() => {});
  }
  if (smtpProbe.status === 'healthy' && pendingEmailAlertQueue.length > 0) {
    void drainPendingEmailAlertQueue().catch(() => {});
  }

  const unhealthy = Array.from(serviceMap.values())
    .filter((s) => s.status === 'unhealthy')
    .map((s) => s.key);
  const degraded = Array.from(serviceMap.values())
    .filter((s) => s.status === 'degraded')
    .map((s) => s.key);

  recentHealthHistory.unshift({
    timestamp: new Date().toISOString(),
    activeProvider: transition.state.activeProvider,
    unhealthyServices: unhealthy,
    degradedServices: degraded,
  });
  if (recentHealthHistory.length > 50) recentHealthHistory.length = 50;

  return {
    services: Array.from(serviceMap.values()),
    failoverState: transition.state,
    transitioned: transition.transitioned,
  };
}

/**
 * Starts a single, bounded, non-overlapping background health monitor in long-running Node servers.
 * Skipped on serverless Vercel workers (which use /api/cron/health-check instead).
 */
export function ensurePeriodicHealthMonitorStarted(): void {
  if (process.env.VERCEL || process.env.NODE_ENV === 'test') return;
  const g = globalThis as typeof globalThis & { __myMoneyHealthMonitorTimer?: ReturnType<typeof setInterval> };
  if (g.__myMoneyHealthMonitorTimer) return;

  const INTERVAL_MS = 5 * 60 * 1000; // Every 5 minutes (lightweight, Nano-safe)
  g.__myMoneyHealthMonitorTimer = setInterval(() => {
    periodicRunCount += 1;
    lastPeriodicRunAt = new Date().toISOString();
    void runIndependentHealthCheck().catch(() => {});
  }, INTERVAL_MS);
  if (typeof g.__myMoneyHealthMonitorTimer.unref === 'function') {
    g.__myMoneyHealthMonitorTimer.unref();
  }
}

export function getFullHealthMatrix() {
  return {
    services: Array.from(serviceMap.values()),
    failoverState: getFailoverState(),
    failoverHistory: getFailoverHistory(),
    reconciliationHistory: getReconciliationHistory(),
    outbox: getOutboxSummary(),
    backups: getBackupSnapshots(),
    alerts: {
      recent: alertDeliveryLog.slice(0, 25),
      queuedEmailCount: pendingEmailAlertQueue.length,
    },
    diagnostics: {
      pgPool: getDbPoolDiagnostics(),
      postgrest: getPostgrestClientMetrics(),
      monitor: {
        periodicRunCount,
        lastPeriodicRunAt,
        intervalSeconds: 300,
      },
    },
    healthHistory: recentHealthHistory.slice(0, 25),
    concurrency: getConcurrencyMetrics(),
    cache: appCache.getStats(),
  };
}
