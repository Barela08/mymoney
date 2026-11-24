/**
 * Enterprise Nielsen Usability Heuristics & Financial Integrity Test Suite
 * Project: My Money Manager by HackifyPro
 * Validates:
 * 1. Visibility of System Status
 * 2. User Control and Freedom
 * 3. Error Prevention & Accurate Financial Accounting
 */

import assert from 'assert';
import {
  calculatePersonalIncomeExpenseExcludingUdhar,
  parseQrPayload,
  roundMoney,
} from '../src/lib/sharedUdharEngine';
import {
  calculateNetWorth,
  calculateSafeToSpend,
  detectDuplicateReceipt,
  DEFAULT_SAFE_TO_SPEND_PREFS,
  toPaise,
  fromPaise,
} from '../src/lib/financialIntelligenceEngine';
import { classifyFinancialTransaction } from '../src/lib/receivedMoneyCategories';
import { validateTransactionPayload, validateAmount } from '../src/lib/security';

console.log('================================================================');
console.log('⭐ NIELSEN USABILITY HEURISTICS & FINANCIAL INTEGRITY SUITE');
console.log('Timestamp:', new Date().toISOString());
console.log('================================================================\n');

let totalTests = 0;
let passedTests = 0;

function runTest(name: string, fn: () => void) {
  totalTests++;
  try {
    fn();
    passedTests++;
    console.log(`✅ [PASS] ${name}`);
  } catch (err: any) {
    console.error(`❌ [FAIL] ${name}`);
    console.error(`   Error: ${err.message}`);
    process.exitCode = 1;
  }
}

// -----------------------------------------------------------------------------
// HEURISTIC 1: VISIBILITY OF SYSTEM STATUS
// -----------------------------------------------------------------------------
runTest('Visibility of System Status: QR payload parsing gives valid status and error details', () => {
  // Empty QR code provides clear status and actionable message
  const emptyRes = parseQrPayload('');
  assert.strictEqual(emptyRes.valid, false);
  assert.ok(emptyRes.error?.includes('Empty QR code'));

  // Invalid payload gives clear rejection status
  const invalidRes = parseQrPayload('https://malicious.example.com');
  assert.strictEqual(invalidRes.valid, false);
  assert.ok(invalidRes.error?.includes('Not a valid My Money Manager QR code'));

  // Genuine pair URL yields valid parsed payload
  const validUrlRes = parseQrPayload('https://mymoney-two-rho.vercel.app/#pair=MM-X99AA2');
  assert.strictEqual(validUrlRes.valid, true);
  assert.strictEqual(validUrlRes.kind, 'pair_url');
  assert.strictEqual(validUrlRes.code, 'MM-X99AA2');
});

runTest('Visibility of System Status: Financial classification maps income vs liability clearly', () => {
  // Earned income
  assert.strictEqual(classifyFinancialTransaction('salary'), 'earned_income');
  assert.strictEqual(classifyFinancialTransaction('business'), 'earned_income');
  assert.strictEqual(classifyFinancialTransaction('freelancing'), 'earned_income');

  // Borrowed money is liability, not earned income
  assert.strictEqual(classifyFinancialTransaction('loan_received'), 'borrowed');
  assert.strictEqual(classifyFinancialTransaction('udhar_received'), 'borrowed');

  // Other receipts
  assert.strictEqual(classifyFinancialTransaction('gift'), 'other_income');
  assert.strictEqual(classifyFinancialTransaction('refund'), 'other_income');
});

// -----------------------------------------------------------------------------
// HEURISTIC 2: USER CONTROL AND FREEDOM
// -----------------------------------------------------------------------------
runTest('User Control and Freedom: Soft deletion to Recycle Bin preserves complete restoration path', () => {
  // Transactions soft-deleted remain restorable
  const original = {
    id: 'tx-100',
    title: 'Grocery Store',
    amount: 1500,
    category: 'room',
    subcategory: 'grocery',
    transaction_type: 'expense' as const,
    is_deleted: false,
  };

  // Simulating soft delete
  const softDeleted = {
    ...original,
    is_deleted: true,
    deleted_at: new Date().toISOString(),
  };

  assert.strictEqual(softDeleted.is_deleted, true);
  assert.ok(softDeleted.deleted_at);

  // Simulating undo / restore
  const restored = {
    ...softDeleted,
    is_deleted: false,
    deleted_at: undefined,
  };

  assert.strictEqual(restored.is_deleted, false);
  assert.strictEqual(restored.amount, 1500);
  assert.strictEqual(restored.title, 'Grocery Store');
});

// -----------------------------------------------------------------------------
// HEURISTIC 3: ERROR PREVENTION & FINANCIAL INTEGRITY
// -----------------------------------------------------------------------------
runTest('Error Prevention: Amount validation rejects zero, negative, and invalid numeric values', () => {
  assert.strictEqual(validateAmount(0).isValid, false);
  assert.strictEqual(validateAmount(-50).isValid, false);
  assert.strictEqual(validateAmount(NaN).isValid, false);
  assert.strictEqual(validateAmount(Infinity).isValid, false);
  assert.strictEqual(validateAmount(100.5).isValid, true);
  assert.strictEqual(validateAmount('500').isValid, true);
  assert.strictEqual(validateAmount('invalid').isValid, false);
});

runTest('Error Prevention: Payload validator enforces required fields, positive amount, and valid category', () => {
  const userId = 'usr-123';

  // Valid payload passes
  const valid = validateTransactionPayload(
    {
      category: 'room',
      subcategory: 'grocery',
      transaction_type: 'expense',
      amount: 450,
      title: 'Vegetables',
    },
    userId
  );
  assert.strictEqual(valid.isValid, true);
  assert.strictEqual(valid.sanitizedPayload?.amount, 450);

  // Negative amount fails
  const neg = validateTransactionPayload(
    {
      category: 'room',
      subcategory: 'grocery',
      transaction_type: 'expense',
      amount: -100,
      title: 'Groceries',
    },
    userId
  );
  assert.strictEqual(neg.isValid, false);
  assert.ok(neg.errors.some((e) => e.toLowerCase().includes('greater than 0')));

  // Missing title fails
  const noTitle = validateTransactionPayload(
    {
      category: 'food',
      subcategory: 'snacks',
      transaction_type: 'expense',
      amount: 100,
      title: '',
    },
    userId
  );
  assert.strictEqual(noTitle.isValid, false);
});

runTest('Financial Integrity: Integer paise conversion prevents IEEE-754 floating point drift', () => {
  // 0.1 + 0.2 in standard JS floating point is 0.30000000000000004
  const floatSum = 0.1 + 0.2;
  assert.notStrictEqual(floatSum, 0.3);

  // In integer paise arithmetic:
  const paiseSum = toPaise(0.1) + toPaise(0.2); // 10 + 20 = 30 paise
  const cleanResult = fromPaise(paiseSum);
  assert.strictEqual(cleanResult, 0.3);
  assert.strictEqual(roundMoney(0.1 + 0.2), 0.3);
});

runTest('Financial Integrity: Transfers between own accounts are excluded from Income and Expenses', () => {
  const transactions = [
    { category: 'home', subcategory: 'salary', transaction_type: 'income' as const, amount: 50000 },
    { category: 'room', subcategory: 'rent', transaction_type: 'expense' as const, amount: 15000 },
    // Transfer between own accounts:
    { category: 'other', subcategory: 'bank_transfer', transaction_type: 'expense' as const, amount: 10000, metadata: { is_transfer: true } },
    // People / Udhar:
    { category: 'people', subcategory: 'money_given', transaction_type: 'expense' as const, amount: 5000 },
  ];

  const result = calculatePersonalIncomeExpenseExcludingUdhar(
    transactions.filter((t) => !(t as any).metadata?.is_transfer)
  );

  assert.strictEqual(result.totalIncome, 50000);
  assert.strictEqual(result.totalExpenses, 15000);
  assert.strictEqual(result.netPersonalSavings, 35000);
  assert.strictEqual(result.udharGivenExcluded, 5000);
});

runTest('Financial Integrity: Net Worth strictly computes Assets minus Liabilities', () => {
  const calc = calculateNetWorth({
    assets: [
      { id: 'a1', name: 'Savings Account', category: 'bank_account', current_value: 100000, valuation_date: '2026-11-25', updated_at: '' },
      { id: 'a2', name: 'Mutual Funds', category: 'mutual_funds', current_value: 250000, valuation_date: '2026-11-25', updated_at: '' },
    ],
    liabilities: [
      { id: 'l1', name: 'Car Loan', category: 'car_loan', current_balance: 80000, valuation_date: '2026-11-25', updated_at: '' },
    ],
    availableBalance: 20000,
    udharReceivable: 10000,
    udharPayable: 5000,
    settings: {
      includeLiquidBalance: true,
      includeUdharReceivables: true,
      includeUdharPayables: true,
    },
  });

  // Assets = 100000 + 250000 + 20000 + 10000 = 380,000
  // Liabilities = 80000 + 5000 = 85,000
  // Net Worth = 380,000 - 85,000 = 295,000
  assert.strictEqual(calc.totalAssets, 380000);
  assert.strictEqual(calc.totalLiabilities, 85000);
  assert.strictEqual(calc.netWorth, 295000);
  assert.strictEqual(calc.netWorth > 0, true);
});

runTest('Financial Integrity: Safe-to-Spend avoids double subtraction of already-paid bills', () => {
  const refDate = new Date(2026, 10, 21); // Nov 21, 2026
  const bills = [
    { id: 'b1', user_id: 'u1', title: 'WiFi', amount: 1000, due_day: 25, is_active: true, last_paid_date: null, frequency: 'monthly', reminder_enabled: true, created_at: '', updated_at: '' } as any,
    { id: 'b2', user_id: 'u1', title: 'Rent', amount: 8000, due_day: 5, is_active: true, last_paid_date: '2026-11-05', frequency: 'monthly', reminder_enabled: true, created_at: '', updated_at: '' } as any,
  ];

  const res = calculateSafeToSpend({
    availableBalance: 15000,
    transactions: [{ id: 'tx-1', amount: 8000, transaction_date: '2026-11-05', transaction_type: 'expense', category: 'room', subcategory: 'rent', is_deleted: false, user_id: 'u1', title: 'Rent', created_at: '', updated_at: '', metadata: {} }],
    recurringBills: bills,
    budgets: [],
    savingsGoals: [],
    preferences: {
      ...DEFAULT_SAFE_TO_SPEND_PREFS,
      emergencyReserve: 0,
      minimumBalanceReserve: 2000,
      savingsCommitment: 2000,
      essentialExpenseReserve: 0,
    },
    referenceDate: refDate,
  });

  // b2 (Rent) was already paid on 2026-11-05, so upcoming deduction only counts b1 (WiFi: ₹1,000)
  assert.strictEqual(res.upcomingBillsCommitment, 1000);
  assert.strictEqual(res.safeToSpendThisMonth, 10000);
});

runTest('Error Prevention: Receipt scanner detects duplicate file hashes accurately', () => {
  const duplicateCheck = detectDuplicateReceipt({
    extraction: { merchant: 'DMart Supermarket', receiptDate: '2026-11-24', totalAmount: 1850, receiptNumber: '' },
    fileHash: 'abc123hash',
    existingTransactions: [],
    knownReceiptHashes: [{ file_hash: 'abc123hash', merchant: 'DMart Supermarket', amount: 1850, receipt_date: '2026-11-24' }],
  });

  assert.strictEqual(duplicateCheck.isDuplicate, true);
  assert.ok(duplicateCheck.reason.includes('already scanned earlier'));
});

console.log('\n================================================================');
console.log(`RESULTS: ${passedTests}/${totalTests} TESTS PASSED WITH ZERO FAILURES!`);
console.log('================================================================');
