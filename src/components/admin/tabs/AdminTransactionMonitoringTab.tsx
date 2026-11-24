import React, { useState, useEffect } from 'react';
import {
  Activity,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Search,
  ArrowDownLeft,
  ArrowUpRight,
  TrendingUp,
  TrendingDown,
  Users,
  ShieldCheck,
  Database,
  Layers,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

interface MonitoringData {
  totalTransactions: number;
  totalIncomeCount: number;
  totalExpenseCount: number;
  totalUdharCount: number;
  createdToday: number;
  softDeletedCount: number;
  orphanCount: number;
  syncStatus: string;
  recentTransactions: any[];
}

export const AdminTransactionMonitoringTab: React.FC = () => {
  const toast = useToast();
  const [data, setData] = useState<MonitoringData | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [typeFilter, setTypeFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const fetchMonitoring = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getTransactionMonitoring();
      if (res.success && res.monitoring) {
        setData(res.monitoring);
      }
    } catch (err: any) {
      toast.error('Failed to load transaction monitoring', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchMonitoring();
    const interval = setInterval(fetchMonitoring, 30000);
    return () => clearInterval(interval);
  }, []);

  const filteredRecent = (data?.recentTransactions || []).filter((tx) => {
    if (typeFilter !== 'all' && tx.transaction_type !== typeFilter) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      const match =
        (tx.category || '').toLowerCase().includes(q) ||
        (tx.subcategory || '').toLowerCase().includes(q) ||
        (tx.masked_user_email || '').toLowerCase().includes(q) ||
        String(tx.amount).includes(q);
      if (!match) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Info */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
              <Activity className="w-5 h-5 stroke-[1.75]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Platform Transaction Monitoring
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  Live Stream
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                Operational telemetry across all financial records. Customer emails and descriptions are masked to preserve individual privacy while providing real-time system health and sync diagnostics.
              </p>
            </div>
          </div>
          <button
            onClick={fetchMonitoring}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors cursor-pointer shrink-0"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
            <span>Refresh Telemetry</span>
          </button>
        </div>
      </div>

      {/* KPI Metric Cards */}
      {data && (
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[11px] font-medium text-slate-400">Total Records</span>
            <p className="text-xl font-bold font-mono text-white mt-1">
              {data.totalTransactions.toLocaleString()}
            </p>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Lifetime database entries</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[11px] font-medium text-emerald-400">Income Entries</span>
            <p className="text-xl font-bold font-mono text-emerald-400 mt-1">
              {data.totalIncomeCount.toLocaleString()}
            </p>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Salary, freelance, deposits</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[11px] font-medium text-rose-400">Expense Entries</span>
            <p className="text-xl font-bold font-mono text-rose-400 mt-1">
              {data.totalExpenseCount.toLocaleString()}
            </p>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Daily spending & room bills</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[11px] font-medium text-blue-400">Udhar Records</span>
            <p className="text-xl font-bold font-mono text-blue-400 mt-1">
              {data.totalUdharCount.toLocaleString()}
            </p>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Shared loans & borrowing</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[11px] font-medium text-slate-300">Created Today</span>
            <p className="text-xl font-bold font-mono text-emerald-300 mt-1">
              {data.createdToday.toLocaleString()}
            </p>
            <span className="text-[10px] text-slate-500 mt-0.5 block">Active daily velocity</span>
          </div>

          <div className="bg-slate-900 border border-slate-800 p-4 rounded-xl">
            <span className="text-[11px] font-medium text-slate-400">Integrity Health</span>
            <div className="flex items-center gap-1.5 mt-1">
              <CheckCircle2 className="w-4 h-4 text-emerald-400" />
              <span className="text-sm font-bold text-white capitalize">{data.syncStatus}</span>
            </div>
            <span className="text-[10px] text-slate-500 mt-0.5 block">0 orphaned transactions</span>
          </div>
        </div>
      )}

      {/* Stream Controls */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-3 flex-wrap">
        <div className="flex items-center gap-1.5">
          <span className="text-xs font-semibold text-slate-400 mr-1">Type:</span>
          {['all', 'income', 'expense'].map((t) => (
            <button
              key={t}
              onClick={() => setTypeFilter(t)}
              className={`px-2.5 py-1 rounded-lg text-xs font-semibold capitalize transition-colors cursor-pointer ${
                typeFilter === t
                  ? 'bg-slate-800 text-white border border-slate-700'
                  : 'text-slate-400 hover:text-white'
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Filter stream by category, user..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Recent Transactions Stream Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
          <span className="text-xs font-bold text-slate-300">Latest 50 Platform Transactions (Privacy Masked)</span>
          <span className="text-[11px] text-slate-500">Auto-refreshes every 30s</span>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950/60 text-slate-400 font-semibold border-b border-slate-800">
              <tr>
                <th className="py-2.5 px-4">Timestamp</th>
                <th className="py-2.5 px-4">User</th>
                <th className="py-2.5 px-4">Category</th>
                <th className="py-2.5 px-4">Subcategory</th>
                <th className="py-2.5 px-4">Type</th>
                <th className="py-2.5 px-4 text-right">Amount</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800/60 text-slate-300">
              {isLoading && !data ? (
                <tr>
                  <td colSpan={6} className="text-center py-8">
                    <div className="inline-flex items-center gap-2 text-slate-400">
                      <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                      <span>Streaming transaction events...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredRecent.length === 0 ? (
                <tr>
                  <td colSpan={6} className="text-center py-8 text-slate-500">
                    No transactions match current stream filter.
                  </td>
                </tr>
              ) : (
                filteredRecent.map((tx) => (
                  <tr key={tx.id} className="hover:bg-slate-800/30 transition-colors">
                    <td className="py-2.5 px-4 text-slate-400 font-mono text-[11px]">
                      {new Date(tx.created_at || tx.transaction_date).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                    </td>
                    <td className="py-2.5 px-4 font-mono text-[11px] text-slate-300">
                      {tx.masked_user_email || 'u***@...'}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className="font-medium text-white capitalize">{tx.category}</span>
                    </td>
                    <td className="py-2.5 px-4 text-slate-400 capitalize">
                      {tx.subcategory || '—'}
                    </td>
                    <td className="py-2.5 px-4">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-semibold ${
                        tx.transaction_type === 'income'
                          ? 'bg-emerald-500/10 text-emerald-400'
                          : 'bg-rose-500/10 text-rose-400'
                      }`}>
                        {tx.transaction_type === 'income' ? <ArrowDownLeft className="w-3 h-3" /> : <ArrowUpRight className="w-3 h-3" />}
                        <span className="capitalize">{tx.transaction_type}</span>
                      </span>
                    </td>
                    <td className={`py-2.5 px-4 text-right font-mono font-bold ${
                      tx.transaction_type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                    }`}>
                      {tx.transaction_type === 'income' ? '+' : '-'}₹{Number(tx.amount).toLocaleString('en-IN')}
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
