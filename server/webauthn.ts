/**
 * Server-Side WebAuthn (Passkey) Challenge & Cryptographic Verification Engine
 * My Money Manager by HackifyPro
 *
 * Pure Node.js `crypto` implementation — zero external WebAuthn dependencies.
 * Supports:
 * - Server-issued single-use cryptographic challenges (5-minute TTL)
 * - CBOR/COSE attestationObject parsing (ES256 P-256 & RS256 public key -> SPKI PEM)
 * - Full cryptographic assertion verification (rpIdHash, UP flag, clientDataJSON, signCount replay check, signature)
 */

import crypto from 'crypto';

interface StoredChallenge {
  challenge: string;
  type: 'register' | 'login';
  userId?: string;
  rpId: string;
  origin: string;
  expiresAt: number;
}

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const challengeStore = new Map<string, StoredChallenge>();

function pruneChallenges() {
  const now = Date.now();
  for (const [k, v] of challengeStore.entries()) {
    if (v.expiresAt <= now) challengeStore.delete(k);
  }
}

export function base64UrlToBuffer(b64u: string): Buffer {
  const normalized = String(b64u || '').replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (normalized.length % 4)) % 4;
  return Buffer.from(normalized + '='.repeat(padLen), 'base64');
}

export function bufferToBase64Url(buf: Buffer | Uint8Array): string {
  return Buffer.from(buf)
    .toString('base64')
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/g, '');
}

export function issueWebAuthnChallenge(params: {
  type: 'register' | 'login';
  userId?: string;
  rpId: string;
  origin: string;
}): { challengeId: string; challenge: string; expiresAt: number } {
  pruneChallenges();
  const challengeId = crypto.randomBytes(16).toString('hex');
  const challenge = bufferToBase64Url(crypto.randomBytes(32));
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  challengeStore.set(challengeId, {
    challenge,
    type: params.type,
    userId: params.userId,
    rpId: params.rpId,
    origin: params.origin,
    expiresAt,
  });
  return { challengeId, challenge, expiresAt };
}

export function consumeWebAuthnChallenge(
  challengeId: string,
  expectedType: 'register' | 'login',
  expectedUserId?: string
): StoredChallenge | null {
  pruneChallenges();
  const record = challengeStore.get(challengeId);
  if (!record) return null;
  challengeStore.delete(challengeId);
  if (record.expiresAt <= Date.now()) return null;
  if (record.type !== expectedType) return null;
  if (expectedUserId && record.userId && record.userId !== expectedUserId) return null;
  return record;
}

// ============================================================================
// MINIMAL RFC 8949 CBOR DECODER FOR WEBAUTHN ATTESTATION & COSE KEYS
// ============================================================================
function decodeCborValue(buf: Buffer, offset: number): { value: any; nextOffset: number } {
  if (offset >= buf.length) throw new Error('CBOR unexpected end of buffer');
  const first = buf[offset++];
  const major = first >> 5;
  const additional = first & 0x1f;

  const readUint = (): number => {
    if (additional < 24) return additional;
    if (additional === 24) return buf[offset++];
    if (additional === 25) {
      const v = buf.readUInt16BE(offset);
      offset += 2;
      return v;
    }
    if (additional === 26) {
      const v = buf.readUInt32BE(offset);
      offset += 4;
      return v;
    }
    if (additional === 27) {
      const hi = buf.readUInt32BE(offset);
      const lo = buf.readUInt32BE(offset + 4);
      offset += 8;
      return hi * 0x100000000 + lo;
    }
    throw new Error(`Unsupported CBOR length encoding: ${additional}`);
  };

  if (major === 0) {
    return { value: readUint(), nextOffset: offset };
  }
  if (major === 1) {
    return { value: -1 - readUint(), nextOffset: offset };
  }
  if (major === 2) {
    const len = readUint();
    const slice = Buffer.from(buf.subarray(offset, offset + len));
    return { value: slice, nextOffset: offset + len };
  }
  if (major === 3) {
    const len = readUint();
    const str = buf.subarray(offset, offset + len).toString('utf8');
    return { value: str, nextOffset: offset + len };
  }
  if (major === 4) {
    const len = readUint();
    const arr: any[] = [];
    for (let i = 0; i < len; i++) {
      const item = decodeCborValue(buf, offset);
      arr.push(item.value);
      offset = item.nextOffset;
    }
    return { value: arr, nextOffset: offset };
  }
  if (major === 5) {
    const len = readUint();
    const map = new Map<any, any>();
    for (let i = 0; i < len; i++) {
      const k = decodeCborValue(buf, offset);
      offset = k.nextOffset;
      const v = decodeCborValue(buf, offset);
      offset = v.nextOffset;
      map.set(k.value, v.value);
    }
    return { value: map, nextOffset: offset };
  }
  if (major === 6) {
    readUint();
    return decodeCborValue(buf, offset);
  }
  if (major === 7) {
    if (additional === 20) return { value: false, nextOffset: offset };
    if (additional === 21) return { value: true, nextOffset: offset };
    if (additional === 22) return { value: null, nextOffset: offset };
    if (additional === 23) return { value: undefined, nextOffset: offset };
    if (additional === 25) {
      offset += 2;
      return { value: 0, nextOffset: offset };
    }
    if (additional === 26) {
      const v = buf.readFloatBE(offset);
      offset += 4;
      return { value: v, nextOffset: offset };
    }
    if (additional === 27) {
      const v = buf.readDoubleBE(offset);
      offset += 8;
      return { value: v, nextOffset: offset };
    }
  }
  throw new Error(`Unsupported CBOR major type ${major}`);
}

/**
 * Convert a COSE public key Map (ES256 P-256 or RS256) to standard SPKI PEM string.
 */
export function coseKeyMapToSpkiPem(coseMap: Map<any, any>): { spkiPem: string; algorithm: number } {
  const kty = coseMap.get(1);
  const alg = Number(coseMap.get(3));

  // EC2 key (P-256 / ES256: kty=2, alg=-7, crv=1)
  if (kty === 2) {
    const x: Buffer = coseMap.get(-2);
    const y: Buffer = coseMap.get(-3);
    if (!Buffer.isBuffer(x) || !Buffer.isBuffer(y)) {
      throw new Error('Invalid COSE EC2 public key coordinates');
    }
    const keyObj = crypto.createPublicKey({
      key: {
        kty: 'EC',
        crv: 'P-256',
        x: bufferToBase64Url(x),
        y: bufferToBase64Url(y),
      },
      format: 'jwk',
    });
    return {
      spkiPem: keyObj.export({ type: 'spki', format: 'pem' }).toString(),
      algorithm: alg || -7,
    };
  }

  // RSA key (RS256: kty=3, alg=-257)
  if (kty === 3) {
    const n: Buffer = coseMap.get(-1);
    const e: Buffer = coseMap.get(-2);
    if (!Buffer.isBuffer(n) || !Buffer.isBuffer(e)) {
      throw new Error('Invalid COSE RSA public key components');
    }
    const keyObj = crypto.createPublicKey({
      key: {
        kty: 'RSA',
        n: bufferToBase64Url(n),
        e: bufferToBase64Url(e),
      },
      format: 'jwk',
    });
    return {
      spkiPem: keyObj.export({ type: 'spki', format: 'pem' }).toString(),
      algorithm: alg || -257,
    };
  }

  throw new Error(`Unsupported COSE key type: ${kty}`);
}

export function extractCredentialFromAttestation(params: {
  clientDataJSON: string;
  attestationObject: string;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  publicKeySpkiBase64?: string;
}): {
  credentialId: string;
  publicKeySpki: string;
  algorithm: number;
  counter: number;
} {
  const clientDataBuf = base64UrlToBuffer(params.clientDataJSON);
  const clientData = JSON.parse(clientDataBuf.toString('utf8'));

  if (clientData.type !== 'webauthn.create') {
    throw new Error('Invalid WebAuthn ceremony type for passkey registration.');
  }
  if (clientData.challenge !== params.expectedChallenge) {
    throw new Error('WebAuthn registration challenge mismatch.');
  }
  if (!isOriginAllowed(clientData.origin, params.expectedOrigin, params.expectedRpId)) {
    throw new Error(`WebAuthn origin mismatch: ${clientData.origin}`);
  }

  const attBuf = base64UrlToBuffer(params.attestationObject);
  const decoded = decodeCborValue(attBuf, 0).value;
  if (!(decoded instanceof Map)) {
    throw new Error('Invalid CBOR attestationObject.');
  }
  const authData: Buffer = decoded.get('authData');
  if (!Buffer.isBuffer(authData) || authData.length < 55) {
    throw new Error('Invalid authenticatorData in attestationObject.');
  }

  const rpIdHash = authData.subarray(0, 32);
  const expectedRpIdHash = crypto.createHash('sha256').update(params.expectedRpId).digest();
  if (!crypto.timingSafeEqual(rpIdHash, expectedRpIdHash)) {
    throw new Error('WebAuthn RP ID hash verification failed.');
  }

  const flags = authData[32];
  const userPresent = Boolean(flags & 0x01);
  const hasAttestedCred = Boolean(flags & 0x40);
  if (!userPresent || !hasAttestedCred) {
    throw new Error('Authenticator did not verify user presence or attested credential data.');
  }

  const counter = authData.readUInt32BE(33);
  // Skip 16-byte AAGUID (bytes 37..53)
  const credIdLen = authData.readUInt16BE(53);
  const credIdBuf = authData.subarray(55, 55 + credIdLen);
  const credentialId = bufferToBase64Url(credIdBuf);

  const coseSlice = authData.subarray(55 + credIdLen);
  let publicKeySpki = '';
  let algorithm = -7;

  try {
    const coseDecoded = decodeCborValue(coseSlice, 0).value;
    if (coseDecoded instanceof Map) {
      const converted = coseKeyMapToSpkiPem(coseDecoded);
      publicKeySpki = converted.spkiPem;
      algorithm = converted.algorithm;
    }
  } catch (err) {
    // Fallback to browser's getPublicKey() SPKI DER if provided and valid
    if (params.publicKeySpkiBase64) {
      const der = base64UrlToBuffer(params.publicKeySpkiBase64);
      const pubKey = crypto.createPublicKey({ key: der, format: 'der', type: 'spki' });
      publicKeySpki = pubKey.export({ type: 'spki', format: 'pem' }).toString();
      algorithm = pubKey.asymmetricKeyType === 'rsa' ? -257 : -7;
    } else {
      throw err;
    }
  }

  if (!publicKeySpki) {
    throw new Error('Could not extract passkey public key from attestation.');
  }

  return { credentialId, publicKeySpki, algorithm, counter };
}

export function verifyPasskeyAssertion(params: {
  clientDataJSON: string;
  authenticatorData: string;
  signature: string;
  expectedChallenge: string;
  expectedOrigin: string;
  expectedRpId: string;
  publicKeySpki: string;
  previousCounter: number;
}): { valid: boolean; newCounter: number; error?: string } {
  try {
    const clientDataBuf = base64UrlToBuffer(params.clientDataJSON);
    const clientData = JSON.parse(clientDataBuf.toString('utf8'));

    if (clientData.type !== 'webauthn.get') {
      return { valid: false, newCounter: params.previousCounter, error: 'Invalid WebAuthn assertion type.' };
    }
    if (clientData.challenge !== params.expectedChallenge) {
      return { valid: false, newCounter: params.previousCounter, error: 'Passkey challenge mismatch.' };
    }
    if (!isOriginAllowed(clientData.origin, params.expectedOrigin, params.expectedRpId)) {
      return { valid: false, newCounter: params.previousCounter, error: 'Passkey origin verification failed.' };
    }

    const authDataBuf = base64UrlToBuffer(params.authenticatorData);
    if (authDataBuf.length < 37) {
      return { valid: false, newCounter: params.previousCounter, error: 'Malformed authenticatorData.' };
    }

    const rpIdHash = authDataBuf.subarray(0, 32);
    const expectedRpIdHash = crypto.createHash('sha256').update(params.expectedRpId).digest();
    if (!crypto.timingSafeEqual(rpIdHash, expectedRpIdHash)) {
      return { valid: false, newCounter: params.previousCounter, error: 'Passkey RP ID mismatch.' };
    }

    const flags = authDataBuf[32];
    if (!(flags & 0x01)) {
      return { valid: false, newCounter: params.previousCounter, error: 'User presence flag missing.' };
    }

    const newCounter = authDataBuf.readUInt32BE(33);
    // Replay protection per WebAuthn spec: if either counter > 0, newCounter MUST be strictly greater than previousCounter
    if (params.previousCounter > 0 && newCounter > 0 && newCounter <= params.previousCounter) {
      return {
        valid: false,
        newCounter: params.previousCounter,
        error: 'Passkey signCount replay check failed. Please re-register this passkey.',
      };
    }

    const clientDataHash = crypto.createHash('sha256').update(clientDataBuf).digest();
    const signedData = Buffer.concat([authDataBuf, clientDataHash]);
    const sigBuf = base64UrlToBuffer(params.signature);

    const publicKey = crypto.createPublicKey(params.publicKeySpki);
    const ok = crypto.verify('sha256', signedData, publicKey, sigBuf);
    if (!ok) {
      return { valid: false, newCounter: params.previousCounter, error: 'Passkey cryptographic signature invalid.' };
    }

    return { valid: true, newCounter };
  } catch (err: any) {
    return {
      valid: false,
      newCounter: params.previousCounter,
      error: err?.message || 'Passkey verification failed.',
    };
  }
}

function isOriginAllowed(actualOrigin: string, expectedOrigin: string, rpId: string): boolean {
  if (!actualOrigin) return false;
  if (actualOrigin === expectedOrigin) return true;
  try {
    const parsed = new URL(actualOrigin);
    if (parsed.hostname === rpId || parsed.hostname.endsWith(`.${rpId}`)) {
      return parsed.protocol === 'https:' || parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    }
  } catch {}
  return false;
}

export function resolveRpContext(reqHeaders: Record<string, string | string[] | undefined>): {
  rpId: string;
  origin: string;
} {
  const originHeader = String(reqHeaders['origin'] || '').trim();
  if (originHeader) {
    try {
      const u = new URL(originHeader);
      return { rpId: u.hostname, origin: u.origin };
    } catch {}
  }
  const hostHeader = String(reqHeaders['x-forwarded-host'] || reqHeaders['host'] || 'localhost:3000').trim();
  const hostname = hostHeader.split(':')[0] || 'localhost';
  const proto = String(reqHeaders['x-forwarded-proto'] || (hostname === 'localhost' ? 'http' : 'https')).trim();
  return { rpId: hostname, origin: `${proto}://${hostHeader}` };
}
