/**
 * Authenticated API client for user-isolated UPI QR profiles
 * My Money Manager by HackifyPro
 */

import { getStoredAuthUser, getStoredSessionToken } from './authApi';
import { doesUpiProfileBelongToUser, type UpiProfileRecord } from './upiQrUtils';

export interface UpiProfileResponse {
  success: boolean;
  profile: UpiProfileRecord | null;
  consentStatus: 'granted' | 'withdrawn' | 'not_granted';
  consentVersion?: string | null;
  message?: string;
  code?: string;
}

export interface UpiProfileChangedDetail {
  userId: string | null;
  profile: UpiProfileRecord | null;
  consentStatus: 'granted' | 'withdrawn' | 'not_granted';
  consentVersion?: string | null;
}

interface ScopedUpiCache {
  userId: string;
  token: string;
  response: UpiProfileResponse;
  cachedAt: number;
}

const CACHE_TTL_MS = 30_000;
let scopedCache: ScopedUpiCache | null = null;
let inflightGet: { userId: string; token: string; promise: Promise<UpiProfileResponse> } | null = null;

function getCurrentAuthScope(): { userId: string | null; token: string | null } {
  const user = getStoredAuthUser();
  const token = getStoredSessionToken();
  return {
    userId: user?.id || user?.uid || null,
    token: token || null,
  };
}

export function clearUpiProfileCache(): void {
  scopedCache = null;
  inflightGet = null;
}

function notifyUpiProfileChanged(detail: UpiProfileChangedDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<UpiProfileChangedDetail>('my-money-upi-profile-changed', { detail }));
}

// Clear cache whenever another component (e.g. PrivacyConsentCard) emits a profile-changed event without detail
if (typeof window !== 'undefined') {
  window.addEventListener('my-money-upi-profile-changed', (ev: Event) => {
    const customEv = ev as CustomEvent<UpiProfileChangedDetail | undefined>;
    if (!customEv.detail) {
      clearUpiProfileCache();
    }
  });
}

async function upiRequest<T = UpiProfileResponse>(
  method: 'GET' | 'POST' | 'PUT' | 'DELETE',
  body?: Record<string, any>
): Promise<T> {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = {
    Accept: 'application/json',
  };
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch('/api/upi/profile', {
    method,
    headers,
    credentials: 'include',
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });

  const data = await res.json().catch(() => ({ success: false, message: 'Unexpected server response.' }));
  if (!res.ok) {
    const err = new Error(data?.message || `UPI profile request failed (${res.status})`);
    (err as any).status = res.status;
    (err as any).code = data?.code;
    throw err;
  }
  return data as T;
}

function sanitizeOwnedResponse(res: UpiProfileResponse, currentUserId: string | null): UpiProfileResponse {
  if (!res || !res.success) return res;
  if (res.consentStatus === 'withdrawn') {
    return { ...res, profile: null };
  }
  if (res.profile && currentUserId && !doesUpiProfileBelongToUser(res.profile, currentUserId)) {
    return { ...res, profile: null };
  }
  return res;
}

export const upiProfileApi = {
  clearCache: clearUpiProfileCache,

  async getProfile(options: { forceRefresh?: boolean } = {}): Promise<UpiProfileResponse> {
    const { userId, token } = getCurrentAuthScope();
    if (!userId || !token) {
      clearUpiProfileCache();
      return {
        success: false,
        profile: null,
        consentStatus: 'not_granted',
        message: 'Authentication required.',
      };
    }

    // Drop cache immediately if user or session token changed
    if (scopedCache && (scopedCache.userId !== userId || scopedCache.token !== token)) {
      clearUpiProfileCache();
    }

    if (
      !options.forceRefresh &&
      scopedCache &&
      scopedCache.userId === userId &&
      scopedCache.token === token &&
      Date.now() - scopedCache.cachedAt < CACHE_TTL_MS
    ) {
      return scopedCache.response;
    }

    if (
      !options.forceRefresh &&
      inflightGet &&
      inflightGet.userId === userId &&
      inflightGet.token === token
    ) {
      return inflightGet.promise;
    }

    const promise = upiRequest<UpiProfileResponse>('GET')
      .then((raw) => {
        const clean = sanitizeOwnedResponse(raw, userId);
        // Only cache if still on same authenticated user & token
        const latestScope = getCurrentAuthScope();
        if (latestScope.userId === userId && latestScope.token === token && clean.success) {
          scopedCache = {
            userId,
            token,
            response: clean,
            cachedAt: Date.now(),
          };
        }
        return clean;
      })
      .finally(() => {
        if (inflightGet?.promise === promise) {
          inflightGet = null;
        }
      });

    inflightGet = { userId, token, promise };
    return promise;
  },

  async saveProfile(payload: {
    upiId: string;
    payeeName?: string;
    paymentNote?: string;
    consentAccepted: boolean;
    source?: 'upi_qr_setup' | 'settings_upi_qr';
  }): Promise<UpiProfileResponse> {
    const { userId, token } = getCurrentAuthScope();
    const res = sanitizeOwnedResponse(await upiRequest<UpiProfileResponse>('POST', payload), userId);
    if (res.success && userId && token) {
      scopedCache = { userId, token, response: res, cachedAt: Date.now() };
      notifyUpiProfileChanged({
        userId,
        profile: res.profile || null,
        consentStatus: res.consentStatus || 'granted',
        consentVersion: res.consentVersion ?? null,
      });
    }
    return res;
  },

  async updateProfile(payload: {
    upiId: string;
    payeeName?: string;
    paymentNote?: string;
    consentAccepted?: boolean;
    source?: 'upi_qr_setup' | 'settings_upi_qr';
  }): Promise<UpiProfileResponse> {
    const { userId, token } = getCurrentAuthScope();
    const res = sanitizeOwnedResponse(await upiRequest<UpiProfileResponse>('PUT', payload), userId);
    if (res.success && userId && token) {
      scopedCache = { userId, token, response: res, cachedAt: Date.now() };
      notifyUpiProfileChanged({
        userId,
        profile: res.profile || null,
        consentStatus: res.consentStatus || 'granted',
        consentVersion: res.consentVersion ?? null,
      });
    }
    return res;
  },

  async removeProfile(opts: {
    withdrawConsent?: boolean;
    source?: 'upi_qr_setup' | 'settings_upi_qr';
  } = {}): Promise<UpiProfileResponse> {
    const { userId, token } = getCurrentAuthScope();
    const res = await upiRequest<UpiProfileResponse>('DELETE', {
      withdrawConsent: opts.withdrawConsent !== false,
      source: opts.source || 'upi_qr_setup',
    });
    if (res.success && userId && token) {
      const next: UpiProfileResponse = {
        ...res,
        profile: null,
        consentStatus: res.consentStatus || (opts.withdrawConsent !== false ? 'withdrawn' : 'not_granted'),
      };
      scopedCache = { userId, token, response: next, cachedAt: Date.now() };
      notifyUpiProfileChanged({
        userId,
        profile: null,
        consentStatus: next.consentStatus,
        consentVersion: next.consentVersion ?? null,
      });
    } else {
      clearUpiProfileCache();
    }
    return res;
  },
};
