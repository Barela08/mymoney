/**
 * Browser WebAuthn (Passkey) Client Helper
 * My Money Manager by HackifyPro
 *
 * Performs real WebAuthn registration (`navigator.credentials.create`) and
 * login (`navigator.credentials.get`) using server-issued challenges.
 */

import { getStoredSessionToken } from './authApi';

function base64UrlToUint8Array(base64url: string): Uint8Array {
  const base64 = base64url.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64 + '='.repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) {
    bytes[i] = binary.charCodeAt(i);
  }
  return bytes;
}

function arrayBufferToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function isPasskeySupported(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.PublicKeyCredential !== 'undefined' &&
    typeof navigator !== 'undefined' &&
    Boolean(navigator.credentials)
  );
}

async function postJson(url: string, body: Record<string, any> = {}) {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Accept: 'application/json',
  };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(url, {
    method: 'POST',
    headers,
    credentials: 'include',
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({ success: false, message: 'Unexpected server response.' }));
  if (!res.ok) {
    throw new Error(data?.message || `Passkey request failed (${res.status})`);
  }
  return data;
}

export async function registerPasskeyOnDevice(deviceName?: string): Promise<{
  success: boolean;
  message: string;
  passkey?: { id: string; deviceName: string; createdAt: string; lastUsedAt: string | null };
}> {
  if (!isPasskeySupported()) {
    throw new Error('Passkeys are not supported in this browser or device.');
  }

  const start = await postJson('/api/auth/passkey/register/options');
  const opts = start.options;

  const publicKey: PublicKeyCredentialCreationOptions = {
    challenge: base64UrlToUint8Array(opts.challenge) as BufferSource,
    rp: opts.rp,
    user: {
      id: base64UrlToUint8Array(opts.user.id) as BufferSource,
      name: opts.user.name,
      displayName: opts.user.displayName,
    },
    pubKeyCredParams: opts.pubKeyCredParams,
    timeout: opts.timeout || 60000,
    attestation: opts.attestation || 'none',
    authenticatorSelection: opts.authenticatorSelection,
    excludeCredentials: (opts.excludeCredentials || []).map((c: any) => ({
      id: base64UrlToUint8Array(c.id) as BufferSource,
      type: 'public-key' as const,
      transports: c.transports,
    })),
  };

  const credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  if (!credential) {
    throw new Error('Passkey creation was cancelled.');
  }

  const attResp = credential.response as AuthenticatorAttestationResponse & {
    getPublicKey?: () => ArrayBuffer | null;
    getTransports?: () => string[];
  };

  let publicKeySpkiBase64: string | undefined;
  try {
    const pkBuf = attResp.getPublicKey?.();
    if (pkBuf) publicKeySpkiBase64 = arrayBufferToBase64Url(pkBuf);
  } catch {}

  const transports = attResp.getTransports?.() || ['internal'];

  return postJson('/api/auth/passkey/register/verify', {
    challengeId: start.challengeId,
    deviceName,
    id: credential.id,
    rawId: arrayBufferToBase64Url(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64Url(attResp.clientDataJSON),
      attestationObject: arrayBufferToBase64Url(attResp.attestationObject),
      publicKeySpkiBase64,
      transports,
    },
  });
}

export async function loginWithPasskeyOnDevice(email?: string): Promise<{
  success: boolean;
  message: string;
  user: any;
  sessionToken: string;
  requiresProfileCompletion?: boolean;
}> {
  if (!isPasskeySupported()) {
    throw new Error('Passkeys are not supported in this browser or device.');
  }

  const start = await postJson('/api/auth/passkey/login/options', email ? { email } : {});
  const opts = start.options;

  const publicKey: PublicKeyCredentialRequestOptions = {
    challenge: base64UrlToUint8Array(opts.challenge) as BufferSource,
    rpId: opts.rpId,
    timeout: opts.timeout || 60000,
    userVerification: opts.userVerification || 'preferred',
    allowCredentials:
      Array.isArray(opts.allowCredentials) && opts.allowCredentials.length > 0
        ? opts.allowCredentials.map((c: any) => ({
            id: base64UrlToUint8Array(c.id) as BufferSource,
            type: 'public-key' as const,
            transports: c.transports,
          }))
        : undefined,
  };

  const credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  if (!credential) {
    throw new Error('Passkey sign-in was cancelled.');
  }

  const assertResp = credential.response as AuthenticatorAssertionResponse;

  return postJson('/api/auth/passkey/login/verify', {
    challengeId: start.challengeId,
    id: arrayBufferToBase64Url(credential.rawId),
    rawId: arrayBufferToBase64Url(credential.rawId),
    response: {
      clientDataJSON: arrayBufferToBase64Url(assertResp.clientDataJSON),
      authenticatorData: arrayBufferToBase64Url(assertResp.authenticatorData),
      signature: arrayBufferToBase64Url(assertResp.signature),
      userHandle: assertResp.userHandle ? arrayBufferToBase64Url(assertResp.userHandle) : null,
    },
  });
}
