import React, { useState, useEffect, useMemo } from 'react';
import {
  Megaphone,
  Send,
  Plus,
  RefreshCw,
  Eye,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Users,
  Smartphone,
  ExternalLink,
  Tag,
  Image as ImageIcon,
  Calendar,
  Layers,
  Sparkles,
  Search,
  X,
  RotateCw,
  Bell,
  Check,
  Percent,
  Gift,
  HelpCircle,
  FileText,
  Filter,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useExpense } from '../../../context/ExpenseContext';
import { useToast } from '../../../context/ToastContext';
import { ConfirmModal } from '../../common/ConfirmModal';

export type PromoCategory =
  | 'Offers'
  | 'Discounts'
  | 'Special Announcements'
  | 'New Features'
  | 'Important Updates'
  | 'General Promotions'
  | 'Custom';

const PREDEFINED_CATEGORIES: { id: PromoCategory; label: string; icon: React.ElementType; color: string }[] = [
  { id: 'Offers', label: 'Offers', icon: Gift, color: 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 border-emerald-500/20' },
  { id: 'Discounts', label: 'Discounts', icon: Percent, color: 'text-amber-500 bg-amber-50 dark:bg-amber-950/40 border-amber-500/20' },
  { id: 'Special Announcements', label: 'Special Announcements', icon: Megaphone, color: 'text-purple-500 bg-purple-50 dark:bg-purple-950/40 border-purple-500/20' },
  { id: 'New Features', label: 'New Features', icon: Sparkles, color: 'text-blue-500 bg-blue-50 dark:bg-blue-950/40 border-blue-500/20' },
  { id: 'Important Updates', label: 'Important Updates', icon: AlertTriangle, color: 'text-rose-500 bg-rose-50 dark:bg-rose-950/40 border-rose-500/20' },
  { id: 'General Promotions', label: 'General Promotions', icon: Tag, color: 'text-teal-500 bg-teal-50 dark:bg-teal-950/40 border-teal-500/20' },
];

const PRESETS = [
  {
    category: 'Offers' as PromoCategory,
    title: 'Special Weekend Cashback Offer',
    message: 'Track your weekend spends today and unlock smart insights in My Money Manager.',
    deepLink: 'dashboard',
  },
  {
    category: 'New Features' as PromoCategory,
    title: 'New: 2-Way Instant Udhar QR Sync',
    message: 'Connect with friends in seconds using your personalized Udhar QR code.',
    deepLink: 'people',
  },
  {
    category: 'Special Announcements' as PromoCategory,
    title: 'Smart Safe-to-Spend Is Now Live',
    message: 'Know exactly how much you can spend today without touching committed bills or savings.',
    deepLink: 'safe-to-spend',
  },
  {
    category: 'Important Updates' as PromoCategory,
    title: 'App Performance & Security Update',
    message: 'We have updated transaction encryption and offline ledger synchronization.',
    deepLink: 'settings',
  },
  {
    category: 'Discounts' as PromoCategory,
    title: 'Exclusive HackifyPro Member Benefits',
    message: 'Enjoy unlimited ledger backups, multi-device sync, and zero ad interruptions.',
    deepLink: 'reports',
  },
];

export const AdminAppPushNotificationsTab: React.FC = () => {
  const { siteConfig } = useExpense();
  const toast = useToast();
  const userBrand = siteConfig.branding.user_app;

  const [activeTab, setActiveTab] = useState<'dashboard' | 'create'>('dashboard');
  const [campaigns, setCampaigns] = useState<any[]>([]);
  const [usersList, setUsersList] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Form State
  const [title, setTitle] = useState('');
  const [message, setMessage] = useState('');
  const [category, setCategory] = useState<PromoCategory>('Offers');
  const [customCategory, setCustomCategory] = useState('');
  const [imageUrl, setImageUrl] = useState('');
  const [targetAudience, setTargetAudience] = useState<'all' | 'opted_in' | 'active' | 'specific'>('all');
  const [specificUserId, setSpecificUserId] = useState('');
  const [deepLink, setDeepLink] = useState('dashboard');
  const [customLink, setCustomLink] = useState('');
  const [isScheduled, setIsScheduled] = useState(false);
  const [scheduledDate, setScheduledDate] = useState('');
  const [scheduledTime, setScheduledTime] = useState('10:00');

  // Preview & Confirm Modal
  const [showConfirmModal, setShowConfirmModal] = useState(false);
  const [searchFilter, setSearchFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'sent' | 'scheduled' | 'cancelled'>('all');

  const loadData = async () => {
    setIsLoading(true);
    try {
      const [campRes, usersRes] = await Promise.allSettled([
        adminClient.getCampaigns(),
        adminClient.getUsers('all'),
      ]);

      if (campRes.status === 'fulfilled' && campRes.value?.success && Array.isArray(campRes.value.campaigns)) {
        setCampaigns(campRes.value.campaigns);
      }
      if (usersRes.status === 'fulfilled' && usersRes.value?.success && Array.isArray(usersRes.value.users)) {
        setUsersList(usersRes.value.users);
      }
    } catch (err: any) {
      toast.error('Load Error', err?.message || 'Failed to load campaigns and user statistics.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Compute realistic dashboard statistics from actual backend data
  const stats = useMemo(() => {
    const totalUsers = usersList.length;
    // Push subscribers: users with push enabled or registered web-push subscriptions
    const activeSubscribers = usersList.filter(
      (u) => u.push_subscription || u.push_token || u.preferences?.push_enabled !== false
    ).length;
    const unsubscribedUsers = Math.max(0, totalUsers - activeSubscribers);

    const totalCampaigns = campaigns.length;
    let deliveredCount = 0;
    let failedCount = 0;

    campaigns.forEach((c) => {
      deliveredCount += Number(c.delivered_count || c.metadata?.deliveredCount || 0);
      failedCount += Number(c.failed_count || c.metadata?.failedCount || 0);
    });

    return {
      totalEligible: totalUsers,
      activeSubscribers,
      unsubscribedUsers,
      totalCampaigns,
      deliveredCount,
      failedCount,
    };
  }, [usersList, campaigns]);

  const filteredCampaigns = useMemo(() => {
    return campaigns.filter((c) => {
      if (statusFilter !== 'all' && c.status !== statusFilter) return false;
      if (searchFilter.trim()) {
        const query = searchFilter.toLowerCase();
        return (
          c.title?.toLowerCase().includes(query) ||
          c.message?.toLowerCase().includes(query) ||
          c.category?.toLowerCase().includes(query)
        );
      }
      return true;
    });
  }, [campaigns, statusFilter, searchFilter]);

  const targetRecipientCount = useMemo(() => {
    if (targetAudience === 'specific') return specificUserId ? 1 : 0;
    if (targetAudience === 'opted_in') return stats.activeSubscribers;
    if (targetAudience === 'active') {
      return usersList.filter((u) => u.status === 'active' || !u.is_banned).length;
    }
    return stats.totalEligible;
  }, [targetAudience, specificUserId, stats, usersList]);

  const effectiveDestination = deepLink === 'custom' ? customLink : `/${deepLink === 'dashboard' ? '' : deepLink}`;

  const handleApplyPreset = (preset: typeof PRESETS[0]) => {
    setCategory(preset.category);
    setTitle(preset.title);
    setMessage(preset.message);
    setDeepLink(preset.deepLink);
    toast.info('Template Populated', `Loaded preset for "${preset.title}".`);
  };

  const handleCreateCampaign = async (isDraft = false) => {
    if (!title.trim() || !message.trim()) {
      toast.error('Validation Error', 'Notification Title and Message are required.');
      return;
    }

    if (targetAudience === 'specific' && !specificUserId.trim()) {
      toast.error('Validation Error', 'Please select a specific user to target.');
      return;
    }

    setIsSubmitting(true);
    try {
      const scheduledIso = isScheduled && scheduledDate
        ? new Date(`${scheduledDate}T${scheduledTime || '10:00'}:00`).toISOString()
        : null;

      const payload = {
        title: title.trim(),
        message: message.trim(),
        category: category === 'Custom' ? (customCategory.trim() || 'General Promotions') : category,
        type: 'offer',
        channels: ['push', 'in_app'],
        target_type: targetAudience === 'specific' ? 'specific' : targetAudience === 'opted_in' ? 'push_subscribed' : 'all',
        target_user_ids: targetAudience === 'specific' && specificUserId ? [specificUserId] : undefined,
        deep_link: effectiveDestination,
        scheduled_for: scheduledIso,
        status: isDraft ? 'draft' : undefined,
        metadata: {
          imageUrl: imageUrl.trim() || undefined,
          isPromotional: true,
          audienceScope: 'user_app_only',
          source: 'admin_app_push_promotions',
        },
      };

      const res = await adminClient.createCampaign(payload as any);
      if (res.success) {
        toast.success(
          isDraft ? 'Draft Saved' : isScheduled ? 'Campaign Scheduled' : 'Promotional Push Sent',
          `Campaign "${title}" was successfully ${isDraft ? 'saved as draft' : isScheduled ? 'scheduled' : 'dispatched to User App users'}.`
        );
        // Reset form
        setTitle('');
        setMessage('');
        setImageUrl('');
        setCustomCategory('');
        setShowConfirmModal(false);
        setActiveTab('dashboard');
        loadData();
      } else {
        toast.error('Campaign Dispatch Failed', res.message || 'Server rejected campaign payload.');
      }
    } catch (err: any) {
      toast.error('Dispatch Error', err?.message || 'Failed to dispatch promotional push notification.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleCancelScheduled = async (id: string) => {
    try {
      const res = await adminClient.cancelCampaign(id);
      if (res.success) {
        toast.success('Campaign Cancelled', 'The scheduled push campaign has been cancelled.');
        loadData();
      }
    } catch (err: any) {
      toast.error('Cancel Error', err?.message || 'Could not cancel campaign.');
    }
  };

  const handleRetryFailed = async (id: string) => {
    try {
      const res = await adminClient.retryCampaign(id);
      if (res.success) {
        toast.success('Retry Dispatched', 'Retry initiated for failed recipients.');
        loadData();
      }
    } catch (err: any) {
      toast.error('Retry Error', err?.message || 'Could not retry campaign.');
    }
  };

  return (
    <div className="space-y-6">
      {/* Top Header & Context Description */}
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4 p-5 bg-gradient-to-r from-emerald-950/40 via-slate-900 to-teal-950/30 rounded-3xl border border-emerald-500/20 shadow-xl">
        <div className="space-y-1">
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-emerald-500/10 border border-emerald-500/30 text-emerald-400 text-xs font-bold">
            <Megaphone className="w-3.5 h-3.5" />
            <span>Admin Control Center · App Management</span>
          </div>
          <h2 className="text-xl font-black text-white tracking-tight">
            App Push Notifications — Promotions &amp; Offers
          </h2>
          <p className="text-xs text-slate-400 max-w-2xl leading-relaxed">
            Send dedicated promotional, discount, and new feature alerts exclusively to registered <strong>User App</strong> subscribers. Completely isolated from internal operational alerts and staff notifications.
          </p>
        </div>

        <div className="flex items-center gap-2 self-start sm:self-auto">
          <button
            type="button"
            onClick={() => setActiveTab(activeTab === 'dashboard' ? 'create' : 'dashboard')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer ${
              activeTab === 'create'
                ? 'bg-slate-800 hover:bg-slate-700 text-white'
                : 'bg-emerald-600 hover:bg-emerald-500 text-white shadow-emerald-600/30'
            }`}
          >
            {activeTab === 'create' ? (
              <>
                <Layers className="w-4 h-4" />
                <span>View Dashboard</span>
              </>
            ) : (
              <>
                <Plus className="w-4 h-4" />
                <span>Create New Campaign</span>
              </>
            )}
          </button>
          <button
            type="button"
            onClick={loadData}
            disabled={isLoading}
            className="p-2.5 rounded-xl bg-slate-800/80 hover:bg-slate-800 text-slate-300 hover:text-white transition-colors cursor-pointer"
            title="Refresh Data"
            aria-label="Refresh Data"
          >
            <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-emerald-400' : ''}`} />
          </button>
        </div>
      </div>

      {/* KPI Stats Overview */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3">
        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
          <span className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">Eligible Users</span>
          <p className="text-xl font-black text-slate-900 dark:text-white">{stats.totalEligible.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400">Total User App accounts</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
          <span className="text-[11px] font-bold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider">Push Subscribers</span>
          <p className="text-xl font-black text-emerald-600 dark:text-emerald-400">{stats.activeSubscribers.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400">Opted in for push notifications</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
          <span className="text-[11px] font-bold text-amber-500 uppercase tracking-wider">Unsubscribed</span>
          <p className="text-xl font-black text-amber-500">{stats.unsubscribedUsers.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400">Muted or opted out</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
          <span className="text-[11px] font-bold text-purple-500 uppercase tracking-wider">Total Campaigns</span>
          <p className="text-xl font-black text-purple-500">{stats.totalCampaigns.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400">Promotions created</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
          <span className="text-[11px] font-bold text-blue-500 uppercase tracking-wider">Delivered</span>
          <p className="text-xl font-black text-blue-500">{stats.deliveredCount.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400">Provider-reported success</p>
        </div>

        <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-1">
          <span className="text-[11px] font-bold text-rose-500 uppercase tracking-wider">Failed / Expired</span>
          <p className="text-xl font-black text-rose-500">{stats.failedCount.toLocaleString()}</p>
          <p className="text-[10px] text-slate-400">Expired tokens &amp; dropped</p>
        </div>
      </div>

      {activeTab === 'create' ? (
        /* CREATE PROMOTIONAL CAMPAIGN */
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
          {/* Left Form: 7 cols */}
          <div className="lg:col-span-7 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Send className="w-4 h-4 text-emerald-600" />
                <span>Compose Promotional Push Notification</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                Targeted push notifications will be delivered directly to User App notification trays and in-app feeds.
              </p>
            </div>

            {/* Quick Presets */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Quick Category Presets
              </label>
              <div className="flex flex-wrap gap-2">
                {PRESETS.map((p, idx) => (
                  <button
                    key={idx}
                    type="button"
                    onClick={() => handleApplyPreset(p)}
                    className="px-2.5 py-1 rounded-xl text-[11px] font-semibold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors border border-slate-200 dark:border-slate-700/60 cursor-pointer"
                  >
                    {p.title}
                  </button>
                ))}
              </div>
            </div>

            {/* Predefined Categories */}
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Notification Category
              </label>
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                {PREDEFINED_CATEGORIES.map((cat) => {
                  const Icon = cat.icon;
                  const isSelected = category === cat.id;
                  return (
                    <button
                      key={cat.id}
                      type="button"
                      onClick={() => setCategory(cat.id)}
                      className={`p-2.5 rounded-2xl border text-left flex items-center gap-2 transition-all cursor-pointer ${
                        isSelected
                          ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold shadow-xs'
                          : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-700 dark:text-slate-300'
                      }`}
                    >
                      <Icon className={`w-4 h-4 ${isSelected ? 'text-emerald-600' : 'text-slate-400'}`} />
                      <span className="text-xs truncate">{cat.label}</span>
                    </button>
                  );
                })}
              </div>
              {category === 'Custom' && (
                <input
                  type="text"
                  placeholder="Enter custom category name (e.g. Flash Sale, Season Pass)"
                  value={customCategory}
                  onChange={(e) => setCustomCategory(e.target.value)}
                  className="w-full mt-2 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
                />
              )}
            </div>

            {/* Title & Body */}
            <div className="space-y-3">
              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Notification Title <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">{title.length}/65 characters</span>
                </div>
                <input
                  type="text"
                  placeholder="e.g. 50% Off on Weekend Udhar Settlements"
                  maxLength={65}
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <div className="flex justify-between items-center mb-1">
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                    Message Body <span className="text-rose-500">*</span>
                  </label>
                  <span className="text-[10px] text-slate-400">{message.length}/180 characters</span>
                </div>
                <textarea
                  rows={3}
                  placeholder="e.g. Settle your pending Udhar with UPI QR and receive instant ledger confirmation."
                  maxLength={180}
                  value={message}
                  onChange={(e) => setMessage(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Promotional Banner Image URL (Optional)
                </label>
                <div className="flex items-center gap-2">
                  <input
                    type="url"
                    placeholder="https://example.com/promo-banner.jpg (displayed on Android & Chrome push)"
                    value={imageUrl}
                    onChange={(e) => setImageUrl(e.target.value)}
                    className="flex-1 px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
                  />
                  {imageUrl && (
                    <button
                      type="button"
                      onClick={() => setImageUrl('')}
                      className="p-2.5 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 hover:text-rose-500"
                      title="Clear image"
                      aria-label="Clear image"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  )}
                </div>
              </div>
            </div>

            {/* Target Audience */}
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Target Audience Selection
              </label>
              <div className="grid grid-cols-2 gap-2">
                {[
                  { id: 'all', title: 'All Registered Users', desc: `${stats.totalEligible} users total` },
                  { id: 'opted_in', title: 'Push Subscribers Only', desc: `${stats.activeSubscribers} opted-in devices` },
                  { id: 'active', title: 'Active Accounts', desc: 'Accounts with recent activity' },
                  { id: 'specific', title: 'Specific User', desc: 'Target one user by ID' },
                ].map((aud) => (
                  <button
                    key={aud.id}
                    type="button"
                    onClick={() => setTargetAudience(aud.id as any)}
                    className={`p-3 rounded-2xl border text-left transition-all cursor-pointer ${
                      targetAudience === aud.id
                        ? 'border-emerald-500 bg-emerald-50/70 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-300 font-bold'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/40 dark:bg-slate-800/30 text-slate-700 dark:text-slate-300'
                    }`}
                  >
                    <p className="text-xs">{aud.title}</p>
                    <p className="text-[10px] text-slate-400 mt-0.5">{aud.desc}</p>
                  </button>
                ))}
              </div>

              {targetAudience === 'specific' && (
                <div className="mt-2">
                  <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                    Select Target User
                  </label>
                  <select
                    value={specificUserId}
                    onChange={(e) => setSpecificUserId(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
                  >
                    <option value="">-- Choose User Account --</option>
                    {usersList.map((u) => (
                      <option key={u.id} value={u.id}>
                        {u.full_name || 'No Name'} ({u.email || u.id})
                      </option>
                    ))}
                  </select>
                </div>
              )}
            </div>

            {/* Tap Action / Destination Link */}
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Destination Link (Opened on Tap)
              </label>
              <div className="grid grid-cols-3 gap-2">
                {[
                  { id: 'dashboard', label: 'Dashboard (/)' },
                  { id: 'budget', label: 'Budget (/budget)' },
                  { id: 'people', label: 'Udhar Ledger (/people)' },
                  { id: 'reports', label: 'Reports (/reports)' },
                  { id: 'safe-to-spend', label: 'Safe Spend (/safe-to-spend)' },
                  { id: 'custom', label: 'Custom Route...' },
                ].map((dest) => (
                  <button
                    key={dest.id}
                    type="button"
                    onClick={() => setDeepLink(dest.id)}
                    className={`p-2 rounded-xl border text-xs font-semibold text-center transition-all cursor-pointer ${
                      deepLink === dest.id
                        ? 'border-emerald-500 bg-emerald-50 dark:bg-emerald-950/40 text-emerald-700 dark:text-emerald-300 font-bold'
                        : 'border-slate-200 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40 text-slate-600 dark:text-slate-400'
                    }`}
                  >
                    {dest.label}
                  </button>
                ))}
              </div>
              {deepLink === 'custom' && (
                <input
                  type="text"
                  placeholder="e.g. /offers or /profile"
                  value={customLink}
                  onChange={(e) => setCustomLink(e.target.value)}
                  className="w-full mt-2 px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
                />
              )}
            </div>

            {/* Scheduling Options */}
            <div className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center justify-between">
                <div>
                  <label className="text-xs font-bold text-slate-700 dark:text-slate-300 block">
                    Schedule for Later Time
                  </label>
                  <p className="text-[11px] text-slate-400">Dispatch at a designated date and hour</p>
                </div>
                <input
                  type="checkbox"
                  checked={isScheduled}
                  onChange={(e) => setIsScheduled(e.target.checked)}
                  className="w-4 h-4 accent-emerald-600 rounded cursor-pointer"
                />
              </div>

              {isScheduled && (
                <div className="grid grid-cols-2 gap-3 p-3 bg-slate-50 dark:bg-slate-800/50 rounded-2xl border border-slate-200 dark:border-slate-700/60 mt-2">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Date
                    </label>
                    <input
                      type="date"
                      value={scheduledDate}
                      onChange={(e) => setScheduledDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold"
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-600 dark:text-slate-400 mb-1">
                      Time (IST)
                    </label>
                    <input
                      type="time"
                      value={scheduledTime}
                      onChange={(e) => setScheduledTime(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-semibold"
                    />
                  </div>
                </div>
              )}
            </div>

            {/* Action Buttons */}
            <div className="flex flex-wrap items-center justify-between gap-3 pt-4 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => handleCreateCampaign(true)}
                disabled={isSubmitting || !title.trim() || !message.trim()}
                className="px-4 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold transition-all disabled:opacity-50 cursor-pointer"
              >
                Save as Draft
              </button>

              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={() => setShowConfirmModal(true)}
                  disabled={isSubmitting || !title.trim() || !message.trim()}
                  className="flex items-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-500 active:scale-95 text-white text-xs font-bold transition-all shadow-md shadow-emerald-600/30 disabled:opacity-50 cursor-pointer"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isScheduled ? 'Confirm & Schedule' : 'Send Promotional Push Now'}</span>
                </button>
              </div>
            </div>
          </div>

          {/* Right Column: 5 cols (Realistic Phone Notification Preview) */}
          <div className="lg:col-span-5 space-y-4 sticky top-6">
            <div className="bg-slate-900 border border-slate-800 rounded-3xl p-5 shadow-2xl text-white space-y-4">
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-extrabold uppercase tracking-wider text-emerald-400 flex items-center gap-1.5">
                  <Smartphone className="w-4 h-4" />
                  <span>User App Notification Preview</span>
                </h4>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 border border-slate-700">
                  Android &amp; Chrome
                </span>
              </div>

              {/* Mobile Phone Mockup Screen */}
              <div className="bg-slate-950 rounded-2xl border-2 border-slate-800 overflow-hidden shadow-inner p-3 space-y-3">
                {/* Phone Top Bar */}
                <div className="flex items-center justify-between text-[10px] text-slate-400 px-1">
                  <span>9:41 AM</span>
                  <div className="flex items-center gap-1">
                    <span>5G</span>
                    <span className="w-4 h-2 rounded-xs border border-slate-400 relative">
                      <span className="absolute inset-0.5 bg-emerald-400 rounded-2xs" />
                    </span>
                  </div>
                </div>

                {/* Lock Screen / Notification Banner Card */}
                <div className="bg-slate-900/90 backdrop-blur-md rounded-2xl border border-slate-800/80 p-3.5 shadow-lg space-y-2">
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <img
                        src={userBrand.pwaIconUrl || userBrand.logoUrl || '/icon-192.png'}
                        alt={userBrand.appName}
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).src = '/icon-192.png';
                        }}
                        className="w-5 h-5 rounded-md object-cover shadow border border-emerald-500/40"
                      />
                      <span className="text-[11px] font-bold text-slate-200">
                        {userBrand.appName}
                      </span>
                      <span className="text-[9px] px-1.5 py-0.2 rounded bg-emerald-950 text-emerald-400 border border-emerald-800 font-semibold">
                        {category}
                      </span>
                    </div>
                    <span className="text-[10px] text-slate-500">now</span>
                  </div>

                  <div className="space-y-0.5">
                    <h5 className="text-xs font-black text-white leading-snug">
                      {title || 'Special Promotion Title'}
                    </h5>
                    <p className="text-[11px] text-slate-300 leading-relaxed">
                      {message || 'Your promotional campaign body text will appear right here on user notification trays.'}
                    </p>
                  </div>

                  {imageUrl && (
                    <div className="aspect-video w-full rounded-xl overflow-hidden bg-slate-950 border border-slate-800">
                      <img
                        src={imageUrl}
                        alt="Promo Banner"
                        className="w-full h-full object-cover"
                        onError={(e) => {
                          (e.currentTarget as HTMLImageElement).style.display = 'none';
                        }}
                      />
                    </div>
                  )}

                  <div className="pt-1 flex items-center justify-between text-[10px] text-emerald-400 font-semibold border-t border-slate-800/60">
                    <span>Tap opens: {effectiveDestination}</span>
                    <ExternalLink className="w-3 h-3" />
                  </div>
                </div>

                <div className="text-center text-[10px] text-slate-500 pt-1">
                  Targeting ~{targetRecipientCount.toLocaleString()} User App devices
                </div>
              </div>

              {/* Guardrails Note */}
              <div className="p-3 bg-emerald-950/30 border border-emerald-500/20 rounded-2xl text-[11px] text-emerald-300 leading-relaxed space-y-1">
                <p className="font-bold flex items-center gap-1.5">
                  <Check className="w-3.5 h-3.5 text-emerald-400" />
                  <span>Strict Audience Isolation</span>
                </p>
                <p className="text-slate-400">
                  This campaign dispatches solely through the User App Web Push service worker and user notification feeds. Admin &amp; Staff portals will never receive promotional broadcasts.
                </p>
              </div>
            </div>
          </div>
        </div>
      ) : (
        /* CAMPAIGNS DASHBOARD & HISTORY */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-5">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <h3 className="text-base font-bold text-slate-900 dark:text-white flex items-center gap-2">
                <Layers className="w-4 h-4 text-emerald-600" />
                <span>Promotional Push Notification Campaigns</span>
              </h3>
              <p className="text-xs text-slate-500 mt-0.5">
                History of promotional alerts, delivery status, and audience reach.
              </p>
            </div>

            <div className="flex items-center gap-2">
              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-3 text-slate-400" />
                <input
                  type="text"
                  placeholder="Search campaigns..."
                  value={searchFilter}
                  onChange={(e) => setSearchFilter(e.target.value)}
                  className="pl-8 pr-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
                />
              </div>

              <select
                aria-label="Filter campaigns by status"
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value as any)}
                className="px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-semibold"
              >
                <option value="all">All Statuses</option>
                <option value="sent">Delivered</option>
                <option value="scheduled">Scheduled</option>
                <option value="cancelled">Cancelled</option>
              </select>
            </div>
          </div>

          {filteredCampaigns.length === 0 ? (
            <div className="text-center py-16 p-6 border-2 border-dashed border-slate-200 dark:border-slate-800 rounded-3xl space-y-3">
              <div className="w-12 h-12 rounded-2xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-500/20 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                <Megaphone className="w-6 h-6" />
              </div>
              <h4 className="text-sm font-bold text-slate-800 dark:text-slate-200">
                No Promotional Campaigns Yet
              </h4>
              <p className="text-xs text-slate-500 max-w-sm mx-auto">
                Reach your active users with special offers, discounts, feature announcements, and financial updates.
              </p>
              <button
                type="button"
                onClick={() => setActiveTab('create')}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-bold transition-all shadow-md active:scale-95 cursor-pointer inline-flex items-center gap-1.5"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Create First Campaign</span>
              </button>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse">
                <thead>
                  <tr className="border-b border-slate-200 dark:border-slate-800 text-[11px] font-bold text-slate-500 uppercase tracking-wider">
                    <th className="py-3 px-3">Campaign / Content</th>
                    <th className="py-3 px-3">Category</th>
                    <th className="py-3 px-3">Target Audience</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3 text-right">Delivered / Failed</th>
                    <th className="py-3 px-3 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800/60 text-xs">
                  {filteredCampaigns.map((camp) => {
                    const isSch = camp.status === 'scheduled';
                    const isSent = camp.status === 'sent';
                    const isCancelled = camp.status === 'cancelled';

                    return (
                      <tr key={camp.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/30 transition-colors">
                        <td className="py-3.5 px-3 max-w-xs">
                          <p className="font-bold text-slate-900 dark:text-slate-100 truncate">
                            {camp.title}
                          </p>
                          <p className="text-[11px] text-slate-500 truncate mt-0.5">
                            {camp.message}
                          </p>
                          {camp.deep_link && (
                            <span className="text-[10px] text-emerald-600 dark:text-emerald-400 font-mono mt-0.5 block">
                              Tap: {camp.deep_link}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3">
                          <span className="inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                            <Tag className="w-3 h-3 text-emerald-500" />
                            <span>{camp.category || 'Promotion'}</span>
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          <span className="text-slate-700 dark:text-slate-300 font-medium">
                            {camp.target_type === 'specific'
                              ? 'Specific User'
                              : camp.target_type === 'push_subscribed'
                              ? 'Push Subscribers'
                              : 'All User App Users'}
                          </span>
                          <span className="text-[10px] text-slate-400 block">
                            {new Date(camp.created_at || Date.now()).toLocaleDateString('en-IN', {
                              day: 'numeric',
                              month: 'short',
                              year: 'numeric',
                            })}
                          </span>
                        </td>
                        <td className="py-3.5 px-3">
                          <span
                            className={`inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold ${
                              isSent
                                ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                                : isSch
                                ? 'bg-blue-100 dark:bg-blue-950 text-blue-700 dark:text-blue-300'
                                : isCancelled
                                ? 'bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300'
                                : 'bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300'
                            }`}
                          >
                            {isSent ? <CheckCircle2 className="w-3 h-3" /> : isSch ? <Clock className="w-3 h-3" /> : null}
                            <span className="capitalize">{camp.status || 'Sent'}</span>
                          </span>
                          {isSch && camp.scheduled_for && (
                            <span className="text-[10px] text-slate-400 block mt-0.5 font-mono">
                              {new Date(camp.scheduled_for).toLocaleTimeString('en-IN', {
                                hour: '2-digit',
                                minute: '2-digit',
                              })}
                            </span>
                          )}
                        </td>
                        <td className="py-3.5 px-3 text-right">
                          <div className="font-semibold text-slate-800 dark:text-slate-200">
                            <span className="text-emerald-600 font-bold">{camp.delivered_count || 0}</span>
                            <span className="text-slate-400 mx-1">/</span>
                            <span className="text-rose-500">{camp.failed_count || 0}</span>
                          </div>
                          <span className="text-[10px] text-slate-400">Total: {camp.total_targets || stats.totalEligible}</span>
                        </td>
                        <td className="py-3.5 px-3 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isSch && (
                              <button
                                type="button"
                                onClick={() => handleCancelScheduled(camp.id)}
                                className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/40 text-rose-600 dark:text-rose-400 hover:bg-rose-100 text-[11px] font-bold transition-colors cursor-pointer"
                              >
                                Cancel
                              </button>
                            )}
                            {isSent && Number(camp.failed_count) > 0 && (
                              <button
                                type="button"
                                onClick={() => handleRetryFailed(camp.id)}
                                className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 text-slate-700 dark:text-slate-300 text-[11px] font-semibold transition-colors cursor-pointer inline-flex items-center gap-1"
                              >
                                <RotateCw className="w-3 h-3" />
                                <span>Retry</span>
                              </button>
                            )}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      )}

      {/* Confirmation Modal before Dispatching */}
      {showConfirmModal && (
        <ConfirmModal
          isOpen={showConfirmModal}
          title="Confirm Promotional Push Notification"
          message={`Are you sure you want to dispatch "${title}" to ~${targetRecipientCount.toLocaleString()} User App accounts? This will trigger real-time push notifications across connected Android, desktop and mobile browsers.`}
          confirmLabel={isScheduled ? 'Confirm & Schedule' : 'Yes, Dispatch Push Now'}
          isDestructive={false}
          onConfirm={() => handleCreateCampaign(false)}
          onCancel={() => setShowConfirmModal(false)}
        />
      )}
    </div>
  );
};
