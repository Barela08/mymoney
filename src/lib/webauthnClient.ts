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

export function isPasskeyAllowedInContext(action: 'get' | 'create' = 'get'): boolean {
  if (typeof document === 'undefined') return true;
  const feature = action === 'create' ? 'publickey-credentials-create' : 'publickey-credentials-get';
  const docAny = document as any;
  try {
    if (typeof docAny.permissionsPolicy?.allowsFeature === 'function') {
      return Boolean(docAny.permissionsPolicy.allowsFeature(feature));
    }
    if (typeof docAny.featurePolicy?.allowsFeature === 'function') {
      return Boolean(docAny.featurePolicy.allowsFeature(feature));
    }
  } catch {
    // Fallback to runtime check if browser policy inspection throws
  }
  return true;
}

function normalizeWebAuthnError(err: any, action: 'get' | 'create'): Error {
  const msg = String(err?.message || '');
  const isPolicyBlocked =
    /publickey-credentials-|permissions policy|feature policy|cross-origin child frames|not enabled in this document/i.test(
      msg
    );
  if (isPolicyBlocked || !isPasskeyAllowedInContext(action)) {
    return new Error(
      'Passkeys cannot run inside an embedded preview frame due to browser security policy. Open this app directly in a full browser tab to use Passkeys, or sign in with Email & Password.'
    );
  }
  if (err?.name === 'NotAllowedError' || err?.name === 'AbortError') {
    return new Error(
      action === 'create'
        ? 'Passkey registration was cancelled or timed out. Please try again.'
        : 'Passkey sign-in was cancelled or no matching passkey was found on this device.'
    );
  }
  return err instanceof Error ? err : new Error(msg || 'Passkey operation failed.');
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
  if (!isPasskeyAllowedInContext('create')) {
    throw normalizeWebAuthnError(null, 'create');
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

  let credential: PublicKeyCredential | null = null;
  try {
    credential = (await navigator.credentials.create({ publicKey })) as PublicKeyCredential | null;
  } catch (err: any) {
    throw normalizeWebAuthnError(err, 'create');
  }
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
  if (!isPasskeyAllowedInContext('get')) {
    throw normalizeWebAuthnError(null, 'get');
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

  let credential: PublicKeyCredential | null = null;
  try {
    credential = (await navigator.credentials.get({ publicKey })) as PublicKeyCredential | null;
  } catch (err: any) {
    throw normalizeWebAuthnError(err, 'get');
  }
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
