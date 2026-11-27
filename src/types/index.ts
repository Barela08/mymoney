export type TransactionCategory = 'home' | 'received' | 'room' | 'food' | 'other' | 'people' | string;

export type TransactionSubcategory =
  // Received Money / Income subcategories
  | 'salary'
  | 'business'
  | 'freelancing'
  | 'family'
  | 'gift'
  | 'refund'
  | 'rental'
  | 'investment'
  | 'interest'
  | 'loan_received'
  | 'udhar_received'
  | 'other_income'
  // Legacy / Backwards compatibility subcategories
  | 'received_home'
  | 'home_expense'
  // Room subcategories
  | 'gas'
  | 'grocery'
  | 'rent'
  | 'electricity'
  // Food subcategories
  | 'restaurant'
  | 'snacks'
  | 'beverages'
  | 'delivery'
  | 'mess_tiffin'
  | 'other_food'
  // Other subcategories
  | 'shopping'
  | 'travel'
  | 'entertainment'
  | 'health'
  | 'personal_care'
  | 'education'
  | 'bills'
  | 'emi_loan'
  | 'other_expense'
  | 'other_general'
  // People subcategories
  | 'money_given'
  | 'money_received'
  | string;

export type TransactionType = 'income' | 'expense' | 'transfer';

export interface TransactionMetadata {
  // Received Money specific
  received_from?: string;
  payment_method?: 'cash' | 'upi' | 'bank_transfer' | 'card' | 'wallet' | 'other' | string;
  utr?: string;
  bank_name?: string;
  account_reference?: string;
  card_last4?: string;
  financial_classification?: 'earned_income' | 'other_income' | 'borrowed' | string;
  attachment_url?: string;
  attachment_name?: string;
  attachment_mime?: string;
  attachment_size?: number;
  // Multi-item combined entry metadata (child items only; never store a separate parent sum row)
  batch_id?: string;
  batch_index?: number;
  batch_total?: number;
  batch_combined_amount?: number;
  // Custom category label
  category_label?: string;
  custom_category_label?: string;
  // Grocery specific
  grocery_item?: string;
  quantity?: string;
  // Rent & Electricity specific
  month?: string;
  paid_to?: string;
  billing_month?: string;
  // Gas specific
  paid_by?: string;
  gas_provider?: string;
  // Food specific
  food_item?: string;
  restaurant_name?: string;
  platform?: string;
  food_type?: string;
  // Other expense specific
  spent_at?: string;
  spent_for?: string;
  category_tag?: string;
  // General custom fields
  [key: string]: any;
}

export interface AuthUser {
  uid: string;
  id?: string;
  email: string;
  username?: string | null;
  displayName: string;
  full_name?: string;
  phone?: string | null;
  role: 'admin' | 'user' | 'superadmin' | 'support' | 'analyst' | 'anonymous' | string;
  role_slug?: string | null;
  staff_permissions?: string[];
  status: 'active' | 'suspended' | 'deactivated';
  email_verified?: boolean;
  emailVerified?: boolean;
  avatar_url?: string | null;
  avatarUrl?: string | null;
  force_password_reset?: boolean;
  profile_completed?: boolean;
  profileCompleted?: boolean;
  createdAt?: string;
  created_at?: string;
  last_login_at?: string | null;
  password_changed_at?: string;
}

/**
 * STRICT ADMIN DASHBOARD VIEW MODEL
 * Displays user identity and management status safely.
 * Strict Security Rule: Never displays actual passwords, password hashes, or tokens!
 */
export interface AdminUserListItem {
  id: string;
  uid?: string;
  fullName?: string;
  displayName?: string;
  email: string;
  phone?: string | null;
  role?: 'admin' | 'user' | 'superadmin' | 'anonymous';
  status: 'active' | 'suspended' | 'deactivated';
  emailVerified?: boolean;
  forcePasswordReset?: boolean;
  createdAt: string;
  lastLoginAt?: string | null;
  passwordChangedAt?: string;
  passwordStatus?: string;
  activeSessionsCount?: number;
  failedLoginAttempts?: number;
}

export interface Transaction {
  id: string;
  user_id?: string;
  user_email?: string;
  category: TransactionCategory;
  subcategory: TransactionSubcategory;
  transaction_type: TransactionType;
  amount: number;
  title: string;
  description?: string;
  person_name?: string;
  transaction_date: string; // YYYY-MM-DD
  transaction_time: string; // HH:mm:ss or HH:mm
  notes?: string;
  metadata?: TransactionMetadata;
  is_deleted?: boolean;
  deleted_at?: string;
  deleted_by?: string;
  created_at: string;
  updated_at: string;
}

export interface DynamicSection {
  id: string;
  name: string;
  icon: string;
  description?: string;
  display_order: number;
  is_enabled: boolean;
  created_at?: string;
  updated_at?: string;
}

export interface MaintenanceSettings {
  isEnabled: boolean;
  title: string;
  message: string;
  expectedRestoration?: string;
  allowStaffAccessDuringMaintenance?: boolean;
  emergencyBypassEnabled?: boolean;
  startDate?: string;
  endDate?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AppDownloadPopupSettings {
  enabled: boolean;
  downloadUrl: string;
  title: string;
  description: string;
  buttonLabel: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AppBrandingSettings {
  appName: string;
  subTitle: string;
  logoUrl: string;
  currencySymbol: string;
  currencyCode: string;
  timezone: string;
  allowRegistration: boolean;
  allowLogin: boolean;
  brandTitle?: string;
  companyName?: string;
  footerText?: string;
  supportEmail?: string;
  supportPhone?: string;
  showBrandingBadge?: boolean;
}

export type BrandingIdentityKey = 'user_app' | 'admin_app' | 'staff_app' | 'website';

export interface AppIdentityBranding {
  appName: string;
  shortName: string;
  tagline: string;
  description: string;
  logoUrl: string;
  faviconUrl: string;
  pwaIconUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  backgroundColor: string;
  themeColor: string;
  loginTitle: string;
  loginSubtitle: string;
  dashboardHeading: string;
  splashHeadline: string;
  splashTagline: string;
}

export interface WebsiteBrandingConfig {
  siteName: string;
  siteTitle: string;
  siteDescription: string;
  logoUrl: string;
  faviconUrl: string;
  ogImageUrl: string;
  primaryColor: string;
  secondaryColor: string;
  accentColor: string;
  headerBadgeText: string;
  footerBrandText: string;
  defaultLanguage: string;
  defaultTheme: 'light' | 'dark' | 'system';
}

export interface WebsiteNavLinkConfig {
  id: string;
  label: string;
  target: string;
  visible: boolean;
}

export interface WebsiteFeatureCardConfig {
  id: string;
  title: string;
  description: string;
  visible: boolean;
}

export interface WebsiteHomepageConfig {
  showHero: boolean;
  heroBadge: string;
  heroHeading: string;
  heroSubheading: string;
  heroImageUrl: string;
  primaryCtaText: string;
  secondaryCtaText: string;
  showAnnouncementStrip: boolean;
  showFeatureSection: boolean;
  featureSectionHeading: string;
  featureCards: WebsiteFeatureCardConfig[];
  showSecurityTrustSection: boolean;
  securityTrustText: string;
}

export interface WebsiteHeaderConfig {
  showBrandLogo: boolean;
  showBrandName: boolean;
  showInstallButton: boolean;
  showNotificationBell: boolean;
  navLinks: WebsiteNavLinkConfig[];
}

export interface WebsiteSocialLinks {
  github: string;
  twitter: string;
  linkedin: string;
  instagram: string;
  youtube: string;
  website: string;
}

export interface WebsiteFooterConfig {
  copyrightText: string;
  supportEmail: string;
  supportPhone: string;
  companyName: string;
  address: string;
  showLegalLinks: boolean;
  showSocialLinks: boolean;
  socialLinks: WebsiteSocialLinks;
}

export interface WebsiteLoginSettings {
  allowLogin: boolean;
  allowRegistration: boolean;
  allowGoogleSignIn: boolean;
  allowPasskeySignIn: boolean;
  loginHeadline: string;
  loginSubheadline: string;
  registerHeadline: string;
  registerSubheadline: string;
  loginBannerText: string;
  showAppDownloadOnLogin: boolean;
}

export interface WebsiteAnnouncementConfig {
  enabled: boolean;
  title: string;
  message: string;
  severity: 'info' | 'success' | 'warning' | 'announcement';
  ctaLabel: string;
  ctaTarget: string;
  dismissible: boolean;
}

export interface WebsiteSeoConfig {
  title: string;
  metaDescription: string;
  ogTitle: string;
  ogDescription: string;
  ogImageUrl: string;
  faviconUrl: string;
  canonicalUrl: string;
  robotsAllowIndex: boolean;
  robotsDisallowPaths: string[];
  sitemapEnabled: boolean;
  sitemapExtraPaths: string[];
}

export interface WebsiteFeatureVisibilityConfig {
  udharEnabled: boolean;
  upiQrEnabled: boolean;
  aiAssistantEnabled: boolean;
  receiptScannerEnabled: boolean;
  reportsEnabled: boolean;
  supportDeskEnabled: boolean;
  legalCenterEnabled: boolean;
  publicWelcomeHeroEnabled: boolean;
}

export interface AppPwaSettings {
  userAppInstallEnabled: boolean;
  adminAppInstallEnabled: boolean;
  staffAppInstallEnabled: boolean;
  showDownloadPopup: boolean;
  autoPromptDelaySeconds: number;
  offlineFallbackEnabled: boolean;
}

export interface NotificationTemplateRule {
  key: string;
  audience: 'user' | 'admin' | 'staff';
  category: string;
  enabled: boolean;
  titleTemplate: string;
  bodyTemplate: string;
}

export interface WebsiteNotificationConfig {
  userAppName: string;
  userIconUrl: string;
  adminAppName: string;
  adminIconUrl: string;
  staffAppName: string;
  staffIconUrl: string;
  categories: {
    user: Record<string, boolean>;
    admin: Record<string, boolean>;
    staff: Record<string, boolean>;
  };
  templates: NotificationTemplateRule[];
}

export interface SiteControlCenterConfig {
  version: number;
  updatedAt: string;
  updatedBy: string;
  publishedAt: string | null;
  branding: {
    user_app: AppIdentityBranding;
    admin_app: AppIdentityBranding;
    staff_app: AppIdentityBranding;
    website: WebsiteBrandingConfig;
  };
  homepage: WebsiteHomepageConfig;
  header: WebsiteHeaderConfig;
  footer: WebsiteFooterConfig;
  loginSettings: WebsiteLoginSettings;
  announcement: WebsiteAnnouncementConfig;
  seo: WebsiteSeoConfig;
  featureVisibility: WebsiteFeatureVisibilityConfig;
  pwa: AppPwaSettings;
  notifications: WebsiteNotificationConfig;
  maintenance: MaintenanceSettings;
  appPopup: AppDownloadPopupSettings;
  contentBlocks: {
    aboutSummary: string;
    supportNotice: string;
    securityGuarantee: string;
  };
}

export interface ConfigVersionEntry {
  id: string;
  version: number;
  status: 'draft' | 'published' | 'archived';
  summary: string;
  createdBy: string;
  createdAt: string;
  publishedAt: string | null;
  config: SiteControlCenterConfig;
}

export interface PublicSiteConfigPayload {
  success: boolean;
  version: number;
  updatedAt: string;
  maintenance: MaintenanceSettings;
  appPopup: AppDownloadPopupSettings;
  siteConfig: SiteControlCenterConfig;
  syncSource?: 'live' | 'cache' | 'fallback';
}

export interface StaffTaskItem {
  id: string;
  title: string;
  description: string;
  category: string;
  priority: 'low' | 'medium' | 'high' | 'urgent';
  status: 'open' | 'in_progress' | 'completed' | 'blocked' | 'cancelled';
  assigned_to: string | null;
  assigned_to_name?: string | null;
  assigned_to_email?: string | null;
  assigned_by: string | null;
  assigned_by_name?: string | null;
  related_user_id?: string | null;
  related_ticket_id?: string | null;
  due_at?: string | null;
  metadata?: Record<string, any>;
  created_at: string;
  updated_at: string;
}

export interface BroadcastNotification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'announcement' | 'maintenance';
  target_user_id: string;
  is_active: boolean;
  created_at: string;
  created_by?: string;
}

export interface NewTransactionPayload {
  category: TransactionCategory;
  subcategory: TransactionSubcategory;
  transaction_type: TransactionType;
  amount: number;
  title: string;
  description?: string;
  person_name?: string;
  transaction_date?: string;
  transaction_time?: string;
  notes?: string;
  metadata?: TransactionMetadata;
  user_id?: string;
}

export interface FinancialSummary {
  totalIncome: number;
  totalExpenses: number;
  availableBalance: number;
  // Received Money metrics
  totalReceivedMoney: number;
  totalEarnedIncome: number;
  totalOtherIncome: number;
  totalBorrowedReceived: number;
  // Legacy alias for backwards compatibility
  totalHomeReceived: number;
  totalHomeSpent: number;
  remainingHomeBalance: number;
  totalGas: number;
  totalGrocery: number;
  totalRent: number;
  totalElectricity: number;
  totalRoomExpenses: number;
  totalFoodExpenses: number;
  totalOtherExpenses: number;
  totalMoneyGiven: number;
  totalMoneyReceived: number;
  netPeopleBalance: number;
  totalTransactionsCount: number;
}

export interface PersonSummary {
  contactId?: string | null;
  name: string;
  totalGiven: number;
  totalReceived: number;
  outstandingBalance: number; // Given - Received
  isSettled?: boolean; // True when balance is 0 or marked settled
  transactionCount: number;
  lastTransactionDate: string;
  transactions: Transaction[];
  linkedUserId?: string | null;
  email?: string | null;
  phone?: string | null;
  avatarUrl?: string | null;
  relationshipType?: string | null;
  isRegisteredUser?: boolean;
  pendingRequestsCount?: number;
  pendingRequestsAmount?: number;
  rejectedCount?: number;
}

export interface DateFilterRange {
  preset: 'all' | 'today' | 'this_week' | 'this_month' | 'this_year' | 'custom';
  startDate?: string;
  endDate?: string;
}

export type SortOrder = 'newest' | 'oldest' | 'highest_amount' | 'lowest_amount';

export interface FilterOptions {
  searchQuery: string;
  category?: TransactionCategory | 'all';
  subcategory?: TransactionSubcategory | 'all';
  type?: TransactionType | 'all';
  dateFilter: DateFilterRange;
  minAmount?: number;
  maxAmount?: number;
  sortBy: SortOrder;
  personName?: string;
}

export type FeedbackType = 'feedback' | 'complaint';
export type FeedbackStatus = 'pending' | 'in_progress' | 'resolved' | 'closed';
export type FeedbackUrgency = 'low' | 'normal' | 'high' | 'urgent';

export interface FeedbackItem {
  id: string;
  user_id?: string;
  user_name: string;
  user_email: string;
  user_phone?: string;
  type: FeedbackType;
  category?: string;
  subject: string;
  message: string;
  rating?: number; // 1 to 5 for feedback
  urgency?: FeedbackUrgency; // for complaints
  dpdp_consent: boolean;
  dpdp_consent_at?: string;
  status: FeedbackStatus;
  admin_notes?: string;
  created_at: string;
  updated_at: string;
}

export interface DpdpConsentState {
  hasAnswered: boolean;
  isConsented: boolean;
  consentedAt?: string;
  allowAnalytics?: boolean;
}
