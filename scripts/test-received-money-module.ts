import {
  RECEIVED_CATEGORIES,
  PAYMENT_METHODS,
  getReceivedCategoryConfig,
  classifyFinancialTransaction,
} from '../src/lib/receivedMoneyCategories';
import { Transaction, TransactionSubcategory } from '../src/types';

interface TestResult {
  title: string;
  passed: boolean;
  details?: string;
}

const results: TestResult[] = [];

function assert(condition: boolean, title: string, details?: string) {
  results.push({ title, passed: condition, details });
  if (condition) {
    console.log(`✅ [PASS] ${title}`);
  } else {
    console.error(`❌ [FAIL] ${title} - ${details || 'Assertion failed'}`);
  }
}

async function runTestSuite() {
  console.log('================================================================');
  console.log('🧪 RECEIVED MONEY MODULE VERIFICATION SUITE');
  console.log('================================================================\n');

  // 1. Verify all 12 categories are defined
  const expectedCategories: TransactionSubcategory[] = [
    'salary',
    'business',
    'freelancing',
    'family',
    'gift',
    'refund',
    'rental',
    'investment',
    'interest',
    'loan_received',
    'udhar_received',
    'other_income',
  ];

  assert(
    RECEIVED_CATEGORIES.length === 12,
    'All 12 Received Money categories are configured',
    `Found ${RECEIVED_CATEGORIES.length} categories`
  );

  for (const catId of expectedCategories) {
    const found = RECEIVED_CATEGORIES.find((c) => c.id === catId);
    assert(
      Boolean(found),
      `Category '${catId}' is present and properly typed`,
      found ? `Label: ${found.label}` : 'Missing'
    );
  }

  // 2. Verify dynamic form field definitions and placeholders
  for (const cat of RECEIVED_CATEGORIES) {
    assert(
      Boolean(cat.sourceField.label && cat.sourceField.placeholder),
      `Category '${cat.id}' has dynamic source field label & placeholder`,
      `${cat.sourceField.label} -> "${cat.sourceField.placeholder}"`
    );
    assert(
      Boolean(cat.descriptionField.label && cat.descriptionField.placeholder && cat.descriptionField.suggestions.length > 0),
      `Category '${cat.id}' has dynamic description field & suggestions`,
      `Suggestions count: ${cat.descriptionField.suggestions.length}`
    );
  }

  // 3. Verify Financial Classification (Requirement 11)
  // Earned income: salary, business, freelancing
  assert(
    classifyFinancialTransaction('salary') === 'earned_income',
    'Salary is classified as Earned Income'
  );
  assert(
    classifyFinancialTransaction('business') === 'earned_income',
    'Business is classified as Earned Income'
  );
  assert(
    classifyFinancialTransaction('freelancing') === 'earned_income',
    'Freelancing is classified as Earned Income'
  );

  // Borrowed money: loan_received, udhar_received (MUST NOT be counted as earned income/profit)
  assert(
    classifyFinancialTransaction('loan_received') === 'borrowed',
    'Loan Received is classified as Borrowed Money (not earned income)'
  );
  assert(
    classifyFinancialTransaction('udhar_received') === 'borrowed',
    'Udhar Received is classified as Borrowed Money (not earned income)'
  );

  // Other income: family, gift, refund, rental, investment, interest, other_income
  const otherIncomeCats = ['family', 'gift', 'refund', 'rental', 'investment', 'interest', 'other_income'];
  for (const cat of otherIncomeCats) {
    assert(
      classifyFinancialTransaction(cat) === 'other_income',
      `${cat} is classified as Other Income`
    );
  }

  // 4. Backwards compatibility check
  assert(
    getReceivedCategoryConfig('received_home').id === 'family',
    'Legacy "received_home" seamlessly maps to Family category config'
  );
  assert(
    getReceivedCategoryConfig('unknown_legacy_cat').id === 'other_income',
    'Unknown legacy subcategories gracefully fallback to Other Income'
  );

  // 5. Payment Methods check
  assert(
    PAYMENT_METHODS.length === 6,
    'All 6 Payment Methods configured (Cash, UPI, Bank Transfer, Card, Wallet, Other)'
  );

  const upiMethod = PAYMENT_METHODS.find((pm) => pm.id === 'upi');
  assert(
    Boolean(upiMethod && upiMethod.requiresUtr),
    'UPI payment method supports optional UTR reference'
  );

  const bankMethod = PAYMENT_METHODS.find((pm) => pm.id === 'bank_transfer');
  assert(
    Boolean(bankMethod && bankMethod.requiresAccountRef),
    'Bank Transfer supports optional Account / Reference'
  );

  // 6. Test Financial Calculations Simulation
  const sampleTransactions: Transaction[] = [
    {
      id: 'tx-1',
      category: 'home',
      subcategory: 'salary',
      transaction_type: 'income',
      amount: 50000,
      title: 'Monthly Salary',
      transaction_date: '2026-11-01',
      transaction_time: '10:00:00',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'tx-2',
      category: 'home',
      subcategory: 'freelancing',
      transaction_type: 'income',
      amount: 15000,
      title: 'Web Design Project',
      transaction_date: '2026-11-10',
      transaction_time: '14:30:00',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'tx-3',
      category: 'home',
      subcategory: 'gift',
      transaction_type: 'income',
      amount: 2000,
      title: 'Birthday Gift',
      transaction_date: '2026-11-15',
      transaction_time: '18:00:00',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
    {
      id: 'tx-4',
      category: 'home',
      subcategory: 'loan_received',
      transaction_type: 'income',
      amount: 100000,
      title: 'Personal Loan Disbursal',
      transaction_date: '2026-11-20',
      transaction_time: '11:00:00',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    },
  ];

  let totalReceived = 0;
  let earnedIncome = 0;
  let otherIncome = 0;
  let borrowedReceived = 0;

  for (const tx of sampleTransactions) {
    const amt = tx.amount;
    totalReceived += amt;
    const classification = classifyFinancialTransaction(tx.subcategory);
    if (classification === 'earned_income') earnedIncome += amt;
    else if (classification === 'borrowed') borrowedReceived += amt;
    else otherIncome += amt;
  }

  assert(
    totalReceived === 167000,
    'Total received calculates all inflows: ₹1,67,000',
    `Calculated: ₹${totalReceived}`
  );
  assert(
    earnedIncome === 65000,
    'Earned income correctly isolates Salary + Freelancing: ₹65,000',
    `Calculated: ₹${earnedIncome}`
  );
  assert(
    otherIncome === 2000,
    'Other income isolates Gifts & Returns: ₹2,000',
    `Calculated: ₹${otherIncome}`
  );
  assert(
    borrowedReceived === 100000,
    'Borrowed Money (Loan) is NOT inflated into earned income/profit: ₹1,00,00',
    `Calculated: ₹${borrowedReceived}`
  );

  console.log('\n================================================================');
  const passedCount = results.filter((r) => r.passed).length;
  console.log(`TOTAL TESTS: ${results.length} | PASSED: ${passedCount} | FAILED: ${results.length - passedCount}`);
  console.log('================================================================\n');

  if (passedCount === results.length) {
    console.log('🎉 ALL RECEIVED MONEY TESTS PASSED SUCCESSFULLY!');
  } else {
    process.exit(1);
  }
}

runTestSuite().catch((err) => {
  console.error('Test suite failed:', err);
  process.exit(1);
});
