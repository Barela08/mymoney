/**
 * Automatic UPI Payment Notification Detection & Normalization Engine
 * Product: My Money Manager by HackifyPro
 *
 * Security & Integrity Guarantees:
 * - Strictly rejects OTPs, UPI PINs, CVVs, banking credentials, promotional alerts,
 *   incoming transfers, failed transactions, and non-payment notifications.
 * - Never invents missing UTR/RRN/UPI Transaction IDs, merchant names, or amounts.
 * - Stores monetary values as integer paise (minor units) to avoid floating-point drift.
 * - Performs collision-aware deduplication without merging distinct legitimate payments.
 * - Masks sensitive tokens in diagnostic logs.
 */

import type { NewTransactionPayload, TransactionCategory, TransactionSubcategory } from '../types';

export const PARSER_VERSION = '1.0.0';

export type NotificationAccessStatus =
  | 'granted'
  | 'not_granted'
  | 'disabled'
  | 'restricted'
  | 'not_supported';

export type DetectionRuntimePlatform =
  | 'android_native_bridge'
  | 'android_web'
  | 'ios'
  | 'desktop_web';

export type UpiPaymentStatus = 'completed' | 'pending' | 'failed' | 'reversed' | 'unknown';
export type TransactionDirection = 'outgoing' | 'incoming' | 'unknown';
export type VerificationStatus = 'verified' | 'unverified' | 'partial' | 'test_sample';
export type CategorizationStatus = 'pending' | 'categorized' | 'dismissed' | 'remind_later';

export type UpiExpenseCategoryId =
  | 'Food'
  | 'Groceries'
  | 'Fuel'
  | 'Shopping'
  | 'Travel'
  | 'Bills'
  | 'Medical'
  | 'Education'
  | 'Entertainment'
  | 'Rent'
  | 'Recharge'
  | 'Personal'
  | 'Other';

export interface SupportedUpiAppConfig {
  id: string;
  name: string;
  shortName: string;
  packageNames: string[];
  parserKey: 'google_pay' | 'phonepe' | 'paytm' | 'bhim' | 'generic_upi';
  defaultEnabled: boolean;
  accentColor: string;
}

/**
 * Configurable registry of supported UPI applications.
 * New apps can be added without modifying core parser pipelines.
 */
export const SUPPORTED_UPI_APPS: SupportedUpiAppConfig[] = [
  {
    id: 'google_pay',
    name: 'Google Pay',
    shortName: 'GPay',
    packageNames: ['com.google.android.apps.nbu.paisa.user'],
    parserKey: 'google_pay',
    defaultEnabled: true,
    accentColor: '#2563EB',
  },
  {
    id: 'phonepe',
    name: 'PhonePe',
    shortName: 'PhonePe',
    packageNames: ['com.phonepe.app'],
    parserKey: 'phonepe',
    defaultEnabled: true,
    accentColor: '#7C3AED',
  },
  {
    id: 'paytm',
    name: 'Paytm',
    shortName: 'Paytm',
    packageNames: ['net.one97.paytm'],
    parserKey: 'paytm',
    defaultEnabled: true,
    accentColor: '#0284C7',
  },
  {
    id: 'bhim',
    name: 'BHIM UPI',
    shortName: 'BHIM',
    packageNames: ['in.org.npci.upiapp'],
    parserKey: 'bhim',
    defaultEnabled: true,
    accentColor: '#EA580C',
  },
  {
    id: 'amazon_pay',
    name: 'Amazon Pay UPI',
    shortName: 'Amazon Pay',
    packageNames: ['in.amazon.mShop.android.shopping'],
    parserKey: 'generic_upi',
    defaultEnabled: true,
    accentColor: '#D97706',
  },
  {
    id: 'cred',
    name: 'CRED UPI',
    shortName: 'CRED',
    packageNames: ['com.dreamplug.androidapp'],
    parserKey: 'generic_upi',
    defaultEnabled: true,
    accentColor: '#334155',
  },
  {
    id: 'generic_upi',
    name: 'Other Supported UPI Apps',
    shortName: 'Other UPI',
    packageNames: [
      'com.whatsapp',
      'com.mobikwik_new',
      'in.org.npci.upiapp.sbi',
      'com.sbi.upi',
      'com.csam.icici.bank.imobile',
      'com.snapwork.hdfc',
      'com.axis.mobile',
      'com.freecharge.android',
    ],
    parserKey: 'generic_upi',
    defaultEnabled: false,
    accentColor: '#0D9488',
  },
];

export const UPI_EXPENSE_CATEGORIES: Array<{
  id: UpiExpenseCategoryId;
  label: UpiExpenseCategoryId;
  mappedCategory: TransactionCategory;
  mappedSubcategory: TransactionSubcategory;
}> = [
  { id: 'Food', label: 'Food', mappedCategory: 'food', mappedSubcategory: 'restaurant' },
  { id: 'Groceries', label: 'Groceries', mappedCategory: 'room', mappedSubcategory: 'grocery' },
  { id: 'Fuel', label: 'Fuel', mappedCategory: 'other', mappedSubcategory: 'fuel' },
  { id: 'Shopping', label: 'Shopping', mappedCategory: 'other', mappedSubcategory: 'shopping' },
  { id: 'Travel', label: 'Travel', mappedCategory: 'other', mappedSubcategory: 'travel' },
  { id: 'Bills', label: 'Bills', mappedCategory: 'other', mappedSubcategory: 'bills' },
  { id: 'Medical', label: 'Medical', mappedCategory: 'other', mappedSubcategory: 'health' },
  { id: 'Education', label: 'Education', mappedCategory: 'other', mappedSubcategory: 'education' },
  { id: 'Entertainment', label: 'Entertainment', mappedCategory: 'other', mappedSubcategory: 'entertainment' },
  { id: 'Rent', label: 'Rent', mappedCategory: 'room', mappedSubcategory: 'rent' },
  { id: 'Recharge', label: 'Recharge', mappedCategory: 'other', mappedSubcategory: 'recharge' },
  { id: 'Personal', label: 'Personal', mappedCategory: 'other', mappedSubcategory: 'personal_care' },
  { id: 'Other', label: 'Other', mappedCategory: 'other', mappedSubcategory: 'other_expense' },
];

export interface RawNotificationInput {
  packageName: string;
  title: string;
  text: string;
  bigText?: string | null;
  subText?: string | null;
  notificationTimestamp?: string | number | null;
  notificationKey?: string | null;
  isTestSample?: boolean;
}

export interface DetectedTransaction {
  id: string;
  userId?: string;
  amountPaise: number;
  amountRupees: number;
  currency: 'INR';
  sourceApp: string;
  sourceAppId: string;
  sourcePackage: string;
  transactionDirection: TransactionDirection;
  merchantName: string | null;
  upiId: string | null;
  upiTransactionId: string | null;
  utrNumber: string | null;
  rrn: string | null;
  transactionTimestamp: string;
  notificationTimestamp: string;
  paymentStatus: UpiPaymentStatus;
  rawDataHash: string;
  detectionConfidence: number; // 0..1
  verificationStatus: VerificationStatus;
  categorizationStatus: CategorizationStatus;
  parserVersion: string;
  parserUsed: string;
  linkedExpenseId: string | null;
  selectedCategory: UpiExpenseCategoryId | null;
  description: string | null;
  isTestSample: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ParseNotificationResult {
  accepted: boolean;
  shouldTriggerPopup: boolean;
  rejectionReason: string | null;
  parserUsed: string;
  parserVersion: string;
  transaction: DetectedTransaction | null;
}

export interface ExpenseDetectionSettings {
  enabled: boolean;
  autoPopupEnabled: boolean;
  onboardingCompleted: boolean;
  supportedApps: Record<string, boolean>;
  lastDetectionAt: string | null;
  retentionDays: number;
  updatedAt: string;
}

export interface DetectionEventLog {
  id: string;
  detectedTransactionId: string | null;
  eventType:
    | 'received'
    | 'parsed'
    | 'rejected'
    | 'deduplicated'
    | 'popup_shown'
    | 'categorized'
    | 'dismissed'
    | 'remind_later'
    | 'edited'
    | 'test_run';
  sourcePackage: string;
  parserUsed: string;
  parserVersion: string;
  rawDataHash: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export function getDefaultSupportedAppsMap(): Record<string, boolean> {
  const map: Record<string, boolean> = {};
  for (const app of SUPPORTED_UPI_APPS) {
    map[app.id] = app.defaultEnabled;
  }
  return map;
}

export function getDefaultDetectionSettings(): ExpenseDetectionSettings {
  return {
    enabled: false,
    autoPopupEnabled: true,
    onboardingCompleted: false,
    supportedApps: getDefaultSupportedAppsMap(),
    lastDetectionAt: null,
    retentionDays: 90,
    updatedAt: new Date().toISOString(),
  };
}

/**
 * Deterministic fast hash for browser + Node environments (FNV-1a 128-bit hex)
 * Used as a pure synchronous fallback when WebCrypto isn't awaited.
 */
export function computeNotificationHash(parts: {
  packageName: string;
  title: string;
  text: string;
  bigText?: string | null;
}): string {
  const normalized = [
    (parts.packageName || '').trim().toLowerCase(),
    (parts.title || '').trim().replace(/\s+/g, ' '),
    (parts.text || '').trim().replace(/\s+/g, ' '),
    (parts.bigText || '').trim().replace(/\s+/g, ' '),
  ].join('|');

  let h1 = 0x811c9dc5;
  let h2 = 0x9e3779b9;
  let h3 = 0x85ebca6b;
  let h4 = 0xc2b2ae35;

  for (let i = 0; i < normalized.length; i++) {
    const c = normalized.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ (c + i), 0x85ebca6b) >>> 0;
    h3 = Math.imul(h3 ^ (c * 31), 0xc2b2ae35) >>> 0;
    h4 = Math.imul(h4 ^ ((c << 3) | (i & 7)), 0x27d4eb2d) >>> 0;
  }

  return [h1, h2, h3, h4].map((v) => v.toString(16).padStart(8, '0')).join('');
}

/**
 * Masks sensitive values (OTPs, PINs, UPI handles, 10+ digit numbers, UTRs) before logging.
 */
export function maskSensitiveLogPayload(input: string): string {
  if (!input) return '';
  return input
    // Mask explicit OTP / PIN / CVV codes
    .replace(/\b(otp|pin|mpin|upi\s*pin|cvv|passcode|password)\s*[:=-]?\s*[a-zA-Z0-9]{3,10}\b/gi, '$1: [REDACTED]')
    // Mask UPI handles partially
    .replace(/\b([a-zA-Z0-9._-]{2})[a-zA-Z0-9._-]*(@[a-zA-Z]{2,})\b/g, '$1***$2')
    // Mask long numeric references/account numbers (keep last 4)
    .replace(/\b(\d{4,})(\d{4})\b/g, (_m, prefix, last4) => `${'*'.repeat(Math.min(prefix.length, 8))}${last4}`);
}

export function resolveSupportedApp(packageName: string): SupportedUpiAppConfig | null {
  const pkg = (packageName || '').trim().toLowerCase();
  if (!pkg) return null;
  for (const app of SUPPORTED_UPI_APPS) {
    if (app.packageNames.some((p) => p.toLowerCase() === pkg)) {
      return app;
    }
  }
  return null;
}

// ============================================================================
// SECURITY & CLASSIFICATION PATTERNS
// ============================================================================

const SENSITIVE_OR_NON_PAYMENT_RE =
  /\b(otp|one[\s-]?time\s+password|upi\s*pin|m[\s-]?pin|mpin|cvv|verification\s+code|login\s+code|do\s+not\s+share|secret\s+code|cashback\s+offer|scratch\s+card|refer\s+and\s+earn|win\s+upto|spin\s+the\s+wheel|pre-approved\s+loan|credit\s+score|kyc\s+update|bill\s+reminder|autopay\s+reminder|mandate\s+created|requesting\s+money|requested\s+₹|has\s+requested\s+rs\.?|collect\s+request|balance\s+is\s+₹|available\s+balance|account\s+balance|statement\s+ready)\b/i;

const FAILED_STATUS_RE =
  /\b(failed|declined|unsuccessful|could\s+not\s+be\s+completed|could\s+not\s+process|not\s+completed|cancelled|canceled|rejected|timed\s*out|expired|insufficient\s+funds|reversed|refunded|refund\s+initiated)\b/i;

const PENDING_STATUS_RE =
  /\b(pending|processing|in\s+progress|awaiting\s+bank|under\s+process|initiated\s+and\s+pending|queued)\b/i;

const INCOMING_DIRECTION_RE =
  /\b(received\s+(?:₹|rs\.?|inr|from|a\s+payment)|credited\s+(?:with|to|by)|sent\s+you\s+(?:₹|rs\.?|inr)|paid\s+you\s+(?:₹|rs\.?|inr)|you\s+received|money\s+received|received\s+money|cashback\s+received|refund\s+credited|added\s+to\s+your\s+account)\b/i;

const OUTGOING_DIRECTION_RE =
  /\b(paid\s+(?:₹|rs\.?|inr|to)|you\s+paid|sent\s+(?:₹|rs\.?|inr)|debited\s+(?:by|for|with|from)|payment\s+of\s+(?:₹|rs\.?|inr)|transferred\s+(?:₹|rs\.?|inr)|spent\s+(?:₹|rs\.?|inr)|money\s+sent|upi\s+payment\s+successful|payment\s+successful|paid\s+successfully|sent\s+successfully)\b/i;

const UNSUPPORTED_CURRENCY_RE = /(?:^|\s)(\$|€|£|USD|EUR|GBP|AED|SGD)\s*\d/i;

/**
 * Extracts INR amount strictly in integer paise.
 * Never fabricates an amount. Returns null if no valid INR amount is found or if unsupported currency.
 */
export function extractInrAmountPaise(combinedText: string): number | null {
  if (!combinedText) return null;

  // Reject foreign currencies unless INR is explicitly present
  if (UNSUPPORTED_CURRENCY_RE.test(combinedText) && !/(?:₹|\bRs\.?|\bINR\b)/i.test(combinedText)) {
    return null;
  }

  const patterns = [
    /(?:₹|Rs\.?|INR)\s*([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)/i,
    /\b([0-9]{1,3}(?:,[0-9]{2,3})*(?:\.[0-9]{1,2})?|[0-9]+(?:\.[0-9]{1,2})?)\s*(?:₹|INR|rupees?)\b/i,
  ];

  for (const regex of patterns) {
    const match = combinedText.match(regex);
    if (match && match[1]) {
      const cleaned = match[1].replace(/,/g, '').trim();
      const parts = cleaned.split('.');
      const rupees = Number.parseInt(parts[0], 10);
      const paiseRaw = parts[1] ? parts[1].padEnd(2, '0').slice(0, 2) : '00';
      const paise = Number.parseInt(paiseRaw, 10);
      if (!Number.isFinite(rupees) || !Number.isFinite(paise)) continue;
      const totalPaise = rupees * 100 + paise;
      if (totalPaise > 0 && totalPaise <= 10_000_000_000) {
        return totalPaise;
      }
    }
  }

  return null;
}

/**
 * Extracts explicit UPI ID (VPA) ONLY if explicitly present in notification text.
 */
export function extractExplicitUpiId(text: string): string | null {
  if (!text) return null;
  const match = text.match(/\b([a-zA-Z0-9._-]{2,64}@(?:okaxis|okhdfcbank|okicici|oksbi|ybl|ibl|axl|paytm|upi|apl|fbl|icici|hdfcbank|sbi|kotak|indus|federal|barodampay|cnrb|pnb|jupiteraxis|sliceaxis|naviaxis|airtel|jio|postbank|rapl|waaxis|wahdfcbank|waicici|wasbi)[a-zA-Z0-9]*)\b/i);
  return match ? match[1].toLowerCase() : null;
}

/**
 * Extracts explicit UTR / RRN / UPI Transaction ID strictly when labeled in notification text.
 * Never fabricates or guesses random numeric strings.
 */
export function extractPaymentReferences(text: string): {
  upiTransactionId: string | null;
  utrNumber: string | null;
  rrn: string | null;
} {
  if (!text) {
    return { upiTransactionId: null, utrNumber: null, rrn: null };
  }

  const utrMatch = text.match(
    /\b(?:UTR(?:\s*(?:No\.?|Number|ID))?|UPI\s*Ref(?:\s*(?:No\.?|Number|ID))?|Ref(?:\s*(?:No\.?|Number|ID))?)\s*[:#-]?\s*([A-Z0-9]{10,24})\b/i
  );

  const rrnMatch = text.match(
    /\b(?:RRN(?:\s*(?:No\.?|Number|ID))?)\s*[:#-]?\s*([A-Z0-9]{10,20})\b/i
  );

  const txnIdMatch = text.match(
    /\b(?:UPI\s*(?:Txn|Transaction)\s*ID|Txn\s*ID|Transaction\s*ID|Order\s*ID)\s*[:#-]?\s*([A-Z0-9_-]{8,36})\b/i
  );

  const utrNumber = utrMatch?.[1]?.trim() || null;
  const rrn = rrnMatch?.[1]?.trim() || null;
  const upiTransactionId = txnIdMatch?.[1]?.trim() || null;

  return {
    upiTransactionId,
    utrNumber,
    rrn,
  };
}

function cleanMerchantName(raw: string | null | undefined): string | null {
  if (!raw) return null;
  let cleaned = raw
    .replace(/\s+(?:via|using|through|from|on|with)\s+(?:UPI|Google\s*Pay|GPay|PhonePe|Paytm|BHIM|Amazon\s*Pay|CRED|bank|account|a\/c).*$/i, '')
    .replace(/\s+(?:UTR|RRN|Ref|Txn\s*ID|Transaction\s*ID|UPI\s*Ref|Order\s*ID).*$/i, '')
    .replace(/[\s.,;:|/-]+$/g, '')
    .replace(/^[\s.,;:|/-]+/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!cleaned || cleaned.length < 2) return null;
  if (/^(?:upi|inr|rs|paid|sent|payment|successful|completed|bank|account|your|you)$/i.test(cleaned)) {
    return null;
  }
  if (/^\d+$/.test(cleaned)) return null;
  return cleaned.slice(0, 80);
}

function extractMerchantGeneric(title: string, body: string): string | null {
  const combined = `${title} ${body}`.replace(/\s+/g, ' ').trim();
  const patterns = [
    /\b(?:paid|sent|transferred)\s+(?:₹|Rs\.?|INR)\s*[0-9,]+(?:\.[0-9]{1,2})?\s+to\s+([A-Za-z0-9 &'._-]{2,60}?)(?:\s*\(|\s+(?:via|using|on|from|UTR|RRN|Ref|Txn|Transaction|UPI|successfully|\.)|\.|,|$)/i,
    /\b(?:payment\s+of\s+(?:₹|Rs\.?|INR)\s*[0-9,]+(?:\.[0-9]{1,2})?\s+to|payment\s+to)\s+([A-Za-z0-9 &'._-]{2,60}?)(?:\s*\(|\s+(?:is|was|successful|completed|via|using|on|UTR|RRN|Ref|Txn|\.)|\.|,|$)/i,
    /\bto\s+([A-Za-z0-9 &'._-]{2,60}?)(?:\s*\(|\s+(?:via|using|through|on|UTR|RRN|Ref|Txn|Transaction|UPI|successful|completed|\.)|\.|,|$)/i,
    /\bat\s+([A-Za-z0-9 &'._-]{2,60}?)(?:\s*\(|\s+(?:via|using|on|UTR|RRN|Ref|Txn|\.)|\.|,|$)/i,
  ];

  for (const regex of patterns) {
    const m = combined.match(regex);
    const cleaned = cleanMerchantName(m?.[1]);
    if (cleaned) return cleaned;
  }

  // Title fallback for patterns like "Paid to Zomato" or "Zomato • Paid ₹320"
  const titleToMatch = title.match(/^(?:Paid\s+to|Sent\s+to|Payment\s+to)\s+(.+)$/i);
  if (titleToMatch?.[1]) {
    const cleaned = cleanMerchantName(titleToMatch[1]);
    if (cleaned) return cleaned;
  }

  return null;
}

function parseTimestampIso(input?: string | number | null): string {
  if (typeof input === 'number' && Number.isFinite(input) && input > 0) {
    const ms = input < 1e12 ? input * 1000 : input;
    const d = new Date(ms);
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  if (typeof input === 'string' && input.trim()) {
    const d = new Date(input.trim());
    if (!Number.isNaN(d.getTime())) return d.toISOString();
  }
  return new Date().toISOString();
}

export interface UpiNotificationParser {
  readonly parserName: string;
  readonly version: string;
  readonly supportedAppIds: string[];
  parse(input: RawNotificationInput, appConfig: SupportedUpiAppConfig): ParseNotificationResult;
}

function buildBaseParsePipeline(
  parserName: string,
  input: RawNotificationInput,
  appConfig: SupportedUpiAppConfig,
  customMerchantExtractor?: (title: string, body: string) => string | null
): ParseNotificationResult {
  const title = (input.title || '').trim();
  const body = [(input.text || '').trim(), (input.bigText || '').trim(), (input.subText || '').trim()]
    .filter(Boolean)
    .join(' ')
    .replace(/\s+/g, ' ')
    .trim();
  const combined = `${title} ${body}`.trim();

  if (!combined) {
    return {
      accepted: false,
      shouldTriggerPopup: false,
      rejectionReason: 'empty_notification',
      parserUsed: parserName,
      parserVersion: PARSER_VERSION,
      transaction: null,
    };
  }

  // 1. Hard reject OTP / PIN / promotional / balance / collect-request alerts
  if (SENSITIVE_OR_NON_PAYMENT_RE.test(combined)) {
    return {
      accepted: false,
      shouldTriggerPopup: false,
      rejectionReason: 'sensitive_or_non_payment_notification',
      parserUsed: parserName,
      parserVersion: PARSER_VERSION,
      transaction: null,
    };
  }

  // 2. Detect payment status
  let paymentStatus: UpiPaymentStatus = 'unknown';
  if (FAILED_STATUS_RE.test(combined)) {
    paymentStatus = /\b(reversed|refunded|refund)\b/i.test(combined) ? 'reversed' : 'failed';
  } else if (PENDING_STATUS_RE.test(combined)) {
    paymentStatus = 'pending';
  } else if (OUTGOING_DIRECTION_RE.test(combined) || /\b(successful|completed|done|debited)\b/i.test(combined)) {
    paymentStatus = 'completed';
  }

  // 3. Detect direction (incoming MUST NEVER be treated as outgoing expense)
  let direction: TransactionDirection = 'unknown';
  if (INCOMING_DIRECTION_RE.test(combined)) {
    direction = 'incoming';
  } else if (OUTGOING_DIRECTION_RE.test(combined)) {
    direction = 'outgoing';
  }

  // 4. Reject incoming transfers
  if (direction === 'incoming') {
    return {
      accepted: false,
      shouldTriggerPopup: false,
      rejectionReason: 'incoming_transfer_ignored',
      parserUsed: parserName,
      parserVersion: PARSER_VERSION,
      transaction: null,
    };
  }

  // 5. Reject failed / reversed / pending transactions from expense creation
  if (paymentStatus === 'failed' || paymentStatus === 'reversed') {
    return {
      accepted: false,
      shouldTriggerPopup: false,
      rejectionReason: 'failed_or_reversed_payment',
      parserUsed: parserName,
      parserVersion: PARSER_VERSION,
      transaction: null,
    };
  }

  if (paymentStatus === 'pending') {
    return {
      accepted: false,
      shouldTriggerPopup: false,
      rejectionReason: 'pending_payment_not_final',
      parserUsed: parserName,
      parserVersion: PARSER_VERSION,
      transaction: null,
    };
  }

  // 5B. Reject unsupported foreign currency explicitly
  if (UNSUPPORTED_CURRENCY_RE.test(combined) && !/(?:₹|\bRs\.?|\bINR\b)/i.test(combined)) {
    return {
      accepted: false,
      shouldTriggerPopup: false,
      rejectionReason: 'missing_or_unsupported_amount',
      parserUsed: parserName,
      parserVersion: PARSER_VERSION,
      transaction: null,
    };
  }

  // 6. Require outgoing payment indicator
  if (direction !== 'outgoing') {
    return {
      accepted: false,
      shouldTriggerPopup: false,
      rejectionReason: 'not_outgoing_payment',
      parserUsed: parserName,
      parserVersion: PARSER_VERSION,
      transaction: null,
    };
  }

  // 7. Extract INR amount in integer paise (never fabricate!)
  const amountPaise = extractInrAmountPaise(combined);
  if (amountPaise === null || amountPaise <= 0) {
    return {
      accepted: false,
      shouldTriggerPopup: false,
      rejectionReason: 'missing_or_unsupported_amount',
      parserUsed: parserName,
      parserVersion: PARSER_VERSION,
      transaction: null,
    };
  }

  // 8. Extract available metadata WITHOUT fabricating missing values
  const merchantName =
    (customMerchantExtractor ? cleanMerchantName(customMerchantExtractor(title, body)) : null) ||
    extractMerchantGeneric(title, body);
  const upiId = extractExplicitUpiId(combined);
  const { upiTransactionId, utrNumber, rrn } = extractPaymentReferences(combined);
  const notificationTimestamp = parseTimestampIso(input.notificationTimestamp);
  const rawDataHash = computeNotificationHash({
    packageName: input.packageName,
    title,
    text: input.text,
    bigText: input.bigText,
  });

  // 9. Confidence & verification scoring
  let confidence = 0.6;
  if (merchantName) confidence += 0.15;
  if (upiTransactionId || utrNumber || rrn) confidence += 0.2;
  if (upiId) confidence += 0.05;
  confidence = Math.min(1, Math.round(confidence * 100) / 100);

  const verificationStatus: VerificationStatus = input.isTestSample
    ? 'test_sample'
    : upiTransactionId || utrNumber || rrn
      ? 'verified'
      : merchantName
        ? 'partial'
        : 'unverified';

  const nowIso = new Date().toISOString();
  const transaction: DetectedTransaction = {
    id: `upi_det_${rawDataHash.slice(0, 12)}_${Date.now().toString(36)}`,
    amountPaise,
    amountRupees: Math.round(amountPaise) / 100,
    currency: 'INR',
    sourceApp: appConfig.name,
    sourceAppId: appConfig.id,
    sourcePackage: input.packageName.trim(),
    transactionDirection: 'outgoing',
    merchantName,
    upiId,
    upiTransactionId,
    utrNumber,
    rrn,
    transactionTimestamp: notificationTimestamp,
    notificationTimestamp,
    paymentStatus: 'completed',
    rawDataHash,
    detectionConfidence: confidence,
    verificationStatus,
    categorizationStatus: 'pending',
    parserVersion: PARSER_VERSION,
    parserUsed: parserName,
    linkedExpenseId: null,
    selectedCategory: null,
    description: null,
    isTestSample: Boolean(input.isTestSample),
    createdAt: nowIso,
    updatedAt: nowIso,
  };

  return {
    accepted: true,
    shouldTriggerPopup: true,
    rejectionReason: null,
    parserUsed: parserName,
    parserVersion: PARSER_VERSION,
    transaction,
  };
}

// ============================================================================
// INDIVIDUAL VERSIONED PARSERS
// ============================================================================

export const GooglePayNotificationParser: UpiNotificationParser = {
  parserName: 'GooglePayNotificationParser',
  version: PARSER_VERSION,
  supportedAppIds: ['google_pay'],
  parse(input, appConfig) {
    return buildBaseParsePipeline(this.parserName, input, appConfig, (title, body) => {
      // Google Pay formats: "Paid ₹450 to Swiggy" | "You paid Swiggy ₹450" | Title: "Swiggy" Body: "You paid ₹450"
      const m1 = `${title} ${body}`.match(/\b(?:you\s+)?paid\s+([A-Za-z0-9 &'.()_-]{2,50}?)\s+(?:₹|Rs\.?|INR)/i);
      if (m1?.[1]) return m1[1];
      if (
        title &&
        !/google\s*pay|gpay|payment|paid|sent|upi|transaction/i.test(title) &&
        /\b(?:you\s+paid|paid\s+(?:₹|Rs\.?|INR))/i.test(body)
      ) {
        return title;
      }
      return null;
    });
  },
};

export const PhonePeNotificationParser: UpiNotificationParser = {
  parserName: 'PhonePeNotificationParser',
  version: PARSER_VERSION,
  supportedAppIds: ['phonepe'],
  parse(input, appConfig) {
    return buildBaseParsePipeline(this.parserName, input, appConfig, (title, body) => {
      // PhonePe formats: "Paid ₹280 to DMart Ready" | "Paid ₹1,240 to DMart Ready (dmart@okicici)"
      const m = `${title} ${body}`.match(
        /\b(?:paid|sent|money\s+sent[:\s]+)\s*(?:₹|Rs\.?|INR)\s*[0-9,]+(?:\.[0-9]{1,2})?\s+to\s+([A-Za-z0-9 &'._-]{2,60}?)(?:\s*\(|\s+(?:from|via|using|UTR|Txn|Ref|UPI|\.)|\.|,|$)/i
      );
      return m?.[1] || null;
    });
  },
};

export const PaytmNotificationParser: UpiNotificationParser = {
  parserName: 'PaytmNotificationParser',
  version: PARSER_VERSION,
  supportedAppIds: ['paytm'],
  parse(input, appConfig) {
    return buildBaseParsePipeline(this.parserName, input, appConfig, (title, body) => {
      // Paytm formats: "Paid Rs. 150 to Indian Oil Fuel Station" | "Payment of ₹899 to Jio Prepaid successful"
      const m = `${title} ${body}`.match(
        /\b(?:paid|payment\s+of)\s+(?:₹|Rs\.?|INR)\s*[0-9,]+(?:\.[0-9]{1,2})?\s+to\s+([A-Za-z0-9 &'.()_-]{2,60}?)(?:\s+(?:successful|completed|via|using|Order|Txn|UTR|Ref|UPI|\.)|$)/i
      );
      return m?.[1] || null;
    });
  },
};

export const BHIMNotificationParser: UpiNotificationParser = {
  parserName: 'BHIMNotificationParser',
  version: PARSER_VERSION,
  supportedAppIds: ['bhim'],
  parse(input, appConfig) {
    return buildBaseParsePipeline(this.parserName, input, appConfig, (title, body) => {
      // BHIM formats: "₹640 debited for Apollo Pharmacy" | "UPI payment of ₹500 to Metro Rail"
      const m = `${title} ${body}`.match(
        /\b(?:debited\s+for|paid\s+to|transferred\s+to)\s+([A-Za-z0-9 &'.()_-]{2,60}?)(?:\s+(?:via|using|RRN|UTR|Ref|Txn|UPI|\.)|$)/i
      );
      return m?.[1] || null;
    });
  },
};

export const GenericUpiNotificationParser: UpiNotificationParser = {
  parserName: 'GenericUpiNotificationParser',
  version: PARSER_VERSION,
  supportedAppIds: ['amazon_pay', 'cred', 'generic_upi'],
  parse(input, appConfig) {
    return buildBaseParsePipeline(this.parserName, input, appConfig);
  },
};

const PARSER_REGISTRY: Record<SupportedUpiAppConfig['parserKey'], UpiNotificationParser> = {
  google_pay: GooglePayNotificationParser,
  phonepe: PhonePeNotificationParser,
  paytm: PaytmNotificationParser,
  bhim: BHIMNotificationParser,
  generic_upi: GenericUpiNotificationParser,
};

/**
 * Main entrypoint: routes a raw notification to the matching versioned parser
 * respecting user's enabled app configuration.
 */
export function parseUpiNotification(
  input: RawNotificationInput,
  enabledApps?: Record<string, boolean>
): ParseNotificationResult {
  const appConfig = resolveSupportedApp(input.packageName);
  if (!appConfig) {
    return {
      accepted: false,
      shouldTriggerPopup: false,
      rejectionReason: 'unsupported_package',
      parserUsed: 'none',
      parserVersion: PARSER_VERSION,
      transaction: null,
    };
  }

  if (enabledApps && enabledApps[appConfig.id] === false) {
    return {
      accepted: false,
      shouldTriggerPopup: false,
      rejectionReason: 'app_disabled_by_user',
      parserUsed: 'none',
      parserVersion: PARSER_VERSION,
      transaction: null,
    };
  }

  const parser = PARSER_REGISTRY[appConfig.parserKey] || GenericUpiNotificationParser;
  return parser.parse(input, appConfig);
}

// ============================================================================
// COLLISION-AWARE DEDUPLICATION ENGINE
// ============================================================================

export interface DeduplicationResult {
  isDuplicate: boolean;
  matchReason: 'upi_transaction_id' | 'utr_number' | 'rrn' | 'exact_notification_hash' | 'short_window_fingerprint' | null;
  matchedRecord: DetectedTransaction | null;
  mergedRecord: DetectedTransaction;
}

/**
 * Safely deduplicates incoming UPI detections against existing user records.
 *
 * Rules:
 * 1. Exact provider references (upiTransactionId, utrNumber, rrn) match first.
 * 2. If both incoming and existing have DIFFERENT provider references, they are
 *    NEVER considered duplicates (even if identical amount & merchant seconds apart).
 * 3. Identical rawDataHash within 2 minutes is treated as a re-posted Android notification.
 * 4. If neither has a provider reference, a strict 15-second window with identical
 *    sourcePackage + amountPaise + normalizedMerchant deduplicates double-emitted notifications
 *    while preserving legitimate back-to-back identical payments (e.g., 2 minutes apart or
 *    with distinct transaction IDs).
 */
export function deduplicateDetectedTransaction(
  incoming: DetectedTransaction,
  existingList: DetectedTransaction[]
): DeduplicationResult {
  const incomingTime = new Date(incoming.notificationTimestamp).getTime();
  const incomingMerchant = (incoming.merchantName || '').trim().toLowerCase();

  for (const existing of existingList) {
    // 1. Exact UPI Transaction ID match
    if (incoming.upiTransactionId && existing.upiTransactionId) {
      if (incoming.upiTransactionId.toLowerCase() === existing.upiTransactionId.toLowerCase()) {
        return {
          isDuplicate: true,
          matchReason: 'upi_transaction_id',
          matchedRecord: existing,
          mergedRecord: mergeDetectedMetadata(existing, incoming),
        };
      }
      // Distinct non-null UPI Transaction IDs guarantee two distinct payments!
      continue;
    }

    // 2. Exact UTR match
    if (incoming.utrNumber && existing.utrNumber) {
      if (incoming.utrNumber.toLowerCase() === existing.utrNumber.toLowerCase()) {
        return {
          isDuplicate: true,
          matchReason: 'utr_number',
          matchedRecord: existing,
          mergedRecord: mergeDetectedMetadata(existing, incoming),
        };
      }
      continue;
    }

    // 3. Exact RRN match
    if (incoming.rrn && existing.rrn) {
      if (incoming.rrn.toLowerCase() === existing.rrn.toLowerCase()) {
        return {
          isDuplicate: true,
          matchReason: 'rrn',
          matchedRecord: existing,
          mergedRecord: mergeDetectedMetadata(existing, incoming),
        };
      }
      continue;
    }

    const existingTime = new Date(existing.notificationTimestamp).getTime();
    const diffMs = Math.abs(incomingTime - existingTime);

    // 4. Identical raw notification hash re-emitted within 2 minutes (e.g. Android notification update)
    if (incoming.rawDataHash === existing.rawDataHash && diffMs <= 120_000) {
      return {
        isDuplicate: true,
        matchReason: 'exact_notification_hash',
        matchedRecord: existing,
        mergedRecord: mergeDetectedMetadata(existing, incoming),
      };
    }

    // 5. Fallback fingerprint ONLY when at least one side lacks provider refs AND within 15 seconds
    const hasConflictingRef =
      (incoming.upiTransactionId && existing.upiTransactionId && incoming.upiTransactionId !== existing.upiTransactionId) ||
      (incoming.utrNumber && existing.utrNumber && incoming.utrNumber !== existing.utrNumber) ||
      (incoming.rrn && existing.rrn && incoming.rrn !== existing.rrn);

    if (
      !hasConflictingRef &&
      diffMs <= 15_000 &&
      incoming.sourcePackage === existing.sourcePackage &&
      incoming.amountPaise === existing.amountPaise &&
      incomingMerchant === (existing.merchantName || '').trim().toLowerCase()
    ) {
      return {
        isDuplicate: true,
        matchReason: 'short_window_fingerprint',
        matchedRecord: existing,
        mergedRecord: mergeDetectedMetadata(existing, incoming),
      };
    }
  }

  return {
    isDuplicate: false,
    matchReason: null,
    matchedRecord: null,
    mergedRecord: incoming,
  };
}

function mergeDetectedMetadata(
  existing: DetectedTransaction,
  incoming: DetectedTransaction
): DetectedTransaction {
  return {
    ...existing,
    merchantName: existing.merchantName || incoming.merchantName,
    upiId: existing.upiId || incoming.upiId,
    upiTransactionId: existing.upiTransactionId || incoming.upiTransactionId,
    utrNumber: existing.utrNumber || incoming.utrNumber,
    rrn: existing.rrn || incoming.rrn,
    detectionConfidence: Math.max(existing.detectionConfidence, incoming.detectionConfidence),
    verificationStatus:
      existing.verificationStatus === 'verified' || incoming.verificationStatus === 'verified'
        ? 'verified'
        : existing.verificationStatus,
    updatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// EXPENSE MAPPING (13 POPUP CATEGORIES -> EXISTING EXPENSE LEDGER)
// ============================================================================

export function mapUpiCategoryToExpensePayload(
  detected: DetectedTransaction,
  categoryId: UpiExpenseCategoryId,
  userDescription?: string
): NewTransactionPayload {
  const mapping =
    UPI_EXPENSE_CATEGORIES.find((c) => c.id === categoryId) ||
    UPI_EXPENSE_CATEGORIES[UPI_EXPENSE_CATEGORIES.length - 1];

  // Format date & time in IST (+05:30) from detected transaction timestamp
  const txDate = new Date(detected.transactionTimestamp);
  const istOffsetMs = (5 * 60 + 30) * 60 * 1000;
  const istDate = new Date(txDate.getTime() + txDate.getTimezoneOffset() * 60 * 1000 + istOffsetMs);
  const yyyy = istDate.getFullYear();
  const mm = String(istDate.getMonth() + 1).padStart(2, '0');
  const dd = String(istDate.getDate()).padStart(2, '0');
  const hh = String(istDate.getHours()).padStart(2, '0');
  const min = String(istDate.getMinutes()).padStart(2, '0');

  const trimmedDescription = (userDescription || '').trim();
  const defaultTitle = detected.merchantName
    ? `${detected.merchantName}`
    : `${categoryId} via ${detected.sourceApp}`;

  const noteParts = [`Auto-detected via ${detected.sourceApp}`];
  if (detected.utrNumber) noteParts.push(`UTR: ${detected.utrNumber}`);
  if (detected.upiTransactionId) noteParts.push(`Txn ID: ${detected.upiTransactionId}`);
  if (detected.rrn) noteParts.push(`RRN: ${detected.rrn}`);

  return {
    category: mapping.mappedCategory,
    subcategory: mapping.mappedSubcategory,
    transaction_type: 'expense',
    amount: Math.round(detected.amountPaise) / 100,
    title: defaultTitle.slice(0, 120),
    description: trimmedDescription || `${categoryId} payment via ${detected.sourceApp}`,
    transaction_date: `${yyyy}-${mm}-${dd}`,
    transaction_time: `${hh}:${min}`,
    notes: noteParts.join(' · '),
    metadata: {
      payment_method: 'upi',
      utr: detected.utrNumber || undefined,
      rrn: detected.rrn || undefined,
      upi_transaction_id: detected.upiTransactionId || undefined,
      upi_id: detected.upiId || undefined,
      paid_to: detected.merchantName || undefined,
      platform: detected.sourceApp,
      source_app_id: detected.sourceAppId,
      source_package: detected.sourcePackage,
      upi_popup_category: categoryId,
      detected_transaction_id: detected.id,
      auto_detected_upi: true,
      detection_confidence: detected.detectionConfidence,
      amount_paise: detected.amountPaise,
    },
  };
}

// ============================================================================
// SANITIZED PARSER TEST SAMPLES (ONLY FOR SETTINGS "TEST DETECTION" & TESTS)
// ============================================================================

export interface SanitizedParserTestSample {
  id: string;
  label: string;
  description: string;
  input: RawNotificationInput;
}

export const SANITIZED_PARSER_TEST_SAMPLES: SanitizedParserTestSample[] = [
  {
    id: 'gpay_swiggy',
    label: 'Google Pay · Outgoing Food Payment',
    description: 'Completed outgoing UPI payment with merchant and UTR reference.',
    input: {
      packageName: 'com.google.android.apps.nbu.paisa.user',
      title: 'Paid ₹345.50 to Swiggy',
      text: 'UPI payment successful. UTR: 432918273645. Txn ID: GPAY9876543210',
      isTestSample: true,
    },
  },
  {
    id: 'phonepe_dmart',
    label: 'PhonePe · Outgoing Grocery Payment',
    description: 'Completed outgoing payment with merchant, VPA, and UTR.',
    input: {
      packageName: 'com.phonepe.app',
      title: 'Money Sent',
      text: 'Paid ₹1,240 to DMart Ready (dmart@okicici). UTR No: 512098765432',
      isTestSample: true,
    },
  },
  {
    id: 'paytm_fuel',
    label: 'Paytm · Outgoing Fuel Payment (No UTR)',
    description: 'Completed outgoing payment without UTR to verify null preservation.',
    input: {
      packageName: 'net.one97.paytm',
      title: 'Payment Successful',
      text: 'Paid Rs. 500 to Indian Oil Fuel Station via Paytm UPI.',
      isTestSample: true,
    },
  },
  {
    id: 'bhim_pharmacy',
    label: 'BHIM UPI · Outgoing Medical Payment',
    description: 'Completed outgoing payment with RRN reference.',
    input: {
      packageName: 'in.org.npci.upiapp',
      title: 'BHIM UPI Debit',
      text: '₹680 debited for Apollo Pharmacy. RRN: 609812345678',
      isTestSample: true,
    },
  },
  {
    id: 'gpay_failed_rejected',
    label: 'Google Pay · Failed Payment (Should Reject)',
    description: 'Verifies failed payments never trigger an expense popup.',
    input: {
      packageName: 'com.google.android.apps.nbu.paisa.user',
      title: 'Payment Failed',
      text: 'Your payment of ₹499 to Zomato failed due to bank server timeout.',
      isTestSample: true,
    },
  },
  {
    id: 'phonepe_incoming_rejected',
    label: 'PhonePe · Incoming Credit (Should Reject)',
    description: 'Verifies money received is never logged as an expense.',
    input: {
      packageName: 'com.phonepe.app',
      title: 'Money Received',
      text: 'You received ₹2,000 from Amit Verma via PhonePe UPI.',
      isTestSample: true,
    },
  },
];
