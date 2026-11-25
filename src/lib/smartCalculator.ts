/**
 * Smart Calculator engine — pure, decimal-safe financial math for the
 * Unified Calculator (normal arithmetic, GST, discount and bill split).
 *
 * All monetary results are integer paise. Expression evaluation runs on a
 * fixed 4-decimal scaled integer (no eval, no floating-point drift on
 * addition/subtraction) and only converts to paise at the boundary.
 */

export type CalculatorMode = 'normal' | 'gst' | 'offer' | 'split';

export type CalcOutcome<T> = { ok: true; value: T } | { ok: false; error: string };

const SCALE = 10000; // 4 decimal places of internal precision
const MAX_RUPEES = 999_999_999.99;

const DISPLAY_OPERATORS = ['+', '−', '×', '÷'] as const;
export type DisplayOperator = (typeof DISPLAY_OPERATORS)[number];

/** Convert a rupee amount to integer paise without float drift. */
export function toPaise(rupees: number): number {
  return Math.round((rupees + Number.EPSILON) * 100);
}

/** Convert integer paise to a rupee number (2 decimals). */
export function fromPaise(paise: number): number {
  return Math.round(paise) / 100;
}

/** Parse a user-typed amount string into integer paise, or null if invalid. */
export function parseAmountToPaise(raw: string | number | null | undefined): number | null {
  if (raw === null || raw === undefined) return null;
  const text = String(raw).replace(/,/g, '').replace(/[₹\s]/g, '').trim();
  if (!text) return null;
  if (!/^\d*\.?\d*$/.test(text)) return null;
  const value = Number(text);
  if (!Number.isFinite(value) || value < 0 || value > MAX_RUPEES) return null;
  return toPaise(value);
}

// ---------------------------------------------------------------------------
// Expression evaluation
// ---------------------------------------------------------------------------

type Token = { kind: 'num'; scaled: number } | { kind: 'op'; op: string };

const PRECEDENCE: Record<string, number> = { '+': 1, '-': 1, '*': 2, '/': 2 };

function normalizeExpression(raw: string): string {
  return (raw || '')
    .replace(/,/g, '')
    .replace(/[₹\s]/g, '')
    .replace(/−/g, '-')
    .replace(/×/g, '*')
    .replace(/÷/g, '/')
    .replace(/=+$/g, '');
}

function mulScaled(a: number, b: number): number {
  const product = a * b;
  if (Number.isSafeInteger(product)) return Math.round(product / SCALE);
  return Math.round((a / SCALE) * b);
}

/**
 * Safely evaluate an arithmetic expression with standard operator precedence.
 * Supports + − × ÷, decimals and postfix % (x% = x / 100).
 * Returns the exact result in integer paise.
 */
export function evaluateExpression(raw: string): CalcOutcome<number> {
  const src = normalizeExpression(raw);
  if (!src) return { ok: false, error: 'Enter an amount.' };

  const tokens: Token[] = [];
  let index = 0;
  let expectNumber = true;

  while (index < src.length) {
    const ch = src[index];

    if (expectNumber) {
      const start = index;
      if (ch === '-') index += 1;
      let digits = 0;
      let dots = 0;
      while (index < src.length && /[0-9.]/.test(src[index])) {
        if (src[index] === '.') dots += 1;
        else digits += 1;
        index += 1;
      }
      if (digits === 0 || dots > 1) {
        return { ok: false, error: 'Enter a valid number.' };
      }
      const numeric = Number(src.slice(start, index));
      if (!Number.isFinite(numeric) || Math.abs(numeric) > MAX_RUPEES) {
        return { ok: false, error: 'Number is too large.' };
      }
      let scaled = Math.round(numeric * SCALE);
      if (src[index] === '%') {
        scaled = Math.round(scaled / 100);
        index += 1;
      }
      tokens.push({ kind: 'num', scaled });
      expectNumber = false;
      continue;
    }

    if (ch === '+' || ch === '-' || ch === '*' || ch === '/') {
      tokens.push({ kind: 'op', op: ch });
      expectNumber = true;
      index += 1;
      continue;
    }

    return { ok: false, error: 'Invalid expression.' };
  }

  if (expectNumber) return { ok: false, error: 'Incomplete expression.' };

  // Shunting-yard to RPN.
  const output: Token[] = [];
  const ops: string[] = [];
  for (const token of tokens) {
    if (token.kind === 'num') {
      output.push(token);
    } else {
      while (ops.length > 0 && PRECEDENCE[ops[ops.length - 1]] >= PRECEDENCE[token.op]) {
        output.push({ kind: 'op', op: ops.pop() as string });
      }
      ops.push(token.op);
    }
  }
  while (ops.length > 0) output.push({ kind: 'op', op: ops.pop() as string });

  const stack: number[] = [];
  for (const token of output) {
    if (token.kind === 'num') {
      stack.push(token.scaled);
      continue;
    }
    const right = stack.pop();
    const left = stack.pop();
    if (left === undefined || right === undefined) {
      return { ok: false, error: 'Invalid expression.' };
    }
    let result: number;
    switch (token.op) {
      case '+':
        result = left + right;
        break;
      case '-':
        result = left - right;
        break;
      case '*':
        result = mulScaled(left, right);
        break;
      case '/':
        if (right === 0) return { ok: false, error: 'Cannot divide by zero.' };
        result = Math.round((left * SCALE) / right);
        break;
      default:
        return { ok: false, error: 'Invalid expression.' };
    }
    if (!Number.isFinite(result) || !Number.isSafeInteger(result)) {
      return { ok: false, error: 'Number is too large.' };
    }
    stack.push(result);
  }

  if (stack.length !== 1) return { ok: false, error: 'Invalid expression.' };
  const paise = Math.round(stack[0] / 100);
  if (!Number.isFinite(paise) || Math.abs(paise) > MAX_RUPEES * 100) {
    return { ok: false, error: 'Number is too large.' };
  }
  return { ok: true, value: paise };
}

/** Live display helper: evaluates a still-in-progress expression. */
export function evaluateForDisplay(raw: string): number | null {
  const cleaned = normalizeExpression(raw).replace(/[+\-*/]+$/g, '');
  if (!cleaned) return 0;
  const result = evaluateExpression(cleaned);
  return result.ok ? result.value : null;
}

// ---------------------------------------------------------------------------
// Keypad expression editing helpers (pure, unit-testable)
// ---------------------------------------------------------------------------

const KEYPAD_OPERATOR_BY_CHAR: Record<string, string> = {
  '+': '+',
  '−': '−',
  '-': '−',
  '×': '×',
  '*': '×',
  '÷': '÷',
  '/': '÷',
};

export function isOperatorChar(ch: string): boolean {
  return Object.prototype.hasOwnProperty.call(KEYPAD_OPERATOR_BY_CHAR, ch);
}

function lastNumberSegment(expression: string): string {
  const match = expression.match(/(\d*\.?\d*)%?$/);
  return match ? match[0] : '';
}

export function appendDigit(expression: string, digit: string): string {
  const segment = lastNumberSegment(expression);
  if (segment.endsWith('%')) return expression + '×' + digit;
  if (segment === '0') return expression.slice(0, -1) + digit;
  return expression + digit;
}

export function appendDoubleZero(expression: string): string {
  const segment = lastNumberSegment(expression);
  if (segment.endsWith('%')) return expression + '×00';
  if (segment === '' || segment === '0') return expression === '' ? '0' : expression;
  return expression + '00';
}

export function appendDecimal(expression: string): string {
  const segment = lastNumberSegment(expression);
  if (segment.includes('.') || segment.endsWith('%')) return expression;
  if (segment === '') return expression + '0.';
  return expression + '.';
}

export function appendOperator(expression: string, operator: string): string {
  const symbol = KEYPAD_OPERATOR_BY_CHAR[operator] || operator;
  if (!expression) return symbol === '−' ? '−' : '';
  const last = expression.slice(-1);
  if (isOperatorChar(last)) return expression.slice(0, -1) + symbol;
  if (last === '.') return expression + '0' + symbol;
  return expression + symbol;
}

export function appendPercent(expression: string): string {
  const segment = lastNumberSegment(expression);
  if (!segment || segment.endsWith('%') || segment.includes('.')) {
    return segment && !segment.endsWith('%') ? expression + '%' : expression;
  }
  return expression + '%';
}

export function backspaceExpression(expression: string): string {
  if (!expression) return '';
  if (expression.endsWith('%')) return expression.slice(0, -1);
  return expression.slice(0, -1);
}

// ---------------------------------------------------------------------------
// GST
// ---------------------------------------------------------------------------

export type GstOperation = 'add' | 'remove';
export type GstTaxType = 'intra' | 'inter';

export interface GstBreakdown {
  originalPaise: number;
  taxablePaise: number;
  gstPaise: number;
  cgstPaise: number;
  sgstPaise: number;
  igstPaise: number;
  totalPaise: number;
  ratePercent: number;
  operation: GstOperation;
  taxType: GstTaxType;
}

/**
 * GST with add (exclusive) / remove (inclusive, reverse) support.
 * Rates accept any 0–100 value, including decimals.
 */
export function calculateGst(
  amountPaise: number,
  ratePercent: number,
  operation: GstOperation,
  taxType: GstTaxType = 'intra'
): CalcOutcome<GstBreakdown> {
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    return { ok: false, error: 'Enter an amount to calculate GST.' };
  }
  if (!Number.isFinite(ratePercent) || ratePercent < 0 || ratePercent > 100) {
    return { ok: false, error: 'GST rate must be between 0% and 100%.' };
  }

  let taxablePaise: number;
  let gstPaise: number;
  let totalPaise: number;

  if (operation === 'add') {
    taxablePaise = amountPaise;
    gstPaise = Math.round((amountPaise * ratePercent) / 100);
    totalPaise = taxablePaise + gstPaise;
  } else {
    // amount is GST-inclusive: base = amount / (1 + rate/100)
    taxablePaise = Math.round((amountPaise * 100) / (100 + ratePercent));
    gstPaise = amountPaise - taxablePaise;
    totalPaise = amountPaise;
  }

  const cgstPaise = taxType === 'intra' ? Math.floor(gstPaise / 2) : 0;
  const sgstPaise = taxType === 'intra' ? gstPaise - cgstPaise : 0;
  const igstPaise = taxType === 'inter' ? gstPaise : 0;

  return {
    ok: true,
    value: {
      originalPaise: amountPaise,
      taxablePaise,
      gstPaise,
      cgstPaise,
      sgstPaise,
      igstPaise,
      totalPaise,
      ratePercent,
      operation,
      taxType,
    },
  };
}

// ---------------------------------------------------------------------------
// Offer / discount
// ---------------------------------------------------------------------------

export type DiscountType = 'percent' | 'fixed';

export interface DiscountBreakdown {
  originalPaise: number;
  discountPaise: number;
  finalPaise: number;
  savingsPaise: number;
  type: DiscountType;
  value: number;
}

export function calculateDiscount(
  amountPaise: number,
  type: DiscountType,
  value: number
): CalcOutcome<DiscountBreakdown> {
  if (!Number.isFinite(amountPaise) || amountPaise <= 0) {
    return { ok: false, error: 'Enter an original amount.' };
  }
  if (!Number.isFinite(value) || value < 0) {
    return { ok: false, error: 'Discount cannot be negative.' };
  }

  let discountPaise: number;
  if (type === 'percent') {
    if (value > 100) return { ok: false, error: 'Discount percentage cannot exceed 100%.' };
    discountPaise = Math.round((amountPaise * value) / 100);
  } else {
    discountPaise = Math.round(value * 100);
    if (discountPaise > amountPaise) {
      return { ok: false, error: 'Discount cannot exceed the original amount.' };
    }
  }

  const finalPaise = amountPaise - discountPaise;
  return {
    ok: true,
    value: {
      originalPaise: amountPaise,
      discountPaise,
      finalPaise,
      savingsPaise: discountPaise,
      type,
      value,
    },
  };
}

// ---------------------------------------------------------------------------
// Split bill
// ---------------------------------------------------------------------------

export const MAX_SPLIT_PEOPLE = 50;

export interface SplitBreakdown {
  totalPaise: number;
  people: number;
  perPersonPaise: number;
  basePerPersonPaise: number;
  higherPerPersonPaise: number;
  peoplePayingHigher: number;
  peoplePayingBase: number;
  remainderPaise: number;
  customSharesPaise: number[] | null;
  allocatedPaise: number;
  unallocatedPaise: number;
  mySharePaise: number;
}

export function splitBill(
  billPaise: number,
  people: number,
  options: { tipPaise?: number; customShares?: number[] | null } = {}
): CalcOutcome<SplitBreakdown> {
  const tipPaise = options.tipPaise ?? 0;
  const totalPaise = billPaise + tipPaise;

  if (!Number.isFinite(billPaise) || billPaise < 0) {
    return { ok: false, error: 'Enter the total bill amount.' };
  }
  if (!Number.isFinite(tipPaise) || tipPaise < 0) {
    return { ok: false, error: 'Tip / extra charges cannot be negative.' };
  }
  if (totalPaise <= 0) {
    return { ok: false, error: 'Enter a total bill amount.' };
  }
  if (!Number.isInteger(people) || people < 1) {
    return { ok: false, error: 'Number of people must be at least 1.' };
  }
  if (people > MAX_SPLIT_PEOPLE) {
    return { ok: false, error: `Number of people cannot exceed ${MAX_SPLIT_PEOPLE}.` };
  }

  const basePerPersonPaise = Math.floor(totalPaise / people);
  const remainderPaise = totalPaise % people;
  const higherPerPersonPaise = basePerPersonPaise + 1;
  const perPersonPaise = Math.round(totalPaise / people);

  let customSharesPaise: number[] | null = null;
  let allocatedPaise = totalPaise;
  let unallocatedPaise = 0;
  let mySharePaise = perPersonPaise;

  if (options.customShares) {
    if (options.customShares.length !== people) {
      return { ok: false, error: 'Enter a share for every person.' };
    }
    if (options.customShares.some((share) => !Number.isFinite(share) || share < 0)) {
      return { ok: false, error: 'Shares cannot be negative.' };
    }
    customSharesPaise = options.customShares.map((share) => Math.round(share));
    allocatedPaise = customSharesPaise.reduce((sum, share) => sum + share, 0);
    unallocatedPaise = totalPaise - allocatedPaise;
    if (unallocatedPaise !== 0) {
      return {
        ok: false,
        error:
          unallocatedPaise > 0
            ? `₹${(unallocatedPaise / 100).toFixed(2)} is still unallocated.`
            : `Custom shares exceed the bill by ₹${(Math.abs(unallocatedPaise) / 100).toFixed(2)}.`,
      };
    }
    mySharePaise = customSharesPaise[0] ?? perPersonPaise;
  }

  return {
    ok: true,
    value: {
      totalPaise,
      people,
      perPersonPaise,
      basePerPersonPaise,
      higherPerPersonPaise,
      peoplePayingHigher: remainderPaise,
      peoplePayingBase: people - remainderPaise,
      remainderPaise,
      customSharesPaise,
      allocatedPaise,
      unallocatedPaise,
      mySharePaise,
    },
  };
}

/** Live reconciliation helper for the custom-shares editor. */
export function reconcileShares(
  totalPaise: number,
  sharesPaise: number[]
): { allocatedPaise: number; unallocatedPaise: number; balanced: boolean } {
  const allocatedPaise = sharesPaise.reduce(
    (sum, share) => sum + (Number.isFinite(share) ? Math.round(share) : 0),
    0
  );
  const unallocatedPaise = totalPaise - allocatedPaise;
  return { allocatedPaise, unallocatedPaise, balanced: unallocatedPaise === 0 };
}
