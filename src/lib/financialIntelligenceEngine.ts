import { Transaction, TransactionCategory, TransactionSubcategory, TransactionType } from '../types';
import { classifyFinancialTransaction } from './receivedMoneyCategories';
import type { UserBudget, SavingsGoal, RecurringBill } from './financialFeaturesApi';

// ============================================================================
// SHARED ACCOUNTING HELPERS (Canonical separation of Income, Expense, Transfers, Udhar)
// ============================================================================

export function toPaise(amount: number): number {
  if (!Number.isFinite(amount)) return 0;
  return Math.round(amount * 100);
}

export function fromPaise(paise: number): number {
  if (!Number.isFinite(paise)) return 0;
  return Math.round(paise) / 100;
}

export function roundMoney(amount: number): number {
  return fromPaise(toPaise(amount));
}

export function isTransferTransaction(tx: Transaction): boolean {
  if (!tx) return false;
  if (tx.metadata?.is_transfer === true || tx.metadata?.transfer_type) return true;
  if ((tx.transaction_type as string) === 'transfer') return true;
  return false;
}

export function isExpenseTransaction(tx: Transaction): boolean {
  if (!tx || tx.is_deleted || tx.category === 'people' || isTransferTransaction(tx)) return false;
  if (tx.category === 'home' || tx.category === 'received') {
    return tx.subcategory === 'home_expense';
  }
  return tx.transaction_type === 'expense';
}

export function isEarnedOrOtherIncomeTransaction(tx: Transaction): boolean {
  if (!tx || tx.is_deleted || tx.category === 'people' || isTransferTransaction(tx)) return false;
  if (tx.category === 'home' || tx.category === 'received') {
    if (tx.subcategory === 'home_expense') return false;
    const cls = tx.metadata?.financial_classification || classifyFinancialTransaction(tx.subcategory);
    return cls === 'earned_income' || cls === 'other_income';
  }
  return tx.transaction_type === 'income';
}

export function isBorrowedTransaction(tx: Transaction): boolean {
  if (!tx || tx.is_deleted || tx.category === 'people' || isTransferTransaction(tx)) return false;
  if (tx.category === 'home' || tx.category === 'received') {
    const cls = tx.metadata?.financial_classification || classifyFinancialTransaction(tx.subcategory);
    return cls === 'borrowed';
  }
  return false;
}

export function normalizeMerchantKey(raw: string): string {
  return String(raw || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function getDisplayCategoryLabel(category: TransactionCategory, subcategory?: string): string {
  if (category === 'food') {
    if (subcategory === 'delivery') return 'Food Delivery';
    if (subcategory === 'beverages') return 'Beverages';
    if (subcategory === 'snacks') return 'Snacks';
    if (subcategory === 'restaurant') return 'Restaurant';
    if (subcategory === 'mess_tiffin') return 'Mess / Tiffin';
    if (subcategory === 'other_food') return 'Other Food';
    return 'Food & Dining';
  }
  if (category === 'room') {
    if (subcategory === 'grocery') return 'Grocery Expenses';
    if (subcategory === 'rent') return 'Room Rent';
    if (subcategory === 'electricity') return 'Electricity Bill';
    if (subcategory === 'gas') return 'Gas Expenses';
    return 'Room';
  }
  if (category === 'other') {
    if (subcategory === 'travel') return 'Travel';
    if (subcategory === 'shopping') return 'Shopping';
    if (subcategory === 'health') return 'Medical / Health';
    if (subcategory === 'bills') return 'Bills';
    if (subcategory === 'emi_loan') return 'EMI / Loan';
    if (subcategory === 'entertainment') return 'Entertainment';
    if (subcategory === 'education') return 'Education';
    if (subcategory === 'personal_care') return 'Personal Care';
    if (subcategory === 'other_expense' || subcategory === 'other_general') return 'Other Expenses';
    return 'Other Expenses';
  }
  if (category === 'home' || category === 'received') {
    if (subcategory === 'home_expense') return 'Home Expense';
    if (subcategory === 'salary') return 'Salary';
    if (subcategory === 'freelancing' || subcategory === 'freelance') return 'Freelance';
    if (subcategory === 'business') return 'Business';
    if (subcategory === 'family' || subcategory === 'received_home') return 'Received from Person';
    if (subcategory === 'gift') return 'Gift';
    if (subcategory === 'refund') return 'Refund';
    if (subcategory === 'loan_received' || subcategory === 'udhar_received') return 'Borrowed / Loan';
    if (subcategory === 'other_income') return 'Other Income';
    return 'Received Money';
  }
  if (category === 'people') return 'People (Udhar)';
  return 'Other Expenses';
}

export interface CategoryCashflowBreakdown {
  totalReceivedMoney: number;
  totalEarnedIncome: number;
  totalOtherIncome: number;
  totalBorrowedReceived: number;
  totalIncome: number;
  totalHomeSpent: number;
  totalGas: number;
  totalGrocery: number;
  totalRent: number;
  totalElectricity: number;
  totalRoomOther: number;
  totalRoomExpenses: number;
  totalFoodExpenses: number;
  totalOtherExpenses: number;
  totalExpenses: number;
  availableBalance: number;
  totalMoneyGiven: number;
  totalMoneyReceived: number;
  netPeopleBalance: number;
}

/**
 * Canonical paise-safe accounting breakdown.
 * - Excludes soft-deleted rows and own-account transfers.
 * - Excludes Udhar (category === 'people') from personal Income/Expense totals.
 * - Excludes borrowed funds (loan_received, udhar_received) from earned/other Income.
 * - Sums ALL room subcategories (including custom user-defined subcategories).
 * - Counts each batch line-item cleanly once without double-counting batch_combined_amount.
 */
export function computeCategoryTotalsAndCashflow(transactions: Transaction[]): CategoryCashflowBreakdown {
  let homeReceivedP = 0;
  let homeSpentP = 0;
  let earnedIncomeP = 0;
  let otherIncomeP = 0;
  let borrowedReceivedP = 0;
  let gasP = 0;
  let groceryP = 0;
  let rentP = 0;
  let electricityP = 0;
  let roomOtherP = 0;
  let foodP = 0;
  let otherP = 0;
  let moneyGivenP = 0;
  let moneyReceivedP = 0;

  for (const tx of transactions) {
    if (!tx || tx.is_deleted || isTransferTransaction(tx)) continue;
    const amtP = toPaise(Number(tx.amount) || 0);
    if (amtP <= 0) continue;

    if (tx.category === 'home' || tx.category === 'received') {
      if (tx.subcategory === 'home_expense' || tx.transaction_type === 'expense') {
        homeSpentP += amtP;
      } else {
        homeReceivedP += amtP;
        const cls = tx.metadata?.financial_classification || classifyFinancialTransaction(tx.subcategory);
        if (cls === 'earned_income') {
          earnedIncomeP += amtP;
        } else if (cls === 'borrowed') {
          borrowedReceivedP += amtP;
        } else {
          otherIncomeP += amtP;
        }
      }
      continue;
    }

    if (tx.category === 'room') {
      if (tx.transaction_type === 'income') {
        homeReceivedP += amtP;
        otherIncomeP += amtP;
      } else {
        if (tx.subcategory === 'gas') gasP += amtP;
        else if (tx.subcategory === 'grocery') groceryP += amtP;
        else if (tx.subcategory === 'rent') rentP += amtP;
        else if (tx.subcategory === 'electricity') electricityP += amtP;
        else roomOtherP += amtP;
      }
      continue;
    }

    if (tx.category === 'food') {
      if (tx.transaction_type !== 'income') {
        foodP += amtP;
      }
      continue;
    }

    if (tx.category === 'other') {
      if (tx.transaction_type !== 'income') {
        otherP += amtP;
      }
      continue;
    }

    if (tx.category === 'people') {
      if (tx.subcategory === 'money_given') moneyGivenP += amtP;
      else if (tx.subcategory === 'money_received') moneyReceivedP += amtP;
    }
  }

  const roomExpensesP = gasP + groceryP + rentP + electricityP + roomOtherP;
  const totalExpensesP = homeSpentP + roomExpensesP + foodP + otherP;
  const totalIncomeP = earnedIncomeP + otherIncomeP;
  const availableBalanceP = homeReceivedP - totalExpensesP;

  return {
    totalReceivedMoney: fromPaise(homeReceivedP),
    totalEarnedIncome: fromPaise(earnedIncomeP),
    totalOtherIncome: fromPaise(otherIncomeP),
    totalBorrowedReceived: fromPaise(borrowedReceivedP),
    totalIncome: fromPaise(totalIncomeP),
    totalHomeSpent: fromPaise(homeSpentP),
    totalGas: fromPaise(gasP),
    totalGrocery: fromPaise(groceryP),
    totalRent: fromPaise(rentP),
    totalElectricity: fromPaise(electricityP),
    totalRoomOther: fromPaise(roomOtherP),
    totalRoomExpenses: fromPaise(roomExpensesP),
    totalFoodExpenses: fromPaise(foodP),
    totalOtherExpenses: fromPaise(otherP),
    totalExpenses: fromPaise(totalExpensesP),
    availableBalance: fromPaise(availableBalanceP),
    totalMoneyGiven: fromPaise(moneyGivenP),
    totalMoneyReceived: fromPaise(moneyReceivedP),
    netPeopleBalance: fromPaise(moneyGivenP - moneyReceivedP),
  };
}

export function formatLocalDateKey(dateObj: Date): string {
  const y = dateObj.getFullYear();
  const m = String(dateObj.getMonth() + 1).padStart(2, '0');
  const d = String(dateObj.getDate()).padStart(2, '0');
  return `${y}-${m}-${d}`;
}

export function parseDateKeyToParts(dateKey: string): { year: number; month: number; day: number } | null {
  const m = String(dateKey || '').match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!m) return null;
  const year = Number(m[1]);
  const month = Number(m[2]);
  const day = Number(m[3]);
  if (!year || month < 1 || month > 12 || day < 1 || day > 31) return null;
  return { year, month, day };
}

// ============================================================================
// FEATURE 2: SMART TRANSACTION CATEGORIZATION ENGINE
// ============================================================================

export interface UserCategorizationRule {
  id: string;
  user_id?: string;
  merchant_pattern: string;
  category: TransactionCategory;
  subcategory: TransactionSubcategory;
  transaction_type: TransactionType;
  usage_count: number;
  updated_at: string;
}

export interface CategorizationInput {
  title?: string;
  description?: string;
  merchant?: string;
  notes?: string;
  amount?: number;
}

export interface CategorizationSuggestion {
  category: TransactionCategory;
  subcategory: TransactionSubcategory;
  transaction_type: TransactionType;
  displayCategory: string;
  merchant: string;
  suggestedDescription: string;
  confidence: number; // 0 to 1
  source: 'user_rule' | 'history' | 'rule' | 'ai';
  matchedPattern?: string;
  needsAiFallback: boolean;
}

interface DeterministicRule {
  patterns: RegExp[];
  category: TransactionCategory;
  subcategory: TransactionSubcategory;
  transaction_type: TransactionType;
  merchantLabel?: string;
  confidence: number;
}

const DETERMINISTIC_RULES: DeterministicRule[] = [
  // Food Delivery & Dining
  {
    patterns: [/\bswiggy\b/i, /\bzomato\b/i, /\bubereats\b/i, /\beatclub\b/i, /\bmagicpin\b/i],
    category: 'food',
    subcategory: 'delivery',
    transaction_type: 'expense',
    confidence: 0.96,
  },
  {
    patterns: [/\bstarbucks\b/i, /\bcafe coffee day\b/i, /\bccd\b/i, /\bchai\b/i, /\bcoffee\b/i, /\btea\b/i, /\bchaayos\b/i],
    category: 'food',
    subcategory: 'beverages',
    transaction_type: 'expense',
    confidence: 0.9,
  },
  {
    patterns: [/\bdominos\b/i, /\bpizza hut\b/i, /\bkfc\b/i, /\bmcdonald/i, /\bburger king\b/i, /\bsubway\b/i, /\bhaldiram/i, /\bbiryani\b/i, /\bsamosa\b/i, /\bpizza\b/i, /\bburger\b/i, /\bsnacks?\b/i],
    category: 'food',
    subcategory: 'snacks',
    transaction_type: 'expense',
    confidence: 0.9,
  },
  {
    patterns: [/\brestaurant\b/i, /\bdhaba\b/i, /\bdinner\b/i, /\blunch\b/i, /\bbreakfast\b/i, /\bthali\b/i, /\bcafe\b/i, /\bbakery\b/i],
    category: 'food',
    subcategory: 'restaurant',
    transaction_type: 'expense',
    confidence: 0.86,
  },
  {
    patterns: [/\bmess\b/i, /\btiffin\b/i, /\bcanteen\b/i],
    category: 'food',
    subcategory: 'mess_tiffin',
    transaction_type: 'expense',
    confidence: 0.92,
  },
  // Groceries & Room Utilities
  {
    patterns: [/\bblinkit\b/i, /\bzepto\b/i, /\binstamart\b/i, /\bbigbasket\b/i, /\bdmart\b/i, /\breliance fresh\b/i, /\bsmart bazaar\b/i, /\bgrocer/i, /\bvegetable/i, /\bsabzi\b/i, /\bmilk\b/i, /\brice\b/i, /\batta\b/i, /\bkirana\b/i, /\bsupermarket\b/i],
    category: 'room',
    subcategory: 'grocery',
    transaction_type: 'expense',
    confidence: 0.92,
  },
  {
    patterns: [/\brent\b/i, /\blandlord\b/i, /\bpg rent\b/i, /\bflat rent\b/i, /\broom rent\b/i, /\bhostel fee\b/i],
    category: 'room',
    subcategory: 'rent',
    transaction_type: 'expense',
    confidence: 0.94,
  },
  {
    patterns: [/\belectricity\b/i, /\bbescom\b/i, /\btata power\b/i, /\badani electricity\b/i, /\bpower bill\b/i, /\bbijli\b/i, /\bmahavitaran\b/i, /\bbses\b/i],
    category: 'room',
    subcategory: 'electricity',
    transaction_type: 'expense',
    confidence: 0.94,
  },
  {
    patterns: [/\bindane\b/i, /\bbharat gas\b/i, /\bhp gas\b/i, /\blpg\b/i, /\bcylinder\b/i, /\bgas refill\b/i],
    category: 'room',
    subcategory: 'gas',
    transaction_type: 'expense',
    confidence: 0.94,
  },
  // Fuel & Travel
  {
    patterns: [/\bhp petrol\b/i, /\bindian ?oil\b/i, /\bbharat petroleum\b/i, /\bbpcl\b/i, /\biocl\b/i, /\bpetrol\b/i, /\bdiesel\b/i, /\bfuel\b/i, /\bcng\b/i],
    category: 'other',
    subcategory: 'travel',
    transaction_type: 'expense',
    confidence: 0.93,
  },
  {
    patterns: [/\buber\b/i, /\bola\b/i, /\brapido\b/i, /\bmetro\b/i, /\birctc\b/i, /\bredbus\b/i, /\bmakemytrip\b/i, /\bindigo\b/i, /\bair india\b/i, /\bauto fare\b/i, /\bcab\b/i, /\btrain\b/i, /\bflight\b/i, /\bbus ticket\b/i],
    category: 'other',
    subcategory: 'travel',
    transaction_type: 'expense',
    confidence: 0.92,
  },
  // Shopping
  {
    patterns: [/\bamazon\b/i, /\bflipkart\b/i, /\bmyntra\b/i, /\bajio\b/i, /\bmeesho\b/i, /\bnykaa\b/i, /\bcroma\b/i, /\bdecathlon\b/i, /\bshopping\b/i, /\bclothes\b/i, /\bshoes\b/i],
    category: 'other',
    subcategory: 'shopping',
    transaction_type: 'expense',
    confidence: 0.9,
  },
  // Bills, Telecom & Subscriptions
  {
    patterns: [/\bnetflix\b/i, /\bspotify\b/i, /\bamazon prime\b/i, /\bhotstar\b/i, /\byoutube premium\b/i, /\bjio\b/i, /\bairtel\b/i, /\bvi recharge\b/i, /\bbroadband\b/i, /\bwifi\b/i, /\bact fibernet\b/i, /\bmobile recharge\b/i, /\bsubscription\b/i, /\bicloud\b/i, /\bgoogle one\b/i],
    category: 'other',
    subcategory: 'bills',
    transaction_type: 'expense',
    confidence: 0.92,
  },
  // Health & Pharmacy
  {
    patterns: [/\bapollo pharmacy\b/i, /\b1mg\b/i, /\bpharmeasy\b/i, /\bnetmeds\b/i, /\bmedplus\b/i, /\bpharmacy\b/i, /\bmedicine\b/i, /\bhospital\b/i, /\bclinic\b/i, /\bdoctor\b/i, /\bdental\b/i, /\blab test\b/i],
    category: 'other',
    subcategory: 'health',
    transaction_type: 'expense',
    confidence: 0.93,
  },
  // Entertainment
  {
    patterns: [/\bbookmyshow\b/i, /\bpvr\b/i, /\binox\b/i, /\bmovie\b/i, /\bcinema\b/i, /\bconcert\b/i, /\bgaming\b/i, /\bsteam\b/i, /\bplaystation\b/i],
    category: 'other',
    subcategory: 'entertainment',
    transaction_type: 'expense',
    confidence: 0.91,
  },
  // Personal Care
  {
    patterns: [/\bsalon\b/i, /\bhaircut\b/i, /\bbarber\b/i, /\bgym\b/i, /\bcult\.?fit\b/i, /\blaundry\b/i, /\bdry clean\b/i],
    category: 'other',
    subcategory: 'personal_care',
    transaction_type: 'expense',
    confidence: 0.89,
  },
  // Education
  {
    patterns: [/\budemy\b/i, /\bcoursera\b/i, /\bcollege fee\b/i, /\btuition\b/i, /\bbooks?\b/i, /\bstationery\b/i, /\bexam fee\b/i, /\bcourse\b/i],
    category: 'other',
    subcategory: 'education',
    transaction_type: 'expense',
    confidence: 0.9,
  },
  // Income / Salary
  {
    patterns: [/\bsalary\b/i, /\bpayroll\b/i, /\bstipend\b/i, /\bmonthly pay\b/i, /\bwages\b/i],
    category: 'home',
    subcategory: 'salary',
    transaction_type: 'income',
    confidence: 0.95,
  },
  {
    patterns: [/\bfreelance\b/i, /\bclient payment\b/i, /\binvoice paid\b/i, /\bconsulting\b/i],
    category: 'home',
    subcategory: 'freelance',
    transaction_type: 'income',
    confidence: 0.9,
  },
  {
    patterns: [/\bfrom home\b/i, /\bfamily support\b/i, /\bpocket money\b/i, /\bpapa\b/i, /\bmom\b/i],
    category: 'home',
    subcategory: 'received_home',
    transaction_type: 'income',
    confidence: 0.88,
  },
  {
    patterns: [/\brefund\b/i, /\bcashback\b/i, /\breward\b/i],
    category: 'home',
    subcategory: 'cashback',
    transaction_type: 'income',
    confidence: 0.87,
  },
];

export function categorizeTransactionDeterministic(
  input: CategorizationInput,
  userRules: UserCategorizationRule[] = [],
  userTransactions: Transaction[] = []
): CategorizationSuggestion | null {
  const combined = [input.merchant, input.title, input.description, input.notes]
    .filter(Boolean)
    .join(' ')
    .trim();

  if (combined.length < 2) return null;

  const normalized = normalizeMerchantKey(combined);
  const merchantRaw = (input.merchant || input.title || input.description || '').trim();

  // 1. User-learned rules (highest priority)
  const sortedRules = [...userRules].sort((a, b) => b.merchant_pattern.length - a.merchant_pattern.length);
  for (const rule of sortedRules) {
    const patternNorm = normalizeMerchantKey(rule.merchant_pattern);
    if (patternNorm.length >= 2 && normalized.includes(patternNorm)) {
      return {
        category: rule.category,
        subcategory: rule.subcategory,
        transaction_type: rule.transaction_type,
        displayCategory: getDisplayCategoryLabel(rule.category, rule.subcategory),
        merchant: merchantRaw || rule.merchant_pattern,
        suggestedDescription: input.description?.trim() || `${merchantRaw || rule.merchant_pattern} (${getDisplayCategoryLabel(rule.category, rule.subcategory)})`,
        confidence: 0.98,
        source: 'user_rule',
        matchedPattern: rule.merchant_pattern,
        needsAiFallback: false,
      };
    }
  }

  // 2. Historical transaction frequency match for same user
  if (userTransactions.length > 0 && normalized.length >= 3) {
    const tokens = normalized.split(' ').filter((t) => t.length >= 3);
    const voteMap = new Map<string, { count: number; category: TransactionCategory; subcategory: TransactionSubcategory; type: TransactionType }>();

    for (const tx of userTransactions) {
      if (tx.is_deleted || tx.category === 'people' || isTransferTransaction(tx)) continue;
      const txText = normalizeMerchantKey(
        [tx.title, tx.metadata?.spent_at, tx.metadata?.restaurant_name, tx.metadata?.platform, tx.metadata?.grocery_item]
          .filter(Boolean)
          .join(' ')
      );
      if (!txText) continue;

      const exactMatch = txText === normalized || txText.includes(normalized) || normalized.includes(txText);
      const tokenOverlap = tokens.length > 0 && tokens.some((tok) => txText.split(' ').includes(tok));
      if (exactMatch || (tokens.length >= 2 && tokenOverlap)) {
        const key = `${tx.category}:${tx.subcategory}:${tx.transaction_type}`;
        const existing = voteMap.get(key);
        const weight = exactMatch ? 3 : 1;
        if (existing) existing.count += weight;
        else {
          voteMap.set(key, {
            count: weight,
            category: tx.category,
            subcategory: tx.subcategory,
            type: tx.transaction_type,
          });
        }
      }
    }

    let best: { count: number; category: TransactionCategory; subcategory: TransactionSubcategory; type: TransactionType } | null = null;
    for (const entry of voteMap.values()) {
      if (!best || entry.count > best.count) best = entry;
    }

    if (best && best.count >= 3) {
      return {
        category: best.category,
        subcategory: best.subcategory,
        transaction_type: best.type,
        displayCategory: getDisplayCategoryLabel(best.category, best.subcategory),
        merchant: merchantRaw,
        suggestedDescription: input.description?.trim() || merchantRaw,
        confidence: Math.min(0.94, 0.78 + best.count * 0.03),
        source: 'history',
        needsAiFallback: false,
      };
    }
  }

  // 3. Built-in deterministic merchant & keyword rules
  for (const rule of DETERMINISTIC_RULES) {
    for (const regex of rule.patterns) {
      const m = combined.match(regex);
      if (m) {
        return {
          category: rule.category,
          subcategory: rule.subcategory,
          transaction_type: rule.transaction_type,
          displayCategory: getDisplayCategoryLabel(rule.category, rule.subcategory),
          merchant: merchantRaw || m[0],
          suggestedDescription: input.description?.trim() || `${merchantRaw || m[0]}`,
          confidence: rule.confidence,
          source: 'rule',
          matchedPattern: m[0],
          needsAiFallback: false,
        };
      }
    }
  }

  // 4. Unknown — suggest AI fallback
  return {
    category: 'other',
    subcategory: 'other_general',
    transaction_type: 'expense',
    displayCategory: 'Other Expense',
    merchant: merchantRaw,
    suggestedDescription: input.description?.trim() || merchantRaw,
    confidence: 0.35,
    source: 'rule',
    needsAiFallback: true,
  };
}

export function upsertUserCategorizationRule(
  existingRules: UserCategorizationRule[],
  merchantPattern: string,
  category: TransactionCategory,
  subcategory: TransactionSubcategory,
  transaction_type: TransactionType
): UserCategorizationRule[] {
  const cleanPattern = normalizeMerchantKey(merchantPattern);
  if (cleanPattern.length < 2) return existingRules;

  const now = new Date().toISOString();
  const idx = existingRules.findIndex((r) => normalizeMerchantKey(r.merchant_pattern) === cleanPattern);
  if (idx >= 0) {
    const updated = [...existingRules];
    updated[idx] = {
      ...updated[idx],
      category,
      subcategory,
      transaction_type,
      usage_count: (updated[idx].usage_count || 1) + 1,
      updated_at: now,
    };
    return updated;
  }

  return [
    {
      id: `rule_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`,
      merchant_pattern: merchantPattern.trim().slice(0, 80),
      category,
      subcategory,
      transaction_type,
      usage_count: 1,
      updated_at: now,
    },
    ...existingRules,
  ];
}

// ============================================================================
// FEATURE 3: EXPENSE CALENDAR ENGINE
// ============================================================================

export type SpendingIntensity = 'none' | 'low' | 'normal' | 'high' | 'very_high';

export interface CalendarDaySummary {
  dateKey: string; // YYYY-MM-DD
  dayOfMonth: number;
  inCurrentMonth: boolean;
  totalExpenses: number;
  totalIncome: number;
  netFlow: number;
  transactionCount: number;
  expenseCount: number;
  intensity: SpendingIntensity;
  transactions: Transaction[];
  topCategories: Array<{ label: string; amount: number }>;
  paymentMethods: string[];
}

export interface MonthlyCalendarAnalytics {
  year: number;
  month: number; // 1-12
  totalExpenses: number;
  totalIncome: number;
  netFlow: number;
  totalTransactions: number;
  expenseTransactionCount: number;
  daysWithSpending: number;
  averageDailySpending: number;
  averageSpendingPerActiveDay: number;
  highestSpendingDay: { dateKey: string; amount: number } | null;
  lowestSpendingDay: { dateKey: string; amount: number } | null; // lowest among days with spending > 0
  previousMonthExpenses: number;
  monthOverMonthDelta: number;
  monthOverMonthPercent: number | null;
}

export interface ExpenseCalendarResult {
  days: CalendarDaySummary[]; // 42-cell grid (6 weeks x 7 days) or exact month days
  monthDaysMap: Record<string, CalendarDaySummary>;
  analytics: MonthlyCalendarAnalytics;
}

export function buildExpenseCalendarMonth(
  transactions: Transaction[],
  year: number,
  month: number, // 1-12
  categoryFilter: string = 'all'
): ExpenseCalendarResult {
  const activeTx = transactions.filter((t) => {
    if (t.is_deleted || t.category === 'people' || isTransferTransaction(t)) return false;
    if (categoryFilter !== 'all' && t.category !== categoryFilter) return false;
    return true;
  });

  // Previous month calculations
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const prevMonthPrefix = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;
  const currentMonthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  let previousMonthExpenses = 0;
  const byDate = new Map<string, Transaction[]>();

  for (const tx of activeTx) {
    const dateKey = String(tx.transaction_date || '').slice(0, 10);
    if (!dateKey) continue;
    if (dateKey.startsWith(prevMonthPrefix) && isExpenseTransaction(tx)) {
      previousMonthExpenses += Number(tx.amount) || 0;
    }
    if (dateKey.startsWith(currentMonthPrefix)) {
      const list = byDate.get(dateKey) || [];
      list.push(tx);
      byDate.set(dateKey, list);
    }
  }

  const daysInMonth = new Date(year, month, 0).getDate();
  const dailyExpenseValues: number[] = [];

  const monthDaysMap: Record<string, CalendarDaySummary> = {};
  let totalExpenses = 0;
  let totalIncome = 0;
  let totalTransactions = 0;
  let expenseTransactionCount = 0;
  let highestSpendingDay: { dateKey: string; amount: number } | null = null;
  let lowestSpendingDay: { dateKey: string; amount: number } | null = null;

  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    const dayTxs = byDate.get(dateKey) || [];

    let dayExp = 0;
    let dayInc = 0;
    let dayExpCount = 0;
    const catTotals = new Map<string, number>();
    const methods = new Set<string>();

    for (const tx of dayTxs) {
      const amt = Number(tx.amount) || 0;
      if (tx.metadata?.payment_method) {
        methods.add(String(tx.metadata.payment_method));
      }
      if (isExpenseTransaction(tx)) {
        dayExp += amt;
        dayExpCount += 1;
        const label = getDisplayCategoryLabel(tx.category, tx.subcategory);
        catTotals.set(label, (catTotals.get(label) || 0) + amt);
      } else if (isEarnedOrOtherIncomeTransaction(tx)) {
        dayInc += amt;
      }
    }

    totalExpenses += dayExp;
    totalIncome += dayInc;
    totalTransactions += dayTxs.length;
    expenseTransactionCount += dayExpCount;

    if (dayExp > 0) {
      dailyExpenseValues.push(dayExp);
      if (!highestSpendingDay || dayExp > highestSpendingDay.amount) {
        highestSpendingDay = { dateKey, amount: dayExp };
      }
      if (!lowestSpendingDay || dayExp < lowestSpendingDay.amount) {
        lowestSpendingDay = { dateKey, amount: dayExp };
      }
    }

    const topCategories = Array.from(catTotals.entries())
      .map(([label, amount]) => ({ label, amount }))
      .sort((a, b) => b.amount - a.amount);

    monthDaysMap[dateKey] = {
      dateKey,
      dayOfMonth: day,
      inCurrentMonth: true,
      totalExpenses: Math.round(dayExp * 100) / 100,
      totalIncome: Math.round(dayInc * 100) / 100,
      netFlow: Math.round((dayInc - dayExp) * 100) / 100,
      transactionCount: dayTxs.length,
      expenseCount: dayExpCount,
      intensity: 'none',
      transactions: dayTxs,
      topCategories,
      paymentMethods: Array.from(methods),
    };
  }

  // Assign relative intensity thresholds based on the month's active spending days
  const sortedVals = [...dailyExpenseValues].sort((a, b) => a - b);
  const p25 = sortedVals.length > 0 ? sortedVals[Math.floor(sortedVals.length * 0.25)] : 0;
  const p65 = sortedVals.length > 0 ? sortedVals[Math.floor(sortedVals.length * 0.65)] : 0;
  const p85 = sortedVals.length > 0 ? sortedVals[Math.floor(sortedVals.length * 0.85)] : 0;
  const avgActive = sortedVals.length > 0 ? totalExpenses / sortedVals.length : 0;

  for (const key of Object.keys(monthDaysMap)) {
    const d = monthDaysMap[key];
    if (d.totalExpenses <= 0) {
      d.intensity = 'none';
    } else if (sortedVals.length <= 2) {
      d.intensity = d.totalExpenses > avgActive * 1.25 ? 'high' : 'low';
    } else if (d.totalExpenses >= Math.max(p85, avgActive * 1.75)) {
      d.intensity = 'very_high';
    } else if (d.totalExpenses >= Math.max(p65, avgActive * 1.15)) {
      d.intensity = 'high';
    } else if (d.totalExpenses <= p25) {
      d.intensity = 'low';
    } else {
      d.intensity = 'normal';
    }
  }

  // Build 42-day grid starting Sunday (0)
  const firstDayOfWeek = new Date(year, month - 1, 1).getDay();
  const gridDays: CalendarDaySummary[] = [];

  // Leading days from previous month
  const prevMonthDaysCount = new Date(year, month - 1, 0).getDate();
  for (let i = firstDayOfWeek - 1; i >= 0; i--) {
    const dayNum = prevMonthDaysCount - i;
    const dateKey = `${prevYear}-${String(prevMonth).padStart(2, '0')}-${String(dayNum).padStart(2, '0')}`;
    gridDays.push({
      dateKey,
      dayOfMonth: dayNum,
      inCurrentMonth: false,
      totalExpenses: 0,
      totalIncome: 0,
      netFlow: 0,
      transactionCount: 0,
      expenseCount: 0,
      intensity: 'none',
      transactions: [],
      topCategories: [],
      paymentMethods: [],
    });
  }

  // Current month days
  for (let day = 1; day <= daysInMonth; day++) {
    const dateKey = `${year}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
    gridDays.push(monthDaysMap[dateKey]);
  }

  // Trailing days to complete weeks (35 or 42)
  const nextYear = month === 12 ? year + 1 : year;
  const nextMonth = month === 12 ? 1 : month + 1;
  const totalSlots = gridDays.length <= 35 ? 35 : 42;
  let nextDay = 1;
  while (gridDays.length < totalSlots) {
    const dateKey = `${nextYear}-${String(nextMonth).padStart(2, '0')}-${String(nextDay).padStart(2, '0')}`;
    gridDays.push({
      dateKey,
      dayOfMonth: nextDay,
      inCurrentMonth: false,
      totalExpenses: 0,
      totalIncome: 0,
      netFlow: 0,
      transactionCount: 0,
      expenseCount: 0,
      intensity: 'none',
      transactions: [],
      topCategories: [],
      paymentMethods: [],
    });
    nextDay++;
  }

  const today = new Date();
  const isCurrentMonth = today.getFullYear() === year && today.getMonth() + 1 === month;
  const elapsedDays = isCurrentMonth ? Math.max(1, today.getDate()) : daysInMonth;

  const delta = totalExpenses - previousMonthExpenses;
  const momPercent =
    previousMonthExpenses > 0 ? Math.round(((delta / previousMonthExpenses) * 100) * 10) / 10 : null;

  return {
    days: gridDays,
    monthDaysMap,
    analytics: {
      year,
      month,
      totalExpenses: Math.round(totalExpenses * 100) / 100,
      totalIncome: Math.round(totalIncome * 100) / 100,
      netFlow: Math.round((totalIncome - totalExpenses) * 100) / 100,
      totalTransactions,
      expenseTransactionCount,
      daysWithSpending: dailyExpenseValues.length,
      averageDailySpending: Math.round((totalExpenses / elapsedDays) * 100) / 100,
      averageSpendingPerActiveDay:
        dailyExpenseValues.length > 0 ? Math.round((totalExpenses / dailyExpenseValues.length) * 100) / 100 : 0,
      highestSpendingDay,
      lowestSpendingDay,
      previousMonthExpenses: Math.round(previousMonthExpenses * 100) / 100,
      monthOverMonthDelta: Math.round(delta * 100) / 100,
      monthOverMonthPercent: momPercent,
    },
  };
}

// ============================================================================
// FEATURE 6: NET WORTH TRACKER ENGINE
// ============================================================================

export type AssetCategory =
  | 'cash'
  | 'bank_account'
  | 'savings'
  | 'fixed_deposit'
  | 'investments'
  | 'stocks'
  | 'mutual_funds'
  | 'gold'
  | 'vehicle'
  | 'property'
  | 'other';

export type LiabilityCategory =
  | 'personal_loan'
  | 'home_loan'
  | 'vehicle_loan'
  | 'credit_card'
  | 'emi'
  | 'borrowed_money'
  | 'other';

export interface NetWorthAsset {
  id: string;
  name: string;
  category: AssetCategory;
  current_value: number;
  valuation_date: string;
  notes?: string;
  is_archived?: boolean;
  updated_at: string;
}

export interface NetWorthLiability {
  id: string;
  name: string;
  category: LiabilityCategory;
  current_balance: number;
  valuation_date: string;
  notes?: string;
  is_archived?: boolean;
  updated_at: string;
}

export interface NetWorthSnapshot {
  id: string;
  snapshot_date: string; // YYYY-MM-DD
  total_assets: number;
  total_liabilities: number;
  net_worth: number;
  linked_liquid_balance: number;
  linked_udhar_receivable: number;
  linked_udhar_payable: number;
}

export interface NetWorthSettings {
  includeLiquidBalance: boolean;
  includeUdharReceivables: boolean;
  includeUdharPayables: boolean;
}

export interface NetWorthCalculationResult {
  manualAssetsTotal: number;
  linkedLiquidAsset: number;
  linkedUdharReceivableAsset: number;
  totalAssets: number;
  manualLiabilitiesTotal: number;
  linkedUdharPayableLiability: number;
  totalLiabilities: number;
  netWorth: number;
  assetBreakdown: Array<{ category: string; label: string; amount: number; percent: number }>;
  liabilityBreakdown: Array<{ category: string; label: string; amount: number; percent: number }>;
}

const ASSET_LABELS: Record<AssetCategory, string> = {
  cash: 'Cash',
  bank_account: 'Bank Accounts',
  savings: 'Savings',
  fixed_deposit: 'Fixed Deposits',
  investments: 'Investments',
  stocks: 'Stocks',
  mutual_funds: 'Mutual Funds',
  gold: 'Gold',
  vehicle: 'Vehicle',
  property: 'Property',
  other: 'Other Assets',
};

const LIABILITY_LABELS: Record<LiabilityCategory, string> = {
  personal_loan: 'Personal Loans',
  home_loan: 'Home Loans',
  vehicle_loan: 'Vehicle Loans',
  credit_card: 'Credit Card Outstanding',
  emi: 'EMI Outstanding',
  borrowed_money: 'Borrowed Money',
  other: 'Other Liabilities',
};

export function calculateNetWorth(params: {
  assets: NetWorthAsset[];
  liabilities: NetWorthLiability[];
  availableBalance: number;
  udharReceivable: number;
  udharPayable: number;
  settings: NetWorthSettings;
}): NetWorthCalculationResult {
  const activeAssets = params.assets.filter((a) => !a.is_archived);
  const activeLiabilities = params.liabilities.filter((l) => !l.is_archived);

  const manualAssetsPaise = activeAssets.reduce((sum, a) => sum + toPaise(Math.max(0, Number(a.current_value) || 0)), 0);
  const manualLiabilitiesPaise = activeLiabilities.reduce(
    (sum, l) => sum + toPaise(Math.max(0, Number(l.current_balance) || 0)),
    0
  );

  // If availableBalance is negative and included, treat deficit as liability (never inflate assets)
  const linkedLiquidAssetPaise = params.settings.includeLiquidBalance ? toPaise(Math.max(0, params.availableBalance)) : 0;
  const linkedLiquidDeficitPaise = params.settings.includeLiquidBalance ? toPaise(Math.max(0, -params.availableBalance)) : 0;

  const linkedUdharReceivablePaise = params.settings.includeUdharReceivables
    ? toPaise(Math.max(0, params.udharReceivable))
    : 0;
  const linkedUdharPayablePaise = params.settings.includeUdharPayables
    ? toPaise(Math.max(0, params.udharPayable))
    : 0;

  const totalAssetsPaise = manualAssetsPaise + linkedLiquidAssetPaise + linkedUdharReceivablePaise;
  const totalLiabilitiesPaise = manualLiabilitiesPaise + linkedUdharPayablePaise + linkedLiquidDeficitPaise;

  const manualAssetsTotal = fromPaise(manualAssetsPaise);
  const linkedLiquidAsset = fromPaise(linkedLiquidAssetPaise);
  const linkedLiquidDeficit = fromPaise(linkedLiquidDeficitPaise);
  const linkedUdharReceivableAsset = fromPaise(linkedUdharReceivablePaise);
  const manualLiabilitiesTotal = fromPaise(manualLiabilitiesPaise);
  const linkedUdharPayableLiability = fromPaise(linkedUdharPayablePaise);
  const totalAssets = fromPaise(totalAssetsPaise);
  const totalLiabilities = fromPaise(totalLiabilitiesPaise);
  const netWorth = fromPaise(totalAssetsPaise - totalLiabilitiesPaise);

  const assetMap = new Map<string, { label: string; amount: number }>();
  for (const a of activeAssets) {
    const val = Math.max(0, Number(a.current_value) || 0);
    if (val <= 0) continue;
    const prev = assetMap.get(a.category) || { label: ASSET_LABELS[a.category] || a.category, amount: 0 };
    prev.amount += val;
    assetMap.set(a.category, prev);
  }
  if (linkedLiquidAsset > 0) {
    assetMap.set('linked_liquid', { label: 'Tracked Liquid Balance', amount: linkedLiquidAsset });
  }
  if (linkedUdharReceivableAsset > 0) {
    assetMap.set('linked_udhar_receivable', { label: 'Udhar Receivable', amount: linkedUdharReceivableAsset });
  }

  const liabilityMap = new Map<string, { label: string; amount: number }>();
  for (const l of activeLiabilities) {
    const val = Math.max(0, Number(l.current_balance) || 0);
    if (val <= 0) continue;
    const prev = liabilityMap.get(l.category) || { label: LIABILITY_LABELS[l.category] || l.category, amount: 0 };
    prev.amount += val;
    liabilityMap.set(l.category, prev);
  }
  if (linkedUdharPayableLiability > 0) {
    liabilityMap.set('linked_udhar_payable', { label: 'Udhar Payable', amount: linkedUdharPayableLiability });
  }
  if (linkedLiquidDeficit > 0) {
    liabilityMap.set('linked_liquid_deficit', { label: 'Account Overdraft / Deficit', amount: linkedLiquidDeficit });
  }

  const assetBreakdown = Array.from(assetMap.entries())
    .map(([category, v]) => ({
      category,
      label: v.label,
      amount: Math.round(v.amount * 100) / 100,
      percent: totalAssets > 0 ? Math.round((v.amount / totalAssets) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  const liabilityBreakdown = Array.from(liabilityMap.entries())
    .map(([category, v]) => ({
      category,
      label: v.label,
      amount: Math.round(v.amount * 100) / 100,
      percent: totalLiabilities > 0 ? Math.round((v.amount / totalLiabilities) * 1000) / 10 : 0,
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    manualAssetsTotal: Math.round(manualAssetsTotal * 100) / 100,
    linkedLiquidAsset: Math.round(linkedLiquidAsset * 100) / 100,
    linkedUdharReceivableAsset: Math.round(linkedUdharReceivableAsset * 100) / 100,
    totalAssets,
    manualLiabilitiesTotal: Math.round(manualLiabilitiesTotal * 100) / 100,
    linkedUdharPayableLiability: Math.round(linkedUdharPayableLiability * 100) / 100,
    totalLiabilities,
    netWorth,
    assetBreakdown,
    liabilityBreakdown,
  };
}

export function upsertNetWorthSnapshot(
  snapshots: NetWorthSnapshot[],
  calc: NetWorthCalculationResult,
  snapshotDate: string
): NetWorthSnapshot[] {
  const entry: NetWorthSnapshot = {
    id: `nw_snap_${snapshotDate}`,
    snapshot_date: snapshotDate,
    total_assets: calc.totalAssets,
    total_liabilities: calc.totalLiabilities,
    net_worth: calc.netWorth,
    linked_liquid_balance: calc.linkedLiquidAsset,
    linked_udhar_receivable: calc.linkedUdharReceivableAsset,
    linked_udhar_payable: calc.linkedUdharPayableLiability,
  };
  const filtered = snapshots.filter((s) => s.snapshot_date !== snapshotDate);
  return [...filtered, entry].sort((a, b) => a.snapshot_date.localeCompare(b.snapshot_date));
}

// ============================================================================
// FEATURE 7: SAFE-TO-SPEND CALCULATOR ENGINE
// ============================================================================

export interface SafeToSpendPreferences {
  minimumBalanceReserve: number;
  emergencyReserve: number;
  savingsCommitment: number;
  essentialExpenseReserve: number;
  expectedRemainingIncome: number;
  includeExpectedIncome: boolean;
  period: 'day' | 'week' | 'month';
}

export const DEFAULT_SAFE_TO_SPEND_PREFS: SafeToSpendPreferences = {
  minimumBalanceReserve: 0,
  emergencyReserve: 0,
  savingsCommitment: 0,
  essentialExpenseReserve: 0,
  expectedRemainingIncome: 0,
  includeExpectedIncome: false,
  period: 'month',
};

export interface SafeToSpendBreakdownItem {
  key: string;
  label: string;
  amount: number;
  description: string;
}

export interface SafeToSpendResult {
  hasSufficientData: boolean;
  insufficientReason?: string;
  availableBalance: number;
  effectiveBalance: number;
  upcomingBillsCommitment: number;
  upcomingBillsList: Array<{ id: string; title: string; amount: number; dueDay: number; daysUntilDue: number }>;
  reservedSavings: number;
  essentialReserve: number;
  emergencyReserve: number;
  minimumBalanceReserve: number;
  totalCommitments: number;
  safeToSpendPeriod: number;
  safeToSpendToday: number;
  safeToSpendThisWeek: number;
  safeToSpendThisMonth: number;
  remainingDaysInMonth: number;
  remainingBudgetTotal: number | null;
  monthBudgetLimitTotal: number;
  monthSpentTotal: number;
  status: 'healthy' | 'caution' | 'deficit' | 'insufficient_data';
  explanation: string;
  warnings: string[];
  breakdown: SafeToSpendBreakdownItem[];
}

export function isBillPaidForCycle(bill: RecurringBill, referenceDate: Date): boolean {
  if (!bill.last_paid_date) return false;
  const parts = parseDateKeyToParts(bill.last_paid_date);
  if (!parts) return false;
  const refYear = referenceDate.getFullYear();
  const refMonth = referenceDate.getMonth() + 1;
  if (bill.frequency === 'monthly') {
    return parts.year === refYear && parts.month === refMonth;
  }
  if (bill.frequency === 'yearly') {
    return parts.year === refYear;
  }
  const paidTime = new Date(parts.year, parts.month - 1, parts.day).getTime();
  const diffDays = (referenceDate.getTime() - paidTime) / (1000 * 60 * 60 * 24);
  if (bill.frequency === 'weekly') return diffDays >= 0 && diffDays < 7;
  if (bill.frequency === 'quarterly') return diffDays >= 0 && diffDays < 85;
  return false;
}

export function getBillDaysUntilDue(bill: RecurringBill, referenceDate: Date): number {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();
  const todayDay = referenceDate.getDate();
  const maxDayInMonth = new Date(year, month + 1, 0).getDate();
  const dueDay = Math.min(Math.max(1, Number(bill.due_day) || 1), maxDayInMonth);

  const dueThisMonth = new Date(year, month, dueDay);
  const todayMidnight = new Date(year, month, todayDay);
  const diffMs = dueThisMonth.getTime() - todayMidnight.getTime();
  return Math.round(diffMs / (1000 * 60 * 60 * 24));
}

export function calculateSafeToSpend(params: {
  availableBalance: number;
  transactions: Transaction[];
  recurringBills: RecurringBill[];
  budgets: UserBudget[];
  savingsGoals: SavingsGoal[];
  preferences: SafeToSpendPreferences;
  referenceDate?: Date;
}): SafeToSpendResult {
  const now = params.referenceDate || new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const daysInMonth = new Date(year, month, 0).getDate();
  const remainingDaysInMonth = Math.max(1, daysInMonth - now.getDate() + 1);
  const remainingDaysInWeek = Math.max(1, 7 - now.getDay());
  const currentMonthPrefix = `${year}-${String(month).padStart(2, '0')}`;

  const activeTxs = params.transactions.filter((t) => !t.is_deleted);
  const monthSpentTotal = activeTxs
    .filter((t) => isExpenseTransaction(t) && String(t.transaction_date || '').startsWith(currentMonthPrefix))
    .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

  const hasAnyTransactions = activeTxs.length > 0;
  const hasAnyReservesOrBills =
    params.recurringBills.some((b) => b.is_active) ||
    params.budgets.length > 0 ||
    params.preferences.minimumBalanceReserve > 0 ||
    params.preferences.emergencyReserve > 0;

  if (!hasAnyTransactions && params.availableBalance === 0 && !hasAnyReservesOrBills) {
    return {
      hasSufficientData: false,
      insufficientReason: 'Not enough financial data to calculate a reliable Safe-to-Spend amount.',
      availableBalance: 0,
      effectiveBalance: 0,
      upcomingBillsCommitment: 0,
      upcomingBillsList: [],
      reservedSavings: 0,
      essentialReserve: 0,
      emergencyReserve: 0,
      minimumBalanceReserve: 0,
      totalCommitments: 0,
      safeToSpendPeriod: 0,
      safeToSpendToday: 0,
      safeToSpendThisWeek: 0,
      safeToSpendThisMonth: 0,
      remainingDaysInMonth,
      remainingBudgetTotal: null,
      monthBudgetLimitTotal: 0,
      monthSpentTotal: 0,
      status: 'insufficient_data',
      explanation: 'Add your income, expenses, or upcoming bills so Safe-to-Spend can compute your true discretionary buffer.',
      warnings: [],
      breakdown: [],
    };
  }

  // Upcoming UNPAID recurring bills due within the current month (or overdue in current month)
  // Crucially: skip bills already paid this cycle so we NEVER double-subtract!
  const upcomingBillsList: Array<{ id: string; title: string; amount: number; dueDay: number; daysUntilDue: number }> = [];
  const seenBillIds = new Set<string>();

  for (const bill of params.recurringBills) {
    if (!bill.is_active || seenBillIds.has(bill.id)) continue;
    seenBillIds.add(bill.id);
    if (isBillPaidForCycle(bill, now)) continue;
    const daysUntilDue = getBillDaysUntilDue(bill, now);
    // Include bills due in current month (including recently overdue within same month)
    if (daysUntilDue <= remainingDaysInMonth) {
      upcomingBillsList.push({
        id: bill.id,
        title: bill.title,
        amount: Math.max(0, Number(bill.amount) || 0),
        dueDay: bill.due_day,
        daysUntilDue,
      });
    }
  }

  const upcomingBillsCommitment = Math.round(
    upcomingBillsList.reduce((sum, b) => sum + b.amount, 0) * 100
  ) / 100;

  const reservedSavings = Math.max(0, Number(params.preferences.savingsCommitment) || 0);
  const essentialReserve = Math.max(0, Number(params.preferences.essentialExpenseReserve) || 0);
  const emergencyReserve = Math.max(0, Number(params.preferences.emergencyReserve) || 0);
  const minimumBalanceReserve = Math.max(0, Number(params.preferences.minimumBalanceReserve) || 0);
  const expectedIncomeBoost =
    params.preferences.includeExpectedIncome && params.preferences.expectedRemainingIncome > 0
      ? Number(params.preferences.expectedRemainingIncome)
      : 0;

  const effectiveBalance = fromPaise(toPaise(params.availableBalance) + toPaise(expectedIncomeBoost));
  const totalCommitments = fromPaise(
    toPaise(upcomingBillsCommitment) +
      toPaise(reservedSavings) +
      toPaise(essentialReserve) +
      toPaise(emergencyReserve) +
      toPaise(minimumBalanceReserve)
  );

  const safeToSpendThisMonth = fromPaise(toPaise(effectiveBalance) - toPaise(totalCommitments));
  const safeToSpendToday =
    safeToSpendThisMonth > 0 ? roundMoney(safeToSpendThisMonth / remainingDaysInMonth) : 0;

  const weekDaysFraction = Math.min(remainingDaysInWeek, remainingDaysInMonth);
  const safeToSpendThisWeek =
    safeToSpendThisMonth > 0
      ? roundMoney(safeToSpendToday * weekDaysFraction)
      : 0;

  const safeToSpendPeriod =
    params.preferences.period === 'day'
      ? safeToSpendToday
      : params.preferences.period === 'week'
      ? safeToSpendThisWeek
      : safeToSpendThisMonth;

  // Budget awareness (non-double-subtracted informational metric)
  const monthBudgetLimitTotal = params.budgets.reduce((s, b) => s + Math.max(0, Number(b.monthly_limit) || 0), 0);
  const remainingBudgetTotal =
    monthBudgetLimitTotal > 0 ? Math.round((monthBudgetLimitTotal - monthSpentTotal) * 100) / 100 : null;

  const warnings: string[] = [];
  if (params.availableBalance < 0) {
    warnings.push('Your available balance is currently negative.');
  }
  if (safeToSpendThisMonth < 0) {
    warnings.push(
      `Upcoming commitments exceed your available balance by ₹${Math.abs(safeToSpendThisMonth).toLocaleString('en-IN')}.`
    );
  } else if (remainingBudgetTotal !== null && remainingBudgetTotal < 0) {
    warnings.push(
      `You have exceeded your monthly category budgets by ₹${Math.abs(remainingBudgetTotal).toLocaleString('en-IN')}.`
    );
  }

  let status: SafeToSpendResult['status'] = 'healthy';
  if (safeToSpendThisMonth <= 0) status = 'deficit';
  else if (safeToSpendToday < 200 || (effectiveBalance > 0 && safeToSpendThisMonth / effectiveBalance < 0.2)) {
    status = 'caution';
  }

  const breakdown: SafeToSpendBreakdownItem[] = [
    {
      key: 'available_balance',
      label: 'Available Balance',
      amount: Math.round(params.availableBalance * 100) / 100,
      description: 'Current tracked liquid balance after recorded transactions',
    },
    ...(expectedIncomeBoost > 0
      ? [
          {
            key: 'expected_income',
            label: 'Expected Remaining Income',
            amount: expectedIncomeBoost,
            description: 'Optional expected inflow enabled in preferences',
          },
        ]
      : []),
    {
      key: 'upcoming_bills',
      label: 'Upcoming Unpaid Bills',
      amount: -upcomingBillsCommitment,
      description: `${upcomingBillsList.length} unpaid bill(s) remaining this cycle`,
    },
    {
      key: 'reserved_savings',
      label: 'Reserved Savings Goal Allocation',
      amount: -reservedSavings,
      description: 'Protected monthly savings commitment',
    },
    {
      key: 'essential_reserve',
      label: 'Essential Spending Reserve',
      amount: -essentialReserve,
      description: 'Protected buffer for groceries, transit, and essentials',
    },
    {
      key: 'emergency_min_reserve',
      label: 'Emergency & Min Balance Buffer',
      amount: -(emergencyReserve + minimumBalanceReserve),
      description: 'Protected floor balance that should not be spent',
    },
  ];

  const explanation =
    safeToSpendThisMonth <= 0
      ? `After protecting ₹${totalCommitments.toLocaleString('en-IN')} in bills and reserves against ₹${effectiveBalance.toLocaleString('en-IN')}, there is currently no discretionary safe-to-spend buffer for the remaining ${remainingDaysInMonth} day(s) of the month.`
      : `Dividing your ₹${safeToSpendThisMonth.toLocaleString('en-IN')} monthly safe buffer across the ${remainingDaysInMonth} remaining day(s) gives ₹${safeToSpendToday.toLocaleString('en-IN')} per day.`;

  return {
    hasSufficientData: true,
    availableBalance: Math.round(params.availableBalance * 100) / 100,
    effectiveBalance,
    upcomingBillsCommitment,
    upcomingBillsList,
    reservedSavings,
    essentialReserve,
    emergencyReserve,
    minimumBalanceReserve,
    totalCommitments,
    safeToSpendPeriod,
    safeToSpendToday,
    safeToSpendThisWeek,
    safeToSpendThisMonth,
    remainingDaysInMonth,
    remainingBudgetTotal,
    monthBudgetLimitTotal: Math.round(monthBudgetLimitTotal * 100) / 100,
    monthSpentTotal: Math.round(monthSpentTotal * 100) / 100,
    status,
    explanation,
    warnings,
    breakdown,
  };
}

// ============================================================================
// FEATURE 4: SMART ALERTS ENGINE (With Deduplication & Quiet Hours)
// ============================================================================

export type SmartAlertCategory = 'budget' | 'bills' | 'spending' | 'savings' | 'udhar';
export type SmartAlertSeverity = 'info' | 'warning' | 'critical' | 'success';

export interface SmartAlertPreferences {
  enabled: boolean;
  budgetEnabled: boolean;
  budgetThresholds: number[]; // e.g., [50, 75, 90, 100]
  spendingAnomalyEnabled: boolean;
  billsEnabled: boolean;
  billNoticeDays: number[]; // e.g., [7, 3, 1, 0]
  lowBalanceEnabled: boolean;
  lowBalanceThreshold: number;
  savingsMilestonesEnabled: boolean;
  udharRemindersEnabled: boolean;
  quietHoursEnabled: boolean;
  quietHoursStart: string; // "22:00"
  quietHoursEnd: string; // "07:00"
}

export const DEFAULT_SMART_ALERT_PREFS: SmartAlertPreferences = {
  enabled: true,
  budgetEnabled: true,
  budgetThresholds: [50, 75, 90, 100],
  spendingAnomalyEnabled: true,
  billsEnabled: true,
  billNoticeDays: [7, 3, 1, 0],
  lowBalanceEnabled: true,
  lowBalanceThreshold: 2000,
  savingsMilestonesEnabled: true,
  udharRemindersEnabled: true,
  quietHoursEnabled: false,
  quietHoursStart: '22:00',
  quietHoursEnd: '07:00',
};

export interface SmartAlertItem {
  id: string;
  dedupeKey: string;
  category: SmartAlertCategory;
  severity: SmartAlertSeverity;
  title: string;
  message: string;
  metricValue?: string;
  actionTab: string;
  actionLabel: string;
  createdAt: string;
  isRead: boolean;
  isDismissed: boolean;
}

export interface SmartAlertEventState {
  readKeys: string[];
  dismissedKeys: string[];
}

export interface UdharAlertInput {
  id: string;
  counterpart_name: string;
  direction: 'gave' | 'took';
  current_balance: number;
  due_date?: string | null;
  status: string;
}

export function isWithinQuietHours(prefs: SmartAlertPreferences, referenceDate: Date = new Date()): boolean {
  if (!prefs.quietHoursEnabled) return false;
  const parseMin = (hhmm: string) => {
    const [h, m] = String(hhmm || '00:00').split(':').map(Number);
    return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
  };
  const start = parseMin(prefs.quietHoursStart);
  const end = parseMin(prefs.quietHoursEnd);
  const current = referenceDate.getHours() * 60 + referenceDate.getMinutes();

  if (start === end) return false;
  if (start < end) {
    return current >= start && current < end;
  }
  // Overnight quiet hours (e.g. 22:00 to 07:00)
  return current >= start || current < end;
}

export function evaluateSmartAlerts(params: {
  transactions: Transaction[];
  availableBalance: number;
  budgets: UserBudget[];
  recurringBills: RecurringBill[];
  savingsGoals: SavingsGoal[];
  udharRecords?: UdharAlertInput[];
  preferences: SmartAlertPreferences;
  eventState?: SmartAlertEventState;
  referenceDate?: Date;
}): SmartAlertItem[] {
  const preferences: SmartAlertPreferences = {
    ...DEFAULT_SMART_ALERT_PREFS,
    ...(params.preferences || {}),
  };
  if (!preferences.enabled) return [];

  const now = params.referenceDate || new Date();
  const todayKey = formatLocalDateKey(now);
  const monthPrefix = todayKey.slice(0, 7);
  const readSet = new Set(params.eventState?.readKeys || []);
  const dismissedSet = new Set(params.eventState?.dismissedKeys || []);
  const alerts: SmartAlertItem[] = [];
  const seenDedupeKeys = new Set<string>();

  const pushAlert = (item: Omit<SmartAlertItem, 'id' | 'isRead' | 'isDismissed' | 'createdAt'>) => {
    if (seenDedupeKeys.has(item.dedupeKey)) return;
    if (dismissedSet.has(item.dedupeKey)) return;
    seenDedupeKeys.add(item.dedupeKey);
    alerts.push({
      ...item,
      id: item.dedupeKey,
      createdAt: now.toISOString(),
      isRead: readSet.has(item.dedupeKey),
      isDismissed: false,
    });
  };

  const activeExpenses = params.transactions.filter((t) => isExpenseTransaction(t));
  const currentMonthExpenses = activeExpenses.filter((t) =>
    String(t.transaction_date || '').startsWith(monthPrefix)
  );

  // 1. BUDGET THRESHOLD ALERTS (only triggers highest crossed threshold per budget per month to avoid spam)
  if (preferences.budgetEnabled && params.budgets.length > 0) {
    const sortedThresholds = [...preferences.budgetThresholds].sort((a, b) => b - a);
    for (const budget of params.budgets) {
      const limit = Number(budget.monthly_limit) || 0;
      if (limit <= 0) continue;
      const catKey = String(budget.category || '').toLowerCase();
      const spent = currentMonthExpenses
        .filter((t) => t.category.toLowerCase() === catKey || String(t.subcategory || '').toLowerCase() === catKey)
        .reduce((sum, t) => sum + (Number(t.amount) || 0), 0);

      const pct = (spent / limit) * 100;
      const crossed = sortedThresholds.find((th) => pct >= th);
      if (crossed !== undefined) {
        const roundedPct = Math.round(pct);
        const severity: SmartAlertSeverity = crossed >= 100 ? 'critical' : crossed >= 75 ? 'warning' : 'info';
        pushAlert({
          dedupeKey: `budget:${budget.id}:${monthPrefix}:${crossed}`,
          category: 'budget',
          severity,
          title:
            crossed >= 100
              ? `${budget.category.toUpperCase()} budget exceeded (${roundedPct}%)`
              : `${budget.category.toUpperCase()} budget at ${roundedPct}%`,
          message: `You have spent ₹${spent.toLocaleString('en-IN')} out of your ₹${limit.toLocaleString('en-IN')} monthly ${budget.category} limit.`,
          metricValue: `${roundedPct}%`,
          actionTab: 'budget',
          actionLabel: 'Review Budget',
        });
      }
    }
  }

  // 2. OVERSPENDING ANOMALY ALERTS (requires >= 5 historical spending days to avoid noise)
  if (preferences.spendingAnomalyEnabled) {
    const dailyMap = new Map<string, number>();
    for (const tx of activeExpenses) {
      const dk = String(tx.transaction_date || '').slice(0, 10);
      if (!dk) continue;
      dailyMap.set(dk, (dailyMap.get(dk) || 0) + (Number(tx.amount) || 0));
    }

    const historicalDays = Array.from(dailyMap.entries()).filter(([dk]) => dk < todayKey);
    const todaySpend = dailyMap.get(todayKey) || 0;

    if (historicalDays.length >= 5 && todaySpend > 0) {
      const avgDaily = historicalDays.reduce((s, [, v]) => s + v, 0) / historicalDays.length;
      if (avgDaily > 0 && todaySpend >= avgDaily * 2 && todaySpend - avgDaily >= 300) {
        const ratio = (todaySpend / avgDaily).toFixed(1);
        pushAlert({
          dedupeKey: `spending_spike:${todayKey}`,
          category: 'spending',
          severity: 'warning',
          title: `Unusually high spending today (${ratio}x daily avg)`,
          message: `Today's expenses (₹${todaySpend.toLocaleString('en-IN')}) are ${ratio}x your historical daily average of ₹${Math.round(avgDaily).toLocaleString('en-IN')}.`,
          metricValue: `₹${todaySpend.toLocaleString('en-IN')}`,
          actionTab: 'expense_calendar',
          actionLabel: 'Open Calendar',
        });
      }
    }
  }

  // 3. LOW BALANCE ALERT
  if (
    preferences.lowBalanceEnabled &&
    params.transactions.filter((t) => !t.is_deleted).length > 0 &&
    params.availableBalance <= preferences.lowBalanceThreshold
  ) {
    pushAlert({
      dedupeKey: `low_balance:${monthPrefix}:${preferences.lowBalanceThreshold}`,
      category: 'spending',
      severity: params.availableBalance < 0 ? 'critical' : 'warning',
      title:
        params.availableBalance < 0
          ? 'Negative available balance detected'
          : 'Low available balance warning',
      message: `Your available balance is ₹${params.availableBalance.toLocaleString('en-IN')}, below your ₹${preferences.lowBalanceThreshold.toLocaleString('en-IN')} safety threshold.`,
      metricValue: `₹${params.availableBalance.toLocaleString('en-IN')}`,
      actionTab: 'safe_to_spend',
      actionLabel: 'Check Safe-to-Spend',
    });
  }

  // 4. UPCOMING RECURRING BILLS
  if (preferences.billsEnabled && params.recurringBills.length > 0) {
    const noticeBuckets = [...preferences.billNoticeDays].sort((a, b) => a - b);
    const maxNotice = noticeBuckets.length > 0 ? Math.max(...noticeBuckets) : 7;

    for (const bill of params.recurringBills) {
      if (!bill.is_active || !bill.reminder_enabled) continue;
      if (isBillPaidForCycle(bill, now)) continue;
      const daysUntil = getBillDaysUntilDue(bill, now);

      if (daysUntil < 0) {
        pushAlert({
          dedupeKey: `bill:${bill.id}:${monthPrefix}:overdue`,
          category: 'bills',
          severity: 'critical',
          title: `Bill overdue: ${bill.title}`,
          message: `₹${Number(bill.amount).toLocaleString('en-IN')} was due ${Math.abs(daysUntil)} day(s) ago (day ${bill.due_day}).`,
          metricValue: `₹${Number(bill.amount).toLocaleString('en-IN')}`,
          actionTab: 'recurring_bills',
          actionLabel: 'Manage Bills',
        });
      } else if (daysUntil <= maxNotice) {
        const matchedBucket = noticeBuckets.find((d) => daysUntil <= d) ?? maxNotice;
        pushAlert({
          dedupeKey: `bill:${bill.id}:${monthPrefix}:due_${matchedBucket}`,
          category: 'bills',
          severity: daysUntil <= 1 ? 'warning' : 'info',
          title:
            daysUntil === 0
              ? `Bill due today: ${bill.title}`
              : `Upcoming bill in ${daysUntil} day${daysUntil === 1 ? '' : 's'}: ${bill.title}`,
          message: `₹${Number(bill.amount).toLocaleString('en-IN')} is scheduled for day ${bill.due_day} this cycle.`,
          metricValue: `₹${Number(bill.amount).toLocaleString('en-IN')}`,
          actionTab: 'recurring_bills',
          actionLabel: 'Pay / View Bill',
        });
      }
    }
  }

  // 5. SAVINGS GOAL MILESTONES (25%, 50%, 75%, 100%)
  if (preferences.savingsMilestonesEnabled && params.savingsGoals.length > 0) {
    const milestones = [100, 75, 50, 25];
    for (const goal of params.savingsGoals) {
      const target = Number(goal.target_amount) || 0;
      const current = Number(goal.current_amount) || 0;
      if (target <= 0 || current <= 0) continue;
      const pct = (current / target) * 100;
      const hit = milestones.find((m) => pct >= m);
      if (hit !== undefined) {
        pushAlert({
          dedupeKey: `savings:${goal.id}:milestone_${hit}`,
          category: 'savings',
          severity: hit === 100 ? 'success' : 'info',
          title:
            hit === 100
              ? `Savings goal reached: ${goal.title}!`
              : `${hit}% milestone reached on ${goal.title}`,
          message: `You have saved ₹${current.toLocaleString('en-IN')} toward your ₹${target.toLocaleString('en-IN')} goal.`,
          metricValue: `${Math.min(100, Math.round(pct))}%`,
          actionTab: 'savings_goals',
          actionLabel: 'View Goal',
        });
      }
    }
  }

  // 6. UDHAR / PEOPLE REMINDERS
  if (preferences.udharRemindersEnabled && params.udharRecords && params.udharRecords.length > 0) {
    const todayMid = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
    for (const rec of params.udharRecords) {
      if (
        rec.status === 'settled' ||
        rec.status === 'cancelled' ||
        rec.status === 'rejected' ||
        rec.status === 'deleted' ||
        rec.status === 'pending_confirmation' ||
        rec.current_balance <= 0
      ) {
        continue;
      }
      if (rec.due_date) {
        const parts = parseDateKeyToParts(rec.due_date);
        if (!parts) continue;
        const dueMid = new Date(parts.year, parts.month - 1, parts.day).getTime();
        const diffDays = Math.round((dueMid - todayMid) / (1000 * 60 * 60 * 24));
        if (diffDays < 0) {
          pushAlert({
            dedupeKey: `udhar:${rec.id}:overdue:${rec.due_date}`,
            category: 'udhar',
            severity: 'critical',
            title: `Overdue Udhar with ${rec.counterpart_name}`,
            message: `${rec.direction === 'gave' ? 'Receivable' : 'Payable'} balance of ₹${rec.current_balance.toLocaleString('en-IN')} was due on ${rec.due_date}.`,
            metricValue: `₹${rec.current_balance.toLocaleString('en-IN')}`,
            actionTab: 'people',
            actionLabel: 'Open People',
          });
        } else if (diffDays <= 3) {
          pushAlert({
            dedupeKey: `udhar:${rec.id}:due_soon:${rec.due_date}`,
            category: 'udhar',
            severity: 'warning',
            title:
              diffDays === 0
                ? `Udhar due today: ${rec.counterpart_name}`
                : `Udhar due in ${diffDays} day(s): ${rec.counterpart_name}`,
            message: `${rec.direction === 'gave' ? 'To receive' : 'To pay'}: ₹${rec.current_balance.toLocaleString('en-IN')}.`,
            metricValue: `₹${rec.current_balance.toLocaleString('en-IN')}`,
            actionTab: 'people',
            actionLabel: 'Open People',
          });
        }
      }
    }
  }

  // Sort: critical first, then warning, then success/info
  const sevWeight: Record<SmartAlertSeverity, number> = {
    critical: 0,
    warning: 1,
    info: 2,
    success: 3,
  };

  return alerts.sort((a, b) => {
    if (a.isRead !== b.isRead) return a.isRead ? 1 : -1;
    return sevWeight[a.severity] - sevWeight[b.severity];
  });
}

// ============================================================================
// FEATURE 5: RECEIPT VALIDATION & DUPLICATE DETECTION ENGINE
// ============================================================================

export const ALLOWED_RECEIPT_MIME_TYPES = ['image/jpeg', 'image/jpg', 'image/png', 'image/webp'];
export const MAX_RECEIPT_FILE_BYTES = 5 * 1024 * 1024; // 5 MB

export interface ReceiptValidationResult {
  valid: boolean;
  error?: string;
}

export function validateReceiptUpload(mimeType: string, sizeBytes: number): ReceiptValidationResult {
  const normalizedMime = String(mimeType || '').toLowerCase().trim();
  if (!ALLOWED_RECEIPT_MIME_TYPES.includes(normalizedMime)) {
    return {
      valid: false,
      error: 'Unsupported file format. Please upload a JPG, PNG, or WEBP receipt image.',
    };
  }
  if (!Number.isFinite(sizeBytes) || sizeBytes <= 0) {
    return { valid: false, error: 'Selected file is empty.' };
  }
  if (sizeBytes > MAX_RECEIPT_FILE_BYTES) {
    return {
      valid: false,
      error: 'Receipt image exceeds the 5 MB limit. Please upload a smaller or compressed image.',
    };
  }
  return { valid: true };
}

/**
 * Validates the actual binary magic-byte signature of a base64-encoded image
 * so spoofed HTML/SVG/script/executable payloads renamed as .jpg/.png/.webp are rejected.
 */
export function validateReceiptFileSignature(
  base64Data: string,
  declaredMimeType: string
): ReceiptValidationResult {
  const cleanB64 = String(base64Data || '').replace(/\s+/g, '');
  if (cleanB64.length < 16) {
    return { valid: false, error: 'Uploaded receipt file is corrupted or incomplete.' };
  }

  let bytes: Uint8Array;
  try {
    const headerSlice = cleanB64.slice(0, 32);
    if (typeof Buffer !== 'undefined') {
      bytes = new Uint8Array(Buffer.from(headerSlice, 'base64'));
    } else {
      const bin = atob(headerSlice);
      bytes = new Uint8Array(bin.length);
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    }
  } catch {
    return { valid: false, error: 'Invalid base64 image payload.' };
  }

  if (bytes.length < 12) {
    return { valid: false, error: 'Uploaded file is too small to be a valid image.' };
  }

  const isJpeg = bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  const isPng =
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47 &&
    bytes[4] === 0x0d &&
    bytes[5] === 0x0a &&
    bytes[6] === 0x1a &&
    bytes[7] === 0x0a;
  const isWebp =
    bytes[0] === 0x52 &&
    bytes[1] === 0x49 &&
    bytes[2] === 0x46 &&
    bytes[3] === 0x46 &&
    bytes[8] === 0x57 &&
    bytes[9] === 0x45 &&
    bytes[10] === 0x42 &&
    bytes[11] === 0x50;

  const mime = String(declaredMimeType || '').toLowerCase().trim();
  if ((mime === 'image/jpeg' || mime === 'image/jpg') && isJpeg) return { valid: true };
  if (mime === 'image/png' && isPng) return { valid: true };
  if (mime === 'image/webp' && isWebp) return { valid: true };

  return {
    valid: false,
    error: 'File content signature does not match a valid JPG, PNG, or WEBP image. Upload rejected for security.',
  };
}

export interface ReceiptOcrExtraction {
  merchant: string;
  receiptDate: string; // YYYY-MM-DD or ''
  receiptTime: string; // HH:MM or ''
  totalAmount: number | null;
  subtotal: number | null;
  tax: number | null;
  discount: number | null;
  paymentMethod: string;
  receiptNumber: string;
  items: Array<{ name: string; quantity?: number; price?: number }>;
  confidence: number; // 0-1
  rawNotes?: string;
}

export interface DuplicateReceiptMatch {
  isDuplicate: boolean;
  reason?: string;
  matchedTransactionId?: string;
  matchedTitle?: string;
  matchedDate?: string;
  matchedAmount?: number;
}

export function detectDuplicateReceipt(params: {
  extraction: Pick<ReceiptOcrExtraction, 'merchant' | 'receiptDate' | 'totalAmount' | 'receiptNumber'>;
  fileHash?: string;
  existingTransactions: Transaction[];
  knownReceiptHashes?: Array<{ file_hash: string; receipt_number?: string; merchant?: string; amount?: number; receipt_date?: string }>;
}): DuplicateReceiptMatch {
  const { extraction, fileHash, existingTransactions, knownReceiptHashes = [] } = params;

  // 1. Exact file hash match
  if (fileHash) {
    const hashHit = knownReceiptHashes.find((r) => r.file_hash && r.file_hash === fileHash);
    if (hashHit) {
      return {
        isDuplicate: true,
        reason: 'This exact receipt image was already scanned earlier.',
        matchedTitle: hashHit.merchant,
        matchedDate: hashHit.receipt_date,
        matchedAmount: hashHit.amount,
      };
    }
  }

  // 2. Receipt number match
  const cleanReceiptNo = String(extraction.receiptNumber || '').trim().toLowerCase();
  if (cleanReceiptNo.length >= 4) {
    const recHit = knownReceiptHashes.find(
      (r) => r.receipt_number && r.receipt_number.trim().toLowerCase() === cleanReceiptNo
    );
    if (recHit) {
      return {
        isDuplicate: true,
        reason: `Receipt #${extraction.receiptNumber} already exists in your records.`,
        matchedTitle: recHit.merchant,
        matchedDate: recHit.receipt_date,
        matchedAmount: recHit.amount,
      };
    }
  }

  // 3. Existing transaction match (same amount within ₹1, date within ±1 day, similar merchant)
  const targetAmount = Number(extraction.totalAmount);
  const targetMerchant = normalizeMerchantKey(extraction.merchant);
  const targetParts = parseDateKeyToParts(extraction.receiptDate);

  if (Number.isFinite(targetAmount) && targetAmount > 0 && targetParts) {
    const targetMs = new Date(targetParts.year, targetParts.month - 1, targetParts.day).getTime();

    for (const tx of existingTransactions) {
      if (tx.is_deleted || tx.category === 'people') continue;
      const amtDiff = Math.abs((Number(tx.amount) || 0) - targetAmount);
      if (amtDiff > 1) continue;

      const txParts = parseDateKeyToParts(tx.transaction_date);
      if (!txParts) continue;
      const txMs = new Date(txParts.year, txParts.month - 1, txParts.day).getTime();
      const dayDiff = Math.abs(txMs - targetMs) / (1000 * 60 * 60 * 24);
      if (dayDiff > 1) continue;

      const txText = normalizeMerchantKey(
        [tx.title, tx.description, tx.metadata?.spent_at, tx.metadata?.restaurant_name, tx.metadata?.receipt_number]
          .filter(Boolean)
          .join(' ')
      );

      const merchantMatch =
        !targetMerchant ||
        txText.includes(targetMerchant) ||
        targetMerchant.split(' ').some((w) => w.length >= 4 && txText.includes(w));

      if (merchantMatch) {
        return {
          isDuplicate: true,
          reason: `Matches existing transaction "${tx.title}" of ₹${Number(tx.amount).toLocaleString('en-IN')} on ${tx.transaction_date}.`,
          matchedTransactionId: tx.id,
          matchedTitle: tx.title,
          matchedDate: tx.transaction_date,
          matchedAmount: Number(tx.amount),
        };
      }
    }
  }

  return { isDuplicate: false };
}

// ============================================================================
// FEATURE 1: AI MONEY ASSISTANT — READ-ONLY FINANCIAL CONTEXT AGGREGATOR
// ============================================================================

export interface AiFinancialContextSnapshot {
  asOfDate: string;
  currency: 'INR';
  totals: {
    allTimeIncome: number;
    allTimeExpenses: number;
    allTimeBorrowed: number;
    availableBalance: number;
    thisMonthIncome: number;
    thisMonthExpenses: number;
    lastMonthIncome: number;
    lastMonthExpenses: number;
    thisMonthNetFlow: number;
    monthOverMonthExpenseDelta: number;
    monthOverMonthExpensePercent: number | null;
    totalTransactionCount: number;
  };
  topExpenseCategoriesThisMonth: Array<{ category: string; amount: number; sharePercent: number; count: number }>;
  topExpenseCategoriesAllTime: Array<{ category: string; amount: number; count: number }>;
  biggestExpenseThisMonth: { title: string; amount: number; date: string; category: string } | null;
  monthlyTrendLast6Months: Array<{ month: string; income: number; expenses: number; net: number }>;
  budgets: Array<{ category: string; monthlyLimit: number; spentThisMonth: number; remaining: number; percentUsed: number }>;
  upcomingBills: Array<{ title: string; amount: number; dueDay: number; daysUntilDue: number; isPaidThisCycle: boolean }>;
  savingsGoals: Array<{ title: string; currentAmount: number; targetAmount: number; progressPercent: number; targetDate?: string | null }>;
  udharSummary: {
    totalReceivable: number;
    totalPayable: number;
    netUdharBalance: number;
    activePeopleCount: number;
  };
  netWorthSummary?: {
    totalAssets: number;
    totalLiabilities: number;
    netWorth: number;
  };
  safeToSpendSummary?: {
    hasSufficientData: boolean;
    safeToSpendToday: number;
    safeToSpendThisWeek: number;
    safeToSpendThisMonth: number;
    upcomingBillsCommitment: number;
  };
  recentTransactions: Array<{
    date: string;
    title: string;
    category: string;
    type: string;
    amount: number;
  }>;
}

export function buildAiFinancialContext(params: {
  transactions: Transaction[];
  availableBalance: number;
  budgets: UserBudget[];
  recurringBills: RecurringBill[];
  savingsGoals: SavingsGoal[];
  udharReceivable: number;
  udharPayable: number;
  activePeopleCount: number;
  netWorth?: NetWorthCalculationResult | null;
  safeToSpend?: SafeToSpendResult | null;
  referenceDate?: Date;
}): AiFinancialContextSnapshot {
  const now = params.referenceDate || new Date();
  const todayKey = formatLocalDateKey(now);
  const year = now.getFullYear();
  const month = now.getMonth() + 1;
  const thisMonthPrefix = `${year}-${String(month).padStart(2, '0')}`;
  const prevYear = month === 1 ? year - 1 : year;
  const prevMonth = month === 1 ? 12 : month - 1;
  const lastMonthPrefix = `${prevYear}-${String(prevMonth).padStart(2, '0')}`;

  const activeTxs = params.transactions.filter((t) => !t.is_deleted);

  let allTimeIncome = 0;
  let allTimeExpenses = 0;
  let allTimeBorrowed = 0;
  let thisMonthIncome = 0;
  let thisMonthExpenses = 0;
  let lastMonthIncome = 0;
  let lastMonthExpenses = 0;

  const thisMonthCatMap = new Map<string, { amount: number; count: number }>();
  const allTimeCatMap = new Map<string, { amount: number; count: number }>();
  let biggestExpenseThisMonth: AiFinancialContextSnapshot['biggestExpenseThisMonth'] = null;

  // Prepare last 6 months map
  const trendMap = new Map<string, { income: number; expenses: number }>();
  const last6Keys: string[] = [];
  for (let i = 5; i >= 0; i--) {
    const d = new Date(year, month - 1 - i, 1);
    const mk = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
    last6Keys.push(mk);
    trendMap.set(mk, { income: 0, expenses: 0 });
  }

  for (const tx of activeTxs) {
    const amt = Number(tx.amount) || 0;
    const dk = String(tx.transaction_date || '').slice(0, 10);
    const mk = dk.slice(0, 7);

    if (isBorrowedTransaction(tx)) {
      allTimeBorrowed += amt;
      continue;
    }

    if (isEarnedOrOtherIncomeTransaction(tx)) {
      allTimeIncome += amt;
      if (mk === thisMonthPrefix) thisMonthIncome += amt;
      if (mk === lastMonthPrefix) lastMonthIncome += amt;
      const trendBucket = trendMap.get(mk);
      if (trendBucket) trendBucket.income += amt;
    } else if (isExpenseTransaction(tx)) {
      allTimeExpenses += amt;
      const catLabel = getDisplayCategoryLabel(tx.category, tx.subcategory);
      const prevAll = allTimeCatMap.get(catLabel) || { amount: 0, count: 0 };
      prevAll.amount += amt;
      prevAll.count += 1;
      allTimeCatMap.set(catLabel, prevAll);

      if (mk === thisMonthPrefix) {
        thisMonthExpenses += amt;
        const prevMonthCat = thisMonthCatMap.get(catLabel) || { amount: 0, count: 0 };
        prevMonthCat.amount += amt;
        prevMonthCat.count += 1;
        thisMonthCatMap.set(catLabel, prevMonthCat);

        if (!biggestExpenseThisMonth || amt > biggestExpenseThisMonth.amount) {
          biggestExpenseThisMonth = {
            title: tx.title,
            amount: amt,
            date: dk,
            category: catLabel,
          };
        }
      }
      if (mk === lastMonthPrefix) lastMonthExpenses += amt;
      const trendBucket = trendMap.get(mk);
      if (trendBucket) trendBucket.expenses += amt;
    }
  }

  const topExpenseCategoriesThisMonth = Array.from(thisMonthCatMap.entries())
    .map(([category, v]) => ({
      category,
      amount: Math.round(v.amount * 100) / 100,
      sharePercent: thisMonthExpenses > 0 ? Math.round((v.amount / thisMonthExpenses) * 1000) / 10 : 0,
      count: v.count,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const topExpenseCategoriesAllTime = Array.from(allTimeCatMap.entries())
    .map(([category, v]) => ({
      category,
      amount: Math.round(v.amount * 100) / 100,
      count: v.count,
    }))
    .sort((a, b) => b.amount - a.amount)
    .slice(0, 8);

  const monthlyTrendLast6Months = last6Keys.map((mk) => {
    const b = trendMap.get(mk) || { income: 0, expenses: 0 };
    return {
      month: mk,
      income: Math.round(b.income * 100) / 100,
      expenses: Math.round(b.expenses * 100) / 100,
      net: Math.round((b.income - b.expenses) * 100) / 100,
    };
  });

  const budgets = params.budgets.map((b) => {
    const catKey = String(b.category || '').toLowerCase();
    const spent = activeTxs
      .filter(
        (t) =>
          isExpenseTransaction(t) &&
          String(t.transaction_date || '').startsWith(thisMonthPrefix) &&
          (t.category.toLowerCase() === catKey || String(t.subcategory || '').toLowerCase() === catKey)
      )
      .reduce((s, t) => s + (Number(t.amount) || 0), 0);
    const limit = Number(b.monthly_limit) || 0;
    return {
      category: b.category,
      monthlyLimit: limit,
      spentThisMonth: Math.round(spent * 100) / 100,
      remaining: Math.round((limit - spent) * 100) / 100,
      percentUsed: limit > 0 ? Math.round((spent / limit) * 1000) / 10 : 0,
    };
  });

  const upcomingBills = params.recurringBills
    .filter((b) => b.is_active)
    .map((b) => ({
      title: b.title,
      amount: Number(b.amount) || 0,
      dueDay: b.due_day,
      daysUntilDue: getBillDaysUntilDue(b, now),
      isPaidThisCycle: isBillPaidForCycle(b, now),
    }))
    .sort((a, b) => a.daysUntilDue - b.daysUntilDue)
    .slice(0, 12);

  const savingsGoals = params.savingsGoals.map((g) => ({
    title: g.title,
    currentAmount: Number(g.current_amount) || 0,
    targetAmount: Number(g.target_amount) || 0,
    progressPercent:
      g.target_amount > 0 ? Math.round(((Number(g.current_amount) || 0) / Number(g.target_amount)) * 1000) / 10 : 0,
    targetDate: g.target_date,
  }));

  const recentTransactions = [...activeTxs]
    .filter((t) => t.category !== 'people' && !isTransferTransaction(t))
    .sort((a, b) => String(b.transaction_date || '').localeCompare(String(a.transaction_date || '')))
    .slice(0, 20)
    .map((t) => ({
      date: String(t.transaction_date || '').slice(0, 10),
      title: t.title,
      category: getDisplayCategoryLabel(t.category, t.subcategory),
      type: isExpenseTransaction(t) ? 'expense' : isBorrowedTransaction(t) ? 'borrowed' : 'income',
      amount: Number(t.amount) || 0,
    }));

  const momDelta = Math.round((thisMonthExpenses - lastMonthExpenses) * 100) / 100;
  const momPercent =
    lastMonthExpenses > 0 ? Math.round(((momDelta / lastMonthExpenses) * 100) * 10) / 10 : null;

  return {
    asOfDate: todayKey,
    currency: 'INR',
    totals: {
      allTimeIncome: Math.round(allTimeIncome * 100) / 100,
      allTimeExpenses: Math.round(allTimeExpenses * 100) / 100,
      allTimeBorrowed: Math.round(allTimeBorrowed * 100) / 100,
      availableBalance: Math.round(params.availableBalance * 100) / 100,
      thisMonthIncome: Math.round(thisMonthIncome * 100) / 100,
      thisMonthExpenses: Math.round(thisMonthExpenses * 100) / 100,
      lastMonthIncome: Math.round(lastMonthIncome * 100) / 100,
      lastMonthExpenses: Math.round(lastMonthExpenses * 100) / 100,
      thisMonthNetFlow: Math.round((thisMonthIncome - thisMonthExpenses) * 100) / 100,
      monthOverMonthExpenseDelta: momDelta,
      monthOverMonthExpensePercent: momPercent,
      totalTransactionCount: activeTxs.length,
    },
    topExpenseCategoriesThisMonth,
    topExpenseCategoriesAllTime,
    biggestExpenseThisMonth,
    monthlyTrendLast6Months,
    budgets,
    upcomingBills,
    savingsGoals,
    udharSummary: {
      totalReceivable: Math.round(params.udharReceivable * 100) / 100,
      totalPayable: Math.round(params.udharPayable * 100) / 100,
      netUdharBalance: Math.round((params.udharReceivable - params.udharPayable) * 100) / 100,
      activePeopleCount: params.activePeopleCount,
    },
    netWorthSummary: params.netWorth
      ? {
          totalAssets: params.netWorth.totalAssets,
          totalLiabilities: params.netWorth.totalLiabilities,
          netWorth: params.netWorth.netWorth,
        }
      : undefined,
    safeToSpendSummary: params.safeToSpend
      ? {
          hasSufficientData: params.safeToSpend.hasSufficientData,
          safeToSpendToday: params.safeToSpend.safeToSpendToday,
          safeToSpendThisWeek: params.safeToSpend.safeToSpendThisWeek,
          safeToSpendThisMonth: params.safeToSpend.safeToSpendThisMonth,
          upcomingBillsCommitment: params.safeToSpend.upcomingBillsCommitment,
        }
      : undefined,
    recentTransactions,
  };
}
