import type {
  SiteControlCenterConfig,
  AppIdentityBranding,
  WebsiteBrandingConfig,
} from '../types';
import type { AppPortalScope } from './portalAuth';

export const DEFAULT_SITE_CONTROL_CENTER_CONFIG: SiteControlCenterConfig = {
  version: 1,
  updatedAt: new Date(0).toISOString(),
  updatedBy: 'system',
  publishedAt: null,
  branding: {
    user_app: {
      appName: 'My Money Manager',
      shortName: 'MoneyMgr',
      tagline: 'by HackifyPro',
      description: 'Smart personal finance, expense tracking & verified Udhar ledger.',
      logoUrl: '/logo.jpg',
      sidebarLogoUrl: '/logo.jpg',
      lightLogoUrl: '/logo.jpg',
      darkLogoUrl: '/logo.jpg',
      faviconUrl: '/favicon.svg',
      pwaIconUrl: '/icon-192.png',
      notificationIconUrl: '/icon-192.png',
      primaryColor: '#10b981',
      secondaryColor: '#0f172a',
      accentColor: '#14b8a6',
      backgroundColor: '#f8fafc',
      themeColor: '#10b981',
      loginTitle: 'Welcome Back',
      loginSubtitle: 'Sign in to track expenses, Udhar balances, and AI insights.',
      dashboardHeading: 'Financial Command Center',
      splashHeadline: 'My Money Manager',
      splashTagline: 'Secure Expense & Udhar Intelligence by HackifyPro',
      headerBrandText: 'My Money Manager',
    },
    admin_app: {
      appName: 'My Money Manager Admin',
      shortName: 'MM Admin',
      tagline: 'A product of HackifyPro · Admin Security Gateway',
      description: 'Dedicated administrative control center, RBAC, website studio, and security gateway.',
      logoUrl: '/admin-logo.png',
      sidebarLogoUrl: '/admin-logo.png',
      lightLogoUrl: '/admin-logo.png',
      darkLogoUrl: '/admin-logo.png',
      faviconUrl: '/admin-favicon.png',
      pwaIconUrl: '/admin-icon-192.png',
      notificationIconUrl: '/admin-notification-icon.png',
      primaryColor: '#059669',
      secondaryColor: '#020617',
      accentColor: '#10b981',
      backgroundColor: '#020617',
      themeColor: '#059669',
      loginTitle: 'Administrator Sign In',
      loginSubtitle:
        'Sign in with an authorized Admin or Super Admin account to manage platform controls, staff roles, API keys, and security.',
      dashboardHeading: 'Admin Control Center',
      splashHeadline: 'My Money Manager Admin',
      splashTagline: 'Platform Governance & Website Control Center',
      headerBrandText: 'My Money Manager Admin',
    },
    staff_app: {
      appName: 'My Money Manager Staff',
      shortName: 'MM Staff',
      tagline: 'A product of HackifyPro · Staff Operations Desk',
      description: 'Dedicated operations workspace for support specialists, analysts, and assigned tasks.',
      logoUrl: '/staff-logo.png',
      sidebarLogoUrl: '/staff-logo.png',
      lightLogoUrl: '/staff-logo.png',
      darkLogoUrl: '/staff-logo.png',
      faviconUrl: '/staff-favicon.png',
      pwaIconUrl: '/staff-icon-192.png',
      notificationIconUrl: '/staff-icon-192.png',
      primaryColor: '#4f46e5',
      secondaryColor: '#0f172a',
      accentColor: '#06b6d4',
      backgroundColor: '#020617',
      themeColor: '#4f46e5',
      loginTitle: 'Staff Member Sign In',
      loginSubtitle:
        'Sign in with your Support Agent, Analyst, or assigned Staff account to handle user tickets, tasks, and operations.',
      dashboardHeading: 'Staff Operations Desk',
      splashHeadline: 'My Money Manager Staff',
      splashTagline: 'Support, Analytics & Assigned Task Desk',
      headerBrandText: 'My Money Manager Staff',
    },
    website: {
      siteName: 'My Money Manager',
      siteTitle: 'My Money Manager — Smart Expense & Udhar Tracker by HackifyPro',
      siteDescription:
        'Track income, daily expenses, room splits, verified Udhar ledgers, and AI financial intelligence securely.',
      logoUrl: '/logo.jpg',
      faviconUrl: '/favicon.svg',
      ogImageUrl: '/icon-512.png',
      primaryColor: '#10b981',
      secondaryColor: '#0f172a',
      accentColor: '#0ea5e9',
      headerBadgeText: 'by HackifyPro',
      footerBrandText: 'My Money Manager by HackifyPro',
      defaultLanguage: 'en',
      defaultTheme: 'system',
    },
  },
  homepage: {
    showHero: false,
    heroBadge: 'Trusted Financial Intelligence · HackifyPro',
    heroHeading: 'Take total command of every rupee.',
    heroSubheading:
      'Expense tracking, split room ledgers, consent-verified Udhar connections, and AI cashflow clarity in one fast app.',
    heroImageUrl: '/icon-512.png',
    primaryCtaText: 'Create Free Account',
    secondaryCtaText: 'Sign In',
    showAnnouncementStrip: true,
    showFeatureSection: true,
    featureSectionHeading: 'Built for everyday clarity and verified trust',
    featureCards: [
      {
        id: 'feat_ledger',
        title: 'Income & Expense Vault',
        description: 'Organize home, room, food, and personal categories with live INR insights.',
        visible: true,
      },
      {
        id: 'feat_udhar',
        title: 'Consent-Verified Udhar',
        description: 'Pair with friends via QR & settle shared balances transparently.',
        visible: true,
      },
      {
        id: 'feat_ai',
        title: 'AI Receipt & Budget Copilot',
        description: 'Scan bills and monitor spending patterns with server-protected AI.',
        visible: true,
      },
    ],
    showSecurityTrustSection: true,
    securityTrustText:
      'Bank-grade session security, DPDP privacy controls, encrypted credentials, and verified audit protection.',
  },
  header: {
    showBrandLogo: true,
    showBrandName: true,
    showInstallButton: true,
    showNotificationBell: true,
    navLinks: [
      { id: 'nav_features', label: 'Features', target: '#features', visible: true },
      { id: 'nav_security', label: 'Security', target: '#security', visible: true },
      { id: 'nav_support', label: 'Support', target: '#support', visible: true },
      { id: 'nav_legal', label: 'Legal', target: '#legal', visible: true },
    ],
  },
  footer: {
    copyrightText: '© 2026 My Money Manager by HackifyPro. All rights reserved.',
    supportEmail: 'hackifypro@gmail.com',
    supportPhone: '+919669412829',
    companyName: 'HackifyPro',
    address: 'India',
    showLegalLinks: true,
    showSocialLinks: false,
    socialLinks: {
      github: '',
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
    loginHeadline: 'Welcome back to My Money Manager',
    loginSubheadline: 'Sign in with Email, Google, or Passkey to access your workspace.',
    registerHeadline: 'Create your financial workspace',
    registerSubheadline: 'Free personal ledger with consent-verified Udhar and real-time sync.',
    loginBannerText: '',
    showAppDownloadOnLogin: true,
  },
  announcement: {
    enabled: false,
    title: 'Platform Update',
    message: '',
    severity: 'info',
    ctaLabel: '',
    ctaTarget: '#features',
    dismissible: true,
  },
  seo: {
    title: 'My Money Manager — Smart Expense & Udhar Tracker by HackifyPro',
    metaDescription:
      'Track income, daily expenses, room splits, verified Udhar ledgers, and AI financial intelligence securely.',
    ogTitle: 'My Money Manager by HackifyPro',
    ogDescription: 'Real-time expense management, verified Udhar ledger & AI financial insights.',
    ogImageUrl: '/icon-512.png',
    faviconUrl: '/favicon.svg',
    canonicalUrl: 'https://mymoney.nileshbarela.site',
    robotsAllowIndex: true,
    robotsDisallowPaths: ['/myadmin', '/mystaff', '/api/'],
    sitemapEnabled: true,
    sitemapExtraPaths: [],
  },
  featureVisibility: {
    udharEnabled: true,
    upiQrEnabled: true,
    aiAssistantEnabled: true,
    receiptScannerEnabled: true,
    reportsEnabled: true,
    supportDeskEnabled: true,
    legalCenterEnabled: true,
    publicWelcomeHeroEnabled: false,
  },
  pwa: {
    userAppInstallEnabled: true,
    adminAppInstallEnabled: true,
    staffAppInstallEnabled: true,
    showDownloadPopup: true,
    autoPromptDelaySeconds: 60,
    offlineFallbackEnabled: true,
    userPromptTitle: 'Install My Money Manager',
    userPromptDescription: 'Track expenses, UPI QR, and Udhar with instant offline access.',
    userInstallButtonText: 'Install User App',
    userHelpText: 'Tap Install or use your browser menu (Add to Home screen) to install.',
    adminPromptTitle: 'Install My Money Admin',
    adminPromptDescription: 'Manage platform controls, users, security, and campaigns directly.',
    adminInstallButtonText: 'Install Admin App',
    adminHelpText: 'Admin app runs as an isolated desktop/mobile management console.',
    staffPromptTitle: 'Install My Money Staff',
    staffPromptDescription: 'Dedicated staff desk for support, user tickets, and operational tasks.',
    staffInstallButtonText: 'Install Staff App',
    staffHelpText: 'Staff app runs as an isolated operations workspace.',
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
        transactions: true,
        udhar_updates: true,
        reminders: true,
        system_announcements: true,
      },
      admin: {
        new_user: true,
        security_alerts: true,
        support_tickets: true,
        app_installations: true,
        system_errors: true,
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
        key: 'user_welcome',
        audience: 'user',
        category: 'system_announcements',
        enabled: true,
        titleTemplate: 'Welcome to {{appName}}!',
        bodyTemplate: 'Hi {{name}}, your personal finance and Udhar vault is ready.',
      },
      {
        key: 'staff_task_assigned',
        audience: 'staff',
        category: 'assigned_task',
        enabled: true,
        titleTemplate: 'New Staff Task: {{taskTitle}}',
        bodyTemplate: 'Assigned by {{assignedBy}} · Priority: {{priority}}',
      },
      {
        key: 'admin_security_alert',
        audience: 'admin',
        category: 'security_alerts',
        enabled: true,
        titleTemplate: 'Security Alert: {{eventType}}',
        bodyTemplate: '{{summary}}',
      },
    ],
  },
  maintenance: {
    isEnabled: false,
    title: 'My Money Manager is Under Scheduled Maintenance',
    message:
      'We are upgrading our secure financial infrastructure to deliver better performance and security. Normal services will resume shortly.',
    expectedRestoration: 'Within 2 hours',
    allowStaffAccessDuringMaintenance: true,
    emergencyBypassEnabled: true,
  },
  appPopup: {
    enabled: true,
    downloadUrl: '/#install',
    title: 'Install My Money Manager',
    description: 'Install the app for a faster experience and easy access from your home screen.',
    buttonLabel: 'Install Now',
  },
  contentBlocks: {
    aboutSummary:
      'My Money Manager is built by HackifyPro to give individuals and households complete control over spending, Udhar balances, and recurring bills.',
    supportNotice: 'Need help with a transaction, Udhar pairing, or account? Reach our team 24/7.',
    securityGuarantee: 'All sessions use cryptographic tokens, strict RBAC, and DPDP consent tracking.',
  },
};

export function sanitizePublicUrl(raw?: string | null, fallback = '/logo.jpg'): string {
  const val = String(raw || '').trim();
  if (!val) return fallback;
  if (val.startsWith('/') && !val.startsWith('//')) return val;
  if (/^https:\/\//i.test(val)) return val;
  if (/^data:image\/(png|jpeg|jpg|webp|gif);base64,[A-Za-z0-9+/=]+$/i.test(val) && val.length <= 750000) {
    return val;
  }
  return fallback;
}

export function sanitizeHexColorClient(raw?: string | null, fallback = '#10b981'): string {
  const val = String(raw || '').trim();
  return /^#([0-9a-fA-F]{3}|[0-9a-fA-F]{6})$/.test(val) ? val : fallback;
}

export function normalizeClientSiteConfig(raw: any): SiteControlCenterConfig {
  const d = DEFAULT_SITE_CONTROL_CENTER_CONFIG;
  if (!raw || typeof raw !== 'object') return structuredClone(d);

  const mergeApp = (src: any, def: AppIdentityBranding): AppIdentityBranding => ({
    appName: String(src?.appName || def.appName).trim() || def.appName,
    shortName: String(src?.shortName || def.shortName).trim() || def.shortName,
    tagline: String(src?.tagline ?? def.tagline).trim(),
    description: String(src?.description ?? def.description).trim(),
    logoUrl: sanitizePublicUrl(src?.logoUrl, def.logoUrl),
    sidebarLogoUrl: sanitizePublicUrl(src?.sidebarLogoUrl, src?.logoUrl || def.sidebarLogoUrl || def.logoUrl),
    lightLogoUrl: sanitizePublicUrl(src?.lightLogoUrl, src?.logoUrl || def.lightLogoUrl || def.logoUrl),
    darkLogoUrl: sanitizePublicUrl(src?.darkLogoUrl, src?.logoUrl || def.darkLogoUrl || def.logoUrl),
    faviconUrl: sanitizePublicUrl(src?.faviconUrl, def.faviconUrl),
    pwaIconUrl: sanitizePublicUrl(src?.pwaIconUrl, def.pwaIconUrl),
    notificationIconUrl: sanitizePublicUrl(
      src?.notificationIconUrl,
      def.notificationIconUrl || src?.pwaIconUrl || def.pwaIconUrl
    ),
    originalLogoAssetId:
      typeof src?.originalLogoAssetId === 'string' && /^[a-zA-Z0-9_-]{4,120}$/.test(src.originalLogoAssetId)
        ? src.originalLogoAssetId
        : undefined,
    originalLogoMeta:
      src?.originalLogoMeta && typeof src.originalLogoMeta === 'object'
        ? {
            byteSize: Number(src.originalLogoMeta.byteSize) || undefined,
            width: Number(src.originalLogoMeta.width) || undefined,
            height: Number(src.originalLogoMeta.height) || undefined,
            mimeType: typeof src.originalLogoMeta.mimeType === 'string' ? src.originalLogoMeta.mimeType : undefined,
          }
        : undefined,
    primaryColor: sanitizeHexColorClient(src?.primaryColor, def.primaryColor),
    secondaryColor: sanitizeHexColorClient(src?.secondaryColor, def.secondaryColor),
    accentColor: sanitizeHexColorClient(src?.accentColor, def.accentColor),
    backgroundColor: sanitizeHexColorClient(src?.backgroundColor, def.backgroundColor),
    themeColor: sanitizeHexColorClient(src?.themeColor, def.themeColor),
    loginTitle: String(src?.loginTitle ?? def.loginTitle).trim() || def.loginTitle,
    loginSubtitle: String(src?.loginSubtitle ?? def.loginSubtitle).trim(),
    dashboardHeading: String(src?.dashboardHeading ?? def.dashboardHeading).trim() || def.dashboardHeading,
    splashHeadline: String(src?.splashHeadline ?? def.splashHeadline).trim() || def.splashHeadline,
    splashTagline: String(src?.splashTagline ?? def.splashTagline).trim(),
    headerBrandText: String(src?.headerBrandText ?? def.headerBrandText ?? def.appName).trim(),
  });

  const webSrc = raw?.branding?.website || {};
  const website: WebsiteBrandingConfig = {
    siteName: String(webSrc.siteName || d.branding.website.siteName).trim() || d.branding.website.siteName,
    siteTitle: String(webSrc.siteTitle || d.branding.website.siteTitle).trim() || d.branding.website.siteTitle,
    siteDescription: String(webSrc.siteDescription ?? d.branding.website.siteDescription).trim(),
    logoUrl: sanitizePublicUrl(webSrc.logoUrl, d.branding.website.logoUrl),
    faviconUrl: sanitizePublicUrl(webSrc.faviconUrl, d.branding.website.faviconUrl),
    ogImageUrl: sanitizePublicUrl(webSrc.ogImageUrl, d.branding.website.ogImageUrl),
    primaryColor: sanitizeHexColorClient(webSrc.primaryColor, d.branding.website.primaryColor),
    secondaryColor: sanitizeHexColorClient(webSrc.secondaryColor, d.branding.website.secondaryColor),
    accentColor: sanitizeHexColorClient(webSrc.accentColor, d.branding.website.accentColor),
    headerBadgeText: String(webSrc.headerBadgeText ?? d.branding.website.headerBadgeText).trim(),
    footerBrandText: String(webSrc.footerBrandText ?? d.branding.website.footerBrandText).trim(),
    defaultLanguage: String(webSrc.defaultLanguage || d.branding.website.defaultLanguage).trim(),
    defaultTheme: ['light', 'dark', 'system'].includes(webSrc.defaultTheme)
      ? webSrc.defaultTheme
      : d.branding.website.defaultTheme,
  };

  return {
    version: Number.isFinite(Number(raw.version)) ? Number(raw.version) : d.version,
    updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : d.updatedAt,
    updatedBy: typeof raw.updatedBy === 'string' ? raw.updatedBy : d.updatedBy,
    publishedAt: typeof raw.publishedAt === 'string' || raw.publishedAt === null ? raw.publishedAt : d.publishedAt,
    branding: {
      user_app: mergeApp(raw?.branding?.user_app, d.branding.user_app),
      admin_app: mergeApp(raw?.branding?.admin_app, d.branding.admin_app),
      staff_app: mergeApp(raw?.branding?.staff_app, d.branding.staff_app),
      website,
    },
    homepage: {
      ...d.homepage,
      ...(raw.homepage || {}),
      heroImageUrl: sanitizePublicUrl(raw?.homepage?.heroImageUrl, d.homepage.heroImageUrl),
      featureCards: Array.isArray(raw?.homepage?.featureCards)
        ? raw.homepage.featureCards
        : d.homepage.featureCards,
    },
    header: {
      ...d.header,
      ...(raw.header || {}),
      navLinks: Array.isArray(raw?.header?.navLinks)
        ? raw.header.navLinks.filter((l: any) => {
            const tgt = String(l?.target || '').toLowerCase();
            return !tgt.includes('/myadmin') && !tgt.includes('/mystaff');
          })
        : d.header.navLinks,
    },
    footer: {
      ...d.footer,
      ...(raw.footer || {}),
      socialLinks: {
        ...d.footer.socialLinks,
        ...(raw?.footer?.socialLinks || {}),
      },
    },
    loginSettings: {
      ...d.loginSettings,
      ...(raw.loginSettings || {}),
    },
    announcement: {
      ...d.announcement,
      ...(raw.announcement || {}),
    },
    seo: {
      ...d.seo,
      ...(raw.seo || {}),
      ogImageUrl: sanitizePublicUrl(raw?.seo?.ogImageUrl, d.seo.ogImageUrl),
      faviconUrl: sanitizePublicUrl(raw?.seo?.faviconUrl, d.seo.faviconUrl),
    },
    featureVisibility: {
      ...d.featureVisibility,
      ...(raw.featureVisibility || {}),
    },
    pwa: {
      ...d.pwa,
      ...(raw.pwa || {}),
    },
    notifications: {
      ...d.notifications,
      ...(raw.notifications || {}),
      userIconUrl: sanitizePublicUrl(raw?.notifications?.userIconUrl, d.notifications.userIconUrl),
      adminIconUrl: sanitizePublicUrl(raw?.notifications?.adminIconUrl, d.notifications.adminIconUrl),
      staffIconUrl: sanitizePublicUrl(raw?.notifications?.staffIconUrl, d.notifications.staffIconUrl),
      categories: {
        user: { ...d.notifications.categories.user, ...(raw?.notifications?.categories?.user || {}) },
        admin: { ...d.notifications.categories.admin, ...(raw?.notifications?.categories?.admin || {}) },
        staff: { ...d.notifications.categories.staff, ...(raw?.notifications?.categories?.staff || {}) },
      },
      templates: Array.isArray(raw?.notifications?.templates)
        ? raw.notifications.templates
        : d.notifications.templates,
    },
    maintenance: {
      ...d.maintenance,
      ...(raw.maintenance || {}),
    },
    appPopup: {
      ...d.appPopup,
      ...(raw.appPopup || {}),
    },
    contentBlocks: {
      ...d.contentBlocks,
      ...(raw.contentBlocks || {}),
    },
  };
}

export function getPortalIdentityFromSiteConfig(
  cfg: SiteControlCenterConfig,
  scope: AppPortalScope
): AppIdentityBranding {
  if (scope === 'myadmin') return cfg.branding.admin_app;
  if (scope === 'mystaff') return cfg.branding.staff_app;
  return cfg.branding.user_app;
}
