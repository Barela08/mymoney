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
  role: 'admin' | 'user' | 'superadmin' | 'anonymous';
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
