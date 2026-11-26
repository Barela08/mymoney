/**
 * Server-Side Firebase ID Token Verification
 * My Money Manager by HackifyPro
 *
 * Cryptographically verifies Firebase Auth ID tokens (RS256) against Google's
 * official public X.509 certificates for `securetoken@system.gserviceaccount.com`.
 * NEVER trusts unverified client-supplied email or UID payloads.
 */

import crypto from 'crypto';

const GOOGLE_CERTS_URL =
  'https://www.googleapis.com/robot/v1/metadata/x509/securetoken@system.gserviceaccount.com';

let cachedCerts: Record<string, string> | null = null;
let cachedCertsExpiresAt = 0;

export interface VerifiedFirebaseToken {
  uid: string;
  email: string;
  emailVerified: boolean;
  name: string;
  picture: string | null;
  provider: string;
}

function decodeBase64UrlJson(segment: string): any {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (normalized.length % 4)) % 4;
  return JSON.parse(Buffer.from(normalized + '='.repeat(pad), 'base64').toString('utf8'));
}

function base64UrlToBuffer(segment: string): Buffer {
  const normalized = segment.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(pad), 'base64');
}

async function getGooglePublicCerts(): Promise<Record<string, string>> {
  if (cachedCerts && Date.now() < cachedCertsExpiresAt) {
    return cachedCerts;
  }
  const res = await fetch(GOOGLE_CERTS_URL, { headers: { Accept: 'application/json' } });
  if (!res.ok) {
    throw new Error(`Failed to fetch Google signing certificates (HTTP ${res.status}).`);
  }
  const cacheControl = res.headers.get('cache-control') || '';
  const maxAgeMatch = cacheControl.match(/max-age=(\d+)/i);
  const ttlSec = maxAgeMatch ? Math.max(60, parseInt(maxAgeMatch[1], 10)) : 3600;
  const certs = (await res.json()) as Record<string, string>;
  cachedCerts = certs;
  cachedCertsExpiresAt = Date.now() + ttlSec * 1000;
  return certs;
}

/**
 * Pure verification helper (also used directly in unit tests).
 */
export function verifyFirebaseJwtWithKey(
  idToken: string,
  publicKeyOrCert: string,
  expectedProjectId: string,
  nowEpochSec: number = Math.floor(Date.now() / 1000)
): VerifiedFirebaseToken {
  const parts = String(idToken || '').trim().split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }
  const [headerB64, payloadB64, sigB64] = parts;
  const header = decodeBase64UrlJson(headerB64);
  const payload = decodeBase64UrlJson(payloadB64);

  if (header?.alg !== 'RS256') {
    throw new Error('Unsupported Firebase token algorithm.');
  }

  const signingInput = Buffer.from(`${headerB64}.${payloadB64}`, 'utf8');
  const signature = base64UrlToBuffer(sigB64);
  const verified = crypto.verify('RSA-SHA256', signingInput, publicKeyOrCert, signature);
  if (!verified) {
    throw new Error('Firebase ID token signature verification failed.');
  }

  if (!expectedProjectId) {
    throw new Error('Firebase project ID is not configured on the server.');
  }
  if (payload.aud !== expectedProjectId) {
    throw new Error('Firebase ID token audience mismatch.');
  }
  if (payload.iss !== `https://securetoken.google.com/${expectedProjectId}`) {
    throw new Error('Firebase ID token issuer mismatch.');
  }
  if (typeof payload.exp !== 'number' || payload.exp <= nowEpochSec) {
    throw new Error('Firebase ID token has expired.');
  }
  if (typeof payload.iat !== 'number' || payload.iat > nowEpochSec + 300) {
    throw new Error('Firebase ID token issued-at time is invalid.');
  }
  if (typeof payload.sub !== 'string' || !payload.sub.trim() || payload.sub.length > 128) {
    throw new Error('Firebase ID token subject (UID) is missing.');
  }
  const email = typeof payload.email === 'string' ? payload.email.toLowerCase().trim() : '';
  if (!email) {
    throw new Error('Google account email is required.');
  }

  return {
    uid: payload.sub.trim(),
    email,
    emailVerified: Boolean(payload.email_verified),
    name: typeof payload.name === 'string' ? payload.name.trim() : '',
    picture: typeof payload.picture === 'string' ? payload.picture.trim() : null,
    provider: String(payload?.firebase?.sign_in_provider || 'google.com'),
  };
}

export async function verifyFirebaseIdToken(idToken: string): Promise<VerifiedFirebaseToken> {
  const projectId = (
    process.env.FIREBASE_PROJECT_ID ||
    process.env.VITE_FIREBASE_PROJECT_ID ||
    ''
  ).trim();
  if (!projectId) {
    throw new Error(
      'Google Sign-In via Firebase is not configured on this server yet (FIREBASE_PROJECT_ID missing).'
    );
  }

  const parts = String(idToken || '').trim().split('.');
  if (parts.length !== 3) {
    throw new Error('Malformed Firebase ID token.');
  }
  const header = decodeBase64UrlJson(parts[0]);
  const kid = String(header?.kid || '');
  if (!kid) {
    throw new Error('Firebase ID token missing key ID (kid).');
  }

  const certs = await getGooglePublicCerts();
  const cert = certs[kid];
  if (!cert) {
    // Force refresh once in case Google rotated keys
    cachedCerts = null;
    const freshCerts = await getGooglePublicCerts();
    if (!freshCerts[kid]) {
      throw new Error('Firebase signing key not recognized.');
    }
    return verifyFirebaseJwtWithKey(idToken, freshCerts[kid], projectId);
  }

  return verifyFirebaseJwtWithKey(idToken, cert, projectId);
}
