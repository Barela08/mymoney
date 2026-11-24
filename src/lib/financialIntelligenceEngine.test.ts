import test from 'node:test';
import assert from 'node:assert/strict';
import {
  toPaise,
  fromPaise,
  roundMoney,
  categorizeTransactionDeterministic,
  upsertUserCategorizationRule,
  buildExpenseCalendarMonth,
  calculateNetWorth,
  upsertNetWorthSnapshot,
  calculateSafeToSpend,
  DEFAULT_SAFE_TO_SPEND_PREFS,
  evaluateSmartAlerts,
  DEFAULT_SMART_ALERT_PREFS,
  isWithinQuietHours,
  validateReceiptUpload,
  validateReceiptFileSignature,
  detectDuplicateReceipt,
  buildAiFinancialContext,
} from './financialIntelligenceEngine';
import type { Transaction } from '../types';
import type { UserBudget, RecurringBill, SavingsGoal } from './financialFeaturesApi';

function makeTx(partial: Partial<Transaction>): Transaction {
  return {
    id: partial.id || `tx_${Math.random().toString(36).slice(2, 7)}`,
    category: partial.category || 'other',
    subcategory: partial.subcategory || 'other_general',
    transaction_type: partial.transaction_type || 'expense',
    amount: partial.amount ?? 100,
    title: partial.title || 'Sample Tx',
    description: partial.description || '',
    transaction_date: partial.transaction_date || '2026-11-15',
    transaction_time: partial.transaction_time || '12:00:00',
    metadata: partial.metadata || {},
    created_at: partial.created_at || '2026-11-15T12:00:00Z',
    updated_at: partial.updated_at || '2026-11-15T12:00:00Z',
    is_deleted: partial.is_deleted || false,
  };
}

// 1. SMART TRANSACTION CATEGORIZATION TESTS
test('Smart Categorization: maps known Indian & global merchants deterministically', () => {
  const swiggy = categorizeTransactionDeterministic({ title: 'Swiggy Dinner Order' });
  assert.ok(swiggy);
  assert.equal(swiggy.category, 'food');
  assert.equal(swiggy.subcategory, 'delivery');
  assert.equal(swiggy.needsAiFallback, false);

  const petrol = categorizeTransactionDeterministic({ merchant: 'HP Petrol Pump' });
  assert.ok(petrol);
  assert.equal(petrol.category, 'other');
  assert.equal(petrol.subcategory, 'travel');

  const salary = categorizeTransactionDeterministic({ title: 'Monthly Salary Credit' });
  assert.ok(salary);
  assert.equal(salary.category, 'home');
  assert.equal(salary.subcategory, 'salary');
  assert.equal(salary.transaction_type, 'income');
});

test('Smart Categorization: prioritizes user-learned rules and prevents duplicates', () => {
  let rules = upsertUserCategorizationRule([], 'Sharma General Store', 'room', 'grocery', 'expense');
  rules = upsertUserCategorizationRule(rules, 'sharma general store', 'room', 'grocery', 'expense');
  assert.equal(rules.length, 1);
  assert.equal(rules[0].usage_count, 2);

  const match = categorizeTransactionDeterministic({ title: 'Sharma General Store bill' }, rules);
  assert.ok(match);
  assert.equal(match.source, 'user_rule');
  assert.equal(match.category, 'room');
  assert.equal(match.subcategory, 'grocery');
});

test('Smart Categorization: flags ambiguous text for AI fallback', () => {
  const unknown = categorizeTransactionDeterministic({ title: 'XYZ Quantum Payment 992' });
  assert.ok(unknown);
  assert.equal(unknown.needsAiFallback, true);
  assert.ok(unknown.confidence < 0.5);
});

// 2. EXPENSE CALENDAR TESTS
test('Expense Calendar: computes daily totals, excludes transfers/udhar, handles month boundaries', () => {
  const txs: Transaction[] = [
    makeTx({ id: '1', category: 'food', subcategory: 'delivery', amount: 450, transaction_date: '2026-11-05' }),
    makeTx({ id: '2', category: 'other', subcategory: 'travel', amount: 150, transaction_date: '2026-11-05' }),
    makeTx({ id: '3', category: 'room', subcategory: 'rent', amount: 8000, transaction_date: '2026-11-01' }),
    makeTx({ id: '4', category: 'home', subcategory: 'salary', transaction_type: 'income', amount: 40000, transaction_date: '2026-11-01' }),
    // Must be excluded from spending
    makeTx({ id: '5', category: 'people', subcategory: 'money_given', amount: 5000, transaction_date: '2026-11-05' }),
    makeTx({ id: '6', category: 'other', subcategory: 'other_general', amount: 2000, transaction_date: '2026-11-05', metadata: { is_transfer: true } }),
    // Previous month for comparison
    makeTx({ id: '7', category: 'food', subcategory: 'snacks', amount: 4000, transaction_date: '2026-10-12' }),
  ];

  const cal = buildExpenseCalendarMonth(txs, 2026, 11);
  assert.equal(cal.monthDaysMap['2026-11-05'].totalExpenses, 600);
  assert.equal(cal.monthDaysMap['2026-11-01'].totalExpenses, 8000);
  assert.equal(cal.monthDaysMap['2026-11-01'].totalIncome, 40000);
  assert.equal(cal.monthDaysMap['2026-11-02'].totalExpenses, 0);
  assert.equal(cal.monthDaysMap['2026-11-02'].intensity, 'none');
  assert.equal(cal.analytics.totalExpenses, 8600);
  assert.equal(cal.analytics.previousMonthExpenses, 4000);
  assert.equal(cal.analytics.highestSpendingDay?.dateKey, '2026-11-01');
  assert.equal(cal.analytics.lowestSpendingDay?.dateKey, '2026-11-05');
});

// 3. NET WORTH TRACKER TESTS
test('Net Worth: strictly computes Assets - Liabilities with inclusion toggles and real snapshots', () => {
  const calc = calculateNetWorth({
    assets: [
      { id: 'a1', name: 'HDFC Savings', category: 'bank_account', current_value: 50000, valuation_date: '2026-11-20', updated_at: '2026-11-20' },
      { id: 'a2', name: 'Gold Coins', category: 'gold', current_value: 30000, valuation_date: '2026-11-20', updated_at: '2026-11-20' },
      { id: 'a3', name: 'Old Archived', category: 'other', current_value: 99999, valuation_date: '2026-11-20', is_archived: true, updated_at: '2026-11-20' },
    ],
    liabilities: [
      { id: 'l1', name: 'Credit Card', category: 'credit_card', current_balance: 15000, valuation_date: '2026-11-20', updated_at: '2026-11-20' },
    ],
    availableBalance: 20000,
    udharReceivable: 5000,
    udharPayable: 2000,
    settings: {
      includeLiquidBalance: true,
      includeUdharReceivables: true,
      includeUdharPayables: true,
    },
  });

  // Assets: 50000 + 30000 + 20000 + 5000 = 105000
  // Liabilities: 15000 + 2000 = 17000
  // Net Worth: 88000
  assert.equal(calc.totalAssets, 105000);
  assert.equal(calc.totalLiabilities, 17000);
  assert.equal(calc.netWorth, 88000);

  // Snapshot upsert overwrites same date without duplicating
  let snaps = upsertNetWorthSnapshot([], calc, '2026-11-20');
  snaps = upsertNetWorthSnapshot(snaps, { ...calc, netWorth: 90000 }, '2026-11-20');
  assert.equal(snaps.length, 1);
  assert.equal(snaps[0].net_worth, 90000);
});

// 4. SAFE-TO-SPEND CALCULATOR TESTS
test('Safe-to-Spend: handles unpaid vs already-paid bills without double subtraction', () => {
  const refDate = new Date(2026, 10, 21); // Nov 21, 2026 -> 10 remaining days (21..30)
  const bills: RecurringBill[] = [
    {
      id: 'b1',
      user_id: 'u1',
      title: 'WiFi Bill',
      category: 'internet',
      amount: 1000,
      frequency: 'monthly',
      due_day: 25,
      reminder_enabled: true,
      is_active: true,
      last_paid_date: null,
      created_at: '',
      updated_at: '',
    },
    {
      id: 'b2',
      user_id: 'u1',
      title: 'Room Rent (Already Paid)',
      category: 'rent',
      amount: 8000,
      frequency: 'monthly',
      due_day: 5,
      reminder_enabled: true,
      is_active: true,
      last_paid_date: '2026-11-05', // already paid this month!
      created_at: '',
      updated_at: '',
    },
  ];

  const res = calculateSafeToSpend({
    availableBalance: 15000,
    transactions: [makeTx({ amount: 8000, transaction_date: '2026-11-05' })],
    recurringBills: bills,
    budgets: [],
    savingsGoals: [],
    preferences: {
      ...DEFAULT_SAFE_TO_SPEND_PREFS,
      minimumBalanceReserve: 2000,
      savingsCommitment: 2000,
      essentialExpenseReserve: 0,
      emergencyReserve: 0,
    },
    referenceDate: refDate,
  });

  assert.equal(res.hasSufficientData, true);
  assert.equal(res.upcomingBillsCommitment, 1000); // Only WiFi; Rent NOT double subtracted
  assert.equal(res.totalCommitments, 5000); // 1000 + 2000 + 2000
  assert.equal(res.safeToSpendThisMonth, 10000);
  assert.equal(res.remainingDaysInMonth, 10);
  assert.equal(res.safeToSpendToday, 1000);
});

test('Safe-to-Spend: handles insufficient data and negative balance honestly', () => {
  const empty = calculateSafeToSpend({
    availableBalance: 0,
    transactions: [],
    recurringBills: [],
    budgets: [],
    savingsGoals: [],
    preferences: DEFAULT_SAFE_TO_SPEND_PREFS,
  });
  assert.equal(empty.hasSufficientData, false);
  assert.equal(empty.status, 'insufficient_data');

  const deficit = calculateSafeToSpend({
    availableBalance: -500,
    transactions: [makeTx({ amount: 500 })],
    recurringBills: [],
    budgets: [],
    savingsGoals: [],
    preferences: DEFAULT_SAFE_TO_SPEND_PREFS,
  });
  assert.equal(deficit.status, 'deficit');
  assert.equal(deficit.safeToSpendToday, 0);
  assert.ok(deficit.warnings.length > 0);
});

// 5. SMART ALERTS TESTS
test('Smart Alerts: evaluates budget thresholds, bill reminders, savings milestones, deduplication & quiet hours', () => {
  const refDate = new Date(2026, 10, 23, 23, 15); // 23:15
  assert.equal(
    isWithinQuietHours({ ...DEFAULT_SMART_ALERT_PREFS, quietHoursEnabled: true, quietHoursStart: '22:00', quietHoursEnd: '07:00' }, refDate),
    true
  );

  const budgets: UserBudget[] = [
    { id: 'bud1', user_id: 'u1', category: 'food', monthly_limit: 2000, alert_threshold: 80, created_at: '', updated_at: '' },
  ];
  const bills: RecurringBill[] = [
    { id: 'bill1', user_id: 'u1', title: 'Electricity', category: 'electricity', amount: 1200, frequency: 'monthly', due_day: 24, reminder_enabled: true, is_active: true, created_at: '', updated_at: '' },
  ];
  const goals: SavingsGoal[] = [
    { id: 'g1', user_id: 'u1', title: 'Emergency Fund', target_amount: 10000, current_amount: 7500, category: 'emergency', is_completed: false, created_at: '', updated_at: '' },
  ];
  const txs: Transaction[] = [
    makeTx({ category: 'food', subcategory: 'delivery', amount: 1900, transaction_date: '2026-11-23' }),
  ];

  const alerts = evaluateSmartAlerts({
    transactions: txs,
    availableBalance: 1500,
    budgets,
    recurringBills: bills,
    savingsGoals: goals,
    preferences: DEFAULT_SMART_ALERT_PREFS,
    referenceDate: refDate,
  });

  // Should contain budget 90% alert, upcoming bill (1 day), low balance (<2000), and savings 75% milestone
  assert.ok(alerts.some((a) => a.category === 'budget' && a.dedupeKey === 'budget:bud1:2026-11:90'));
  assert.ok(alerts.some((a) => a.category === 'bills'));
  assert.ok(alerts.some((a) => a.category === 'savings' && a.dedupeKey === 'savings:g1:milestone_75'));
  assert.ok(alerts.some((a) => a.dedupeKey.startsWith('low_balance:')));

  // Dismissing an alert removes it deterministically
  const filtered = evaluateSmartAlerts({
    transactions: txs,
    availableBalance: 1500,
    budgets,
    recurringBills: bills,
    savingsGoals: goals,
    preferences: DEFAULT_SMART_ALERT_PREFS,
    eventState: { readKeys: [], dismissedKeys: ['budget:bud1:2026-11:90'] },
    referenceDate: refDate,
  });
  assert.equal(filtered.some((a) => a.dedupeKey === 'budget:bud1:2026-11:90'), false);
});

// 6. RECEIPT VALIDATION & DUPLICATE DETECTION TESTS
test('Receipt Scanner: validates MIME/size and detects duplicates by hash or transaction similarity', () => {
  assert.equal(validateReceiptUpload('image/jpeg', 1024 * 500).valid, true);
  assert.equal(validateReceiptUpload('application/pdf', 1024).valid, false);
  assert.equal(validateReceiptUpload('image/png', 6 * 1024 * 1024).valid, false);

  const existing = [
    makeTx({ id: 't_dup', title: 'Swiggy Instamart', amount: 642, transaction_date: '2026-11-20' }),
  ];

  const dupByTx = detectDuplicateReceipt({
    extraction: { merchant: 'Swiggy Instamart', receiptDate: '2026-11-20', totalAmount: 642, receiptNumber: '' },
    existingTransactions: existing,
  });
  assert.equal(dupByTx.isDuplicate, true);
  assert.equal(dupByTx.matchedTransactionId, 't_dup');

  const dupByHash = detectDuplicateReceipt({
    extraction: { merchant: 'Other Store', receiptDate: '2026-11-10', totalAmount: 100, receiptNumber: '' },
    fileHash: 'abc123hash',
    existingTransactions: existing,
    knownReceiptHashes: [{ file_hash: 'abc123hash', merchant: 'Other Store', amount: 100, receipt_date: '2026-11-10' }],
  });
  assert.equal(dupByHash.isDuplicate, true);
});

// 7. AI FINANCIAL CONTEXT AGGREGATOR TESTS
test('AI Context Aggregator: separates earned income, borrowed funds, transfers, and Udhar accurately', () => {
  const refDate = new Date(2026, 10, 23);
  const txs: Transaction[] = [
    makeTx({ category: 'home', subcategory: 'salary', transaction_type: 'income', amount: 50000, transaction_date: '2026-11-01' }),
    makeTx({ category: 'home', subcategory: 'loan_received', transaction_type: 'income', amount: 10000, transaction_date: '2026-11-02' }),
    makeTx({ category: 'food', subcategory: 'delivery', transaction_type: 'expense', amount: 2500, transaction_date: '2026-11-10' }),
    makeTx({ category: 'people', subcategory: 'money_given', transaction_type: 'expense', amount: 4000, transaction_date: '2026-11-12' }),
    makeTx({ category: 'other', subcategory: 'other_general', transaction_type: 'expense', amount: 3000, transaction_date: '2026-11-14', metadata: { is_transfer: true } }),
  ];

  const ctx = buildAiFinancialContext({
    transactions: txs,
    availableBalance: 53500,
    budgets: [],
    recurringBills: [],
    savingsGoals: [],
    udharReceivable: 4000,
    udharPayable: 0,
    activePeopleCount: 1,
    referenceDate: refDate,
  });

  assert.equal(ctx.totals.thisMonthIncome, 50000); // Loan NOT counted as earned income
  assert.equal(ctx.totals.allTimeBorrowed, 10000);
  assert.equal(ctx.totals.thisMonthExpenses, 2500); // Udhar & Transfer NOT counted as expense
  assert.equal(ctx.udharSummary.totalReceivable, 4000);
});

// 8. DECIMAL-SAFE PAISE ARITHMETIC TESTS
test('Money arithmetic: avoids IEEE-754 floating-point drift using integer paise', () => {
  const sum = fromPaise(toPaise(0.1) + toPaise(0.2));
  assert.equal(sum, 0.3);
  assert.equal(roundMoney(199.995), 200);

  const nw = calculateNetWorth({
    assets: [
      { id: 'a1', name: 'Nifty 50 SIP', category: 'mutual_funds', current_value: 10000.1, valuation_date: '2026-11-24', updated_at: '' },
      { id: 'a2', name: 'Bank', category: 'bank_account', current_value: 20000.2, valuation_date: '2026-11-24', updated_at: '' },
    ],
    liabilities: [
      { id: 'l1', name: 'Home Loan', category: 'home_loan', current_balance: 5000.1, valuation_date: '2026-11-24', updated_at: '' },
      { id: 'l2', name: 'Vehicle Loan', category: 'vehicle_loan', current_balance: 2500.2, valuation_date: '2026-11-24', updated_at: '' },
    ],
    availableBalance: 0,
    udharReceivable: 0,
    udharPayable: 0,
    settings: { includeLiquidBalance: false, includeUdharReceivables: false, includeUdharPayables: false },
  });

  assert.equal(nw.totalAssets, 30000.3);
  assert.equal(nw.totalLiabilities, 7500.3);
  assert.equal(nw.netWorth, 22500);
});

// 9. BINARY MAGIC-BYTE RECEIPT SIGNATURE VALIDATION TESTS
test('Receipt Security: validates real JPEG/PNG/WEBP magic bytes and rejects spoofed HTML/SVG payloads', () => {
  const validJpeg = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01, 0x01]).toString('base64');
  const validPng = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d, 0x49]).toString('base64');
  const validWebp = Buffer.from([0x52, 0x49, 0x46, 0x46, 0x24, 0x00, 0x00, 0x00, 0x57, 0x45, 0x42, 0x50, 0x56]).toString('base64');
  const spoofedSvg = Buffer.from('<svg onload="alert(1)"></svg>').toString('base64');

  assert.equal(validateReceiptFileSignature(validJpeg, 'image/jpeg').valid, true);
  assert.equal(validateReceiptFileSignature(validPng, 'image/png').valid, true);
  assert.equal(validateReceiptFileSignature(validWebp, 'image/webp').valid, true);

  // Spoofed SVG/XSS payload masquerading as image/jpeg MUST be rejected
  assert.equal(validateReceiptFileSignature(spoofedSvg, 'image/jpeg').valid, false);
  // Mismatched MIME (PNG bytes declared as JPEG) MUST be rejected
  assert.equal(validateReceiptFileSignature(validPng, 'image/jpeg').valid, false);
});

// 10. SAFE-TO-SPEND DAILY / WEEKLY / MONTHLY PERIODS TEST
test('Safe-to-Spend: supports Daily, Weekly, and Monthly focus periods accurately', () => {
  const refDate = new Date(2026, 10, 21); // Nov 21 -> 10 remaining days in Nov (21..30)
  const baseParams = {
    availableBalance: 20000,
    transactions: [makeTx({ category: 'home', subcategory: 'salary', transaction_type: 'income', amount: 20000, transaction_date: '2026-11-01' })],
    recurringBills: [],
    budgets: [],
    savingsGoals: [],
    referenceDate: refDate,
  };

  const dailyRes = calculateSafeToSpend({
    ...baseParams,
    preferences: { ...DEFAULT_SAFE_TO_SPEND_PREFS, emergencyReserve: 10000, period: 'day' },
  });
  const weeklyRes = calculateSafeToSpend({
    ...baseParams,
    preferences: { ...DEFAULT_SAFE_TO_SPEND_PREFS, emergencyReserve: 10000, period: 'week' },
  });
  const monthlyRes = calculateSafeToSpend({
    ...baseParams,
    preferences: { ...DEFAULT_SAFE_TO_SPEND_PREFS, emergencyReserve: 10000, period: 'month' },
  });

  assert.equal(monthlyRes.safeToSpendThisMonth, 10000);
  assert.equal(dailyRes.safeToSpendToday, 1000);
  assert.equal(dailyRes.safeToSpendPeriod, 1000);
  assert.equal(weeklyRes.safeToSpendPeriod, weeklyRes.safeToSpendThisWeek);
  assert.equal(monthlyRes.safeToSpendPeriod, 10000);
});

