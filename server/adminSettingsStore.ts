import crypto from 'crypto';
import fs from 'fs';
import os from 'os';
import path from 'path';
import { query, isDatabaseAvailable } from './db.js';
import { sbRestRequest } from './supabaseRestFallback.js';

export interface MaintenanceConfig {
  isEnabled: boolean;
  title: string;
  message: string;
  expectedRestoration: string;
  allowStaffAccessDuringMaintenance: boolean;
  emergencyBypassEnabled: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

export interface AppPopupConfig {
  enabled: boolean;
  downloadUrl: string;
  title: string;
  description: string;
  buttonLabel: string;
  updatedAt?: string;
  updatedBy?: string;
}

export interface ApiKeyValidationRecord {
  valid: boolean;
  message: string;
  checkedAt: string;
}

export interface MaskedApiKeyInfo {
  configured: boolean;
  hasSavedKey: boolean;
  maskedApiKey: string;
  source: 'admin_settings' | 'env' | 'none';
  updatedAt: string | null;
  updatedBy: string | null;
  lastValidation: ApiKeyValidationRecord | null;
}

export interface SmtpSettingsInput {
  host?: string;
  port?: number;
  secure?: boolean;
  user?: string;
  pass?: string;
  fromEmail?: string;
  fromName?: string;
  enabled?: boolean;
}

export interface EffectiveSmtpConfig {
  configured: boolean;
  enabled: boolean;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  from: string;
  fromEmail: string;
  fromName: string;
  source: 'admin_settings' | 'env' | 'none';
}

export interface MaskedSmtpSettings {
  configured: boolean;
  enabled: boolean;
  hasSavedPassword: boolean;
  maskedPassword: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  fromName: string;
  source: 'admin_settings' | 'env' | 'none';
  updatedAt: string | null;
  updatedBy: string | null;
}

export const DEFAULT_MAINTENANCE_CONFIG: MaintenanceConfig = {
  isEnabled: false,
  title: 'My Money Manager is Under Scheduled Maintenance',
  message:
    'We are upgrading our secure financial infrastructure to deliver better performance and security. Normal services will resume shortly.',
  expectedRestoration: 'Within 2 hours',
  allowStaffAccessDuringMaintenance: true,
  emergencyBypassEnabled: true,
};

export const DEFAULT_APP_POPUP_CONFIG: AppPopupConfig = {
  enabled: true,
  downloadUrl: '/#install',
  title: 'Get My Money Manager App',
  description: 'Track expenses, Udhar & smart insights faster with our mobile app.',
  buttonLabel: 'Download App',
};

const PRIMARY_DATA_DIR = path.resolve(process.cwd(), '.data', 'runtime-store');
const TMP_DATA_DIR = path.resolve(os.tmpdir(), 'mymoney-runtime-store');

const g = globalThis as typeof globalThis & {
  __myMoneyRuntimeCache?: Map<string, any>;
  __myMoneyEncryptionSaltKey?: Buffer;
  __myMoneyEncryptedSecret?: {
    encryptedValue: string;
    maskedPreview: string;
    updatedAt: string;
    updatedBy: string | null;
    lastValidation: ApiKeyValidationRecord | null;
  } | null;
  __myMoneySmtpEncryptedSecret?: {
    encryptedValue: string;
    maskedPreview: string;
    updatedAt: string;
    updatedBy: string | null;
  } | null;
};

if (!g.__myMoneyRuntimeCache) {
  g.__myMoneyRuntimeCache = new Map<string, any>();
}

function resolveWritableStoreDir(): string {
  try {
    if (!fs.existsSync(PRIMARY_DATA_DIR)) {
      fs.mkdirSync(PRIMARY_DATA_DIR, { recursive: true });
    }
    fs.accessSync(PRIMARY_DATA_DIR, fs.constants.W_OK);
    return PRIMARY_DATA_DIR;
  } catch {
    try {
      if (!fs.existsSync(TMP_DATA_DIR)) {
        fs.mkdirSync(TMP_DATA_DIR, { recursive: true });
      }
      return TMP_DATA_DIR;
    } catch {
      return PRIMARY_DATA_DIR;
    }
  }
}

function safeStoreFile(baseDir: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const resolved = path.resolve(baseDir, safeName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('PATH_CONFINEMENT_VIOLATION');
  }
  return resolved;
}

function readJsonFallback<T>(fileName: string): T | null {
  for (const dir of [PRIMARY_DATA_DIR, TMP_DATA_DIR]) {
    try {
      const file = safeStoreFile(dir, fileName);
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        if (raw.trim()) {
          const parsed = JSON.parse(raw) as T;
          g.__myMoneyRuntimeCache?.set(fileName, parsed);
          return parsed;
        }
      }
    } catch {
      // ignore and try next dir
    }
  }
  if (g.__myMoneyRuntimeCache?.has(fileName)) {
    return g.__myMoneyRuntimeCache.get(fileName) as T;
  }
  return null;
}

function writeJsonFallback<T>(fileName: string, data: T): void {
  g.__myMoneyRuntimeCache?.set(fileName, data);
  try {
    const dir = resolveWritableStoreDir();
    const file = safeStoreFile(dir, fileName);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err: any) {
    console.warn(`[AdminSettingsStore] Write notice (${fileName}):`, err?.message);
  }
}

function parseTimestampMs(iso?: string | null): number {
  if (!iso) return 0;
  const ms = Date.parse(iso);
  return Number.isFinite(ms) ? ms : 0;
}

const REMOTE_SYNC_TTL_MS = 4000;
const remoteSyncCache = new Map<string, { fetchedAt: number; data: any }>();

async function fetchRemoteAppSettingWithTtl<T>(key: string): Promise<{ checked: boolean; data: T | null }> {
  const cached = remoteSyncCache.get(key);
  const now = Date.now();
  if (cached && now - cached.fetchedAt < REMOTE_SYNC_TTL_MS) {
    return { checked: true, data: cached.data as T | null };
  }

  try {
    const sbRes = await sbRestRequest<Array<{ value: any; updated_at?: string }>>(
      `app_settings?key=eq.${encodeURIComponent(key)}&select=value,updated_at&limit=1`
    );
    if (sbRes.ok && Array.isArray(sbRes.data)) {
      const row = sbRes.data[0];
      const value =
        row?.value && typeof row.value === 'object'
          ? {
              ...row.value,
              updatedAt: row.value.updatedAt || row.updated_at,
            }
          : null;
      remoteSyncCache.set(key, { fetchedAt: now, data: value });
      return { checked: true, data: value as T | null };
    }
  } catch {
    // ignore network failure and fall back to local cache
  }
  return { checked: false, data: null };
}

function invalidateRemoteSyncCache(key: string, data?: any): void {
  if (data !== undefined) {
    remoteSyncCache.set(key, { fetchedAt: Date.now(), data });
  } else {
    remoteSyncCache.delete(key);
  }
}

// ============================================================================
// URL SANITIZATION FOR APP DOWNLOAD URL
// ============================================================================

export function validateAppDownloadUrl(rawUrl: string): { valid: boolean; normalized: string; error?: string } {
  const trimmed = String(rawUrl || '').trim();
  if (!trimmed) {
    return { valid: false, normalized: '', error: 'App Download URL is required.' };
  }
  if (trimmed.length > 1000 || /[\r\n\0]/.test(trimmed)) {
    return { valid: false, normalized: '', error: 'App Download URL contains invalid characters or exceeds 1000 characters.' };
  }
  if (trimmed.startsWith('/') && !trimmed.startsWith('//')) {
    return { valid: true, normalized: trimmed };
  }
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
      return {
        valid: false,
        normalized: '',
        error: 'App Download URL must start with https://, http://, or a relative path (/...).',
      };
    }
    return { valid: true, normalized: parsed.toString() };
  } catch {
    return {
      valid: false,
      normalized: '',
      error: 'Please enter a valid URL (e.g. https://play.google.com/... or https://example.com/app.apk).',
    };
  }
}

// ============================================================================
// MAINTENANCE MODE PERSISTENCE
// ============================================================================

function normalizeMaintenanceConfig(raw: any): MaintenanceConfig {
  return {
    isEnabled: Boolean(raw?.isEnabled),
    title:
      typeof raw?.title === 'string' && raw.title.trim()
        ? raw.title.trim().slice(0, 140)
        : DEFAULT_MAINTENANCE_CONFIG.title,
    message:
      typeof raw?.message === 'string' && raw.message.trim()
        ? raw.message.trim().slice(0, 600)
        : DEFAULT_MAINTENANCE_CONFIG.message,
    expectedRestoration:
      typeof raw?.expectedRestoration === 'string' && raw.expectedRestoration.trim()
        ? raw.expectedRestoration.trim().slice(0, 100)
        : DEFAULT_MAINTENANCE_CONFIG.expectedRestoration,
    allowStaffAccessDuringMaintenance:
      typeof raw?.allowStaffAccessDuringMaintenance === 'boolean'
        ? raw.allowStaffAccessDuringMaintenance
        : DEFAULT_MAINTENANCE_CONFIG.allowStaffAccessDuringMaintenance,
    emergencyBypassEnabled:
      typeof raw?.emergencyBypassEnabled === 'boolean'
        ? raw.emergencyBypassEnabled
        : DEFAULT_MAINTENANCE_CONFIG.emergencyBypassEnabled,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw?.updatedBy === 'string' ? raw.updatedBy : undefined,
  };
}

export async function getMaintenanceSettings(): Promise<MaintenanceConfig> {
  const local = readJsonFallback<MaintenanceConfig>('maintenance-settings.json');
  let remote: MaintenanceConfig | null = null;

  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `SELECT value, updated_at FROM public.app_settings WHERE key = $1 LIMIT 1`,
        ['maintenance_mode']
      );
      if (res.rows[0]?.value) {
        remote = normalizeMaintenanceConfig({
          ...res.rows[0].value,
          updatedAt: res.rows[0].value.updatedAt || res.rows[0].updated_at,
        });
      }
    } catch {
      // fall through
    }
  } else {
    const remoteRes = await fetchRemoteAppSettingWithTtl<any>('maintenance_mode');
    if (remoteRes.checked && remoteRes.data) {
      remote = normalizeMaintenanceConfig(remoteRes.data);
    }
  }

  if (remote && local) {
    if (parseTimestampMs(remote.updatedAt) > parseTimestampMs(local.updatedAt)) {
      writeJsonFallback('maintenance-settings.json', remote);
      return remote;
    }
    return normalizeMaintenanceConfig(local);
  }
  if (remote) {
    writeJsonFallback('maintenance-settings.json', remote);
    return remote;
  }
  if (local) {
    return normalizeMaintenanceConfig(local);
  }
  return { ...DEFAULT_MAINTENANCE_CONFIG };
}

export async function isMaintenanceModeEnabled(): Promise<boolean> {
  const settings = await getMaintenanceSettings();
  return Boolean(settings.isEnabled);
}

export async function saveMaintenanceSettings(
  input: Partial<MaintenanceConfig>,
  updatedBy: { id?: string; email?: string }
): Promise<MaintenanceConfig> {
  const current = await getMaintenanceSettings();
  const next: MaintenanceConfig = normalizeMaintenanceConfig({
    ...current,
    ...input,
    isEnabled: typeof input.isEnabled === 'boolean' ? input.isEnabled : current.isEnabled,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy.email || current.updatedBy || 'admin',
  });

  writeJsonFallback('maintenance-settings.json', next);
  invalidateRemoteSyncCache('maintenance_mode', next);

  if (isDatabaseAvailable()) {
    try {
      await query(
        `INSERT INTO public.app_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2::jsonb, NOW(), $3)
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        ['maintenance_mode', JSON.stringify(next), updatedBy.id || null]
      );
    } catch (err: any) {
      console.warn('[AdminSettingsStore] DB maintenance save notice:', err?.message);
    }
  } else {
    // Best-effort mirror to Supabase REST (succeeds when service key is configured)
    await sbRestRequest('app_settings?on_conflict=key', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: {
        key: 'maintenance_mode',
        value: next,
        updated_at: next.updatedAt,
      },
    }).catch(() => {});
  }

  return next;
}

// ============================================================================
// APP DOWNLOAD POPUP SETTINGS PERSISTENCE
// ============================================================================

function normalizeAppPopupConfig(raw: any): AppPopupConfig {
  const urlCheck = validateAppDownloadUrl(raw?.downloadUrl || DEFAULT_APP_POPUP_CONFIG.downloadUrl);
  return {
    enabled: typeof raw?.enabled === 'boolean' ? raw.enabled : DEFAULT_APP_POPUP_CONFIG.enabled,
    downloadUrl: urlCheck.valid ? urlCheck.normalized : DEFAULT_APP_POPUP_CONFIG.downloadUrl,
    title:
      typeof raw?.title === 'string' && raw.title.trim()
        ? raw.title.trim().slice(0, 80)
        : DEFAULT_APP_POPUP_CONFIG.title,
    description:
      typeof raw?.description === 'string' && raw.description.trim()
        ? raw.description.trim().slice(0, 220)
        : DEFAULT_APP_POPUP_CONFIG.description,
    buttonLabel:
      typeof raw?.buttonLabel === 'string' && raw.buttonLabel.trim()
        ? raw.buttonLabel.trim().slice(0, 32)
        : DEFAULT_APP_POPUP_CONFIG.buttonLabel,
    updatedAt: typeof raw?.updatedAt === 'string' ? raw.updatedAt : undefined,
    updatedBy: typeof raw?.updatedBy === 'string' ? raw.updatedBy : undefined,
  };
}

export async function getAppPopupSettings(): Promise<AppPopupConfig> {
  const local = readJsonFallback<AppPopupConfig>('app-download-popup.json');
  let remote: AppPopupConfig | null = null;

  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `SELECT value, updated_at FROM public.app_settings WHERE key = $1 LIMIT 1`,
        ['app_download_popup']
      );
      if (res.rows[0]?.value) {
        remote = normalizeAppPopupConfig({
          ...res.rows[0].value,
          updatedAt: res.rows[0].value.updatedAt || res.rows[0].updated_at,
        });
      }
    } catch {
      // fall through
    }
  } else {
    const remoteRes = await fetchRemoteAppSettingWithTtl<any>('app_download_popup');
    if (remoteRes.checked && remoteRes.data) {
      remote = normalizeAppPopupConfig(remoteRes.data);
    }
  }

  if (remote && local) {
    if (parseTimestampMs(remote.updatedAt) > parseTimestampMs(local.updatedAt)) {
      writeJsonFallback('app-download-popup.json', remote);
      return remote;
    }
    return normalizeAppPopupConfig(local);
  }
  if (remote) {
    writeJsonFallback('app-download-popup.json', remote);
    return remote;
  }
  if (local) {
    return normalizeAppPopupConfig(local);
  }
  return { ...DEFAULT_APP_POPUP_CONFIG };
}

export async function saveAppPopupSettings(
  input: Partial<AppPopupConfig>,
  updatedBy: { id?: string; email?: string }
): Promise<AppPopupConfig> {
  const current = await getAppPopupSettings();
  const next: AppPopupConfig = normalizeAppPopupConfig({
    ...current,
    ...input,
    enabled: typeof input.enabled === 'boolean' ? input.enabled : current.enabled,
    updatedAt: new Date().toISOString(),
    updatedBy: updatedBy.email || current.updatedBy || 'admin',
  });

  writeJsonFallback('app-download-popup.json', next);
  invalidateRemoteSyncCache('app_download_popup', next);

  if (isDatabaseAvailable()) {
    try {
      await query(
        `INSERT INTO public.app_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2::jsonb, NOW(), $3)
         ON CONFLICT (key) DO UPDATE
         SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        ['app_download_popup', JSON.stringify(next), updatedBy.id || null]
      );
    } catch (err: any) {
      console.warn('[AdminSettingsStore] DB app_popup save notice:', err?.message);
    }
  } else {
    await sbRestRequest('app_settings?on_conflict=key', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: {
        key: 'app_download_popup',
        value: next,
        updated_at: next.updatedAt,
      },
    }).catch(() => {});
  }

  return next;
}

// ============================================================================
// SERVER-ONLY ENCRYPTED API KEY MANAGEMENT (GEMINI_API_KEY)
// ============================================================================

const GEMINI_SECRET_KEY_NAME = 'gemini_api_key';

function getEncryptionKey(): Buffer {
  const seed =
    process.env.API_KEY_ENCRYPTION_SECRET ||
    process.env.SESSION_SECRET ||
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.DATABASE_URL ||
    '';

  if (seed.trim()) {
    return crypto.createHash('sha256').update(`mymoney:admin_secrets:${seed.trim()}`).digest();
  }
  if (!g.__myMoneyEncryptionSaltKey) {
    g.__myMoneyEncryptionSaltKey = crypto.randomBytes(32);
  }
  return g.__myMoneyEncryptionSaltKey;
}

function encryptSecret(plainText: string): string {
  const key = getEncryptionKey();
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const encrypted = Buffer.concat([cipher.update(plainText, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return `v1:${iv.toString('base64')}:${authTag.toString('base64')}:${encrypted.toString('base64')}`;
}

function decryptSecret(payload: string): string | null {
  try {
    if (!payload || !payload.startsWith('v1:')) return null;
    const parts = payload.split(':');
    if (parts.length !== 4) return null;
    const iv = Buffer.from(parts[1], 'base64');
    const authTag = Buffer.from(parts[2], 'base64');
    const ciphertext = Buffer.from(parts[3], 'base64');
    const key = getEncryptionKey();
    const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
    decipher.setAuthTag(authTag);
    const decrypted = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return decrypted.toString('utf8');
  } catch {
    return null;
  }
}

export function maskSecretKey(rawKey: string): string {
  const trimmed = (rawKey || '').trim();
  if (!trimmed) return '';
  if (trimmed.length <= 10) return '••••••••••';
  return `${trimmed.slice(0, 4)}••••••••••••${trimmed.slice(-4)}`;
}

async function ensureAdminSecretsTable(): Promise<void> {
  if (!isDatabaseAvailable()) return;
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS public.admin_secrets (
        key TEXT PRIMARY KEY,
        encrypted_value TEXT NOT NULL,
        masked_preview TEXT NOT NULL,
        is_encrypted BOOLEAN NOT NULL DEFAULT TRUE,
        last_validation_status TEXT,
        last_validation_message TEXT,
        last_validated_at TIMESTAMPTZ,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        updated_by TEXT
      );
    `);
    await query(`ALTER TABLE public.admin_secrets ENABLE ROW LEVEL SECURITY;`);
  } catch {
    // Non-fatal if already exists or limited DDL privileges
  }
}

export async function saveGeminiApiKey(
  rawApiKey: string,
  updatedBy: string,
  validation?: ApiKeyValidationRecord | null
): Promise<MaskedApiKeyInfo> {
  const trimmed = String(rawApiKey || '').trim();
  if (!trimmed || trimmed.length < 20 || trimmed.length > 256 || /\s/.test(trimmed)) {
    throw new Error('Please enter a valid API key (20–256 characters, no spaces).');
  }

  const encryptedValue = encryptSecret(trimmed);
  const maskedPreview = maskSecretKey(trimmed);
  const now = new Date().toISOString();

  g.__myMoneyEncryptedSecret = {
    encryptedValue,
    maskedPreview,
    updatedAt: now,
    updatedBy,
    lastValidation: validation || null,
  };

  if (isDatabaseAvailable()) {
    await ensureAdminSecretsTable();
    await query(
      `INSERT INTO public.admin_secrets (
         key, encrypted_value, masked_preview, is_encrypted,
         last_validation_status, last_validation_message, last_validated_at,
         updated_at, updated_by
       ) VALUES ($1, $2, $3, TRUE, $4, $5, $6, NOW(), $7)
       ON CONFLICT (key) DO UPDATE SET
         encrypted_value = EXCLUDED.encrypted_value,
         masked_preview = EXCLUDED.masked_preview,
         is_encrypted = TRUE,
         last_validation_status = EXCLUDED.last_validation_status,
         last_validation_message = EXCLUDED.last_validation_message,
         last_validated_at = EXCLUDED.last_validated_at,
         updated_at = NOW(),
         updated_by = EXCLUDED.updated_by`,
      [
        GEMINI_SECRET_KEY_NAME,
        encryptedValue,
        maskedPreview,
        validation ? (validation.valid ? 'valid' : 'invalid') : null,
        validation?.message || null,
        validation?.checkedAt || null,
        updatedBy,
      ]
    );
  }

  return getMaskedGeminiApiKeyInfo();
}

export async function updateGeminiKeyValidationStatus(validation: ApiKeyValidationRecord): Promise<void> {
  if (g.__myMoneyEncryptedSecret) {
    g.__myMoneyEncryptedSecret.lastValidation = validation;
  }
  if (isDatabaseAvailable()) {
    try {
      await query(
        `UPDATE public.admin_secrets
         SET last_validation_status = $1,
             last_validation_message = $2,
             last_validated_at = $3
         WHERE key = $4`,
        [validation.valid ? 'valid' : 'invalid', validation.message, validation.checkedAt, GEMINI_SECRET_KEY_NAME]
      );
    } catch {
      // ignore
    }
  }
}

export async function removeGeminiApiKey(): Promise<MaskedApiKeyInfo> {
  g.__myMoneyEncryptedSecret = null;
  if (isDatabaseAvailable()) {
    try {
      await query(`DELETE FROM public.admin_secrets WHERE key = $1`, [GEMINI_SECRET_KEY_NAME]);
    } catch {
      // ignore
    }
  }
  return getMaskedGeminiApiKeyInfo();
}

export async function getEffectiveGeminiApiKey(): Promise<{
  apiKey: string;
  source: 'admin_settings' | 'env' | 'none';
}> {
  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `SELECT encrypted_value, masked_preview, last_validation_status, last_validation_message, last_validated_at, updated_at, updated_by
         FROM public.admin_secrets
         WHERE key = $1 LIMIT 1`,
        [GEMINI_SECRET_KEY_NAME]
      );
      if (res.rows[0]?.encrypted_value) {
        const plain = decryptSecret(res.rows[0].encrypted_value);
        if (plain && plain.length > 10) {
          g.__myMoneyEncryptedSecret = {
            encryptedValue: res.rows[0].encrypted_value,
            maskedPreview: res.rows[0].masked_preview || maskSecretKey(plain),
            updatedAt: res.rows[0].updated_at || new Date().toISOString(),
            updatedBy: res.rows[0].updated_by || null,
            lastValidation: res.rows[0].last_validation_status
              ? {
                  valid: res.rows[0].last_validation_status === 'valid',
                  message: res.rows[0].last_validation_message || '',
                  checkedAt: res.rows[0].last_validated_at || new Date().toISOString(),
                }
              : null,
          };
          return { apiKey: plain, source: 'admin_settings' };
        }
      }
    } catch {
      // fall through to memory / env
    }
  }

  if (g.__myMoneyEncryptedSecret?.encryptedValue) {
    const plain = decryptSecret(g.__myMoneyEncryptedSecret.encryptedValue);
    if (plain && plain.length > 10) {
      return { apiKey: plain, source: 'admin_settings' };
    }
  }

  const envKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (envKey.length > 10) {
    return { apiKey: envKey, source: 'env' };
  }

  return { apiKey: '', source: 'none' };
}

export async function getMaskedGeminiApiKeyInfo(): Promise<MaskedApiKeyInfo> {
  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `SELECT masked_preview, last_validation_status, last_validation_message, last_validated_at, updated_at, updated_by
         FROM public.admin_secrets
         WHERE key = $1 LIMIT 1`,
        [GEMINI_SECRET_KEY_NAME]
      );
      if (res.rows[0]) {
        const row = res.rows[0];
        return {
          configured: true,
          hasSavedKey: true,
          maskedApiKey: row.masked_preview || '••••••••••••',
          source: 'admin_settings',
          updatedAt: row.updated_at || null,
          updatedBy: row.updated_by || null,
          lastValidation: row.last_validation_status
            ? {
                valid: row.last_validation_status === 'valid',
                message: row.last_validation_message || '',
                checkedAt: row.last_validated_at || new Date().toISOString(),
              }
            : null,
        };
      }
    } catch {
      // fall through
    }
  }

  if (g.__myMoneyEncryptedSecret) {
    return {
      configured: true,
      hasSavedKey: true,
      maskedApiKey: g.__myMoneyEncryptedSecret.maskedPreview,
      source: 'admin_settings',
      updatedAt: g.__myMoneyEncryptedSecret.updatedAt,
      updatedBy: g.__myMoneyEncryptedSecret.updatedBy,
      lastValidation: g.__myMoneyEncryptedSecret.lastValidation,
    };
  }

  const envKey = (process.env.GEMINI_API_KEY || process.env.VITE_GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '').trim();
  if (envKey.length > 10) {
    return {
      configured: true,
      hasSavedKey: false,
      maskedApiKey: maskSecretKey(envKey),
      source: 'env',
      updatedAt: null,
      updatedBy: 'Server Environment Variable',
      lastValidation: null,
    };
  }

  return {
    configured: false,
    hasSavedKey: false,
    maskedApiKey: '',
    source: 'none',
    updatedAt: null,
    updatedBy: null,
    lastValidation: null,
  };
}

// ============================================================================
// SERVER-ONLY ENCRYPTED SMTP CONFIGURATION MANAGEMENT
// ============================================================================

const SMTP_SECRET_KEY_NAME = 'smtp_password';
const SMTP_CONFIG_FILE = 'smtp-config.json';
const SMTP_SECRET_FILE = 'smtp-secret.json';

interface StoredSmtpMetadata {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  fromName: string;
  enabled: boolean;
  updatedAt?: string;
  updatedBy?: string;
}

function getEnvSmtpDefaults(): StoredSmtpMetadata & { pass: string } {
  const host = (process.env.SMTP_HOST || 'smtp.gmail.com').trim();
  const port = parseInt(process.env.SMTP_PORT || '465', 10) || 465;
  const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
  const user = (process.env.SMTP_USER || 'hackifypro@gmail.com').trim();
  const pass = (process.env.SMTP_PASS || '').trim();
  const fromEmail = (process.env.SMTP_FROM_EMAIL || user || 'hackifypro@gmail.com').trim();
  const fromName = (process.env.SMTP_FROM_NAME || 'My Money Manager by HackifyPro').trim();
  return {
    host,
    port,
    secure,
    user,
    pass,
    fromEmail,
    fromName,
    enabled: true,
  };
}

async function readStoredSmtpMetadata(): Promise<StoredSmtpMetadata | null> {
  const local = readJsonFallback<StoredSmtpMetadata>(SMTP_CONFIG_FILE);
  let remote: StoredSmtpMetadata | null = null;

  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `SELECT value, updated_at FROM public.app_settings WHERE key = $1 LIMIT 1`,
        ['smtp_config']
      );
      if (res.rows[0]?.value && typeof res.rows[0].value === 'object') {
        remote = {
          ...res.rows[0].value,
          updatedAt: res.rows[0].value.updatedAt || res.rows[0].updated_at,
        };
      }
    } catch {
      // fall through
    }
  } else {
    const remoteRes = await fetchRemoteAppSettingWithTtl<StoredSmtpMetadata>('smtp_config');
    if (remoteRes.checked && remoteRes.data && typeof remoteRes.data === 'object') {
      remote = remoteRes.data;
    }
  }

  if (remote && local) {
    if (parseTimestampMs(remote.updatedAt) > parseTimestampMs(local.updatedAt)) {
      writeJsonFallback(SMTP_CONFIG_FILE, remote);
      return remote;
    }
    return local;
  }
  if (remote) {
    writeJsonFallback(SMTP_CONFIG_FILE, remote);
    return remote;
  }
  return local || null;
}

async function readSavedSmtpSecret(): Promise<{
  plain: string;
  maskedPreview: string;
  updatedAt: string | null;
  updatedBy: string | null;
} | null> {
  if (isDatabaseAvailable()) {
    try {
      const res = await query(
        `SELECT encrypted_value, masked_preview, updated_at, updated_by
         FROM public.admin_secrets
         WHERE key = $1 LIMIT 1`,
        [SMTP_SECRET_KEY_NAME]
      );
      if (res.rows[0]?.encrypted_value) {
        const plain = decryptSecret(res.rows[0].encrypted_value);
        if (plain) {
          g.__myMoneySmtpEncryptedSecret = {
            encryptedValue: res.rows[0].encrypted_value,
            maskedPreview: res.rows[0].masked_preview || maskSecretKey(plain),
            updatedAt: res.rows[0].updated_at || new Date().toISOString(),
            updatedBy: res.rows[0].updated_by || null,
          };
          return {
            plain,
            maskedPreview: g.__myMoneySmtpEncryptedSecret.maskedPreview,
            updatedAt: g.__myMoneySmtpEncryptedSecret.updatedAt,
            updatedBy: g.__myMoneySmtpEncryptedSecret.updatedBy,
          };
        }
      }
    } catch {
      // fall through
    }
  }

  if (g.__myMoneySmtpEncryptedSecret?.encryptedValue) {
    const plain = decryptSecret(g.__myMoneySmtpEncryptedSecret.encryptedValue);
    if (plain) {
      return {
        plain,
        maskedPreview: g.__myMoneySmtpEncryptedSecret.maskedPreview,
        updatedAt: g.__myMoneySmtpEncryptedSecret.updatedAt,
        updatedBy: g.__myMoneySmtpEncryptedSecret.updatedBy,
      };
    }
  }

  const fileSecret = readJsonFallback<{
    encryptedValue: string;
    maskedPreview: string;
    updatedAt: string;
    updatedBy: string | null;
  }>(SMTP_SECRET_FILE);

  if (fileSecret?.encryptedValue) {
    const plain = decryptSecret(fileSecret.encryptedValue);
    if (plain) {
      g.__myMoneySmtpEncryptedSecret = fileSecret;
      return {
        plain,
        maskedPreview: fileSecret.maskedPreview || maskSecretKey(plain),
        updatedAt: fileSecret.updatedAt || null,
        updatedBy: fileSecret.updatedBy || null,
      };
    }
  }

  return null;
}

export async function saveSmtpSettings(
  input: SmtpSettingsInput,
  updatedBy: { id?: string; email?: string } = {}
): Promise<MaskedSmtpSettings> {
  const envDefaults = getEnvSmtpDefaults();
  const existingMeta = await readStoredSmtpMetadata();
  const now = new Date().toISOString();
  const actor = updatedBy?.email || 'admin';

  const port = Number(input.port ?? existingMeta?.port ?? envDefaults.port);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SMTP Port must be a valid port number (e.g. 465 or 587).');
  }

  const host = String(input.host ?? existingMeta?.host ?? envDefaults.host).trim();
  if (!host || host.length > 200 || /[\s\r\n]/.test(host)) {
    throw new Error('Please enter a valid SMTP host (e.g. smtp.gmail.com).');
  }

  const user = String(input.user ?? existingMeta?.user ?? envDefaults.user).trim();
  if (!user || user.length > 200) {
    throw new Error('Please enter a valid SMTP username or email address.');
  }

  const fromEmail = String(input.fromEmail ?? existingMeta?.fromEmail ?? user ?? envDefaults.fromEmail).trim();
  if (fromEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(fromEmail)) {
    throw new Error('Please enter a valid Sender From email address.');
  }

  const fromName = String(input.fromName ?? existingMeta?.fromName ?? envDefaults.fromName).trim().slice(0, 100) || 'My Money Manager by HackifyPro';
  const secure = typeof input.secure === 'boolean' ? input.secure : port === 465;
  const enabled = typeof input.enabled === 'boolean' ? input.enabled : (existingMeta?.enabled ?? true);

  const meta: StoredSmtpMetadata = {
    host,
    port,
    secure,
    user,
    fromEmail: fromEmail || user,
    fromName,
    enabled,
    updatedAt: now,
    updatedBy: actor,
  };

  writeJsonFallback(SMTP_CONFIG_FILE, meta);
  invalidateRemoteSyncCache('smtp_config', meta);

  if (isDatabaseAvailable()) {
    try {
      await query(
        `INSERT INTO public.app_settings (key, value, updated_at, updated_by)
         VALUES ($1, $2::jsonb, NOW(), $3)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = NOW(), updated_by = EXCLUDED.updated_by`,
        ['smtp_config', JSON.stringify(meta), updatedBy.id || null]
      );
    } catch (err: any) {
      console.warn('[AdminSettingsStore] DB smtp_config save notice:', err?.message);
    }
  } else {
    await sbRestRequest('app_settings?on_conflict=key', {
      method: 'POST',
      prefer: 'resolution=merge-duplicates',
      body: {
        key: 'smtp_config',
        value: meta,
        updated_at: now,
      },
    }).catch(() => {});
  }

  if (typeof input.pass === 'string' && input.pass.trim().length > 0) {
    const cleanPass = input.pass.trim();
    if (cleanPass.length < 4 || cleanPass.length > 256) {
      throw new Error('SMTP password / App Password must be between 4 and 256 characters.');
    }
    const encryptedValue = encryptSecret(cleanPass);
    const maskedPreview = maskSecretKey(cleanPass);
    const secretPayload = {
      encryptedValue,
      maskedPreview,
      updatedAt: now,
      updatedBy: actor,
    };
    g.__myMoneySmtpEncryptedSecret = secretPayload;
    writeJsonFallback(SMTP_SECRET_FILE, secretPayload);

    if (isDatabaseAvailable()) {
      await ensureAdminSecretsTable();
      await query(
        `INSERT INTO public.admin_secrets (
           key, encrypted_value, masked_preview, is_encrypted, updated_at, updated_by
         ) VALUES ($1, $2, $3, TRUE, NOW(), $4)
         ON CONFLICT (key) DO UPDATE SET
           encrypted_value = EXCLUDED.encrypted_value,
           masked_preview = EXCLUDED.masked_preview,
           is_encrypted = TRUE,
           updated_at = NOW(),
           updated_by = EXCLUDED.updated_by`,
        [SMTP_SECRET_KEY_NAME, encryptedValue, maskedPreview, actor]
      );
    }
  }

  return getMaskedSmtpSettings();
}

export async function removeSavedSmtpPassword(): Promise<MaskedSmtpSettings> {
  g.__myMoneySmtpEncryptedSecret = null;
  writeJsonFallback(SMTP_SECRET_FILE, null);
  if (isDatabaseAvailable()) {
    try {
      await query(`DELETE FROM public.admin_secrets WHERE key = $1`, [SMTP_SECRET_KEY_NAME]);
    } catch {
      // ignore
    }
  }
  return getMaskedSmtpSettings();
}

export async function getEffectiveSmtpConfig(): Promise<EffectiveSmtpConfig> {
  const envDefaults = getEnvSmtpDefaults();
  const meta = await readStoredSmtpMetadata();
  const savedSecret = await readSavedSmtpSecret();

  const host = (meta?.host || envDefaults.host).trim();
  const port = meta?.port || envDefaults.port;
  const secure = meta ? Boolean(meta.secure) : envDefaults.secure;
  const user = (meta?.user || envDefaults.user).trim();
  const pass = (savedSecret?.plain || envDefaults.pass || '').trim();
  const fromEmail = (meta?.fromEmail || user || envDefaults.fromEmail).trim();
  const fromName = (meta?.fromName || envDefaults.fromName).trim();
  const enabled = meta ? Boolean(meta.enabled) : true;
  const source: 'admin_settings' | 'env' | 'none' = savedSecret?.plain
    ? 'admin_settings'
    : envDefaults.pass
      ? 'env'
      : 'none';

  const configured = Boolean(enabled && host && user && pass);
  const safeName = fromName.replace(/["\r\n]/g, '');
  const from = fromEmail ? `"${safeName}" <${fromEmail}>` : (process.env.SMTP_FROM || `"${safeName}" <${user}>`);

  return {
    configured,
    enabled,
    host,
    port,
    secure,
    user,
    pass,
    from,
    fromEmail,
    fromName,
    source,
  };
}

export async function getMaskedSmtpSettings(): Promise<MaskedSmtpSettings> {
  const effective = await getEffectiveSmtpConfig();
  const meta = await readStoredSmtpMetadata();
  const savedSecret = await readSavedSmtpSecret();

  return {
    configured: effective.configured,
    enabled: effective.enabled,
    hasSavedPassword: Boolean(savedSecret?.plain),
    maskedPassword: savedSecret
      ? savedSecret.maskedPreview
      : effective.pass
        ? maskSecretKey(effective.pass)
        : '',
    host: effective.host,
    port: effective.port,
    secure: effective.secure,
    user: effective.user,
    fromEmail: effective.fromEmail,
    fromName: effective.fromName,
    source: effective.source,
    updatedAt: savedSecret?.updatedAt || meta?.updatedAt || null,
    updatedBy: savedSecret?.updatedBy || meta?.updatedBy || (effective.source === 'env' ? 'Server Environment Variable' : null),
  };
}

export async function getEffectiveSupportAlertEmail(): Promise<string> {
  const fallbackAdmin = (process.env.SUPPORT_EMAIL || 'hackifypro@gmail.com').trim();
  const localInt = readJsonFallback<Record<string, any>>('integrations-config.json');
  if (localInt && typeof localInt.supportEmail === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(localInt.supportEmail.trim())) {
    return localInt.supportEmail.trim().toLowerCase();
  }
  if (isDatabaseAvailable()) {
    try {
      const res = await query(`SELECT value FROM public.app_settings WHERE key = 'integrations_config' LIMIT 1`);
      const em = res.rows[0]?.value?.supportEmail;
      if (typeof em === 'string' && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(em.trim())) {
        return em.trim().toLowerCase();
      }
    } catch {
      // ignore
    }
  }
  return fallbackAdmin;
}
