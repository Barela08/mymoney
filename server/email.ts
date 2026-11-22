import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { APP_CONFIG } from './config';
import { query } from './db';
import { logSecurityEvent } from './security';
import { generateWelcomeEmail } from './welcomeEmailTemplate';
import {
  generateFeedbackReceivedEmail,
  generateComplaintReceivedEmail,
  generateSupportTicketReceivedEmail,
  generateAdminReplyEmail,
} from './supportEmailTemplates';

const transporter = nodemailer.createTransport({
  host: APP_CONFIG.smtp.host,
  port: APP_CONFIG.smtp.port,
  secure: APP_CONFIG.smtp.secure,
  auth: {
    user: APP_CONFIG.smtp.user,
    pass: APP_CONFIG.smtp.pass,
  },
});

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: any[];
}

/**
 * Sanitizes error messages to prevent leaking SMTP credentials or internal network info
 */
function sanitizeErrorMessage(err: any): string {
  if (!err) return 'Unknown error';
  const msg = typeof err === 'string' ? err : err.message || JSON.stringify(err);
  return msg
    .replace(/[a-zA-Z0-9_\-\.]+@[a-zA-Z0-9_\-\.]+\.[a-zA-Z0-9_\-]+:[^\s@]+/g, '[REDACTED_CREDENTIALS]')
    .replace(/pass(word)?\s*=\s*[^\s&]+/gi, 'password=[REDACTED]')
    .slice(0, 500);
}

/**
 * Low-level email sender via Nodemailer
 */
export async function sendEmail(opts: EmailOptions): Promise<boolean> {
  try {
    const info = await transporter.sendMail({
      from: APP_CONFIG.smtp.from,
      to: opts.to,
      subject: opts.subject,
      html: opts.html,
      text: opts.text,
      attachments: opts.attachments,
    });
    console.log(`[Email Sent] MessageId: ${info.messageId} to ${opts.to} - Subject: "${opts.subject}"`);
    return true;
  } catch (err: any) {
    console.error(`[Email Failed] To: ${opts.to} - Error:`, sanitizeErrorMessage(err));
    return false;
  }
}

// -------------------------------------------------------------
// 1. Password Reset Email
// -------------------------------------------------------------
export async function sendPasswordResetEmail(email: string, name: string, resetLink: string): Promise<boolean> {
  const subject = `[Action Required] Reset Your Password - ${APP_CONFIG.appName}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px; margin: 0; }
        .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: #065f46; padding: 24px; text-align: center; }
        .header h1 { color: #ffffff; font-size: 20px; margin: 0; font-weight: 800; }
        .header p { color: #a7f3d0; font-size: 12px; margin: 4px 0 0; font-weight: 600; }
        .content { padding: 32px 28px; }
        .btn { display: inline-block; background-color: #047857; color: #ffffff !important; font-weight: 700; font-size: 14px; padding: 12px 28px; text-decoration: none; border-radius: 10px; margin: 20px 0; }
        .alert { background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 12px 16px; font-size: 12px; color: #991b1b; margin-top: 20px; }
        .footer { background: #f1f5f9; padding: 16px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
        .url-box { background: #f8fafc; border: 1px dashed #cbd5e1; padding: 10px; border-radius: 8px; font-size: 11px; color: #475569; word-break: break-all; margin-top: 12px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>${APP_CONFIG.appName}</h1>
          <p>by ${APP_CONFIG.companyName} · Security Dispatch</p>
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
            <strong>Security Notice:</strong> If you did not request a password reset, please ignore this email. Your current password remains secure.
          </div>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} ${APP_CONFIG.appName} · Powered by ${APP_CONFIG.companyName}.
        </div>
      </div>
    </body>
    </html>
  `;
  const text = `Hello ${name || 'User'},\n\nWe received a request to reset your password for ${APP_CONFIG.appName} (${email}).\n\nReset your password using this link (expires in 15 minutes):\n${resetLink}\n\nIf you did not request this, please ignore this email.\n\n${APP_CONFIG.appName} Security Team`;
  return sendEmail({ to: email, subject, html, text });
}

// -------------------------------------------------------------
// 2. Password Changed Security Notification
// -------------------------------------------------------------
export async function sendPasswordChangedEmail(email: string, name: string, ipAddress?: string): Promise<boolean> {
  const subject = `[Security Alert] Your Password Was Successfully Changed - ${APP_CONFIG.appName}`;
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px; margin: 0; }
        .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; }
        .header { background: #065f46; padding: 24px; text-align: center; }
        .header h1 { color: #ffffff; font-size: 20px; margin: 0; font-weight: 800; }
        .content { padding: 32px 28px; }
        .info-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px 16px; margin: 16px 0; font-size: 13px; color: #166534; }
        .footer { background: #f1f5f9; padding: 16px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>${APP_CONFIG.appName}</h1>
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
            If you did not make this change, please contact ${APP_CONFIG.companyName} Support immediately at ${APP_CONFIG.supportEmail}.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} ${APP_CONFIG.appName} · Powered by ${APP_CONFIG.companyName}.
        </div>
      </div>
    </body>
    </html>
  `;
  const text = `Hello ${name || 'User'},\n\nYour account password for ${APP_CONFIG.appName} (${email}) was updated on ${now} IST.\n\nIf you did not perform this action, please contact support immediately.\n\n${APP_CONFIG.appName} Security`;
  return sendEmail({ to: email, subject, html, text });
}

// -------------------------------------------------------------
// 3. PREMIUM WELCOME EMAIL AUTOMATION & IDEMPOTENCY
// -------------------------------------------------------------

export interface WelcomeEmailResult {
  success: boolean;
  status: 'sent' | 'pending' | 'retrying' | 'failed' | 'skipped_duplicate';
  logId?: string;
  attempts?: number;
  message?: string;
  error?: string;
}

/**
 * Dispatches an email with background retry capability
 */
async function executeEmailDispatch(
  logId: string,
  email: string,
  subject: string,
  html: string,
  text: string,
  attachments: any[],
  currentAttempt: number,
  maxAttempts: number = 3,
  userId?: string
): Promise<boolean> {
  try {
    const success = await sendEmail({
      to: email,
      subject,
      html,
      text,
      attachments,
    });

    if (success) {
      // Update delivery record: SENT
      try {
        await query(
          `UPDATE public.email_dispatch_logs 
           SET status = 'sent', attempts = $1, sent_at = NOW(), last_error = NULL, updated_at = NOW() 
           WHERE id = $2`,
          [currentAttempt, logId]
        );
      } catch (dbErr) {
        console.warn('[Welcome Email DB Update Warn]:', dbErr);
      }

      await logSecurityEvent('WELCOME_EMAIL_DELIVERED', {
        userId,
        userEmail: email,
        details: { logId, attempts: currentAttempt },
      }).catch(() => {});

      return true;
    } else {
      throw new Error('SMTP transport returned false');
    }
  } catch (err: any) {
    const safeErr = sanitizeErrorMessage(err);
    const isFinalAttempt = currentAttempt >= maxAttempts;
    const nextStatus = isFinalAttempt ? 'failed' : 'retrying';

    try {
      await query(
        `UPDATE public.email_dispatch_logs 
         SET status = $1, attempts = $2, last_error = $3, updated_at = NOW() 
         WHERE id = $4`,
        [nextStatus, currentAttempt, safeErr, logId]
      );
    } catch (dbErr) {
      console.warn('[Welcome Email DB Error Warn]:', dbErr);
    }

    if (isFinalAttempt) {
      console.error(`[Welcome Email Failed Permanently] Recipient: ${email}, attempts: ${currentAttempt}, error: ${safeErr}`);
      await logSecurityEvent('WELCOME_EMAIL_FAILED_PERMANENTLY', {
        userId,
        userEmail: email,
        details: { logId, attempts: currentAttempt, error: safeErr },
      }).catch(() => {});
      return false;
    } else {
      // Schedule exponential/backoff retry safely in the background
      const backoffMs = Math.min(1000 * Math.pow(2, currentAttempt), 30000); // 2s, 4s, etc.
      console.warn(`[Welcome Email Scheduling Retry] Recipient: ${email}, next attempt: ${currentAttempt + 1} in ${backoffMs}ms`);
      
      setTimeout(() => {
        executeEmailDispatch(
          logId,
          email,
          subject,
          html,
          text,
          attachments,
          currentAttempt + 1,
          maxAttempts,
          userId
        ).catch((retryErr) => {
          console.error('[Welcome Email Background Retry Uncaught]:', sanitizeErrorMessage(retryErr));
        });
      }, backoffMs);

      return false;
    }
  }
}

/**
 * Triggers the automated Welcome Email for a newly registered user.
 * 
 * Guarantees:
 * 1. Fetches the trusted registered name from public.app_users (never trusts client blindly).
 * 2. Strict idempotency via unique key (prevents duplicate emails from multiple triggers/retries).
 * 3. Never blocks account creation (runs safely, returns structured result).
 * 4. Records delivery status ('pending', 'sent', 'retrying', 'failed') in public.email_dispatch_logs.
 * 5. Embeds official logo.jpg from project via CID attachment and supports configured external logo.
 * 6. Includes plain-text fallback.
 */
export async function sendWelcomeEmail(
  email: string,
  providedName?: string,
  userId?: string,
  forceResend: boolean = false
): Promise<WelcomeEmailResult> {
  const normalizedEmail = (email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    return { success: false, status: 'failed', message: 'Invalid recipient email address' };
  }

  try {
    // 1. Fetch user's name directly from trusted backend database record
    let trustedName = (providedName || '').trim();
    let resolvedUserId = userId;

    try {
      if (resolvedUserId) {
        const uRes = await query('SELECT id, full_name, email FROM public.app_users WHERE id = $1', [resolvedUserId]);
        if (uRes.rows.length > 0) {
          trustedName = uRes.rows[0].full_name || trustedName;
        }
      } else {
        const uRes = await query('SELECT id, full_name, email FROM public.app_users WHERE LOWER(email) = $1', [normalizedEmail]);
        if (uRes.rows.length > 0) {
          trustedName = uRes.rows[0].full_name || trustedName;
          resolvedUserId = uRes.rows[0].id;
        }
      }
    } catch (dbErr) {
      console.warn('[Welcome Email DB User Fetch Warn]:', dbErr);
    }

    // 2. Idempotency Check: Prevent duplicate welcome emails
    const idempotencyKey = `welcome:${resolvedUserId || normalizedEmail}`;

    if (!forceResend) {
      try {
        const existingLog = await query(
          'SELECT id, status, attempts FROM public.email_dispatch_logs WHERE idempotency_key = $1',
          [idempotencyKey]
        );

        if (existingLog.rows.length > 0) {
          const log = existingLog.rows[0];
          if (log.status === 'sent') {
            console.log(`[Welcome Email Idempotency] Email already sent for ${normalizedEmail} (Log ID: ${log.id}). Skipping duplicate.`);
            return {
              success: true,
              status: 'skipped_duplicate',
              logId: log.id,
              attempts: log.attempts,
              message: 'Welcome email was already sent successfully.',
            };
          }
          if (log.status === 'pending' || log.status === 'retrying') {
            console.log(`[Welcome Email Idempotency] Email is currently in progress (${log.status}) for ${normalizedEmail}.`);
            return {
              success: true,
              status: log.status,
              logId: log.id,
              attempts: log.attempts,
              message: `Welcome email delivery is currently in progress (${log.status}).`,
            };
          }
        }
      } catch (logErr) {
        console.warn('[Welcome Email Idempotency Query Warn]:', logErr);
      }
    }

    // 3. Prepare Logo Attachment
    // If APP_LOGO_URL is a public web URL (starts with http and not localhost), use that.
    // Otherwise, embed the official public/logo.jpg with CID 'app_logo' for 100% email client support.
    const attachments: any[] = [];
    const logoFilePath = path.resolve(process.cwd(), 'public', 'logo.jpg');
    let logoSrc = 'cid:app_logo';

    if (APP_CONFIG.appLogoUrl && APP_CONFIG.appLogoUrl.startsWith('http') && !APP_CONFIG.appLogoUrl.includes('localhost')) {
      logoSrc = APP_CONFIG.appLogoUrl;
    } else if (fs.existsSync(logoFilePath)) {
      attachments.push({
        filename: 'logo.jpg',
        path: logoFilePath,
        cid: 'app_logo',
        contentDisposition: 'inline',
      });
      logoSrc = 'cid:app_logo';
    }

    // 4. Generate Email Content
    const emailData = generateWelcomeEmail({
      userName: trustedName,
      userEmail: normalizedEmail,
      logoSrc,
      loginUrl: APP_CONFIG.appLoginUrl,
      supportEmail: APP_CONFIG.supportEmail,
      supportPhone: APP_CONFIG.supportPhone,
    });

    // 5. Create or Update Dispatch Record in public.email_dispatch_logs
    let logId: string = '';
    try {
      const insertRes = await query(
        `INSERT INTO public.email_dispatch_logs (
          user_id, email, email_type, idempotency_key, recipient_name, subject, status, attempts, max_attempts
        ) VALUES ($1, $2, 'welcome_email', $3, $4, $5, 'pending', 0, 3)
        ON CONFLICT (idempotency_key) DO UPDATE 
        SET status = 'pending', updated_at = NOW()
        RETURNING id`,
        [resolvedUserId || null, normalizedEmail, idempotencyKey, trustedName || null, emailData.subject]
      );
      if (insertRes.rows.length > 0) {
        logId = insertRes.rows[0].id;
      }
    } catch (insertErr) {
      console.warn('[Welcome Email Log Insert Warn]:', insertErr);
      logId = `fallback_${Date.now()}`;
    }

    // 6. Execute Dispatch (Attempt 1)
    const success = await executeEmailDispatch(
      logId,
      normalizedEmail,
      emailData.subject,
      emailData.html,
      emailData.text,
      attachments,
      1,
      3,
      resolvedUserId
    );

    return {
      success,
      status: success ? 'sent' : 'retrying',
      logId,
      attempts: 1,
      message: success ? 'Welcome email delivered successfully.' : 'Welcome email queued for delivery / retry.',
    };
  } catch (err: any) {
    const safeErr = sanitizeErrorMessage(err);
    console.error(`[Welcome Email Error] Recipient: ${normalizedEmail}:`, safeErr);
    return {
      success: false,
      status: 'failed',
      message: 'Failed to initiate welcome email dispatch',
      error: safeErr,
    };
  }
}

/**
 * Retrieves delivery status for a user's welcome email
 */
export async function getWelcomeEmailDeliveryStatus(userIdOrEmail: string): Promise<any> {
  const isEmail = userIdOrEmail.includes('@');
  const sql = isEmail
    ? `SELECT id, user_id, email, email_type, idempotency_key, recipient_name, subject, status, attempts, max_attempts, last_error, sent_at, created_at, updated_at
       FROM public.email_dispatch_logs
       WHERE LOWER(email) = LOWER($1) AND email_type = 'welcome_email'
       ORDER BY created_at DESC LIMIT 1`
    : `SELECT id, user_id, email, email_type, idempotency_key, recipient_name, subject, status, attempts, max_attempts, last_error, sent_at, created_at, updated_at
       FROM public.email_dispatch_logs
       WHERE user_id = $1 AND email_type = 'welcome_email'
       ORDER BY created_at DESC LIMIT 1`;

  const res = await query(sql, [userIdOrEmail]);
  return res.rows[0] || null;
}

// -------------------------------------------------------------
// 4. Account Status Alert Email
// -------------------------------------------------------------
export async function sendAccountStatusEmail(email: string, name: string, newStatus: string): Promise<boolean> {
  const subject = `[Account Update] Account Status Changed to ${newStatus.toUpperCase()} - ${APP_CONFIG.appName}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head><meta charset="utf-8"></head>
    <body style="font-family: sans-serif; background: #f8fafc; padding: 20px;">
      <div style="max-width: 500px; margin: auto; background: white; border-radius: 12px; padding: 24px; border: 1px solid #e2e8f0;">
        <h2>Account Status Notice</h2>
        <p>Hello ${name || 'User'},</p>
        <p>Your ${APP_CONFIG.appName} account (<strong>${email}</strong>) status has been updated to: <strong style="text-transform: uppercase;">${newStatus}</strong> by an administrator.</p>
        ${newStatus === 'suspended' ? '<p style="color: red;">Your active sessions have been revoked. If you believe this is an error, please reach out to administrator support.</p>' : '<p style="color: green;">Your account is in good standing and ready for use.</p>'}
      </div>
    </body>
    </html>
  `;
  const text = `Hello ${name},\n\nYour account status has been changed to: ${newStatus}.\n\n${APP_CONFIG.appName}`;
  return sendEmail({ to: email, subject, html, text });
}

// -------------------------------------------------------------
// 5. Account Deletion Request Initiated (24-Hour Cancellation Window)
// -------------------------------------------------------------
export async function sendAccountDeletionRequestedEmail(
  email: string,
  name: string,
  scheduledForDateStr: string,
  cancelLink: string,
  submissionTimeStr: string
): Promise<boolean> {
  const subject = `[Action Required] Account Deletion Scheduled - ${APP_CONFIG.appName}`;
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px; margin: 0; }
        .card { max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: #0f172a; padding: 26px 24px; text-align: center; border-bottom: 3px solid #dc2626; }
        .header h1 { color: #ffffff; font-size: 20px; margin: 0; font-weight: 800; }
        .header p { color: #f87171; font-size: 12px; margin: 4px 0 0; font-weight: 700; text-transform: uppercase; letter-spacing: 0.5px; }
        .content { padding: 32px 28px; }
        .warning-box { background: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px; margin: 20px 0; color: #991b1b; font-size: 13px; line-height: 1.5; }
        .schedule-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 20px 0; font-size: 13px; }
        .btn { display: inline-block; background-color: #059669; color: #ffffff !important; font-weight: 700; font-size: 14px; padding: 14px 32px; text-decoration: none; border-radius: 10px; margin: 16px 0; box-shadow: 0 4px 12px rgba(5, 150, 105, 0.25); text-align: center; }
        .footer { background: #f1f5f9; padding: 20px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
        .url-box { background: #f8fafc; border: 1px dashed #cbd5e1; padding: 10px; border-radius: 8px; font-size: 11px; color: #475569; word-break: break-all; margin-top: 12px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>My Money Manager</h1>
          <p>Security & Account Protection Notice</p>
        </div>
        <div class="content">
          <p style="font-size: 15px; font-weight: 700; color: #0f172a;">Dear ${name || 'User'},</p>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            We received an explicit request to permanently delete your <strong>My Money Manager</strong> account and all associated personal financial records.
          </p>

          <div class="schedule-box">
            <div style="font-weight: 700; color: #0f172a; margin-bottom: 10px; font-size: 13px;">📅 Request Timeline:</div>
            <div style="margin-bottom: 6px; font-size: 12px;"><strong>Submission Date & Time:</strong> ${submissionTimeStr}</div>
            <div style="margin-bottom: 6px; font-size: 12px; color: #dc2626;"><strong>Scheduled Permanent Deletion:</strong> ${scheduledForDateStr}</div>
            <div style="font-size: 12px; color: #475569;"><strong>Cancellation Window:</strong> 24 Hours from request time</div>
          </div>

          <div class="warning-box">
            <strong>⚠️ What will be permanently deleted after 24 hours:</strong><br/>
            Unless cancelled, your user account, personal profile, financial records, income & expense history, room ledgers, budgets, financial goals, Udhar records, and saved contacts will be permanently purged in accordance with our Data Retention Policy.
          </div>

          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            If you changed your mind or wish to keep your account, you can cancel this request at any time within the 24-hour window by clicking the button below:
          </p>

          <div style="text-align: center; margin: 24px 0;">
            <a href="${cancelLink}" class="btn" target="_blank">Cancel Account Deletion</a>
          </div>

          <p style="font-size: 11px; color: #64748b; margin-bottom: 4px;">Or copy and paste this secure, single-use cancellation link into your browser:</p>
          <div class="url-box">${cancelLink}</div>

          <div style="margin-top: 24px; padding-top: 16px; border-top: 1px solid #e2e8f0; font-size: 12px; color: #64748b; line-height: 1.5;">
            <strong style="color: #b91c1c;">Did not initiate this request?</strong><br/>
            Please click the cancel button above immediately and change your account password. For immediate assistance, contact HackifyPro Support at <strong>hackifypro@gmail.com</strong> or phone helpline <strong>+91 74149 35405</strong>.
          </div>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} My Money Manager by HackifyPro. DPDP Act 2023 Compliant Financial Management.
        </div>
      </div>
    </body>
    </html>
  `;
  const text = `Dear ${name || 'User'},\n\nWe received a request to permanently delete your My Money Manager account (${email}).\n\nSubmitted At: ${submissionTimeStr}\nScheduled Permanent Deletion: ${scheduledForDateStr}\nCancellation Window: 24 Hours\n\nTo cancel this request and restore your account to active standing, click this secure link:\n${cancelLink}\n\nIf you did not request this, cancel immediately and contact HackifyPro Support at hackifypro@gmail.com or +91 74149 35405.\n\nMy Money Manager Security Team`;
  return sendEmail({ to: email, subject, html, text });
}

// -------------------------------------------------------------
// 6. Account Deletion Request Cancelled Confirmation
// -------------------------------------------------------------
export async function sendAccountDeletionCancelledEmail(email: string, name: string): Promise<boolean> {
  const subject = `[Confirmed] Account Deletion Cancelled - ${APP_CONFIG.appName}`;
  const now = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' });
  const html = `
    <!DOCTYPE html>
    <html>
    <head>
      <meta charset="utf-8">
      <style>
        body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; color: #1e293b; padding: 24px; margin: 0; }
        .card { max-width: 540px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
        .header { background: #059669; padding: 24px; text-align: center; }
        .header h1 { color: #ffffff; font-size: 20px; margin: 0; font-weight: 800; }
        .content { padding: 32px 28px; }
        .success-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 10px; padding: 14px 16px; margin: 16px 0; font-size: 13px; color: #166534; }
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
          <div class="success-box">
            <strong>✓ Account Deletion Request Cancelled</strong><br/>
            Your pending account deletion request was successfully cancelled on <strong>${now} IST</strong>.
          </div>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            Your My Money Manager account has been restored to normal active status. Your transactions, budgets, Udhar records, and saved people contacts remain intact and safe.
          </p>
          <p style="font-size: 12px; color: #64748b;">
            If you did not perform this cancellation, please contact HackifyPro Support immediately at hackifypro@gmail.com or phone helpline +91 74149 35405.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} My Money Manager by HackifyPro.
        </div>
      </div>
    </body>
    </html>
  `;
  const text = `Hello ${name || 'User'},\n\nYour account deletion request for My Money Manager (${email}) was cancelled on ${now} IST. Your account is active and your data has been preserved.\n\nMy Money Manager Security`;
  return sendEmail({ to: email, subject, html, text });
}

// -------------------------------------------------------------
// 7. Account Deletion Execution Completed Notice
// -------------------------------------------------------------
export async function sendAccountDeletionCompletedEmail(email: string, name: string): Promise<boolean> {
  const subject = `[Completed] Account and Data Deletion Processed - ${APP_CONFIG.appName}`;
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
        .info-box { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px 16px; margin: 16px 0; font-size: 13px; color: #334155; }
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
            <strong>Permanent Account Deletion Completed</strong><br/>
            In accordance with your request, your My Money Manager account (<strong>${email}</strong>) and associated personal financial data were permanently purged on <strong>${now} IST</strong>.
          </div>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            All active sessions and authentication access have been revoked. Any legally mandated security audit logs are retained in accordance with our Data Retention Policy and applicable law.
          </p>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            Thank you for having used My Money Manager by HackifyPro.
          </p>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} My Money Manager by HackifyPro.
        </div>
      </div>
    </body>
    </html>
  `;
  const text = `Hello ${name || 'User'},\n\nYour account and associated personal financial data for My Money Manager (${email}) have been permanently deleted on ${now} IST as requested.\n\nThank you for using My Money Manager.\n\nHackifyPro Team`;
  return sendEmail({ to: email, subject, html, text });
}

// -------------------------------------------------------------
// 10. FEEDBACK, COMPLAINT & SUPPORT DISPATCH HELPERS
// -------------------------------------------------------------

function getBrandLogoAttachments(): any[] {
  const attachments: any[] = [];
  const logoPath = path.resolve(process.cwd(), 'public', 'logo.jpg');
  if (fs.existsSync(logoPath)) {
    attachments.push({
      filename: 'logo.jpg',
      path: logoPath,
      cid: 'app_logo',
      contentDisposition: 'inline',
    });
  }
  return attachments;
}

export async function sendFeedbackConfirmationEmail(opts: {
  email: string;
  userName?: string | null;
  rating?: number | null;
  category?: string;
  message: string;
}): Promise<boolean> {
  const template = generateFeedbackReceivedEmail(opts);
  return sendEmail({
    to: opts.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    attachments: getBrandLogoAttachments(),
  });
}

export async function sendComplaintConfirmationEmail(opts: {
  email: string;
  userName?: string | null;
  ticketNumber: string;
  category: string;
  subject: string;
  description: string;
}): Promise<boolean> {
  const template = generateComplaintReceivedEmail(opts);
  return sendEmail({
    to: opts.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    attachments: getBrandLogoAttachments(),
  });
}

export async function sendSupportTicketConfirmationEmail(opts: {
  email: string;
  userName?: string | null;
  ticketNumber: string;
  category: string;
  subject: string;
  description: string;
}): Promise<boolean> {
  const template = generateSupportTicketReceivedEmail(opts);
  return sendEmail({
    to: opts.email,
    subject: template.subject,
    html: template.html,
    text: template.text,
    attachments: getBrandLogoAttachments(),
  });
}

export async function sendAdminReplyToTicketEmail(opts: {
  email: string;
  userName?: string | null;
  ticketNumber: string;
  ticketType: 'complaint' | 'support' | 'feedback';
  originalSubject: string;
  adminReply: string;
  adminName?: string;
  userId?: string;
}): Promise<{ success: boolean; error?: string }> {
  try {
    // If userId supplied, verify/fetch trusted registered name from app_users
    let trustedName = opts.userName;
    if (opts.userId) {
      const u = await query('SELECT full_name FROM public.app_users WHERE id = $1', [opts.userId]);
      if (u.rows.length > 0 && u.rows[0].full_name) {
        trustedName = u.rows[0].full_name;
      }
    }

    const template = generateAdminReplyEmail({
      userName: trustedName,
      ticketNumber: opts.ticketNumber,
      ticketType: opts.ticketType,
      originalSubject: opts.originalSubject,
      adminReply: opts.adminReply,
      adminName: opts.adminName,
    });

    const success = await sendEmail({
      to: opts.email,
      subject: template.subject,
      html: template.html,
      text: template.text,
      attachments: getBrandLogoAttachments(),
    });

    return { success };
  } catch (err: any) {
    const safeMsg = sanitizeErrorMessage(err);
    console.error(`[Admin Reply Email Failed] Ticket: #${opts.ticketNumber} to ${opts.email}:`, safeMsg);
    return { success: false, error: safeMsg };
  }
}
