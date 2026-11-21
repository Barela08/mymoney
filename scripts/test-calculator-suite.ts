import { pool, query } from '../server/db';

function roundMoney(val: number): number {
  return Math.round((val + Number.EPSILON) * 100) / 100;
}

// 1. GST Calculator Formula
function calculateGST(amount: number, percent: number, type: 'add' | 'remove' = 'add') {
  if (amount <= 0 || percent < 0) return null;
  if (type === 'add') {
    const tax = roundMoney((amount * percent) / 100);
    const finalAmt = roundMoney(amount + tax);
    return { original: amount, percent, tax, final: finalAmt };
  } else {
    const base = roundMoney(amount / (1 + percent / 100));
    const tax = roundMoney(amount - base);
    return { original: amount, percent, tax, final: base };
  }
}

// 2. Offer / Discount Calculator Formula
function calculateOffer(originalAmount: number, discountPercent: number) {
  if (originalAmount <= 0 || discountPercent < 0 || discountPercent > 100) return null;
  const discountAmount = roundMoney((originalAmount * discountPercent) / 100);
  const finalPrice = roundMoney(Math.max(0, originalAmount - discountAmount));
  const savings = discountAmount;
  return { original: originalAmount, discountPercent, discountAmount, finalPrice, savings };
}

// 3. Split Calculator Formula
function calculateSplit(totalAmount: number, peopleCount: number) {
  if (totalAmount <= 0 || peopleCount <= 0 || !Number.isInteger(peopleCount)) return null;

  const totalPaise = Math.round(totalAmount * 100);
  const basePaisePerPerson = Math.floor(totalPaise / peopleCount);
  const remainderPaise = totalPaise % peopleCount;

  const basePerPerson = basePaisePerPerson / 100;
  const higherPerPerson = (basePaisePerPerson + 1) / 100;
  const peoplePayingHigher = remainderPaise;
  const peoplePayingBase = peopleCount - remainderPaise;

  const exactAverage = roundMoney(totalAmount / peopleCount);

  // Verification check: total sum of all people MUST equal totalAmount exactly
  const verifiedTotal = roundMoney(
    (peoplePayingBase * basePerPerson) + (peoplePayingHigher * higherPerPerson)
  );

  return {
    totalAmount,
    peopleCount,
    exactAverage,
    basePerPerson,
    higherPerPerson,
    remainderPaise,
    remainderAmount: roundMoney(remainderPaise / 100),
    peoplePayingBase,
    peoplePayingHigher,
    verifiedTotal,
    hasRemainder: remainderPaise > 0,
  };
}

async function runTests() {
  console.log('====================================================');
  console.log('🧪 MY MONEY MANAGER — CALCULATOR UPGRADE TEST SUITE');
  console.log('====================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, desc: string) {
    if (condition) {
      console.log(`  ✅ PASS: ${desc}`);
      passed++;
    } else {
      console.error(`  ❌ FAIL: ${desc}`);
      failed++;
    }
  }

  // TEST 1: GST CALCULATIONS
  console.log('--- 1. GST Test Cases ---');
  const gst5 = calculateGST(1000, 5);
  assert(gst5?.tax === 50 && gst5?.final === 1050, 'GST 5% on ₹1,000 -> Tax ₹50, Final ₹1,050');

  const gst12 = calculateGST(1000, 12);
  assert(gst12?.tax === 120 && gst12?.final === 1120, 'GST 12% on ₹1,000 -> Tax ₹120, Final ₹1,120');

  const gst15 = calculateGST(1000, 15);
  assert(gst15?.tax === 150 && gst15?.final === 1150, 'GST 15% on ₹1,000 -> Tax ₹150, Final ₹1,150 (Prompt Example)');

  const gst18 = calculateGST(1000, 18);
  assert(gst18?.tax === 180 && gst18?.final === 1180, 'GST 18% on ₹1,000 -> Tax ₹180, Final ₹1,180');

  const gst28 = calculateGST(1000, 28);
  assert(gst28?.tax === 280 && gst28?.final === 1280, 'GST 28% on ₹1,000 -> Tax ₹280, Final ₹1,280');

  const gstCustom = calculateGST(2450.50, 7.5);
  assert(gstCustom?.tax === 183.79 && gstCustom?.final === 2634.29, 'Custom 7.5% GST on decimal ₹2,450.50 -> Tax ₹183.79, Final ₹2,634.29');

  const gstReverse = calculateGST(1150, 15, 'remove');
  assert(gstReverse?.final === 1000 && gstReverse?.tax === 150, 'Reverse GST 15% on ₹1,150 -> Base ₹1,000, Tax ₹150');

  // TEST 2: OFFER / DISCOUNT CALCULATIONS
  console.log('\n--- 2. Offer / Discount Test Cases ---');
  const offer10 = calculateOffer(1000, 10);
  assert(offer10?.discountAmount === 100 && offer10?.finalPrice === 900, 'Offer 10% on ₹1,000 -> Discount ₹100, Final ₹900');

  const offer15 = calculateOffer(1000, 15);
  assert(
    offer15?.discountAmount === 150 && offer15?.finalPrice === 850 && offer15?.savings === 150,
    'Offer 15% on ₹1,000 -> Discount ₹150, Final ₹850, Savings ₹150 (Prompt Example)'
  );

  const offer50 = calculateOffer(1000, 50);
  assert(offer50?.discountAmount === 500 && offer50?.finalPrice === 500, 'Offer 50% on ₹1,000 -> Discount ₹500, Final ₹500');

  const offer90 = calculateOffer(1000, 90);
  assert(offer90?.discountAmount === 900 && offer90?.finalPrice === 100, 'Offer 90% on ₹1,000 -> Discount ₹900, Final ₹100');

  const offer100 = calculateOffer(1000, 100);
  assert(offer100?.discountAmount === 1000 && offer100?.finalPrice === 0, 'Offer 100% (Free) -> Discount ₹1,000, Final Price ₹0');

  const offerCustom = calculateOffer(3499.99, 33.33);
  assert(offerCustom?.discountAmount === 1166.55 && offerCustom?.finalPrice === 2333.44, 'Custom 33.33% off on ₹3,499.99 decimal');

  // TEST 3: SPLIT CALCULATIONS & REMAINDER DISTRIBUTION
  console.log('\n--- 3. Split Test Cases ---');
  const split2 = calculateSplit(1000, 2);
  assert(split2?.exactAverage === 500 && !split2?.hasRemainder, 'Split ₹1,000 by 2 -> Exactly ₹500.00 each');

  const split6 = calculateSplit(1200, 6);
  assert(
    split6?.exactAverage === 200 && !split6?.hasRemainder,
    'Split ₹1,200 by 6 -> Exactly ₹200.00 each (Prompt Example)'
  );

  const split3 = calculateSplit(1000, 3);
  assert(
    split3?.basePerPerson === 333.33 &&
    split3?.higherPerPerson === 333.34 &&
    split3?.peoplePayingBase === 2 &&
    split3?.peoplePayingHigher === 1 &&
    split3?.verifiedTotal === 1000,
    'Split ₹1,000 by 3 -> 2 people pay ₹333.33, 1 person pays ₹333.34 (Exact Total ₹1,000.00 without losing money)'
  );

  const split7 = calculateSplit(100, 7);
  assert(
    split7?.basePerPerson === 14.28 &&
    split7?.higherPerPerson === 14.29 &&
    split7?.peoplePayingBase === 3 &&
    split7?.peoplePayingHigher === 4 &&
    split7?.verifiedTotal === 100,
    'Split ₹100 by 7 -> 3 pay ₹14.28, 4 pay ₹14.29 (Exact Total ₹100.00)'
  );

  const split10 = calculateSplit(2575, 10);
  assert(split10?.exactAverage === 257.5, 'Split ₹2,575 by 10 -> ₹257.50 each');

  // TEST 4: EDGE CASES & VALIDATIONS
  console.log('\n--- 4. Edge Cases & Protection ---');
  assert(calculateGST(0, 18) === null, 'GST on 0 amount returns null (invalid)');
  assert(calculateGST(-100, 18) === null, 'GST on negative amount returns null (protected)');
  assert(calculateGST(100, -5) === null, 'GST with negative percentage returns null (protected)');

  assert(calculateOffer(100, -10) === null, 'Offer with negative percentage returns null (protected)');
  assert(calculateOffer(100, 110) === null, 'Offer > 100% returns null (protected)');

  assert(calculateSplit(1000, 0) === null, 'Split by 0 people returns null (Zero Division Protected)');
  assert(calculateSplit(1000, -2) === null, 'Split by negative people returns null (protected)');
  assert(calculateSplit(1000, 2.5) === null, 'Split by float people returns null (Must be integer)');

  // TEST 5: DATABASE CONNECTIVITY & TABLE SCHEMAS
  console.log('\n--- 5. Database Schema & Persistence Verification ---');
  try {
    const histTable = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'calculator_history' AND table_schema = 'public'
    `);
    assert(histTable.rows.length >= 6, 'Table public.calculator_history exists with expected columns');

    const settTable = await query(`
      SELECT column_name, data_type 
      FROM information_schema.columns 
      WHERE table_name = 'user_calculator_settings' AND table_schema = 'public'
    `);
    assert(settTable.rows.length >= 5, 'Table public.user_calculator_settings exists with expected columns');

    // Test inserting a test record and fetching it
    const testUser = await query(`SELECT id FROM public.app_users LIMIT 1`);
    if (testUser.rows.length > 0) {
      const uid = testUser.rows[0].id;
      const insRes = await query(`
        INSERT INTO public.calculator_history (user_id, calc_type, title, input_values, result_values)
        VALUES ($1, 'gst', 'Test GST Calculation', '{"amount":1000,"gst_percent":15}'::jsonb, '{"gst_amount":150,"final_amount":1150}'::jsonb)
        RETURNING id
      `, [uid]);
      assert(Boolean(insRes.rows[0]?.id), 'Successfully inserted test record into calculator_history');

      // Cleanup test record
      await query(`DELETE FROM public.calculator_history WHERE id = $1`, [insRes.rows[0].id]);
      assert(true, 'Successfully cleaned up test record from calculator_history');
    }
  } catch (dbErr: any) {
    console.error('Database check error:', dbErr.message);
    failed++;
  }

  console.log('\n====================================================');
  console.log(`📊 TEST SUITE SUMMARY: ${passed} PASSED, ${failed} FAILED`);
  console.log('====================================================\n');

  try {
    await pool.end();
  } catch {}

  if (failed > 0) {
    process.exit(1);
  } else {
    process.exit(0);
  }
}

runTests();
