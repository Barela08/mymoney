/**
 * Automated verification suite — Unified Smart Calculator
 * Product: My Money Manager by HackifyPro
 *
 * Covers: normal arithmetic + precedence, decimals, percentages, divide by
 * zero, keypad editing (digits/AC/backspace), GST add/remove with CGST/SGST and
 * IGST, custom rates, percentage/fixed discounts and validation, equal/custom
 * splits, rounding reconciliation, and tip handling.
 */

import assert from 'node:assert/strict';
import {
  appendDecimal,
  appendDigit,
  appendDoubleZero,
  appendOperator,
  appendPercent,
  backspaceExpression,
  calculateDiscount,
  calculateGst,
  evaluateExpression,
  evaluateForDisplay,
  fromPaise,
  parseAmountToPaise,
  reconcileShares,
  splitBill,
  toPaise,
} from '../src/lib/smartCalculator';

let passed = 0;
let failed = 0;
const failures: string[] = [];

function check(name: string, fn: () => void) {
  try {
    fn();
    passed += 1;
    console.log(`  PASS  ${name}`);
  } catch (error: any) {
    failed += 1;
    failures.push(name);
    console.log(`  FAIL  ${name}`);
    console.log(`        ${error?.message || error}`);
  }
}

function value(expr: string): number {
  const result = evaluateExpression(expr);
  assert.ok(result.ok, `expected "${expr}" to evaluate, got error: ${result.ok ? '' : result.error}`);
  return result.value;
}

console.log('\nUnified Smart Calculator — Verification Suite\n');

check('01. Addition, subtraction, multiplication and division', () => {
  assert.equal(value('12+8'), 2000);
  assert.equal(value('20−7'), 1300);
  assert.equal(value('6×7'), 4200);
  assert.equal(value('9÷2'), 450);
});

check('02. Operator precedence (× ÷ before + −)', () => {
  assert.equal(value('2+3×4'), 1400);
  assert.equal(value('10−6÷3'), 800);
  assert.equal(value('2+3×4−6÷2'), 1100);
});

check('03. Decimal arithmetic is exact (no float drift)', () => {
  assert.equal(value('0.1+0.2'), 30);
  assert.equal(fromPaise(value('0.1+0.2')), 0.3);
  assert.equal(value('1.05×3'), 315);
  assert.equal(value('99.99+0.01'), 10000);
});

check('04. Percentage key works as x/100', () => {
  assert.equal(value('50%'), 50);
  assert.equal(value('200×10%'), 2000);
  assert.equal(value('1000+5%'), 100005);
});

check('05. Division by zero and malformed expressions are rejected', () => {
  const zero = evaluateExpression('5÷0');
  assert.equal(zero.ok, false);
  const malformed = evaluateExpression('12++');
  assert.equal(malformed.ok, false);
  const incomplete = evaluateExpression('12+');
  assert.equal(incomplete.ok, false);
  const junk = evaluateExpression('12a');
  assert.equal(junk.ok, false);
  assert.equal(evaluateExpression('').ok, false);
});

check('06. Live display tolerates a trailing operator', () => {
  assert.equal(evaluateForDisplay('12+'), 1200);
  assert.equal(evaluateForDisplay(''), 0);
  assert.equal(evaluateForDisplay('12++'), 1200);
  assert.equal(evaluateForDisplay('12a'), null);
});

check('07. Keypad editing: digits, leading zeros, decimals and 00', () => {
  assert.equal(appendDigit('', '7'), '7');
  assert.equal(appendDigit('7', '5'), '75');
  assert.equal(appendDigit('0', '5'), '5');
  assert.equal(appendDigit('', '0'), '0');
  assert.equal(appendDoubleZero('12'), '1200');
  assert.equal(appendDoubleZero(''), '0');
  assert.equal(appendDecimal(''), '0.');
  assert.equal(appendDecimal('1.2'), '1.2');
  assert.equal(appendDecimal('12'), '12.');
});

check('08. Keypad editing: operators, percent and backspace (AC clears)', () => {
  assert.equal(appendOperator('12', '+'), '12+');
  assert.equal(appendOperator('12+', '×'), '12×');
  assert.equal(appendOperator('', '−'), '−');
  assert.equal(appendPercent('10'), '10%');
  assert.equal(backspaceExpression('123'), '12');
  assert.equal(backspaceExpression('12+'), '12');
  assert.equal(backspaceExpression(''), '');
});

check('09. Amount parsing rejects bad input and converts to paise', () => {
  assert.equal(parseAmountToPaise('1,234.56'), 123456);
  assert.equal(parseAmountToPaise('₹500'), 50000);
  assert.equal(toPaise(1180.5), 118050);
  assert.equal(parseAmountToPaise('-5'), null);
  assert.equal(parseAmountToPaise('abc'), null);
  assert.equal(parseAmountToPaise(''), null);
});

check('10. GST add: 1000 + 18% = 1180 with CGST/SGST split', () => {
  const result = calculateGst(100000, 18, 'add', 'intra');
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.taxablePaise, 100000);
  assert.equal(result.value.gstPaise, 18000);
  assert.equal(result.value.cgstPaise, 9000);
  assert.equal(result.value.sgstPaise, 9000);
  assert.equal(result.value.totalPaise, 118000);
});

check('11. GST remove (inclusive reverse): 1180 @18% → taxable 1000', () => {
  const result = calculateGst(118000, 18, 'remove', 'intra');
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.taxablePaise, 100000);
  assert.equal(result.value.gstPaise, 18000);
  assert.equal(result.value.totalPaise, 118000);
});

check('12. IGST breakdown has no CGST/SGST', () => {
  const result = calculateGst(100000, 18, 'add', 'inter');
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.igstPaise, 18000);
  assert.equal(result.value.cgstPaise, 0);
  assert.equal(result.value.sgstPaise, 0);
});

check('13. Custom and standard GST rates (5, 12, 28, 7.5)', () => {
  const five = calculateGst(200000, 5, 'add');
  const twelve = calculateGst(200000, 12, 'add');
  const twentyEight = calculateGst(200000, 28, 'add');
  const custom = calculateGst(100000, 7.5, 'add');
  assert.ok(five.ok && twelve.ok && twentyEight.ok && custom.ok);
  if (!five.ok || !twelve.ok || !twentyEight.ok || !custom.ok) return;
  assert.equal(five.value.gstPaise, 10000);
  assert.equal(twelve.value.gstPaise, 24000);
  assert.equal(twentyEight.value.gstPaise, 56000);
  assert.equal(custom.value.gstPaise, 7500);
});

check('14. GST validates amount and rate bounds', () => {
  assert.equal(calculateGst(0, 18, 'add').ok, false);
  assert.equal(calculateGst(100000, -1, 'add').ok, false);
  assert.equal(calculateGst(100000, 101, 'add').ok, false);
});

check('15. Percentage discount: 2000 with 20% → 1600, save 400', () => {
  const result = calculateDiscount(200000, 'percent', 20);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.discountPaise, 40000);
  assert.equal(result.value.finalPaise, 160000);
  assert.equal(result.value.savingsPaise, 40000);
});

check('16. Fixed discount and validation', () => {
  const fixed = calculateDiscount(200000, 'fixed', 500);
  assert.ok(fixed.ok);
  if (!fixed.ok) return;
  assert.equal(fixed.value.discountPaise, 50000);
  assert.equal(fixed.value.finalPaise, 150000);

  assert.equal(calculateDiscount(200000, 'percent', 101).ok, false);
  assert.equal(calculateDiscount(200000, 'fixed', 2500).ok, false);
  assert.equal(calculateDiscount(200000, 'fixed', -10).ok, false);
  assert.equal(calculateDiscount(0, 'percent', 10).ok, false);
});

check('17. Equal split: 1200 among 4 → 300 each, no remainder', () => {
  const result = splitBill(120000, 4);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.perPersonPaise, 30000);
  assert.equal(result.value.remainderPaise, 0);
  assert.equal(result.value.mySharePaise, 30000);
});

check('18. Rounding reconciles exactly: 1000 among 3', () => {
  const result = splitBill(100000, 3);
  assert.ok(result.ok);
  if (!result.ok) return;
  assert.equal(result.value.basePerPersonPaise, 33333);
  assert.equal(result.value.higherPerPersonPaise, 33334);
  assert.equal(result.value.peoplePayingHigher, 1);
  assert.equal(result.value.peoplePayingBase, 2);
  assert.equal(result.value.remainderPaise, 1);
  const total = result.value.basePerPersonPaise * 2 + result.value.higherPerPersonPaise;
  assert.equal(total, 100000);
});

check('19. Custom shares reconcile against the bill', () => {
  const balanced = splitBill(120000, 4, { customShares: [40000, 30000, 30000, 20000] });
  assert.ok(balanced.ok);
  if (balanced.ok) {
    assert.equal(balanced.value.mySharePaise, 40000);
    assert.equal(balanced.value.unallocatedPaise, 0);
  }
  const unbalanced = splitBill(120000, 4, { customShares: [30000, 30000, 30000, 10000] });
  assert.equal(unbalanced.ok, false);
  const reconcile = reconcileShares(120000, [40000, 30000, 30000, 20000]);
  assert.equal(reconcile.balanced, true);
  assert.equal(reconcile.unallocatedPaise, 0);
  const short = reconcileShares(120000, [30000, 30000, 30000, 10000]);
  assert.equal(short.balanced, false);
  assert.equal(short.unallocatedPaise, 20000);
});

check('20. Split supports tip and validates people count', () => {
  const tipped = splitBill(120000, 4, { tipPaise: 10000 });
  assert.ok(tipped.ok);
  if (tipped.ok) {
    assert.equal(tipped.value.totalPaise, 130000);
    assert.equal(tipped.value.perPersonPaise, 32500);
  }
  assert.equal(splitBill(120000, 0).ok, false);
  assert.equal(splitBill(120000, 2.5 as unknown as number).ok, false);
  assert.equal(splitBill(120000, -2).ok, false);
});

console.log(`\nSmart Calculator Suite Summary: ${passed} passed, ${failed} failed.`);
if (failed > 0) {
  console.log(`Failures: ${failures.join(', ')}`);
  process.exit(1);
}
