import fs from 'fs';
import path from 'path';

// Parse .env if not loaded
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

/**
 * Centralized Application, Branding, and Support Configuration
 */
export const APP_CONFIG = {
  appName: process.env.APP_NAME || 'My Money Manager',
  appTagline: process.env.APP_TAGLINE || 'Personal Finance, Simplified.',
  companyName: process.env.COMPANY_NAME || 'HackifyPro',
  companyTagline: process.env.COMPANY_TAGLINE || 'Building smarter digital experiences.',
  supportEmail: process.env.SUPPORT_EMAIL || 'hackifypro@gmail.com',
  supportPhone: process.env.SUPPORT_PHONE || '+91 74149 34540',
  supportPhoneRaw: (process.env.SUPPORT_PHONE || '74149345405').replace(/[^\d+]/g, ''),
  appLoginUrl: process.env.APP_LOGIN_URL || 'http://localhost:5173/#login',
  appLogoUrl: process.env.APP_LOGO_URL || '',
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
} as const;

export type AppConfig = typeof APP_CONFIG;
