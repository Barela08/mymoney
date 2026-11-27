import React, { useState, useEffect, useCallback } from 'react';
import {
  Globe,
  Palette,
  Image as ImageIcon,
  LayoutTemplate,
  Navigation,
  PanelBottom,
  LogIn,
  FileText,
  Megaphone,
  Search,
  Phone,
  Share2,
  Scale,
  Wrench,
  Sliders,
  Smartphone,
  Bell,
  Eye,
  Rocket,
  History,
  Save,
  RotateCcw,
  Trash2,
  Plus,
  CheckCircle2,
  AlertTriangle,
  RefreshCw,
  Info,
} from 'lucide-react';
import type {
  SiteControlCenterConfig,
  ConfigVersionEntry,
  AppIdentityBranding,
} from '../../../types';
import {
  DEFAULT_SITE_CONTROL_CENTER_CONFIG,
  normalizeClientSiteConfig,
  sanitizeHexColorClient,
} from '../../../lib/siteConfigDefaults';
import { adminClient } from '../../../lib/adminApi';
import { useExpense } from '../../../context/ExpenseContext';
import { useToast } from '../../../context/ToastContext';
import { BrandingAssetUploader } from '../control-center/BrandingAssetUploader';
import { LivePortalPreview } from '../control-center/LivePortalPreview';
import type { AdminSectionKey } from '../AdminLayout';

type ControlModuleId =
  | 'general'
  | 'branding'
  | 'theme'
  | 'homepage'
  | 'header'
  | 'footer'
  | 'login'
  | 'content_blocks'
  | 'announcements'
  | 'seo'
  | 'contact'
  | 'social'
  | 'legal'
  | 'maintenance'
  | 'features'
  | 'pwa'
  | 'notifications'
  | 'preview'
  | 'publish'
  | 'history';

const CONTROL_MODULES: {
  id: ControlModuleId;
  num: number;
  label: string;
  icon: React.ElementType;
}[] = [
  { id: 'general', num: 1, label: 'General Website', icon: Globe },
  { id: 'branding', num: 2, label: '4 App Identities & Logos', icon: ImageIcon },
  { id: 'theme', num: 3, label: 'Theme & Colors', icon: Palette },
  { id: 'homepage', num: 4, label: 'Homepage Manager', icon: LayoutTemplate },
  { id: 'header', num: 5, label: 'Header Navigation', icon: Navigation },
  { id: 'footer', num: 6, label: 'Footer Manager', icon: PanelBottom },
  { id: 'login', num: 7, label: 'Login & Sign Up', icon: LogIn },
  { id: 'content_blocks', num: 8, label: 'Content Blocks', icon: FileText },
  { id: 'announcements', num: 9, label: 'Announcements & Banners', icon: Megaphone },
  { id: 'seo', num: 10, label: 'SEO, Robots & Sitemap', icon: Search },
  { id: 'contact', num: 11, label: 'Contact Info', icon: Phone },
  { id: 'social', num: 12, label: 'Social Links', icon: Share2 },
  { id: 'legal', num: 13, label: 'Legal Pages', icon: Scale },
  { id: 'maintenance', num: 14, label: 'Maintenance Mode', icon: Wrench },
  { id: 'features', num: 15, label: 'Feature Visibility', icon: Sliders },
  { id: 'pwa', num: 16, label: 'PWA & App Install', icon: Smartphone },
  { id: 'notifications', num: 17, label: 'Notification Config', icon: Bell },
  { id: 'preview', num: 18, label: 'Live Portal Preview', icon: Eye },
  { id: 'publish', num: 19, label: 'Publish & Rollout', icon: Rocket },
  { id: 'history', num: 20, label: 'Change History', icon: History },
];

interface AdminControlCenterTabProps {
  onNavigateSection?: (section: AdminSectionKey) => void;
}

export const AdminControlCenterTab: React.FC<AdminControlCenterTabProps> = ({
  onNavigateSection,
}) => {
  const toast = useToast();
  const { siteConfig: liveSiteConfig, applyLiveSiteConfig } = useExpense();

  const [activeModule, setActiveModule] = useState<ControlModuleId>('branding');
  const [activeBrandScope, setActiveBrandScope] = useState<
    'user_app' | 'admin_app' | 'staff_app' | 'website'
  >('user_app');
  const [publishedConfig, setPublishedConfig] = useState<SiteControlCenterConfig>(
    () => normalizeClientSiteConfig(liveSiteConfig)
  );
  const [draftConfig, setDraftConfig] = useState<SiteControlCenterConfig>(
    () => normalizeClientSiteConfig(liveSiteConfig)
  );
  const [hasSavedDraft, setHasSavedDraft] = useState(false);
  const [isDirty, setIsDirty] = useState(false);
  const [versions, setVersions] = useState<ConfigVersionEntry[]>([]);
  const [publishSummary, setPublishSummary] = useState('');
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingDraft, setIsSavingDraft] = useState(false);
  const [isPublishing, setIsPublishing] = useState(false);
  const [isRestoringId, setIsRestoringId] = useState<string | null>(null);
  const [showSidePreview, setShowSidePreview] = useState(false);

  const loadControlCenter = useCallback(async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getControlCenterState();
      if (res?.success) {
        const pub = normalizeClientSiteConfig(res.published);
        const draft = res.draft ? normalizeClientSiteConfig(res.draft) : pub;
        setPublishedConfig(pub);
        setDraftConfig(draft);
        setHasSavedDraft(Boolean(res.hasDraft));
        setIsDirty(false);
        setVersions(Array.isArray(res.versions) ? res.versions : []);
      }
    } catch (err: any) {
      toast.error('Load Failed', err?.message || 'Unable to load Website Control Center state.');
    } finally {
      setIsLoading(false);
    }
  }, [toast]);

  useEffect(() => {
    loadControlCenter();
  }, [loadControlCenter]);

  const patchDraft = (updater: (prev: SiteControlCenterConfig) => SiteControlCenterConfig) => {
    setDraftConfig((prev) => updater(prev));
    setIsDirty(true);
  };

  const updateIdentity = (
    scope: 'user_app' | 'admin_app' | 'staff_app',
    field: keyof AppIdentityBranding,
    value: string
  ) => {
    patchDraft((prev) => ({
      ...prev,
      branding: {
        ...prev.branding,
        [scope]: {
          ...prev.branding[scope],
          [field]: value,
        },
      },
    }));
  };

  const validateBeforeSave = (cfg: SiteControlCenterConfig): string | null => {
    const blockedNav = cfg.header.navLinks.find((link) => {
      const target = (link.target || '').toLowerCase();
      return target.includes('/myadmin') || target.includes('/mystaff');
    });
    if (blockedNav) {
      return `Header link "${blockedNav.label}" cannot expose private portal route "${blockedNav.target}" publicly.`;
    }
    if (!cfg.branding.user_app.appName.trim() || !cfg.branding.admin_app.appName.trim() || !cfg.branding.staff_app.appName.trim()) {
      return 'App Name cannot be empty for User App, Admin App, or Staff App.';
    }
    return null;
  };

  const handleSaveDraft = async () => {
    const err = validateBeforeSave(draftConfig);
    if (err) {
      toast.error('Validation Blocked', err);
      return;
    }
    setIsSavingDraft(true);
    try {
      const res = await adminClient.saveControlCenterDraft(draftConfig);
      if (res?.success) {
        setHasSavedDraft(true);
        setIsDirty(false);
        if (res.draft) setDraftConfig(normalizeClientSiteConfig(res.draft));
        toast.success('Draft Saved', 'Changes saved to draft. Public portals stay untouched until you Publish.');
      }
    } catch (e: any) {
      toast.error('Draft Save Failed', e?.message || 'Could not save draft.');
    } finally {
      setIsSavingDraft(false);
    }
  };

  const handleDiscardDraft = async () => {
    try {
      const res = await adminClient.discardControlCenterDraft();
      if (res?.success) {
        const cleanPub = normalizeClientSiteConfig(res.published || publishedConfig);
        setPublishedConfig(cleanPub);
        setDraftConfig(cleanPub);
        setHasSavedDraft(false);
        setIsDirty(false);
        toast.info('Draft Discarded', 'Reverted editor back to current live published version.');
      }
    } catch (e: any) {
      toast.error('Discard Failed', e?.message || 'Could not discard draft.');
    }
  };

  const handlePublish = async () => {
    const err = validateBeforeSave(draftConfig);
    if (err) {
      toast.error('Publish Blocked', err);
      return;
    }
    setIsPublishing(true);
    try {
      const summary = publishSummary.trim() || `Published updates from Control Center (${activeModule})`;
      const res = await adminClient.publishControlCenterChanges({
        config: draftConfig,
        summary,
      });
      if (res?.success && res?.published) {
        const nextLive = normalizeClientSiteConfig(res.published);
        setPublishedConfig(nextLive);
        setDraftConfig(nextLive);
        setHasSavedDraft(false);
        setIsDirty(false);
        setPublishSummary('');
        if (Array.isArray(res.versions)) setVersions(res.versions);
        applyLiveSiteConfig(nextLive, true);
        toast.success(
          `Published Globally (v${nextLive.version})`,
          'All connected User, Admin, and Staff browsers received real-time updates without page reload.'
        );
      }
    } catch (e: any) {
      toast.error('Publish Failed', e?.message || 'Could not publish changes.');
    } finally {
      setIsPublishing(false);
    }
  };

  const handleRestoreVersion = async (versionId: string, versionNumber: number) => {
    setIsRestoringId(versionId);
    try {
      const res = await adminClient.restoreControlCenterVersion(versionId);
      if (res?.success && res?.published) {
        const restored = normalizeClientSiteConfig(res.published);
        setPublishedConfig(restored);
        setDraftConfig(restored);
        setHasSavedDraft(false);
        setIsDirty(false);
        if (Array.isArray(res.versions)) setVersions(res.versions);
        applyLiveSiteConfig(restored, true);
        toast.success(
          `Restored Version v${versionNumber}`,
          `Published globally as v${restored.version} with instant real-time sync.`
        );
      }
    } catch (e: any) {
      toast.error('Restore Failed', e?.message || 'Could not restore selected version.');
    } finally {
      setIsRestoringId(null);
    }
  };

  const previewRobotsTxt = () => {
    const disallowList = Array.from(
      new Set(['/myadmin', '/mystaff', '/api', ...(draftConfig.seo.robotsDisallowPaths || [])])
    );
    const lines = ['User-agent: *'];
    if (draftConfig.seo.robotsAllowIndex) {
      lines.push('Allow: /');
    } else {
      lines.push('Disallow: /');
    }
    for (const p of disallowList) {
      lines.push(`Disallow: ${p}`);
    }
    if (draftConfig.seo.sitemapEnabled) {
      const base = (draftConfig.seo.canonicalUrl || 'https://mymoney.nileshbarela.site').replace(/\/+$/, '');
      lines.push(`Sitemap: ${base}/sitemap.xml`);
    }
    return lines.join('\n');
  };

  const previewSitemapUrls = () => {
    const base = (draftConfig.seo.canonicalUrl || 'https://mymoney.nileshbarela.site').replace(/\/+$/, '');
    const basePaths = ['/', '/login', '/register', ...(draftConfig.seo.sitemapExtraPaths || [])]
      .filter((p) => !p.includes('/myadmin') && !p.includes('/mystaff'));
    return Array.from(new Set(basePaths)).map((p) => `${base}${p.startsWith('/') ? p : `/${p}`}`);
  };

  if (isLoading) {
    return (
      <div className="p-10 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 flex items-center justify-center gap-3 text-slate-500 text-xs font-semibold">
        <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
        <span>Loading Website &amp; Multi-App Control Center...</span>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      {/* Sticky Draft / Live / Publish Action Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm flex flex-col xl:flex-row xl:items-center justify-between gap-4">
        <div className="space-y-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 text-[11px] font-extrabold">
              <CheckCircle2 className="w-3.5 h-3.5" />
              Live Published v{publishedConfig.version}
            </span>
            {(isDirty || hasSavedDraft) && (
              <span className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 text-[11px] font-extrabold">
                <AlertTriangle className="w-3.5 h-3.5" />
                {isDirty ? 'Unsaved Edits in Workspace' : 'Unpublished Draft Ready'}
              </span>
            )}
            <span className="text-[11px] text-slate-400 font-mono">
              {publishedConfig.publishedAt
                ? `Last published ${new Date(publishedConfig.publishedAt).toLocaleString('en-IN')}`
                : 'Default baseline'}
            </span>
          </div>
          <p className="text-xs text-slate-500 dark:text-slate-400">
            Edit any of the 20 modules in draft mode, inspect Live Preview across User/Admin/Staff portals, and Publish Globally for real-time SSE rollout.
          </p>
        </div>

        <div className="flex flex-wrap items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={() => setShowSidePreview((v) => !v)}
            className={`inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-xs font-bold cursor-pointer ${
              showSidePreview
                ? 'bg-slate-900 text-white border-slate-900 dark:bg-white dark:text-slate-900'
                : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200'
            }`}
          >
            <Eye className="w-3.5 h-3.5" />
            <span>{showSidePreview ? 'Hide Preview' : 'Toggle Preview'}</span>
          </button>

          {(isDirty || hasSavedDraft) && (
            <button
              type="button"
              onClick={handleDiscardDraft}
              className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Discard Draft</span>
            </button>
          )}

          <button
            type="button"
            onClick={handleSaveDraft}
            disabled={isSavingDraft}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 dark:bg-slate-700 dark:hover:bg-slate-600 text-white text-xs font-bold disabled:opacity-60 cursor-pointer"
          >
            <Save className="w-3.5 h-3.5" />
            <span>{isSavingDraft ? 'Saving...' : 'Save Draft'}</span>
          </button>

          <button
            type="button"
            onClick={handlePublish}
            disabled={isPublishing}
            data-testid="control-center-publish-btn"
            className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md shadow-emerald-600/20 disabled:opacity-60 cursor-pointer"
          >
            <Rocket className="w-3.5 h-3.5" />
            <span>{isPublishing ? 'Publishing...' : 'Publish Globally'}</span>
          </button>
        </div>
      </div>

      {/* Main 2-Column Studio Grid */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-5 items-start">
        {/* Module Directory (All 20 Modules) */}
        <aside className="lg:col-span-3 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-3 space-y-1 shadow-sm">
          <p className="px-3 py-1.5 text-[10px] font-black uppercase tracking-wider text-slate-400">
            20 Control Modules
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-1 gap-1 max-h-[68vh] overflow-y-auto pr-0.5">
            {CONTROL_MODULES.map((mod) => {
              const Icon = mod.icon;
              const isActive = activeModule === mod.id;
              return (
                <button
                  key={mod.id}
                  type="button"
                  onClick={() => setActiveModule(mod.id)}
                  data-testid={`control-module-${mod.id}`}
                  className={`flex items-center gap-2.5 px-3 py-2 rounded-xl text-left text-xs font-bold transition-colors cursor-pointer ${
                    isActive
                      ? 'bg-emerald-600 text-white shadow-sm'
                      : 'text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5 shrink-0" />
                  <span className="truncate">
                    {mod.num}. {mod.label}
                  </span>
                </button>
              );
            })}
          </div>
        </aside>

        {/* Active Module Editor */}
        <section className="lg:col-span-9 space-y-5">
          {showSidePreview && activeModule !== 'preview' && (
            <LivePortalPreview config={draftConfig} isDraftDirty={isDirty || hasSavedDraft} />
          )}

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-5">
            {/* 1. General Website Settings */}
            {activeModule === 'general' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    1. General Website Settings
                  </h3>
                  <p className="text-xs text-slate-500">
                    Control site name, default title, header/footer labels, default language, and theme.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold mb-1">Website Name</label>
                    <input
                      type="text"
                      value={draftConfig.branding.website.siteName}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          branding: {
                            ...p.branding,
                            website: { ...p.branding.website, siteName: e.target.value },
                          },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Header Badge Text</label>
                    <input
                      type="text"
                      value={draftConfig.branding.website.headerBadgeText}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          branding: {
                            ...p.branding,
                            website: { ...p.branding.website, headerBadgeText: e.target.value },
                          },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold mb-1">Default Browser Title</label>
                    <input
                      type="text"
                      value={draftConfig.branding.website.siteTitle}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          branding: {
                            ...p.branding,
                            website: { ...p.branding.website, siteTitle: e.target.value },
                          },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold mb-1">Website Description</label>
                    <textarea
                      rows={2}
                      value={draftConfig.branding.website.siteDescription}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          branding: {
                            ...p.branding,
                            website: { ...p.branding.website, siteDescription: e.target.value },
                          },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Default Language</label>
                    <select
                      value={draftConfig.branding.website.defaultLanguage}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          branding: {
                            ...p.branding,
                            website: { ...p.branding.website, defaultLanguage: e.target.value },
                          },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    >
                      <option value="en">English (en)</option>
                      <option value="hi">Hindi (hi)</option>
                      <option value="hinglish">Hinglish (hinglish)</option>
                    </select>
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Default Theme</label>
                    <select
                      value={draftConfig.branding.website.defaultTheme}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          branding: {
                            ...p.branding,
                            website: {
                              ...p.branding.website,
                              defaultTheme: e.target.value as 'light' | 'dark' | 'system',
                            },
                          },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    >
                      <option value="system">System Default</option>
                      <option value="light">Light Mode</option>
                      <option value="dark">Dark Mode</option>
                    </select>
                  </div>
                </div>
              </div>
            )}

            {/* 2. 4 Separate Branding Identities & Logos */}
            {activeModule === 'branding' && (
              <div className="space-y-5">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    2. Branding &amp; Logo (4 Separate Identities)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Independently manage User App (/), Admin App (/myadmin), Staff App (/mystaff), and Website branding. Supports PNG, JPG, WebP, GIF &amp; sanitized XSS-safe SVG uploads.
                  </p>
                </div>

                <div className="flex flex-wrap gap-2 bg-slate-100 dark:bg-slate-800 p-1.5 rounded-2xl">
                  {(
                    [
                      { id: 'user_app', label: '1. User App (/)' },
                      { id: 'admin_app', label: '2. Admin App (/myadmin)' },
                      { id: 'staff_app', label: '3. Staff App (/mystaff)' },
                      { id: 'website', label: '4. Public Website' },
                    ] as const
                  ).map((tab) => (
                    <button
                      key={tab.id}
                      type="button"
                      onClick={() => setActiveBrandScope(tab.id)}
                      data-testid={`brand-scope-${tab.id}`}
                      className={`px-3 py-1.5 rounded-xl text-xs font-bold cursor-pointer transition-colors ${
                        activeBrandScope === tab.id
                          ? 'bg-white dark:bg-slate-900 text-emerald-600 shadow-xs'
                          : 'text-slate-600 dark:text-slate-300'
                      }`}
                    >
                      {tab.label}
                    </button>
                  ))}
                </div>

                {activeBrandScope !== 'website' ? (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold mb-1">App Name</label>
                        <input
                          type="text"
                          value={draftConfig.branding[activeBrandScope].appName}
                          onChange={(e) => updateIdentity(activeBrandScope, 'appName', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">PWA Short Name (Launcher)</label>
                        <input
                          type="text"
                          value={draftConfig.branding[activeBrandScope].shortName}
                          onChange={(e) => updateIdentity(activeBrandScope, 'shortName', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">Tagline / Subtitle</label>
                        <input
                          type="text"
                          value={draftConfig.branding[activeBrandScope].tagline}
                          onChange={(e) => updateIdentity(activeBrandScope, 'tagline', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">Dashboard Heading</label>
                        <input
                          type="text"
                          value={draftConfig.branding[activeBrandScope].dashboardHeading}
                          onChange={(e) =>
                            updateIdentity(activeBrandScope, 'dashboardHeading', e.target.value)
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">Login Screen Title</label>
                        <input
                          type="text"
                          value={draftConfig.branding[activeBrandScope].loginTitle}
                          onChange={(e) => updateIdentity(activeBrandScope, 'loginTitle', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">Splash Headline</label>
                        <input
                          type="text"
                          value={draftConfig.branding[activeBrandScope].splashHeadline}
                          onChange={(e) =>
                            updateIdentity(activeBrandScope, 'splashHeadline', e.target.value)
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold mb-1">Login Screen Subtitle</label>
                        <input
                          type="text"
                          value={draftConfig.branding[activeBrandScope].loginSubtitle}
                          onChange={(e) =>
                            updateIdentity(activeBrandScope, 'loginSubtitle', e.target.value)
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      </div>
                      <div className="sm:col-span-2">
                        <label className="block text-xs font-bold mb-1">Manifest Description</label>
                        <textarea
                          rows={2}
                          value={draftConfig.branding[activeBrandScope].description}
                          onChange={(e) => updateIdentity(activeBrandScope, 'description', e.target.value)}
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      </div>
                    </div>

                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <BrandingAssetUploader
                        label="App Logo"
                        helperText="Shown in navbar, sidebar & login header"
                        scope={activeBrandScope}
                        slot="logo"
                        value={draftConfig.branding[activeBrandScope].logoUrl}
                        defaultValue={DEFAULT_SITE_CONTROL_CENTER_CONFIG.branding[activeBrandScope].logoUrl}
                        onChange={(url) => updateIdentity(activeBrandScope, 'logoUrl', url)}
                      />
                      <BrandingAssetUploader
                        label="Browser Favicon"
                        helperText="Updated live in browser tab icon"
                        scope={activeBrandScope}
                        slot="favicon"
                        value={draftConfig.branding[activeBrandScope].faviconUrl}
                        defaultValue={DEFAULT_SITE_CONTROL_CENTER_CONFIG.branding[activeBrandScope].faviconUrl}
                        onChange={(url) => updateIdentity(activeBrandScope, 'faviconUrl', url)}
                      />
                      <BrandingAssetUploader
                        label="PWA App Icon (192/512)"
                        helperText="Used in dynamic manifest & install dialogs"
                        scope={activeBrandScope}
                        slot="pwa_icon"
                        value={draftConfig.branding[activeBrandScope].pwaIconUrl}
                        defaultValue={DEFAULT_SITE_CONTROL_CENTER_CONFIG.branding[activeBrandScope].pwaIconUrl}
                        onChange={(url) => updateIdentity(activeBrandScope, 'pwaIconUrl', url)}
                      />
                    </div>
                  </div>
                ) : (
                  <div className="space-y-4">
                    <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                      <div>
                        <label className="block text-xs font-bold mb-1">Website Brand Name</label>
                        <input
                          type="text"
                          value={draftConfig.branding.website.siteName}
                          onChange={(e) =>
                            patchDraft((p) => ({
                              ...p,
                              branding: {
                                ...p.branding,
                                website: { ...p.branding.website, siteName: e.target.value },
                              },
                            }))
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      </div>
                      <div>
                        <label className="block text-xs font-bold mb-1">Footer Brand Text</label>
                        <input
                          type="text"
                          value={draftConfig.branding.website.footerBrandText}
                          onChange={(e) =>
                            patchDraft((p) => ({
                              ...p,
                              branding: {
                                ...p.branding,
                                website: { ...p.branding.website, footerBrandText: e.target.value },
                              },
                            }))
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                        />
                      </div>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                      <BrandingAssetUploader
                        label="Website Logo"
                        scope="website"
                        slot="logo"
                        value={draftConfig.branding.website.logoUrl}
                        defaultValue={DEFAULT_SITE_CONTROL_CENTER_CONFIG.branding.website.logoUrl}
                        onChange={(url) =>
                          patchDraft((p) => ({
                            ...p,
                            branding: {
                              ...p.branding,
                              website: { ...p.branding.website, logoUrl: url },
                            },
                          }))
                        }
                      />
                      <BrandingAssetUploader
                        label="Website Favicon"
                        scope="website"
                        slot="favicon"
                        value={draftConfig.branding.website.faviconUrl}
                        defaultValue={DEFAULT_SITE_CONTROL_CENTER_CONFIG.branding.website.faviconUrl}
                        onChange={(url) =>
                          patchDraft((p) => ({
                            ...p,
                            branding: {
                              ...p.branding,
                              website: { ...p.branding.website, faviconUrl: url },
                            },
                          }))
                        }
                      />
                      <BrandingAssetUploader
                        label="Social Share / OG Image"
                        scope="website"
                        slot="og_image"
                        previewAspect="wide"
                        value={draftConfig.branding.website.ogImageUrl}
                        defaultValue={DEFAULT_SITE_CONTROL_CENTER_CONFIG.branding.website.ogImageUrl}
                        onChange={(url) =>
                          patchDraft((p) => ({
                            ...p,
                            branding: {
                              ...p.branding,
                              website: { ...p.branding.website, ogImageUrl: url },
                            },
                          }))
                        }
                      />
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* 3. Theme & Colors */}
            {activeModule === 'theme' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    3. Theme &amp; Colors (CSS Variables + Manifest Theme Color)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Configure primary, secondary, accent, background, and theme colors for User, Admin, Staff apps and Website.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {(['user_app', 'admin_app', 'staff_app'] as const).map((scope) => (
                    <div
                      key={scope}
                      className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 space-y-3"
                    >
                      <p className="text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
                        {scope === 'user_app' ? 'User App' : scope === 'admin_app' ? 'Admin App' : 'Staff App'}
                      </p>
                      {(
                        [
                          ['primaryColor', 'Primary Color'],
                          ['secondaryColor', 'Secondary Color'],
                          ['accentColor', 'Accent Color'],
                          ['backgroundColor', 'Background Color'],
                          ['themeColor', 'PWA Theme Color'],
                        ] as const
                      ).map(([field, label]) => (
                        <div key={field} className="flex items-center justify-between gap-2">
                          <label className="text-[11px] font-semibold text-slate-600 dark:text-slate-300">
                            {label}
                          </label>
                          <div className="flex items-center gap-1.5">
                            <input
                              type="color"
                              value={sanitizeHexColorClient(
                                draftConfig.branding[scope][field],
                                '#10b981'
                              )}
                              onChange={(e) => updateIdentity(scope, field, e.target.value)}
                              className="w-7 h-7 rounded-lg border border-slate-300 cursor-pointer bg-transparent"
                            />
                            <input
                              type="text"
                              value={draftConfig.branding[scope][field]}
                              onChange={(e) => updateIdentity(scope, field, e.target.value)}
                              className="w-20 px-2 py-1 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-[11px] font-mono"
                            />
                          </div>
                        </div>
                      ))}
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 4. Homepage Management */}
            {activeModule === 'homepage' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    4. Homepage Management
                  </h3>
                  <p className="text-xs text-slate-500">
                    Manage the public welcome hero section, CTA labels, hero image, feature highlight cards, and trust badge.
                  </p>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.homepage.showHero}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          homepage: { ...p.homepage, showHero: e.target.checked },
                        }))
                      }
                    />
                    <span>Show Hero Welcome Panel on Auth Landing</span>
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.homepage.showFeatureSection}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          homepage: { ...p.homepage, showFeatureSection: e.target.checked },
                        }))
                      }
                    />
                    <span>Show Feature Highlights Section</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold mb-1">Hero Badge</label>
                    <input
                      type="text"
                      value={draftConfig.homepage.heroBadge}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          homepage: { ...p.homepage, heroBadge: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Hero Heading</label>
                    <input
                      type="text"
                      value={draftConfig.homepage.heroHeading}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          homepage: { ...p.homepage, heroHeading: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold mb-1">Hero Subheading</label>
                    <textarea
                      rows={2}
                      value={draftConfig.homepage.heroSubheading}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          homepage: { ...p.homepage, heroSubheading: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Primary CTA Text</label>
                    <input
                      type="text"
                      value={draftConfig.homepage.primaryCtaText}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          homepage: { ...p.homepage, primaryCtaText: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Secondary CTA Text</label>
                    <input
                      type="text"
                      value={draftConfig.homepage.secondaryCtaText}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          homepage: { ...p.homepage, secondaryCtaText: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                </div>

                <BrandingAssetUploader
                  label="Hero Illustration / Image"
                  scope="website"
                  slot="hero_image"
                  previewAspect="wide"
                  value={draftConfig.homepage.heroImageUrl}
                  defaultValue={DEFAULT_SITE_CONTROL_CENTER_CONFIG.homepage.heroImageUrl}
                  onChange={(url) =>
                    patchDraft((p) => ({
                      ...p,
                      homepage: { ...p.homepage, heroImageUrl: url },
                    }))
                  }
                />

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold">Feature Highlight Cards</label>
                    <button
                      type="button"
                      onClick={() =>
                        patchDraft((p) => ({
                          ...p,
                          homepage: {
                            ...p.homepage,
                            featureCards: [
                              ...p.homepage.featureCards,
                              {
                                id: `feat_${Date.now()}`,
                                title: 'New Capability',
                                description: 'Describe how this benefits users.',
                                visible: true,
                              },
                            ],
                          },
                        }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" />
                      Add Card
                    </button>
                  </div>
                  {draftConfig.homepage.featureCards.map((card, idx) => (
                    <div
                      key={card.id}
                      className="p-3 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800/40 grid grid-cols-1 sm:grid-cols-12 gap-2 items-center"
                    >
                      <input
                        type="text"
                        value={card.title}
                        onChange={(e) =>
                          patchDraft((p) => ({
                            ...p,
                            homepage: {
                              ...p.homepage,
                              featureCards: p.homepage.featureCards.map((c, i) =>
                                i === idx ? { ...c, title: e.target.value } : c
                              ),
                            },
                          }))
                        }
                        className="sm:col-span-4 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                      />
                      <input
                        type="text"
                        value={card.description}
                        onChange={(e) =>
                          patchDraft((p) => ({
                            ...p,
                            homepage: {
                              ...p.homepage,
                              featureCards: p.homepage.featureCards.map((c, i) =>
                                i === idx ? { ...c, description: e.target.value } : c
                              ),
                            },
                          }))
                        }
                        className="sm:col-span-6 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs"
                      />
                      <div className="sm:col-span-2 flex items-center justify-end gap-2">
                        <input
                          type="checkbox"
                          checked={card.visible}
                          onChange={(e) =>
                            patchDraft((p) => ({
                              ...p,
                              homepage: {
                                ...p.homepage,
                                featureCards: p.homepage.featureCards.map((c, i) =>
                                  i === idx ? { ...c, visible: e.target.checked } : c
                                ),
                              },
                            }))
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            patchDraft((p) => ({
                              ...p,
                              homepage: {
                                ...p.homepage,
                                featureCards: p.homepage.featureCards.filter((_, i) => i !== idx),
                              },
                            }))
                          }
                          className="p-1 text-rose-500 hover:bg-rose-50 rounded-lg cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 5. Header Management */}
            {activeModule === 'header' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    5. Header Management
                  </h3>
                  <p className="text-xs text-slate-500">
                    Control header branding visibility, action buttons, and public links. Links to /myadmin or /mystaff are strictly blocked for portal isolation.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(
                    [
                      ['showBrandLogo', 'Show App Logo in Navbar'],
                      ['showBrandName', 'Show Brand Name in Header'],
                      ['showInstallButton', 'Show PWA Install Button'],
                      ['showNotificationBell', 'Show Notification Bell'],
                    ] as const
                  ).map(([field, label]) => (
                    <label
                      key={field}
                      className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={draftConfig.header[field]}
                        onChange={(e) =>
                          patchDraft((p) => ({
                            ...p,
                            header: { ...p.header, [field]: e.target.checked },
                          }))
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-xs font-bold">Public Header Nav Links</label>
                    <button
                      type="button"
                      onClick={() =>
                        patchDraft((p) => ({
                          ...p,
                          header: {
                            ...p.header,
                            navLinks: [
                              ...p.header.navLinks,
                              { id: `nav_${Date.now()}`, label: 'Guide', target: '#guide', visible: true },
                            ],
                          },
                        }))
                      }
                      className="inline-flex items-center gap-1 px-2.5 py-1 rounded-lg bg-emerald-600 text-white text-[11px] font-bold cursor-pointer"
                    >
                      <Plus className="w-3 h-3" /> Add Link
                    </button>
                  </div>
                  {draftConfig.header.navLinks.map((link, idx) => (
                    <div
                      key={link.id}
                      className="grid grid-cols-1 sm:grid-cols-12 gap-2 items-center p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700"
                    >
                      <input
                        type="text"
                        value={link.label}
                        onChange={(e) =>
                          patchDraft((p) => ({
                            ...p,
                            header: {
                              ...p.header,
                              navLinks: p.header.navLinks.map((l, i) =>
                                i === idx ? { ...l, label: e.target.value } : l
                              ),
                            },
                          }))
                        }
                        className="sm:col-span-4 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold"
                      />
                      <input
                        type="text"
                        value={link.target}
                        onChange={(e) =>
                          patchDraft((p) => ({
                            ...p,
                            header: {
                              ...p.header,
                              navLinks: p.header.navLinks.map((l, i) =>
                                i === idx ? { ...l, target: e.target.value } : l
                              ),
                            },
                          }))
                        }
                        className="sm:col-span-6 px-2.5 py-1.5 rounded-lg border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono"
                      />
                      <div className="sm:col-span-2 flex items-center justify-end gap-2">
                        <input
                          type="checkbox"
                          checked={link.visible}
                          onChange={(e) =>
                            patchDraft((p) => ({
                              ...p,
                              header: {
                                ...p.header,
                                navLinks: p.header.navLinks.map((l, i) =>
                                  i === idx ? { ...l, visible: e.target.checked } : l
                                ),
                              },
                            }))
                          }
                        />
                        <button
                          type="button"
                          onClick={() =>
                            patchDraft((p) => ({
                              ...p,
                              header: {
                                ...p.header,
                                navLinks: p.header.navLinks.filter((_, i) => i !== idx),
                              },
                            }))
                          }
                          className="p-1 text-rose-500 cursor-pointer"
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* 6. Footer Management */}
            {activeModule === 'footer' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    6. Footer Management
                  </h3>
                  <p className="text-xs text-slate-500">
                    Customize copyright notice, company title, address, and visibility of legal/social links.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold mb-1">Company Name</label>
                    <input
                      type="text"
                      value={draftConfig.footer.companyName}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          footer: { ...p.footer, companyName: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Business Location / Address</label>
                    <input
                      type="text"
                      value={draftConfig.footer.address}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          footer: { ...p.footer, address: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold mb-1">Copyright Text</label>
                    <input
                      type="text"
                      value={draftConfig.footer.copyrightText}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          footer: { ...p.footer, copyrightText: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.footer.showLegalLinks}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          footer: { ...p.footer, showLegalLinks: e.target.checked },
                        }))
                      }
                    />
                    <span>Show Legal &amp; Privacy Notice Links</span>
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.footer.showSocialLinks}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          footer: { ...p.footer, showSocialLinks: e.target.checked },
                        }))
                      }
                    />
                    <span>Show Social Links in Footer</span>
                  </label>
                </div>
              </div>
            )}

            {/* 7. Login & Registration Settings */}
            {activeModule === 'login' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    7. Login &amp; Registration Page Settings
                  </h3>
                  <p className="text-xs text-slate-500">
                    Enforced dynamically on both UI and backend auth routes (`/api/auth/login`, `/api/auth/register`, Google, Passkey).
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(
                    [
                      ['allowLogin', 'Allow User Email/Password Login'],
                      ['allowRegistration', 'Allow New User Registration'],
                      ['allowGoogleSignIn', 'Allow Google Sign-In'],
                      ['allowPasskeySignIn', 'Allow WebAuthn Passkey Sign-In'],
                      ['showAppDownloadOnLogin', 'Show App Install Card on Login Page'],
                    ] as const
                  ).map(([field, label]) => (
                    <label
                      key={field}
                      className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={draftConfig.loginSettings[field]}
                        onChange={(e) =>
                          patchDraft((p) => ({
                            ...p,
                            loginSettings: { ...p.loginSettings, [field]: e.target.checked },
                          }))
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold mb-1">Login Headline</label>
                    <input
                      type="text"
                      value={draftConfig.loginSettings.loginHeadline}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          loginSettings: { ...p.loginSettings, loginHeadline: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Registration Headline</label>
                    <input
                      type="text"
                      value={draftConfig.loginSettings.registerHeadline}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          loginSettings: { ...p.loginSettings, registerHeadline: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold mb-1">Login Page Notice Banner (Optional)</label>
                    <input
                      type="text"
                      value={draftConfig.loginSettings.loginBannerText}
                      placeholder="e.g. Scheduled upgrade this Sunday 2 AM IST"
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          loginSettings: { ...p.loginSettings, loginBannerText: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 8. Website Content Blocks */}
            {activeModule === 'content_blocks' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    8. Website Content Blocks
                  </h3>
                  <p className="text-xs text-slate-500">
                    Manage About copy, Support notice, and Security Guarantee displayed across public pages.
                  </p>
                </div>
                <div className="space-y-3">
                  <div>
                    <label className="block text-xs font-bold mb-1">About Summary</label>
                    <textarea
                      rows={3}
                      value={draftConfig.contentBlocks.aboutSummary}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          contentBlocks: { ...p.contentBlocks, aboutSummary: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Support Notice</label>
                    <textarea
                      rows={2}
                      value={draftConfig.contentBlocks.supportNotice}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          contentBlocks: { ...p.contentBlocks, supportNotice: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Security Guarantee Strip</label>
                    <textarea
                      rows={2}
                      value={draftConfig.contentBlocks.securityGuarantee}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          contentBlocks: { ...p.contentBlocks, securityGuarantee: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 9. Announcements & Banners */}
            {activeModule === 'announcements' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    9. Announcements &amp; Banners
                  </h3>
                  <p className="text-xs text-slate-500">
                    Push live top-of-page announcements to all connected users instantaneously via SSE without page refresh.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.announcement.enabled}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          announcement: { ...p.announcement, enabled: e.target.checked },
                        }))
                      }
                    />
                    <span>Enable Live Announcement Banner</span>
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.announcement.dismissible}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          announcement: { ...p.announcement, dismissible: e.target.checked },
                        }))
                      }
                    />
                    <span>Allow Users to Dismiss Banner</span>
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold mb-1">Banner Title</label>
                    <input
                      type="text"
                      value={draftConfig.announcement.title}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          announcement: { ...p.announcement, title: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Severity Style</label>
                    <select
                      value={draftConfig.announcement.severity}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          announcement: {
                            ...p.announcement,
                            severity: e.target.value as 'info' | 'success' | 'warning' | 'announcement',
                          },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    >
                      <option value="announcement">Announcement (Emerald)</option>
                      <option value="info">Info (Blue)</option>
                      <option value="success">Success (Teal)</option>
                      <option value="warning">Warning (Amber)</option>
                    </select>
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold mb-1">Message</label>
                    <input
                      type="text"
                      value={draftConfig.announcement.message}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          announcement: { ...p.announcement, message: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">CTA Button Label (Optional)</label>
                    <input
                      type="text"
                      value={draftConfig.announcement.ctaLabel}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          announcement: { ...p.announcement, ctaLabel: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">CTA Target Route / Tab</label>
                    <input
                      type="text"
                      value={draftConfig.announcement.ctaTarget}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          announcement: { ...p.announcement, ctaTarget: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 10. SEO Management */}
            {activeModule === 'seo' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    10. SEO Management (`robots.txt`, `sitemap.xml`, OpenGraph &amp; Meta)
                  </h3>
                  <p className="text-xs text-slate-500">
                    Controls meta tags, social share previews, and dynamic `/robots.txt` + `/sitemap.xml`. Private portals `/myadmin` &amp; `/mystaff` are permanently excluded from indexing and sitemap.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold mb-1">SEO Title</label>
                    <input
                      type="text"
                      value={draftConfig.seo.title}
                      onChange={(e) =>
                        patchDraft((p) => ({ ...p, seo: { ...p.seo, title: e.target.value } }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold mb-1">Meta Description</label>
                    <textarea
                      rows={2}
                      value={draftConfig.seo.metaDescription}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          seo: { ...p.seo, metaDescription: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">OpenGraph Title</label>
                    <input
                      type="text"
                      value={draftConfig.seo.ogTitle}
                      onChange={(e) =>
                        patchDraft((p) => ({ ...p, seo: { ...p.seo, ogTitle: e.target.value } }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Canonical Base URL</label>
                    <input
                      type="url"
                      value={draftConfig.seo.canonicalUrl}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          seo: { ...p.seo, canonicalUrl: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
                    />
                  </div>
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.seo.robotsAllowIndex}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          seo: { ...p.seo, robotsAllowIndex: e.target.checked },
                        }))
                      }
                    />
                    <span>Allow Search Indexing of Public Pages</span>
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.seo.sitemapEnabled}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          seo: { ...p.seo, sitemapEnabled: e.target.checked },
                        }))
                      }
                    />
                    <span>Serve Dynamic `/sitemap.xml`</span>
                  </label>
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <BrandingAssetUploader
                    label="OG Social Share Image"
                    scope="website"
                    slot="og_image"
                    previewAspect="wide"
                    value={draftConfig.seo.ogImageUrl}
                    defaultValue={DEFAULT_SITE_CONTROL_CENTER_CONFIG.seo.ogImageUrl}
                    onChange={(url) =>
                      patchDraft((p) => ({ ...p, seo: { ...p.seo, ogImageUrl: url } }))
                    }
                  />
                  <BrandingAssetUploader
                    label="SEO Tab Favicon"
                    scope="website"
                    slot="favicon"
                    value={draftConfig.seo.faviconUrl}
                    defaultValue={DEFAULT_SITE_CONTROL_CENTER_CONFIG.seo.faviconUrl}
                    onChange={(url) =>
                      patchDraft((p) => ({ ...p, seo: { ...p.seo, faviconUrl: url } }))
                    }
                  />
                </div>

                <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                  <div className="p-3.5 rounded-2xl bg-slate-950 text-slate-200 space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-400">
                      Live `robots.txt` Output Preview
                    </p>
                    <pre className="text-[11px] font-mono whitespace-pre-wrap">{previewRobotsTxt()}</pre>
                  </div>
                  <div className="p-3.5 rounded-2xl bg-slate-950 text-slate-200 space-y-1.5">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-cyan-400">
                      Public Sitemap URLs (Private Portals Excluded)
                    </p>
                    <ul className="text-[11px] font-mono space-y-1">
                      {previewSitemapUrls().map((u) => (
                        <li key={u}>{u}</li>
                      ))}
                    </ul>
                  </div>
                </div>
              </div>
            )}

            {/* 11. Contact Info */}
            {activeModule === 'contact' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    11. Contact Info Management
                  </h3>
                  <p className="text-xs text-slate-500">
                    Synced across Website Footer, Login help strip, and Maintenance contact details.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold mb-1">Support Email</label>
                    <input
                      type="email"
                      value={draftConfig.footer.supportEmail}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          footer: { ...p.footer, supportEmail: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Support Phone</label>
                    <input
                      type="text"
                      value={draftConfig.footer.supportPhone}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          footer: { ...p.footer, supportPhone: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold mb-1">Company / Organization</label>
                    <input
                      type="text"
                      value={draftConfig.footer.companyName}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          footer: { ...p.footer, companyName: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 12. Social Links */}
            {activeModule === 'social' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    12. Social Links
                  </h3>
                  <p className="text-xs text-slate-500">
                    Configure verified public URLs shown in website footer when Social Links are enabled.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  {(['website', 'github', 'twitter', 'linkedin', 'instagram', 'youtube'] as const).map(
                    (key) => (
                      <div key={key}>
                        <label className="block text-xs font-bold capitalize mb-1">{key} URL</label>
                        <input
                          type="url"
                          value={draftConfig.footer.socialLinks[key]}
                          placeholder={`https://${key}.com/...`}
                          onChange={(e) =>
                            patchDraft((p) => ({
                              ...p,
                              footer: {
                                ...p.footer,
                                socialLinks: {
                                  ...p.footer.socialLinks,
                                  [key]: e.target.value,
                                },
                              },
                            }))
                          }
                          className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono"
                        />
                      </div>
                    )
                  )}
                </div>
              </div>
            )}

            {/* 13. Legal Pages */}
            {activeModule === 'legal' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    13. Legal Pages &amp; Policy Controls
                  </h3>
                  <p className="text-xs text-slate-500">
                    Control Legal Center visibility and jump directly to full Policy &amp; DPDP version editor.
                  </p>
                </div>
                <label className="flex items-center gap-2 p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                  <input
                    type="checkbox"
                    checked={draftConfig.featureVisibility.legalCenterEnabled}
                    onChange={(e) =>
                      patchDraft((p) => ({
                        ...p,
                        featureVisibility: {
                          ...p.featureVisibility,
                          legalCenterEnabled: e.target.checked,
                        },
                      }))
                    }
                  />
                  <span>Enable User Legal &amp; Privacy Center</span>
                </label>
                {onNavigateSection && (
                  <button
                    type="button"
                    onClick={() => onNavigateSection('legal')}
                    className="inline-flex items-center gap-2 px-4 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                  >
                    <Scale className="w-4 h-4" />
                    <span>Open Full Legal &amp; Policies Editor</span>
                  </button>
                )}
              </div>
            )}

            {/* 14. Maintenance Mode */}
            {activeModule === 'maintenance' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    14. Maintenance Mode Control
                  </h3>
                  <p className="text-xs text-slate-500">
                    Locks the normal User website (`/`), login, and API writes while keeping `/myadmin` accessible to Admins at all times.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.maintenance.isEnabled}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          maintenance: { ...p.maintenance, isEnabled: e.target.checked },
                        }))
                      }
                    />
                    <span>Enable Maintenance Mode</span>
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.maintenance.allowStaffAccessDuringMaintenance !== false}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          maintenance: {
                            ...p.maintenance,
                            allowStaffAccessDuringMaintenance: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>Allow Staff Access on /mystaff</span>
                  </label>
                  <label className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer">
                    <input
                      type="checkbox"
                      checked={draftConfig.maintenance.emergencyBypassEnabled !== false}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          maintenance: {
                            ...p.maintenance,
                            emergencyBypassEnabled: e.target.checked,
                          },
                        }))
                      }
                    />
                    <span>Admin Emergency Bypass</span>
                  </label>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-bold mb-1">Maintenance Title</label>
                    <input
                      type="text"
                      value={draftConfig.maintenance.title}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          maintenance: { ...p.maintenance, title: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div>
                    <label className="block text-xs font-bold mb-1">Expected Restoration Time</label>
                    <input
                      type="text"
                      value={draftConfig.maintenance.expectedRestoration || ''}
                      placeholder="e.g. Today at 11:30 PM IST"
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          maintenance: {
                            ...p.maintenance,
                            expectedRestoration: e.target.value,
                          },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                  <div className="sm:col-span-2">
                    <label className="block text-xs font-bold mb-1">Public Maintenance Message</label>
                    <textarea
                      rows={3}
                      value={draftConfig.maintenance.message}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          maintenance: { ...p.maintenance, message: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 15. Feature Visibility */}
            {activeModule === 'features' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    15. Feature Visibility Controls
                  </h3>
                  <p className="text-xs text-slate-500">
                    Live-toggle navigation sections without losing any stored Income, Expense, or Udhar records.
                  </p>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(
                    [
                      ['udharEnabled', 'People & Shared Udhar Ledger'],
                      ['upiQrEnabled', 'UPI QR Generator & Payments'],
                      ['aiAssistantEnabled', 'AI Money Assistant'],
                      ['receiptScannerEnabled', 'Receipt OCR Scanner'],
                      ['reportsEnabled', 'Reports & Analytics'],
                      ['supportDeskEnabled', 'Help & Support Center'],
                      ['legalCenterEnabled', 'Legal & DPDP Center'],
                      ['publicWelcomeHeroEnabled', 'Public Landing Welcome Hero'],
                    ] as const
                  ).map(([field, label]) => (
                    <label
                      key={field}
                      className="flex items-center justify-between p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
                    >
                      <span>{label}</span>
                      <input
                        type="checkbox"
                        checked={draftConfig.featureVisibility[field]}
                        onChange={(e) =>
                          patchDraft((p) => ({
                            ...p,
                            featureVisibility: {
                              ...p.featureVisibility,
                              [field]: e.target.checked,
                            },
                          }))
                        }
                      />
                    </label>
                  ))}
                </div>
              </div>
            )}

            {/* 16. PWA & Installation Settings */}
            {activeModule === 'pwa' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    16. PWA &amp; Isolated App Installation Settings
                  </h3>
                  <p className="text-xs text-slate-500">
                    Each app serves its own manifest &amp; icon (`/api/pwa/manifest/user`, `/myadmin`, `/mystaff`).
                  </p>
                </div>

                <div className="p-3.5 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800/70 flex items-start gap-2.5 text-xs text-amber-900 dark:text-amber-200">
                  <Info className="w-4 h-4 shrink-0 mt-0.5 text-amber-600" />
                  <div>
                    <p className="font-bold">OS &amp; Browser Home-Screen Icon Caching Notice</p>
                    <p className="text-[11px] opacity-90 mt-0.5 leading-relaxed">
                      Publishing a new icon or app name immediately updates dynamic manifests, browser tabs, install prompts, and un-installed previews. Already-installed Android/iOS/Desktop home-screen shortcuts retain cached OS launcher icons until the browser refreshes the WebAPK or the user reinstalls the shortcut.
                    </p>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  {(
                    [
                      ['userAppInstallEnabled', 'Enable User App Install (/)'],
                      ['adminAppInstallEnabled', 'Enable Admin App Install (/myadmin)'],
                      ['staffAppInstallEnabled', 'Enable Staff App Install (/mystaff)'],
                      ['showDownloadPopup', 'Show Timed Install Popup Banner'],
                      ['offlineFallbackEnabled', 'Enable Offline Shell Fallback'],
                    ] as const
                  ).map(([field, label]) => (
                    <label
                      key={field}
                      className="flex items-center gap-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 text-xs font-bold cursor-pointer"
                    >
                      <input
                        type="checkbox"
                        checked={Boolean(draftConfig.pwa[field])}
                        onChange={(e) =>
                          patchDraft((p) => ({
                            ...p,
                            pwa: { ...p.pwa, [field]: e.target.checked },
                          }))
                        }
                      />
                      <span>{label}</span>
                    </label>
                  ))}
                  <div>
                    <label className="block text-xs font-bold mb-1">Auto-Prompt Delay (Seconds)</label>
                    <input
                      type="number"
                      min={0}
                      max={600}
                      value={draftConfig.pwa.autoPromptDelaySeconds}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          pwa: {
                            ...p.pwa,
                            autoPromptDelaySeconds: Math.max(0, Number(e.target.value) || 0),
                          },
                        }))
                      }
                      className="w-full px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 17. Notification Settings */}
            {activeModule === 'notifications' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    17. Separated App Notification Settings
                  </h3>
                  <p className="text-xs text-slate-500">
                    Keep User App, Admin App, and Staff App notifications completely separated with distinct sender names, icons, and categories.
                  </p>
                </div>
                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <label className="block text-xs font-bold">User App Notification Name</label>
                    <input
                      type="text"
                      value={draftConfig.notifications.userAppName}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          notifications: { ...p.notifications, userAppName: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                    <BrandingAssetUploader
                      label="User Notification Icon"
                      scope="user_app"
                      slot="pwa_icon"
                      value={draftConfig.notifications.userIconUrl}
                      defaultValue="/icon-192.png"
                      onChange={(url) =>
                        patchDraft((p) => ({
                          ...p,
                          notifications: { ...p.notifications, userIconUrl: url },
                        }))
                      }
                    />
                  </div>

                  <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <label className="block text-xs font-bold">Admin App Notification Name</label>
                    <input
                      type="text"
                      value={draftConfig.notifications.adminAppName}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          notifications: { ...p.notifications, adminAppName: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                    <BrandingAssetUploader
                      label="Admin Notification Icon"
                      scope="admin_app"
                      slot="pwa_icon"
                      value={draftConfig.notifications.adminIconUrl}
                      defaultValue="/admin-notification-icon.png"
                      onChange={(url) =>
                        patchDraft((p) => ({
                          ...p,
                          notifications: { ...p.notifications, adminIconUrl: url },
                        }))
                      }
                    />
                  </div>

                  <div className="p-3.5 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                    <label className="block text-xs font-bold">Staff App Notification Name</label>
                    <input
                      type="text"
                      value={draftConfig.notifications.staffAppName}
                      onChange={(e) =>
                        patchDraft((p) => ({
                          ...p,
                          notifications: { ...p.notifications, staffAppName: e.target.value },
                        }))
                      }
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                    />
                    <BrandingAssetUploader
                      label="Staff Notification Icon"
                      scope="staff_app"
                      slot="pwa_icon"
                      value={draftConfig.notifications.staffIconUrl}
                      defaultValue="/staff-notification-icon.png"
                      onChange={(url) =>
                        patchDraft((p) => ({
                          ...p,
                          notifications: { ...p.notifications, staffIconUrl: url },
                        }))
                      }
                    />
                  </div>
                </div>
              </div>
            )}

            {/* 18. Live Website Preview */}
            {activeModule === 'preview' && (
              <LivePortalPreview config={draftConfig} isDraftDirty={isDirty || hasSavedDraft} />
            )}

            {/* 19. Publish Changes */}
            {activeModule === 'publish' && (
              <div className="space-y-4">
                <div>
                  <h3 className="text-base font-black text-slate-900 dark:text-white">
                    19. Publish &amp; Real-Time Global Sync
                  </h3>
                  <p className="text-xs text-slate-500">
                    Publishing writes an immutable snapshot version and pushes live SSE + BroadcastChannel updates to all connected User, Admin, and Staff browsers without reloading.
                  </p>
                </div>
                <div>
                  <label className="block text-xs font-bold mb-1">
                    Release Note / Change Summary
                  </label>
                  <input
                    type="text"
                    value={publishSummary}
                    onChange={(e) => setPublishSummary(e.target.value)}
                    placeholder="e.g. Updated Staff Portal logo, announcement banner, and SEO metadata"
                    className="w-full px-3 py-2.5 rounded-xl border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs"
                  />
                </div>
                <div className="flex flex-wrap gap-3">
                  <button
                    type="button"
                    onClick={handleSaveDraft}
                    disabled={isSavingDraft}
                    className="px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-bold cursor-pointer"
                  >
                    Save as Draft Only
                  </button>
                  <button
                    type="button"
                    onClick={handlePublish}
                    disabled={isPublishing}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-extrabold shadow-md cursor-pointer"
                  >
                    {isPublishing ? 'Publishing Globally...' : 'Publish Globally Now'}
                  </button>
                </div>
              </div>
            )}

            {/* 20. Change History & Restore */}
            {activeModule === 'history' && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <h3 className="text-base font-black text-slate-900 dark:text-white">
                      20. Change History &amp; Version Rollback
                    </h3>
                    <p className="text-xs text-slate-500">
                      Every publish creates a recoverable checkpoint. Restoring immediately publishes that configuration live.
                    </p>
                  </div>
                  <button
                    type="button"
                    onClick={loadControlCenter}
                    className="p-2 rounded-xl border border-slate-200 dark:border-slate-700 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
                  >
                    <RefreshCw className="w-4 h-4" />
                  </button>
                </div>

                {versions.length === 0 ? (
                  <p className="text-xs text-slate-400 py-6 text-center">
                    No published version history recorded yet. Publish your first snapshot to create history.
                  </p>
                ) : (
                  <div className="space-y-2.5">
                    {versions.map((ver) => (
                      <div
                        key={ver.id}
                        className="p-4 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3"
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="px-2 py-0.5 rounded-md bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 text-[11px] font-extrabold font-mono">
                              v{ver.version}
                            </span>
                            <span className="text-xs font-bold text-slate-900 dark:text-white">
                              {ver.summary || 'Published Configuration'}
                            </span>
                          </div>
                          <p className="text-[11px] text-slate-500">
                            By <strong>{ver.createdBy}</strong> ·{' '}
                            {new Date(ver.publishedAt || ver.createdAt).toLocaleString('en-IN')}
                          </p>
                        </div>

                        <button
                          type="button"
                          disabled={isRestoringId === ver.id || ver.version === publishedConfig.version}
                          onClick={() => handleRestoreVersion(ver.id, ver.version)}
                          className="px-3.5 py-2 rounded-xl border border-slate-200 dark:border-slate-700 bg-white dark:bg-slate-900 hover:bg-emerald-50 dark:hover:bg-emerald-950/40 text-xs font-bold text-slate-700 dark:text-slate-200 disabled:opacity-50 cursor-pointer shrink-0"
                        >
                          {ver.version === publishedConfig.version
                            ? 'Active Live'
                            : isRestoringId === ver.id
                            ? 'Restoring...'
                            : 'Restore Version'}
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </section>
      </div>
    </div>
  );
};

export default AdminControlCenterTab;
