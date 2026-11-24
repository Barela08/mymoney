import nodemailer from 'nodemailer';
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
} catch {}

const SMTP_CONFIG = {
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: Number(process.env.SMTP_PORT) || 465,
  secure: true,
  auth: {
    user: process.env.SMTP_USER || 'hackifypro@gmail.com',
    pass: process.env.SMTP_PASS || '',
  },
};

export async function sendPasswordResetEmail(payload: {
  email: string;
  name?: string;
  otp: string;
  resetLink: string;
}) {
  const { email, name, otp, resetLink } = payload;
  const transporter = nodemailer.createTransport(SMTP_CONFIG);

  const htmlContent = `
    <!DOCTYPE html>
    <html>
      <head>
        <meta charset="utf-8" />
        <title>Password Reset - My Money Manager</title>
      </head>
      <body style="margin: 0; padding: 0; background-color: #0f172a; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #f8fafc;">
        <table width="100%" cellpadding="0" cellspacing="0" style="padding: 40px 10px;">
          <tr>
            <td align="center">
              <table width="100%" style="max-width: 520px; background-color: #1e293b; border-radius: 20px; border: 1px solid #334155; overflow: hidden; box-shadow: 0 20px 25px -5px rgba(0, 0, 0, 0.5);">
                <!-- Header -->
                <tr>
                  <td style="background: linear-gradient(135deg, #059669 0%, #0d9488 100%); padding: 28px 24px; text-align: center;">
                    <h1 style="margin: 0; color: #ffffff; font-size: 22px; font-weight: 900; letter-spacing: -0.5px;">
                      My Money Manager
                    </h1>
                    <p style="margin: 6px 0 0 0; color: #d1fae5; font-size: 13px; font-weight: 600;">
                      by HackifyPro • Secure Password Recovery
                    </p>
                  </td>
                </tr>

                <!-- Content Body -->
                <tr>
                  <td style="padding: 32px 28px;">
                    <p style="margin: 0 0 16px 0; font-size: 15px; color: #e2e8f0;">
                      Hello ${name || 'User'},
                    </p>
                    <p style="margin: 0 0 24px 0; font-size: 14px; color: #94a3b8; line-height: 1.6;">
                      We received a request to reset your password for your <b>My Money Manager</b> account (${email}). Use the secure 6-digit OTP below or click the reset button.
                    </p>

                    <!-- OTP Box -->
                    <div style="background-color: #0f172a; border: 2px dashed #10b981; border-radius: 14px; padding: 18px; text-align: center; margin-bottom: 24px;">
                      <span style="display: block; font-size: 11px; text-transform: uppercase; letter-spacing: 1.5px; color: #10b981; font-weight: 800; margin-bottom: 6px;">
                        Your One-Time Password (OTP)
                      </span>
                      <span style="font-size: 32px; font-weight: 900; letter-spacing: 6px; color: #ffffff; font-family: monospace;">
                        ${otp}
                      </span>
                      <span style="display: block; font-size: 11px; color: #64748b; margin-top: 6px;">
                        Valid for 15 minutes. Do not share this OTP with anyone.
                      </span>
                    </div>

                    <!-- 1-Click Button -->
                    <div style="text-align: center; margin-bottom: 24px;">
                      <a href="${resetLink}" style="display: inline-block; background-color: #059669; color: #ffffff; font-size: 14px; font-weight: 700; text-decoration: none; padding: 12px 28px; border-radius: 12px; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.4);">
                        Reset Password Directly &rarr;
                      </a>
                    </div>

                    <p style="margin: 0; font-size: 12px; color: #64748b; line-height: 1.5;">
                      If you did not request this password reset, please ignore this email or contact support immediately. Your account remains completely secure.
                    </p>
                  </td>
                </tr>

                <!-- Footer & Support Info -->
                <tr>
                  <td style="padding: 20px 28px; background-color: #0f172a; border-top: 1px solid #334155; text-align: center; font-size: 11px; color: #64748b;">
                    <p style="margin: 0 0 4px 0;">
                      <b>Need Assistance?</b> Contact HackifyPro Support
                    </p>
                    <p style="margin: 0;">
                      WhatsApp / Phone: <a href="https://wa.me/917414935405?text=Hello%20HackifyPro%20Support%20Team%2C%0A%0AI%20need%20assistance%20regarding%20My%20Money%20Manager%20app.%20I%20have%20a%20query%20and%20would%20like%20some%20help.%0A%0APlease%20guide%20me%20regarding%20my%20issue.%0A%0AThank%20you." style="color: #10b981; text-decoration: none; font-weight: 600;">+91 74149 35405</a> • Email: <a href="mailto:hackifypro@gmail.com?subject=My%20Money%20Manager%20%E2%80%93%20Support%20Request" style="color: #10b981; text-decoration: none;">hackifypro@gmail.com</a>
                    </p>
                    <p style="margin: 8px 0 0 0; font-size: 10px; color: #475569;">
                      Compliant with Digital Personal Data Protection (DPDP) Act, 2023.
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>
        </table>
      </body>
    </html>
  `;

  return transporter.sendMail({
    from: '"My Money Manager" <hackifypro@gmail.com>',
    to: email,
    subject: 'Reset Your My Money Manager Password',
    text: `Hello ${name || 'User'},\n\nWe received a request to reset your password for My Money Manager (${email}).\n\nYour 6-digit OTP is: ${otp}\nDirect reset link: ${resetLink}\n\nThis link is valid for 15 minutes. If you did not request this, please ignore this email.\n\nMy Money Manager Security Team`,
    html: htmlContent,
  });
}

// Handler for Vercel / Node serverless function
export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'Method not allowed' });
  }

  try {
    const { email, name, otp, resetLink } = req.body || {};
    if (!email || !otp) {
      return res.status(400).json({ error: 'Email and OTP are required' });
    }

    const info = await sendPasswordResetEmail({ email, name, otp, resetLink });
    return res.status(200).json({ success: true, messageId: info.messageId });
  } catch (error: any) {
    console.error('Email dispatch error:', error);
    return res.status(500).json({ error: error.message || 'Failed to dispatch email' });
  }
}
