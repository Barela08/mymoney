/**
 * Authenticated API client for user-isolated UPI QR profiles
 * My Money Manager by HackifyPro
 */

import { getStoredSessionToken } from './authApi';
import type { UpiProfileRecord } from './upiQrUtils';

export interface UpiProfileResponse {
  success: boolean;
  profile: UpiProfileRecord | null;
  consentStatus: 'granted' | 'withdrawn' | 'not_granted';
  message?: string;
  code?: string;
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

export const upiProfileApi = {
  getProfile(): Promise<UpiProfileResponse> {
    return upiRequest('GET');
  },

  saveProfile(payload: {
    upiId: string;
    payeeName?: string;
    paymentNote?: string;
    consentAccepted: boolean;
    source?: 'upi_qr_setup' | 'settings_upi_qr';
  }): Promise<UpiProfileResponse> {
    return upiRequest('POST', payload);
  },

  updateProfile(payload: {
    upiId: string;
    payeeName?: string;
    paymentNote?: string;
    consentAccepted: boolean;
    source?: 'upi_qr_setup' | 'settings_upi_qr';
  }): Promise<UpiProfileResponse> {
    return upiRequest('PUT', payload);
  },

  removeProfile(opts: {
    withdrawConsent?: boolean;
    source?: 'upi_qr_setup' | 'settings_upi_qr';
  } = {}): Promise<UpiProfileResponse> {
    return upiRequest('DELETE', {
      withdrawConsent: opts.withdrawConsent !== false,
      source: opts.source || 'upi_qr_setup',
    });
  },
};
