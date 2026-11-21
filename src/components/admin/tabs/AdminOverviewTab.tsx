import React, { useState, useEffect } from 'react';
import {
  Users,
  UserPlus,
  UserCheck,
  UserX,
  ShieldAlert,
  Lock,
  Laptop,
  Trash2,
  Activity,
  Server,
  RefreshCw,
  TrendingUp,
  Clock,
  ArrowUpRight,
  AlertTriangle,
  CheckCircle2,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

export const AdminOverviewTab: React.FC = () => {
  const toast = useToast();
  const [stats, setStats] = useState<any>(null);
  const [charts, setCharts] = useState<any>(null);
  const [recentActivity, setRecentActivity] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [timeRange, setTimeRange] = useState<'today' | '7d' | '30d' | '90d'>('30d');

  const loadDashboard = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getDashboardStats();
      if (res.success) {
        setStats(res.stats);
        setCharts(res.charts);
        setRecentActivity(res.recentActivity || []);
      }
    } catch (err: any) {
      toast.error('Dashboard Error', err.message || 'Could not fetch dashboard metrics.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDashboard();
  }, []);

  if (isLoading) {
    return (
      <div className="space-y-6 animate-pulse">
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          {[1, 2, 3, 4, 5, 6, 7, 8].map((i) => (
            <div key={i} className="h-28 bg-slate-200 dark:bg-slate-800 rounded-3xl" />
          ))}
        </div>
        <div className="h-72 bg-slate-200 dark:bg-slate-800 rounded-3xl" />
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Time Filter & Refresh Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-2">
          <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <Activity className="w-4 h-4" />
          </div>
          <div>
            <h3 className="text-xs font-bold text-slate-800 dark:text-slate-200">Real-Time Platform Performance</h3>
            <p className="text-[11px] text-slate-400">Live aggregated statistics directly from production ledger</p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full sm:w-auto">
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-400">
            {(['today', '7d', '30d', '90d'] as const).map((r) => (
              <button
                key={r}
                onClick={() => setTimeRange(r)}
                className={`px-3 py-1 rounded-lg transition-all cursor-pointer ${
                  timeRange === r ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : ''
                }`}
              >
                {r === 'today' ? 'Today' : r === '7d' ? '7 Days' : r === '30d' ? '30 Days' : '90 Days'}
              </button>
            ))}
          </div>

          <button
            onClick={loadDashboard}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
            title="Refresh Data"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Primary KPI Cards Grid */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Total Users */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Users</span>
            <div className="w-8 h-8 rounded-xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
              <Users className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
            {stats?.totalUsers?.toLocaleString() || 0}
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-emerald-600 font-bold">
            <TrendingUp className="w-3.5 h-3.5" />
            <span>+{stats?.newMonth || 0} new this month</span>
          </div>
        </div>

        {/* Active Accounts */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active Users</span>
            <div className="w-8 h-8 rounded-xl bg-teal-500/10 text-teal-600 flex items-center justify-center">
              <UserCheck className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
            {stats?.activeUsers?.toLocaleString() || 0}
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-slate-400 font-medium">
            <span>● Status: Normal / Operational</span>
          </div>
        </div>

        {/* New Today */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">New Registrations Today</span>
            <div className="w-8 h-8 rounded-xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
              <UserPlus className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
            +{stats?.newToday?.toLocaleString() || 0}
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-indigo-600 font-bold">
            <span>+{stats?.newWeek || 0} registered this week</span>
          </div>
        </div>

        {/* Suspended Accounts */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Suspended Accounts</span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <UserX className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
            {stats?.suspendedUsers?.toLocaleString() || 0}
          </p>
          <div className="flex items-center gap-1.5 text-[11px] text-amber-600 font-bold">
            <span>{stats?.inactiveUsers || 0} deactivated</span>
          </div>
        </div>
      </div>

      {/* Security & Infrastructure Health Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        {/* Failed Logins (24h) */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Failed Logins (24h)</span>
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
              <Lock className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
            {stats?.failedLogins24h || 0}
          </p>
          <p className="text-[11px] text-slate-400">Rate-limited & brute-force guarded</p>
        </div>

        {/* Active Sessions */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Live User Sessions</span>
            <div className="w-8 h-8 rounded-xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
              <Laptop className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
            {stats?.activeSessions || 0}
          </p>
          <p className="text-[11px] text-blue-600 font-bold">Encrypted SHA-256 tokens</p>
        </div>

        {/* Open Security Incidents */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Open Incidents</span>
            <div className="w-8 h-8 rounded-xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
              <ShieldAlert className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
            {stats?.openIncidents || 0}
          </p>
          <p className="text-[11px] text-slate-400">{stats?.lockedAccounts || 0} locked accounts</p>
        </div>

        {/* Pending Deletions */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-2">
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Pending Deletions (24h)</span>
            <div className="w-8 h-8 rounded-xl bg-slate-500/10 text-slate-600 flex items-center justify-center">
              <Trash2 className="w-4 h-4" />
            </div>
          </div>
          <p className="text-2xl font-black text-slate-900 dark:text-slate-100">
            {stats?.pendingDeletions || 0}
          </p>
          <p className="text-[11px] text-slate-400">Statutory grace window</p>
        </div>
      </div>

      {/* Visual Activity & Registration Trends Chart */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">30-Day Platform Trend Analysis</h3>
            <p className="text-xs text-slate-400">New user registrations and authentication activity timeline</p>
          </div>
          <div className="flex items-center gap-4 text-xs font-bold">
            <div className="flex items-center gap-1.5 text-emerald-600">
              <span className="w-3 h-3 rounded bg-emerald-500 inline-block" />
              <span>Registrations</span>
            </div>
            <div className="flex items-center gap-1.5 text-blue-500">
              <span className="w-3 h-3 rounded bg-blue-500 inline-block" />
              <span>Logins</span>
            </div>
          </div>
        </div>

        {/* SVG Sparkline/Bar Chart */}
        <div className="h-44 w-full flex items-end gap-2 pt-6 pb-2 border-b border-slate-100 dark:border-slate-800">
          {(charts?.registrations?.length > 0 ? charts.registrations : [
            { date: 'Day 1', count: 1 },
            { date: 'Day 2', count: 3 },
            { date: 'Day 3', count: 2 },
            { date: 'Day 4', count: 5 },
            { date: 'Day 5', count: 4 },
          ]).map((item: any, idx: number) => {
            const heightPct = Math.min(100, Math.max(15, (parseInt(item.count) || 1) * 20));
            return (
              <div key={idx} className="flex-1 flex flex-col items-center gap-1.5 h-full justify-end group">
                <div
                  style={{ height: `${heightPct}%` }}
                  className="w-full rounded-t-lg bg-emerald-500/80 group-hover:bg-emerald-500 transition-all relative"
                >
                  <span className="absolute -top-7 left-1/2 -translate-x-1/2 bg-slate-900 text-white text-[10px] font-bold px-1.5 py-0.5 rounded opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap pointer-events-none">
                    {item.count} users
                  </span>
                </div>
                <span className="text-[9px] text-slate-400 font-mono truncate w-full text-center">
                  {item.date ? String(item.date).slice(-5) : idx}
                </span>
              </div>
            );
          })}
        </div>
      </div>

      {/* Recent Administrative Events Feed */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between">
          <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">Recent Platform & Security Events</h3>
          <span className="text-xs text-slate-400">Immutable Audit Trail</span>
        </div>

        <div className="divide-y divide-slate-100 dark:divide-slate-800">
          {recentActivity.length === 0 ? (
            <p className="text-xs text-slate-400 text-center py-6">No recent events recorded.</p>
          ) : (
            recentActivity.map((evt) => (
              <div key={evt.id} className="py-3 flex items-center justify-between text-xs">
                <div className="flex items-center gap-3">
                  <div
                    className={`w-7 h-7 rounded-lg flex items-center justify-center shrink-0 ${
                      evt.event_type.includes('FAIL') || evt.event_type.includes('SUSP')
                        ? 'bg-rose-50 text-rose-600 dark:bg-rose-950/40'
                        : 'bg-emerald-50 text-emerald-600 dark:bg-emerald-950/40'
                    }`}
                  >
                    {evt.event_type.includes('FAIL') ? (
                      <AlertTriangle className="w-3.5 h-3.5" />
                    ) : (
                      <CheckCircle2 className="w-3.5 h-3.5" />
                    )}
                  </div>
                  <div>
                    <p className="font-bold text-slate-800 dark:text-slate-200">{evt.event_type}</p>
                    <p className="text-[11px] text-slate-400">
                      Subject: <span className="font-mono">{evt.user_email || 'System'}</span>
                    </p>
                  </div>
                </div>

                <div className="text-right">
                  <span className="text-[11px] text-slate-400 font-mono">
                    {new Date(evt.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                  </span>
                  <p className="text-[10px] text-slate-500 uppercase font-bold">{evt.actor_role}</p>
                </div>
              </div>
            ))
          )}
        </div>
      </div>
    </div>
  );
};
