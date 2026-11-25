export const UDHAR_CATEGORIES = [
  'Personal Loan',
  'Emergency',
  'Business',
  'Family',
  'Shopping',
  'Medical',
  'Education',
  'Travel',
  'Rent',
  'Other',
] as const;

export type UdharCategory = (typeof UDHAR_CATEGORIES)[number];

export const UDHAR_PAYMENT_METHODS = [
  'UPI',
  'Cash',
  'Bank Transfer',
  'Card',
  'Wallet',
  'Other',
] as const;

export type UdharPaymentMethod = (typeof UDHAR_PAYMENT_METHODS)[number];

export interface CanonicalUdharRecord {
  id: string;
  link_id: string;
  lender_user_id: string | null;
  borrower_user_id: string | null;
  lender_name: string;
  borrower_name: string;
  original_amount: number;
  paid_amount: number;
  remaining_amount: number;
  status: 'pending_confirmation' | 'confirmed' | 'active' | 'disputed' | 'settled' | 'cancelled';
  category?: UdharCategory | string;
  description?: string | null;
  payment_method?: UdharPaymentMethod | string;
  transaction_date: string;
  due_date?: string | null;
  notes?: string | null;
  attachment_url?: string | null;
  is_shared: boolean;
}

export interface UdharPerspectiveView {
  direction: 'gave' | 'took';
  role: 'lender' | 'borrower';
  counterpartUserId: string | null;
  counterpartName: string;
  actionLabel: "You'll Receive" | "You'll Pay";
  originalAmount: number;
  paidAmount: number;
  remainingAmount: number;
  status: CanonicalUdharRecord['status'];
}

export interface RepaymentValidationInput {
  originalAmount: number;
  confirmedPaidAmount: number;
  pendingRepaymentsAmount: number;
  repayAmount: number;
  isShared: boolean;
  actorRole: 'lender' | 'borrower';
  udharStatus: string;
}

export interface RepaymentValidationResult {
  valid: boolean;
  error?: string;
  repaymentStatus?: 'confirmed' | 'pending_confirmation';
  nextPaidAmount?: number;
  nextRemainingAmount?: number;
  nextUdharStatus?: 'confirmed' | 'settled';
  isSettled?: boolean;
}

export interface UdharAuditFieldChange {
  changed_field: string;
  previous_value: string | null;
  new_value: string | null;
}

export interface ParsedQrPayload {
  valid: boolean;
  kind?: 'json' | 'pair_url' | 'pair_code' | 'hex_token';
  token?: string;
  code?: string;
  userId?: string;
  name?: string;
  email?: string;
  isUpiPaymentQr?: boolean;
  errorCode?: 'EMPTY_QR' | 'UPI_QR_NOT_PAIRING' | 'MALFORMED_QR' | 'INVALID_QR';
  error?: string;
}

export type LiveSearchQueryMode =
  | 'too_short'
  | 'name'
  | 'email_exact'
  | 'email_incomplete'
  | 'phone_exact'
  | 'phone_incomplete';

export interface ClassifiedSearchQuery {
  mode: LiveSearchQueryMode;
  normalized: string;
  digitsOnly: string;
  last10Digits: string;
}

export function roundMoney(value: number): number {
  return Math.round((Number(value) + Number.EPSILON) * 100) / 100;
}

/**
 * Normalize live search input: trim, collapse internal whitespace, Unicode-safe lowercase.
 */
export function normalizeSearchQuery(raw: string): string {
  if (!raw || typeof raw !== 'string') return '';
  return raw.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Classify live search input for privacy-preserving lookup:
 *  - Email lookup requires a complete valid email (prevents partial email enumeration).
 *  - Mobile lookup normalizes country code/punctuation and requires at least 10 digits.
 *  - Name lookup supports partial matching (min 2 chars) returning minimal identity only.
 */
export function classifyLiveSearchQuery(raw: string): ClassifiedSearchQuery {
  const normalized = normalizeSearchQuery(raw);
  const digitsOnly = normalized.replace(/\D/g, '');
  const last10Digits = digitsOnly.length >= 10 ? digitsOnly.slice(-10) : digitsOnly;

  if (!normalized || normalized.length < 2) {
    return { mode: 'too_short', normalized, digitsOnly, last10Digits };
  }

  // Email intent
  if (normalized.includes('@')) {
    const emailStrictRegex = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
    if (emailStrictRegex.test(normalized)) {
      return { mode: 'email_exact', normalized, digitsOnly, last10Digits };
    }
    return { mode: 'email_incomplete', normalized, digitsOnly, last10Digits };
  }

  // Phone intent (digits, +, -, spaces, parens only and at least 4 digits)
  const looksLikePhone = /^[+\d][\d\s\-().]*$/.test(normalized) && digitsOnly.length >= 4;
  if (looksLikePhone) {
    if (digitsOnly.length >= 10 && digitsOnly.length <= 15) {
      return { mode: 'phone_exact', normalized, digitsOnly, last10Digits };
    }
    return { mode: 'phone_incomplete', normalized, digitsOnly, last10Digits };
  }

  return { mode: 'name', normalized, digitsOnly, last10Digits };
}

/**
 * Detect UPI payment QR strings so they are strictly separated from Udhar Pairing QRs.
 */
export function isUpiPaymentQr(raw: string): boolean {
  const trimmed = (raw || '').trim().toLowerCase();
  return trimmed.startsWith('upi://pay') || trimmed.startsWith('upi://collect') || trimmed.startsWith('upi://mandate');
}

/**
 * Privacy-preserving email masking for unconnected users.
 */
export function maskEmailForPrivacy(email?: string | null): string {
  if (!email || !email.includes('@')) return '***@***';
  const [local, domain] = email.trim().split('@');
  if (!local || !domain) return '***@***';
  if (local.length <= 2) return `${local.charAt(0)}***@${domain}`;
  return `${local.charAt(0)}***${local.charAt(local.length - 1)}@${domain}`;
}

/**
 * Privacy-preserving mobile masking for unconnected users.
 */
export function maskPhoneForPrivacy(phone?: string | null): string | null {
  if (!phone) return null;
  const clean = phone.replace(/[\s\-()]/g, '');
  if (clean.length < 6) return '****';
  return `${clean.slice(0, 3)}****${clean.slice(-3)}`;
}

/**
 * Strict Udhar Pairing QR payload & pairing link parser.
 * Explicitly rejects UPI payment QRs so Udhar pairing and UPI payments are never mixed.
 * Accepts:
 *  1) Official JSON payload: { app: 'my-money', type: 'udhar-pair', token?, code? }
 *  2) App deep link URL containing #pair=MM-XXXXXX or ?pair=MM-XXXXXX
 *  3) Direct pairing code: MM-XXXXXX (6+ chars)
 *  4) Direct 64-char hex opaque token
 */
export function parseQrPayload(raw: string): ParsedQrPayload {
  const trimmed = (raw || '').trim();
  if (!trimmed) {
    return { valid: false, errorCode: 'EMPTY_QR', error: 'Empty QR code detected.' };
  }

  if (isUpiPaymentQr(trimmed)) {
    return {
      valid: false,
      isUpiPaymentQr: true,
      errorCode: 'UPI_QR_NOT_PAIRING',
      error: 'This is a UPI payment QR code, not a My Money Manager Udhar pairing QR. Please scan your friend\'s Udhar Pairing QR.',
    };
  }

  // 1. JSON payload
  if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
    try {
      const parsed = JSON.parse(trimmed);
      if (parsed && (parsed.app === 'my-money' || parsed.type === 'udhar-pair')) {
        const token = typeof parsed.token === 'string' ? parsed.token.trim() : undefined;
        const code = typeof parsed.code === 'string' ? parsed.code.trim().toUpperCase() : undefined;
        if (token || code) {
          const result: ParsedQrPayload = { valid: true, kind: 'json' };
          if (token !== undefined) result.token = token;
          if (code !== undefined) result.code = code;
          return result;
        }
      }
      return {
        valid: false,
        errorCode: 'INVALID_QR',
        error: 'Not a valid My Money Manager QR code for Udhar pairing. Please scan a genuine account pairing QR.',
      };
    } catch {
      return {
        valid: false,
        errorCode: 'MALFORMED_QR',
        error: 'Malformed QR payload. Please scan a genuine My Money Manager Udhar pairing QR.',
      };
    }
  }

  // 2. Pairing link (#pair=MM-XXXXXX or ?pair=MM-XXXXXX)
  const pairLinkMatch = trimmed.match(/(?:[#?&]pair=)([A-Za-z0-9_-]{6,64})/i);
  if (pairLinkMatch && pairLinkMatch[1]) {
    const val = pairLinkMatch[1].trim();
    if (/^MM-[A-Z0-9]{4,}$/i.test(val)) {
      return { valid: true, kind: 'pair_url', code: val.toUpperCase() };
    }
    if (/^[0-9a-fA-F]{64}$/.test(val)) {
      return { valid: true, kind: 'pair_url', token: val };
    }
    return { valid: true, kind: 'pair_url', code: val.toUpperCase() };
  }

  // 3. Direct pairing code (MM-XXXXXX, also tolerate whitespace around hyphen)
  const normalizedCode = trimmed.replace(/\s+/g, '').toUpperCase();
  if (/^MM-[A-Z0-9]{4,16}$/.test(normalizedCode)) {
    return { valid: true, kind: 'pair_code', code: normalizedCode };
  }

  // 4. 64-char hex opaque token
  if (/^[0-9a-fA-F]{64}$/.test(trimmed)) {
    return { valid: true, kind: 'hex_token', token: trimmed };
  }

  return {
    valid: false,
    errorCode: 'INVALID_QR',
    error: 'Not a valid My Money Manager QR code for Udhar pairing. Please scan a genuine pairing QR generated inside My Money Manager.',
  };
}

/**
 * Derive User A or User B perspective from a single canonical shared Udhar record.
 */
export function resolveCanonicalPerspective(
  record: CanonicalUdharRecord,
  viewerUserId: string
): UdharPerspectiveView | null {
  if (record.lender_user_id === viewerUserId) {
    return {
      direction: 'gave',
      role: 'lender',
      counterpartUserId: record.borrower_user_id,
      counterpartName: record.borrower_name,
      actionLabel: "You'll Receive",
      originalAmount: roundMoney(record.original_amount),
      paidAmount: roundMoney(record.paid_amount),
      remainingAmount: roundMoney(record.remaining_amount),
      status: record.status,
    };
  }
  if (record.borrower_user_id === viewerUserId) {
    return {
      direction: 'took',
      role: 'borrower',
      counterpartUserId: record.lender_user_id,
      counterpartName: record.lender_name,
      actionLabel: "You'll Pay",
      originalAmount: roundMoney(record.original_amount),
      paidAmount: roundMoney(record.paid_amount),
      remainingAmount: roundMoney(record.remaining_amount),
      status: record.status,
    };
  }
  return null;
}

/**
 * Validate and calculate the outcome of recording a repayment.
 * Enforces:
 *  - amount > 0
 *  - cannot repay cancelled or already-settled Udhar
 *  - cannot exceed remaining balance (also considers pending repayments for borrower claims to prevent duplicate over-repayment)
 *  - borrower repayments on shared Udhar start as 'pending_confirmation' (lender confirmation required)
 *  - lender repayments or local/manual Udhar repayments apply immediately ('confirmed')
 *  - remaining <= 0.01 transitions status to 'settled'
 */
export function calculateRepaymentApplication(
  input: RepaymentValidationInput
): RepaymentValidationResult {
  if (input.udharStatus === 'cancelled') {
    return { valid: false, error: 'Cannot record repayment on a cancelled Udhar.' };
  }
  if (input.udharStatus === 'settled') {
    return { valid: false, error: 'This Udhar is already fully settled.' };
  }

  const repayAmt = roundMoney(input.repayAmount);
  if (!Number.isFinite(repayAmt) || repayAmt <= 0) {
    return { valid: false, error: 'Repayment amount must be greater than ₹0.' };
  }

  const remaining = roundMoney(Math.max(0, input.originalAmount - input.confirmedPaidAmount));
  if (remaining <= 0.01) {
    return { valid: false, error: 'This Udhar has no remaining balance to repay.' };
  }

  const effectiveRemaining =
    input.isShared && input.actorRole === 'borrower'
      ? roundMoney(Math.max(0, remaining - Math.max(0, input.pendingRepaymentsAmount)))
      : remaining;

  if (repayAmt > effectiveRemaining + 0.01) {
    if (input.isShared && input.actorRole === 'borrower' && input.pendingRepaymentsAmount > 0) {
      return {
        valid: false,
        error: `Amount (₹${repayAmt}) exceeds available remaining balance (₹${effectiveRemaining}) after accounting for ₹${roundMoney(input.pendingRepaymentsAmount)} already pending lender confirmation.`,
      };
    }
    return {
      valid: false,
      error: `Repayment amount (₹${repayAmt}) cannot exceed remaining balance (₹${remaining}).`,
    };
  }

  const repaymentStatus: 'confirmed' | 'pending_confirmation' =
    input.isShared && input.actorRole === 'borrower' ? 'pending_confirmation' : 'confirmed';

  if (repaymentStatus === 'pending_confirmation') {
    return {
      valid: true,
      repaymentStatus,
      nextPaidAmount: roundMoney(input.confirmedPaidAmount),
      nextRemainingAmount: remaining,
      nextUdharStatus: 'confirmed',
      isSettled: false,
    };
  }

  const nextPaidAmount = roundMoney(input.confirmedPaidAmount + repayAmt);
  const nextRemainingAmount = roundMoney(Math.max(0, input.originalAmount - nextPaidAmount));
  const isSettled = nextRemainingAmount <= 0.01;

  return {
    valid: true,
    repaymentStatus: 'confirmed',
    nextPaidAmount: isSettled ? roundMoney(input.originalAmount) : nextPaidAmount,
    nextRemainingAmount: isSettled ? 0 : nextRemainingAmount,
    nextUdharStatus: isSettled ? 'settled' : 'confirmed',
    isSettled,
  };
}

/**
 * Validate editing an Udhar record while preserving repayment history and computing field-level audit diffs.
 */
export function validateUdharEdit(
  current: {
    original_amount: number;
    paid_amount: number;
    status: string;
    notes?: string | null;
    transaction_date: string;
    due_date?: string | null;
    category?: string | null;
    payment_method?: string | null;
    description?: string | null;
  },
  updates: {
    amount?: number;
    notes?: string | null;
    transaction_date?: string;
    due_date?: string | null;
    category?: string | null;
    payment_method?: string | null;
    description?: string | null;
    reason_for_edit?: string;
  }
): {
  valid: boolean;
  error?: string;
  nextOriginalAmount?: number;
  nextRemainingAmount?: number;
  nextStatus?: 'confirmed' | 'settled';
  isSettled?: boolean;
  changes?: UdharAuditFieldChange[];
} {
  if (current.status === 'cancelled') {
    return { valid: false, error: 'Cancelled Udhar records cannot be edited.' };
  }

  const reason = (updates.reason_for_edit || '').trim();
  if (reason.length < 3) {
    return { valid: false, error: 'Please provide a clear reason (at least 3 characters) for editing this record.' };
  }

  const nextOriginalAmount =
    updates.amount !== undefined ? roundMoney(updates.amount) : roundMoney(current.original_amount);

  if (!Number.isFinite(nextOriginalAmount) || nextOriginalAmount <= 0) {
    return { valid: false, error: 'Total amount must be greater than ₹0.' };
  }

  const paid = roundMoney(Math.max(0, current.paid_amount));
  if (nextOriginalAmount + 0.01 < paid) {
    return {
      valid: false,
      error: `New amount (₹${nextOriginalAmount}) cannot be less than already confirmed repayments (₹${paid}).`,
    };
  }

  const nextRemainingAmount = roundMoney(Math.max(0, nextOriginalAmount - paid));
  const isSettled = nextRemainingAmount <= 0.01;

  const changes: UdharAuditFieldChange[] = [];
  if (roundMoney(current.original_amount) !== nextOriginalAmount) {
    changes.push({
      changed_field: 'amount',
      previous_value: String(roundMoney(current.original_amount)),
      new_value: String(nextOriginalAmount),
    });
  }
  if (updates.transaction_date && updates.transaction_date !== current.transaction_date) {
    changes.push({
      changed_field: 'transaction_date',
      previous_value: current.transaction_date,
      new_value: updates.transaction_date,
    });
  }
  if (updates.due_date !== undefined && (updates.due_date || null) !== (current.due_date || null)) {
    changes.push({
      changed_field: 'due_date',
      previous_value: current.due_date || null,
      new_value: updates.due_date || null,
    });
  }
  if (updates.category !== undefined && (updates.category || null) !== (current.category || null)) {
    changes.push({
      changed_field: 'category',
      previous_value: current.category || null,
      new_value: updates.category || null,
    });
  }
  if (updates.payment_method !== undefined && (updates.payment_method || null) !== (current.payment_method || null)) {
    changes.push({
      changed_field: 'payment_method',
      previous_value: current.payment_method || null,
      new_value: updates.payment_method || null,
    });
  }
  if (updates.description !== undefined && (updates.description || null) !== (current.description || null)) {
    changes.push({
      changed_field: 'description',
      previous_value: current.description || null,
      new_value: updates.description || null,
    });
  }
  if (updates.notes !== undefined && (updates.notes || null) !== (current.notes || null)) {
    changes.push({
      changed_field: 'notes',
      previous_value: current.notes || null,
      new_value: updates.notes || null,
    });
  }

  return {
    valid: true,
    nextOriginalAmount,
    nextRemainingAmount: isSettled ? 0 : nextRemainingAmount,
    nextStatus: isSettled ? 'settled' : 'confirmed',
    isSettled,
    changes,
  };
}

/**
 * Cancellation guard: explicit cancellation is ONLY allowed when no confirmed or pending repayments exist.
 */
export function canCancelUdhar(udhar: {
  status: string;
  paid_amount?: number | string;
  repayments?: Array<{ status: string }>;
}): { allowed: boolean; reason?: string } {
  if (udhar.status === 'cancelled') {
    return { allowed: false, reason: 'This Udhar is already cancelled.' };
  }
  if (udhar.status === 'settled') {
    return {
      allowed: false,
      reason: 'Settled Udhar records cannot be deleted or cancelled. Keep settled history for audit integrity.',
    };
  }

  const paidAmt = parseFloat(String(udhar.paid_amount ?? 0)) || 0;
  const activeRepayments = (udhar.repayments || []).filter(
    (r) => r.status === 'confirmed' || r.status === 'pending_confirmation'
  );

  if (paidAmt > 0.01 || activeRepayments.length > 0) {
    return {
      allowed: false,
      reason:
        'Cannot cancel an Udhar that already has repayments recorded. Use Edit or record a balancing adjustment instead to preserve audit history.',
    };
  }

  return { allowed: true };
}

export interface UdharItemLike {
  direction: 'gave' | 'took';
  original_amount: number | string;
  current_balance: number | string;
  paid_amount?: number | string;
  status: string;
  due_date?: string | null;
  counterpart_user_id?: string | null;
  counterpart_name?: string;
  repayments?: Array<{ status: string }>;
}

/**
 * People-wise ledger summary: Net Balance = Total Receivable - Total Payable.
 * Separate loan records are NEVER merged, and cancelled records are excluded from balances.
 */
export function calculatePersonLedgerSummary(
  items: UdharItemLike[],
  todayStr: string = new Date().toISOString().split('T')[0]
) {
  let totalGiven = 0;
  let totalTaken = 0;
  let youWillReceive = 0;
  let youWillPay = 0;
  let settledAmount = 0;
  let overdueAmount = 0;
  let activeCount = 0;
  let settledCount = 0;
  let pendingRepaymentCount = 0;

  for (const tx of items) {
    if (tx.status === 'cancelled') continue;

    const orig = parseFloat(String(tx.original_amount)) || 0;
    const cur = parseFloat(String(tx.current_balance)) || 0;
    const isSettled = tx.status === 'settled' || cur <= 0.01;

    if (tx.direction === 'gave') {
      totalGiven += orig;
      if (!isSettled) {
        youWillReceive += cur;
        activeCount += 1;
      } else {
        settledCount += 1;
      }
    } else {
      totalTaken += orig;
      if (!isSettled) {
        youWillPay += cur;
        activeCount += 1;
      } else {
        settledCount += 1;
      }
    }

    settledAmount += Math.max(0, orig - cur);

    if (tx.due_date && tx.due_date < todayStr && !isSettled && cur > 0) {
      overdueAmount += cur;
    }

    if (Array.isArray(tx.repayments)) {
      pendingRepaymentCount += tx.repayments.filter((r) => r.status === 'pending_confirmation').length;
    }
  }

  const netBalance = roundMoney(youWillReceive - youWillPay);

  return {
    totalGiven: roundMoney(totalGiven),
    totalTaken: roundMoney(totalTaken),
    youWillReceive: roundMoney(youWillReceive),
    youWillPay: roundMoney(youWillPay),
    netBalance,
    settledAmount: roundMoney(settledAmount),
    overdueAmount: roundMoney(overdueAmount),
    activeCount,
    settledCount,
    pendingRepaymentCount,
  };
}

/**
 * Full People Dashboard metrics including connected count, active people count, and Net Balance.
 */
export function calculatePeopleDashboardSummary(
  items: UdharItemLike[],
  contacts: Array<{ linked_user_id?: string | null; name: string }>,
  todayStr: string = new Date().toISOString().split('T')[0]
) {
  const base = calculatePersonLedgerSummary(items, todayStr);
  const connectedKeys = new Set<string>();
  const manualKeys = new Set<string>();

  for (const c of contacts) {
    if (c.linked_user_id) {
      connectedKeys.add(c.linked_user_id);
    } else if (c.name) {
      manualKeys.add(c.name.trim().toLowerCase());
    }
  }

  const activePeopleSet = new Set<string>();
  let pendingConfirmationsCount = 0;

  for (const tx of items) {
    if (tx.status === 'cancelled') continue;
    const cur = parseFloat(String(tx.current_balance)) || 0;
    const isSettled = tx.status === 'settled' || cur <= 0.01;
    if (tx.counterpart_user_id) {
      connectedKeys.add(tx.counterpart_user_id);
    }
    if (!isSettled && cur > 0.01) {
      const personKey = tx.counterpart_user_id || (tx.counterpart_name || '').trim().toLowerCase();
      if (personKey) activePeopleSet.add(personKey);
    }
    if (tx.status === 'pending_confirmation') {
      pendingConfirmationsCount += 1;
    }
    if (Array.isArray(tx.repayments)) {
      pendingConfirmationsCount += tx.repayments.filter((r) => r.status === 'pending_confirmation').length;
    }
  }

  return {
    totalLent: base.totalGiven,
    totalBorrowed: base.totalTaken,
    outstandingReceivable: base.youWillReceive,
    outstandingPayable: base.youWillPay,
    netBalance: base.netBalance,
    settledAmount: base.settledAmount,
    overdueAmount: base.overdueAmount,
    totalConnectedPeople: connectedKeys.size,
    totalManualPeople: manualKeys.size,
    peopleWithActiveUdhar: activePeopleSet.size,
    pendingConfirmationsCount,
  };
}

/**
 * Financial Accounting Separation Rule (Section 26):
 * Shared Udhar transactions (category === 'people') must NEVER be counted as earned Income
 * or ordinary Expenses in personal finance summary, reports, or charts.
 */
export function calculatePersonalIncomeExpenseExcludingUdhar(
  transactions: Array<{
    category: string;
    subcategory?: string;
    transaction_type: 'income' | 'expense';
    amount: number;
    is_deleted?: boolean;
  }>
) {
  let totalIncome = 0;
  let totalExpenses = 0;
  let udharGivenExcluded = 0;
  let udharReceivedExcluded = 0;

  for (const tx of transactions) {
    if (tx.is_deleted) continue;
    const amt = Number(tx.amount) || 0;
    if (tx.category === 'people') {
      if (tx.transaction_type === 'expense') udharGivenExcluded += amt;
      else udharReceivedExcluded += amt;
      continue;
    }
    if (tx.transaction_type === 'income') {
      totalIncome += amt;
    } else if (tx.transaction_type === 'expense') {
      totalExpenses += amt;
    }
  }

  return {
    totalIncome: roundMoney(totalIncome),
    totalExpenses: roundMoney(totalExpenses),
    netPersonalSavings: roundMoney(totalIncome - totalExpenses),
    udharGivenExcluded: roundMoney(udharGivenExcluded),
    udharReceivedExcluded: roundMoney(udharReceivedExcluded),
  };
}

// ============================================================================
// Structured Metadata Packing (Backward-Compatible with Existing DB Columns)
// ============================================================================
const META_MARKER = '\n<!--MM_META:';
const META_END = '-->';

export interface UdharRichMetadata {
  category?: string;
  payment_method?: string;
  description?: string;
  transaction_ref?: string;
  repayment_time?: string;
  attachment_url?: string;
}

export function packStructuredNote(plainNote: string | null | undefined, meta: UdharRichMetadata): string | null {
  const cleanNote = (plainNote || '').trim();
  const filteredMeta: Record<string, string> = {};
  if (meta.category && meta.category.trim()) filteredMeta.category = meta.category.trim();
  if (meta.payment_method && meta.payment_method.trim()) filteredMeta.payment_method = meta.payment_method.trim();
  if (meta.description && meta.description.trim()) filteredMeta.description = meta.description.trim();
  if (meta.transaction_ref && meta.transaction_ref.trim()) filteredMeta.transaction_ref = meta.transaction_ref.trim();
  if (meta.repayment_time && meta.repayment_time.trim()) filteredMeta.repayment_time = meta.repayment_time.trim();
  if (meta.attachment_url && meta.attachment_url.trim()) filteredMeta.attachment_url = meta.attachment_url.trim();

  if (Object.keys(filteredMeta).length === 0) {
    return cleanNote || null;
  }

  return `${cleanNote}${META_MARKER}${JSON.stringify(filteredMeta)}${META_END}`.trim();
}

export function unpackStructuredNote(rawNote: string | null | undefined): {
  note: string;
  meta: UdharRichMetadata;
} {
  if (!rawNote || typeof rawNote !== 'string') {
    return { note: '', meta: {} };
  }
  const idx = rawNote.indexOf(META_MARKER);
  if (idx === -1) {
    return { note: rawNote.trim(), meta: {} };
  }
  const endIdx = rawNote.indexOf(META_END, idx + META_MARKER.length);
  if (endIdx === -1) {
    return { note: rawNote.trim(), meta: {} };
  }
  const notePart = rawNote.slice(0, idx).trim();
  const jsonPart = rawNote.slice(idx + META_MARKER.length, endIdx);
  try {
    const parsed = JSON.parse(jsonPart);
    if (parsed && typeof parsed === 'object') {
      return { note: notePart, meta: parsed as UdharRichMetadata };
    }
  } catch {
    // fallback to raw text
  }
  return { note: rawNote.trim(), meta: {} };
}
