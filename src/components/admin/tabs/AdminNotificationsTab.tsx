import React, { useState, useEffect } from 'react';
import {
  Bell,
  Send,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  Info,
  ShieldAlert,
  Wrench,
  Trash2,
  Users,
  Eye,
  X,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

export const AdminNotificationsTab: React.FC = () => {
  const toast = useToast();
  const [notifications, setNotifications] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // New notification state
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [type, setType] = useState<'info' | 'warning' | 'maintenance' | 'announcement'>('info');
  const [targetAudience, setTargetAudience] = useState<'all' | 'active' | 'inactive'>('all');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);

  const loadNotifications = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getNotifications();
      if (res.success) {
        setNotifications(res.notifications || []);
      }
    } catch (err: any) {
      toast.error('Failed to load notifications', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadNotifications();
  }, []);

  const handleSendNotification = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      toast.error('Validation Error', 'Title and message cannot be empty.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await adminClient.broadcastNotification({
        title: title.trim(),
        message: message.trim(),
        type,
        target_user_id: targetAudience,
      });

      if (res.success) {
        toast.success('Broadcast Sent', 'Notification has been dispatched to target users.');
        setTitle('');
        setMessage('');
        setType('info');
        setTargetAudience('all');
        setIsModalOpen(false);
        setIsPreviewOpen(false);
        loadNotifications();
      }
    } catch (err: any) {
      toast.error('Broadcast Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDeactivate = async (id: string) => {
    if (!window.confirm('Are you sure you want to deactivate this notification banner for users?')) return;
    try {
      const res = await adminClient.deleteNotification(id);
      if (res.success) {
        toast.success('Notification Deactivated', 'The banner will no longer appear on user screens.');
        loadNotifications();
      }
    } catch (err: any) {
      toast.error('Action Failed', err.message);
    }
  };

  const getTypeIcon = (t: string) => {
    switch (t) {
      case 'warning':
        return <AlertTriangle className="w-4 h-4 text-amber-500" />;
      case 'maintenance':
        return <Wrench className="w-4 h-4 text-rose-500" />;
      case 'announcement':
        return <ShieldAlert className="w-4 h-4 text-indigo-500" />;
      default:
        return <Info className="w-4 h-4 text-emerald-500" />;
    }
  };

  const getTypeBadge = (t: string) => {
    switch (t) {
      case 'warning':
        return 'bg-amber-100 text-amber-800 dark:bg-amber-900/30 dark:text-amber-300';
      case 'maintenance':
        return 'bg-rose-100 text-rose-800 dark:bg-rose-900/30 dark:text-rose-300';
      case 'announcement':
        return 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/30 dark:text-indigo-300';
      default:
        return 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/30 dark:text-emerald-300';
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
        <div>
          <div className="flex items-center gap-2 text-emerald-600 font-bold text-xs uppercase tracking-wider mb-1">
            <Bell className="w-4 h-4" />
            Communications & Alerts
          </div>
          <h2 className="text-xl font-black text-slate-900 dark:text-white">Broadcast Notifications</h2>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
            Dispatch announcements, security warnings, and maintenance notices directly to all or targeted user accounts.
          </p>
        </div>

        <div className="flex items-center gap-3">
          <button
            onClick={loadNotifications}
            disabled={isLoading}
            className="p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-colors"
            title="Refresh notifications"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2.5 bg-emerald-600 hover:bg-emerald-500 text-white rounded-xl text-xs font-bold transition-all shadow-md shadow-emerald-600/20 active:scale-95"
          >
            <Send className="w-3.5 h-3.5" />
            New Broadcast
          </button>
        </div>
      </div>

      {/* Metrics Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Total Broadcasts</p>
          <p className="text-2xl font-black text-slate-800 dark:text-white mt-1">{notifications.length}</p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Active Banners</p>
          <p className="text-2xl font-black text-emerald-600 mt-1">
            {notifications.filter((n) => n.is_active).length}
          </p>
        </div>
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 shadow-sm">
          <p className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">Audience Reach</p>
          <p className="text-2xl font-black text-indigo-600 mt-1">100% Platform</p>
        </div>
      </div>

      {/* Broadcast History Table */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
        <div className="p-4 sm:p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <h3 className="font-bold text-sm text-slate-800 dark:text-slate-100 flex items-center gap-2">
            <Clock className="w-4 h-4 text-emerald-600" />
            Broadcast Dispatch History
          </h3>
          <span className="text-xs text-slate-400 font-medium">Real-time database records</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 font-bold border-b border-slate-100 dark:border-slate-800">
              <tr>
                <th className="p-3.5">Type</th>
                <th className="p-3.5">Title & Message</th>
                <th className="p-3.5">Audience</th>
                <th className="p-3.5">Dispatched By</th>
                <th className="p-3.5">Date & Time</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5 text-right">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {isLoading ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    <RefreshCw className="w-5 h-5 animate-spin mx-auto mb-2 text-emerald-500" />
                    Loading broadcast notifications...
                  </td>
                </tr>
              ) : notifications.length === 0 ? (
                <tr>
                  <td colSpan={7} className="p-8 text-center text-slate-400">
                    No broadcast announcements dispatched yet. Click "New Broadcast" to send one.
                  </td>
                </tr>
              ) : (
                notifications.map((n) => (
                  <tr key={n.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="p-3.5">
                      <span className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full font-bold uppercase text-[10px] ${getTypeBadge(n.type)}`}>
                        {getTypeIcon(n.type)}
                        {n.type}
                      </span>
                    </td>
                    <td className="p-3.5 max-w-md">
                      <p className="font-bold text-slate-800 dark:text-slate-200">{n.title}</p>
                      <p className="text-slate-500 dark:text-slate-400 line-clamp-2 mt-0.5">{n.message}</p>
                    </td>
                    <td className="p-3.5 font-medium text-slate-600 dark:text-slate-300 capitalize">
                      <span className="inline-flex items-center gap-1">
                        <Users className="w-3.5 h-3.5 text-slate-400" />
                        {n.target_user_id === 'all' ? 'All Registered Users' : n.target_user_id}
                      </span>
                    </td>
                    <td className="p-3.5">
                      <p className="font-bold text-slate-700 dark:text-slate-300">{n.creator_name || 'Admin'}</p>
                      <p className="text-[11px] text-slate-400 font-mono">{n.creator_email || 'System'}</p>
                    </td>
                    <td className="p-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                      {new Date(n.created_at).toLocaleString()}
                    </td>
                    <td className="p-3.5">
                      <span
                        className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          n.is_active
                            ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-500 dark:bg-slate-800 dark:text-slate-400'
                        }`}
                      >
                        {n.is_active ? <CheckCircle2 className="w-3 h-3" /> : null}
                        {n.is_active ? 'Active' : 'Deactivated'}
                      </span>
                    </td>
                    <td className="p-3.5 text-right">
                      {n.is_active && (
                        <button
                          onClick={() => handleDeactivate(n.id)}
                          className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/30 text-rose-600 dark:text-rose-400 rounded-lg text-xs font-semibold cursor-pointer transition-colors"
                          title="Deactivate notice"
                        >
                          Deactivate
                        </button>
                      )}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* New Broadcast Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 animate-in fade-in zoom-in-95 duration-150">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Bell className="w-5 h-5 text-emerald-600" />
                <h3 className="font-bold text-base text-slate-900 dark:text-white">Create Broadcast Announcement</h3>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendNotification} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Notification Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g., Scheduled Maintenance Window / Important Security Update"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Notice Type</label>
                  <select
                    value={type}
                    onChange={(e: any) => setType(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="info">General Info (Emerald)</option>
                    <option value="announcement">Announcement (Indigo)</option>
                    <option value="warning">Warning / Advisory (Amber)</option>
                    <option value="maintenance">Maintenance Alert (Rose)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">Target Audience</label>
                  <select
                    value={targetAudience}
                    onChange={(e: any) => setTargetAudience(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="all">All Registered Users</option>
                    <option value="active">Active Users Only</option>
                    <option value="inactive">Inactive / Inactive Accounts</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Message Content *
                </label>
                <textarea
                  required
                  rows={4}
                  placeholder="Type clear instructions or information for users..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-800 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500 resize-none"
                />
              </div>

              {/* Live Preview Toggle */}
              <div className="pt-2">
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen(!isPreviewOpen)}
                  className="text-xs font-bold text-emerald-600 hover:text-emerald-500 flex items-center gap-1"
                >
                  <Eye className="w-3.5 h-3.5" />
                  {isPreviewOpen ? 'Hide Preview' : 'Show User Banner Preview'}
                </button>

                {isPreviewOpen && (
                  <div className="mt-3 p-4 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/80">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400 mb-2">User Banner Preview</p>
                    <div className="flex items-start gap-3">
                      <div className="p-2 rounded-xl bg-white dark:bg-slate-700 shadow-sm">
                        {getTypeIcon(type)}
                      </div>
                      <div>
                        <h4 className="text-xs font-bold text-slate-900 dark:text-white">{title || 'Notification Title'}</h4>
                        <p className="text-xs text-slate-600 dark:text-slate-300 mt-0.5">
                          {message || 'Notification content will be displayed here as it will appear on user screens.'}
                        </p>
                      </div>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex items-center justify-end gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 text-xs font-bold text-slate-500 hover:text-slate-700 dark:hover:text-slate-300 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="flex items-center gap-2 px-5 py-2.5 bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white rounded-xl text-xs font-bold cursor-pointer transition-all shadow-md shadow-emerald-600/20"
                >
                  <Send className="w-3.5 h-3.5" />
                  {isSubmitting ? 'Dispatching...' : 'Dispatch Broadcast Now'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
