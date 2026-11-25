/**
 * Automatic UPI Payment Detection API Router
 * Product: My Money Manager by HackifyPro
 *
 * Endpoints:
 * - GET    /api/upi-detection/settings
 * - PUT    /api/upi-detection/settings
 * - POST   /api/upi-detection/ingest
 * - GET    /api/upi-detection/pending
 * - POST   /api/upi-detection/:id/categorize
 * - POST   /api/upi-detection/:id/dismiss
 * - POST   /api/upi-detection/:id/remind-later
 * - PATCH  /api/upi-detection/:id/edit
 * - DELETE /api/upi-detection/reset
 *
 * Security:
 * - Requires authenticated session (authenticateRequest)
 * - Strict per-user scoping on every query & mutation
 * - Rate-limited ingestion endpoint
 * - Masks sensitive payload strings in logs
 */

import type { IncomingMessage, ServerResponse } from 'http';
import crypto from 'crypto';
import { query, isDatabaseAvailable } from './db.js';
import { authenticateRequest, type AuthenticatedUser } from './auth.js';
import { checkRateLimit, logSecurityEvent } from './security.js';
import {
  PARSER_VERSION,
  UPI_EXPENSE_CATEGORIES,
  getDefaultDetectionSettings,
  parseUpiNotification,
  deduplicateDetectedTransaction,
  maskSensitiveLogPayload,
  computeNotificationHash,
  type DetectedTransaction,
  type ExpenseDetectionSettings,
  type DetectionEventLog,
  type RawNotificationInput,
  type UpiExpenseCategoryId,
} from '../src/lib/upiDetectionEngine.js';

// Per-user in-memory fallback store used when DATABASE_URL is not configured (e.g., local preview/tests)
interface MemoryUserDetectionState {
  settings: ExpenseDetectionSettings;
  detected: DetectedTransaction[];
  events: DetectionEventLog[];
}

const memoryStore = new Map<string, MemoryUserDetectionState>();

function getMemoryUserState(userId: string): MemoryUserDetectionState {
  let state = memoryStore.get(userId);
  if (!state) {
    state = {
      settings: getDefaultDetectionSettings(),
      detected: [],
      events: [],
    };
    memoryStore.set(userId, state);
  }
  return state;
}

export function __resetUpiDetectionMemoryStoreForTests(): void {
  memoryStore.clear();
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(payload));
}

async function parseJsonBody(req: IncomingMessage): Promise<Record<string, any>> {
  const preParsed = (req as any).body;
  if (preParsed !== undefined && preParsed !== null) {
    if (typeof preParsed === 'object') return preParsed;
    if (typeof preParsed === 'string') {
      try {
        return JSON.parse(preParsed);
      } catch {
        return {};
      }
    }
  }
  return new Promise((resolve) => {
    let raw = '';
    let size = 0;
    const MAX_BYTES = 256 * 1024;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size <= MAX_BYTES) {
        raw += chunk.toString('utf8');
      }
    });
    req.on('end', () => {
      if (!raw.trim()) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

function mapRowToDetected(row: any): DetectedTransaction {
  const amountPaise = Number(row.amount_paise) || 0;
  return {
    id: String(row.id),
    userId: String(row.user_id),
    amountPaise,
    amountRupees: Math.round(amountPaise) / 100,
    currency: 'INR',
    sourceApp: String(row.source_app || ''),
    sourceAppId: String(row.source_app_id || 'generic_upi'),
    sourcePackage: String(row.source_package || ''),
    transactionDirection: row.transaction_direction || 'outgoing',
    merchantName: row.merchant_name || null,
    upiId: row.upi_id || null,
    upiTransactionId: row.upi_transaction_id || null,
    utrNumber: row.utr_number || null,
    rrn: row.rrn || null,
    transactionTimestamp: new Date(row.transaction_timestamp).toISOString(),
    notificationTimestamp: new Date(row.notification_timestamp).toISOString(),
    paymentStatus: row.payment_status || 'completed',
    rawDataHash: String(row.raw_data_hash || ''),
    detectionConfidence: Number(row.detection_confidence) || 0.6,
    verificationStatus: row.verification_status || 'unverified',
    categorizationStatus: row.categorization_status || 'pending',
    parserVersion: String(row.parser_version || PARSER_VERSION),
    parserUsed: String(row.parser_used || 'GenericUpiNotificationParser'),
    linkedExpenseId: row.linked_expense_id || null,
    selectedCategory: row.selected_category || null,
    description: row.description || null,
    isTestSample: Boolean(row.is_test_sample),
    createdAt: new Date(row.created_at).toISOString(),
    updatedAt: new Date(row.updated_at).toISOString(),
  };
}

function mapRowToSettings(row: any): ExpenseDetectionSettings {
  const defaults = getDefaultDetectionSettings();
  if (!row) return defaults;
  return {
    enabled: Boolean(row.enabled),
    autoPopupEnabled: row.auto_popup_enabled !== undefined ? Boolean(row.auto_popup_enabled) : true,
    onboardingCompleted: Boolean(row.onboarding_completed),
    supportedApps:
      row.supported_apps && typeof row.supported_apps === 'object'
        ? { ...defaults.supportedApps, ...row.supported_apps }
        : defaults.supportedApps,
    lastDetectionAt: row.last_detection_at ? new Date(row.last_detection_at).toISOString() : null,
    retentionDays: Number(row.retention_days) || 90,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : defaults.updatedAt,
  };
}

async function getUserSettings(userId: string): Promise<ExpenseDetectionSettings> {
  if (!isDatabaseAvailable()) {
    return { ...getMemoryUserState(userId).settings };
  }
  try {
    const res = await query(
      `SELECT * FROM public.expense_detection_settings WHERE user_id = $1 LIMIT 1`,
      [userId]
    );
    return mapRowToSettings(res.rows[0]);
  } catch {
    return { ...getMemoryUserState(userId).settings };
  }
}

async function saveUserSettings(
  userId: string,
  patch: Partial<ExpenseDetectionSettings>
): Promise<ExpenseDetectionSettings> {
  const current = await getUserSettings(userId);
  const next: ExpenseDetectionSettings = {
    ...current,
    enabled: patch.enabled !== undefined ? Boolean(patch.enabled) : current.enabled,
    autoPopupEnabled:
      patch.autoPopupEnabled !== undefined ? Boolean(patch.autoPopupEnabled) : current.autoPopupEnabled,
    onboardingCompleted:
      patch.onboardingCompleted !== undefined
        ? Boolean(patch.onboardingCompleted)
        : current.onboardingCompleted,
    supportedApps:
      patch.supportedApps && typeof patch.supportedApps === 'object'
        ? { ...current.supportedApps, ...patch.supportedApps }
        : current.supportedApps,
    lastDetectionAt:
      patch.lastDetectionAt !== undefined ? patch.lastDetectionAt : current.lastDetectionAt,
    retentionDays:
      patch.retentionDays !== undefined
        ? Math.min(365, Math.max(7, Math.round(Number(patch.retentionDays) || 90)))
        : current.retentionDays,
    updatedAt: new Date().toISOString(),
  };

  if (!isDatabaseAvailable()) {
    getMemoryUserState(userId).settings = next;
    return next;
  }

  try {
    await query(
      `INSERT INTO public.expense_detection_settings (
         user_id, enabled, auto_popup_enabled, onboarding_completed, supported_apps, last_detection_at, retention_days, updated_at
       )
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, NOW())
       ON CONFLICT (user_id) DO UPDATE SET
         enabled = EXCLUDED.enabled,
         auto_popup_enabled = EXCLUDED.auto_popup_enabled,
         onboarding_completed = EXCLUDED.onboarding_completed,
         supported_apps = EXCLUDED.supported_apps,
         last_detection_at = COALESCE(EXCLUDED.last_detection_at, public.expense_detection_settings.last_detection_at),
         retention_days = EXCLUDED.retention_days,
         updated_at = NOW()`,
      [
        userId,
        next.enabled,
        next.autoPopupEnabled,
        next.onboardingCompleted,
        JSON.stringify(next.supportedApps),
        next.lastDetectionAt,
        next.retentionDays,
      ]
    );
    return next;
  } catch {
    getMemoryUserState(userId).settings = next;
    return next;
  }
}

async function listUserDetected(userId: string): Promise<DetectedTransaction[]> {
  if (!isDatabaseAvailable()) {
    return [...getMemoryUserState(userId).detected].sort(
      (a, b) => new Date(b.notificationTimestamp).getTime() - new Date(a.notificationTimestamp).getTime()
    );
  }
  try {
    const res = await query(
      `SELECT * FROM public.detected_transactions
       WHERE user_id = $1
       ORDER BY notification_timestamp DESC
       LIMIT 200`,
      [userId]
    );
    return res.rows.map(mapRowToDetected);
  } catch {
    return [...getMemoryUserState(userId).detected];
  }
}

async function appendDetectionEvent(
  userId: string,
  event: Omit<DetectionEventLog, 'id' | 'createdAt'>
): Promise<DetectionEventLog> {
  const fullEvent: DetectionEventLog = {
    ...event,
    id: `upi_evt_${crypto.randomBytes(6).toString('hex')}`,
    createdAt: new Date().toISOString(),
  };

  if (!isDatabaseAvailable()) {
    const state = getMemoryUserState(userId);
    state.events.unshift(fullEvent);
    if (state.events.length > 300) state.events.length = 300;
    return fullEvent;
  }

  try {
    await query(
      `INSERT INTO public.transaction_detection_events (
         id, user_id, detected_transaction_id, event_type, source_package, parser_used, parser_version, raw_data_hash, metadata
       ) VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9::jsonb)`,
      [
        fullEvent.id,
        userId,
        fullEvent.detectedTransactionId,
        fullEvent.eventType,
        fullEvent.sourcePackage,
        fullEvent.parserUsed,
        fullEvent.parserVersion,
        fullEvent.rawDataHash,
        JSON.stringify(fullEvent.metadata || {}),
      ]
    );
  } catch {
    const state = getMemoryUserState(userId);
    state.events.unshift(fullEvent);
  }
  return fullEvent;
}

async function upsertDetectedTransaction(
  userId: string,
  record: DetectedTransaction
): Promise<DetectedTransaction> {
  const scoped: DetectedTransaction = { ...record, userId };

  if (!isDatabaseAvailable()) {
    const state = getMemoryUserState(userId);
    const idx = state.detected.findIndex((d) => d.id === scoped.id);
    if (idx >= 0) {
      state.detected[idx] = scoped;
    } else {
      state.detected.unshift(scoped);
    }
    return scoped;
  }

  try {
    await query(
      `INSERT INTO public.detected_transactions (
         id, user_id, amount_paise, currency, source_app, source_app_id, source_package,
         transaction_direction, merchant_name, upi_id, upi_transaction_id, utr_number, rrn,
         transaction_timestamp, notification_timestamp, payment_status, raw_data_hash,
         detection_confidence, verification_status, categorization_status,
         parser_version, parser_used, linked_expense_id, selected_category, description,
         is_test_sample, updated_at
       ) VALUES (
         $1, $2, $3, $4, $5, $6, $7,
         $8, $9, $10, $11, $12, $13,
         $14, $15, $16, $17,
         $18, $19, $20,
         $21, $22, $23, $24, $25,
         $26, NOW()
       )
       ON CONFLICT (id) DO UPDATE SET
         merchant_name = COALESCE(EXCLUDED.merchant_name, public.detected_transactions.merchant_name),
         upi_id = COALESCE(EXCLUDED.upi_id, public.detected_transactions.upi_id),
         upi_transaction_id = COALESCE(EXCLUDED.upi_transaction_id, public.detected_transactions.upi_transaction_id),
         utr_number = COALESCE(EXCLUDED.utr_number, public.detected_transactions.utr_number),
         rrn = COALESCE(EXCLUDED.rrn, public.detected_transactions.rrn),
         detection_confidence = GREATEST(public.detected_transactions.detection_confidence, EXCLUDED.detection_confidence),
         verification_status = EXCLUDED.verification_status,
         categorization_status = EXCLUDED.categorization_status,
         linked_expense_id = COALESCE(EXCLUDED.linked_expense_id, public.detected_transactions.linked_expense_id),
         selected_category = COALESCE(EXCLUDED.selected_category, public.detected_transactions.selected_category),
         description = COALESCE(EXCLUDED.description, public.detected_transactions.description),
         updated_at = NOW()`,
      [
        scoped.id,
        userId,
        scoped.amountPaise,
        scoped.currency,
        scoped.sourceApp,
        scoped.sourceAppId,
        scoped.sourcePackage,
        scoped.transactionDirection,
        scoped.merchantName,
        scoped.upiId,
        scoped.upiTransactionId,
        scoped.utrNumber,
        scoped.rrn,
        scoped.transactionTimestamp,
        scoped.notificationTimestamp,
        scoped.paymentStatus,
        scoped.rawDataHash,
        scoped.detectionConfidence,
        scoped.verificationStatus,
        scoped.categorizationStatus,
        scoped.parserVersion,
        scoped.parserUsed,
        scoped.linkedExpenseId,
        scoped.selectedCategory,
        scoped.description,
        scoped.isTestSample,
      ]
    );
    return scoped;
  } catch {
    const state = getMemoryUserState(userId);
    const idx = state.detected.findIndex((d) => d.id === scoped.id);
    if (idx >= 0) state.detected[idx] = scoped;
    else state.detected.unshift(scoped);
    return scoped;
  }
}

export async function handleUpiDetectionRequest(
  req: IncomingMessage,
  res: ServerResponse,
  pathname: string,
  method: string,
  authResolver: (req: IncomingMessage) => Promise<AuthenticatedUser | null> = authenticateRequest
): Promise<boolean> {
  if (!pathname.startsWith('/api/upi-detection')) {
    return false;
  }

  const authUser = await authResolver(req);
  if (!authUser) {
    sendJson(res, 401, { success: false, code: 'UNAUTHORIZED', message: 'Authentication required.' });
    return true;
  }

  // 1. GET /api/upi-detection/settings
  if (pathname === '/api/upi-detection/settings' && method === 'GET') {
    const settings = await getUserSettings(authUser.id);
    sendJson(res, 200, { success: true, settings });
    return true;
  }

  // 2. PUT /api/upi-detection/settings
  if (pathname === '/api/upi-detection/settings' && method === 'PUT') {
    const body = await parseJsonBody(req);
    const settings = await saveUserSettings(authUser.id, {
      enabled: body.enabled,
      autoPopupEnabled: body.autoPopupEnabled,
      onboardingCompleted: body.onboardingCompleted,
      supportedApps: body.supportedApps,
      retentionDays: body.retentionDays,
    });
    sendJson(res, 200, { success: true, settings });
    return true;
  }

  // 3. POST /api/upi-detection/ingest
  if (pathname === '/api/upi-detection/ingest' && method === 'POST') {
    const rate = checkRateLimit(`upi_ingest:${authUser.id}`, 60, 60 * 1000);
    if (!rate.allowed) {
      sendJson(res, 429, {
        success: false,
        code: 'RATE_LIMITED',
        message: 'Too many notification ingestion requests. Please wait a moment.',
      });
      return true;
    }

    const body = await parseJsonBody(req);
    const settings = await getUserSettings(authUser.id);
    const isTestSample = Boolean(body.isTestSample);

    if (!settings.enabled && !isTestSample) {
      sendJson(res, 200, {
        success: true,
        accepted: false,
        shouldShowPopup: false,
        reason: 'detection_disabled_by_user',
      });
      return true;
    }

    const rawInput: RawNotificationInput = {
      packageName: String(body.packageName || '').trim(),
      title: String(body.title || '').trim(),
      text: String(body.text || '').trim(),
      bigText: body.bigText ? String(body.bigText) : null,
      subText: body.subText ? String(body.subText) : null,
      notificationTimestamp: body.notificationTimestamp || new Date().toISOString(),
      notificationKey: body.notificationKey ? String(body.notificationKey) : null,
      isTestSample,
    };

    if (!rawInput.packageName || (!rawInput.title && !rawInput.text && !rawInput.bigText)) {
      sendJson(res, 400, {
        success: false,
        code: 'INVALID_NOTIFICATION_PAYLOAD',
        message: 'packageName and notification content (title or text) are required.',
      });
      return true;
    }

    const parsed = parseUpiNotification(
      rawInput,
      isTestSample ? undefined : settings.supportedApps
    );

    const rawHash = computeNotificationHash({
      packageName: rawInput.packageName,
      title: rawInput.title,
      text: rawInput.text,
      bigText: rawInput.bigText,
    });

    if (!parsed.accepted || !parsed.transaction) {
      await appendDetectionEvent(authUser.id, {
        detectedTransactionId: null,
        eventType: isTestSample ? 'test_run' : 'rejected',
        sourcePackage: rawInput.packageName,
        parserUsed: parsed.parserUsed,
        parserVersion: parsed.parserVersion,
        rawDataHash: rawHash,
        metadata: {
          rejectionReason: parsed.rejectionReason,
          maskedPreview: maskSensitiveLogPayload(`${rawInput.title} ${rawInput.text}`).slice(0, 140),
        },
      });

      sendJson(res, 200, {
        success: true,
        accepted: false,
        deduplicated: false,
        shouldShowPopup: false,
        rejectionReason: parsed.rejectionReason,
        parserUsed: parsed.parserUsed,
        parserVersion: parsed.parserVersion,
        transaction: null,
      });
      return true;
    }

    const existingList = await listUserDetected(authUser.id);
    const dedup = deduplicateDetectedTransaction(parsed.transaction, existingList);
    const saved = await upsertDetectedTransaction(authUser.id, dedup.mergedRecord);

    await saveUserSettings(authUser.id, {
      lastDetectionAt: new Date().toISOString(),
    });

    await appendDetectionEvent(authUser.id, {
      detectedTransactionId: saved.id,
      eventType: dedup.isDuplicate ? 'deduplicated' : isTestSample ? 'test_run' : 'parsed',
      sourcePackage: saved.sourcePackage,
      parserUsed: saved.parserUsed,
      parserVersion: saved.parserVersion,
      rawDataHash: saved.rawDataHash,
      metadata: {
        deduplicated: dedup.isDuplicate,
        matchReason: dedup.matchReason,
        amountPaise: saved.amountPaise,
        hasUtr: Boolean(saved.utrNumber),
        hasUpiTxnId: Boolean(saved.upiTransactionId),
        isTestSample,
      },
    });

    const shouldShowPopup =
      !dedup.isDuplicate &&
      saved.categorizationStatus === 'pending' &&
      (isTestSample || settings.autoPopupEnabled);

    sendJson(res, 200, {
      success: true,
      accepted: true,
      deduplicated: dedup.isDuplicate,
      matchReason: dedup.matchReason,
      shouldShowPopup,
      transaction: saved,
    });
    return true;
  }

  // 4. GET /api/upi-detection/pending
  if (pathname === '/api/upi-detection/pending' && method === 'GET') {
    const allDetected = await listUserDetected(authUser.id);
    const pending = allDetected.filter(
      (tx) => tx.categorizationStatus === 'pending' || tx.categorizationStatus === 'remind_later'
    );
    const categorized = allDetected.filter((tx) => tx.categorizationStatus === 'categorized');
    const dismissed = allDetected.filter((tx) => tx.categorizationStatus === 'dismissed');

    sendJson(res, 200, {
      success: true,
      pending,
      categorized: categorized.slice(0, 50),
      dismissed: dismissed.slice(0, 30),
      counts: {
        pending: pending.length,
        categorized: categorized.length,
        dismissed: dismissed.length,
        total: allDetected.length,
      },
    });
    return true;
  }

  // 5. POST /api/upi-detection/:id/categorize
  const categorizeMatch = pathname.match(/^\/api\/upi-detection\/([a-zA-Z0-9_-]+)\/categorize$/);
  if (categorizeMatch && method === 'POST') {
    const detectedId = categorizeMatch[1];
    const body = await parseJsonBody(req);
    const category = String(body.category || '').trim() as UpiExpenseCategoryId;
    const description = body.description !== undefined ? String(body.description).trim().slice(0, 240) : null;
    const linkedExpenseId = body.linkedExpenseId ? String(body.linkedExpenseId).trim() : null;

    if (!UPI_EXPENSE_CATEGORIES.some((c) => c.id === category)) {
      sendJson(res, 400, { success: false, message: 'Invalid expense category selected.' });
      return true;
    }

    const allDetected = await listUserDetected(authUser.id);
    const existing = allDetected.find((tx) => tx.id === detectedId);
    if (!existing) {
      sendJson(res, 404, { success: false, message: 'Detected transaction not found.' });
      return true;
    }

    if (existing.categorizationStatus === 'categorized' && existing.linkedExpenseId) {
      sendJson(res, 200, {
        success: true,
        alreadyCategorized: true,
        transaction: existing,
      });
      return true;
    }

    const updated: DetectedTransaction = {
      ...existing,
      categorizationStatus: 'categorized',
      selectedCategory: category,
      description,
      linkedExpenseId: linkedExpenseId || existing.linkedExpenseId || `exp_${existing.id}`,
      updatedAt: new Date().toISOString(),
    };

    await upsertDetectedTransaction(authUser.id, updated);
    await appendDetectionEvent(authUser.id, {
      detectedTransactionId: updated.id,
      eventType: 'categorized',
      sourcePackage: updated.sourcePackage,
      parserUsed: updated.parserUsed,
      parserVersion: updated.parserVersion,
      rawDataHash: updated.rawDataHash,
      metadata: {
        category,
        linkedExpenseId: updated.linkedExpenseId,
      },
    });

    sendJson(res, 200, {
      success: true,
      alreadyCategorized: false,
      transaction: updated,
    });
    return true;
  }

  // 6. POST /api/upi-detection/:id/dismiss
  const dismissMatch = pathname.match(/^\/api\/upi-detection\/([a-zA-Z0-9_-]+)\/dismiss$/);
  if (dismissMatch && method === 'POST') {
    const detectedId = dismissMatch[1];
    const allDetected = await listUserDetected(authUser.id);
    const existing = allDetected.find((tx) => tx.id === detectedId);
    if (!existing) {
      sendJson(res, 404, { success: false, message: 'Detected transaction not found.' });
      return true;
    }

    const updated: DetectedTransaction = {
      ...existing,
      categorizationStatus: 'dismissed',
      updatedAt: new Date().toISOString(),
    };
    await upsertDetectedTransaction(authUser.id, updated);
    await appendDetectionEvent(authUser.id, {
      detectedTransactionId: updated.id,
      eventType: 'dismissed',
      sourcePackage: updated.sourcePackage,
      parserUsed: updated.parserUsed,
      parserVersion: updated.parserVersion,
      rawDataHash: updated.rawDataHash,
      metadata: {},
    });

    sendJson(res, 200, { success: true, transaction: updated });
    return true;
  }

  // 7. POST /api/upi-detection/:id/remind-later
  const remindMatch = pathname.match(/^\/api\/upi-detection\/([a-zA-Z0-9_-]+)\/remind-later$/);
  if (remindMatch && method === 'POST') {
    const detectedId = remindMatch[1];
    const allDetected = await listUserDetected(authUser.id);
    const existing = allDetected.find((tx) => tx.id === detectedId);
    if (!existing) {
      sendJson(res, 404, { success: false, message: 'Detected transaction not found.' });
      return true;
    }

    const updated: DetectedTransaction = {
      ...existing,
      categorizationStatus: 'remind_later',
      updatedAt: new Date().toISOString(),
    };
    await upsertDetectedTransaction(authUser.id, updated);
    await appendDetectionEvent(authUser.id, {
      detectedTransactionId: updated.id,
      eventType: 'remind_later',
      sourcePackage: updated.sourcePackage,
      parserUsed: updated.parserUsed,
      parserVersion: updated.parserVersion,
      rawDataHash: updated.rawDataHash,
      metadata: {},
    });

    sendJson(res, 200, { success: true, transaction: updated });
    return true;
  }

  // 8. PATCH /api/upi-detection/:id/edit (Edits category/description while preserving original payment metadata)
  const editMatch = pathname.match(/^\/api\/upi-detection\/([a-zA-Z0-9_-]+)\/edit$/);
  if (editMatch && method === 'PATCH') {
    const detectedId = editMatch[1];
    const body = await parseJsonBody(req);
    const allDetected = await listUserDetected(authUser.id);
    const existing = allDetected.find((tx) => tx.id === detectedId);
    if (!existing) {
      sendJson(res, 404, { success: false, message: 'Detected transaction not found.' });
      return true;
    }

    const nextCategory = body.category
      ? (String(body.category).trim() as UpiExpenseCategoryId)
      : existing.selectedCategory;

    if (nextCategory && !UPI_EXPENSE_CATEGORIES.some((c) => c.id === nextCategory)) {
      sendJson(res, 400, { success: false, message: 'Invalid expense category.' });
      return true;
    }

    const updated: DetectedTransaction = {
      ...existing,
      selectedCategory: nextCategory,
      description:
        body.description !== undefined
          ? String(body.description || '').trim().slice(0, 240)
          : existing.description,
      updatedAt: new Date().toISOString(),
    };
    await upsertDetectedTransaction(authUser.id, updated);
    await appendDetectionEvent(authUser.id, {
      detectedTransactionId: updated.id,
      eventType: 'edited',
      sourcePackage: updated.sourcePackage,
      parserUsed: updated.parserUsed,
      parserVersion: updated.parserVersion,
      rawDataHash: updated.rawDataHash,
      metadata: {
        category: updated.selectedCategory,
      },
    });

    sendJson(res, 200, { success: true, transaction: updated });
    return true;
  }

  // 9. DELETE /api/upi-detection/reset (Resets configuration and optionally deletes detection history)
  if (pathname === '/api/upi-detection/reset' && method === 'DELETE') {
    const body = await parseJsonBody(req);
    const clearHistory = body.clearHistory !== false;
    const defaults = getDefaultDetectionSettings();

    if (!isDatabaseAvailable()) {
      const state = getMemoryUserState(authUser.id);
      state.settings = defaults;
      if (clearHistory) {
        state.detected = [];
        state.events = [];
      }
    } else {
      try {
        await query(
          `INSERT INTO public.expense_detection_settings (
             user_id, enabled, auto_popup_enabled, onboarding_completed, supported_apps, last_detection_at, retention_days, updated_at
           )
           VALUES ($1, FALSE, TRUE, FALSE, $2::jsonb, NULL, 90, NOW())
           ON CONFLICT (user_id) DO UPDATE SET
             enabled = FALSE,
             auto_popup_enabled = TRUE,
             onboarding_completed = FALSE,
             supported_apps = EXCLUDED.supported_apps,
             last_detection_at = NULL,
             retention_days = 90,
             updated_at = NOW()`,
          [authUser.id, JSON.stringify(defaults.supportedApps)]
        );
        if (clearHistory) {
          await query(`DELETE FROM public.transaction_detection_events WHERE user_id = $1`, [authUser.id]);
          await query(`DELETE FROM public.detected_transactions WHERE user_id = $1`, [authUser.id]);
        }
      } catch {
        const state = getMemoryUserState(authUser.id);
        state.settings = defaults;
        if (clearHistory) {
          state.detected = [];
          state.events = [];
        }
      }
    }

    await logSecurityEvent('UPI_DETECTION_CONFIG_RESET', {
      userId: authUser.id,
      userEmail: authUser.email,
      details: { clearHistory },
    }).catch(() => {});

    sendJson(res, 200, {
      success: true,
      settings: defaults,
      historyCleared: clearHistory,
      message: 'Automatic UPI expense detection configuration has been reset.',
    });
    return true;
  }

  sendJson(res, 404, { success: false, message: 'UPI detection endpoint not found.' });
  return true;
}
