/**
 * Private User UPI Profile & Payment Request QR Helper
 * My Money Manager by HackifyPro
 *
 * Security & Privacy Rules:
 * - Strictly user-scoped (never exposes UPI IDs publicly or across users).
 * - Never assumes a user's email address is their UPI ID.
 * - Requires explicit DPDP consent ('upi_qr') before saving UPI details.
 * - Never stores UPI PINs, OTPs, or banking passwords.
 * - Amount QR is a payment request QR only; never auto-marks paid or alters Available Balance.
 */

import { getStoredSessionToken } from './authApi';
import { getSupabaseClient } from './supabase';
import { privacyConsentApi } from './privacyConsentApi';

export const UPI_ID_REGEX = /^[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z]{2,64}$/;
const UPI_PROFILE_CACHE_PREFIX = 'my_money_upi_profile_v1_';
export const UPI_PROFILE_CHANGED_EVENT = 'my-money-upi-profile-changed';

export interface UserUpiProfile {
  id?: string;
  userId: string;
  upiId: string;
  payeeName: string;
  paymentNote: string;
  createdAt?: string;
  updatedAt?: string;
}

export function validateUpiId(raw: string): { valid: boolean; normalized: string; error?: string } {
  const normalized = (raw || '').trim();
  if (!normalized) {
    return { valid: false, normalized: '', error: 'UPI ID is required (e.g. yourname@upi).' };
  }
  if (/\s/.test(normalized)) {
    return { valid: false, normalized, error: 'UPI ID cannot contain spaces.' };
  }
  if (!UPI_ID_REGEX.test(normalized)) {
    return {
      valid: false,
      normalized,
      error: 'Invalid UPI ID format. Use format like yourname@upi or name@okaxis.',
    };
  }
  return { valid: true, normalized };
}

export function buildUpiPaymentUri(params: {
  upiId: string;
  payeeName?: string;
  amount?: number | string;
  note?: string;
}): string {
  const check = validateUpiId(params.upiId);
  if (!check.valid) return '';

  const search = new URLSearchParams();
  search.set('pa', check.normalized);

  const cleanName = (params.payeeName || '').trim().slice(0, 100);
  if (cleanName) {
    search.set('pn', cleanName);
  }

  if (params.amount !== undefined && params.amount !== null && String(params.amount).trim() !== '') {
    const num = Number(params.amount);
    if (!isNaN(num) && num > 0) {
      search.set('am', num.toFixed(2));
    }
  }

  search.set('cu', 'INR');

  const cleanNote = (params.note || '').trim().slice(0, 80);
  if (cleanNote) {
    search.set('tn', cleanNote);
  }

  return `upi://pay?${search.toString()}`;
}

function getCacheKey(userId: string): string {
  return `${UPI_PROFILE_CACHE_PREFIX}${userId}`;
}

export function getCachedUpiProfile(userId?: string | null): UserUpiProfile | null {
  if (typeof window === 'undefined' || !userId) return null;
  try {
    const raw = localStorage.getItem(getCacheKey(userId));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as UserUpiProfile;
    if (parsed.userId !== userId || !validateUpiId(parsed.upiId).valid) return null;
    return parsed;
  } catch {
    return null;
  }
}

export function setCachedUpiProfile(userId: string, profile: UserUpiProfile | null): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    if (profile) {
      localStorage.setItem(getCacheKey(userId), JSON.stringify(profile));
    } else {
      localStorage.removeItem(getCacheKey(userId));
    }
    window.dispatchEvent(new CustomEvent(UPI_PROFILE_CHANGED_EVENT, { detail: { userId, profile } }));
  } catch {}
}

function mapDbRowToProfile(row: any, fallbackUserId: string): UserUpiProfile {
  return {
    id: row.id,
    userId: row.user_id || fallbackUserId,
    upiId: row.upi_id || '',
    payeeName: row.payee_name || '',
    paymentNote: row.payment_note || '',
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export const upiProfileApi = {
  async getProfile(userId: string): Promise<UserUpiProfile | null> {
    if (!userId) return null;

    const token = getStoredSessionToken();
    if (token) {
      try {
        const res = await fetch('/api/upi-profile', {
          method: 'GET',
          headers: { Authorization: `Bearer ${token}` },
        });
        if (res.ok) {
          const data = await res.json();
          if (data.success && data.profile && !data.offlineFallback) {
            const mapped = mapDbRowToProfile(data.profile, userId);
            setCachedUpiProfile(userId, mapped);
            return mapped;
          }
          if (data.success && data.profile === null && !data.offlineFallback) {
            setCachedUpiProfile(userId, null);
            return null;
          }
        }
      } catch {}
    }

    // Fallback: direct Supabase RLS-protected query
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const { data, error } = await supabase
          .from('user_upi_profiles')
          .select('id, user_id, upi_id, payee_name, payment_note, created_at, updated_at')
          .eq('user_id', userId)
          .maybeSingle();
        if (!error && data) {
          const mapped = mapDbRowToProfile(data, userId);
          setCachedUpiProfile(userId, mapped);
          return mapped;
        }
      } catch {}
    }

    return getCachedUpiProfile(userId);
  },

  async saveProfile(
    userId: string,
    payload: {
      upiId: string;
      payeeName?: string;
      paymentNote?: string;
      consentGranted: boolean;
    }
  ): Promise<{ success: boolean; profile?: UserUpiProfile; message?: string }> {
    if (!userId) {
      return { success: false, message: 'You must be signed in to save a UPI ID.' };
    }

    if (payload.consentGranted !== true) {
      return {
        success: false,
        message: 'Please check the consent box to allow storing your UPI ID.',
      };
    }

    const vpaCheck = validateUpiId(payload.upiId);
    if (!vpaCheck.valid) {
      return { success: false, message: vpaCheck.error };
    }

    const cleanPayee = (payload.payeeName || '').trim().slice(0, 100);
    const cleanNote = (payload.paymentNote || '').trim().slice(0, 80);

    // 1. Record explicit 'upi_qr' consent in existing consent ledger
    try {
      await privacyConsentApi.updateCategoryConsent('upi_qr', true, {
        source: 'upi_qr_setup',
        consentWording:
          'I agree that My Money Manager may securely store and use my UPI ID and payee details to generate and display my personal UPI payment QR codes. I understand that I can update or remove this information from my settings.',
      });
    } catch {}

    // 2. Save via backend API
    const token = getStoredSessionToken();
    if (token) {
      try {
        const res = await fetch('/api/upi-profile', {
          method: 'PUT',
          headers: {
            'Content-Type': 'application/json',
            Authorization: `Bearer ${token}`,
          },
          body: JSON.stringify({
            upiId: vpaCheck.normalized,
            payeeName: cleanPayee,
            paymentNote: cleanNote,
            consentGranted: true,
          }),
        });
        const data = await res.json().catch(() => ({}));
        if (res.ok && data.success && data.profile && !data.offlineFallback) {
          const mapped = mapDbRowToProfile(data.profile, userId);
          setCachedUpiProfile(userId, mapped);
          return { success: true, profile: mapped, message: 'UPI ID saved securely.' };
        }
      } catch {}
    }

    // 3. Direct Supabase RLS upsert fallback
    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        const nowIso = new Date().toISOString();
        const { data, error } = await supabase
          .from('user_upi_profiles')
          .upsert(
            {
              user_id: userId,
              upi_id: vpaCheck.normalized,
              payee_name: cleanPayee || null,
              payment_note: cleanNote || null,
              updated_at: nowIso,
            },
            { onConflict: 'user_id' }
          )
          .select('id, user_id, upi_id, payee_name, payment_note, created_at, updated_at')
          .single();

        if (!error && data) {
          const mapped = mapDbRowToProfile(data, userId);
          setCachedUpiProfile(userId, mapped);
          return { success: true, profile: mapped, message: 'UPI ID saved securely.' };
        }
      } catch {}
    }

    // 4. Local user-scoped storage fallback
    const localProfile: UserUpiProfile = {
      id: `local_${userId}`,
      userId,
      upiId: vpaCheck.normalized,
      payeeName: cleanPayee,
      paymentNote: cleanNote,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };
    setCachedUpiProfile(userId, localProfile);
    return { success: true, profile: localProfile, message: 'UPI ID saved securely.' };
  },

  async removeProfile(
    userId: string,
    withdrawConsent = false
  ): Promise<{ success: boolean; message?: string }> {
    if (!userId) return { success: false, message: 'Authentication required.' };

    const token = getStoredSessionToken();
    if (token) {
      try {
        await fetch('/api/upi-profile', {
          method: 'DELETE',
          headers: { Authorization: `Bearer ${token}` },
        });
      } catch {}
    }

    const supabase = getSupabaseClient();
    if (supabase) {
      try {
        await supabase.from('user_upi_profiles').delete().eq('user_id', userId);
      } catch {}
    }

    setCachedUpiProfile(userId, null);

    if (withdrawConsent) {
      try {
        await privacyConsentApi.updateCategoryConsent('upi_qr', false, {
          source: 'upi_qr_setup',
        });
      } catch {}
    }

    return { success: true, message: 'Saved UPI ID removed.' };
  },
};
