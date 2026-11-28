import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  XCircle,
  Activity,
  ShieldCheck,
  Bell,
  Clock,
  GitCompare,
  History,
  Server,
  HardDrive,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

const formatIst = (iso?: string | null): string => {
  if (!iso) return '—';
  try {
    return new Date(iso).toLocaleString('en-IN', {
      timeZone: 'Asia/Kolkata',
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    });
  } catch {
    return String(iso);
  }
};

const formatBytes = (bytes?: number | null): string => {
  if (bytes === null || bytes === undefined || !Number.isFinite(Number(bytes))) return '—';
  const n = Number(bytes);
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(2)} MB`;
};

const statusBadgeClass = (status: string): string => {
  switch (status) {
    case 'healthy':
    case 'verified':
    case 'completed':
    case 'synced':
      return 'bg-emerald-500/15 text-emerald-400 border-emerald-500/30';
    case 'degraded':
    case 'pending':
    case 'queued':
      return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
    case 'unhealthy':
    case 'failed':
      return 'bg-rose-500/15 text-rose-400 border-rose-500/30';
    default:
      return 'bg-slate-800 text-slate-400 border-slate-700';
  }
};

export const AdminDatabaseTab: React.FC = () => {
  const toast = useToast();
  const [databaseInfo, setDatabaseInfo] = useState<any>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [healthMatrix, setHealthMatrix] = useState<any>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isTriggeringBackup, setIsTriggeringBackup] = useState<boolean>(false);
  const [isProbingHealth, setIsProbingHealth] = useState<boolean>(false);
  const [isSyncBusy, setIsSyncBusy] = useState<boolean>(false);
  const [isAlertRetryBusy, setIsAlertRetryBusy] = useState<boolean>(false);

  const fetchData = useCallback(async () => {
    setIsLoading(true);
    const start = Date.now();
    try {
      const [dbRes, bkRes, hmRes] = await Promise.all([
        adminClient.getDatabaseDiagnostics().catch(() => ({ success: false })),
        adminClient.getSystemBackups().catch(() => ({ success: false, backups: [] })),
        adminClient.getDatabaseHealthMatrix().catch(() => null),
      ]);
      setLatencyMs(Date.now() - start);

      if (dbRes?.success) {
        setDatabaseInfo(dbRes.database);
      }
      if (bkRes?.success && Array.isArray(bkRes.backups)) {
        setBackups(bkRes.backups);
      }
      if (hmRes?.success && hmRes.matrix) {
        setHealthMatrix(hmRes.matrix);
      }
    } catch (err: any) {
      toast.error('Diagnostics failed', err?.message || 'Unable to load database health data.');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const handleRunHealthProbe = async () => {
    setIsProbingHealth(true);
    try {
      const res = await adminClient.runDatabaseHealthCheck();
      if (res?.success && res.matrix) {
        setHealthMatrix(res.matrix);
        toast.success('Live Health Sweep Complete', 'All 14 Supabase, Firebase & App services were probed independently.');
      }
    } catch (err: any) {
      toast.error('Health Probe Failed', err?.message || 'Could not execute health probe.');
    } finally {
      setIsProbingHealth(false);
    }
  };

  const handleRetryOutbox = async () => {
    setIsSyncBusy(true);
    try {
      const res = await adminClient.retryOutboxSync();
      if (res?.success) {
        if (res.matrix) setHealthMatrix(res.matrix);
        toast.success(
          'Outbox Retry Complete',
          `Retried: ${res.result?.retried ?? 0} · Synced: ${res.result?.synced ?? 0} · Failed: ${res.result?.failed ?? 0}`
        );
      }
    } catch (err: any) {
      toast.error('Outbox Retry Failed', err?.message || 'Unable to retry outbox events.');
    } finally {
      setIsSyncBusy(false);
    }
  };

  const handleReconcile = async () => {
    setIsSyncBusy(true);
    try {
      const res = await adminClient.reconcileDualDatabases();
      if (res?.success) {
        if (res.matrix) setHealthMatrix(res.matrix);
        toast.success(
          'Dual-Database Reconciliation Complete',
          `Outbox processed: ${res.result?.outboxProcessed ?? 0} · Synced: ${res.result?.outboxSynced ?? 0} · Conflicts: ${res.result?.conflictsDetected ?? 0}`
        );
      }
    } catch (err: any) {
      toast.error('Reconciliation Failed', err?.message || 'Could not reconcile primary and secondary stores.');
    } finally {
      setIsSyncBusy(false);
    }
  };

  const handleTriggerBackupVerify = async () => {
    setIsTriggeringBackup(true);
    try {
      const res = await adminClient.triggerSystemBackup('manual_verified');
      if (res?.success) {
        toast.success(
          'Backup & Restore Verified',
          res.message || `Verified SHA-256 snapshot (${res.snapshot?.totalRecords ?? 0} records).`
        );
        await fetchData();
      }
    } catch (err: any) {
      toast.error('Backup Failed', err?.message || 'Unable to create verified snapshot.');
    } finally {
      setIsTriggeringBackup(false);
    }
  };

  const handleRetryAlerts = async () => {
    setIsAlertRetryBusy(true);
    try {
      const res = await adminClient.retryPendingHealthAlerts();
      if (res?.success) {
        if (res.matrix) setHealthMatrix(res.matrix);
        toast.success(
          'Alert Queue Processed',
          `Attempted: ${res.result?.attempted ?? 0} · Delivered: ${res.result?.delivered ?? 0} · Remaining: ${res.result?.remaining ?? 0}`
        );
      }
    } catch (err: any) {
      toast.error('Alert Retry Failed', err?.message || 'Could not drain queued alerts.');
    } finally {
      setIsAlertRetryBusy(false);
    }
  };

  const failoverState = healthMatrix?.failoverState || databaseInfo?.failoverState || null;
  const activeProvider: string = failoverState?.activeProvider || 'unknown';
  const pgPool = healthMatrix?.diagnostics?.pgPool || databaseInfo?.pgPool || null;
  const postgrest = healthMatrix?.diagnostics?.postgrest || databaseInfo?.postgrest || null;
  const services: any[] = Array.isArray(healthMatrix?.services) ? healthMatrix.services : [];

  const supabaseServices = services.filter((s) => s.category === 'supabase');
  const firebaseServices = services.filter((s) => s.category === 'firebase');
  const appServices = services.filter((s) => s.category === 'application');

  const outbox = healthMatrix?.outbox || null;
  const failoverHistory: any[] = Array.isArray(healthMatrix?.failoverHistory) ? healthMatrix.failoverHistory : [];
  const reconciliationHistory: any[] = Array.isArray(healthMatrix?.reconciliationHistory)
    ? healthMatrix.reconciliationHistory
    : [];
  const healthHistory: any[] = Array.isArray(healthMatrix?.healthHistory) ? healthMatrix.healthHistory : [];
  const recentAlerts: any[] = Array.isArray(healthMatrix?.alerts?.recent) ? healthMatrix.alerts.recent : [];
  const queuedEmailCount: number = Number(healthMatrix?.alerts?.queuedEmailCount || 0);

  const providerBannerStyles =
    activeProvider === 'supabase'
      ? 'bg-emerald-500/10 text-emerald-300 border-emerald-500/30'
      : activeProvider === 'firebase'
      ? 'bg-amber-500/15 text-amber-300 border-amber-500/35'
      : activeProvider === 'degraded_readonly'
      ? 'bg-rose-500/15 text-rose-300 border-rose-500/35'
      : 'bg-slate-800 text-slate-300 border-slate-700';

  const providerLabel =
    activeProvider === 'supabase'
      ? 'Supabase Primary Active'
      : activeProvider === 'firebase'
      ? 'Firebase Secondary Failover Active'
      : activeProvider === 'degraded_readonly'
      ? 'Degraded Read-Only Mode (Writes Blocked)'
      : 'Probing Active Database';

  const renderServiceGroup = (title: string, subtitle: string, group: any[]) => (
    <div className="space-y-2.5">
      <div className="flex items-center justify-between">
        <div>
          <h4 className="text-xs font-bold text-slate-200 uppercase tracking-wider">{title}</h4>
          <p className="text-[11px] text-slate-500">{subtitle}</p>
        </div>
        <span className="text-[11px] font-mono text-slate-400">
          {group.filter((s) => s.status === 'healthy').length}/{group.length} healthy
        </span>
      </div>
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2.5">
        {group.map((svc) => (
          <div
            key={svc.key}
            className="p-3 rounded-xl bg-slate-950/70 border border-slate-800 hover:border-slate-700 transition-colors space-y-1.5"
          >
            <div className="flex items-center justify-between gap-2">
              <span className="text-xs font-semibold text-white truncate">{svc.label}</span>
              <span
                className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase border ${statusBadgeClass(
                  svc.status
                )}`}
              >
                {svc.status}
              </span>
            </div>
            <div className="flex items-center justify-between text-[10px] font-mono text-slate-400">
              <span>Latency: {svc.responseTimeMs !== null && svc.responseTimeMs !== undefined ? `${svc.responseTimeMs}ms` : '—'}</span>
              <span>Checked: {svc.lastCheckedAt ? formatIst(svc.lastCheckedAt) : 'Not probed'}</span>
            </div>
            {(svc.lastFailureAt || svc.lastRecoveryAt) && (
              <div className="flex flex-wrap gap-x-3 gap-y-0.5 text-[10px] text-slate-500 font-mono">
                {svc.lastFailureAt && <span>Last fail: {formatIst(svc.lastFailureAt)}</span>}
                {svc.lastRecoveryAt && <span>Recovered: {formatIst(svc.lastRecoveryAt)}</span>}
              </div>
            )}
            {svc.errorDetails && (
              <p
                className="text-[10px] text-rose-300 bg-rose-500/10 border border-rose-500/20 rounded-lg px-2 py-1 leading-snug break-words"
                title={svc.errorDetails}
              >
                {svc.errorDetails}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      {/* Top Status Header & Global Actions */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-4">
        <div className="flex flex-col lg:flex-row items-start lg:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-blue-500/10 text-blue-400 border border-blue-500/20 shrink-0">
              <Database className="w-5 h-5 stroke-[1.75]" />
            </div>
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 className="text-base font-bold text-white">Database &amp; Service Health</h2>
                <span className={`text-[11px] font-bold px-2.5 py-0.5 rounded-md border ${providerBannerStyles}`}>
                  {providerLabel}
                </span>
                {failoverState && (
                  <span className="text-[11px] font-mono px-2 py-0.5 rounded-md bg-slate-800 text-slate-300 border border-slate-700">
                    Epoch #{failoverState.providerEpoch}
                  </span>
                )}
              </div>
              <p className="text-xs text-slate-400 mt-1 max-w-3xl leading-relaxed">
                Independent live telemetry across Supabase (Primary), Firebase Firestore (Synchronized Secondary &amp; Controlled Failover), transactional outbox replication, and verified logical recovery snapshots. Secrets, keys, and raw connection strings are never exposed.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleRunHealthProbe}
              disabled={isProbingHealth}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              <Activity className={`w-3.5 h-3.5 ${isProbingHealth ? 'animate-pulse' : ''}`} />
              <span>{isProbingHealth ? 'Probing 14 Services...' : 'Run Health Probe'}</span>
            </button>
            <button
              type="button"
              onClick={handleReconcile}
              disabled={isSyncBusy}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              <GitCompare className="w-3.5 h-3.5" />
              <span>{isSyncBusy ? 'Syncing...' : 'Reconcile Dual DBs'}</span>
            </button>
            <button
              type="button"
              onClick={handleTriggerBackupVerify}
              disabled={isTriggeringBackup}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold transition-colors cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isTriggeringBackup ? 'Verifying...' : 'Backup & Verify Restore'}</span>
            </button>
            <button
              type="button"
              onClick={() => void fetchData()}
              className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white transition-colors cursor-pointer"
              title="Refresh Diagnostics"
            >
              <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            </button>
          </div>
        </div>

        {/* Failover Reason / Lease Strip */}
        {failoverState && (
          <div className="grid grid-cols-1 md:grid-cols-4 gap-3 pt-3 border-t border-slate-800 text-xs">
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Failover Policy</span>
              <p className="text-slate-200 font-mono mt-1">
                {failoverState.failoverThreshold} fails → switch · {failoverState.recoveryThreshold} ok → recover
              </p>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                Current streaks: {failoverState.consecutivePrimaryFailures} fail / {failoverState.consecutivePrimaryRecoveries} ok
              </span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Failover Lease Owner</span>
              <p className="text-slate-200 font-mono mt-1 truncate" title={failoverState.leaseOwner}>
                {failoverState.leaseOwner || '—'}
              </p>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                Last transition: {failoverState.lastTransitionAt ? formatIst(failoverState.lastTransitionAt) : 'None yet'}
              </span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Sync Outbox Status</span>
              <p className="text-slate-200 font-mono mt-1">
                <span className="text-amber-400">{outbox?.pending ?? 0} pending</span> ·{' '}
                <span className="text-emerald-400">{outbox?.synced ?? 0} synced</span> ·{' '}
                <span className="text-rose-400">{outbox?.failed ?? 0} failed</span>
              </p>
              <span className="text-[10px] text-slate-500 block mt-0.5">
                Mirror mode: {outbox?.mirrorStats?.mode || 'checking'} ({outbox?.mirrorStats?.totalDocs ?? 0} mirrored docs)
              </span>
            </div>
            <div className="bg-slate-950/60 border border-slate-800 rounded-xl p-3">
              <span className="text-[10px] uppercase tracking-wider text-slate-500 font-semibold">Transition Reason</span>
              <p className="text-slate-300 mt-1 line-clamp-2" title={failoverState.reason}>
                {failoverState.reason}
              </p>
            </div>
          </div>
        )}
      </div>

      {/* Live Infrastructure & Nano Resource KPI Row */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">PostgreSQL Pool Mode</span>
            <Server className="w-4 h-4 text-blue-400" />
          </div>
          <p className="text-sm font-bold text-white mt-1 capitalize">
            {pgPool?.configured
              ? pgPool.mode === 'supavisor_transaction'
                ? 'Supavisor Pooler (6543)'
                : pgPool.mode === 'direct_postgres'
                ? 'Direct PostgreSQL (5432)'
                : 'Configured Pool'
              : 'Not Configured (REST Only)'}
          </p>
          <span className="text-[10px] text-slate-400 mt-1 block font-mono">
            {pgPool?.configured
              ? `Active: ${pgPool.totalCount}/${pgPool.maxConnections} · Idle: ${pgPool.idleCount} · Wait: ${pgPool.waitingCount}`
              : 'Set DATABASE_URL (port 6543) for PG pool'}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">PostgREST Client Telemetry</span>
            <Activity className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-sm font-bold font-mono text-white mt-1">
            {postgrest ? `${postgrest.avgLatencyMs}ms avg` : latencyMs !== null ? `${latencyMs}ms` : '—'}
          </p>
          <span className="text-[10px] text-slate-400 mt-1 block font-mono">
            {postgrest
              ? `Req: ${postgrest.totalRequests} · 5xx: ${postgrest.http5xx} · Timeouts: ${postgrest.timeouts}`
              : 'Awaiting live PostgREST requests'}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">Observed Public Tables</span>
            <HardDrive className="w-4 h-4 text-indigo-400" />
          </div>
          <p className="text-lg font-bold font-mono text-white mt-1">
            {Array.isArray(databaseInfo?.tables) ? databaseInfo.tables.length : '—'}
          </p>
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            {Array.isArray(databaseInfo?.tables) && databaseInfo.tables.length > 0
              ? 'From pg_stat_user_tables'
              : 'Requires DATABASE_URL PG access'}
          </span>
        </div>

        <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-medium text-slate-400">Admin Diagnostic RTT</span>
            <ShieldCheck className="w-4 h-4 text-emerald-400" />
          </div>
          <p className="text-lg font-bold font-mono text-emerald-400 mt-1">
            {latencyMs !== null ? `${latencyMs}ms` : '—'}
          </p>
          <span className="text-[10px] text-slate-500 mt-0.5 block">
            Monitor interval: {healthMatrix?.diagnostics?.monitor?.intervalSeconds ?? 300}s
          </span>
        </div>
      </div>

      {/* Nano / Pool Recommendation Callout if present */}
      {pgPool?.recommendation && (
        <div className="bg-amber-500/10 border border-amber-500/30 rounded-xl px-4 py-3 flex items-start gap-2.5 text-xs text-amber-200">
          <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div>
            <span className="font-bold">Infrastructure Advisory: </span>
            <span>{pgPool.recommendation}</span>
          </div>
        </div>
      )}

      {/* 14 Independent Services Health Matrix */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 space-y-5">
        <div className="flex items-center justify-between border-b border-slate-800 pb-3">
          <div>
            <h3 className="text-sm font-bold text-white flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-400" />
              <span>14-Service Independent Health Matrix</span>
            </h3>
            <p className="text-[11px] text-slate-400 mt-0.5">
              Each service is probed independently with strict timeouts. Unknown/unconfigured services are reported honestly and never marked healthy.
            </p>
          </div>
          <span className="text-xs font-mono text-slate-400">
            {services.filter((s) => s.status === 'healthy').length}/{services.length || 14} healthy
          </span>
        </div>

        {services.length === 0 ? (
          <div className="py-8 text-center text-xs text-slate-500">
            No probe snapshot loaded yet. Click <strong>Run Health Probe</strong> to check all 14 services live.
          </div>
        ) : (
          <div className="space-y-5">
            {renderServiceGroup('Supabase Services (Primary)', 'Database, PostgREST, Auth, Realtime, Storage, Edge Functions', supabaseServices)}
            {renderServiceGroup('Firebase Services (Secondary & Push)', 'Firestore Secondary DB, Firebase Auth, Storage, Push Delivery', firebaseServices)}
            {renderServiceGroup('Application Services', 'API Runtime, Transactional Outbox Sync Engine, SMTP Email, Cache', appServices)}
          </div>
        )}
      </div>

      {/* Synchronization Outbox Queue & Reconciliation History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40 flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-xs font-bold text-slate-200">Transactional Sync Outbox Queue</h3>
              <p className="text-[10px] text-slate-500">
                Idempotent Supabase ↔ Firebase replication events ({outbox?.total ?? 0} tracked)
              </p>
            </div>
            <button
              type="button"
              onClick={handleRetryOutbox}
              disabled={isSyncBusy}
              className="px-2.5 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            >
              Retry Failed Syncs ({outbox?.failed ?? 0})
            </button>
          </div>
          <div className="max-h-72 overflow-y-auto">
            {!outbox || ((outbox.recentEvents?.length ?? 0) === 0 && (outbox.recentFailed?.length ?? 0) === 0) ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No outbox events recorded in the current worker memory yet. New profile, transaction, and Udhar writes will appear here automatically.
              </div>
            ) : (
              <table className="w-full text-left text-[11px]">
                <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 sticky top-0">
                  <tr>
                    <th className="py-2 px-3">Collection / Record</th>
                    <th className="py-2 px-3">Direction</th>
                    <th className="py-2 px-3">Status</th>
                    <th className="py-2 px-3 text-right">Attempts</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-800/60 text-slate-300">
                  {(outbox.recentEvents || []).map((ev: any) => (
                    <tr key={ev.id} className="hover:bg-slate-800/30">
                      <td className="py-2 px-3">
                        <div className="font-mono text-emerald-400">{ev.collection}</div>
                        <div className="text-[10px] text-slate-500 font-mono truncate max-w-[160px]" title={ev.recordId}>
                          {ev.recordId} · v{ev.syncVersion}
                        </div>
                        {ev.lastError && (
                          <div className="text-[10px] text-rose-400 truncate max-w-[200px]" title={ev.lastError}>
                            {ev.lastError}
                          </div>
                        )}
                      </td>
                      <td className="py-2 px-3 font-mono text-[10px] text-slate-400">
                        {ev.sourceDb} → {ev.targetDb}
                      </td>
                      <td className="py-2 px-3">
                        <span className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase ${statusBadgeClass(ev.status)}`}>
                          {ev.status}
                        </span>
                      </td>
                      <td className="py-2 px-3 text-right font-mono text-slate-400">{ev.attempts}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </div>

        {/* Reconciliation History */}
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden flex flex-col">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
            <div>
              <h3 className="text-xs font-bold text-slate-200">Reconciliation Runs</h3>
              <p className="text-[10px] text-slate-500">Primary ↔ Secondary consistency verification &amp; conflict detection</p>
            </div>
            <span className="text-[10px] font-mono text-slate-500">{reconciliationHistory.length} run(s)</span>
          </div>
          <div className="max-h-72 overflow-y-auto divide-y divide-slate-800/60">
            {reconciliationHistory.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No manual or automatic reconciliation runs recorded yet. Click <strong>Reconcile Dual DBs</strong> above to verify consistency.
              </div>
            ) : (
              reconciliationHistory.map((run: any, idx: number) => (
                <div key={`${run.timestamp}_${idx}`} className="p-3.5 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono text-white font-semibold">
                      {run.checkedCollections ?? 0} collections audited
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{formatIst(run.timestamp)}</span>
                  </div>
                  <div className="flex flex-wrap gap-3 text-[11px] font-mono text-slate-400">
                    <span>Outbox: <strong className="text-emerald-400">{run.outboxSynced ?? 0}/{run.outboxProcessed ?? 0}</strong></span>
                    <span>Missing Primary: <strong className="text-blue-400">{run.missingInPrimary ?? 0}</strong></span>
                    <span>Missing Secondary: <strong className="text-indigo-400">{run.missingInSecondary ?? 0}</strong></span>
                    <span>Conflicts: <strong className={(run.conflictsDetected ?? 0) > 0 ? 'text-amber-400' : 'text-slate-300'}>{run.conflictsDetected ?? 0}</strong></span>
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Failover History & Health Check History */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <History className="w-3.5 h-3.5 text-indigo-400" />
              Failover &amp; Recovery History
            </span>
            <span className="text-[10px] font-mono text-slate-500">{failoverHistory.length} event(s)</span>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60">
            {failoverHistory.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No failover transitions recorded. System has stayed on its primary provider.
              </div>
            ) : (
              failoverHistory.map((ev: any) => (
                <div key={ev.id} className="p-3 text-xs space-y-1">
                  <div className="flex items-center justify-between gap-2">
                    <span className="font-mono font-bold text-white">
                      {ev.fromProvider} → {ev.toProvider}{' '}
                      <span className="text-indigo-400">(Epoch #{ev.providerEpoch})</span>
                    </span>
                    <span className="text-[10px] font-mono text-slate-500">{formatIst(ev.occurredAt)}</span>
                  </div>
                  <p className="text-[11px] text-slate-400">{ev.reason}</p>
                </div>
              ))
            )}
          </div>
        </div>

        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5 text-emerald-400" />
              Health-Check Probe History
            </span>
            <span className="text-[10px] font-mono text-slate-500">{healthHistory.length} sweep(s)</span>
          </div>
          <div className="max-h-64 overflow-y-auto divide-y divide-slate-800/60">
            {healthHistory.length === 0 ? (
              <div className="p-6 text-center text-xs text-slate-500">
                No probe history recorded yet.
              </div>
            ) : (
              healthHistory.map((h: any, idx: number) => (
                <div key={`${h.timestamp}_${idx}`} className="px-3.5 py-2.5 flex items-center justify-between gap-2 text-[11px]">
                  <div className="space-y-0.5 min-w-0">
                    <div className="font-mono text-slate-300">
                      Active: <strong className="text-white uppercase">{h.activeProvider}</strong>
                    </div>
                    <div className="text-[10px] text-slate-500 truncate">
                      {h.unhealthyServices?.length > 0
                        ? `Unhealthy: ${h.unhealthyServices.join(', ')}`
                        : h.degradedServices?.length > 0
                        ? `Degraded: ${h.degradedServices.join(', ')}`
                        : 'No unhealthy services detected'}
                    </div>
                  </div>
                  <span className="font-mono text-[10px] text-slate-500 shrink-0">{formatIst(h.timestamp)}</span>
                </div>
              ))
            )}
          </div>
        </div>
      </div>

      {/* Admin Alert Delivery Log & Retry Queue */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-slate-200 flex items-center gap-1.5">
              <Bell className="w-3.5 h-3.5 text-amber-400" />
              Admin Alert Delivery Log (Email · Push · In-App)
            </h3>
            <p className="text-[10px] text-slate-500">
              Deduplicated failure, prolonged-outage escalation, and recovery notifications · Queued Email Retries: {queuedEmailCount}
            </p>
          </div>
          {queuedEmailCount > 0 && (
            <button
              type="button"
              onClick={handleRetryAlerts}
              disabled={isAlertRetryBusy}
              className="px-2.5 py-1 rounded-lg bg-amber-600/20 hover:bg-amber-600/30 text-amber-300 border border-amber-500/30 text-[11px] font-semibold cursor-pointer disabled:opacity-50"
            >
              {isAlertRetryBusy ? 'Retrying...' : `Retry Queued Emails (${queuedEmailCount})`}
            </button>
          )}
        </div>
        <div className="max-h-60 overflow-y-auto">
          {recentAlerts.length === 0 ? (
            <div className="p-6 text-center text-xs text-slate-500">
              No service failure or recovery alerts have been triggered since worker startup.
            </div>
          ) : (
            <table className="w-full text-left text-[11px]">
              <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 sticky top-0">
                <tr>
                  <th className="py-2 px-4">Service</th>
                  <th className="py-2 px-4">Alert Type</th>
                  <th className="py-2 px-4">Channels</th>
                  <th className="py-2 px-4">Email Status</th>
                  <th className="py-2 px-4">Time (IST)</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {recentAlerts.map((al: any) => (
                  <tr key={al.id} className="hover:bg-slate-800/30">
                    <td className="py-2 px-4 font-semibold text-white">{al.serviceLabel || al.serviceKey}</td>
                    <td className="py-2 px-4">
                      <span
                        className={`px-1.5 py-0.5 rounded border text-[9px] font-bold uppercase ${statusBadgeClass(
                          al.transition === 'recovery' ? 'healthy' : al.transition === 'escalation' ? 'unhealthy' : 'degraded'
                        )}`}
                      >
                        {al.transition || 'failure'}
                      </span>
                    </td>
                    <td className="py-2 px-4 font-mono text-[10px] text-slate-400">
                      {[
                        'email',
                        al.inAppStatus === 'sent' ? 'in-app' : null,
                        al.pushTriggered ? 'push' : null,
                      ]
                        .filter(Boolean)
                        .join(', ')}
                    </td>
                    <td className="py-2 px-4">
                      {al.emailStatus === 'sent' ? (
                        <span className="text-emerald-400 inline-flex items-center gap-1">
                          <CheckCircle2 className="w-3 h-3" /> Sent
                        </span>
                      ) : (
                        <span className="text-amber-300 inline-flex items-center gap-1" title={al.emailError || ''}>
                          <XCircle className="w-3 h-3" /> {al.emailStatus === 'queued' ? 'Queued' : al.emailStatus || 'Failed'}
                        </span>
                      )}
                    </td>
                    <td className="py-2 px-4 font-mono text-[10px] text-slate-400">{formatIst(al.createdAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Verified Logical Backups & Restore Integrity Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40 flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-xs font-bold text-slate-200">Verified Logical Backups &amp; Restore Integrity</h3>
            <p className="text-[10px] text-slate-500">
              Logical snapshots complement Firebase replication; Supabase native daily PG backups &amp; PITR require a paid Supabase Pro/PITR plan in the Supabase Dashboard.
            </p>
          </div>
          <span className="text-[11px] font-mono text-slate-500">{backups.length} snapshot(s)</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 font-medium">
              <tr>
                <th className="py-2.5 px-4">Backup ID</th>
                <th className="py-2.5 px-4">Type</th>
                <th className="py-2.5 px-4">Restore Verification</th>
                <th className="py-2.5 px-4">SHA-256 Checksum</th>
                <th className="py-2.5 px-4">Timestamp (IST)</th>
                <th className="py-2.5 px-4 text-right">Size</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {backups.length === 0 ? (
                <tr>
                  <td colSpan={6} className="py-6 text-center text-slate-500">
                    No verified logical snapshots found yet. Click <strong>Backup &amp; Verify Restore</strong> above to create and validate one.
                  </td>
                </tr>
              ) : (
                backups.map((bk) => (
                  <tr key={bk.id} className="hover:bg-slate-800/30">
                    <td className="py-2.5 px-4 font-mono text-[11px] text-white">{String(bk.id).slice(0, 18)}</td>
                    <td className="py-2.5 px-4 capitalize text-slate-300">{bk.backup_type || 'logical_snapshot'}</td>
                    <td className="py-2.5 px-4">
                      <span className={`px-2 py-0.5 rounded-md border font-semibold text-[10px] uppercase ${statusBadgeClass(bk.status || 'completed')}`}>
                        {bk.restore_verified === false ? 'unverified' : bk.status || 'verified'}
                      </span>
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[10px] text-slate-400">
                      {bk.checksum ? `${String(bk.checksum).slice(0, 16)}…` : '—'}
                    </td>
                    <td className="py-2.5 px-4 text-slate-400 font-mono text-[11px]">{formatIst(bk.created_at)}</td>
                    <td className="py-2.5 px-4 font-mono text-slate-300 text-right">{formatBytes(bk.file_size_bytes)}</td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* PostgreSQL Public Tables Row Density */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-200">PostgreSQL Tables &amp; Live Row Counts</span>
          <span className="text-[11px] font-mono text-slate-500">pg_stat_user_tables</span>
        </div>
        <div className="max-h-72 overflow-y-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 font-medium sticky top-0">
              <tr>
                <th className="py-2.5 px-4">Table Name</th>
                <th className="py-2.5 px-4">Domain</th>
                <th className="py-2.5 px-4 text-right">Approx Live Rows</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {Array.isArray(databaseInfo?.tables) && databaseInfo.tables.length > 0 ? (
                databaseInfo.tables.map((t: any) => (
                  <tr key={t.table_name} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-4 font-mono font-medium text-emerald-400">public.{t.table_name}</td>
                    <td className="py-2.5 px-4 text-slate-400">
                      {t.table_name.includes('user')
                        ? 'Users & Sessions'
                        : t.table_name.includes('transaction')
                        ? 'Financial Ledger'
                        : t.table_name.includes('security')
                        ? 'Security Auditing'
                        : t.table_name.includes('udhar')
                        ? 'Shared Udhar'
                        : t.table_name.includes('notification')
                        ? 'Alerts & Push'
                        : t.table_name.includes('sync') || t.table_name.includes('failover')
                        ? 'Dual-DB Sync & Failover'
                        : 'Application Infrastructure'}
                    </td>
                    <td className="py-2.5 px-4 text-right font-mono font-bold text-white">
                      {Number(t.approximate_row_count || 0).toLocaleString()}
                    </td>
                  </tr>
                ))
              ) : (
                <tr>
                  <td colSpan={3} className="py-6 text-center text-slate-500">
                    {isLoading
                      ? 'Loading PostgreSQL table telemetry...'
                      : 'PostgreSQL table counts unavailable (DATABASE_URL not active in current environment).'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
