import fs from 'fs';
import os from 'os';
import path from 'path';
import * as webpush from 'web-push';

// Parse .env before resolving configuration & VAPID keys
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  console.warn('Notice loading .env in config.ts:', e);
}

function isValidVapidKeyPair(publicKey?: string, privateKey?: string): boolean {
  if (!publicKey || !privateKey) return false;
  try {
    const pubBytes = Buffer.from(publicKey.trim(), 'base64url');
    const privBytes = Buffer.from(privateKey.trim(), 'base64url');
    return pubBytes.length === 65 && privBytes.length === 32;
  } catch {
    return false;
  }
}

function resolveVapidKeys(): { publicKey: string; privateKey: string; isPersistent: boolean } {
  const envPublic = process.env.VAPID_PUBLIC_KEY?.trim();
  const envPrivate = process.env.VAPID_PRIVATE_KEY?.trim();
  if (isValidVapidKeyPair(envPublic, envPrivate)) {
    return { publicKey: envPublic!, privateKey: envPrivate!, isPersistent: true };
  }

  const g = globalThis as { __myMoneyVapidKeys?: { publicKey: string; privateKey: string; isPersistent: boolean } };
  if (g.__myMoneyVapidKeys && isValidVapidKeyPair(g.__myMoneyVapidKeys.publicKey, g.__myMoneyVapidKeys.privateKey)) {
    return g.__myMoneyVapidKeys;
  }

  const candidatePaths = [
    path.resolve(process.cwd(), '.data', 'runtime-store', 'vapid-keys.json'),
    path.resolve(os.tmpdir(), 'mymoney-vapid-keys.json'),
  ];

  for (const filePath of candidatePaths) {
    try {
      if (fs.existsSync(filePath)) {
        const parsed = JSON.parse(fs.readFileSync(filePath, 'utf8'));
        if (isValidVapidKeyPair(parsed?.publicKey, parsed?.privateKey)) {
          g.__myMoneyVapidKeys = {
            publicKey: String(parsed.publicKey).trim(),
            privateKey: String(parsed.privateKey).trim(),
            isPersistent: true,
          };
          return g.__myMoneyVapidKeys;
        }
      }
    } catch {
      // Try next location
    }
  }

  const generated = webpush.generateVAPIDKeys();
  let persisted = false;
  for (const filePath of candidatePaths) {
    try {
      fs.mkdirSync(path.dirname(filePath), { recursive: true });
      fs.writeFileSync(
        filePath,
        JSON.stringify(
          {
            publicKey: generated.publicKey,
            privateKey: generated.privateKey,
            createdAt: new Date().toISOString(),
          },
          null,
          2
        ),
        { encoding: 'utf8', mode: 0o600 }
      );
      persisted = true;
      break;
    } catch {
      // Try next location
    }
  }

  g.__myMoneyVapidKeys = {
    publicKey: generated.publicKey,
    privateKey: generated.privateKey,
    isPersistent: persisted,
  };
  return g.__myMoneyVapidKeys;
}

const PRODUCTION_APP_URL = 'https://mymoney.nileshbarela.site';
function sanitizePublicEmailUrl(rawUrl: string | undefined, fallbackUrl: string): string {
  const trimmed = (rawUrl || '').trim().replace(/\/+$/, '');
  if (!trimmed) return fallbackUrl;
  try {
    const parsed = new URL(trimmed);
    if (
      parsed.hostname === 'localhost' ||
      parsed.hostname === '127.0.0.1' ||
      parsed.hostname === '0.0.0.0' ||
      parsed.hostname === '::1'
    ) {
      return fallbackUrl;
    }
    return trimmed;
  } catch {
    return fallbackUrl;
  }
}

const resolvedAppBaseUrl = sanitizePublicEmailUrl(
  process.env.EMAIL_BASE_URL || process.env.APP_BASE_URL || process.env.APP_URL,
  PRODUCTION_APP_URL
);

/**
 * Centralized Application, Branding, and Support Configuration
 */
export const APP_CONFIG = {
  appName: process.env.APP_NAME || 'My Money Manager',
  appTagline: process.env.APP_TAGLINE || 'Personal Finance, Simplified.',
  companyName: process.env.COMPANY_NAME || 'HackifyPro',
  companyTagline: process.env.COMPANY_TAGLINE || 'Building smarter digital experiences.',
  supportEmail: process.env.SUPPORT_EMAIL || 'hackifypro@gmail.com',
  supportPhone: process.env.SUPPORT_PHONE || '+91 74149 35405',
  supportPhoneRaw: '+917414935405',
  supportWhatsAppUrl:
    'https://wa.me/917414935405?text=Hello%20HackifyPro%20Support%20Team%2C%0A%0AI%20need%20assistance%20regarding%20My%20Money%20Manager%20app.%20I%20have%20a%20query%20and%20would%20like%20some%20help.%0A%0APlease%20guide%20me%20regarding%20my%20issue.%0A%0AThank%20you.',
  appBaseUrl: resolvedAppBaseUrl,
  appLoginUrl: sanitizePublicEmailUrl(process.env.APP_LOGIN_URL, `${resolvedAppBaseUrl}/#login`),
  appLogoUrl: sanitizePublicEmailUrl(process.env.APP_LOGO_URL, `${resolvedAppBaseUrl}/logo.jpg`),
  footerCopyright: `© ${new Date().getFullYear()} My Money Manager · Powered by HackifyPro`,
  
  // SMTP Configuration
  smtp: {
    host: process.env.SMTP_HOST || 'smtp.gmail.com',
    port: parseInt(process.env.SMTP_PORT || '465', 10),
    secure: (process.env.SMTP_PORT || '465') === '465',
    user: process.env.SMTP_USER || 'hackifypro@gmail.com',
    pass: process.env.SMTP_PASS || '',
    from: process.env.SMTP_FROM || '"My Money Manager" <hackifypro@gmail.com>',
  },

  // Web Push VAPID Configuration (validated env keys or runtime-generated ephemeral keypair)
  vapid: (() => {
    const keys = resolveVapidKeys();
    return {
      publicKey: keys.publicKey,
      privateKey: keys.privateKey,
      isPersistent: keys.isPersistent,
      subject: process.env.VAPID_SUBJECT || 'mailto:hackifypro@gmail.com',
    };
  })(),
} as const;

export type AppConfig = typeof APP_CONFIG;
