/**
 * Centralized Upload Security, Quarantine, Malware Scanning & Abuse Protection Pipeline
 *
 * Handles all untrusted file uploads:
 * - Admin logos & branding variants (max 10 MB)
 * - Profile pictures (max 2 MB)
 * - Expense receipts & payment screenshots (max 5 MB)
 * - Udhar & transaction attachments (max 5 MB)
 *
 * Security pipeline:
 * 1. Auth & ownership verified by caller
 * 2. Per-user + per-IP upload rate limits & concurrent upload semaphore
 * 3. Storage quota enforcement
 * 4. Filename & double-extension sanitization (blocks .exe, .dll, .bat, .cmd, .ps1, .js, .html, .php, .sh, .jar, .apk, .scr, .msi, archives)
 * 5. Quarantine write + SHA-256 hash + duplicate submission tracking
 * 6. Binary magic-byte inspection, dimension bomb guard, polyglot & EICAR detection
 * 7. EXIF/XMP/comment metadata scrubbing
 * 8. Malware scanner adapter (ClamAV clamscan/clamdscan if installed; never silently marks unverified payloads safe if scanner fails)
 * 9. Admin security incident logging & deduplicated alerts on malicious/rejected uploads
 */

import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { query, isDatabaseAvailable } from './db.js';
import { logSecurityEvent } from './security.js';
import { dispatchServiceAlert } from './healthMonitor.js';
import { recordUploadMetric, updateActiveUploadsDelta } from './telemetry.js';
import {
  putObjectInStorage,
  deleteObjectFromStorage,
  hashOwnerId,
  createSignedPrivateUrl,
  type StorageBucket,
} from './storageService.js';
import {
  MAX_ADMIN_LOGO_BYTES,
  MAX_AVATAR_BYTES,
  MAX_ATTACHMENT_BYTES,
  decodeBase64ToBytes,
  encodeBytesToBase64,
  inspectImageBinary,
  sanitizeUploadFilename,
  stripBinaryImageMetadata,
  type AllowedRasterMime,
} from '../src/lib/uploadSecurityCore.js';
import { validateAndSanitizeSvg } from '../src/lib/svgSanitizer.js';

const execFileAsync = promisify(execFile);
const g = globalThis as any;

export type UploadPurpose =
  | 'admin_logo'
  | 'admin_branding_variant'
  | 'profile_avatar'
  | 'receipt_ocr'
  | 'transaction_attachment'
  | 'udhar_attachment';

export type QuarantineStatus =
  | 'quarantined_pending'
  | 'approved_clean'
  | 'approved_raster_no_clamav'
  | 'rejected_malicious'
  | 'rejected_scan_error'
  | 'deleted';

export interface UploadQuarantineRecord {
  id: string;
  userId: string;
  userEmail: string;
  purpose: UploadPurpose;
  originalFilename: string;
  sanitizedFilename: string;
  declaredMime: string;
  detectedMime: string | null;
  byteSize: number;
  width?: number;
  height?: number;
  sha256: string;
  duplicateOfId?: string | null;
  status: QuarantineStatus;
  scannerEngine: 'clamav' | 'signature_heuristic_only';
  scanVerdict: string;
  threatName?: string | null;
  bucket: StorageBucket;
  objectKey: string;
  ipAddress: string;
  createdAt: string;
  updatedAt: string;
  reviewedBy?: string | null;
}

export interface UploadScanLogEntry {
  id: string;
  quarantineId: string;
  userId: string;
  purpose: UploadPurpose;
  outcome: 'approved' | 'pending_review' | 'rejected';
  scannerEngine: 'clamav' | 'signature_heuristic_only';
  reason: string;
  byteSize: number;
  sha256: string;
  ipAddress: string;
  createdAt: string;
}

const QUARANTINE_META_FILE = path.resolve(process.cwd(), '.data', 'storage', 'quarantine-index.json');
const UPLOAD_LOGS_FILE = path.resolve(process.cwd(), '.data', 'storage', 'upload-scan-logs.json');
const MAX_ACTIVE_UPLOADS_GLOBAL = 24;
const MAX_ACTIVE_UPLOADS_PER_USER = 4;
const MAX_STORAGE_QUOTA_PER_USER_BYTES = 100 * 1024 * 1024; // 100 MB per user
const MAX_GLOBAL_BRANDING_BYTES = 250 * 1024 * 1024; // 250 MB

if (!g.__mmUploadRateMap) g.__mmUploadRateMap = new Map<string, { count: number; resetAt: number }>();
if (!g.__mmUploadActiveByUser) g.__mmUploadActiveByUser = new Map<string, number>();
if (!g.__mmQuarantineCache) g.__mmQuarantineCache = null as Record<string, UploadQuarantineRecord> | null;
if (!g.__mmUploadLogsCache) g.__mmUploadLogsCache = null as UploadScanLogEntry[] | null;

let cachedClamAvBinary: string | null | undefined = undefined;

async function detectClamAvBinary(): Promise<string | null> {
  if (cachedClamAvBinary !== undefined) return cachedClamAvBinary;
  for (const candidate of ['clamdscan', 'clamscan']) {
    try {
      const { stdout } = await execFileAsync('which', [candidate], { timeout: 1500 });
      const resolved = String(stdout || '').trim();
      if (resolved) {
        cachedClamAvBinary = resolved;
        return resolved;
      }
    } catch {}
  }
  cachedClamAvBinary = null;
  return null;
}

export async function getMalwareScannerStatus() {
  const bin = await detectClamAvBinary();
  return {
    clamAvAvailable: Boolean(bin),
    clamAvBinary: bin,
    requireClamAvStrict: process.env.REQUIRE_CLAMAV_SCAN === 'true',
    mode: bin ? 'clamav_active' : 'degraded_no_clamav',
    description: bin
      ? `Active malware scanner (${path.basename(bin)}) scanning quarantined uploads`
      : 'ClamAV daemon not installed in container; binary magic-byte, dimension-bomb, polyglot, EICAR & quarantine gate active',
  };
}

function loadQuarantineIndex(): Record<string, UploadQuarantineRecord> {
  if (g.__mmQuarantineCache) return g.__mmQuarantineCache;
  try {
    if (fs.existsSync(QUARANTINE_META_FILE)) {
      const parsed = JSON.parse(fs.readFileSync(QUARANTINE_META_FILE, 'utf8'));
      if (parsed && typeof parsed === 'object') {
        g.__mmQuarantineCache = parsed;
        return parsed;
      }
    }
  } catch {}
  g.__mmQuarantineCache = {};
  return g.__mmQuarantineCache;
}

function saveQuarantineIndex(index: Record<string, UploadQuarantineRecord>) {
  // Keep latest 500 records in index
  const sorted = Object.values(index)
    .sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt))
    .slice(0, 500);
  const compact: Record<string, UploadQuarantineRecord> = {};
  for (const r of sorted) compact[r.id] = r;
  g.__mmQuarantineCache = compact;
  try {
    fs.mkdirSync(path.dirname(QUARANTINE_META_FILE), { recursive: true });
    fs.writeFileSync(QUARANTINE_META_FILE, JSON.stringify(compact, null, 2), 'utf8');
  } catch {}
}

function appendUploadScanLog(entry: UploadScanLogEntry) {
  if (!g.__mmUploadLogsCache) {
    try {
      if (fs.existsSync(UPLOAD_LOGS_FILE)) {
        const parsed = JSON.parse(fs.readFileSync(UPLOAD_LOGS_FILE, 'utf8'));
        g.__mmUploadLogsCache = Array.isArray(parsed) ? parsed : [];
      } else {
        g.__mmUploadLogsCache = [];
      }
    } catch {
      g.__mmUploadLogsCache = [];
    }
  }
  const logs = g.__mmUploadLogsCache as UploadScanLogEntry[];
  logs.unshift(entry);
  if (logs.length > 500) logs.length = 500;
  try {
    fs.mkdirSync(path.dirname(UPLOAD_LOGS_FILE), { recursive: true });
    fs.writeFileSync(UPLOAD_LOGS_FILE, JSON.stringify(logs, null, 2), 'utf8');
  } catch {}

  if (isDatabaseAvailable()) {
    query(
      `INSERT INTO public.upload_security_logs
        (id, quarantine_id, user_id, purpose, outcome, scanner_engine, reason, byte_size, sha256, ip_address, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,NOW())
       ON CONFLICT (id) DO NOTHING`,
      [
        entry.id,
        entry.quarantineId,
        entry.userId,
        entry.purpose,
        entry.outcome,
        entry.scannerEngine,
        entry.reason,
        entry.byteSize,
        entry.sha256,
        entry.ipAddress,
      ]
    ).catch(() => {});
  }
}

function persistQuarantineRecordDb(rec: UploadQuarantineRecord) {
  if (!isDatabaseAvailable()) return;
  query(
    `INSERT INTO public.upload_quarantine_items
      (id, user_id, user_email, purpose, original_filename, sanitized_filename, declared_mime, detected_mime, byte_size, width, height, sha256, status, scanner_engine, scan_verdict, threat_name, bucket, object_key, ip_address, created_at, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,NOW(),NOW())
     ON CONFLICT (id) DO UPDATE SET
      status = EXCLUDED.status,
      scan_verdict = EXCLUDED.scan_verdict,
      threat_name = EXCLUDED.threat_name,
      bucket = EXCLUDED.bucket,
      object_key = EXCLUDED.object_key,
      updated_at = NOW()`,
    [
      rec.id,
      rec.userId,
      rec.userEmail,
      rec.purpose,
      rec.originalFilename,
      rec.sanitizedFilename,
      rec.declaredMime,
      rec.detectedMime,
      rec.byteSize,
      rec.width || null,
      rec.height || null,
      rec.sha256,
      rec.status,
      rec.scannerEngine,
      rec.scanVerdict,
      rec.threatName || null,
      rec.bucket,
      rec.objectKey,
      rec.ipAddress,
    ]
  ).catch(() => {});
}

function checkUploadRateLimit(key: string, maxRequests: number, windowMs: number): boolean {
  const rateMap = g.__mmUploadRateMap as Map<string, { count: number; resetAt: number }>;
  const now = Date.now();
  const existing = rateMap.get(key);
  if (!existing || now > existing.resetAt) {
    rateMap.set(key, { count: 1, resetAt: now + windowMs });
    return true;
  }
  if (existing.count >= maxRequests) return false;
  existing.count += 1;
  return true;
}

function getLimitForPurpose(purpose: UploadPurpose): number {
  switch (purpose) {
    case 'admin_logo':
    case 'admin_branding_variant':
      return MAX_ADMIN_LOGO_BYTES; // 10 MB
    case 'profile_avatar':
      return MAX_AVATAR_BYTES; // 2 MB
    case 'receipt_ocr':
    case 'transaction_attachment':
    case 'udhar_attachment':
    default:
      return MAX_ATTACHMENT_BYTES; // 5 MB
  }
}

async function runClamAvScanBuffer(bytes: Buffer): Promise<{
  available: boolean;
  clean: boolean;
  threat?: string;
  error?: string;
}> {
  const bin = await detectClamAvBinary();
  if (!bin) {
    return { available: false, clean: false };
  }

  const tmpDir = path.resolve(process.cwd(), '.data', 'storage', 'tmp-scan');
  fs.mkdirSync(tmpDir, { recursive: true });
  const tmpFile = path.join(tmpDir, `scan_${crypto.randomUUID()}.bin`);
  try {
    fs.writeFileSync(tmpFile, bytes);
    const args = bin.endsWith('clamdscan') ? ['--no-summary', tmpFile] : ['--no-summary', '--infected', tmpFile];
    await execFileAsync(bin, args, { timeout: 15000 });
    return { available: true, clean: true };
  } catch (err: any) {
    // clamscan exits with code 1 when virus found
    const stdout = String(err?.stdout || err?.message || '');
    if (err?.code === 1 || /FOUND/i.test(stdout)) {
      return { available: true, clean: false, threat: stdout.slice(0, 180) || 'CLAMAV_INFECTED' };
    }
    return { available: true, clean: false, error: `ClamAV scan failed: ${stdout.slice(0, 140)}` };
  } finally {
    try {
      if (fs.existsSync(tmpFile)) fs.unlinkSync(tmpFile);
    } catch {}
  }
}

async function notifyAdminSecurityUploadThreat(params: {
  userId: string;
  userEmail: string;
  purpose: UploadPurpose;
  reason: string;
  filename: string;
  ipAddress: string;
  quarantineId: string;
}) {
  recordUploadMetric('quarantined');
  await logSecurityEvent('MALICIOUS_OR_UNSAFE_UPLOAD_BLOCKED', {
    userId: params.userId,
    userEmail: params.userEmail,
    ipAddress: params.ipAddress,
    details: {
      quarantineId: params.quarantineId,
      purpose: params.purpose,
      filename: params.filename,
      reason: params.reason,
    },
  }).catch(() => {});

  if (isDatabaseAvailable()) {
    await query(
      `INSERT INTO public.security_incidents (user_id, user_email, incident_type, severity, title, description, ip_address, metadata)
       VALUES ($1, $2, 'UPLOAD_THREAT_QUARANTINED', 'high', $3, $4, $5, $6)`,
      [
        params.userId,
        params.userEmail,
        `Blocked suspicious upload (${params.purpose})`,
        `${params.reason} · File "${params.filename}" quarantined (${params.quarantineId}).`,
        params.ipAddress,
        JSON.stringify({ quarantineId: params.quarantineId, purpose: params.purpose }),
      ]
    ).catch(() => {});
  }

  await dispatchServiceAlert({
    serviceKey: 'upload_security_gate',
    serviceLabel: 'Upload Security & Quarantine Gate',
    transition: 'failure',
    errorDetails: `${params.purpose} rejected (${params.reason}) from ${params.userEmail || params.ipAddress}`,
  }).catch(() => {});
}

export interface SecureUploadInput {
  userId: string;
  userEmail: string;
  purpose: UploadPurpose;
  filename?: string;
  dataUrlOrRawBase64: string;
  declaredMime?: string;
  ipAddress: string;
  allowSvg?: boolean;
  strictClamAvHold?: boolean;
  skipRateLimit?: boolean;
}

export interface SecureUploadResult {
  success: boolean;
  quarantineId: string;
  status: QuarantineStatus;
  mimeType?: string;
  sanitizedDataUrl?: string;
  sanitizedSvg?: string;
  cleanBytes?: Buffer;
  width?: number;
  height?: number;
  byteSize?: number;
  sha256?: string;
  scannerEngine: 'clamav' | 'signature_heuristic_only';
  signedAccessUrl?: string;
  signedUrlExpiresAt?: string;
  objectKey?: string;
  bucket?: StorageBucket;
  duplicateOfId?: string | null;
  error?: string;
}

/**
 * Full quarantine-first validation, malware scan, EXIF scrub, and controlled storage pipeline.
 */
export async function processSecureUpload(input: SecureUploadInput): Promise<SecureUploadResult> {
  const activeByUser = g.__mmUploadActiveByUser as Map<string, number>;
  const currentUserActive = activeByUser.get(input.userId) || 0;
  const globalActive = Array.from(activeByUser.values()).reduce((s, n) => s + n, 0);

  if (globalActive >= MAX_ACTIVE_UPLOADS_GLOBAL || currentUserActive >= MAX_ACTIVE_UPLOADS_PER_USER) {
    recordUploadMetric('rejected');
    return {
      success: false,
      quarantineId: `q_limit_${Date.now()}`,
      status: 'rejected_scan_error',
      scannerEngine: 'signature_heuristic_only',
      error: 'Too many concurrent uploads in progress. Please wait for the current upload to complete.',
    };
  }

  if (!input.skipRateLimit) {
    const userOk = checkUploadRateLimit(`up:user:${input.userId}`, 30, 10 * 60 * 1000);
    const ipOk = checkUploadRateLimit(`up:ip:${input.ipAddress}`, 60, 10 * 60 * 1000);
    if (!userOk || !ipOk) {
      recordUploadMetric('rejected');
      return {
        success: false,
        quarantineId: `q_rate_${Date.now()}`,
        status: 'rejected_scan_error',
        scannerEngine: 'signature_heuristic_only',
        error: 'Upload rate limit exceeded. Please wait a few minutes before uploading again.',
      };
    }
  }

  activeByUser.set(input.userId, currentUserActive + 1);
  updateActiveUploadsDelta(1);

  const quarantineId = `q_${Date.now()}_${crypto.randomBytes(5).toString('hex')}`;
  const rawName = String(input.filename || 'upload.png').slice(0, 160);

  try {
    // 1. Filename & dangerous extension check
    const fnCheck = sanitizeUploadFilename(rawName);
    if (!fnCheck.valid) {
      await notifyAdminSecurityUploadThreat({
        userId: input.userId,
        userEmail: input.userEmail,
        purpose: input.purpose,
        reason: fnCheck.error || 'DANGEROUS_FILENAME',
        filename: rawName,
        ipAddress: input.ipAddress,
        quarantineId,
      });
      appendUploadScanLog({
        id: `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        quarantineId,
        userId: input.userId,
        purpose: input.purpose,
        outcome: 'rejected',
        scannerEngine: 'signature_heuristic_only',
        reason: fnCheck.error || 'DANGEROUS_FILENAME',
        byteSize: 0,
        sha256: '',
        ipAddress: input.ipAddress,
        createdAt: new Date().toISOString(),
      });
      return {
        success: false,
        quarantineId,
        status: 'rejected_malicious',
        scannerEngine: 'signature_heuristic_only',
        error: fnCheck.error || 'File rejected by extension security policy.',
      };
    }

    const rawInput = String(input.dataUrlOrRawBase64 || '').trim();
    const isSvgInput =
      /^data:image\/svg\+xml/i.test(rawInput) ||
      /^<\?xml/i.test(rawInput) ||
      /^<svg[\s>]/i.test(rawInput) ||
      fnCheck.extension === 'svg' ||
      fnCheck.extension === 'svgz';

    if (isSvgInput) {
      if (!input.allowSvg) {
        recordUploadMetric('rejected');
        return {
          success: false,
          quarantineId,
          status: 'rejected_malicious',
          scannerEngine: 'signature_heuristic_only',
          error: 'SVG uploads are disabled by default for security. Upload PNG, JPG, JPEG, or WebP (or explicitly enable sanitized SVG mode for branding).',
        };
      }
      const svgCheck = validateAndSanitizeSvg(rawInput);
      if (!svgCheck.valid || !svgCheck.sanitizedSvg || !svgCheck.sanitizedDataUrl) {
        await notifyAdminSecurityUploadThreat({
          userId: input.userId,
          userEmail: input.userEmail,
          purpose: input.purpose,
          reason: svgCheck.error || 'UNSAFE_SVG_PAYLOAD',
          filename: fnCheck.sanitizedName,
          ipAddress: input.ipAddress,
          quarantineId,
        });
        return {
          success: false,
          quarantineId,
          status: 'rejected_malicious',
          scannerEngine: 'signature_heuristic_only',
          error: svgCheck.error || 'SVG rejected by strict security sanitizer.',
        };
      }
      const svgBuf = Buffer.from(svgCheck.sanitizedSvg, 'utf8');
      const sha256 = crypto.createHash('sha256').update(svgBuf).digest('hex');
      const clamRes = await runClamAvScanBuffer(svgBuf);
      if (clamRes.available && !clamRes.clean) {
        await notifyAdminSecurityUploadThreat({
          userId: input.userId,
          userEmail: input.userEmail,
          purpose: input.purpose,
          reason: clamRes.threat || clamRes.error || 'CLAMAV_REJECTED',
          filename: fnCheck.sanitizedName,
          ipAddress: input.ipAddress,
          quarantineId,
        });
        return {
          success: false,
          quarantineId,
          status: 'rejected_malicious',
          scannerEngine: 'clamav',
          error: 'Upload flagged by antivirus scanner and quarantined.',
        };
      }

      const scannerEngine = clamRes.available ? 'clamav' : 'signature_heuristic_only';
      const status: QuarantineStatus = clamRes.available ? 'approved_clean' : 'approved_raster_no_clamav';
      const objKey = `${hashOwnerId(input.userId)}/${quarantineId}.svg`;
      await putObjectInStorage({
        bucket: 'branding-originals',
        objectKey: objKey,
        data: svgBuf,
        contentType: 'image/svg+xml',
      });
      recordUploadMetric('success');
      appendUploadScanLog({
        id: `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        quarantineId,
        userId: input.userId,
        purpose: input.purpose,
        outcome: 'approved',
        scannerEngine,
        reason: 'Sanitized SVG verified cleanly',
        byteSize: svgBuf.length,
        sha256,
        ipAddress: input.ipAddress,
        createdAt: new Date().toISOString(),
      });
      return {
        success: true,
        quarantineId,
        status,
        mimeType: 'image/svg+xml',
        sanitizedDataUrl: svgCheck.sanitizedDataUrl,
        sanitizedSvg: svgCheck.sanitizedSvg,
        cleanBytes: svgBuf,
        width: svgCheck.width,
        height: svgCheck.height,
        byteSize: svgBuf.length,
        sha256,
        scannerEngine,
        bucket: 'branding-originals',
        objectKey: objKey,
      };
    }

    // 2. Decode base64 payload safely
    const dataUrlMatch = rawInput.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/i);
    const declaredMime = dataUrlMatch
      ? dataUrlMatch[1].toLowerCase()
      : (input.declaredMime || '').toLowerCase() || undefined;
    const base64Body = (dataUrlMatch ? dataUrlMatch[2] : rawInput).replace(/\s+/g, '');

    let rawBytes: Uint8Array;
    try {
      rawBytes = decodeBase64ToBytes(base64Body);
    } catch {
      recordUploadMetric('rejected');
      return {
        success: false,
        quarantineId,
        status: 'rejected_scan_error',
        scannerEngine: 'signature_heuristic_only',
        error: 'Malformed base64 upload payload.',
      };
    }

    const maxBytes = getLimitForPurpose(input.purpose);
    const sha256 = crypto.createHash('sha256').update(rawBytes).digest('hex');

    // 3. Check user/branding storage quota
    const qIndex = loadQuarantineIndex();
    const userUsedBytes = Object.values(qIndex)
      .filter((r) => r.userId === input.userId && r.status !== 'deleted' && r.status !== 'rejected_malicious')
      .reduce((sum, r) => sum + (r.byteSize || 0), 0);
    const quotaLimit =
      input.purpose === 'admin_logo' || input.purpose === 'admin_branding_variant'
        ? MAX_GLOBAL_BRANDING_BYTES
        : MAX_STORAGE_QUOTA_PER_USER_BYTES;
    if (userUsedBytes + rawBytes.length > quotaLimit) {
      recordUploadMetric('rejected');
      return {
        success: false,
        quarantineId,
        status: 'rejected_scan_error',
        scannerEngine: 'signature_heuristic_only',
        error: 'Storage quota limit reached. Please remove older unused files before uploading more.',
      };
    }

    // Check duplicate hash
    const dupMatch = Object.values(qIndex).find(
      (r) => r.userId === input.userId && r.sha256 === sha256 && r.status !== 'deleted'
    );

    // 4. Write incoming untrusted payload to Quarantine Vault BEFORE validation promotion
    const quarantineKey = `${hashOwnerId(input.userId)}/${quarantineId}.qbin`;
    await putObjectInStorage({
      bucket: 'quarantine-vault',
      objectKey: quarantineKey,
      data: Buffer.from(rawBytes),
      contentType: 'application/octet-stream',
    });

    // 5. Inspect magic bytes, header dimensions, decompression bombs, EICAR & polyglot payloads
    const binaryCheck = inspectImageBinary(rawBytes, declaredMime, {
      maxBytes,
      allowGif: false,
    });

    if (!binaryCheck.valid || !binaryCheck.detectedMime) {
      const threatReason = binaryCheck.threatDetected || binaryCheck.error || 'BINARY_VALIDATION_FAILED';
      const rejectedRec: UploadQuarantineRecord = {
        id: quarantineId,
        userId: input.userId,
        userEmail: input.userEmail,
        purpose: input.purpose,
        originalFilename: rawName,
        sanitizedFilename: fnCheck.sanitizedName,
        declaredMime: declaredMime || 'unknown',
        detectedMime: null,
        byteSize: rawBytes.length,
        sha256,
        duplicateOfId: dupMatch?.id || null,
        status: 'rejected_malicious',
        scannerEngine: 'signature_heuristic_only',
        scanVerdict: threatReason,
        threatName: binaryCheck.threatDetected || 'INVALID_OR_DISALLOWED_FILE',
        bucket: 'quarantine-vault',
        objectKey: quarantineKey,
        ipAddress: input.ipAddress,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      qIndex[quarantineId] = rejectedRec;
      saveQuarantineIndex(qIndex);
      persistQuarantineRecordDb(rejectedRec);
      appendUploadScanLog({
        id: `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        quarantineId,
        userId: input.userId,
        purpose: input.purpose,
        outcome: 'rejected',
        scannerEngine: 'signature_heuristic_only',
        reason: binaryCheck.error || threatReason,
        byteSize: rawBytes.length,
        sha256,
        ipAddress: input.ipAddress,
        createdAt: new Date().toISOString(),
      });
      await notifyAdminSecurityUploadThreat({
        userId: input.userId,
        userEmail: input.userEmail,
        purpose: input.purpose,
        reason: binaryCheck.error || threatReason,
        filename: rawName,
        ipAddress: input.ipAddress,
        quarantineId,
      });

      return {
        success: false,
        quarantineId,
        status: 'rejected_malicious',
        byteSize: rawBytes.length,
        sha256,
        scannerEngine: 'signature_heuristic_only',
        error: binaryCheck.error || 'Uploaded file failed security inspection.',
      };
    }

    // 6. Run ClamAV scan if installed
    const rawBuf = Buffer.from(rawBytes);
    const clamRes = await runClamAvScanBuffer(rawBuf);
    const scannerEngine: 'clamav' | 'signature_heuristic_only' = clamRes.available
      ? 'clamav'
      : 'signature_heuristic_only';

    if (clamRes.available && !clamRes.clean) {
      const verdict = clamRes.threat || clamRes.error || 'MALWARE_SCAN_FAILED';
      const status: QuarantineStatus = clamRes.threat ? 'rejected_malicious' : 'rejected_scan_error';
      const rec: UploadQuarantineRecord = {
        id: quarantineId,
        userId: input.userId,
        userEmail: input.userEmail,
        purpose: input.purpose,
        originalFilename: rawName,
        sanitizedFilename: fnCheck.sanitizedName,
        declaredMime: declaredMime || binaryCheck.detectedMime,
        detectedMime: binaryCheck.detectedMime,
        byteSize: rawBytes.length,
        width: binaryCheck.width,
        height: binaryCheck.height,
        sha256,
        status,
        scannerEngine: 'clamav',
        scanVerdict: verdict,
        threatName: clamRes.threat || 'SCAN_FAILURE',
        bucket: 'quarantine-vault',
        objectKey: quarantineKey,
        ipAddress: input.ipAddress,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      qIndex[quarantineId] = rec;
      saveQuarantineIndex(qIndex);
      persistQuarantineRecordDb(rec);
      appendUploadScanLog({
        id: `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        quarantineId,
        userId: input.userId,
        purpose: input.purpose,
        outcome: 'rejected',
        scannerEngine: 'clamav',
        reason: verdict,
        byteSize: rawBytes.length,
        sha256,
        ipAddress: input.ipAddress,
        createdAt: new Date().toISOString(),
      });
      await notifyAdminSecurityUploadThreat({
        userId: input.userId,
        userEmail: input.userEmail,
        purpose: input.purpose,
        reason: verdict,
        filename: rawName,
        ipAddress: input.ipAddress,
        quarantineId,
      });
      return {
        success: false,
        quarantineId,
        status,
        sha256,
        scannerEngine: 'clamav',
        error: clamRes.threat
          ? 'Malware detected in uploaded file. Upload blocked and quarantined.'
          : 'Antivirus scanner error prevented verification. File remains quarantined.',
      };
    }

    // 7. Strict AV Hold policy when requested or REQUIRE_CLAMAV_SCAN=true and ClamAV is absent
    const strictHold = !clamRes.available && (Boolean(input.strictClamAvHold) || process.env.REQUIRE_CLAMAV_SCAN === 'true');
    if (strictHold) {
      const pendingRec: UploadQuarantineRecord = {
        id: quarantineId,
        userId: input.userId,
        userEmail: input.userEmail,
        purpose: input.purpose,
        originalFilename: rawName,
        sanitizedFilename: fnCheck.sanitizedName,
        declaredMime: declaredMime || binaryCheck.detectedMime,
        detectedMime: binaryCheck.detectedMime,
        byteSize: rawBytes.length,
        width: binaryCheck.width,
        height: binaryCheck.height,
        sha256,
        duplicateOfId: dupMatch?.id || null,
        status: 'quarantined_pending',
        scannerEngine: 'signature_heuristic_only',
        scanVerdict: 'ClamAV unavailable; held in quarantine pending admin/AV verification',
        bucket: 'quarantine-vault',
        objectKey: quarantineKey,
        ipAddress: input.ipAddress,
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
      };
      qIndex[quarantineId] = pendingRec;
      saveQuarantineIndex(qIndex);
      persistQuarantineRecordDb(pendingRec);
      appendUploadScanLog({
        id: `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
        quarantineId,
        userId: input.userId,
        purpose: input.purpose,
        outcome: 'pending_review',
        scannerEngine: 'signature_heuristic_only',
        reason: 'ClamAV unavailable; upload held in pending quarantine',
        byteSize: rawBytes.length,
        sha256,
        ipAddress: input.ipAddress,
        createdAt: new Date().toISOString(),
      });
      return {
        success: false,
        quarantineId,
        status: 'quarantined_pending',
        mimeType: binaryCheck.detectedMime,
        width: binaryCheck.width,
        height: binaryCheck.height,
        byteSize: rawBytes.length,
        sha256,
        scannerEngine: 'signature_heuristic_only',
        error: 'Upload placed in quarantine pending antivirus review (scanner unavailable).',
      };
    }

    // 8. Strip EXIF/metadata & trailing polyglot bytes, promote from quarantine to controlled bucket
    const scrubbedBytes = stripBinaryImageMetadata(rawBytes, binaryCheck.detectedMime);
    const cleanBuf = Buffer.from(scrubbedBytes);
    const cleanB64 = encodeBytesToBase64(scrubbedBytes);
    const cleanDataUrl = `data:${binaryCheck.detectedMime};base64,${cleanB64}`;
    const ext =
      binaryCheck.detectedMime === 'image/png'
        ? 'png'
        : binaryCheck.detectedMime === 'image/webp'
        ? 'webp'
        : 'jpg';

    const targetBucket: StorageBucket =
      input.purpose === 'admin_logo'
        ? 'branding-originals'
        : input.purpose === 'admin_branding_variant'
        ? 'branding-optimized'
        : 'private-attachments';

    const targetKey = `${hashOwnerId(input.userId)}/${quarantineId}.${ext}`;
    await putObjectInStorage({
      bucket: targetBucket,
      objectKey: targetKey,
      data: cleanBuf,
      contentType: binaryCheck.detectedMime,
    });
    // Clean temporary quarantine binary once promoted
    await deleteObjectFromStorage('quarantine-vault', quarantineKey);

    const finalStatus: QuarantineStatus = clamRes.available
      ? 'approved_clean'
      : 'approved_raster_no_clamav';

    const approvedRec: UploadQuarantineRecord = {
      id: quarantineId,
      userId: input.userId,
      userEmail: input.userEmail,
      purpose: input.purpose,
      originalFilename: rawName,
      sanitizedFilename: fnCheck.sanitizedName,
      declaredMime: declaredMime || binaryCheck.detectedMime,
      detectedMime: binaryCheck.detectedMime,
      byteSize: cleanBuf.length,
      width: binaryCheck.width,
      height: binaryCheck.height,
      sha256,
      duplicateOfId: dupMatch?.id || null,
      status: finalStatus,
      scannerEngine,
      scanVerdict: clamRes.available
        ? 'ClamAV clean + binary header & EXIF scrub passed'
        : 'Binary header, dimension-bomb, EICAR/polyglot & EXIF scrub passed (ClamAV not installed)',
      bucket: targetBucket,
      objectKey: targetKey,
      ipAddress: input.ipAddress,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    qIndex[quarantineId] = approvedRec;
    saveQuarantineIndex(qIndex);
    persistQuarantineRecordDb(approvedRec);

    appendUploadScanLog({
      id: `log_${Date.now()}_${crypto.randomBytes(3).toString('hex')}`,
      quarantineId,
      userId: input.userId,
      purpose: input.purpose,
      outcome: 'approved',
      scannerEngine,
      reason: approvedRec.scanVerdict,
      byteSize: cleanBuf.length,
      sha256,
      ipAddress: input.ipAddress,
      createdAt: new Date().toISOString(),
    });

    recordUploadMetric('success');

    let signedUrlInfo: { url: string; expiresAt: string } | undefined;
    if (targetBucket === 'private-attachments') {
      const signed = await createSignedPrivateUrl({
        bucket: targetBucket,
        objectKey: targetKey,
        ownerUserId: input.userId,
        mimeType: binaryCheck.detectedMime,
        ttlSeconds: 300,
      });
      signedUrlInfo = { url: signed.url, expiresAt: signed.expiresAt };
    }

    return {
      success: true,
      quarantineId,
      status: finalStatus,
      mimeType: binaryCheck.detectedMime,
      sanitizedDataUrl: cleanDataUrl,
      cleanBytes: cleanBuf,
      width: binaryCheck.width,
      height: binaryCheck.height,
      byteSize: cleanBuf.length,
      sha256,
      scannerEngine,
      bucket: targetBucket,
      objectKey: targetKey,
      signedAccessUrl: signedUrlInfo?.url,
      signedUrlExpiresAt: signedUrlInfo?.expiresAt,
      duplicateOfId: dupMatch?.id || null,
    };
  } finally {
    const cur = activeByUser.get(input.userId) || 1;
    if (cur <= 1) activeByUser.delete(input.userId);
    else activeByUser.set(input.userId, cur - 1);
    updateActiveUploadsDelta(-1);
  }
}

export async function getUploadSecurityDashboardState() {
  const index = loadQuarantineIndex();
  const records = Object.values(index).sort(
    (a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt)
  );
  const logs = (g.__mmUploadLogsCache as UploadScanLogEntry[]) || (() => {
    try {
      if (fs.existsSync(UPLOAD_LOGS_FILE)) {
        return JSON.parse(fs.readFileSync(UPLOAD_LOGS_FILE, 'utf8'));
      }
    } catch {}
    return [];
  })();

  const scannerStatus = await getMalwareScannerStatus();
  return {
    scannerStatus,
    counts: {
      total: records.length,
      approved: records.filter((r) => r.status === 'approved_clean' || r.status === 'approved_raster_no_clamav').length,
      quarantinedPending: records.filter((r) => r.status === 'quarantined_pending').length,
      rejectedMalicious: records.filter((r) => r.status === 'rejected_malicious' || r.status === 'rejected_scan_error').length,
    },
    quarantineItems: records.slice(0, 60),
    scanLogs: Array.isArray(logs) ? logs.slice(0, 80) : [],
  };
}

export async function adminReviewQuarantineItem(params: {
  quarantineId: string;
  action: 'approve' | 'delete';
  adminEmail: string;
}): Promise<{ success: boolean; message: string; item?: UploadQuarantineRecord }> {
  const index = loadQuarantineIndex();
  const item = index[params.quarantineId];
  if (!item) {
    return { success: false, message: 'Quarantine record not found.' };
  }

  if (params.action === 'delete') {
    await deleteObjectFromStorage(item.bucket, item.objectKey);
    item.status = 'deleted';
    item.reviewedBy = params.adminEmail;
    item.updatedAt = new Date().toISOString();
    saveQuarantineIndex(index);
    persistQuarantineRecordDb(item);
    return { success: true, message: 'Quarantined file securely deleted.', item };
  }

  if (item.status === 'rejected_malicious') {
    return {
      success: false,
      message: 'Files flagged with malicious payloads cannot be approved. Delete the quarantined file instead.',
    };
  }

  item.status = 'approved_clean';
  item.scanVerdict = `Manually approved by ${params.adminEmail}`;
  item.reviewedBy = params.adminEmail;
  item.updatedAt = new Date().toISOString();
  saveQuarantineIndex(index);
  persistQuarantineRecordDb(item);
  return { success: true, message: 'Quarantined file approved.', item };
}
