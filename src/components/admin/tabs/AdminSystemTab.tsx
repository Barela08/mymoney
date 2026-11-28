import React, { useState, useEffect, useCallback } from 'react';
import {
  Database,
  Mail,
  Cpu,
  RefreshCw,
  HardDrive,
  Save,
  Plus,
  Activity,
  ShieldCheck,
  ShieldAlert,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Gauge,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

function formatBytes(bytes?: number): string {
  if (!bytes || bytes <= 0) return '0 KB';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export const AdminSystemTab: React.FC = () => {
  const toast = useToast();
  const [health, setHealth] = useState<any>(null);
  const [backups, setBackups] = useState<any[]>([]);
  const [uploadSecurity, setUploadSecurity] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isTriggeringBackup, setIsTriggeringBackup] = useState(false);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const loadSystemInfo = useCallback(async (quiet = false) => {
    if (!quiet) setIsLoading(true);
    else setIsRefreshing(true);
    try {
      const [hRes, bRes, secRes] = await Promise.all([
        adminClient.getSystemHealth(),
        adminClient.getSystemBackups(),
        adminClient.getUploadSecurityDashboard().catch(() => null),
      ]);
      if (hRes?.success) setHealth(hRes.health);
      if (bRes?.success) setBackups(bRes.backups || []);
      if (secRes?.success) setUploadSecurity(secRes);
    } catch (err: any) {
      toast.error('System Query Error', err.message);
    } finally {
      setIsLoading(false);
      setIsRefreshing(false);
    }
  }, [toast]);

  useEffect(() => {
    loadSystemInfo(false);
  }, [loadSystemInfo]);

  const handleTriggerBackup = async () => {
    setIsTriggeringBackup(true);
    try {
      const res = await adminClient.triggerSystemBackup('manual');
      if (res.success) {
        toast.success('Backup Completed', 'Full database snapshot recorded and checksum verified.');
        await loadSystemInfo(true);
      } else {
        toast.error('Backup Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsTriggeringBackup(false);
    }
  };

  const handleQuarantineAction = async (quarantineId: string, action: 'approve' | 'delete') => {
    setReviewingId(quarantineId);
    try {
      const res = await adminClient.reviewQuarantineItem(quarantineId, action);
      if (res.success) {
        toast.success(
          action === 'approve' ? 'File Approved' : 'Quarantined File Deleted',
          res.message
        );
        await loadSystemInfo(true);
      } else {
        toast.error('Action Rejected', res.message || 'Unable to process quarantine item.');
      }
    } catch (err: any) {
      toast.error('Quarantine Action Error', err.message);
    } finally {
      setReviewingId(null);
    }
  };

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {[1, 2, 3].map((i) => (
            <div key={i} className="h-32 bg-slate-200 dark:bg-slate-800 rounded-3xl" />
          ))}
        </div>
      </div>
    );
  }

  const telemetry = health?.telemetry || {};
  const concurrency = health?.concurrency || {};
  const cache = health?.cache || {};
  const scanner = uploadSecurity?.scannerStatus || health?.scanner || {};
  const storageStats = uploadSecurity?.storage || health?.storage || {};
  const buckets: any[] = Array.isArray(storageStats?.buckets) ? storageStats.buckets : [];
  const quarantineItems: any[] = Array.isArray(uploadSecurity?.quarantineItems)
    ? uploadSecurity.quarantineItems
    : [];
  const scanLogs: any[] = Array.isArray(uploadSecurity?.scanLogs) ? uploadSecurity.scanLogs : [];

  const isClamActive = scanner?.mode === 'clamav_active';

  return (
    <div className="space-y-6">
      {/* Header Bar */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-black text-slate-900 dark:text-white">
            System Health, High-Scale Telemetry &amp; File Security
          </h2>
          <p className="text-xs text-slate-500">
            Live runtime metrics, concurrency guard, private storage quotas, malware scanner status &amp; quarantine review.
          </p>
        </div>
        <button
          type="button"
          onClick={() => loadSystemInfo(true)}
          disabled={isRefreshing}
          className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-50 dark:hover:bg-slate-800 text-xs font-bold cursor-pointer disabled:opacity-50"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isRefreshing ? 'animate-spin' : ''}`} />
          <span>{isRefreshing ? 'Refreshing…' : 'Refresh Live Metrics'}</span>
        </button>
      </div>

      {/* Infrastructure KPI Cards */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {/* Database Node */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Database Layer</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <Database className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                health?.database?.status === 'healthy' ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <span className="text-lg font-black text-slate-900 dark:text-slate-100 capitalize">
              {health?.database?.status || 'Unknown'}
            </span>
          </div>
          <div className="text-xs text-slate-500 space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
            <p className="flex justify-between">
              <span>Probe Latency:</span>
              <span className="font-mono font-bold text-emerald-600">
                {typeof health?.database?.latencyMs === 'number' ? `${health.database.latencyMs} ms` : 'N/A'}
              </span>
            </p>
            <p className="flex justify-between gap-2">
              <span>Engine:</span>
              <span className="truncate text-right">{health?.database?.engine || 'Unavailable'}</span>
            </p>
            <p className="flex justify-between gap-2">
              <span>Pool:</span>
              <span className="font-semibold text-right truncate">
                {health?.database?.connectionPool || 'Unknown'}
              </span>
            </p>
          </div>
        </div>

        {/* Email SMTP Node */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Email Dispatcher</span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <Mail className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span
              className={`w-2.5 h-2.5 rounded-full ${
                health?.emailTransporter?.status === 'operational' ? 'bg-emerald-500' : 'bg-amber-500'
              }`}
            />
            <span className="text-lg font-black text-slate-900 dark:text-slate-100 capitalize">
              {health?.emailTransporter?.status || 'Unconfigured'}
            </span>
          </div>
          <div className="text-xs text-slate-500 space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
            <p className="flex justify-between gap-2">
              <span>Provider:</span>
              <span className="truncate">{health?.emailTransporter?.provider || 'Not configured'}</span>
            </p>
            <p className="flex justify-between gap-2">
              <span>Sender:</span>
              <span className="font-mono text-[11px] truncate">
                {health?.emailTransporter?.authIdentity || 'Not configured'}
              </span>
            </p>
          </div>
        </div>

        {/* Node.js Runtime */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-3">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Node.js Runtime</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <Cpu className="w-4 h-4" />
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
            <span className="text-lg font-black text-slate-900 dark:text-slate-100">
              Uptime:{' '}
              {typeof health?.nodeServer?.uptimeSeconds === 'number'
                ? `${Math.floor(health.nodeServer.uptimeSeconds / 60)}m ${health.nodeServer.uptimeSeconds % 60}s`
                : 'N/A'}
            </span>
          </div>
          <div className="text-xs text-slate-500 space-y-1 pt-1 border-t border-slate-100 dark:border-slate-800">
            <p className="flex justify-between">
              <span>Heap Used:</span>
              <span className="font-mono">
                {typeof health?.nodeServer?.heapUsedMb === 'number' ? `${health.nodeServer.heapUsedMb} MB` : 'N/A'}
              </span>
            </p>
            <p className="flex justify-between">
              <span>RSS Memory:</span>
              <span className="font-mono">
                {typeof health?.nodeServer?.rssMb === 'number' ? `${health.nodeServer.rssMb} MB` : 'N/A'}
              </span>
            </p>
            <p className="flex justify-between">
              <span>Runtime:</span>
              <span className="font-mono">{health?.nodeServer?.nodeVersion || 'N/A'}</span>
            </p>
          </div>
        </div>
      </div>

      {/* High-Scale Concurrency & Latency Telemetry */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Gauge className="w-4 h-4 text-emerald-600" />
              <span>Traffic, Latency &amp; Concurrency Guard</span>
            </h3>
            <span className="text-[11px] font-mono text-slate-500">
              60s window
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-center">
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
              <p className="text-[10px] font-bold text-slate-400 uppercase">Current RPS</p>
              <p className="text-lg font-black text-slate-900 dark:text-white font-mono">
                {telemetry.currentRps ?? 0}
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
              <p className="text-[10px] font-bold text-slate-400 uppercase">p50 / p95</p>
              <p className="text-lg font-black text-emerald-600 font-mono">
                {telemetry.p50Ms ?? 0}/{telemetry.p95Ms ?? 0}ms
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
              <p className="text-[10px] font-bold text-slate-400 uppercase">p99 Latency</p>
              <p className="text-lg font-black text-indigo-600 dark:text-indigo-400 font-mono">
                {telemetry.p99Ms ?? 0}ms
              </p>
            </div>
            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60">
              <p className="text-[10px] font-bold text-slate-400 uppercase">5xx Rate</p>
              <p className="text-lg font-black text-slate-900 dark:text-white font-mono">
                {telemetry.serverErrorRatePct ?? 0}%
              </p>
            </div>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs text-slate-500 pt-2 border-t border-slate-100 dark:border-slate-800">
            <div>
              <span className="block text-[10px] text-slate-400">Active / Peak Concurrency</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {concurrency.activeRequests ?? 0} / {concurrency.peakRequests ?? 0}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-slate-400">Load Shed (503)</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {concurrency.sheddedRequests ?? 0}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-slate-400">Cache Hits / Misses</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {cache.hits ?? 0} / {cache.misses ?? 0}
              </span>
            </div>
            <div>
              <span className="block text-[10px] text-slate-400">Rate-Limit Blocks</span>
              <span className="font-mono font-bold text-slate-800 dark:text-slate-200">
                {telemetry.rateLimitedCount ?? 0}
              </span>
            </div>
          </div>
        </div>

        {/* Malware Scanner & Storage Quota Card */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <div className="flex items-center justify-between">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              {isClamActive ? (
                <ShieldCheck className="w-4 h-4 text-emerald-600" />
              ) : (
                <ShieldAlert className="w-4 h-4 text-amber-500" />
              )}
              <span>Malware Scanner &amp; Storage Isolation</span>
            </h3>
            <span
              className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                isClamActive
                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  : 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
              }`}
            >
              {isClamActive ? 'ClamAV Active' : 'Degraded (No ClamAV Binary)'}
            </span>
          </div>

          <p className="text-[11px] text-slate-500 leading-relaxed">
            {scanner?.detail ||
              'Quarantine-first inspection checks magic bytes, pixel bombs, polyglots, EICAR signatures, and EXIF scrubbing. Install clamav-daemon in production or set REQUIRE_CLAMAV_SCAN=true to hold unscanned files in pending quarantine.'}
          </p>

          <div className="space-y-1.5">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <HardDrive className="w-3.5 h-3.5" />
              <span>Isolated Storage Buckets ({formatBytes(storageStats?.totalBytes)} total)</span>
            </p>
            <div className="grid grid-cols-2 gap-2">
              {buckets.map((b) => (
                <div
                  key={b.bucket}
                  className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200/70 dark:border-slate-700/60 text-xs"
                >
                  <div className="flex items-center justify-between gap-1">
                    <span className="font-mono font-bold text-[11px] text-slate-800 dark:text-slate-200 truncate">
                      {b.bucket}
                    </span>
                    <span className="text-[9px] uppercase font-bold text-slate-400">
                      {b.visibility}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-500 font-mono mt-0.5">
                    {b.fileCount} files · {formatBytes(b.totalBytes)}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* Upload Quarantine & Review Queue */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden space-y-4 p-6">
        <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Activity className="w-4 h-4 text-emerald-600" />
              <span>File Upload Quarantine &amp; Malware Scan Logs</span>
            </h3>
            <p className="text-xs text-slate-400">
              Every uploaded file enters quarantine first. Malicious detections stay locked and cannot be approved.
            </p>
          </div>
          <div className="flex flex-wrap gap-2 text-[11px] font-bold">
            <span className="px-2.5 py-1 rounded-lg bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300">
              Approved: {uploadSecurity?.counts?.approved ?? 0}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
              Pending: {uploadSecurity?.counts?.quarantinedPending ?? 0}
            </span>
            <span className="px-2.5 py-1 rounded-lg bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300">
              Rejected: {uploadSecurity?.counts?.rejectedMalicious ?? 0}
            </span>
          </div>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="p-3">File &amp; Purpose</th>
                <th className="p-3">MIME / Size</th>
                <th className="p-3">Scanner Verdict</th>
                <th className="p-3">Bucket / Key</th>
                <th className="p-3">Timestamp</th>
                <th className="p-3 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {quarantineItems.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-6 text-center text-slate-400">
                    No upload quarantine events recorded yet.
                  </td>
                </tr>
              ) : (
                quarantineItems.slice(0, 20).map((item) => {
                  const isMalicious = item.status === 'rejected_malicious';
                  const isPending = item.status === 'quarantined_pending';
                  const isDeleted = item.status === 'deleted';
                  return (
                    <tr key={item.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="p-3">
                        <p className="font-bold text-slate-800 dark:text-slate-200 truncate max-w-[180px]">
                          {item.sanitizedFilename || item.originalFilename}
                        </p>
                        <p className="text-[10px] font-mono text-slate-400">
                          {item.purpose} · {item.userEmail || item.userId}
                        </p>
                      </td>
                      <td className="p-3 font-mono text-[11px] text-slate-500">
                        <div>{item.detectedMime || item.declaredMime}</div>
                        <div className="text-[10px]">{formatBytes(item.byteSize)}</div>
                      </td>
                      <td className="p-3">
                        <span
                          className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            isMalicious
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : isPending
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : isDeleted
                              ? 'bg-slate-200 text-slate-700 dark:bg-slate-800 dark:text-slate-400'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {isMalicious ? (
                            <AlertTriangle className="w-3 h-3" />
                          ) : (
                            <CheckCircle2 className="w-3 h-3" />
                          )}
                          {item.status}
                        </span>
                        <p className="text-[10px] text-slate-400 mt-0.5 max-w-[200px] truncate">
                          {item.threatName || item.scanVerdict}
                        </p>
                      </td>
                      <td className="p-3 font-mono text-[10px] text-slate-500 max-w-[180px] truncate">
                        <div>{item.bucket}</div>
                        <div className="text-slate-400 truncate">{item.objectKey}</div>
                      </td>
                      <td className="p-3 text-slate-500 whitespace-nowrap text-[11px]">
                        {item.createdAt ? new Date(item.createdAt).toLocaleString() : '—'}
                      </td>
                      <td className="p-3 text-right whitespace-nowrap space-x-1.5">
                        {isPending && (
                          <button
                            type="button"
                            disabled={reviewingId === item.id}
                            onClick={() => handleQuarantineAction(item.id, 'approve')}
                            className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold cursor-pointer disabled:opacity-50"
                          >
                            Approve
                          </button>
                        )}
                        {!isDeleted && (
                          <button
                            type="button"
                            disabled={reviewingId === item.id}
                            onClick={() => handleQuarantineAction(item.id, 'delete')}
                            className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/60 text-rose-600 dark:text-rose-300 text-[10px] font-bold cursor-pointer disabled:opacity-50"
                          >
                            <Trash2 className="w-3 h-3" />
                            Delete
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })
              )}
            </tbody>
          </table>
        </div>

        {scanLogs.length > 0 && (
          <div className="pt-2 border-t border-slate-100 dark:border-slate-800">
            <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider mb-2">
              Recent Scan Pipeline Events ({scanLogs.length})
            </p>
            <div className="max-h-36 overflow-y-auto space-y-1 text-[11px] font-mono">
              {scanLogs.slice(0, 12).map((log) => (
                <div
                  key={log.id}
                  className="flex flex-wrap items-center justify-between gap-2 px-2.5 py-1 rounded-lg bg-slate-50 dark:bg-slate-800/50 text-slate-600 dark:text-slate-300"
                >
                  <span className="truncate">
                    [{log.outcome}] {log.purpose} · {log.scannerEngine} — {log.reason}
                  </span>
                  <span className="text-slate-400 text-[10px]">
                    {log.createdAt ? new Date(log.createdAt).toLocaleTimeString() : ''}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      {/* Backups & Snapshots Section */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden space-y-4 p-6">
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div>
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Save className="w-4 h-4 text-emerald-600" />
              <span>Database Backups &amp; Disaster Recovery</span>
            </h3>
            <p className="text-xs text-slate-400">Automated and on-demand database snapshots with SHA-256 verification</p>
          </div>

          <button
            onClick={handleTriggerBackup}
            disabled={isTriggeringBackup}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>{isTriggeringBackup ? 'Creating Snapshot...' : 'Trigger Backup Snapshot'}</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="p-3.5">Backup Identifier</th>
                <th className="p-3.5">Type</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Size</th>
                <th className="p-3.5">Checksum (SHA-256)</th>
                <th className="p-3.5">Triggered By</th>
                <th className="p-3.5">Created At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {backups.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    No backup records found.
                  </td>
                </tr>
              ) : (
                backups.map((b) => (
                  <tr key={b.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="p-3.5 font-bold text-slate-800 dark:text-slate-200">{b.backup_name}</td>
                    <td className="p-3.5 uppercase font-mono text-[10px] text-slate-500">{b.backup_type}</td>
                    <td className="p-3.5">
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                        ● {b.status}
                      </span>
                    </td>
                    <td className="p-3.5 font-mono text-slate-500">
                      {typeof b.file_size_bytes === 'number'
                        ? `${Math.round((b.file_size_bytes / 1024 / 1024) * 10) / 10} MB`
                        : '—'}
                    </td>
                    <td className="p-3.5 font-mono text-[10px] text-slate-400 max-w-xs truncate">
                      {b.checksum || '—'}
                    </td>
                    <td className="p-3.5 text-slate-500 font-mono text-[11px]">{b.triggered_by || 'system'}</td>
                    <td className="p-3.5 text-slate-500 whitespace-nowrap text-[11px]">
                      {b.created_at ? new Date(b.created_at).toLocaleString() : '—'}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
