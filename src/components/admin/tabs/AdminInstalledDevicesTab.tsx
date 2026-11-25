import React, { useState, useEffect } from 'react';
import {
  Smartphone,
  Laptop,
  Tablet,
  CheckCircle2,
  XCircle,
  Clock,
  Search,
  Filter,
  RotateCw,
  Bell,
  ShieldAlert,
  ArrowRight,
  Send,
  Copy,
  Check,
  User,
  Info,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';
import { formatDisplayDate, formatDisplayTime } from '../../../lib/dateUtils';

export interface DeviceRecord {
  id: string;
  user_id: string;
  user_name: string;
  user_email?: string;
  device_type: 'mobile' | 'tablet' | 'desktop' | string;
  browser: string;
  os: string;
  installation_status: string;
  is_installed: boolean;
  installed_at: string | null;
  last_active_at: string;
  push_permission: 'granted' | 'denied' | 'default' | string;
  push_subscription_status: 'active' | 'inactive' | 'none' | string;
  last_delivery_result?: 'delivered' | 'failed' | 'pending' | 'none' | string;
  created_at?: string;
}

export const AdminInstalledDevicesTab: React.FC = () => {
  const toast = useToast();
  const [devices, setDevices] = useState<DeviceRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [installedFilter, setInstalledFilter] = useState<'all' | 'installed' | 'browser'>('all');
  const [deviceTypeFilter, setDeviceTypeFilter] = useState<string>('all');
  const [permissionFilter, setPermissionFilter] = useState<string>('all');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadDevices = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getInstalledDevices({
        q: searchQuery,
        installed_only: installedFilter === 'installed',
        device_type: deviceTypeFilter !== 'all' ? deviceTypeFilter : undefined,
        push_permission: permissionFilter !== 'all' ? permissionFilter : undefined,
      });

      if (res.success) {
        setDevices(res.devices || []);
      }
    } catch (err: any) {
      toast.error('Failed to load devices', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDevices();
  }, [installedFilter, deviceTypeFilter, permissionFilter]);

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadDevices();
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
    toast.info('Copied', 'User ID copied to clipboard.');
  };

  const getDeviceIcon = (type: string) => {
    switch (type.toLowerCase()) {
      case 'mobile':
        return <Smartphone className="w-4 h-4 text-emerald-500" />;
      case 'tablet':
        return <Tablet className="w-4 h-4 text-purple-500" />;
      default:
        return <Laptop className="w-4 h-4 text-blue-500" />;
    }
  };

  // Filter local results further by search query
  const filteredDevices = devices.filter((d) => {
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      d.user_name?.toLowerCase().includes(q) ||
      d.user_email?.toLowerCase().includes(q) ||
      d.user_id?.toLowerCase().includes(q) ||
      d.browser?.toLowerCase().includes(q) ||
      d.os?.toLowerCase().includes(q)
    );
  });

  const totalInstalled = devices.filter((d) => d.is_installed).length;
  const activePushCount = devices.filter((d) => d.push_subscription_status === 'active').length;
  const mobileCount = devices.filter((d) => d.device_type?.toLowerCase() === 'mobile').length;

  return (
    <div className="space-y-6">
      {/* Header and Summary Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Devices</p>
            <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
              {devices.length}
            </p>
            <p className="text-[10px] text-slate-500 mt-0.5 font-medium">Logged user sessions</p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
            <Laptop className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Installed PWA</p>
            <p className="text-xl sm:text-2xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
              {totalInstalled}
            </p>
            <p className="text-[10px] text-emerald-600 font-bold mt-0.5">Confirmed Standalone</p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <CheckCircle2 className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Push Subs</p>
            <p className="text-xl sm:text-2xl font-black text-indigo-600 dark:text-indigo-400 mt-1">
              {activePushCount}
            </p>
            <p className="text-[10px] text-indigo-600 font-medium mt-0.5">Eligible for push delivery</p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
            <Bell className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Mobile Devices</p>
            <p className="text-xl sm:text-2xl font-black text-purple-600 dark:text-purple-400 mt-1">
              {mobileCount}
            </p>
            <p className="text-[10px] text-purple-600 font-medium mt-0.5">Android & iOS Users</p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-purple-500/10 text-purple-600 flex items-center justify-center">
            <Smartphone className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Nielsen Usability Heuristic Note */}
      <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-start gap-3">
        <Info className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-800 dark:text-amber-200">
          <p className="font-bold">PWA Installation Detection Policy</p>
          <p className="mt-0.5 text-[11px] opacity-90 leading-relaxed">
            In compliance with strict platform fidelity, users are labeled as <b>Installed PWA</b> only upon confirmed receipt of browser <code>appinstalled</code> lifecycle events or authenticated standalone display-mode verification. Web visitors browsing in standard tabs are recorded as <b>Web Browser</b>.
          </p>
        </div>
      </div>

      {/* Filter and Search Bar */}
      <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-2xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <form onSubmit={handleSearchSubmit} className="relative flex-1">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by user name, email, user ID, browser or OS..."
            className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-900 dark:text-slate-100 placeholder-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2">
          {/* Installed Filter */}
          <select
            value={installedFilter}
            onChange={(e) => setInstalledFilter(e.target.value as any)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
          >
            <option value="all">All Statuses</option>
            <option value="installed">Installed PWA Only</option>
            <option value="browser">Web Browser Only</option>
          </select>

          {/* Device Type */}
          <select
            value={deviceTypeFilter}
            onChange={(e) => setDeviceTypeFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
          >
            <option value="all">All Devices</option>
            <option value="mobile">Mobile</option>
            <option value="tablet">Tablet</option>
            <option value="desktop">Desktop</option>
          </select>

          {/* Push Permission */}
          <select
            value={permissionFilter}
            onChange={(e) => setPermissionFilter(e.target.value)}
            className="px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs text-slate-700 dark:text-slate-300 focus:outline-none focus:ring-2 focus:ring-emerald-500 font-medium"
          >
            <option value="all">Push: All</option>
            <option value="granted">Permission: Granted</option>
            <option value="denied">Permission: Denied</option>
            <option value="default">Permission: Default</option>
          </select>

          {/* Refresh */}
          <button
            type="button"
            onClick={loadDevices}
            disabled={isLoading}
            className="p-2 border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-slate-600 dark:text-slate-400 transition-colors cursor-pointer"
            title="Refresh device records"
          >
            <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Installed Devices Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase tracking-wider text-[10px] font-bold">
              <tr>
                <th className="p-4">User</th>
                <th className="p-4">Installation Status</th>
                <th className="p-4">Device & Platform</th>
                <th className="p-4">Push Permission</th>
                <th className="p-4">Push Subscription</th>
                <th className="p-4">Install Date</th>
                <th className="p-4">Last Active</th>
                <th className="p-4 text-right">Delivery Result</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
              {filteredDevices.length === 0 ? (
                <tr>
                  <td colSpan={8} className="p-8 text-center text-slate-400">
                    {isLoading ? 'Loading installed device records...' : 'No installed devices match your filter criteria.'}
                  </td>
                </tr>
              ) : (
                filteredDevices.map((dev) => (
                  <tr key={dev.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                    {/* User Column */}
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-500/10 text-emerald-600 flex items-center justify-center font-bold text-xs shrink-0">
                          {dev.user_name?.charAt(0)?.toUpperCase() || 'U'}
                        </div>
                        <div className="min-w-0">
                          <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                            {dev.user_name}
                          </p>
                          <div className="flex items-center gap-1 text-[10px] text-slate-400 font-mono">
                            <span className="truncate max-w-[100px]">{dev.user_id}</span>
                            <button
                              onClick={() => copyToClipboard(dev.user_id, dev.id)}
                              className="hover:text-slate-600 dark:hover:text-slate-300"
                              title="Copy User ID"
                            >
                              {copiedId === dev.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                            </button>
                          </div>
                        </div>
                      </div>
                    </td>

                    {/* Installation Status */}
                    <td className="p-4">
                      {dev.is_installed ? (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Installed PWA</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[11px] font-semibold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                          <span>Web Browser</span>
                        </span>
                      )}
                    </td>

                    {/* Device & Platform */}
                    <td className="p-4">
                      <div className="flex items-center gap-2">
                        {getDeviceIcon(dev.device_type)}
                        <div>
                          <p className="text-slate-800 dark:text-slate-200 font-bold capitalize">
                            {dev.device_type}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {dev.browser} · {dev.os}
                          </p>
                        </div>
                      </div>
                    </td>

                    {/* Push Permission */}
                    <td className="p-4">
                      {dev.push_permission === 'granted' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Granted</span>
                        </span>
                      ) : dev.push_permission === 'denied' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                          <XCircle className="w-3 h-3 text-rose-600" />
                          <span>Denied</span>
                        </span>
                      ) : (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium bg-slate-100 dark:bg-slate-800 text-slate-500">
                          <span>Default</span>
                        </span>
                      )}
                    </td>

                    {/* Push Subscription */}
                    <td className="p-4">
                      {dev.push_subscription_status === 'active' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-indigo-50 dark:bg-indigo-950/60 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800">
                          <Bell className="w-3 h-3 text-indigo-600" />
                          <span>Active Token</span>
                        </span>
                      ) : (
                        <span className="text-[11px] text-slate-400">No Subscription</span>
                      )}
                    </td>

                    {/* Install Date */}
                    <td className="p-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      {dev.installed_at ? (
                        <div>
                          <p className="font-semibold text-slate-800 dark:text-slate-200">
                            {formatDisplayDate(dev.installed_at)}
                          </p>
                          <p className="text-[10px] text-slate-400">
                            {formatDisplayTime(dev.installed_at)}
                          </p>
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </td>

                    {/* Last Active */}
                    <td className="p-4 text-slate-600 dark:text-slate-400 whitespace-nowrap">
                      <p className="font-semibold text-slate-800 dark:text-slate-200">
                        {formatDisplayDate(dev.last_active_at)}
                      </p>
                      <p className="text-[10px] text-slate-400">
                        {formatDisplayTime(dev.last_active_at)}
                      </p>
                    </td>

                    {/* Delivery Result */}
                    <td className="p-4 text-right">
                      {dev.last_delivery_result === 'delivered' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300">
                          <CheckCircle2 className="w-3 h-3 text-emerald-600" />
                          <span>Delivered</span>
                        </span>
                      ) : dev.last_delivery_result === 'failed' ? (
                        <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold bg-rose-50 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                          <XCircle className="w-3 h-3 text-rose-600" />
                          <span>Failed</span>
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-400">None yet</span>
                      )}
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
