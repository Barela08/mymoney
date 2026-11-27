/**
 * Privacy Choices & Consent Center — Client API & Authenticated State Sync
 * My Money Manager by HackifyPro
 *
 * Rules enforced:
 * - Never writes implicit consent on load or modal close.
 * - Never displays success if Supabase / server persistence fails.
 * - Strictly user-scoped cache keyed by userId so cross-user state never leaks.
 * - Every optional category defaults strictly to FALSE for new users.
 */

import { getStoredAuthUser, getStoredSessionToken } from './authApi';
import {
  createEmptyOptionalChoices,
  OPTIONAL_CONSENT_CATEGORIES,
  PRIVACY_POLICY_VERSION,
  PRIVACY_POLICY_LAST_UPDATED,
  type ConsentCategoryState,
  type ConsentHistoryEntry,
  type ConsentLanguage,
  type OptionalConsentCategory,
  type OptionalConsentChoices,
} from './privacyConsent';

export const PRIVACY_CACHE_PREFIX = 'my_money_privacy_choices_v3_';
export const PRIVACY_CHANGED_EVENT = 'my-money-consent-changed';

export interface PrivacyConsentsResponse {
  success: boolean;
  userId?: string;
  hasSavedChoices: boolean;
  consents: Partial<Record<OptionalConsentCategory, ConsentCategoryState>>;
  choices: OptionalConsentChoices;
  history: ConsentHistoryEntry[];
  policyVersion: string;
  policyLastUpdated: string;
  lastUpdatedAt: string | null;
  message?: string;
}

interface CachedUserPrivacyState {
  userId: string;
  hasSavedChoices: boolean;
  choices: OptionalConsentChoices;
  policyVersion: string;
  lastUpdatedAt: string | null;
  syncedAt: string;
}

function getCacheKey(userId: string): string {
  return `${PRIVACY_CACHE_PREFIX}${userId}`;
}

export function getActiveUserId(): string | null {
  const user = getStoredAuthUser();
  return user?.id || user?.uid || null;
}

/**
 * Reads cached consent choices strictly for the currently authenticated user.
 * Returns all FALSE if the user has not explicitly saved choices yet.
 */
export function getCachedUserPrivacyState(userId?: string | null): CachedUserPrivacyState | null {
  if (typeof window === 'undefined') return null;
  const uid = userId || getActiveUserId();
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(getCacheKey(uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CachedUserPrivacyState;
    if (parsed.userId !== uid) return null;
    const normalized = createEmptyOptionalChoices();
    for (const key of OPTIONAL_CONSENT_CATEGORIES) {
      normalized[key] = Boolean(parsed.choices?.[key]);
    }
    return {
      ...parsed,
      choices: normalized,
    };
  } catch {
    return null;
  }
}

export function setCachedUserPrivacyState(state: CachedUserPrivacyState): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(getCacheKey(state.userId), JSON.stringify(state));
    window.dispatchEvent(new CustomEvent(PRIVACY_CHANGED_EVENT, { detail: state }));
  } catch {
    // ignore storage quota errors
  }
}

export function hasOptionalConsent(category: OptionalConsentCategory, userId?: string | null): boolean {
  const cached = getCachedUserPrivacyState(userId);
  if (!cached) return false;
  return Boolean(cached.choices[category]);
}

export function generateConsentIdempotencyKey(prefix = 'consent'): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `${prefix}_${crypto.randomUUID()}`;
  }
  return `${prefix}_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
}

async function privacyRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredSessionToken();
  if (!token) {
    const err = new Error('Please sign in to save or manage your privacy choices.');
    (err as any).status = 401;
    (err as any).code = 'UNAUTHORIZED';
    throw err;
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
    Authorization: `Bearer ${token}`,
    ...((options.headers as Record<string, string>) || {}),
  };

  let res: Response;
  try {
    res = await fetch(endpoint, {
      ...options,
      headers,
      credentials: 'include',
    });
  } catch {
    const netErr = new Error(
      'Network error while contacting the server. Your choices were not saved. Please check your connection and retry.'
    );
    (netErr as any).code = 'NETWORK_ERROR';
    throw netErr;
  }

  const contentType = res.headers.get('content-type') || '';
  let data: any = null;
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = null;
    }
  }

  if (!res.ok || !data || data.success === false) {
    const msg =
      data?.message ||
      data?.error ||
      `Could not complete privacy request (HTTP ${res.status}). Please try again.`;
    const err = new Error(msg);
    (err as any).status = res.status;
    (err as any).code = data?.code || 'SERVER_ERROR';
    throw err;
  }

  return data as T;
}

export const privacyConsentApi = {
  /**
   * Fetches the authenticated user's real saved consent preferences & full
   * chronological audit history from the server/Supabase.
   */
  async fetchConsents(): Promise<PrivacyConsentsResponse> {
    const data = await privacyRequest<PrivacyConsentsResponse>('/api/privacy/consents', {
      method: 'GET',
    });

    const uid = data.userId || getActiveUserId();
    const normalizedChoices = createEmptyOptionalChoices();
    for (const key of OPTIONAL_CONSENT_CATEGORIES) {
      normalizedChoices[key] = Boolean(data.choices?.[key]);
    }

    if (uid && data.hasSavedChoices) {
      setCachedUserPrivacyState({
        userId: uid,
        hasSavedChoices: true,
        choices: normalizedChoices,
        policyVersion: data.policyVersion || PRIVACY_POLICY_VERSION,
        lastUpdatedAt: data.lastUpdatedAt || null,
        syncedAt: new Date().toISOString(),
      });
    }

    return {
      ...data,
      choices: normalizedChoices,
      policyVersion: data.policyVersion || PRIVACY_POLICY_VERSION,
      policyLastUpdated: data.policyLastUpdated || PRIVACY_POLICY_LAST_UPDATED,
      history: Array.isArray(data.history) ? data.history : [],
    };
  },

  /**
   * Saves the user's explicit category-by-category choices from the Privacy Choices screen.
   * Each category is persisted as a separate record in Supabase.
   * Throws an error if authentication or Supabase persistence fails (never fakes success).
   */
  async saveChoicesBatch(params: {
    entries: Array<{ purpose: OptionalConsentCategory; status: 'granted' | 'withdrawn' }>;
    source: string;
    language: ConsentLanguage;
    idempotencyKey: string;
    viaSelectAll?: boolean;
  }): Promise<PrivacyConsentsResponse> {
    const data = await privacyRequest<PrivacyConsentsResponse>('/api/privacy/consents/batch', {
      method: 'POST',
      body: JSON.stringify({
        entries: params.entries,
        policyVersion: PRIVACY_POLICY_VERSION,
        source: params.source,
        language: params.language,
        idempotencyKey: params.idempotencyKey,
        auditMetadata: {
          via_select_all: Boolean(params.viaSelectAll),
          interface_version: 'consent-center-v2',
        },
      }),
    });

    const uid = data.userId || getActiveUserId();
    const normalizedChoices = createEmptyOptionalChoices();
    for (const key of OPTIONAL_CONSENT_CATEGORIES) {
      normalizedChoices[key] = Boolean(data.choices?.[key]);
    }

    if (uid) {
      setCachedUserPrivacyState({
        userId: uid,
        hasSavedChoices: true,
        choices: normalizedChoices,
        policyVersion: data.policyVersion || PRIVACY_POLICY_VERSION,
        lastUpdatedAt: data.lastUpdatedAt || new Date().toISOString(),
        syncedAt: new Date().toISOString(),
      });
    }

    return {
      ...data,
      choices: normalizedChoices,
    };
  },

  /**
   * Grants or withdraws a single optional consent category (e.g. from Settings, AI prompt, or UPI QR).
   */
  async saveSingleConsent<P extends OptionalConsentCategory | 'upi_qr_storage'>(params: {
    purpose: P;
    status: 'granted' | 'withdrawn';
    source: string;
    language: ConsentLanguage;
    idempotencyKey?: string;
  }): Promise<{ success: boolean; purpose: P; status: 'granted' | 'withdrawn' }> {
    const data = await privacyRequest('/api/privacy/consents', {
      method: 'POST',
      body: JSON.stringify({
        category: params.purpose,
        purpose: params.purpose,
        status: params.status,
        policyVersion: PRIVACY_POLICY_VERSION,
        source: params.source,
        language: params.language,
        idempotencyKey: params.idempotencyKey || generateConsentIdempotencyKey(params.purpose),
        auditMetadata: {
          interface_version: 'consent-center-v2',
        },
      }),
    });

    const uid = getActiveUserId();
    if (uid && (OPTIONAL_CONSENT_CATEGORIES as readonly string[]).includes(params.purpose)) {
      const prev = getCachedUserPrivacyState(uid);
      const nextChoices = prev ? { ...prev.choices } : createEmptyOptionalChoices();
      nextChoices[params.purpose as OptionalConsentCategory] = params.status === 'granted';
      setCachedUserPrivacyState({
        userId: uid,
        hasSavedChoices: true,
        choices: nextChoices,
        policyVersion: PRIVACY_POLICY_VERSION,
        lastUpdatedAt: new Date().toISOString(),
        syncedAt: new Date().toISOString(),
      });
    }

    return {
      success: true,
      purpose: params.purpose,
      status: data.status || params.status,
    };
  },

  /**
   * Convenience wrapper for updating a category consent directly.
   */
  async updateCategoryConsent(
    category: OptionalConsentCategory,
    granted: boolean,
    opts?: { source?: string; consentWording?: string; language?: ConsentLanguage }
  ) {
    return this.saveSingleConsent({
      purpose: category,
      status: granted ? 'granted' : 'withdrawn',
      source: opts?.source || 'upi_qr',
      language: opts?.language || 'en',
    });
  },

  /**
   * Withdraws ALL optional consents in one action while keeping essential core records intact.
   */
  async withdrawAllOptional(params: {
    source?: string;
    language?: ConsentLanguage;
    idempotencyKey?: string;
  } = {}): Promise<PrivacyConsentsResponse> {
    const data = await privacyRequest<PrivacyConsentsResponse>('/api/privacy/consents/withdraw-all', {
      method: 'POST',
      body: JSON.stringify({
        policyVersion: PRIVACY_POLICY_VERSION,
        source: params.source || 'settings_manage_consent',
        language: params.language || 'en',
        idempotencyKey: params.idempotencyKey || generateConsentIdempotencyKey('withdraw_all'),
      }),
    });

    const uid = data.userId || getActiveUserId();
    if (uid) {
      setCachedUserPrivacyState({
        userId: uid,
        hasSavedChoices: true,
        choices: createEmptyOptionalChoices(),
        policyVersion: data.policyVersion || PRIVACY_POLICY_VERSION,
        lastUpdatedAt: data.lastUpdatedAt || new Date().toISOString(),
        syncedAt: new Date().toISOString(),
      });
    }

    return {
      ...data,
      choices: createEmptyOptionalChoices(),
    };
  },
};
