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
} catch (e) {
  console.warn('Notice loading .env in email.ts:', e);
}

const transporter = nodemailer.createTransport({
  host: process.env.SMTP_HOST || 'smtp.gmail.com',
  port: parseInt(process.env.SMTP_PORT || '465'),
  secure: true,
  auth: {
    user: process.env.SMTP_USER || 'hackifypro@gmail.com',
    pass: process.env.SMTP_PASS || '',
  },
});

const FROM_HEADER = process.env.SMTP_FROM || '"My Money Manager Security" <hackifypro@gmail.com>';
const APP_NAME = 'My Money Manager by HackifyPro';

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
}

export async function sendEmail(opts: EmailOptions): Promise<boolean> {
  try {
    const info = await transporter.sendMail({
      from: FROM_HEADER,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
    });
    console.log(`[Email Sent] MessageId: ${info.messageId} to ${opts.to} - Subject: "${opts.subject}"`);
    return true;
  } catch (err: any) {
    console.error(`[Email Failed] To: ${opts.to} - Error:`, err.message);
    return false;
  }
}

// 1. Password Reset Email
export async function sendPasswordResetEmail(email: string, name: string, resetLink: string): Promise<boolean> {
  const subject = `[Action Required] Reset Your Password - ${APP_NAME}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px; margin: 0; }
        .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: #0f172a; padding: 24px; text-align: center; }
        .header h1 { color: #ffffff; font-size: 20px; margin: 0; font-weight: 800; }
        .header p { color: #10b981; font-size: 12px; margin: 4px 0 0; font-weight: 700; }
        .content { padding: 32px 28px; }
        .btn { display: inline-block; background-color: #059669; color: #ffffff !important; font-weight: 700; font-size: 14px; padding: 12px 28px; text-decoration: none; border-radius: 10px; margin: 20px 0; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.25); }
        .alert { background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 12px 16px; font-size: 12px; color: #991b1b; margin-top: 20px; }
        .footer { background: #f1f5f9; padding: 16px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
        .url-box { background: #f8fafc; border: 1px dashed #cbd5e1; padding: 10px; border-radius: 8px; font-size: 11px; color: #475569; word-break: break-all; margin-top: 12px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>My Money Manager</h1>
          <p>by HackifyPro · Security Dispatch</p>
        </div>
        <div class="content">
          <p style="font-size: 15px; font-weight: 600; color: #0f172a;">Hello ${name || 'User'},</p>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            We received a request to reset the password for your account (<strong>${email}</strong>).
          </p>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            Click the secure button below to set your new password. This single-use link is valid for <strong>15 minutes</strong>.
          </p>
          <div style="text-align: center;">
            <a href="${resetLink}" class="btn" target="_blank">Reset Password Now</a>
          </div>
          <p style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Or copy and paste this link into your browser:</p>
          <div class="url-box">${resetLink}</div>
          <div class="alert">
            <strong>Security Notice:</strong> If you did not request a password reset, please ignore this email or notify security immediately. Your current password remains secure.
          </div>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} My Money Manager by HackifyPro. Enterprise Security Architecture.
        </div>
      </div>
    </body>
    </html>
  `;
  const text = `Hello ${name || 'User'},\n\nWe received a request to reset your password for My Money Manager (${email}).\n\nReset your password using this link (expires in 15 minutes):\n${resetLink}\n\nIf you did not request this, please ignore this email.\n\nMy Money Manager Security Team`;
  return sendEmail({ to: email, subject, html, text });
}

// 2. Password Changed Security Notification
export async function sendPasswordChangedEmail(email: string, name: string, ipAddress?: string): Promise<boolean> {
  const subject = `[Security Alert] Your Password Was Successfully Changed - ${APP_NAME}`;
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px; margin: 0; }
        .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: #0f172a; padding: 24px; text-align: center; }
        .header h1 { color: #ffffff; font-size: 20px; margin: 0; font-weight: 800; }
        .content { padding: 32px 28px; }
        .info-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px 16px; margin: 16px 0; font-size: 13px; color: #166534; }
        .footer { background: #f1f5f9; padding: 16px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>My Money Manager</h1>
        </div>
        <div class="content">
          <p style="font-size: 15px; font-weight: 600;">Hello ${name || 'User'},</p>
          <div class="info-box">
            <strong>✓ Password Updated Successfully</strong><br/>
            Your account password was updated on <strong>${now} IST</strong>${ipAddress ? ` from IP <code>${ipAddress}</code>` : ''}.
          </div>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            All previous active sessions on other devices have been securely invalidated to protect your account.
          </p>
          <p style="font-size: 13px; line-height: 1.6; color: #b91c1c; font-weight: 600;">
            If you did not make this change, please contact HackifyPro Support immediately at support@hackifypro.com.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} My Money Manager by HackifyPro.
        </div>
      </div>
    </body>
    </html>
  `;
  const text = `Hello ${name || 'User'},\n\nYour account password for My Money Manager (${email}) was updated on ${now} IST.\n\nIf you did not perform this action, please contact support immediately.\n\nMy Money Manager Security`;
  return sendEmail({ to: email, subject, html, text });
}

// 3. Welcome / Registration Email
export async function sendWelcomeEmail(email: string, name: string): Promise<boolean> {
  const subject = `Welcome to ${APP_NAME}! Your Account is Active`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px; margin: 0; }
        .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: #059669; padding: 28px 24px; text-align: center; }
        .header h1 { color: #ffffff; font-size: 22px; margin: 0; font-weight: 800; }
        .content { padding: 32px 28px; }
        .footer { background: #f1f5f9; padding: 16px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>Welcome to My Money Manager</h1>
        </div>
        <div class="content">
          <p style="font-size: 15px; font-weight: 600;">Welcome, ${name}!</p>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            Your account has been created with enterprise-grade security, client-side session protection, and strict multi-tenant privacy.
          </p>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            Registered Email: <strong>${email}</strong>
          </p>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            You can now track daily personal expenses, room rent & groceries, people udhar balances, and financial reports securely.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} My Money Manager by HackifyPro.
        </div>
      </div>
    </body>
    </html>
  `;
  const text = `Welcome ${name}!\n\nYour account for My Money Manager has been successfully registered (${email}).\n\nStart managing your personal expenses securely.\n\nMy Money Manager`;
  return sendEmail({ to: email, subject, html, text });
}

// 4. Account Status Alert Email
export async function sendAccountStatusEmail(email: string, name: string, newStatus: string): Promise<boolean> {
  const subject = `[Account Update] Account Status Changed to ${newStatus.toUpperCase()} - ${APP_NAME}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: sans-serif; background: #f8fafc; padding: 20px;">
      <div style="max-width: 500px; margin: auto; background: white; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0;">
        <h2>Account Status Notice</h2>
        <p>Hello ${name || 'User'},</p>
        <p>Your My Money Manager account (<strong>${email}</strong>) status has been updated to: <strong style="text-transform: uppercase;">${newStatus}</strong> by an administrator.</p>
        ${newStatus === 'suspended' ? '<p style="color: red;">Your active sessions have been revoked. If you believe this is an error, please reach out to administrator support.</p>' : '<p style="color: green;">Your account is in good standing and ready for use.</p>'}
      </div>
    </body>
    </html>
  `;
  const text = `Hello ${name},\n\nYour account status has been changed to: ${newStatus}.\n\nMy Money Manager`;
  return sendEmail({ to: email, subject, html, text });
}
