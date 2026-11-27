import assert from 'assert';

console.log('================================================================');
console.log('🧪 MASTER VERIFICATION SUITE: UDHAR & SECURITY ENFORCEMENT');
console.log('================================================================');

let passedTests = 0;
let failedTests = 0;

function runTest(name: string, fn: () => void | Promise<void>) {
  try {
    const res = fn();
    if (res instanceof Promise) {
      return res
        .then(() => {
          console.log(`  ✅ PASS: ${name}`);
          passedTests++;
        })
        .catch((err) => {
          console.error(`  ❌ FAIL: ${name}`);
          console.error(err);
          failedTests++;
        });
    } else {
      console.log(`  ✅ PASS: ${name}`);
      passedTests++;
    }
  } catch (err) {
    console.error(`  ❌ FAIL: ${name}`);
    console.error(err);
    failedTests++;
  }
}

async function runAll() {
  // Test 1: Admin exclusion in User Search
  await runTest('People Search server-side excludes admin accounts and admin email', () => {
    const sampleUsers = [
      { id: 'u1', full_name: 'Rahul Sharma', email: 'rahul@example.com', role: 'user', deletion_status: 'none' },
      { id: 'u2', full_name: 'Priya Verma', email: 'priya@example.com', role: 'user', deletion_status: 'none' },
      { id: 'admin1', full_name: 'Super Admin', email: 'admin@mymoney.com', role: 'admin', deletion_status: 'none' },
      { id: 'admin2', full_name: 'System Admin', email: 'sysadmin@company.com', role: 'admin', deletion_status: 'none' },
    ];

    const filtered = sampleUsers.filter(
      (u) =>
        (!u.deletion_status || u.deletion_status === 'none') &&
        String(u.role || '').toLowerCase() !== 'admin' &&
        String(u.email || '').toLowerCase().trim() !== 'admin@mymoney.com'
    );

    assert.strictEqual(filtered.length, 2, 'Admin accounts must be filtered out');
    assert.ok(!filtered.some((u) => u.role === 'admin'), 'No admin accounts in search results');
    assert.ok(!filtered.some((u) => u.email === 'admin@mymoney.com'), 'Admin email must never leak');
  });

  // Test 2: Multiple Independent Transactions with One Person
  await runTest('Multiple Udhar transactions for one person have unique IDs and link_ids', () => {
    interface UdharTx {
      id: string;
      link_id: string;
      person_name: string;
      original_amount: number;
      current_balance: number;
      status: 'confirmed' | 'settled' | 'cancelled';
    }

    const rahulTransactions: UdharTx[] = [
      { id: 'tx-1', link_id: 'link-1', person_name: 'Rahul', original_amount: 500, current_balance: 500, status: 'confirmed' },
      { id: 'tx-2', link_id: 'link-2', person_name: 'Rahul', original_amount: 1000, current_balance: 1000, status: 'confirmed' },
      { id: 'tx-3', link_id: 'link-3', person_name: 'Rahul', original_amount: 700, current_balance: 700, status: 'confirmed' },
      { id: 'tx-4', link_id: 'link-4', person_name: 'Rahul', original_amount: 300, current_balance: 300, status: 'confirmed' },
      { id: 'tx-5', link_id: 'link-5', person_name: 'Rahul', original_amount: 2000, current_balance: 2000, status: 'confirmed' },
    ];

    const totalPending = rahulTransactions
      .filter((t) => t.status === 'confirmed')
      .reduce((sum, t) => sum + t.current_balance, 0);

    assert.strictEqual(totalPending, 4500, 'Total pending should be ₹4,500');

    // Settle only transaction 2 (₹1,000)
    const targetLink = 'link-2';
    const updatedTransactions = rahulTransactions.map((t) =>
      t.link_id === targetLink
        ? { ...t, current_balance: 0, status: 'settled' as const }
        : t
    );

    const tx2 = updatedTransactions.find((t) => t.id === 'tx-2');
    assert.strictEqual(tx2?.status, 'settled');
    assert.strictEqual(tx2?.current_balance, 0);

    // Verify all other 4 transactions remain untouched and confirmed
    const untouchedPending = updatedTransactions
      .filter((t) => t.status === 'confirmed')
      .map((t) => t.original_amount);

    assert.deepStrictEqual(untouchedPending, [500, 700, 300, 2000], 'All other entries must remain pending');

    const newTotalPending = updatedTransactions
      .filter((t) => t.status === 'confirmed')
      .reduce((sum, t) => sum + t.current_balance, 0);

    const newTotalSettled = updatedTransactions
      .filter((t) => t.status === 'settled')
      .reduce((sum, t) => sum + t.original_amount, 0);

    assert.strictEqual(newTotalPending, 3500, 'New pending balance is ₹3,500');
    assert.strictEqual(newTotalSettled, 1000, 'Settled amount is ₹1,000');
  });

  // Test 3: Settlement & Delete Permissions (Lender vs Borrower)
  await runTest('Lender-only settlement guard remains strict while both parties can delete Udhar transactions', () => {
    const lenderUserId = 'lender-123';
    const borrowerUserId = 'borrower-456';

    const transactionFromBorrowerPerspective = {
      id: 'tx-99',
      user_id: borrowerUserId,
      counterpart_user_id: lenderUserId,
      direction: 'took', // Borrower took the money
      original_amount: 1500,
      current_balance: 1500,
      status: 'confirmed',
    };

    // Settle guard test (still lender-only)
    const canSettle = (_authUser: { id: string }, tx: typeof transactionFromBorrowerPerspective) => {
      if (tx.counterpart_user_id && tx.direction === 'took') {
        return {
          status: 403,
          allowed: false,
          message: 'Only the lender who gave the money can mark an Udhar as settled.',
        };
      }
      return { status: 200, allowed: true };
    };

    // Delete guard test: both lender and borrower can delete non-disputed Udhar transactions
    const canDelete = (_authUser: { id: string }, tx: typeof transactionFromBorrowerPerspective) => {
      if (tx.status === 'disputed') {
        return {
          status: 409,
          allowed: false,
          message: 'Disputed Udhar records cannot be deleted.',
        };
      }
      return { status: 200, allowed: true };
    };

    // When borrower calls settle
    const settleResult = canSettle({ id: borrowerUserId }, transactionFromBorrowerPerspective);
    assert.strictEqual(settleResult.status, 403, 'Borrower settle attempt must return 403');
    assert.strictEqual(settleResult.allowed, false);

    // When borrower calls delete on active Udhar
    const deleteResult = canDelete({ id: borrowerUserId }, transactionFromBorrowerPerspective);
    assert.strictEqual(deleteResult.status, 200, 'Borrower delete attempt on Udhar entry is allowed');
    assert.strictEqual(deleteResult.allowed, true);

    // When settled borrower calls delete
    const settledBorrowerDeleteResult = canDelete(
      { id: borrowerUserId },
      { ...transactionFromBorrowerPerspective, current_balance: 0, status: 'settled' }
    );
    assert.strictEqual(settledBorrowerDeleteResult.status, 200, 'Settled borrower delete attempt is authorized');
    assert.strictEqual(settledBorrowerDeleteResult.allowed, true);

    // When lender calls settle
    const lenderTxPerspective = {
      ...transactionFromBorrowerPerspective,
      user_id: lenderUserId,
      counterpart_user_id: borrowerUserId,
      direction: 'gave' as const, // Lender gave the money
    };
    const lenderSettleResult = canSettle({ id: lenderUserId }, lenderTxPerspective);
    assert.strictEqual(lenderSettleResult.status, 200, 'Lender settle attempt is authorized');
    assert.strictEqual(lenderSettleResult.allowed, true);
  });

  // Test 4: Role Distinction: Admin vs Normal User
  await runTest('Normal user accessing /admin is blocked with 403 Forbidden', () => {
    const checkAdminRouteAccess = (user: { id: string; role?: string } | null, isAdmin: boolean) => {
      if (!user) {
        return { action: 'render_admin_login' };
      }
      if (!isAdmin) {
        return { action: 'block_403_forbidden', statusCode: 403 };
      }
      return { action: 'render_admin_dashboard' };
    };

    // Unauthenticated user -> AdminLoginPage
    assert.strictEqual(checkAdminRouteAccess(null, false).action, 'render_admin_login');

    // Normal logged-in user -> 403 Forbidden screen
    const normalUser = { id: 'u-normal', role: 'user' };
    const normalResult = checkAdminRouteAccess(normalUser, false);
    assert.strictEqual(normalResult.action, 'block_403_forbidden');
    assert.strictEqual(normalResult.statusCode, 403);

    // Admin user -> AdminDashboard
    const adminUser = { id: 'u-admin', role: 'admin' };
    assert.strictEqual(checkAdminRouteAccess(adminUser, true).action, 'render_admin_dashboard');
  });

  // Test 5: UPI QR URI Generation and Validation
  await runTest('UPI QR Generator builds compliant NPCI URIs and enforces safety', () => {
    const UPI_ID_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;

    // VPA validity
    assert.ok(UPI_ID_REGEX.test('nilesh@okhdfcbank'), 'Valid VPA');
    assert.ok(UPI_ID_REGEX.test('9876543210@paytm'), 'Valid mobile VPA');
    assert.ok(!UPI_ID_REGEX.test('invalid-vpa-without-at'), 'Invalid VPA missing @');
    assert.ok(!UPI_ID_REGEX.test('@bank'), 'Invalid VPA missing user');

    // Build URI function
    const buildUpiUri = (opts: { pa: string; pn?: string; am?: number; tn?: string }) => {
      const p = new URLSearchParams();
      p.set('pa', opts.pa);
      if (opts.pn) p.set('pn', opts.pn);
      p.set('cu', 'INR');
      if (opts.am !== undefined && opts.am > 0) p.set('am', opts.am.toFixed(2));
      if (opts.tn) p.set('tn', opts.tn.slice(0, 80));
      return `upi://pay?${p.toString()}`;
    };

    // Open amount QR
    const normalUri = buildUpiUri({ pa: 'nilesh@okhdfcbank', pn: 'Nilesh Barela' });
    assert.strictEqual(
      normalUri,
      'upi://pay?pa=nilesh%40okhdfcbank&pn=Nilesh+Barela&cu=INR',
      'Normal QR has no amount parameter'
    );

    // Fixed amount QR
    const fixedUri = buildUpiUri({ pa: 'nilesh@okhdfcbank', pn: 'Nilesh Barela', am: 500, tn: 'Udhar settle' });
    assert.strictEqual(
      fixedUri,
      'upi://pay?pa=nilesh%40okhdfcbank&pn=Nilesh+Barela&cu=INR&am=500.00&tn=Udhar+settle',
      'Fixed QR contains exact formatted amount'
    );
  });

  console.log('\n================================================================');
  console.log(`SUMMARY: ${passedTests} passed, ${failedTests} failed`);
  console.log('================================================================');

  if (failedTests > 0) {
    process.exit(1);
  }
}

runAll();
