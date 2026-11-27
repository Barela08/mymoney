import test from 'node:test';
import assert from 'node:assert/strict';
import {
  normalizeSearchQuery,
  maskEmailForPrivacy,
  maskPhoneForPrivacy,
  parseQrPayload,
  resolveCanonicalPerspective,
  calculateRepaymentApplication,
  validateUdharEdit,
  canCancelUdhar,
  isActiveRepayment,
  canDeleteRepayment,
  recalculateUdharFromRepayments,
  calculatePersonLedgerSummary,
  calculatePeopleDashboardSummary,
  calculatePersonalIncomeExpenseExcludingUdhar,
  packStructuredNote,
  unpackStructuredNote,
  CanonicalUdharRecord,
} from './sharedUdharEngine';

test('Scenario 1: User A gives User B ₹5,000 -> mirrored perspectives from ONE canonical record', () => {
  const canonical: CanonicalUdharRecord = {
    id: 'udhar-1',
    link_id: 'link-1',
    lender_user_id: 'user-a',
    borrower_user_id: 'user-b',
    lender_name: 'Alice',
    borrower_name: 'Bob',
    original_amount: 5000,
    paid_amount: 0,
    remaining_amount: 5000,
    status: 'confirmed',
    category: 'Personal Loan',
    payment_method: 'UPI',
    transaction_date: '2026-11-23',
    is_shared: true,
  };

  const viewA = resolveCanonicalPerspective(canonical, 'user-a');
  const viewB = resolveCanonicalPerspective(canonical, 'user-b');
  const viewStranger = resolveCanonicalPerspective(canonical, 'user-c');

  assert.ok(viewA);
  assert.equal(viewA.direction, 'gave');
  assert.equal(viewA.role, 'lender');
  assert.equal(viewA.actionLabel, "You'll Receive");
  assert.equal(viewA.remainingAmount, 5000);
  assert.equal(viewA.counterpartName, 'Bob');

  assert.ok(viewB);
  assert.equal(viewB.direction, 'took');
  assert.equal(viewB.role, 'borrower');
  assert.equal(viewB.actionLabel, "You'll Pay");
  assert.equal(viewB.remainingAmount, 5000);
  assert.equal(viewB.counterpartName, 'Alice');

  // Stranger has zero visibility
  assert.equal(viewStranger, null);
});

test('Scenario 2: User A takes ₹2,000 from User B -> User A sees Pay, User B sees Receive', () => {
  const canonical: CanonicalUdharRecord = {
    id: 'udhar-2',
    link_id: 'link-2',
    lender_user_id: 'user-b',
    borrower_user_id: 'user-a',
    lender_name: 'Bob',
    borrower_name: 'Alice',
    original_amount: 2000,
    paid_amount: 0,
    remaining_amount: 2000,
    status: 'confirmed',
    transaction_date: '2026-11-23',
    is_shared: true,
  };

  const viewA = resolveCanonicalPerspective(canonical, 'user-a');
  const viewB = resolveCanonicalPerspective(canonical, 'user-b');

  assert.equal(viewA?.direction, 'took');
  assert.equal(viewA?.actionLabel, "You'll Pay");
  assert.equal(viewB?.direction, 'gave');
  assert.equal(viewB?.actionLabel, "You'll Receive");
});

test('Scenario 3 & 4: Partial and multiple repayments transition cleanly to Settled without altering original amount', () => {
  const originalAmount = 5000;

  // Step 1: Lender logs ₹1,500
  const r1 = calculateRepaymentApplication({
    originalAmount,
    confirmedPaidAmount: 0,
    pendingRepaymentsAmount: 0,
    repayAmount: 1500,
    isShared: true,
    actorRole: 'lender',
    udharStatus: 'confirmed',
  });
  assert.equal(r1.valid, true);
  assert.equal(r1.repaymentStatus, 'confirmed');
  assert.equal(r1.nextPaidAmount, 1500);
  assert.equal(r1.nextRemainingAmount, 3500);
  assert.equal(r1.isSettled, false);

  // Step 2: Lender logs ₹2,000
  const r2 = calculateRepaymentApplication({
    originalAmount,
    confirmedPaidAmount: r1.nextPaidAmount!,
    pendingRepaymentsAmount: 0,
    repayAmount: 2000,
    isShared: true,
    actorRole: 'lender',
    udharStatus: 'confirmed',
  });
  assert.equal(r2.valid, true);
  assert.equal(r2.nextPaidAmount, 3500);
  assert.equal(r2.nextRemainingAmount, 1500);
  assert.equal(r2.isSettled, false);

  // Step 3: Final ₹1,500 settles Udhar
  const r3 = calculateRepaymentApplication({
    originalAmount,
    confirmedPaidAmount: r2.nextPaidAmount!,
    pendingRepaymentsAmount: 0,
    repayAmount: 1500,
    isShared: true,
    actorRole: 'lender',
    udharStatus: 'confirmed',
  });
  assert.equal(r3.valid, true);
  assert.equal(r3.nextPaidAmount, 5000);
  assert.equal(r3.nextRemainingAmount, 0);
  assert.equal(r3.nextUdharStatus, 'settled');
  assert.equal(r3.isSettled, true);
});

test('Scenario 5 & 6: Over-repayment blocked & Borrower repayment requires lender confirmation', () => {
  // Over-repayment blocked
  const over = calculateRepaymentApplication({
    originalAmount: 5000,
    confirmedPaidAmount: 2000,
    pendingRepaymentsAmount: 0,
    repayAmount: 3500,
    isShared: true,
    actorRole: 'lender',
    udharStatus: 'confirmed',
  });
  assert.equal(over.valid, false);
  assert.match(over.error || '', /cannot exceed remaining balance/i);

  // Borrower initiates ₹2,000 repayment on shared Udhar -> pending_confirmation, balance unchanged until lender confirms
  const borrowerRepay = calculateRepaymentApplication({
    originalAmount: 5000,
    confirmedPaidAmount: 0,
    pendingRepaymentsAmount: 0,
    repayAmount: 2000,
    isShared: true,
    actorRole: 'borrower',
    udharStatus: 'confirmed',
  });
  assert.equal(borrowerRepay.valid, true);
  assert.equal(borrowerRepay.repaymentStatus, 'pending_confirmation');
  assert.equal(borrowerRepay.nextRemainingAmount, 5000);
  assert.equal(borrowerRepay.isSettled, false);

  // Borrower tries to submit another ₹4,000 while ₹2,000 is pending -> blocked to prevent concurrent over-repayment
  const concurrentOver = calculateRepaymentApplication({
    originalAmount: 5000,
    confirmedPaidAmount: 0,
    pendingRepaymentsAmount: 2000,
    repayAmount: 4000,
    isShared: true,
    actorRole: 'borrower',
    udharStatus: 'confirmed',
  });
  assert.equal(concurrentOver.valid, false);
  assert.match(concurrentOver.error || '', /pending lender confirmation/i);
});

test('Scenario 7: Net Balance = Total Receivable - Total Payable (separate loans preserved)', () => {
  const userALedger = calculatePersonLedgerSummary([
    { direction: 'gave', original_amount: 5000, current_balance: 5000, status: 'confirmed' },
    { direction: 'took', original_amount: 2000, current_balance: 2000, status: 'confirmed' },
    { direction: 'gave', original_amount: 1000, current_balance: 0, status: 'cancelled' },
  ]);
  assert.equal(userALedger.totalGiven, 5000);
  assert.equal(userALedger.totalTaken, 2000);
  assert.equal(userALedger.youWillReceive, 5000);
  assert.equal(userALedger.youWillPay, 2000);
  assert.equal(userALedger.netBalance, 3000);

  const userBLedger = calculatePersonLedgerSummary([
    { direction: 'took', original_amount: 5000, current_balance: 5000, status: 'confirmed' },
    { direction: 'gave', original_amount: 2000, current_balance: 2000, status: 'confirmed' },
  ]);
  assert.equal(userBLedger.netBalance, -3000);
});

test('Scenario 8 & 9: Edit audit diff, repayment preservation, and cancellation guard', () => {
  const badEdit = validateUdharEdit(
    { original_amount: 5000, paid_amount: 2000, status: 'confirmed', transaction_date: '2026-11-20' },
    { amount: 1500, reason_for_edit: 'Typo fix' }
  );
  assert.equal(badEdit.valid, false);
  assert.match(badEdit.error || '', /cannot be less than already confirmed repayments/i);

  const goodEdit = validateUdharEdit(
    {
      original_amount: 5000,
      paid_amount: 2000,
      status: 'confirmed',
      transaction_date: '2026-11-20',
      category: 'Personal Loan',
    },
    {
      amount: 6000,
      category: 'Emergency',
      reason_for_edit: 'Added ₹1000 extra cash',
    }
  );
  assert.equal(goodEdit.valid, true);
  assert.equal(goodEdit.nextOriginalAmount, 6000);
  assert.equal(goodEdit.nextRemainingAmount, 4000);
  assert.equal(goodEdit.changes?.length, 2);

  // Deletion/cancellation allowed for active entries including partial or settled ones
  assert.equal(canCancelUdhar({ status: 'confirmed', paid_amount: 0, repayments: [] }).allowed, true);
  assert.equal(
    canCancelUdhar({ status: 'confirmed', paid_amount: 1000, repayments: [{ status: 'confirmed' }] }).allowed,
    true
  );
  assert.equal(
    canCancelUdhar({ status: 'settled', paid_amount: 5000, repayments: [{ status: 'confirmed' }] }).allowed,
    true
  );
  assert.equal(
    canCancelUdhar({ status: 'confirmed', paid_amount: 0, repayments: [{ status: 'pending_confirmation' }] }).allowed,
    true
  );
  // Disputed or already cancelled entries remain blocked
  assert.equal(canCancelUdhar({ status: 'disputed', paid_amount: 0, repayments: [] }).allowed, false);
  assert.equal(canCancelUdhar({ status: 'cancelled', paid_amount: 0, repayments: [] }).allowed, false);
});

test('Repayment deletion guard & balance recalculation reopen settled Udhar accurately', () => {
  assert.equal(isActiveRepayment({ status: 'confirmed', deleted_at: null }), true);
  assert.equal(isActiveRepayment({ status: 'deleted', deleted_at: null }), false);
  assert.equal(isActiveRepayment({ status: 'confirmed', deleted_at: '2026-11-27T00:00:00Z' }), false);

  // Lender can delete confirmed repayment; borrower gets 403
  assert.equal(
    canDeleteRepayment({
      isShared: true,
      direction: 'gave',
      actorUserId: 'lender-1',
      repayment: { status: 'confirmed', recorded_by_user_id: 'lender-1' },
    }).allowed,
    true
  );
  const borrowerDel = canDeleteRepayment({
    isShared: true,
    direction: 'took',
    actorUserId: 'borrower-1',
    repayment: { status: 'confirmed', recorded_by_user_id: 'lender-1' },
  });
  assert.equal(borrowerDel.allowed, false);
  assert.equal(borrowerDel.httpStatus, 403);

  // Borrower may only withdraw their own unconfirmed pending claim
  assert.equal(
    canDeleteRepayment({
      isShared: true,
      direction: 'took',
      actorUserId: 'borrower-1',
      repayment: { status: 'pending_confirmation', recorded_by_user_id: 'borrower-1' },
    }).allowed,
    true
  );

  // Settled ₹1,500 Udhar with ₹1,000 repayment deleted -> ₹500 paid, ₹1,000 remaining, status reopened to 'confirmed'
  const recalc = recalculateUdharFromRepayments({
    originalAmount: 1500,
    repayments: [
      { amount: 500, status: 'confirmed', deleted_at: null },
      { amount: 1000, status: 'deleted', deleted_at: '2026-11-27T00:00:00Z' },
    ],
    currentStatus: 'settled',
  });
  assert.equal(recalc.paidAmount, 500);
  assert.equal(recalc.remainingBalance, 1000);
  assert.equal(recalc.isSettled, false);
  assert.equal(recalc.nextStatus, 'confirmed');
});

test('Scenario 10: Financial accounting separation excludes Udhar from personal Income/Expenses', () => {
  const result = calculatePersonalIncomeExpenseExcludingUdhar([
    { category: 'home', transaction_type: 'income', amount: 50000 },
    { category: 'food', transaction_type: 'expense', amount: 4000 },
    { category: 'people', subcategory: 'money_given', transaction_type: 'expense', amount: 5000 },
    { category: 'people', subcategory: 'money_received', transaction_type: 'income', amount: 2000 },
  ]);

  assert.equal(result.totalIncome, 50000);
  assert.equal(result.totalExpenses, 4000);
  assert.equal(result.netPersonalSavings, 46000);
  assert.equal(result.udharGivenExcluded, 5000);
  assert.equal(result.udharReceivedExcluded, 2000);
});

test('QR Payload validation, search normalization, privacy masking, and structured notes', () => {
  assert.equal(normalizeSearchQuery('  Ráhul   SHARMA  '), 'ráhul sharma');
  assert.equal(maskEmailForPrivacy('rahul.sharma@gmail.com'), 'r***a@gmail.com');
  assert.equal(maskPhoneForPrivacy('+91 98765-43210'), '+91****210');

  assert.deepEqual(
    parseQrPayload('https://mymoney-two-rho.vercel.app/#pair=MM-A1B2C3'),
    { valid: true, kind: 'pair_url', code: 'MM-A1B2C3' }
  );
  assert.deepEqual(
    parseQrPayload(JSON.stringify({ app: 'my-money', type: 'udhar-pair', token: 'abc', code: 'MM-99AA11' })),
    { valid: true, kind: 'json', token: 'abc', code: 'MM-99AA11' }
  );
  assert.equal(parseQrPayload('https://evil.example.com/phish').valid, false);
  assert.equal(parseQrPayload('{"app":"other"}').valid, false);

  const packed = packStructuredNote('Paid for dinner', {
    category: 'Emergency',
    payment_method: 'UPI',
    description: 'Hospital bill support',
    transaction_ref: 'UTR998877',
  });
  const unpacked = unpackStructuredNote(packed);
  assert.equal(unpacked.note, 'Paid for dinner');
  assert.equal(unpacked.meta.category, 'Emergency');
  assert.equal(unpacked.meta.payment_method, 'UPI');
  assert.equal(unpacked.meta.description, 'Hospital bill support');
  assert.equal(unpacked.meta.transaction_ref, 'UTR998877');

  const dash = calculatePeopleDashboardSummary(
    [
      {
        direction: 'gave',
        original_amount: 5000,
        current_balance: 3000,
        status: 'confirmed',
        counterpart_user_id: 'u-1',
        counterpart_name: 'Bob',
      },
    ],
    [
      { name: 'Bob', linked_user_id: 'u-1' },
      { name: 'Local Shop', linked_user_id: null },
    ]
  );
  assert.equal(dash.totalConnectedPeople, 1);
  assert.equal(dash.totalManualPeople, 1);
  assert.equal(dash.peopleWithActiveUdhar, 1);
  assert.equal(dash.netBalance, 3000);
});
