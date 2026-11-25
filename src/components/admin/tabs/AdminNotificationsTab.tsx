import React, { useState, useEffect } from 'react';
import {
  Bell,
  Send,
  AlertTriangle,
  Info,
  Trash2,
  Eye,
  X,
  Smartphone,
  Mail,
  Calendar,
  Layers,
  ShieldAlert,
  RotateCw,
  Megaphone,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';
import { ConfirmModal } from '../../common/ConfirmModal';

export const AdminNotificationsTab: React.FC = () => {
  const toast = useToast();
  const [activeTab, setActiveTab] = useState<'campaigns' | 'banners'>('campaigns');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [banners, setBanners] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [analytics, setAnalytics] = useState<any>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Composer Modal State
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form Fields
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<'announcement' | 'offer' | 'system' | 'security' | 'reminder'>('announcement');
  const [type, setType] = useState<'info' | 'warning' | 'maintenance' | 'announcement' | 'offer' | 'reminder'>('announcement');
  const [channelInApp, setChannelInApp] = useState(true);
  const [channelPush, setChannelPush] = useState(true);
  const [channelEmail, setChannelEmail] = useState(false);
  const [targetType, setTargetType] = useState<'all' | 'installed' | 'push_subscribed' | 'active' | 'selected' | 'specific' | 'admins'>('all');
  const [selectedUserIds, setSelectedUserIds] = useState<string[]>([]);
  const [specificUserId, setSpecificUserId] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('10:00');
  const [deepLink, setDeepLink] = useState('dashboard');
  const [isPreviewOpen, setIsPreviewOpen] = useState(false);
  const [isSendingTest, setIsSendingTest] = useState(false);
  const [confirmAction, setConfirmAction] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    isDestructive: boolean;
    onConfirm: () => Promise<void> | void;
  } | null>(null);

  // Example Notification Presets
  const PRESETS = [
    {
      title: 'Welcome to My Money Manager',
      message: 'Your app is ready. Start managing your money easily.',
      category: 'announcement' as const,
      type: 'announcement' as const,
      deepLink: 'dashboard',
    },
    {
      title: 'Important Update',
      message: 'A new My Money Manager update is available.',
      category: 'system' as const,
      type: 'info' as const,
      deepLink: 'dashboard',
    },
    {
      title: 'Budget Reminder',
      message: 'You are approaching your monthly budget limit.',
      category: 'reminder' as const,
      type: 'warning' as const,
      deepLink: 'budget',
    },
    {
      title: 'Security Alert',
      message: 'A new login was detected on your account.',
      category: 'security' as const,
      type: 'warning' as const,
      deepLink: 'settings',
    },
  ];

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setTitle(preset.title);
    setMessage(preset.message);
    setCategory(preset.category);
    setType(preset.type);
    setDeepLink(preset.deepLink);
    toast.info('Template Applied', `"${preset.title}" populated in composer.`);
  };

  const handleSaveDraft = () => {
    try {
      localStorage.setItem(
        'my_money_campaign_draft',
        JSON.stringify({ title, message, category, type, deepLink, targetType })
      );
      toast.success('Draft Saved', 'Campaign copy saved locally.');
    } catch {
      toast.error('Draft Error', 'Could not save draft to local storage.');
    }
  };

  const handleLoadDraft = () => {
    try {
      const raw = localStorage.getItem('my_money_campaign_draft');
      if (raw) {
        const d = JSON.parse(raw);
        if (d.title) setTitle(d.title);
        if (d.message) setMessage(d.message);
        if (d.category) setCategory(d.category);
        if (d.type) setType(d.type);
        if (d.deepLink) setDeepLink(d.deepLink);
        if (d.targetType) setTargetType(d.targetType);
        toast.success('Draft Loaded', 'Previous campaign draft restored.');
      } else {
        toast.info('No Draft', 'No saved campaign draft was found.');
      }
    } catch {
      toast.error('Draft Error', 'Failed to load draft.');
    }
  };

  const handleSendTestNotification = async () => {
    if (!title.trim() || !message.trim()) {
      toast.error('Validation Error', 'Please enter a title and message before sending a test notification.');
      return;
    }
    setIsSendingTest(true);
    try {
      const res = await adminClient.sendTestNotification({
        title: title.trim(),
        message: message.trim(),
        deep_link: deepLink,
      });
      if (res.success) {
        toast.success('Test Push Dispatched', res.message || 'Notification sent to your admin session.');
      } else {
        toast.warning('Test Push Notice', res.message || 'Push was dispatched in-app; verify push permission.');
      }
    } catch (err: any) {
      toast.error('Test Push Failed', err.message);
    } finally {
      setIsSendingTest(false);
    }
  };

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [cRes, bRes, aRes, uRes] = await Promise.all([
        adminClient.getCampaigns().catch(() => ({ success: false, campaigns: [] })),
        adminClient.getNotifications().catch(() => ({ success: false, notifications: [] })),
        adminClient.getNotificationAnalytics().catch(() => ({ success: false })),
        adminClient.getUsers('', 'all').catch(() => ({ success: false, users: [] })),
      ]);

      if (cRes.success) setCampaigns(cRes.campaigns || []);
      if (bRes.success) setBanners(bRes.notifications || []);
      if (aRes.success) setAnalytics(aRes);
      if (uRes.success) setUsersList(uRes.users || []);
    } catch (err: any) {
      toast.error('Data Load Failed', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  const executeSendCampaign = async (channels: string[], scheduledFor: string | null) => {
    setIsSubmitting(true);
    try {
      const targetUserIds =
        targetType === 'specific'
          ? specificUserId.trim()
            ? [specificUserId.trim()]
            : undefined
          : targetType === 'selected'
          ? selectedUserIds
          : undefined;

      const res = await adminClient.createCampaign({
        title: title.trim(),
        message: message.trim(),
        category,
        type,
        channels,
        target_type: targetType,
        target_user_ids: targetUserIds,
        deep_link: deepLink,
        scheduled_for: scheduledFor,
      });

      if (res.success) {
        toast.success(
          isScheduled ? 'Campaign Scheduled' : 'Campaign Dispatched',
          res.message || 'Notification broadcast successfully launched.'
        );
        setTitle('');
        setMessage('');
        setIsModalOpen(false);
        setIsPreviewOpen(false);
        loadData();
      }
    } catch (err: any) {
      toast.error('Dispatch Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSendCampaign = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!title.trim() || !message.trim()) {
      toast.error('Validation Error', 'Title and message cannot be empty.');
      return;
    }

    const channels: string[] = [];
    if (channelInApp) channels.push('in_app');
    if (channelPush) channels.push('push');
    if (channelEmail) channels.push('email');

    if (channels.length === 0) {
      toast.error('Channel Required', 'Please select at least one delivery channel.');
      return;
    }

    if (targetType === 'specific' && !specificUserId.trim()) {
      toast.error('User ID Required', 'Please enter a specific User ID.');
      return;
    }
    if (targetType === 'selected' && selectedUserIds.length === 0) {
      toast.error('Recipients Required', 'Please select at least one user.');
      return;
    }

    let scheduledFor: string | null = null;
    if (isScheduled && scheduledDate) {
      scheduledFor = new Date(`${scheduledDate}T${scheduledTime}:00+05:30`).toISOString();
    }

    setConfirmAction({
      title: isScheduled ? 'Schedule Broadcast Campaign?' : 'Broadcast Notification Now?',
      message: `Send "${title.trim()}" across [${channels.join(', ')}] to [${targetType.toUpperCase()}] recipients?`,
      confirmLabel: isScheduled ? 'Schedule Campaign' : 'Broadcast Now',
      isDestructive: false,
      onConfirm: async () => {
        setConfirmAction(null);
        await executeSendCampaign(channels, scheduledFor);
      },
    });
  };

  const handleCancelCampaign = (id: string) => {
    setConfirmAction({
      title: 'Cancel Scheduled Campaign?',
      message: 'This scheduled broadcast will not be delivered to users.',
      confirmLabel: 'Cancel Campaign',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmAction(null);
        try {
          const res = await adminClient.cancelCampaign(id);
          if (res.success) {
            toast.success('Campaign Cancelled', 'The scheduled broadcast was removed.');
            loadData();
          }
        } catch (err: any) {
          toast.error('Action Failed', err.message);
        }
      },
    });
  };

  const handleRetryCampaign = async (id: string) => {
    try {
      const res = await adminClient.retryCampaign(id);
      if (res.success) {
        toast.success('Retry Dispatched', res.message || 'Retrying delivery for failed recipients.');
        loadData();
      }
    } catch (err: any) {
      toast.error('Retry Failed', err.message);
    }
  };

  const handleDeactivateBanner = (id: string) => {
    setConfirmAction({
      title: 'Deactivate Broadcast Banner?',
      message: 'This notification banner will no longer appear to users.',
      confirmLabel: 'Deactivate',
      isDestructive: true,
      onConfirm: async () => {
        setConfirmAction(null);
        try {
          const res = await adminClient.deleteNotification(id);
          if (res.success) {
            toast.success('Banner Deactivated', 'The banner will no longer appear on user screens.');
            loadData();
          }
        } catch (err: any) {
          toast.error('Action Failed', err.message);
        }
      },
    });
  };

  const openBroadcastAllComposer = () => {
    setTargetType('all');
    setCategory('announcement');
    setType('announcement');
    setChannelInApp(true);
    setChannelPush(true);
    setIsScheduled(false);
    setIsModalOpen(true);
  };

  return (
    <div className="space-y-6">
      {/* KPI Stats Cards */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Push Tokens</p>
            <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
              {analytics?.activePushSubscribers ?? 0}
            </p>
            <p className="text-[10px] text-emerald-600 font-bold mt-0.5">Live Registered Devices</p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
            <Smartphone className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">In-App Alerts</p>
            <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
              {analytics?.inAppTotal ?? 0}
            </p>
            <p className="text-[10px] text-slate-500 font-semibold mt-0.5">
              Read Rate: {analytics?.inAppTotal ? Math.round(((analytics?.inAppRead || 0) / analytics.inAppTotal) * 100) : 0}%
            </p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-600 flex items-center justify-center">
            <Bell className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Total Campaigns</p>
            <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
              {campaigns.length}
            </p>
            <p className="text-[10px] text-indigo-600 font-bold mt-0.5">Broadcast Blasts</p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 flex items-center justify-center">
            <Layers className="w-5 h-5" />
          </div>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-center justify-between">
          <div>
            <p className="text-xs font-bold text-slate-400 uppercase tracking-wider">Active Banners</p>
            <p className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
              {banners.filter((b) => b.is_active).length}
            </p>
            <p className="text-[10px] text-amber-600 font-bold mt-0.5">Visible to users</p>
          </div>
          <div className="w-10 h-10 rounded-2xl bg-amber-500/10 text-amber-600 flex items-center justify-center">
            <ShieldAlert className="w-5 h-5" />
          </div>
        </div>
      </div>

      {/* Action Header & Tabs */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveTab('campaigns')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'campaigns'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Multi-Channel Campaigns ({campaigns.length})
          </button>
          <button
            onClick={() => setActiveTab('banners')}
            className={`px-4 py-2 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              activeTab === 'banners'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
            }`}
          >
            Legacy Banners ({banners.length})
          </button>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={loadData}
            disabled={isLoading}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            title="Refresh list"
          >
            <RotateCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
          <button
            type="button"
            onClick={openBroadcastAllComposer}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-bold rounded-xl shadow-md shadow-indigo-600/20 transition-all cursor-pointer"
          >
            <Megaphone className="w-3.5 h-3.5" />
            <span>Broadcast to All Users</span>
          </button>
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 px-4 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl shadow-md shadow-emerald-600/20 transition-all cursor-pointer"
          >
            <Send className="w-3.5 h-3.5" />
            <span>Compose Campaign</span>
          </button>
        </div>
      </div>

      {/* Campaigns Table */}
      {activeTab === 'campaigns' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/50 border-b border-slate-200 dark:border-slate-800 text-slate-500 uppercase tracking-wider text-[10px] font-bold">
                <tr>
                  <th className="p-4">Title & Message</th>
                  <th className="p-4">Category</th>
                  <th className="p-4">Channels</th>
                  <th className="p-4">Targeting</th>
                  <th className="p-4">Delivery KPI</th>
                  <th className="p-4">Status & Date</th>
                  <th className="p-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {campaigns.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      No notification campaigns created yet. Click "Compose Campaign" to start.
                    </td>
                  </tr>
                ) : (
                  campaigns.map((c) => (
                    <tr key={c.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40 transition-colors">
                      <td className="p-4 max-w-xs">
                        <p className="font-extrabold text-slate-900 dark:text-slate-100 truncate">{c.title}</p>
                        <p className="text-[11px] text-slate-500 truncate mt-0.5">{c.message}</p>
                      </td>
                      <td className="p-4">
                        <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 uppercase text-[9px] font-bold">
                          {c.category}
                        </span>
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-1.5">
                          {c.channels?.includes('in_app') && (
                            <span className="p-1 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-600" title="In-App">
                              <Bell className="w-3 h-3" />
                            </span>
                          )}
                          {c.channels?.includes('push') && (
                            <span className="p-1 rounded-md bg-blue-100 dark:bg-blue-950 text-blue-600" title="Web Push">
                              <Smartphone className="w-3 h-3" />
                            </span>
                          )}
                          {c.channels?.includes('email') && (
                            <span className="p-1 rounded-md bg-amber-100 dark:bg-amber-950 text-amber-600" title="Email">
                              <Mail className="w-3 h-3" />
                            </span>
                          )}
                        </div>
                      </td>
                      <td className="p-4 capitalize text-slate-600 dark:text-slate-300">
                        {c.target_type} ({c.total_targets || 0})
                      </td>
                      <td className="p-4">
                        <div className="flex items-center gap-2">
                          <span className="text-emerald-600 font-bold">✓ {c.delivered_count || 0}</span>
                          {(c.failed_count || 0) > 0 && (
                            <span className="text-rose-500 font-bold">✗ {c.failed_count}</span>
                          )}
                        </div>
                      </td>
                      <td className="p-4">
                        <div className="space-y-0.5">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-bold uppercase ${
                              c.status === 'sent'
                                ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : c.status === 'scheduled'
                                ? 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/60 dark:text-indigo-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {c.status}
                          </span>
                          <p className="text-[10px] text-slate-400">
                            {c.sent_at
                              ? new Date(c.sent_at).toLocaleString()
                              : c.scheduled_for
                              ? `Sched: ${new Date(c.scheduled_for).toLocaleString()}`
                              : new Date(c.created_at).toLocaleString()}
                          </p>
                        </div>
                      </td>
                      <td className="p-4 text-right">
                        <div className="flex items-center justify-end gap-1.5">
                          {c.status === 'scheduled' && (
                            <button
                              onClick={() => handleCancelCampaign(c.id)}
                              className="px-2.5 py-1 rounded-lg text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 text-[11px] font-bold cursor-pointer"
                            >
                              Cancel
                            </button>
                          )}
                          {(c.failed_count || 0) > 0 && (
                            <button
                              onClick={() => handleRetryCampaign(c.id)}
                              className="px-2.5 py-1 rounded-lg bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 font-bold text-[11px] hover:bg-emerald-100 cursor-pointer"
                            >
                              Retry
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Legacy Banners List */}
      {activeTab === 'banners' && (
        <div className="space-y-3">
          {banners.length === 0 ? (
            <div className="p-12 text-center text-slate-400 bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
              No banner announcements active.
            </div>
          ) : (
            banners.map((b) => (
              <div
                key={b.id}
                className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm flex items-start justify-between gap-4"
              >
                <div>
                  <div className="flex items-center gap-2 mb-1">
                    <span className="font-extrabold text-sm text-slate-900 dark:text-slate-100">{b.title}</span>
                    <span className="px-2 py-0.5 rounded-md text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600">
                      {b.type}
                    </span>
                    {b.is_active ? (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700">
                        Active
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-400">
                        Deactivated
                      </span>
                    )}
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">{b.message}</p>
                  <p className="text-[10px] text-slate-400 mt-2">
                    Target: {b.target_user_id || 'all'} · Created: {new Date(b.created_at).toLocaleString()}
                  </p>
                </div>
                {b.is_active && (
                  <button
                    onClick={() => handleDeactivateBanner(b.id)}
                    className="p-2 text-rose-500 hover:bg-rose-50 dark:hover:bg-rose-950/40 rounded-xl transition-colors cursor-pointer"
                    title="Deactivate banner"
                  >
                    <Trash2 className="w-4 h-4" />
                  </button>
                )}
              </div>
            ))
          )}
        </div>
      )}

      {/* Composer Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-xl shadow-2xl overflow-hidden max-h-[92vh] flex flex-col">
            <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/40">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-600 flex items-center justify-center">
                  <Send className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                    Campaign Composer
                  </h3>
                  <p className="text-xs text-slate-500">
                    Broadcast multi-channel notifications to users
                  </p>
                </div>
              </div>
              <button
                onClick={() => setIsModalOpen(false)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleSendCampaign} className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {/* Quick Presets Bar */}
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200/70 dark:border-slate-700/70 space-y-1.5">
                <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                  Quick Presets & Templates:
                </p>
                <div className="flex flex-wrap gap-1.5">
                  {PRESETS.map((p, idx) => (
                    <button
                      key={idx}
                      type="button"
                      onClick={() => applyPreset(p)}
                      className="px-2.5 py-1 rounded-lg bg-white dark:bg-slate-800 text-slate-700 dark:text-slate-300 hover:text-emerald-600 dark:hover:text-emerald-400 hover:border-emerald-500 text-[11px] font-semibold border border-slate-200 dark:border-slate-700 transition-all shadow-2xs cursor-pointer"
                    >
                      {p.title}
                    </button>
                  ))}
                </div>
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Notification Title *
                </label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 🎉 New Feature Alert or Weekend Special!"
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>

              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Notification Message *
                </label>
                <textarea
                  required
                  rows={3}
                  placeholder="Write clear, engaging notification copy for your users..."
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-medium focus:outline-none focus:ring-2 focus:ring-emerald-500/30"
                />
              </div>

              {/* Delivery Channels */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Delivery Channels *
                </label>
                <div className="grid grid-cols-3 gap-2">
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelInApp}
                      onChange={(e) => setChannelInApp(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded"
                    />
                    <span className="font-bold">In-App Center</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelPush}
                      onChange={(e) => setChannelPush(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded"
                    />
                    <span className="font-bold">Mobile Push</span>
                  </label>
                  <label className="flex items-center gap-2 p-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/30 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={channelEmail}
                      onChange={(e) => setChannelEmail(e.target.checked)}
                      className="w-4 h-4 text-emerald-600 rounded"
                    />
                    <span className="font-bold">Email Blast</span>
                  </label>
                </div>
              </div>

              {/* Category & Deep Link */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Category
                  </label>
                  <select
                    value={category}
                    onChange={(e: any) => setCategory(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold"
                  >
                    <option value="announcement">Announcement</option>
                    <option value="offer">Special Offer</option>
                    <option value="system">System / Feature</option>
                    <option value="security">Security Alert</option>
                    <option value="reminder">Reminder</option>
                  </select>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Deep Link (Destination)
                  </label>
                  <select
                    value={deepLink}
                    onChange={(e) => setDeepLink(e.target.value)}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-xl font-semibold"
                  >
                    <option value="dashboard">Dashboard</option>
                    <option value="budget">Budget Section</option>
                    <option value="people">People (Udhar Khata)</option>
                    <option value="calculator">Calculator</option>
                    <option value="reports">Reports & Analytics</option>
                    <option value="all_transactions">All Transactions</option>
                    <option value="settings">Settings & Profile</option>
                  </select>
                </div>
              </div>

              {/* Target Audience */}
              <div>
                <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Target Audience *
                </label>
                <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                  {[
                    { id: 'all', label: 'All Eligible Users' },
                    { id: 'installed', label: 'Installed App Users' },
                    { id: 'push_subscribed', label: 'Active Push Subs' },
                    { id: 'admins', label: 'Administrators' },
                    { id: 'active', label: 'Active (Last 30d)' },
                    { id: 'specific', label: 'Specific User ID' },
                    { id: 'selected', label: 'Multi-Select Users' },
                  ].map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      onClick={() => setTargetType(t.id as any)}
                      className={`py-2 px-2.5 rounded-xl text-[11px] font-bold border transition-all cursor-pointer ${
                        targetType === t.id
                          ? 'bg-emerald-600 text-white border-emerald-600 shadow-sm'
                          : 'bg-slate-50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-300 border-slate-200 dark:border-slate-700 hover:bg-slate-100'
                      }`}
                    >
                      {t.label}
                    </button>
                  ))}
                </div>

                {targetType === 'specific' && (
                  <div className="mt-2.5">
                    <label className="block text-[11px] font-semibold text-slate-500 mb-1">User ID (UUID)</label>
                    <input
                      type="text"
                      placeholder="e.g. 550e8400-e29b-41d4-a716-446655440000"
                      value={specificUserId}
                      onChange={(e) => setSpecificUserId(e.target.value)}
                      className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-mono text-xs"
                    />
                  </div>
                )}

                {targetType === 'selected' && (
                  <div className="mt-2.5 p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 max-h-36 overflow-y-auto space-y-1">
                    {usersList.map((u) => (
                      <label key={u.id} className="flex items-center gap-2 text-[11px] cursor-pointer">
                        <input
                          type="checkbox"
                          checked={selectedUserIds.includes(u.id)}
                          onChange={(e) => {
                            if (e.target.checked) {
                              setSelectedUserIds((prev) => [...prev, u.id]);
                            } else {
                              setSelectedUserIds((prev) => prev.filter((id) => id !== u.id));
                            }
                          }}
                          className="w-3.5 h-3.5 text-emerald-600 rounded"
                        />
                        <span className="font-semibold">{u.full_name || u.email}</span>
                        <span className="text-slate-400">({u.email})</span>
                      </label>
                    ))}
                  </div>
                )}
              </div>

              {/* Scheduled Delivery */}
              <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/20 space-y-2">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="w-4 h-4 text-emerald-600" />
                    <div>
                      <p className="font-bold text-slate-900 dark:text-slate-100">Schedule Delivery</p>
                      <p className="text-[11px] text-slate-400">Send automatically at a future time</p>
                    </div>
                  </div>
                  <label className="relative inline-flex items-center cursor-pointer">
                    <input
                      type="checkbox"
                      checked={isScheduled}
                      onChange={(e) => setIsScheduled(e.target.checked)}
                      className="sr-only peer"
                    />
                    <div className="w-11 h-6 bg-slate-200 peer-focus:outline-none rounded-full peer dark:bg-slate-700 peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-white after:border-slate-300 after:border after:rounded-full after:h-5 after:w-5 after:transition-all dark:border-slate-600 peer-checked:bg-emerald-600"></div>
                  </label>
                </div>

                {isScheduled && (
                  <div className="grid grid-cols-2 gap-3 pt-2 border-t border-slate-200/60 dark:border-slate-700">
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">Date</label>
                      <input
                        type="date"
                        required
                        value={scheduledDate}
                        onChange={(e) => setScheduledDate(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                      />
                    </div>
                    <div>
                      <label className="block text-[11px] font-semibold text-slate-500 mb-1">Time (IST)</label>
                      <input
                        type="time"
                        required
                        value={scheduledTime}
                        onChange={(e) => setScheduledTime(e.target.value)}
                        className="w-full px-3 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-xl"
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Preview Toggle */}
              <div>
                <button
                  type="button"
                  onClick={() => setIsPreviewOpen((p) => !p)}
                  className="flex items-center gap-1.5 text-emerald-600 dark:text-emerald-400 font-bold hover:underline cursor-pointer"
                >
                  <Eye className="w-3.5 h-3.5" />
                  <span>{isPreviewOpen ? 'Hide Preview' : 'Show Live Preview'}</span>
                </button>

                {isPreviewOpen && (
                  <div className="mt-2.5 p-4 rounded-2xl bg-emerald-50/50 dark:bg-emerald-950/20 border border-emerald-500/30 space-y-2">
                    <p className="text-[10px] uppercase font-bold text-emerald-600 tracking-wider">Preview Card</p>
                    <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
                      <p className="font-extrabold text-xs text-slate-900 dark:text-slate-100">{title || 'Sample Title'}</p>
                      <p className="text-[11px] text-slate-600 dark:text-slate-300">{message || 'Your notification message copy will appear here.'}</p>
                      <p className="text-[9px] text-emerald-600 font-semibold pt-1">Deep Link: #{deepLink}</p>
                    </div>
                  </div>
                )}
              </div>

              {/* Action Buttons: Save Draft, Load Draft, Test Push, Cancel, Dispatch */}
              <div className="pt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    className="px-2.5 py-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                  >
                    Save Draft
                  </button>
                  <button
                    type="button"
                    onClick={handleLoadDraft}
                    className="px-2.5 py-1.5 text-[11px] font-bold text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl transition-colors cursor-pointer"
                  >
                    Load Draft
                  </button>
                  <button
                    type="button"
                    onClick={handleSendTestNotification}
                    disabled={isSendingTest}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 text-[11px] font-bold bg-amber-500/10 text-amber-600 hover:bg-amber-500/20 rounded-xl transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Smartphone className="w-3 h-3" />
                    <span>{isSendingTest ? 'Sending...' : 'Send Test Notification'}</span>
                  </button>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="px-4 py-2 rounded-xl text-slate-600 font-bold hover:bg-slate-100 transition-colors cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="flex items-center gap-2 px-5 py-2 bg-emerald-600 hover:bg-emerald-700 text-white font-bold rounded-xl shadow-md shadow-emerald-600/20 transition-all cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isScheduled ? 'Schedule Broadcast' : 'Dispatch Now'}</span>
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
      <ConfirmModal
        isOpen={Boolean(confirmAction)}
        title={confirmAction?.title || 'Confirm Action'}
        message={confirmAction?.message || ''}
        confirmLabel={confirmAction?.confirmLabel || 'Confirm'}
        isDestructive={Boolean(confirmAction?.isDestructive)}
        isLoading={isSubmitting}
        onConfirm={() => void confirmAction?.onConfirm()}
        onCancel={() => setConfirmAction(null)}
      />
    </div>
  );
};
