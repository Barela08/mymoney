import React, { useState, useEffect } from 'react';
import {
  BarChart3,
  Calendar,
  Download,
  FileSpreadsheet,
  FileJson,
  ShieldCheck,
  Users,
  Lock,
  Mail,
  MessageSquare,
  Trash2,
  RefreshCw,
  TrendingUp,
  AlertTriangle,
  CheckCircle2,
  Activity,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

export const AdminAnalyticsTab: React.FC = () => {
  const toast = useToast();
  const [timeRange, setTimeRange] = useState<'today' | '7d' | '30d' | '90d'>('30d');
  const [data, setData] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  const loadAnalytics = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getAnalytics(timeRange);
      if (res.success) {
        setData(res.data);
      }
    } catch (err: any) {
      toast.error('Analytics Fetch Error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadAnalytics();
  }, [timeRange]);

  const handleExportCSV = () => {
    if (!data) return;
    const rows = [
      ['Metric Category', 'Metric Name', 'Count / Value'],
      ['Verification', 'Verified Accounts', data.verification?.verified_count || 0],
      ['Verification', 'Unverified Accounts', data.verification?.unverified_count || 0],
      ...((data.statuses || []).map((s: any) => ['Account Status', s.status, s.count])),
      ...((data.security || []).map((s: any) => ['Security Incidents', `${s.severity} (${s.status})`, s.count])),
      ...((data.emails || []).map((e: any) => ['Email Dispatch', e.status, e.count])),
      ...((data.tickets || []).map((t: any) => ['Support Tickets', `${t.category} (${t.status})`, t.count])),
    ];

    const csvContent = 'data:text/csv;charset=utf-8,' + rows.map((e) => e.join(',')).join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `mymoney-analytics-${timeRange}-${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    toast.success('Export Ready', 'Aggregated analytics CSV downloaded successfully.');
  };

  const handleExportJSON = () => {
    if (!data) return;
    const jsonStr = JSON.stringify(data, null, 2);
    const blob = new Blob([jsonStr], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `mymoney-analytics-${timeRange}-${new Date().toISOString().split('T')[0]}.json`;
    link.click();
    URL.revokeObjectURL(url);
    toast.success('Export Ready', 'Analytics JSON report downloaded.');
  };

  // Calculations
  const totalVerified = parseInt(data?.verification?.verified_count || '0');
  const totalUnverified = parseInt(data?.verification?.unverified_count || '0');
  const totalUsersAnalyzed = totalVerified + totalUnverified;
  const verificationRate = totalUsersAnalyzed > 0 ? Math.round((totalVerified / totalUsersAnalyzed) * 100) : 0;

  const totalLoginsInPeriod = (data?.loginsTrend || []).reduce((acc: number, curr: any) => acc + parseInt(curr.count || '0'), 0);
  const totalRegistrationsInPeriod = (data?.registrationsTrend || []).reduce((acc: number, curr: any) => acc + parseInt(curr.count || '0'), 0);

  return (
    <div className="space-y-6">
      {/* Privacy Guarantee Pill */}
      <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 flex items-center justify-between flex-wrap gap-3">
        <div className="flex items-center gap-2.5">
          <ShieldCheck className="w-5 h-5 text-emerald-600 flex-shrink-0" />
          <div>
            <p className="text-xs font-bold text-emerald-900 dark:text-emerald-200">
              Statutory Privacy & Data Aggregation Guard
            </p>
            <p className="text-[11px] text-emerald-700 dark:text-emerald-400">
              Admin analytics only compile anonymized platform throughput. Personal finances, transactions, balances, and income/expense details are strictly omitted.
            </p>
          </div>
        </div>
        <span className="text-[10px] font-bold uppercase tracking-wider px-2.5 py-1 bg-emerald-600 text-white rounded-full">
          Zero Financial Exposure
        </span>
      </div>

      {/* Header & Controls */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col md:flex-row items-start md:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-wider mb-1">
            <BarChart3 className="w-4 h-4" />
            Executive Reports
          </div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">Reports & System Analytics</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Operational KPI tracking, security events, registration acceleration, and communication performance.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Time Range Filter */}
          <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-xs font-bold text-slate-600 dark:text-slate-300">
            <button
              onClick={() => setTimeRange('today')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                timeRange === 'today' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              Today
            </button>
            <button
              onClick={() => setTimeRange('7d')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                timeRange === '7d' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              7 Days
            </button>
            <button
              onClick={() => setTimeRange('30d')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                timeRange === '30d' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              30 Days
            </button>
            <button
              onClick={() => setTimeRange('90d')}
              className={`px-3 py-1.5 rounded-lg transition-all ${
                timeRange === '90d' ? 'bg-white dark:bg-slate-700 text-slate-900 dark:text-white shadow-xs' : 'hover:text-slate-900'
              }`}
            >
              90 Days
            </button>
          </div>

          <button
            onClick={loadAnalytics}
            disabled={isLoading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
            title="Refresh analytics"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>

          <button
            onClick={handleExportCSV}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <FileSpreadsheet className="w-3.5 h-3.5 text-emerald-600" />
            CSV
          </button>

          <button
            onClick={handleExportJSON}
            className="flex items-center gap-1.5 px-3 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold transition-colors cursor-pointer"
          >
            <FileJson className="w-3.5 h-3.5 text-indigo-600" />
            JSON
          </button>
        </div>
      </div>

      {/* Top 4 KPI Cards */}
      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">New Registrations</span>
            <Users className="w-4 h-4 text-emerald-500" />
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white">{totalRegistrationsInPeriod}</p>
          <p className="text-[11px] text-slate-400 mt-1">In selected interval ({timeRange})</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Successful Logins</span>
            <Lock className="w-4 h-4 text-indigo-500" />
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white">{totalLoginsInPeriod}</p>
          <p className="text-[11px] text-slate-400 mt-1">Active platform authentication sessions</p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Email Verification</span>
            <CheckCircle2 className="w-4 h-4 text-teal-500" />
          </div>
          <p className="text-3xl font-black text-emerald-600">{verificationRate}%</p>
          <p className="text-[11px] text-slate-400 mt-1">
            {totalVerified} verified / {totalUsersAnalyzed} total accounts
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm">
          <div className="flex items-center justify-between text-slate-400 mb-2">
            <span className="text-[11px] font-bold uppercase tracking-wider">Security Anomaly Index</span>
            <ShieldCheck className="w-4 h-4 text-amber-500" />
          </div>
          <p className="text-3xl font-black text-slate-900 dark:text-white">
            {(data?.security || []).length}
          </p>
          <p className="text-[11px] text-slate-400 mt-1">Recorded audit exceptions</p>
        </div>
      </div>

      {/* Grid of Analytical Breakdown Cards */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Trend Bar Visualizer */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <TrendingUp className="w-4 h-4 text-emerald-600" />
              Registration Velocity (Daily Breakdown)
            </h3>
            <span className="text-xs text-slate-400 font-medium">Recent 10 days</span>
          </div>

          <div className="space-y-3">
            {isLoading ? (
              <p className="text-xs text-slate-400 py-6 text-center">Loading registration trend...</p>
            ) : (data?.registrationsTrend || []).length === 0 ? (
              <p className="text-xs text-slate-400 py-6 text-center">No registration points recorded in this window.</p>
            ) : (
              (data.registrationsTrend.slice(-10) as any[]).map((point: any, idx: number) => {
                const count = parseInt(point.count);
                const max = Math.max(...data.registrationsTrend.map((p: any) => parseInt(p.count)), 1);
                const pct = Math.max(Math.round((count / max) * 100), 8);
                return (
                  <div key={idx} className="space-y-1">
                    <div className="flex items-center justify-between text-xs">
                      <span className="font-mono text-slate-600 dark:text-slate-400">
                        {new Date(point.date).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })}
                      </span>
                      <span className="font-bold text-slate-800 dark:text-slate-200">{count} users</span>
                    </div>
                    <div className="w-full bg-slate-100 dark:bg-slate-800 rounded-full h-2 overflow-hidden">
                      <div
                        className="bg-emerald-500 h-full rounded-full transition-all duration-500"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        {/* Account Status Distribution */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Users className="w-4 h-4 text-indigo-600" />
              Account Status & Lifecycle Distribution
            </h3>
            <span className="text-xs text-slate-400 font-medium">Platform-wide</span>
          </div>

          <div className="space-y-3">
            {(data?.statuses || []).map((st: any, idx: number) => (
              <div
                key={idx}
                className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800 flex items-center justify-between"
              >
                <div>
                  <p className="text-xs font-bold capitalize text-slate-800 dark:text-slate-200">{st.status}</p>
                  <p className="text-[11px] text-slate-400">
                    {st.status === 'active'
                      ? 'Normal operational access'
                      : st.status === 'suspended'
                      ? 'Suspended by admin or security trigger'
                      : 'Deactivated / restricted'}
                  </p>
                </div>
                <span className="px-3 py-1 rounded-full text-xs font-mono font-bold bg-white dark:bg-slate-700 text-slate-800 dark:text-slate-200 shadow-xs">
                  {st.count} accounts
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* Email Communication Deliverability */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <Mail className="w-4 h-4 text-teal-600" />
              SMTP Delivery Throughput
            </h3>
            <span className="text-xs text-slate-400 font-medium">Delivery health</span>
          </div>

          <div className="grid grid-cols-2 gap-3">
            {(data?.emails || []).map((e: any, idx: number) => (
              <div
                key={idx}
                className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800"
              >
                <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400">{e.status}</p>
                <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">{e.count}</p>
              </div>
            ))}
          </div>
        </div>

        {/* Customer Support Resolution Overview */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <div className="flex items-center justify-between mb-4">
            <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
              <MessageSquare className="w-4 h-4 text-purple-600" />
              Support Ticket Workload
            </h3>
            <span className="text-xs text-slate-400 font-medium">Issue categories</span>
          </div>

          <div className="space-y-2">
            {(data?.tickets || []).slice(0, 5).map((t: any, idx: number) => (
              <div key={idx} className="flex items-center justify-between text-xs py-1.5 border-b border-slate-100 dark:border-slate-800">
                <span className="capitalize font-medium text-slate-700 dark:text-slate-300">
                  {t.category} ({t.status.replace(/_/g, ' ')})
                </span>
                <span className="font-mono font-bold text-slate-500">{t.count} tickets</span>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
};
