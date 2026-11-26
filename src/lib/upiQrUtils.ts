/**
 * UPI QR Domain Utilities & DPDP Consent Copy
 * My Money Manager by HackifyPro
 *
 * Pure, deterministic helpers shared between client UI, backend APIs, and unit tests.
 * - Strictly validates UPI VPAs (rejects standard email addresses like user@gmail.com)
 * - Generates NPCI-compliant upi://pay URIs (Normal QR & Fixed Amount QR)
 * - Enforces explicit, unchecked-by-default DPDP consent before storing UPI details
 * - Never handles or stores UPI PIN, OTP, or banking passwords
 */

export const UPI_CONSENT_PURPOSE = 'upi_qr_storage' as const;
export const UPI_CONSENT_POLICY_VERSION = 'v2.1 — DPDP Act 2023 & Rules 2025';

export const UPI_CONSENT_WORDING =
  'I agree that My Money Manager may securely store and use my UPI ID and payee details to generate and display my personal UPI payment QR codes. I understand that I can update or remove this information from my settings.';

export const UPI_PRIVACY_NOTICE = {
  title: 'UPI QR Privacy Notice',
  subtitle: 'How My Money Manager by HackifyPro handles your UPI QR details',
  sections: [
    {
      heading: 'What data is collected',
      body: 'Only your UPI ID (Virtual Payment Address), optional Payee Name, and optional default Payment Note. We never ask for, collect, or store your UPI PIN, bank passwords, card details, or OTPs.',
    },
    {
      heading: 'Why it is stored',
      body: 'So you can quickly generate and display personal Normal UPI QR codes and Fixed Amount UPI QR codes from your Dashboard and Settings without re-entering your UPI ID every time.',
    },
    {
      heading: 'How it is used',
      body: 'Strictly to build standard NPCI upi://pay payment request QR codes for your own account. Scanning or generating a QR code does not automatically move money, confirm a payment, or modify your Available Balance.',
    },
    {
      heading: 'Whether it is shared',
      body: 'Your saved UPI ID is strictly private to your authenticated account and protected by Row Level Security. It is never shown in Udhar People Search, public profiles, or to other users unless you personally choose to display or share your QR code.',
    },
    {
      heading: 'Retention period',
      body: 'Stored only while you keep UPI QR enabled on your active account, or until you remove your UPI details, withdraw consent, or delete your account.',
    },
    {
      heading: 'How to withdraw consent or delete',
      body: 'You can edit or remove your saved UPI ID anytime from Dashboard → UPI QR, Settings → Profile & Security, or Settings → Privacy → Manage Consent. Withdrawing UPI QR consent also clears your saved UPI details.',
    },
  ],
  disclaimer:
    'This privacy notice and consent workflow supports transparent user control and consent logging. Final legal compliance review remains the responsibility of the service operator.',
} as const;

export interface UpiProfileRecord {
  id?: string;
  userId?: string;
  upiId: string;
  payeeName: string;
  paymentNote: string;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface UpiValidationResult {
  isValid: boolean;
  normalized: string;
  error?: string;
}

// NPCI UPI handles consist strictly of letters/digits without dots (e.g., @upi, @ybl, @okaxis, @okhdfcbank, @paytm).
// Rejecting dots in the handle naturally prevents standard email addresses like user@gmail.com from being treated as UPI IDs.
const UPI_ID_REGEX = /^[a-zA-Z0-9._-]{2,256}@[a-zA-Z0-9]{2,64}$/;

export function validateUpiId(raw: string): UpiValidationResult {
  const cleaned = String(raw || '').trim().toLowerCase();
  if (!cleaned) {
    return { isValid: false, normalized: '', error: 'Please enter your UPI ID (for example: yourname@upi).' };
  }
  if (/\s/.test(cleaned)) {
    return { isValid: false, normalized: cleaned, error: 'UPI ID cannot contain spaces.' };
  }
  const atParts = cleaned.split('@');
  if (atParts.length !== 2) {
    return { isValid: false, normalized: cleaned, error: 'UPI ID must include a single @ handle (e.g. yourname@upi).' };
  }
  const [prefix, handle] = atParts;
  if (prefix.length < 2) {
    return { isValid: false, normalized: cleaned, error: 'Enter at least 2 characters before @ in your UPI ID.' };
  }
  if (handle.includes('.')) {
    return {
      isValid: false,
      normalized: cleaned,
      error: 'That looks like an email address. Please enter a valid UPI ID (e.g. yourname@upi, name@okaxis, 9876543210@ybl).',
    };
  }
  if (!UPI_ID_REGEX.test(cleaned)) {
    return {
      isValid: false,
      normalized: cleaned,
      error: 'Invalid UPI ID format. Use letters, numbers, dots, hyphens or underscores before @ and an alphanumeric UPI handle after @.',
    };
  }
  return { isValid: true, normalized: cleaned };
}

export function sanitizeUpiText(raw: string | undefined | null, maxLen: number): string {
  return String(raw || '')
    .replace(/[\r\n\t]+/g, ' ')
    .replace(/[<>]/g, '')
    .trim()
    .slice(0, maxLen);
}

export interface AmountValidationResult {
  isValid: boolean;
  amount: number;
  formatted: string;
  error?: string;
}

export function validateAmountForUpiQr(raw: string | number): AmountValidationResult {
  const str = String(raw ?? '').trim().replace(/,/g, '');
  if (!str) {
    return { isValid: false, amount: 0, formatted: '', error: 'Please enter an amount greater than ₹0.' };
  }
  if (!/^\d+(\.\d{1,2})?$/.test(str)) {
    return { isValid: false, amount: 0, formatted: '', error: 'Enter a valid amount with up to 2 decimal places.' };
  }
  const num = Number(str);
  if (!Number.isFinite(num) || num <= 0) {
    return { isValid: false, amount: 0, formatted: '', error: 'Amount must be greater than ₹0.' };
  }
  if (num > 10000000) {
    return { isValid: false, amount: 0, formatted: '', error: 'Amount exceeds the supported UPI QR limit.' };
  }
  const formatted = Number.isInteger(num) ? String(num) : num.toFixed(2);
  return { isValid: true, amount: num, formatted };
}

export function canSaveUpiProfile(input: { upiId: string; consentAccepted: boolean }): {
  allowed: boolean;
  reason?: string;
} {
  if (!input.consentAccepted) {
    return {
      allowed: false,
      reason: 'Please check the consent box before saving your UPI ID.',
    };
  }
  const v = validateUpiId(input.upiId);
  if (!v.isValid) {
    return { allowed: false, reason: v.error };
  }
  return { allowed: true };
}

/**
 * Option A: Standard Normal UPI QR URI
 * Format: upi://pay?pa=UPI_ID&pn=PAYEE_NAME&cu=INR&tn=NOTE
 */
export function buildNormalUpiUri(params: {
  upiId: string;
  payeeName?: string | null;
  paymentNote?: string | null;
}): string {
  const check = validateUpiId(params.upiId);
  if (!check.isValid) {
    throw new Error(check.error || 'Invalid UPI ID');
  }
  const pn = sanitizeUpiText(params.payeeName, 80);
  const tn = sanitizeUpiText(params.paymentNote, 80);

  const pairs: string[] = [`pa=${encodeURIComponent(check.normalized)}`];
  if (pn) pairs.push(`pn=${encodeURIComponent(pn)}`);
  pairs.push('cu=INR');
  if (tn) pairs.push(`tn=${encodeURIComponent(tn)}`);

  return `upi://pay?${pairs.join('&')}`;
}

/**
 * Option B: Fixed Amount UPI QR URI
 * Format: upi://pay?pa=UPI_ID&pn=PAYEE_NAME&am=AMOUNT&cu=INR&tn=NOTE
 * Note: Generating or scanning an Amount QR is strictly a payment request and
 * NEVER marks a transaction paid or increases Available Balance automatically.
 */
export function buildAmountUpiUri(params: {
  upiId: string;
  payeeName?: string | null;
  amount: string | number;
  paymentNote?: string | null;
}): string {
  const check = validateUpiId(params.upiId);
  if (!check.isValid) {
    throw new Error(check.error || 'Invalid UPI ID');
  }
  const amt = validateAmountForUpiQr(params.amount);
  if (!amt.isValid) {
    throw new Error(amt.error || 'Invalid payment amount');
  }
  const pn = sanitizeUpiText(params.payeeName, 80);
  const tn = sanitizeUpiText(params.paymentNote, 80);

  const pairs: string[] = [`pa=${encodeURIComponent(check.normalized)}`];
  if (pn) pairs.push(`pn=${encodeURIComponent(pn)}`);
  pairs.push(`am=${encodeURIComponent(amt.formatted)}`);
  pairs.push('cu=INR');
  if (tn) pairs.push(`tn=${encodeURIComponent(tn)}`);

  return `upi://pay?${pairs.join('&')}`;
}
