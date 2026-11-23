import {
  Briefcase,
  Store,
  Laptop,
  Heart,
  Gift,
  RotateCcw,
  Building,
  PieChart,
  Percent,
  Landmark,
  Handshake,
  PlusCircle,
  HelpCircle,
  LucideIcon,
  CreditCard,
  Banknote,
  QrCode,
  Wallet,
  Building2,
} from 'lucide-react';
import { TransactionSubcategory } from '../types';

export type FinancialClassification = 'earned_income' | 'other_income' | 'borrowed';

export interface ReceivedCategoryConfig {
  id: TransactionSubcategory;
  label: string;
  shortLabel: string;
  icon: LucideIcon;
  classification: FinancialClassification;
  isPopular?: boolean;
  color: {
    bg: string;
    text: string;
    border: string;
    badge: string;
    iconBg: string;
  };
  sourceField: {
    label: string;
    placeholder: string;
    examples: string;
  };
  descriptionField: {
    label: string;
    placeholder: string;
    suggestions: string[];
  };
}

export const RECEIVED_CATEGORIES: ReceivedCategoryConfig[] = [
  {
    id: 'salary',
    label: 'Salary',
    shortLabel: 'Salary',
    icon: Briefcase,
    classification: 'earned_income',
    isPopular: true,
    color: {
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-200 dark:border-emerald-800',
      badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700',
      iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    },
    sourceField: {
      label: 'Received From (Company / Employer)',
      placeholder: 'e.g. Acme Corp, Google, ABC Tech Ltd',
      examples: 'Company or employer name',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'What salary or payment is this?',
      suggestions: ['Monthly Salary', 'Performance Bonus', 'Incentive', 'Overtime Pay', 'Advance Salary', 'Stipend'],
    },
  },
  {
    id: 'business',
    label: 'Business',
    shortLabel: 'Business',
    icon: Store,
    classification: 'earned_income',
    isPopular: true,
    color: {
      bg: 'bg-indigo-50 dark:bg-indigo-950/40',
      text: 'text-indigo-700 dark:text-indigo-300',
      border: 'border-indigo-200 dark:border-indigo-800',
      badge: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-900/60 dark:text-indigo-200 border-indigo-300 dark:border-indigo-700',
      iconBg: 'bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border-indigo-500/20',
    },
    sourceField: {
      label: 'Received From (Customer / Business)',
      placeholder: 'e.g. Sharma Enterprise, Rahul Customer, Store Counter',
      examples: 'Customer or client business name',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'What was this payment for?',
      suggestions: ['Product Sale', 'Service Payment', 'Invoice #1042', 'Retail Revenue', 'Consulting Fee', 'Contract Milestone'],
    },
  },
  {
    id: 'freelancing',
    label: 'Freelancing',
    shortLabel: 'Freelance',
    icon: Laptop,
    classification: 'earned_income',
    isPopular: true,
    color: {
      bg: 'bg-sky-50 dark:bg-sky-950/40',
      text: 'text-sky-700 dark:text-sky-300',
      border: 'border-sky-200 dark:border-sky-800',
      badge: 'bg-sky-100 text-sky-800 dark:bg-sky-900/60 dark:text-sky-200 border-sky-300 dark:border-sky-700',
      iconBg: 'bg-sky-500/10 text-sky-600 dark:text-sky-400 border-sky-500/20',
    },
    sourceField: {
      label: 'Received From (Client / Platform)',
      placeholder: 'e.g. Upwork Client, Apex Media, Rohan Tech',
      examples: 'Direct client name or platform',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'Which project or deliverable?',
      suggestions: ['Website Development', 'UI/UX Design', 'Content Writing', 'App Bug Fix', 'SEO Audit', 'Hourly Milestone'],
    },
  },
  {
    id: 'family',
    label: 'Family Support',
    shortLabel: 'Family',
    icon: Heart,
    classification: 'other_income',
    isPopular: true,
    color: {
      bg: 'bg-pink-50 dark:bg-pink-950/40',
      text: 'text-pink-700 dark:text-pink-300',
      border: 'border-pink-200 dark:border-pink-800',
      badge: 'bg-pink-100 text-pink-800 dark:bg-pink-900/60 dark:text-pink-200 border-pink-300 dark:border-pink-700',
      iconBg: 'bg-pink-500/10 text-pink-600 dark:text-pink-400 border-pink-500/20',
    },
    sourceField: {
      label: 'Received From (Person / Relation)',
      placeholder: 'e.g. Father, Mother, Brother, Uncle',
      examples: 'Family member name or relationship',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'Family support or expense purpose',
      suggestions: ['Monthly Allowance', 'College & Books Fee', 'Hostel / Rent Support', 'Medical Expenses Help', 'Festive Support'],
    },
  },
  {
    id: 'gift',
    label: 'Gift',
    shortLabel: 'Gift',
    icon: Gift,
    classification: 'other_income',
    isPopular: true,
    color: {
      bg: 'bg-purple-50 dark:bg-purple-950/40',
      text: 'text-purple-700 dark:text-purple-300',
      border: 'border-purple-200 dark:border-purple-800',
      badge: 'bg-purple-100 text-purple-800 dark:bg-purple-900/60 dark:text-purple-200 border-purple-300 dark:border-purple-700',
      iconBg: 'bg-purple-500/10 text-purple-600 dark:text-purple-400 border-purple-500/20',
    },
    sourceField: {
      label: 'Received From (Person Name)',
      placeholder: 'e.g. Grandma, Friend Amit, Sister',
      examples: 'Person who gave the gift',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'What was the gift for?',
      suggestions: ['Birthday Gift', 'Wedding / Anniversary', 'Diwali / Eid Shagun', 'Graduation Reward', 'Token of Gratitude'],
    },
  },
  {
    id: 'refund',
    label: 'Refund',
    shortLabel: 'Refund',
    icon: RotateCcw,
    classification: 'other_income',
    isPopular: true,
    color: {
      bg: 'bg-amber-50 dark:bg-amber-950/40',
      text: 'text-amber-700 dark:text-amber-300',
      border: 'border-amber-200 dark:border-amber-800',
      badge: 'bg-amber-100 text-amber-800 dark:bg-amber-900/60 dark:text-amber-200 border-amber-300 dark:border-amber-700',
      iconBg: 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20',
    },
    sourceField: {
      label: 'Received From (Merchant / Platform)',
      placeholder: 'e.g. Amazon, Flipkart, IRCTC, Swiggy',
      examples: 'Shop or merchant name',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'Which purchase or service was refunded?',
      suggestions: ['Cancelled Ticket Refund', 'Returned Product Refund', 'Failed Transaction Reversal', 'Overcharged Adjustment', 'Security Deposit Return'],
    },
  },
  {
    id: 'rental',
    label: 'Rental Income',
    shortLabel: 'Rental',
    icon: Building,
    classification: 'other_income',
    isPopular: false,
    color: {
      bg: 'bg-teal-50 dark:bg-teal-950/40',
      text: 'text-teal-700 dark:text-teal-300',
      border: 'border-teal-200 dark:border-teal-800',
      badge: 'bg-teal-100 text-teal-800 dark:bg-teal-900/60 dark:text-teal-200 border-teal-300 dark:border-teal-700',
      iconBg: 'bg-teal-500/10 text-teal-600 dark:text-teal-400 border-teal-500/20',
    },
    sourceField: {
      label: 'Received From (Tenant / Occupant)',
      placeholder: 'e.g. Tenant Verma, Commercial Shop #4',
      examples: 'Tenant name or room identifier',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'Which property or rental period?',
      suggestions: ['November House Rent', 'Commercial Shop Lease', 'PG Room Rent', 'Parking Space Rent', 'Equipment Lease'],
    },
  },
  {
    id: 'investment',
    label: 'Investment Return',
    shortLabel: 'Investment',
    icon: PieChart,
    classification: 'other_income',
    isPopular: false,
    color: {
      bg: 'bg-emerald-50 dark:bg-emerald-950/40',
      text: 'text-emerald-700 dark:text-emerald-300',
      border: 'border-emerald-200 dark:border-emerald-800',
      badge: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200 border-emerald-300 dark:border-emerald-700',
      iconBg: 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border-emerald-500/20',
    },
    sourceField: {
      label: 'Received From (Broker / Asset / Company)',
      placeholder: 'e.g. Zerodha, Groww, Mutual Fund, Crypto',
      examples: 'Brokerage or asset platform',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'Dividend, capital gain or profit details',
      suggestions: ['Stock Dividend', 'Mutual Fund Capital Gain', 'Crypto Profit Booking', 'Gold Sale Return', 'Startup Angel Dividend'],
    },
  },
  {
    id: 'interest',
    label: 'Interest',
    shortLabel: 'Interest',
    icon: Percent,
    classification: 'other_income',
    isPopular: false,
    color: {
      bg: 'bg-cyan-50 dark:bg-cyan-950/40',
      text: 'text-cyan-700 dark:text-cyan-300',
      border: 'border-cyan-200 dark:border-cyan-800',
      badge: 'bg-cyan-100 text-cyan-800 dark:bg-cyan-900/60 dark:text-cyan-200 border-cyan-300 dark:border-cyan-700',
      iconBg: 'bg-cyan-500/10 text-cyan-600 dark:text-cyan-400 border-cyan-500/20',
    },
    sourceField: {
      label: 'Received From (Bank / Institution)',
      placeholder: 'e.g. SBI, HDFC Bank, Post Office',
      examples: 'Financial institution name',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'Savings, FD or recurring deposit interest',
      suggestions: ['Quarterly Savings Account Interest', 'Fixed Deposit Maturity Interest', 'RD Payout', 'Bond Coupon Payment', 'P2P Lending Interest'],
    },
  },
  {
    id: 'loan_received',
    label: 'Loan Received',
    shortLabel: 'Loan',
    icon: Landmark,
    classification: 'borrowed',
    isPopular: false,
    color: {
      bg: 'bg-orange-50 dark:bg-orange-950/40',
      text: 'text-orange-700 dark:text-orange-300',
      border: 'border-orange-200 dark:border-orange-800',
      badge: 'bg-orange-100 text-orange-800 dark:bg-orange-900/60 dark:text-orange-200 border-orange-300 dark:border-orange-700',
      iconBg: 'bg-orange-500/10 text-orange-600 dark:text-orange-400 border-orange-500/20',
    },
    sourceField: {
      label: 'Received From (Lender / Bank)',
      placeholder: 'e.g. HDFC Bank, Bajaj Finance, Personal Lender',
      examples: 'Bank or financial lender',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'Loan amount and sanction purpose',
      suggestions: ['Personal Loan Disbursal', 'Education Loan Tranche', 'Business Working Capital', 'Home Loan Part Release', 'Vehicle Loan'],
    },
  },
  {
    id: 'udhar_received',
    label: 'Udhar Received',
    shortLabel: 'Udhar',
    icon: Handshake,
    classification: 'borrowed',
    isPopular: false,
    color: {
      bg: 'bg-rose-50 dark:bg-rose-950/40',
      text: 'text-rose-700 dark:text-rose-300',
      border: 'border-rose-200 dark:border-rose-800',
      badge: 'bg-rose-100 text-rose-800 dark:bg-rose-900/60 dark:text-rose-200 border-rose-300 dark:border-rose-700',
      iconBg: 'bg-rose-500/10 text-rose-600 dark:text-rose-400 border-rose-500/20',
    },
    sourceField: {
      label: 'Received From (Person / Friend)',
      placeholder: 'e.g. Rohit, Suresh, Colleague Vicky',
      examples: 'Friend or contact name',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'Borrowed money / repayment promise',
      suggestions: ['Borrowed for rent emergency', 'Temporary help for bills', 'Borrowed for medical expenses', 'Short term cash loan'],
    },
  },
  {
    id: 'other_income',
    label: 'Other Income',
    shortLabel: 'Other',
    icon: PlusCircle,
    classification: 'other_income',
    isPopular: true,
    color: {
      bg: 'bg-slate-50 dark:bg-slate-800/40',
      text: 'text-slate-700 dark:text-slate-300',
      border: 'border-slate-200 dark:border-slate-700',
      badge: 'bg-slate-100 text-slate-800 dark:bg-slate-800 dark:text-slate-200 border-slate-300 dark:border-slate-600',
      iconBg: 'bg-slate-500/10 text-slate-600 dark:text-slate-400 border-slate-500/20',
    },
    sourceField: {
      label: 'Received From (Person / Source)',
      placeholder: 'e.g. Cash Deposit, Old Item Sold, Winner Prize',
      examples: 'Source or payer',
    },
    descriptionField: {
      label: 'Description / Purpose',
      placeholder: 'Describe what this money was for',
      suggestions: ['Old Furniture Sold', 'Lottery / Contest Win', 'Cashback Received', 'Miscellaneous Cash Inflow'],
    },
  },
];

export interface PaymentMethodConfig {
  id: 'cash' | 'upi' | 'bank_transfer' | 'card' | 'wallet' | 'other';
  label: string;
  icon: LucideIcon;
  requiresUtr?: boolean;
  requiresAccountRef?: boolean;
}

export const PAYMENT_METHODS: PaymentMethodConfig[] = [
  { id: 'upi', label: 'UPI', icon: QrCode, requiresUtr: true },
  { id: 'bank_transfer', label: 'Bank Transfer', icon: Building2, requiresAccountRef: true },
  { id: 'cash', label: 'Cash', icon: Banknote },
  { id: 'card', label: 'Card', icon: CreditCard },
  { id: 'wallet', label: 'Wallet', icon: Wallet },
  { id: 'other', label: 'Other', icon: HelpCircle },
];

/**
 * Normalizes legacy 'received_home' or unknown subcategories to a valid category config
 */
export function getReceivedCategoryConfig(subcategory?: string): ReceivedCategoryConfig {
  if (!subcategory) return RECEIVED_CATEGORIES[0];
  
  // Backwards compatibility for legacy home category
  if (subcategory === 'received_home') {
    return RECEIVED_CATEGORIES.find((c) => c.id === 'family') || RECEIVED_CATEGORIES[0];
  }

  const match = RECEIVED_CATEGORIES.find((c) => c.id === subcategory);
  return match || RECEIVED_CATEGORIES[RECEIVED_CATEGORIES.length - 1]; // fallback to Other Income
}

/**
 * Classifies whether a received transaction is earned income, other income, or borrowed money
 */
export function classifyFinancialTransaction(subcategory?: string): FinancialClassification {
  if (subcategory === 'salary' || subcategory === 'business' || subcategory === 'freelancing') {
    return 'earned_income';
  }
  if (subcategory === 'loan_received' || subcategory === 'udhar_received') {
    return 'borrowed';
  }
  return 'other_income';
}
