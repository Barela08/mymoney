import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import type http from 'http';
import { query, isDatabaseAvailable } from './db.js';
import { sbRestRequest } from './supabaseRestFallback.js';
import {
  getMaintenanceSettings,
  saveMaintenanceSettings,
  getAppPopupSettings,
  saveAppPopupSettings,
  DEFAULT_MAINTENANCE_CONFIG,
  DEFAULT_APP_POPUP_CONFIG,
} from './adminSettingsStore.js';
import {
  validateBrandingImageInput,
  sanitizeHexColor,
} from '../src/lib/svgSanitizer.js';
import type {
  SiteControlCenterConfig,
  ConfigVersionEntry,
  PublicSiteConfigPayload,
  BrandingIdentityKey,
  StaffTaskItem,
} from '../src/types/index.js';

const PRIMARY_DATA_DIR = path.resolve(process.cwd(), '.data', 'runtime-store');
const TMP_DATA_DIR = path.resolve(os.tmpdir(), 'mymoney-runtime-store');

const CONTROL_CENTER_SETTING_KEY = 'site_control_center_published';
const CONTROL_CENTER_DRAFT_KEY = 'site_control_center_draft';
const CONTROL_CENTER_FILE = 'site-control-center.json';
const BRANDING_ASSETS_FILE = 'branding-assets.json';
const STAFF_TASKS_FILE = 'staff-tasks.json';

interface StoredBrandingAsset {
  id: string;
  scope: 'user_app' | 'admin_app' | 'staff_app' | 'website' | 'general';
  slot: 'logo' | 'favicon' | 'pwa_icon' | 'og_image' | 'hero_image' | 'banner' | 'splash';
  mimeType: string;
  dataContent: string;
  width?: number;
  height?: number;
  byteSize: number;
  sha256: string;
  createdBy: string;
  createdAt: string;
}

interface ControlCenterStorageEnvelope {
  published: SiteControlCenterConfig;
  draft: SiteControlCenterConfig | null;
  versions: ConfigVersionEntry[];
}

const g = globalThis as typeof globalThis & {
  __mmControlCenterCache?: ControlCenterStorageEnvelope;
  __mmBrandingAssetsCache?: Record<string, StoredBrandingAsset>;
  __mmStaffTasksCache?: StaffTaskItem[];
  __mmSseClients?: Set<{ id: string; res: http.ServerResponse; heartbeat: NodeJS.Timeout }>;
};

if (!g.__mmBrandingAssetsCache) g.__mmBrandingAssetsCache = {};
if (!g.__mmSseClients) g.__mmSseClients = new Set();

function resolveWritableDir(): string {
  try {
    if (!fs.existsSync(PRIMARY_DATA_DIR)) {
      fs.mkdirSync(PRIMARY_DATA_DIR, { recursive: true });
    }
    fs.accessSync(PRIMARY_DATA_DIR, fs.constants.W_OK);
    return PRIMARY_DATA_DIR;
  } catch {
    try {
      if (!fs.existsSync(TMP_DATA_DIR)) {
        fs.mkdirSync(TMP_DATA_DIR, { recursive: true });
      }
      return TMP_DATA_DIR;
    } catch {
      return PRIMARY_DATA_DIR;
    }
  }
}

function safeFilePath(baseDir: string, fileName: string): string {
  const cleanName = fileName.replace(/[^a-zA-Z0-9._-]/g, '_');
  const resolved = path.resolve(baseDir, cleanName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('PATH_CONFINEMENT_VIOLATION');
  }
  return resolved;
}

function readJsonStore<T>(fileName: string): T | null {
  for (const dir of [PRIMARY_DATA_DIR, TMP_DATA_DIR]) {
    try {
      const target = safeFilePath(dir, fileName);
      if (fs.existsSync(target)) {
        const raw = fs.readFileSync(target, 'utf8');
        if (raw.trim()) return JSON.parse(raw) as T;
      }
    } catch {
      // Try next dir
    }
  }
  return null;
}

function writeJsonStore<T>(fileName: string, data: T): void {
  try {
    const dir = resolveWritableDir();
    const target = safeFilePath(dir, fileName);
    fs.writeFileSync(target, JSON.stringify(data, null, 2), 'utf8');
  } catch (err: any) {
    console.warn(`[SiteControlCenter] Write notice (${fileName}):`, err?.message);
  }
}

function sanitizeSafeHrefOrRoute(raw: unknown, fallback: string): string {
  const s = String(raw || '').trim();
  if (!s) return fallback;
  if (s.startsWith('/') && !s.startsWith('//')) {
    // Reject dangerous redirect or internal private URL exposure in public nav
    if (/[\r\n\0]/.test(s)) return fallback;
    return s.slice(0, 300);
  }
  if (s.startsWith('#')) {
    return s.slice(0, 120);
  }
  try {
    const parsed = new URL(s);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString().slice(0, 400);
    }
  } catch {
    // invalid
  }
  return fallback;
}

function sanitizePublicNavigationTarget(raw: unknown, fallback: string): string {
  const clean = sanitizeSafeHrefOrRoute(raw, fallback);
  const lower = clean.toLowerCase();
  // Never expose /myadmin, /admin, or /mystaff in public website navigation
  if (
    lower.startsWith('/myadmin') ||
    lower.startsWith('/admin') ||
    lower.startsWith('/mystaff') ||
    lower.includes('#myadmin') ||
    lower.includes('#mystaff')
  ) {
    return fallback;
  }
  return clean;
}

function sanitizeAssetRef(raw: unknown, fallback: string): string {
  const val = String(raw || '').trim();
  if (!val) return fallback;
  if (val.startsWith('/api/branding/assets/')) return val;
  if (val.startsWith('/') && !val.startsWith('//') && /^\/[a-zA-Z0-9._\-\/?=&]+$/.test(val)) {
    return val;
  }
  const checked = validateBrandingImageInput(val);
  if (checked.valid && checked.sanitizedDataUrl) {
    return checked.sanitizedDataUrl;
  }
  return fallback;
}

export function createDefaultSiteControlCenterConfig(): SiteControlCenterConfig {
  const now = new Date().toISOString();
  return {
    version: 1,
    updatedAt: now,
    updatedBy: 'system',
    publishedAt: now,
    branding: {
      user_app: {
        appName: 'My Money Manager',
        shortName: 'My Money',
        tagline: 'A product of HackifyPro',
        description: 'Personal & shared finance ledger, Udhaar tracker, UPI QR & smart financial insights.',
        logoUrl: '/logo.jpg',
        faviconUrl: '/icon-192.png',
        pwaIconUrl: '/icon-192.png',
        primaryColor: '#10b981',
        secondaryColor: '#059669',
        accentColor: '#3b82f6',
        backgroundColor: '#0f172a',
        themeColor: '#10b981',
        loginTitle: 'My Money Manager',
        loginSubtitle: 'Personal Finance, Room Budgets, Udhar Ledger & UPI QR',
        dashboardHeading: 'Financial Overview',
        splashHeadline: 'My Money Manager',
        splashTagline: 'A product of HackifyPro',
      },
      admin_app: {
        appName: 'My Money Manager Admin',
        shortName: 'MM Admin',
        tagline: 'A product of HackifyPro · Admin Security Gateway',
        description: 'Dedicated administration console, Website Control Center, Staff RBAC & real-time alerts.',
        logoUrl: '/admin-logo.png',
        faviconUrl: '/admin-favicon.png',
        pwaIconUrl: '/admin-icon-192.png',
        primaryColor: '#10b981',
        secondaryColor: '#0f172a',
        accentColor: '#14b8a6',
        backgroundColor: '#020617',
        themeColor: '#10b981',
        loginTitle: 'My Money Manager Admin',
        loginSubtitle: 'Dedicated administration portal (/myadmin) for platform & website governance.',
        dashboardHeading: 'Control Center',
        splashHeadline: 'My Money Manager Admin',
        splashTagline: 'A product of HackifyPro · Control Center',
      },
      staff_app: {
        appName: 'My Money Manager Staff',
        shortName: 'MM Staff',
        tagline: 'A product of HackifyPro · Staff Operations Desk',
        description: 'Dedicated staff workspace for assigned tasks, support desk, and authorized operations.',
        logoUrl: '/staff-logo.png',
        faviconUrl: '/staff-favicon.png',
        pwaIconUrl: '/staff-icon-192.png',
        primaryColor: '#6366f1',
        secondaryColor: '#312e81',
        accentColor: '#06b6d4',
        backgroundColor: '#020617',
        themeColor: '#4f46e5',
        loginTitle: 'My Money Manager Staff',
        loginSubtitle: 'Dedicated staff portal (/mystaff) for support & assigned operations.',
        dashboardHeading: 'Staff Operations',
        splashHeadline: 'My Money Manager Staff',
        splashTagline: 'A product of HackifyPro · Staff Desk',
      },
      website: {
        siteName: 'My Money Manager',
        siteTitle: 'My Money Manager by HackifyPro — Personal Finance, Udhaar & UPI Ledger',
        siteDescription: 'Track daily income & expenses, manage shared room/Udhaar ledgers with 2-way sync, scan receipts, and generate UPI QR codes.',
        logoUrl: '/logo.jpg',
        faviconUrl: '/icon-192.png',
        ogImageUrl: '/icon-512.png',
        primaryColor: '#10b981',
        secondaryColor: '#0f172a',
        accentColor: '#3b82f6',
        headerBadgeText: 'A product of HackifyPro',
        footerBrandText: 'My Money Manager by HackifyPro',
        defaultLanguage: 'en',
        defaultTheme: 'system',
      },
    },
    homepage: {
      showHero: true,
      heroBadge: 'Trusted Personal Finance & Shared Udhaar Ledger',
      heroHeading: 'Master Every Rupee, Room Split & Udhaar Seamlessly',
      heroSubheading:
        'Real-time shared People & Udhaar sync, instant QR connections, UPI auto-detection, smart AI insights, and offline-ready PWA experience.',
      heroImageUrl: '/icon-512.png',
      primaryCtaText: 'Sign In to Dashboard',
      secondaryCtaText: 'Create Free Account',
      showAnnouncementStrip: true,
      showFeatureSection: true,
      featureSectionHeading: 'Everything Built for Smart Daily Money Control',
      featureCards: [
        {
          id: 'feat-udhaar',
          title: 'Two-Way Udhaar & People Sync',
          description: 'Search requests, instant QR pairing, real-time balances, and full dispute protection.',
          visible: true,
        },
        {
          id: 'feat-upi',
          title: 'Instant UPI QR & Smart Alerts',
          description: 'Generate personalized UPI payment QRs and stay ahead of bills & budgets.',
          visible: true,
        },
        {
          id: 'feat-reports',
          title: 'AI Insights & Net Worth Reports',
          description: 'Visual category breakdowns, Safe-to-Spend metrics, and exportable statements.',
          visible: true,
        },
      ],
      showSecurityTrustSection: true,
      securityTrustText: 'Bank-grade session protection, granular privacy consents & encrypted server secrets.',
    },
    header: {
      showBrandLogo: true,
      showBrandName: true,
      showInstallButton: true,
      showNotificationBell: true,
      navLinks: [
        { id: 'nav-features', label: 'Features', target: '#features', visible: true },
        { id: 'nav-support', label: 'Help & Support', target: '/#help', visible: true },
        { id: 'nav-legal', label: 'Privacy & Legal', target: '/#privacy-policy', visible: true },
      ],
    },
    footer: {
      copyrightText: '© 2026 My Money Manager by HackifyPro. All rights reserved.',
      supportEmail: 'hackifypro@gmail.com',
      supportPhone: '+91 9669412829',
      companyName: 'HackifyPro Technologies',
      address: 'India',
      showLegalLinks: true,
      showSocialLinks: true,
      socialLinks: {
        github: 'https://github.com/Barela08/mymoney',
        twitter: '',
        linkedin: '',
        instagram: '',
        youtube: '',
        website: 'https://mymoney.nileshbarela.site',
      },
    },
    loginSettings: {
      allowLogin: true,
      allowRegistration: true,
      allowGoogleSignIn: true,
      allowPasskeySignIn: true,
      loginHeadline: 'Welcome Back',
      loginSubheadline: 'Sign in to access your real-time synced finance & Udhaar workspace.',
      registerHeadline: 'Create Your Free Account',
      registerSubheadline: 'Start tracking expenses, room budgets, and 2-way Udhaar ledgers.',
      loginBannerText: '',
      showAppDownloadOnLogin: true,
    },
    announcement: {
      enabled: false,
      title: 'Platform Update',
      message: '',
      severity: 'info',
      ctaLabel: 'Learn More',
      ctaTarget: '/',
      dismissible: true,
    },
    seo: {
      title: 'My Money Manager by HackifyPro — Smart Personal Finance & Udhaar Tracker',
      metaDescription:
        'Manage daily income, expenses, room splits, 2-way Udhaar connections, and UPI QR codes in real time.',
      ogTitle: 'My Money Manager by HackifyPro',
      ogDescription: 'Personal & shared finance ledger with real-time Udhaar sync and smart insights.',
      ogImageUrl: '/icon-512.png',
      faviconUrl: '/icon-192.png',
      canonicalUrl: 'https://mymoney.nileshbarela.site',
      robotsAllowIndex: true,
      robotsDisallowPaths: ['/myadmin', '/mystaff', '/api/'],
      sitemapEnabled: true,
      sitemapExtraPaths: ['/', '/privacy-policy', '/terms-of-service'],
    },
    featureVisibility: {
      udharEnabled: true,
      upiQrEnabled: true,
      aiAssistantEnabled: true,
      receiptScannerEnabled: true,
      reportsEnabled: true,
      supportDeskEnabled: true,
      legalCenterEnabled: true,
      publicWelcomeHeroEnabled: true,
    },
    pwa: {
      userAppInstallEnabled: true,
      adminAppInstallEnabled: true,
      staffAppInstallEnabled: true,
      showDownloadPopup: true,
      autoPromptDelaySeconds: 12,
      offlineFallbackEnabled: true,
    },
    notifications: {
      userAppName: 'My Money Manager',
      userIconUrl: '/icon-192.png',
      adminAppName: 'My Money Manager Admin',
      adminIconUrl: '/admin-icon-192.png',
      staffAppName: 'My Money Manager Staff',
      staffIconUrl: '/staff-icon-192.png',
      categories: {
        user: {
          udhar: true,
          connection_requests: true,
          transactions: true,
          reminders: true,
          security: true,
          announcements: true,
        },
        admin: {
          new_user: true,
          staff_activity: true,
          system_errors: true,
          security_alerts: true,
          support_tickets: true,
          app_installations: true,
        },
        staff: {
          assigned_task: true,
          task_updates: true,
          announcements: true,
          support_queue: true,
          account_alerts: true,
        },
      },
      templates: [
        {
          key: 'user_udhar_request',
          audience: 'user',
          category: 'udhar',
          enabled: true,
          titleTemplate: '{{senderName}} recorded an Udhaar entry',
          bodyTemplate: '{{title}} ({{amount}}) is waiting for your review in People & Udhaar.',
        },
        {
          key: 'user_qr_connected',
          audience: 'user',
          category: 'connection_requests',
          enabled: true,
          titleTemplate: 'New People Connection',
          bodyTemplate: '{{senderName}} added you using your {{methodLabel}}.',
        },
        {
          key: 'admin_new_registration',
          audience: 'admin',
          category: 'new_user',
          enabled: true,
          titleTemplate: 'New User Registered · {{appName}}',
          bodyTemplate: '{{userName}} ({{userEmail}}) created a new account.',
        },
        {
          key: 'staff_task_assigned',
          audience: 'staff',
          category: 'assigned_task',
          enabled: true,
          titleTemplate: 'New Assigned Task: {{taskTitle}}',
          bodyTemplate: 'Priority: {{priority}}. Assigned by {{assignedBy}} in Staff Operations.',
        },
      ],
    },
    maintenance: { ...DEFAULT_MAINTENANCE_CONFIG },
    appPopup: { ...DEFAULT_APP_POPUP_CONFIG },
    contentBlocks: {
      aboutSummary:
        'My Money Manager by HackifyPro helps individuals, roommates, and small groups manage shared expenses and Udhaar transparently.',
      supportNotice: 'Support team operates Mon–Sat 9:00 AM to 7:00 PM IST.',
      securityGuarantee: 'All private credentials stay encrypted server-side and are never exposed to clients.',
    },
  };
}

function normalizeIdentity(
  raw: any,
  def: SiteControlCenterConfig['branding']['user_app']
): SiteControlCenterConfig['branding']['user_app'] {
  return {
    appName: String(raw?.appName || def.appName).trim().slice(0, 80) || def.appName,
    shortName: String(raw?.shortName || def.shortName).trim().slice(0, 24) || def.shortName,
    tagline: String(raw?.tagline || def.tagline).trim().slice(0, 140) || def.tagline,
    description: String(raw?.description || def.description).trim().slice(0, 320) || def.description,
    logoUrl: sanitizeAssetRef(raw?.logoUrl, def.logoUrl),
    faviconUrl: sanitizeAssetRef(raw?.faviconUrl, def.faviconUrl),
    pwaIconUrl: sanitizeAssetRef(raw?.pwaIconUrl, def.pwaIconUrl),
    primaryColor: sanitizeHexColor(raw?.primaryColor, def.primaryColor),
    secondaryColor: sanitizeHexColor(raw?.secondaryColor, def.secondaryColor),
    accentColor: sanitizeHexColor(raw?.accentColor, def.accentColor),
    backgroundColor: sanitizeHexColor(raw?.backgroundColor, def.backgroundColor),
    themeColor: sanitizeHexColor(raw?.themeColor, def.themeColor),
    loginTitle: String(raw?.loginTitle || def.loginTitle).trim().slice(0, 80) || def.loginTitle,
    loginSubtitle: String(raw?.loginSubtitle || def.loginSubtitle).trim().slice(0, 220) || def.loginSubtitle,
    dashboardHeading: String(raw?.dashboardHeading || def.dashboardHeading).trim().slice(0, 80) || def.dashboardHeading,
    splashHeadline: String(raw?.splashHeadline || def.splashHeadline).trim().slice(0, 80) || def.splashHeadline,
    splashTagline: String(raw?.splashTagline || def.splashTagline).trim().slice(0, 120) || def.splashTagline,
  };
}

export function normalizeSiteControlCenterConfig(raw: any): SiteControlCenterConfig {
  const def = createDefaultSiteControlCenterConfig();
  const r = raw && typeof raw === 'object' ? raw : {};

  const navLinksRaw = Array.isArray(r.header?.navLinks) ? r.header.navLinks : def.header.navLinks;
  const navLinks = navLinksRaw.slice(0, 10).map((item: any, idx: number) => ({
    id: String(item?.id || `nav-${idx}`).slice(0, 40),
    label: String(item?.label || 'Link').trim().slice(0, 40) || 'Link',
    target: sanitizePublicNavigationTarget(item?.target, '/'),
    visible: typeof item?.visible === 'boolean' ? item.visible : true,
  }));

  const cardsRaw = Array.isArray(r.homepage?.featureCards)
    ? r.homepage.featureCards
    : def.homepage.featureCards;
  const featureCards = cardsRaw.slice(0, 9).map((c: any, idx: number) => ({
    id: String(c?.id || `feat-${idx}`).slice(0, 40),
    title: String(c?.title || 'Feature').trim().slice(0, 80) || 'Feature',
    description: String(c?.description || '').trim().slice(0, 240),
    visible: typeof c?.visible === 'boolean' ? c.visible : true,
  }));

  const userBrand = normalizeIdentity(r.branding?.user_app, def.branding.user_app);
  const adminBrand = normalizeIdentity(r.branding?.admin_app, def.branding.admin_app);
  const staffBrand = normalizeIdentity(r.branding?.staff_app, def.branding.staff_app);
  const webRaw = r.branding?.website || {};
  const websiteBrand = {
    siteName: String(webRaw.siteName || def.branding.website.siteName).trim().slice(0, 80) || def.branding.website.siteName,
    siteTitle: String(webRaw.siteTitle || def.branding.website.siteTitle).trim().slice(0, 140) || def.branding.website.siteTitle,
    siteDescription:
      String(webRaw.siteDescription || def.branding.website.siteDescription).trim().slice(0, 320) ||
      def.branding.website.siteDescription,
    logoUrl: sanitizeAssetRef(webRaw.logoUrl, def.branding.website.logoUrl),
    faviconUrl: sanitizeAssetRef(webRaw.faviconUrl, def.branding.website.faviconUrl),
    ogImageUrl: sanitizeAssetRef(webRaw.ogImageUrl, def.branding.website.ogImageUrl),
    primaryColor: sanitizeHexColor(webRaw.primaryColor, def.branding.website.primaryColor),
    secondaryColor: sanitizeHexColor(webRaw.secondaryColor, def.branding.website.secondaryColor),
    accentColor: sanitizeHexColor(webRaw.accentColor, def.branding.website.accentColor),
    headerBadgeText: String(webRaw.headerBadgeText ?? def.branding.website.headerBadgeText).trim().slice(0, 80),
    footerBrandText: String(webRaw.footerBrandText || def.branding.website.footerBrandText).trim().slice(0, 100),
    defaultLanguage: String(webRaw.defaultLanguage || def.branding.website.defaultLanguage).trim().slice(0, 12) || 'en',
    defaultTheme: (['light', 'dark', 'system'].includes(webRaw.defaultTheme)
      ? webRaw.defaultTheme
      : def.branding.website.defaultTheme) as 'light' | 'dark' | 'system',
  };

  const templatesRaw = Array.isArray(r.notifications?.templates)
    ? r.notifications.templates
    : def.notifications.templates;

  const normalizeBoolMap = (incoming: any, base: Record<string, boolean>): Record<string, boolean> => {
    const out: Record<string, boolean> = { ...base };
    if (incoming && typeof incoming === 'object') {
      for (const key of Object.keys(base)) {
        if (typeof incoming[key] === 'boolean') out[key] = incoming[key];
      }
    }
    return out;
  };

  return {
    version: Number.isFinite(Number(r.version)) && Number(r.version) >= 1 ? Math.floor(Number(r.version)) : 1,
    updatedAt: typeof r.updatedAt === 'string' && r.updatedAt ? r.updatedAt : def.updatedAt,
    updatedBy: typeof r.updatedBy === 'string' && r.updatedBy ? r.updatedBy : def.updatedBy,
    publishedAt: typeof r.publishedAt === 'string' ? r.publishedAt : def.publishedAt,
    branding: {
      user_app: userBrand,
      admin_app: adminBrand,
      staff_app: staffBrand,
      website: websiteBrand,
    },
    homepage: {
      showHero: typeof r.homepage?.showHero === 'boolean' ? r.homepage.showHero : def.homepage.showHero,
      heroBadge: String(r.homepage?.heroBadge ?? def.homepage.heroBadge).trim().slice(0, 120),
      heroHeading: String(r.homepage?.heroHeading || def.homepage.heroHeading).trim().slice(0, 160),
      heroSubheading: String(r.homepage?.heroSubheading || def.homepage.heroSubheading).trim().slice(0, 420),
      heroImageUrl: sanitizeAssetRef(r.homepage?.heroImageUrl, def.homepage.heroImageUrl),
      primaryCtaText: String(r.homepage?.primaryCtaText || def.homepage.primaryCtaText).trim().slice(0, 60),
      secondaryCtaText: String(r.homepage?.secondaryCtaText || def.homepage.secondaryCtaText).trim().slice(0, 60),
      showAnnouncementStrip:
        typeof r.homepage?.showAnnouncementStrip === 'boolean'
          ? r.homepage.showAnnouncementStrip
          : def.homepage.showAnnouncementStrip,
      showFeatureSection:
        typeof r.homepage?.showFeatureSection === 'boolean'
          ? r.homepage.showFeatureSection
          : def.homepage.showFeatureSection,
      featureSectionHeading: String(
        r.homepage?.featureSectionHeading || def.homepage.featureSectionHeading
      )
        .trim()
        .slice(0, 120),
      featureCards,
      showSecurityTrustSection:
        typeof r.homepage?.showSecurityTrustSection === 'boolean'
          ? r.homepage.showSecurityTrustSection
          : def.homepage.showSecurityTrustSection,
      securityTrustText: String(r.homepage?.securityTrustText || def.homepage.securityTrustText).trim().slice(0, 240),
    },
    header: {
      showBrandLogo: typeof r.header?.showBrandLogo === 'boolean' ? r.header.showBrandLogo : def.header.showBrandLogo,
      showBrandName: typeof r.header?.showBrandName === 'boolean' ? r.header.showBrandName : def.header.showBrandName,
      showInstallButton:
        typeof r.header?.showInstallButton === 'boolean' ? r.header.showInstallButton : def.header.showInstallButton,
      showNotificationBell:
        typeof r.header?.showNotificationBell === 'boolean'
          ? r.header.showNotificationBell
          : def.header.showNotificationBell,
      navLinks,
    },
    footer: {
      copyrightText: String(r.footer?.copyrightText || def.footer.copyrightText).trim().slice(0, 180),
      supportEmail: String(r.footer?.supportEmail || def.footer.supportEmail).trim().slice(0, 120),
      supportPhone: String(r.footer?.supportPhone || def.footer.supportPhone).trim().slice(0, 40),
      companyName: String(r.footer?.companyName || def.footer.companyName).trim().slice(0, 100),
      address: String(r.footer?.address ?? def.footer.address).trim().slice(0, 160),
      showLegalLinks: typeof r.footer?.showLegalLinks === 'boolean' ? r.footer.showLegalLinks : def.footer.showLegalLinks,
      showSocialLinks:
        typeof r.footer?.showSocialLinks === 'boolean' ? r.footer.showSocialLinks : def.footer.showSocialLinks,
      socialLinks: {
        github: sanitizeSafeHrefOrRoute(r.footer?.socialLinks?.github, def.footer.socialLinks.github),
        twitter: r.footer?.socialLinks?.twitter ? sanitizeSafeHrefOrRoute(r.footer.socialLinks.twitter, '') : '',
        linkedin: r.footer?.socialLinks?.linkedin ? sanitizeSafeHrefOrRoute(r.footer.socialLinks.linkedin, '') : '',
        instagram: r.footer?.socialLinks?.instagram ? sanitizeSafeHrefOrRoute(r.footer.socialLinks.instagram, '') : '',
        youtube: r.footer?.socialLinks?.youtube ? sanitizeSafeHrefOrRoute(r.footer.socialLinks.youtube, '') : '',
        website: sanitizeSafeHrefOrRoute(r.footer?.socialLinks?.website, def.footer.socialLinks.website),
      },
    },
    loginSettings: {
      allowLogin: typeof r.loginSettings?.allowLogin === 'boolean' ? r.loginSettings.allowLogin : def.loginSettings.allowLogin,
      allowRegistration:
        typeof r.loginSettings?.allowRegistration === 'boolean'
          ? r.loginSettings.allowRegistration
          : def.loginSettings.allowRegistration,
      allowGoogleSignIn:
        typeof r.loginSettings?.allowGoogleSignIn === 'boolean'
          ? r.loginSettings.allowGoogleSignIn
          : def.loginSettings.allowGoogleSignIn,
      allowPasskeySignIn:
        typeof r.loginSettings?.allowPasskeySignIn === 'boolean'
          ? r.loginSettings.allowPasskeySignIn
          : def.loginSettings.allowPasskeySignIn,
      loginHeadline: String(r.loginSettings?.loginHeadline || def.loginSettings.loginHeadline).trim().slice(0, 100),
      loginSubheadline: String(
        r.loginSettings?.loginSubheadline || def.loginSettings.loginSubheadline
      )
        .trim()
        .slice(0, 220),
      registerHeadline: String(
        r.loginSettings?.registerHeadline || def.loginSettings.registerHeadline
      )
        .trim()
        .slice(0, 100),
      registerSubheadline: String(
        r.loginSettings?.registerSubheadline || def.loginSettings.registerSubheadline
      )
        .trim()
        .slice(0, 220),
      loginBannerText: String(r.loginSettings?.loginBannerText ?? '').trim().slice(0, 240),
      showAppDownloadOnLogin:
        typeof r.loginSettings?.showAppDownloadOnLogin === 'boolean'
          ? r.loginSettings.showAppDownloadOnLogin
          : def.loginSettings.showAppDownloadOnLogin,
    },
    announcement: {
      enabled: typeof r.announcement?.enabled === 'boolean' ? r.announcement.enabled : def.announcement.enabled,
      title: String(r.announcement?.title || def.announcement.title).trim().slice(0, 100),
      message: String(r.announcement?.message ?? def.announcement.message).trim().slice(0, 320),
      severity: (['info', 'success', 'warning', 'announcement'].includes(r.announcement?.severity)
        ? r.announcement.severity
        : 'info') as 'info' | 'success' | 'warning' | 'announcement',
      ctaLabel: String(r.announcement?.ctaLabel || def.announcement.ctaLabel).trim().slice(0, 40),
      ctaTarget: sanitizePublicNavigationTarget(r.announcement?.ctaTarget, '/'),
      dismissible:
        typeof r.announcement?.dismissible === 'boolean' ? r.announcement.dismissible : def.announcement.dismissible,
    },
    seo: {
      title: String(r.seo?.title || def.seo.title).trim().slice(0, 140),
      metaDescription: String(r.seo?.metaDescription || def.seo.metaDescription).trim().slice(0, 320),
      ogTitle: String(r.seo?.ogTitle || def.seo.ogTitle).trim().slice(0, 140),
      ogDescription: String(r.seo?.ogDescription || def.seo.ogDescription).trim().slice(0, 320),
      ogImageUrl: sanitizeAssetRef(r.seo?.ogImageUrl, def.seo.ogImageUrl),
      faviconUrl: sanitizeAssetRef(r.seo?.faviconUrl, def.seo.faviconUrl),
      canonicalUrl: sanitizeSafeHrefOrRoute(r.seo?.canonicalUrl, def.seo.canonicalUrl),
      robotsAllowIndex: typeof r.seo?.robotsAllowIndex === 'boolean' ? r.seo.robotsAllowIndex : def.seo.robotsAllowIndex,
      robotsDisallowPaths: Array.isArray(r.seo?.robotsDisallowPaths)
        ? r.seo.robotsDisallowPaths
            .slice(0, 20)
            .map((p: unknown) => String(p || '').trim())
            .filter((p: string) => p.startsWith('/') && !/[\r\n]/.test(p))
        : def.seo.robotsDisallowPaths,
      sitemapEnabled: typeof r.seo?.sitemapEnabled === 'boolean' ? r.seo.sitemapEnabled : def.seo.sitemapEnabled,
      sitemapExtraPaths: Array.isArray(r.seo?.sitemapExtraPaths)
        ? r.seo.sitemapExtraPaths
            .slice(0, 25)
            .map((p: unknown) => sanitizePublicNavigationTarget(p, '/'))
        : def.seo.sitemapExtraPaths,
    },
    featureVisibility: {
      udharEnabled:
        typeof r.featureVisibility?.udharEnabled === 'boolean'
          ? r.featureVisibility.udharEnabled
          : def.featureVisibility.udharEnabled,
      upiQrEnabled:
        typeof r.featureVisibility?.upiQrEnabled === 'boolean'
          ? r.featureVisibility.upiQrEnabled
          : def.featureVisibility.upiQrEnabled,
      aiAssistantEnabled:
        typeof r.featureVisibility?.aiAssistantEnabled === 'boolean'
          ? r.featureVisibility.aiAssistantEnabled
          : def.featureVisibility.aiAssistantEnabled,
      receiptScannerEnabled:
        typeof r.featureVisibility?.receiptScannerEnabled === 'boolean'
          ? r.featureVisibility.receiptScannerEnabled
          : def.featureVisibility.receiptScannerEnabled,
      reportsEnabled:
        typeof r.featureVisibility?.reportsEnabled === 'boolean'
          ? r.featureVisibility.reportsEnabled
          : def.featureVisibility.reportsEnabled,
      supportDeskEnabled:
        typeof r.featureVisibility?.supportDeskEnabled === 'boolean'
          ? r.featureVisibility.supportDeskEnabled
          : def.featureVisibility.supportDeskEnabled,
      legalCenterEnabled:
        typeof r.featureVisibility?.legalCenterEnabled === 'boolean'
          ? r.featureVisibility.legalCenterEnabled
          : def.featureVisibility.legalCenterEnabled,
      publicWelcomeHeroEnabled:
        typeof r.featureVisibility?.publicWelcomeHeroEnabled === 'boolean'
          ? r.featureVisibility.publicWelcomeHeroEnabled
          : def.featureVisibility.publicWelcomeHeroEnabled,
    },
    pwa: {
      userAppInstallEnabled:
        typeof r.pwa?.userAppInstallEnabled === 'boolean'
          ? r.pwa.userAppInstallEnabled
          : def.pwa.userAppInstallEnabled,
      adminAppInstallEnabled:
        typeof r.pwa?.adminAppInstallEnabled === 'boolean'
          ? r.pwa.adminAppInstallEnabled
          : def.pwa.adminAppInstallEnabled,
      staffAppInstallEnabled:
        typeof r.pwa?.staffAppInstallEnabled === 'boolean'
          ? r.pwa.staffAppInstallEnabled
          : def.pwa.staffAppInstallEnabled,
      showDownloadPopup:
        typeof r.pwa?.showDownloadPopup === 'boolean' ? r.pwa.showDownloadPopup : def.pwa.showDownloadPopup,
      autoPromptDelaySeconds: Math.min(
        120,
        Math.max(3, Number(r.pwa?.autoPromptDelaySeconds) || def.pwa.autoPromptDelaySeconds)
      ),
      offlineFallbackEnabled:
        typeof r.pwa?.offlineFallbackEnabled === 'boolean'
          ? r.pwa.offlineFallbackEnabled
          : def.pwa.offlineFallbackEnabled,
    },
    notifications: {
      userAppName: String(r.notifications?.userAppName || userBrand.appName).trim().slice(0, 80),
      userIconUrl: sanitizeAssetRef(r.notifications?.userIconUrl, userBrand.pwaIconUrl),
      adminAppName: String(r.notifications?.adminAppName || adminBrand.appName).trim().slice(0, 80),
      adminIconUrl: sanitizeAssetRef(r.notifications?.adminIconUrl, adminBrand.pwaIconUrl),
      staffAppName: String(r.notifications?.staffAppName || staffBrand.appName).trim().slice(0, 80),
      staffIconUrl: sanitizeAssetRef(r.notifications?.staffIconUrl, staffBrand.pwaIconUrl),
      categories: {
        user: normalizeBoolMap(r.notifications?.categories?.user, def.notifications.categories.user),
        admin: normalizeBoolMap(r.notifications?.categories?.admin, def.notifications.categories.admin),
        staff: normalizeBoolMap(r.notifications?.categories?.staff, def.notifications.categories.staff),
      },
      templates: templatesRaw.slice(0, 30).map((t: any, idx: number) => ({
        key: String(t?.key || `tpl_${idx}`).trim().slice(0, 64),
        audience: (['user', 'admin', 'staff'].includes(t?.audience) ? t.audience : 'user') as 'user' | 'admin' | 'staff',
        category: String(t?.category || 'general').trim().slice(0, 40),
        enabled: typeof t?.enabled === 'boolean' ? t.enabled : true,
        titleTemplate: String(t?.titleTemplate || '').trim().slice(0, 140),
        bodyTemplate: String(t?.bodyTemplate || '').trim().slice(0, 320),
      })),
    },
    maintenance: {
      isEnabled: typeof r.maintenance?.isEnabled === 'boolean' ? r.maintenance.isEnabled : def.maintenance.isEnabled,
      title: String(r.maintenance?.title || def.maintenance.title).trim().slice(0, 140),
      message: String(r.maintenance?.message || def.maintenance.message).trim().slice(0, 600),
      expectedRestoration: String(
        r.maintenance?.expectedRestoration || def.maintenance.expectedRestoration
      )
        .trim()
        .slice(0, 100),
      allowStaffAccessDuringMaintenance:
        typeof r.maintenance?.allowStaffAccessDuringMaintenance === 'boolean'
          ? r.maintenance.allowStaffAccessDuringMaintenance
          : true,
      emergencyBypassEnabled:
        typeof r.maintenance?.emergencyBypassEnabled === 'boolean'
          ? r.maintenance.emergencyBypassEnabled
          : true,
      updatedAt: typeof r.maintenance?.updatedAt === 'string' ? r.maintenance.updatedAt : undefined,
      updatedBy: typeof r.maintenance?.updatedBy === 'string' ? r.maintenance.updatedBy : undefined,
    },
    appPopup: {
      enabled: typeof r.appPopup?.enabled === 'boolean' ? r.appPopup.enabled : def.appPopup.enabled,
      downloadUrl: sanitizePublicNavigationTarget(r.appPopup?.downloadUrl, def.appPopup.downloadUrl),
      title: String(r.appPopup?.title || def.appPopup.title).trim().slice(0, 80),
      description: String(r.appPopup?.description || def.appPopup.description).trim().slice(0, 220),
      buttonLabel: String(r.appPopup?.buttonLabel || def.appPopup.buttonLabel).trim().slice(0, 32),
      updatedAt: typeof r.appPopup?.updatedAt === 'string' ? r.appPopup.updatedAt : undefined,
      updatedBy: typeof r.appPopup?.updatedBy === 'string' ? r.appPopup.updatedBy : undefined,
    },
    contentBlocks: {
      aboutSummary: String(r.contentBlocks?.aboutSummary || def.contentBlocks.aboutSummary).trim().slice(0, 600),
      supportNotice: String(r.contentBlocks?.supportNotice || def.contentBlocks.supportNotice).trim().slice(0, 300),
      securityGuarantee: String(
        r.contentBlocks?.securityGuarantee || def.contentBlocks.securityGuarantee
      )
        .trim()
        .slice(0, 300),
    },
  };
}

async function loadEnvelope(): Promise<ControlCenterStorageEnvelope> {
  if (g.__mmControlCenterCache) {
    return g.__mmControlCenterCache;
  }

  let local = readJsonStore<ControlCenterStorageEnvelope>(CONTROL_CENTER_FILE);
  let remotePublished: any = null;
  let remoteDraft: any = null;
  let remoteVersions: ConfigVersionEntry[] = [];

  if (isDatabaseAvailable()) {
    try {
      const [settingsRes, verRes] = await Promise.all([
        query(`SELECT key, value FROM public.app_settings WHERE key IN ($1, $2)`, [
          CONTROL_CENTER_SETTING_KEY,
          CONTROL_CENTER_DRAFT_KEY,
        ]),
        query(
          `SELECT id, version, status, summary, created_by, created_at, published_at, config
           FROM public.platform_config_versions
           ORDER BY version DESC
           LIMIT 30`
        ).catch(() => ({ rows: [] })),
      ]);

      for (const row of settingsRes.rows || []) {
        if (row.key === CONTROL_CENTER_SETTING_KEY) remotePublished = row.value;
        if (row.key === CONTROL_CENTER_DRAFT_KEY) remoteDraft = row.value;
      }
      if (Array.isArray(verRes.rows) && verRes.rows.length > 0) {
        remoteVersions = verRes.rows.map((v: any) => ({
          id: String(v.id),
          version: Number(v.version) || 1,
          status: v.status || 'published',
          summary: String(v.summary || 'Configuration update'),
          createdBy: String(v.created_by || 'admin'),
          createdAt: v.created_at ? new Date(v.created_at).toISOString() : new Date().toISOString(),
          publishedAt: v.published_at ? new Date(v.published_at).toISOString() : null,
          config: normalizeSiteControlCenterConfig(v.config),
        }));
      }
    } catch {
      // fall through
    }
  } else {
    const sbRes = await sbRestRequest<Array<{ key: string; value: any }>>(
      `app_settings?key=in.(${CONTROL_CENTER_SETTING_KEY},${CONTROL_CENTER_DRAFT_KEY})&select=key,value`
    ).catch(() => ({ ok: false, data: null as any }));
    if (sbRes.ok && Array.isArray(sbRes.data)) {
      for (const row of sbRes.data) {
        if (row.key === CONTROL_CENTER_SETTING_KEY) remotePublished = row.value;
        if (row.key === CONTROL_CENTER_DRAFT_KEY) remoteDraft = row.value;
      }
    }
  }

  const publishedSource = (() => {
    if (remotePublished && local?.published) {
      const rVer = Number(remotePublished.version || 0);
      const lVer = Number(local.published.version || 0);
      if (rVer > lVer) return remotePublished;
      if (lVer > rVer) return local.published;
      return Date.parse(remotePublished.updatedAt || '') >= Date.parse(local.published.updatedAt || '')
        ? remotePublished
        : local.published;
    }
    return remotePublished || local?.published || createDefaultSiteControlCenterConfig();
  })();

  const [maint, popup] = await Promise.all([
    getMaintenanceSettings().catch(() => DEFAULT_MAINTENANCE_CONFIG),
    getAppPopupSettings().catch(() => DEFAULT_APP_POPUP_CONFIG),
  ]);

  const published = normalizeSiteControlCenterConfig({
    ...publishedSource,
    maintenance: { ...publishedSource?.maintenance, ...maint },
    appPopup: { ...publishedSource?.appPopup, ...popup },
  });

  const draft = remoteDraft
    ? normalizeSiteControlCenterConfig(remoteDraft)
    : local?.draft
    ? normalizeSiteControlCenterConfig(local.draft)
    : null;

  const versions =
    remoteVersions.length > 0
      ? remoteVersions
      : Array.isArray(local?.versions) && local.versions.length > 0
      ? local.versions.map((v) => ({ ...v, config: normalizeSiteControlCenterConfig(v.config) }))
      : [
          {
            id: `ver-${published.version}`,
            version: published.version,
            status: 'published' as const,
            summary: 'Initial baseline configuration',
            createdBy: published.updatedBy || 'system',
            createdAt: published.updatedAt,
            publishedAt: published.publishedAt,
            config: published,
          },
        ];

  const envelope: ControlCenterStorageEnvelope = { published, draft, versions };
  g.__mmControlCenterCache = envelope;
  writeJsonStore(CONTROL_CENTER_FILE, envelope);
  return envelope;
}

async function persistEnvelope(envelope: ControlCenterStorageEnvelope, actor?: { id?: string; email?: string }): Promise<void> {
  g.__mmControlCenterCache = envelope;
  writeJsonStore(CONTROL_CENTER_FILE, envelope);

  if (isDatabaseAvailable()) {
    try {
      await query(
        `INSERT INTO public.app_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2::jsonb, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [CONTROL_CENTER_SETTING_KEY, JSON.stringify(envelope.published), actor?.id || null]
      );
      if (envelope.draft) {
        await query(
          `INSERT INTO public.app_settings (key, value, updated_at, updated_by)
           VALUES ($1, $2::jsonb, NOW(), $3)
           ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
          [CONTROL_CENTER_DRAFT_KEY, JSON.stringify(envelope.draft), actor?.id || null]
        );
      } else {
        await query(`DELETE FROM public.app_settings WHERE key = $1`, [CONTROL_CENTER_DRAFT_KEY]).catch(() => {});
      }
      // Also mirror legacy app_branding key for full backwards compatibility
      const legacyBrand = {
        appName: envelope.published.branding.user_app.appName,
        subTitle: envelope.published.branding.user_app.tagline,
        logoUrl: envelope.published.branding.user_app.logoUrl,
        brandTitle: envelope.published.branding.user_app.appName,
        companyName: envelope.published.footer.companyName,
        footerText: envelope.published.footer.copyrightText,
        supportEmail: envelope.published.footer.supportEmail,
        supportPhone: envelope.published.footer.supportPhone,
        allowRegistration: envelope.published.loginSettings.allowRegistration,
        allowLogin: envelope.published.loginSettings.allowLogin,
      };
      await query(
        `INSERT INTO public.app_settings (key, value, updated_at, updated_by)
         VALUES ('app_branding', $1::jsonb, NOW(), $2)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        [JSON.stringify(legacyBrand), actor?.id || null]
      ).catch(() => {});
    } catch (err: any) {
      console.warn('[SiteControlCenter] DB persist notice:', err?.message);
    }
  } else {
    await Promise.allSettled([
      sbRestRequest('app_settings?on_conflict=key', {
        method: 'POST',
        prefer: 'resolution=merge-duplicates',
        body: {
          key: CONTROL_CENTER_SETTING_KEY,
          value: envelope.published,
          updated_at: envelope.published.updatedAt,
        },
      }),
      envelope.draft
        ? sbRestRequest('app_settings?on_conflict=key', {
            method: 'POST',
            prefer: 'resolution=merge-duplicates',
            body: {
              key: CONTROL_CENTER_DRAFT_KEY,
              value: envelope.draft,
              updated_at: envelope.draft.updatedAt,
            },
          })
        : Promise.resolve(),
    ]);
  }
}

export async function getControlCenterAdminState(): Promise<{
  published: SiteControlCenterConfig;
  draft: SiteControlCenterConfig | null;
  hasUnpublishedDraft: boolean;
  versions: ConfigVersionEntry[];
}> {
  const env = await loadEnvelope();
  return {
    published: env.published,
    draft: env.draft,
    hasUnpublishedDraft: Boolean(env.draft),
    versions: env.versions,
  };
}

export async function getPublishedSiteConfig(): Promise<SiteControlCenterConfig> {
  const env = await loadEnvelope();
  return env.published;
}

export async function getPublicSiteConfigPayload(): Promise<PublicSiteConfigPayload> {
  const published = await getPublishedSiteConfig();
  return {
    success: true,
    version: published.version,
    updatedAt: published.updatedAt,
    maintenance: published.maintenance,
    appPopup: published.appPopup,
    siteConfig: published,
    syncSource: 'live',
  };
}

function deepMergeConfig(base: SiteControlCenterConfig, patch: Partial<SiteControlCenterConfig>): SiteControlCenterConfig {
  const merged = {
    ...base,
    ...patch,
    branding: {
      user_app: { ...base.branding.user_app, ...(patch.branding?.user_app || {}) },
      admin_app: { ...base.branding.admin_app, ...(patch.branding?.admin_app || {}) },
      staff_app: { ...base.branding.staff_app, ...(patch.branding?.staff_app || {}) },
      website: { ...base.branding.website, ...(patch.branding?.website || {}) },
    },
    homepage: { ...base.homepage, ...(patch.homepage || {}) },
    header: { ...base.header, ...(patch.header || {}) },
    footer: {
      ...base.footer,
      ...(patch.footer || {}),
      socialLinks: {
        ...base.footer.socialLinks,
        ...(patch.footer?.socialLinks || {}),
      },
    },
    loginSettings: { ...base.loginSettings, ...(patch.loginSettings || {}) },
    announcement: { ...base.announcement, ...(patch.announcement || {}) },
    seo: { ...base.seo, ...(patch.seo || {}) },
    featureVisibility: { ...base.featureVisibility, ...(patch.featureVisibility || {}) },
    pwa: { ...base.pwa, ...(patch.pwa || {}) },
    notifications: {
      ...base.notifications,
      ...(patch.notifications || {}),
      categories: {
        user: { ...base.notifications.categories.user, ...(patch.notifications?.categories?.user || {}) },
        admin: { ...base.notifications.categories.admin, ...(patch.notifications?.categories?.admin || {}) },
        staff: { ...base.notifications.categories.staff, ...(patch.notifications?.categories?.staff || {}) },
      },
    },
    maintenance: { ...base.maintenance, ...(patch.maintenance || {}) },
    appPopup: { ...base.appPopup, ...(patch.appPopup || {}) },
    contentBlocks: { ...base.contentBlocks, ...(patch.contentBlocks || {}) },
  };
  return normalizeSiteControlCenterConfig(merged);
}

export async function saveControlCenterDraft(
  patch: Partial<SiteControlCenterConfig>,
  actor: { id?: string; email?: string }
): Promise<{ draft: SiteControlCenterConfig; published: SiteControlCenterConfig }> {
  const env = await loadEnvelope();
  const base = env.draft || env.published;
  const nextDraft = deepMergeConfig(base, {
    ...patch,
    version: env.published.version,
    updatedAt: new Date().toISOString(),
    updatedBy: actor.email || 'admin',
  });
  env.draft = nextDraft;
  await persistEnvelope(env, actor);
  return { draft: nextDraft, published: env.published };
}

export async function publishControlCenterChanges(
  options: {
    configPatch?: Partial<SiteControlCenterConfig>;
    summary?: string;
  },
  actor: { id?: string; email?: string }
): Promise<{
  published: SiteControlCenterConfig;
  versions: ConfigVersionEntry[];
}> {
  const env = await loadEnvelope();
  const now = new Date().toISOString();
  const nextVersion = Math.max(env.published.version, ...(env.versions.map((v) => v.version) || [1])) + 1;

  const candidateBase = env.draft || env.published;
  const nextPublished = deepMergeConfig(candidateBase, {
    ...(options.configPatch || {}),
    version: nextVersion,
    updatedAt: now,
    updatedBy: actor.email || 'admin',
    publishedAt: now,
  });

  // Keep synced with existing maintenance_mode & app_download_popup stores
  const [savedMaint, savedPopup] = await Promise.all([
    saveMaintenanceSettings(nextPublished.maintenance, actor),
    saveAppPopupSettings(nextPublished.appPopup, actor).catch(() => nextPublished.appPopup),
  ]);
  nextPublished.maintenance = { ...nextPublished.maintenance, ...savedMaint };
  nextPublished.appPopup = { ...nextPublished.appPopup, ...savedPopup };

  const summary = String(options.summary || 'Published control center updates').trim().slice(0, 180);
  const versionEntry: ConfigVersionEntry = {
    id: crypto.randomUUID(),
    version: nextVersion,
    status: 'published',
    summary,
    createdBy: actor.email || 'admin',
    createdAt: now,
    publishedAt: now,
    config: nextPublished,
  };

  if (isDatabaseAvailable()) {
    await query(
      `INSERT INTO public.platform_config_versions (id, version, status, config, summary, created_by, created_at, published_at)
       VALUES ($1, $2, 'published', $3::jsonb, $4, $5, NOW(), NOW())`,
      [versionEntry.id, nextVersion, JSON.stringify(nextPublished), summary, actor.email || 'admin']
    ).catch(() => {});
  }

  env.published = nextPublished;
  env.draft = null;
  env.versions = [
    versionEntry,
    ...env.versions.map((v) => ({ ...v, status: v.status === 'published' ? ('archived' as const) : v.status })),
  ].slice(0, 30);

  await persistEnvelope(env, actor);
  await broadcastSiteConfigEvent('config_updated');

  return { published: env.published, versions: env.versions };
}

export async function restoreControlCenterVersion(
  versionIdOrNumber: string | number,
  actor: { id?: string; email?: string }
): Promise<{
  restored: SiteControlCenterConfig;
  versions: ConfigVersionEntry[];
} | null> {
  const env = await loadEnvelope();
  const target = env.versions.find(
    (v) => v.id === String(versionIdOrNumber) || String(v.version) === String(versionIdOrNumber)
  );
  if (!target) return null;

  const { published, versions } = await publishControlCenterChanges(
    {
      configPatch: target.config,
      summary: `Restored configuration from v${target.version}`,
    },
    actor
  );

  return { restored: published, versions };
}

export async function discardControlCenterDraft(actor: { id?: string; email?: string }): Promise<void> {
  const env = await loadEnvelope();
  env.draft = null;
  await persistEnvelope(env, actor);
}

/**
 * Keeps Maintenance & Popup endpoints synchronized with Control Center live SSE broadcasts.
 */
export async function syncMaintenanceIntoControlCenter(actor: { id?: string; email?: string }): Promise<void> {
  const env = await loadEnvelope();
  const [maint, popup] = await Promise.all([getMaintenanceSettings(), getAppPopupSettings()]);
  const now = new Date().toISOString();
  env.published = normalizeSiteControlCenterConfig({
    ...env.published,
    version: env.published.version + 1,
    updatedAt: now,
    updatedBy: actor.email || 'admin',
    publishedAt: now,
    maintenance: maint,
    appPopup: popup,
  });
  await persistEnvelope(env, actor);
  await broadcastSiteConfigEvent('config_updated');
}

// ============================================================================
// BRANDING ASSETS STORAGE (PNG, JPG, WebP, GIF & SANITIZED SVG)
// ============================================================================

function loadAssetsStore(): Record<string, StoredBrandingAsset> {
  const existing = g.__mmBrandingAssetsCache || {};
  const fromDisk = readJsonStore<Record<string, StoredBrandingAsset>>(BRANDING_ASSETS_FILE);
  if (fromDisk) {
    g.__mmBrandingAssetsCache = { ...fromDisk, ...existing };
  }
  return g.__mmBrandingAssetsCache!;
}

export async function saveSanitizedBrandingAsset(params: {
  scope: BrandingIdentityKey | 'general';
  slot: 'logo' | 'favicon' | 'pwa_icon' | 'og_image' | 'hero_image' | 'banner' | 'splash';
  dataUrl: string;
  width?: number;
  height?: number;
  actorEmail: string;
}): Promise<{
  success: boolean;
  asset?: { id: string; url: string; mimeType: string; width?: number; height?: number; byteSize: number };
  error?: string;
}> {
  const check = validateBrandingImageInput(params.dataUrl, {
    width: params.width,
    height: params.height,
  });

  if (!check.valid || !check.sanitizedDataUrl || !check.mimeType) {
    return { success: false, error: check.error || 'Invalid branding image.' };
  }

  const assetId = `${params.scope}_${params.slot}_${Date.now()}_${crypto.randomBytes(4).toString('hex')}`;
  const dataContent =
    check.mimeType === 'image/svg+xml' && check.sanitizedSvg
      ? check.sanitizedSvg
      : check.sanitizedDataUrl;

  const sha256 = crypto.createHash('sha256').update(dataContent).digest('hex');
  const asset: StoredBrandingAsset = {
    id: assetId,
    scope: params.scope,
    slot: params.slot,
    mimeType: check.mimeType,
    dataContent,
    width: check.width,
    height: check.height,
    byteSize: check.byteSize || Buffer.byteLength(dataContent, 'utf8'),
    sha256,
    createdBy: params.actorEmail,
    createdAt: new Date().toISOString(),
  };

  const store = loadAssetsStore();
  store[assetId] = asset;
  // Prune old assets if count > 80 keeping latest
  const entries = Object.values(store).sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)).slice(0, 80);
  const compact: Record<string, StoredBrandingAsset> = {};
  for (const e of entries) compact[e.id] = e;
  g.__mmBrandingAssetsCache = compact;
  writeJsonStore(BRANDING_ASSETS_FILE, compact);

  if (isDatabaseAvailable()) {
    await query(
      `INSERT INTO public.branding_assets (id, scope, slot, mime_type, data_content, width, height, byte_size, sha256, created_by, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        asset.id,
        asset.scope,
        asset.slot,
        asset.mimeType,
        asset.dataContent,
        asset.width || null,
        asset.height || null,
        asset.byteSize,
        asset.sha256,
        asset.createdBy,
      ]
    ).catch(() => {});
  }

  return {
    success: true,
    asset: {
      id: asset.id,
      url: `/api/branding/assets/${encodeURIComponent(asset.id)}`,
      mimeType: asset.mimeType,
      width: asset.width,
      height: asset.height,
      byteSize: asset.byteSize,
    },
  };
}

export async function getBrandingAssetById(assetId: string): Promise<StoredBrandingAsset | null> {
  const cleanId = String(assetId || '').trim();
  if (!cleanId || !/^[a-zA-Z0-9_-]{4,120}$/.test(cleanId)) return null;

  const store = loadAssetsStore();
  if (store[cleanId]) return store[cleanId];

  if (isDatabaseAvailable()) {
    try {
      const res = await query(`SELECT * FROM public.branding_assets WHERE id = $1 LIMIT 1`, [cleanId]);
      if (res.rows[0]) {
        const row = res.rows[0];
        const asset: StoredBrandingAsset = {
          id: String(row.id),
          scope: row.scope,
          slot: row.slot,
          mimeType: row.mime_type,
          dataContent: row.data_content,
          width: row.width || undefined,
          height: row.height || undefined,
          byteSize: Number(row.byte_size) || 0,
          sha256: row.sha256 || '',
          createdBy: row.created_by || 'admin',
          createdAt: row.created_at ? new Date(row.created_at).toISOString() : new Date().toISOString(),
        };
        store[cleanId] = asset;
        return asset;
      }
    } catch {}
  }

  return null;
}

export function serveBrandingAssetResponse(res: http.ServerResponse, asset: StoredBrandingAsset): void {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');

  if (asset.mimeType === 'image/svg+xml') {
    // Double-sanitize before serving SVG, plus strict sandbox CSP so inline scripts can never run even if opened directly
    const recheck = validateBrandingImageInput(asset.dataContent);
    const svgBody = recheck.valid && recheck.sanitizedSvg ? recheck.sanitizedSvg : '<svg xmlns="http://www.w3.org/2000/svg"></svg>';
    res.writeHead(200, {
      'Content-Type': 'image/svg+xml; charset=utf-8',
      'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; sandbox",
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(svgBody);
    return;
  }

  const b64Match = asset.dataContent.match(/^data:[^;]+;base64,(.+)$/);
  if (b64Match) {
    const buf = Buffer.from(b64Match[1], 'base64');
    res.writeHead(200, {
      'Content-Type': asset.mimeType,
      'Content-Length': String(buf.length),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'public, max-age=31536000, immutable',
    });
    res.end(buf);
    return;
  }

  res.writeHead(404);
  res.end();
}

// ============================================================================
// REAL-TIME SSE STREAM FOR GLOBAL CONFIG SYNC (WITHOUT PAGE REFRESH)
// ============================================================================

export async function subscribeSiteConfigSse(
  req: http.IncomingMessage,
  res: http.ServerResponse,
  sinceVersion?: number
): Promise<void> {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  const payload = await getPublicSiteConfigPayload();
  const initialEvent = !sinceVersion || payload.version > sinceVersion ? 'config_updated' : 'connected';
  res.write(`event: ${initialEvent}\ndata: ${JSON.stringify(payload)}\n\n`);

  const clientId = crypto.randomUUID();
  const heartbeat = setInterval(() => {
    try {
      res.write(`: heartbeat ${Date.now()}\n\n`);
    } catch {
      cleanup();
    }
  }, 25000);

  const clientRecord = { id: clientId, res, heartbeat };
  g.__mmSseClients?.add(clientRecord);

  const cleanup = () => {
    clearInterval(heartbeat);
    g.__mmSseClients?.delete(clientRecord);
  };

  req.on('close', cleanup);
  req.on('error', cleanup);
}

export async function broadcastSiteConfigEvent(eventName: 'config_updated' | 'maintenance_changed' = 'config_updated'): Promise<void> {
  if (!g.__mmSseClients || g.__mmSseClients.size === 0) return;
  const payload = await getPublicSiteConfigPayload();
  const frame = `event: ${eventName}\ndata: ${JSON.stringify(payload)}\n\n`;
  for (const client of Array.from(g.__mmSseClients)) {
    try {
      if (!client.res.writableEnded) {
        client.res.write(frame);
      } else {
        clearInterval(client.heartbeat);
        g.__mmSseClients.delete(client);
      }
    } catch {
      clearInterval(client.heartbeat);
      g.__mmSseClients.delete(client);
    }
  }
}

// ============================================================================
// DYNAMIC PWA MANIFESTS, ROBOTS.TXT & SITEMAP.XML
// ============================================================================

export async function buildDynamicPwaManifest(
  scope: 'user' | 'myadmin' | 'mystaff',
  hostHeader?: string
): Promise<Record<string, any>> {
  const cfg = await getPublishedSiteConfig();
  const version = cfg.version || 1;
  const isAdminSubdomain = Boolean(hostHeader && hostHeader.toLowerCase().startsWith('admin.'));

  if (scope === 'myadmin') {
    const b = cfg.branding.admin_app;
    const customIcon = b.pwaIconUrl || b.logoUrl;
    const isCustomUploaded = customIcon.startsWith('/api/branding/assets/') || customIcon.startsWith('data:');
    const startUrl = isAdminSubdomain ? '/' : '/myadmin';
    const swScope = isAdminSubdomain ? '/' : '/myadmin';

    return {
      id: isAdminSubdomain ? 'mymoney-admin-subdomain-pwa' : 'mymoney-myadmin-pwa',
      name: b.appName,
      short_name: b.shortName,
      description: b.description,
      start_url: startUrl,
      scope: swScope,
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: b.backgroundColor,
      theme_color: b.themeColor,
      categories: ['business', 'productivity', 'security'],
      icons: [
        ...(isCustomUploaded
          ? [
              {
                src: `/api/pwa/icon/myadmin?v=${version}&size=192`,
                sizes: '192x192',
                type: customIcon.includes('svg') ? 'image/svg+xml' : 'image/png',
                purpose: 'any',
              },
              {
                src: `/api/pwa/icon/myadmin?v=${version}&size=512`,
                sizes: '512x512',
                type: customIcon.includes('svg') ? 'image/svg+xml' : 'image/png',
                purpose: 'any maskable',
              },
            ]
          : []),
        { src: `/admin-icon-192.png?v=${version}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `/admin-icon-512.png?v=${version}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `/admin-icon-512-maskable.png?v=${version}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
  }

  if (scope === 'mystaff') {
    const b = cfg.branding.staff_app;
    const customIcon = b.pwaIconUrl || b.logoUrl;
    const isCustomUploaded = customIcon.startsWith('/api/branding/assets/') || customIcon.startsWith('data:');

    return {
      id: 'mymoney-mystaff-pwa',
      name: b.appName,
      short_name: b.shortName,
      description: b.description,
      start_url: '/mystaff',
      scope: '/mystaff',
      display: 'standalone',
      orientation: 'portrait-primary',
      background_color: b.backgroundColor,
      theme_color: b.themeColor,
      categories: ['business', 'productivity'],
      icons: [
        ...(isCustomUploaded
          ? [
              {
                src: `/api/pwa/icon/mystaff?v=${version}&size=192`,
                sizes: '192x192',
                type: customIcon.includes('svg') ? 'image/svg+xml' : 'image/png',
                purpose: 'any',
              },
              {
                src: `/api/pwa/icon/mystaff?v=${version}&size=512`,
                sizes: '512x512',
                type: customIcon.includes('svg') ? 'image/svg+xml' : 'image/png',
                purpose: 'any maskable',
              },
            ]
          : []),
        { src: `/staff-icon-192.png?v=${version}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: `/staff-icon-512.png?v=${version}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
        { src: `/staff-icon-512-maskable.png?v=${version}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
      ],
    };
  }

  const b = cfg.branding.user_app;
  const customIcon = b.pwaIconUrl || b.logoUrl;
  const isCustomUploaded = customIcon.startsWith('/api/branding/assets/') || customIcon.startsWith('data:');

  return {
    id: 'mymoney-user-pwa',
    name: b.appName,
    short_name: b.shortName,
    description: b.description,
    start_url: '/',
    scope: '/',
    display: 'standalone',
    orientation: 'portrait-primary',
    background_color: b.backgroundColor,
    theme_color: b.themeColor,
    categories: ['finance', 'productivity'],
    icons: [
      ...(isCustomUploaded
        ? [
            {
              src: `/api/pwa/icon/user?v=${version}&size=192`,
              sizes: '192x192',
              type: customIcon.includes('svg') ? 'image/svg+xml' : 'image/png',
              purpose: 'any',
            },
            {
              src: `/api/pwa/icon/user?v=${version}&size=512`,
              sizes: '512x512',
              type: customIcon.includes('svg') ? 'image/svg+xml' : 'image/png',
              purpose: 'any maskable',
            },
          ]
        : []),
      { src: `/icon-192.png?v=${version}`, sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: `/icon-512.png?v=${version}`, sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: `/icon-512-maskable.png?v=${version}`, sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}

export async function resolveDynamicPwaIcon(
  scope: 'user' | 'myadmin' | 'mystaff',
  res: http.ServerResponse
): Promise<void> {
  const cfg = await getPublishedSiteConfig();
  const rawIcon =
    scope === 'myadmin'
      ? cfg.branding.admin_app.pwaIconUrl || cfg.branding.admin_app.logoUrl
      : scope === 'mystaff'
      ? cfg.branding.staff_app.pwaIconUrl || cfg.branding.staff_app.logoUrl
      : cfg.branding.user_app.pwaIconUrl || cfg.branding.user_app.logoUrl;

  if (rawIcon.startsWith('/api/branding/assets/')) {
    const assetId = rawIcon.replace('/api/branding/assets/', '').split('?')[0];
    const asset = await getBrandingAssetById(assetId);
    if (asset) {
      serveBrandingAssetResponse(res, asset);
      return;
    }
  }

  if (rawIcon.startsWith('data:')) {
    const check = validateBrandingImageInput(rawIcon);
    if (check.valid && check.mimeType) {
      serveBrandingAssetResponse(res, {
        id: `inline-${scope}`,
        scope: scope === 'myadmin' ? 'admin_app' : scope === 'mystaff' ? 'staff_app' : 'user_app',
        slot: 'pwa_icon',
        mimeType: check.mimeType,
        dataContent: check.mimeType === 'image/svg+xml' && check.sanitizedSvg ? check.sanitizedSvg : check.sanitizedDataUrl || rawIcon,
        byteSize: check.byteSize || 0,
        sha256: '',
        createdBy: 'system',
        createdAt: new Date().toISOString(),
      });
      return;
    }
  }

  const fallbackStatic =
    scope === 'myadmin' ? '/admin-icon-192.png' : scope === 'mystaff' ? '/staff-icon-192.png' : '/icon-192.png';
  res.writeHead(302, { Location: fallbackStatic, 'Cache-Control': 'no-cache' });
  res.end();
}

export async function generateRobotsTxt(): Promise<string> {
  const cfg = await getPublishedSiteConfig();
  const base = (cfg.seo.canonicalUrl || 'https://mymoney.nileshbarela.site').replace(/\/+$/, '');
  if (!cfg.seo.robotsAllowIndex) {
    return `User-agent: *\nDisallow: /\n`;
  }
  const disallows = Array.from(new Set(['/myadmin', '/mystaff', '/api/', ...(cfg.seo.robotsDisallowPaths || [])]));
  const lines = ['User-agent: *', 'Allow: /', ...disallows.map((d) => `Disallow: ${d}`)];
  if (cfg.seo.sitemapEnabled) {
    lines.push(`Sitemap: ${base}/sitemap.xml`);
  }
  return lines.join('\n') + '\n';
}

export async function generateSitemapXml(): Promise<string> {
  const cfg = await getPublishedSiteConfig();
  if (!cfg.seo.sitemapEnabled) {
    return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"></urlset>\n`;
  }
  const base = (cfg.seo.canonicalUrl || 'https://mymoney.nileshbarela.site').replace(/\/+$/, '');
  const paths = Array.from(new Set(['/', ...(cfg.seo.sitemapExtraPaths || [])])).filter(
    (p) => !p.startsWith('/myadmin') && !p.startsWith('/mystaff') && !p.startsWith('/api')
  );
  const lastmod = (cfg.updatedAt || new Date().toISOString()).slice(0, 10);
  const urls = paths
    .map(
      (p) =>
        `  <url>\n    <loc>${base}${p === '/' ? '/' : p}</loc>\n    <lastmod>${lastmod}</lastmod>\n  </url>`
    )
    .join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`;
}

// ============================================================================
// STAFF TASKS WORKSPACE STORE (Postgres + JSON fallback)
// ============================================================================

function loadStaffTasksLocal(): StaffTaskItem[] {
  if (g.__mmStaffTasksCache) return g.__mmStaffTasksCache;
  const fromDisk = readJsonStore<StaffTaskItem[]>(STAFF_TASKS_FILE);
  g.__mmStaffTasksCache = Array.isArray(fromDisk) ? fromDisk : [];
  return g.__mmStaffTasksCache;
}

function saveStaffTasksLocal(tasks: StaffTaskItem[]): void {
  g.__mmStaffTasksCache = tasks;
  writeJsonStore(STAFF_TASKS_FILE, tasks);
}

export async function listStaffTasks(filter?: { assignedTo?: string; status?: string }): Promise<StaffTaskItem[]> {
  if (isDatabaseAvailable()) {
    try {
      const conditions: string[] = [];
      const params: any[] = [];
      if (filter?.assignedTo) {
        params.push(filter.assignedTo);
        conditions.push(`(t.assigned_to = $${params.length} OR t.assigned_to IS NULL)`);
      }
      if (filter?.status && filter.status !== 'all') {
        params.push(filter.status);
        conditions.push(`t.status = $${params.length}`);
      }
      const where = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
      const res = await query(
        `SELECT t.*, u1.full_name AS assigned_to_name, u1.email AS assigned_to_email,
                u2.full_name AS assigned_by_name
         FROM public.staff_tasks t
         LEFT JOIN public.app_users u1 ON u1.id = t.assigned_to
         LEFT JOIN public.app_users u2 ON u2.id = t.assigned_by
         ${where}
         ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 WHEN 'medium' THEN 3 ELSE 4 END, t.updated_at DESC
         LIMIT 200`,
        params
      );
      if (Array.isArray(res.rows)) {
        return res.rows.map((r: any) => ({
          id: String(r.id),
          title: String(r.title),
          description: String(r.description || ''),
          category: String(r.category || 'operations'),
          priority: r.priority || 'medium',
          status: r.status || 'open',
          assigned_to: r.assigned_to || null,
          assigned_to_name: r.assigned_to_name || null,
          assigned_to_email: r.assigned_to_email || null,
          assigned_by: r.assigned_by || null,
          assigned_by_name: r.assigned_by_name || null,
          related_user_id: r.related_user_id || null,
          related_ticket_id: r.related_ticket_id || null,
          due_at: r.due_at ? new Date(r.due_at).toISOString() : null,
          metadata: r.metadata || {},
          created_at: r.created_at ? new Date(r.created_at).toISOString() : new Date().toISOString(),
          updated_at: r.updated_at ? new Date(r.updated_at).toISOString() : new Date().toISOString(),
        }));
      }
    } catch {
      // fall back to local
    }
  }

  let list = loadStaffTasksLocal();
  if (filter?.assignedTo) {
    list = list.filter((t) => !t.assigned_to || t.assigned_to === filter.assignedTo);
  }
  if (filter?.status && filter.status !== 'all') {
    list = list.filter((t) => t.status === filter.status);
  }
  return list;
}

export async function createStaffTask(input: {
  title: string;
  description?: string;
  category?: string;
  priority?: 'low' | 'medium' | 'high' | 'urgent';
  assigned_to?: string | null;
  assigned_to_name?: string | null;
  assigned_to_email?: string | null;
  assigned_by: string;
  assigned_by_name?: string | null;
  due_at?: string | null;
}): Promise<StaffTaskItem> {
  const now = new Date().toISOString();
  const priority = ['low', 'medium', 'high', 'urgent'].includes(String(input.priority))
    ? (input.priority as StaffTaskItem['priority'])
    : 'medium';

  const task: StaffTaskItem = {
    id: crypto.randomUUID(),
    title: String(input.title || '').trim().slice(0, 140),
    description: String(input.description || '').trim().slice(0, 1000),
    category: String(input.category || 'operations').trim().slice(0, 50),
    priority,
    status: 'open',
    assigned_to: input.assigned_to || null,
    assigned_to_name: input.assigned_to_name || null,
    assigned_to_email: input.assigned_to_email || null,
    assigned_by: input.assigned_by,
    assigned_by_name: input.assigned_by_name || 'Admin',
    due_at: input.due_at || null,
    metadata: {},
    created_at: now,
    updated_at: now,
  };

  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `INSERT INTO public.staff_tasks (id, title, description, category, priority, status, assigned_to, assigned_by, due_at, created_at, updated_at)
         VALUES ($1, $2, $3, $4, $5, 'open', $6, $7, $8, NOW(), NOW())
         RETURNING *`,
        [
          task.id,
          task.title,
          task.description,
          task.category,
          task.priority,
          task.assigned_to,
          task.assigned_by,
          task.due_at,
        ]
      );
      if (res.rows[0]) {
        task.created_at = new Date(res.rows[0].created_at).toISOString();
        task.updated_at = new Date(res.rows[0].updated_at).toISOString();
      }
    } catch {}
  }

  const list = loadStaffTasksLocal();
  saveStaffTasksLocal([task, ...list].slice(0, 250));
  return task;
}

export async function updateStaffTask(
  taskId: string,
  updates: {
    status?: StaffTaskItem['status'];
    priority?: StaffTaskItem['priority'];
    assigned_to?: string | null;
    title?: string;
    description?: string;
  }
): Promise<StaffTaskItem | null> {
  const validStatus = new Set(['open', 'in_progress', 'completed', 'blocked', 'cancelled']);
  const validPriority = new Set(['low', 'medium', 'high', 'urgent']);

  const nextStatus = updates.status && validStatus.has(updates.status) ? updates.status : undefined;
  const nextPriority = updates.priority && validPriority.has(updates.priority) ? updates.priority : undefined;

  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `UPDATE public.staff_tasks
         SET status = COALESCE($1, status),
             priority = COALESCE($2, priority),
             assigned_to = COALESCE($3, assigned_to),
             title = COALESCE($4, title),
             description = COALESCE($5, description),
             updated_at = NOW()
         WHERE id = $6
         RETURNING *`,
        [
          nextStatus || null,
          nextPriority || null,
          updates.assigned_to !== undefined ? updates.assigned_to : null,
          updates.title ? updates.title.trim().slice(0, 140) : null,
          updates.description !== undefined ? updates.description.trim().slice(0, 1000) : null,
          taskId,
        ]
      );
      if (res.rows[0]) {
        const r = res.rows[0];
        const updated: StaffTaskItem = {
          id: String(r.id),
          title: r.title,
          description: r.description || '',
          category: r.category || 'operations',
          priority: r.priority,
          status: r.status,
          assigned_to: r.assigned_to || null,
          assigned_by: r.assigned_by || null,
          due_at: r.due_at ? new Date(r.due_at).toISOString() : null,
          metadata: r.metadata || {},
          created_at: new Date(r.created_at).toISOString(),
          updated_at: new Date(r.updated_at).toISOString(),
        };
        const list = loadStaffTasksLocal();
        saveStaffTasksLocal(list.map((t) => (t.id === taskId ? { ...t, ...updated } : t)));
        return updated;
      }
    } catch {}
  }

  const list = loadStaffTasksLocal();
  const idx = list.findIndex((t) => t.id === taskId);
  if (idx === -1) return null;
  const updated: StaffTaskItem = {
    ...list[idx],
    ...(nextStatus ? { status: nextStatus } : {}),
    ...(nextPriority ? { priority: nextPriority } : {}),
    ...(updates.assigned_to !== undefined ? { assigned_to: updates.assigned_to } : {}),
    ...(updates.title ? { title: updates.title.trim().slice(0, 140) } : {}),
    ...(updates.description !== undefined ? { description: updates.description.trim().slice(0, 1000) } : {}),
    updated_at: new Date().toISOString(),
  };
  list[idx] = updated;
  saveStaffTasksLocal(list);
  return updated;
}
