import nodemailer from 'nodemailer';
import fs from 'fs';
import path from 'path';
import { APP_CONFIG } from './config.js';
import { query, isDatabaseAvailable } from './db.js';
import { logSecurityEvent } from './security.js';
import {
  recordEmailLogFallback,
  updateEmailLogFallback,
  listAllAppUsersFallback,
} from './supabaseRestFallback.js';
import {
  getEffectiveSmtpConfig,
  getEffectiveSupportAlertEmail,
} from './adminSettingsStore.js';
import { getRenderedCustomTemplateIfActive, ensureBrandedEmailHtml } from './emailTemplateService.js';
import { generateWelcomeEmail } from './welcomeEmailTemplate.js';
import {
  generateFeedbackReceivedEmail,
  generateFeedbackAdminNotificationEmail,
  generateComplaintReceivedEmail,
  generateComplaintAdminNotificationEmail,
  generateSupportTicketReceivedEmail,
  generateSupportTicketAdminNotificationEmail,
  generateAdminReplyEmail,
} from './supportEmailTemplates.js';
import {
  generateUdharCreatedEmailForInitiator,
  generateUdharCreatedEmailForRecipient,
  generateUdharSettledEmail,
  generateUdharUpdatedEmail,
} from './udharEmailTemplates.js';

async function getEmailTransporterAndConfig() {
  const cfg = await getEffectiveSmtpConfig();
  const transporter = nodemailer.createTransport({
    host: cfg.host,
    port: cfg.port,
    secure: cfg.secure,
    auth: {
      user: cfg.user,
      pass: cfg.pass,
    },
  });
  return { transporter, cfg };
}

interface EmailOptions {
  to: string;
  subject: string;
  html: string;
  text: string;
  attachments?: any[];
  emailType?: string;
  recipientName?: string;
  userId?: string;
}

/**
 * Last-mile safety replacement so system variables never leak unrendered in outgoing emails.
 */
async function sanitizeSystemVariables(input: string, recipientName?: string): Promise<string> {
  if (!input || !input.includes('{{')) return input;
  const supportEmail = await getEffectiveSupportAlertEmail().catch(() => APP_CONFIG.supportEmail);
  const nowStr = new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const replacements: Record<string, string> = {
    app_name: APP_CONFIG.appName || 'My Money Manager',
    company_name: APP_CONFIG.companyName || 'HackifyPro',
    support_email: supportEmail || APP_CONFIG.supportEmail || 'hackifypro@gmail.com',
    support_phone: APP_CONFIG.supportPhone || '+91 74149 35405',
    login_url: APP_CONFIG.appLoginUrl || APP_CONFIG.appBaseUrl || '/',
    app_url: APP_CONFIG.appBaseUrl || '/',
    action_url: APP_CONFIG.appBaseUrl || '/',
    action_text: 'Open My Money Manager',
    date: nowStr,
    submitted_at: nowStr,
    year: String(new Date().getFullYear()),
    user_name: recipientName || 'Valued User',
  };
  return input.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (full, key: string) =>
    key in replacements ? replacements[key] : full
  );
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

async function createDispatchLogRecord(params: {
  userId?: string | null;
  email: string | null;
  emailType: string;
  idempotencyKey: string;
  recipientName?: string | null;
  subject: string;
  referenceId?: string | null;
  triggerEvent: string;
  metadata?: Record<string, any>;
  status?: 'pending' | 'sent' | 'failed' | 'skipped_not_registered' | 'skipped_unverified';
  maxAttempts?: number;
  lastError?: string | null;
  upsertIdempotency?: boolean;
}): Promise<string> {
  if (isDatabaseAvailable()) {
    try {
      const conflictClause = params.upsertIdempotency
        ? `ON CONFLICT (idempotency_key) DO UPDATE SET status = EXCLUDED.status, last_error = EXCLUDED.last_error, updated_at = NOW()`
        : '';
      const res = await query(
        `INSERT INTO public.email_dispatch_logs (
          user_id, email, email_type, idempotency_key, recipient_name, subject, status, attempts, max_attempts,
          last_error, reference_id, trigger_event, metadata
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 0, $8, $9, $10, $11, $12)
        ${conflictClause}
        RETURNING id`,
        [
          params.userId || null,
          params.email,
          params.emailType,
          params.idempotencyKey,
          params.recipientName || null,
          params.subject,
          params.status || 'pending',
          params.maxAttempts ?? 3,
          params.lastError || null,
          params.referenceId || null,
          params.triggerEvent,
          JSON.stringify(params.metadata || {}),
        ]
      );
      if (res.rows[0]?.id) {
        return res.rows[0].id;
      }
    } catch (dbErr) {
      console.warn(`[Email Dispatch Log Insert Warn - ${params.emailType}]:`, sanitizeErrorMessage(dbErr));
    }
  }

  const fbRow = await recordEmailLogFallback({
    user_id: params.userId || null,
    email: params.email || '(none)',
    email_type: params.emailType,
    recipient_name: params.recipientName || '',
    subject: params.subject,
    status: params.status || 'pending',
    attempts: 0,
    last_error: params.lastError || null,
    trigger_event: params.triggerEvent,
  }).catch(() => null);

  return fbRow?.id || `fb_${params.emailType}_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

async function lookupRegisteredUser(opts: { userId?: string | null; email?: string | null }): Promise<{
  id: string;
  full_name: string;
  email: string;
} | null> {
  if (isDatabaseAvailable()) {
    try {
      if (opts.userId) {
        const uRes = await query('SELECT id, full_name, email FROM public.app_users WHERE id = $1', [opts.userId]);
        if (uRes.rows.length > 0 && uRes.rows[0].email) return uRes.rows[0];
      } else if (opts.email) {
        const uRes = await query('SELECT id, full_name, email FROM public.app_users WHERE LOWER(email) = $1', [
          opts.email.trim().toLowerCase(),
        ]);
        if (uRes.rows.length > 0 && uRes.rows[0].email) return uRes.rows[0];
      }
    } catch {
      // fall through to REST fallback
    }
  }

  try {
    const users = await listAllAppUsersFallback();
    if (opts.userId) {
      const found = users.find((u) => u.id === opts.userId && u.email);
      if (found) return { id: found.id, full_name: found.full_name || 'User', email: found.email };
    } else if (opts.email) {
      const clean = opts.email.trim().toLowerCase();
      const found = users.find((u) => String(u.email || '').trim().toLowerCase() === clean);
      if (found) return { id: found.id, full_name: found.full_name || 'User', email: found.email };
    }
  } catch {
    // ignore
  }
  return null;
}

/**
 * Low-level email sender returning full diagnostics
 */
export async function sendEmailDetailed(
  opts: EmailOptions
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const to = (opts.to || '').trim();
  if (!to || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) {
    return { success: false, error: 'Invalid recipient email address.' };
  }

  const { transporter, cfg } = await getEmailTransporterAndConfig();
  if (!cfg.enabled) {
    return { success: false, error: 'SMTP Email Dispatch is disabled in Admin Settings.' };
  }
  if (!cfg.configured) {
    return {
      success: false,
      error:
        'SMTP credentials are not configured. Set SMTP password in Admin Panel → Settings → SMTP Email Configuration (or SMTP_PASS env var).',
    };
  }

  const safeSubject = await sanitizeSystemVariables(opts.subject, opts.recipientName);
  const safeHtml = await sanitizeSystemVariables(opts.html, opts.recipientName);
  const safeText = await sanitizeSystemVariables(opts.text, opts.recipientName);

  try {
    const info = await transporter.sendMail({
      from: cfg.from,
      to,
      subject: safeSubject,
      html: safeHtml,
      text: safeText,
      attachments: opts.attachments,
    });
    console.log(`[Email Sent] MessageId: ${info.messageId} to ${to} - Subject: "${safeSubject}"`);
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    const safeErr = sanitizeErrorMessage(err);
    console.error(`[Email Failed] To: ${to} - Error:`, safeErr);
    return { success: false, error: safeErr };
  }
}

/**
 * Low-level email sender via Nodemailer
 */
export async function sendEmail(opts: EmailOptions): Promise<boolean> {
  const result = await sendEmailDetailed(opts);

  if (opts.emailType) {
    const logStatus = result.success ? 'sent' : 'failed';
    if (isDatabaseAvailable()) {
      await query(
        `INSERT INTO public.email_dispatch_logs (
          user_id, email, email_type, idempotency_key, recipient_name, subject, status, attempts, max_attempts, last_error, trigger_event, sent_at
        ) VALUES ($1, $2, $3, $4, $5, $6, $7, 1, 3, $8, $9, ${result.success ? 'NOW()' : 'NULL'})`,
        [
          opts.userId || null,
          opts.to,
          opts.emailType,
          `${opts.emailType}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
          opts.recipientName || null,
          opts.subject,
          logStatus,
          result.error || null,
          opts.emailType,
        ]
      ).catch(() => {});
    } else {
      await recordEmailLogFallback({
        user_id: opts.userId || null,
        email: opts.to,
        email_type: opts.emailType,
        recipient_name: opts.recipientName || '',
        subject: opts.subject,
        status: logStatus,
        attempts: 1,
        last_error: result.error || null,
        trigger_event: opts.emailType,
      }).catch(() => {});
    }
  }

  return result.success;
}

/**
 * Sends an admin test or retry email with real SMTP diagnostics & dispatch log recording.
 */
export async function sendAdminTestEmail(opts: {
  to: string;
  subject: string;
  html: string;
  text?: string;
  recipientName?: string;
  emailType?: string;
}): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const recipient = (opts.to || '').trim();
  const emailType = opts.emailType || 'admin_test';
  const recipientName = opts.recipientName || 'Valued User';
  const subject = await sanitizeSystemVariables(
    (opts.subject || 'Test Email from My Money Manager Admin').trim(),
    recipientName
  );
  const sanitizedHtml = await sanitizeSystemVariables(opts.html || '', recipientName);
  const brandedHtml = ensureBrandedEmailHtml(sanitizedHtml, {
    title: subject,
  });
  const sanitizedText = await sanitizeSystemVariables(
    opts.text || 'This is a live transmission from My Money Manager by HackifyPro.',
    recipientName
  );

  if (!recipient || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(recipient)) {
    return { success: false, error: 'Please enter a valid recipient email address.' };
  }

  const recordLog = async (status: 'sent' | 'failed', lastError: string | null) => {
    if (isDatabaseAvailable()) {
      try {
        await query(
          `INSERT INTO public.email_dispatch_logs (
            email, email_type, idempotency_key, recipient_name, subject, status, attempts, max_attempts, last_error, trigger_event, sent_at
          ) VALUES ($1, $2, $3, $4, $5, $6, 1, 3, $7, $8, ${status === 'sent' ? 'NOW()' : 'NULL'})`,
          [
            recipient,
            emailType,
            `${emailType}:${Date.now()}:${Math.random().toString(36).slice(2, 8)}`,
            recipientName,
            subject,
            status,
            lastError,
            emailType,
          ]
        );
      } catch {
        // Record in fallback store below
      }
    }
    await recordEmailLogFallback({
      email: recipient,
      email_type: emailType,
      recipient_name: recipientName,
      subject,
      status,
      attempts: 1,
      last_error: lastError,
      trigger_event: emailType,
    }).catch(() => {});
  };

  const { transporter, cfg } = await getEmailTransporterAndConfig();
  if (!cfg.enabled) {
    const errMsg = 'SMTP email dispatch is currently disabled in Admin Settings.';
    await recordLog('failed', errMsg);
    return { success: false, error: errMsg };
  }
  if (!cfg.configured) {
    const errMsg =
      'SMTP password is not configured on the server. Enter your Gmail App Password / SMTP credentials in Admin Panel → Settings → SMTP Email Configuration (or set SMTP_USER & SMTP_PASS environment variables).';
    await recordLog('failed', errMsg);
    return { success: false, error: errMsg };
  }

  try {
    const info = await transporter.sendMail({
      from: cfg.from,
      to: recipient,
      subject,
      html: brandedHtml,
      text: sanitizedText,
    });
    await recordLog('sent', null);
    console.log(`[Admin Email Sent] MessageId: ${info.messageId} to ${recipient}`);
    return { success: true, messageId: info.messageId };
  } catch (err: any) {
    const safeErr = sanitizeErrorMessage(err);
    await recordLog('failed', safeErr);
    console.error(`[Admin Email Failed] To: ${recipient} - Error:`, safeErr);
    return { success: false, error: safeErr };
  }
}

// -------------------------------------------------------------
// 1. Password Reset Email
// -------------------------------------------------------------
export async function sendPasswordResetEmail(email: string, name: string, resetLink: string): Promise<boolean> {
  const subject = 'Reset Your My Money Manager Password';
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
  const custom = await getRenderedCustomTemplateIfActive('password-reset', {
    user_name: name || 'User',
    user_email: email,
    reset_link: resetLink,
  });
  return sendEmail({
    to: email,
    subject: custom?.subject || subject,
    html: custom?.html || html,
    text: custom?.text || text,
    emailType: 'password_reset',
    recipientName: name || 'User',
  });
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
  const custom = await getRenderedCustomTemplateIfActive('password-changed', {
    user_name: name || 'User',
    user_email: email,
    date: `${now} IST`,
    ip_address: ipAddress || 'Unknown',
  });
  return sendEmail({
    to: email,
    subject: custom?.subject || subject,
    html: custom?.html || html,
    text: custom?.text || text,
    emailType: 'password_changed',
    recipientName: name || 'User',
  });
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
    const res = await sendEmailDetailed({
      to: email,
      subject,
      html,
      text,
      attachments,
    });

    if (res.success) {
      if (isDatabaseAvailable()) {
        try {
          await query(
            `UPDATE public.email_dispatch_logs 
             SET status = 'sent', attempts = $1, sent_at = NOW(), last_error = NULL, updated_at = NOW() 
             WHERE id = $2`,
            [currentAttempt, logId]
          );
        } catch (dbErr) {
          console.warn('[Email Dispatch DB Update Warn]:', dbErr);
        }
      }
      await updateEmailLogFallback(logId, {
        status: 'sent',
        attempts: currentAttempt,
        sent_at: new Date().toISOString(),
        last_error: null,
      }).catch(() => {});

      await logSecurityEvent('EMAIL_DELIVERED', {
        userId,
        userEmail: email,
        details: { logId, subject, attempts: currentAttempt },
      }).catch(() => {});

      return true;
    } else {
      throw new Error(res.error || 'SMTP transport failed');
    }
  } catch (err: any) {
    const safeErr = sanitizeErrorMessage(err);
    const isFinalAttempt = currentAttempt >= maxAttempts || safeErr.includes('not configured') || safeErr.includes('disabled');
    const nextStatus = isFinalAttempt ? 'failed' : 'retrying';

    if (isDatabaseAvailable()) {
      try {
        await query(
          `UPDATE public.email_dispatch_logs 
           SET status = $1, attempts = $2, last_error = $3, updated_at = NOW() 
           WHERE id = $4`,
          [nextStatus, currentAttempt, safeErr, logId]
        );
      } catch (dbErr) {
        console.warn('[Email Dispatch DB Error Warn]:', dbErr);
      }
    }
    await updateEmailLogFallback(logId, {
      status: nextStatus,
      attempts: currentAttempt,
      last_error: safeErr,
    }).catch(() => {});

    if (isFinalAttempt) {
      console.error(`[Email Failed Permanently] Recipient: ${email}, attempts: ${currentAttempt}, error: ${safeErr}`);
      await logSecurityEvent('EMAIL_FAILED_PERMANENTLY', {
        userId,
        userEmail: email,
        details: { logId, subject, attempts: currentAttempt, error: safeErr },
      }).catch(() => {});
      return false;
    } else {
      const backoffMs = Math.min(1000 * Math.pow(2, currentAttempt), 30000);
      console.warn(`[Email Scheduling Retry] Recipient: ${email}, next attempt: ${currentAttempt + 1} in ${backoffMs}ms`);

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
          console.error('[Email Background Retry Uncaught]:', sanitizeErrorMessage(retryErr));
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

    const uMatch = await lookupRegisteredUser({ userId: resolvedUserId, email: normalizedEmail });
    if (uMatch) {
      trustedName = uMatch.full_name || trustedName;
      resolvedUserId = uMatch.id || resolvedUserId;
    }

    // 2. Idempotency Check: Prevent duplicate welcome emails
    const idempotencyKey = `welcome:${resolvedUserId || normalizedEmail}`;

    if (!forceResend && isDatabaseAvailable()) {
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

    // 4. Generate Email Content (respects Admin customized template if saved)
    const defaultWelcome = generateWelcomeEmail({
      userName: trustedName,
      userEmail: normalizedEmail,
      logoSrc,
      loginUrl: APP_CONFIG.appLoginUrl,
      supportEmail: APP_CONFIG.supportEmail,
      supportPhone: APP_CONFIG.supportPhone,
    });
    const customWelcome = await getRenderedCustomTemplateIfActive('welcome-email', {
      user_name: trustedName,
      user_email: normalizedEmail,
    });
    const emailData = customWelcome || defaultWelcome;

    // 5. Create or Update Dispatch Record
    const logId = await createDispatchLogRecord({
      userId: resolvedUserId || null,
      email: normalizedEmail,
      emailType: 'welcome_email',
      idempotencyKey,
      recipientName: trustedName || null,
      subject: emailData.subject,
      triggerEvent: 'user_registration',
      upsertIdempotency: true,
    });

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
  email?: string;
  userEmail?: string;
  userName?: string | null;
  rating?: number | null;
  category?: string;
  message?: string;
  feedbackMessage?: string;
}): Promise<boolean> {
  const recipient = opts.email || opts.userEmail || '';
  const template = generateFeedbackReceivedEmail(opts);
  return sendEmail({
    to: recipient,
    subject: template.subject,
    html: template.html,
    text: template.text,
    attachments: getBrandLogoAttachments(),
  });
}

export async function sendComplaintConfirmationEmail(opts: {
  email?: string;
  userEmail?: string;
  userName?: string | null;
  ticketNumber?: string;
  ticketId?: string;
  category: string;
  subject: string;
  description: string;
}): Promise<boolean> {
  const recipient = opts.email || opts.userEmail || '';
  const template = generateComplaintReceivedEmail(opts as any);
  return sendEmail({
    to: recipient,
    subject: template.subject,
    html: template.html,
    text: template.text,
    attachments: getBrandLogoAttachments(),
  });
}

export async function sendSupportTicketConfirmationEmail(opts: {
  email?: string;
  userEmail?: string;
  userName?: string | null;
  ticketNumber?: string;
  ticketId?: string;
  category: string;
  subject: string;
  description?: string;
  message?: string;
}): Promise<boolean> {
  const recipient = opts.email || opts.userEmail || '';
  const template = generateSupportTicketReceivedEmail(opts as any);
  return sendEmail({
    to: recipient,
    subject: template.subject,
    html: template.html,
    text: template.text,
    attachments: getBrandLogoAttachments(),
  });
}

export async function sendAdminReplyToTicketEmail(opts: {
  email?: string;
  userEmail?: string;
  userName?: string | null;
  ticketNumber?: string;
  ticketId?: string;
  ticketType?: 'complaint' | 'support' | 'feedback';
  originalSubject: string;
  adminReply: string;
  adminName?: string;
  userId?: string;
  status?: string;
}): Promise<{ success: boolean; error?: string }> {
  const recipient = (opts.email || opts.userEmail || '').trim();
  const ticketNum = opts.ticketNumber || opts.ticketId || 'N/A';
  try {
    let trustedName = opts.userName;
    if (opts.userId) {
      const found = await lookupRegisteredUser({ userId: opts.userId });
      if (found?.full_name) trustedName = found.full_name;
    }

    const defaultReplyTmpl = generateAdminReplyEmail({
      userName: trustedName,
      ticketNumber: ticketNum,
      ticketType: opts.ticketType || 'support',
      originalSubject: opts.originalSubject,
      adminReply: opts.adminReply,
      adminName: opts.adminName,
      status: opts.status,
    });
    const customReplyTmpl = await getRenderedCustomTemplateIfActive('admin-ticket-reply', {
      user_name: trustedName || 'Valued User',
      ticket_number: ticketNum,
      ticket_type: opts.ticketType || 'support',
      original_subject: opts.originalSubject,
      admin_reply: opts.adminReply,
      admin_name: opts.adminName || 'HackifyPro Support',
      status: opts.status || 'in_progress',
    });
    const template = customReplyTmpl || defaultReplyTmpl;

    const logId = await createDispatchLogRecord({
      userId: opts.userId || null,
      email: recipient,
      emailType: 'admin_ticket_reply',
      idempotencyKey: `admin_reply:${ticketNum}:${Date.now()}`,
      recipientName: trustedName || 'Valued User',
      subject: template.subject,
      referenceId: ticketNum,
      triggerEvent: 'admin_ticket_reply',
      metadata: { ticketNumber: ticketNum, ticketType: opts.ticketType },
    });

    const detailRes = await sendEmailDetailed({
      to: recipient,
      subject: template.subject,
      html: template.html,
      text: template.text,
      attachments: getBrandLogoAttachments(),
    });

    if (isDatabaseAvailable()) {
      await query(
        `UPDATE public.email_dispatch_logs SET status = $1, attempts = 1, last_error = $2, sent_at = ${
          detailRes.success ? 'NOW()' : 'NULL'
        }, updated_at = NOW() WHERE id = $3`,
        [detailRes.success ? 'sent' : 'failed', detailRes.error || null, logId]
      ).catch(() => {});
    }
    await updateEmailLogFallback(logId, {
      status: detailRes.success ? 'sent' : 'failed',
      attempts: 1,
      last_error: detailRes.error || null,
      sent_at: detailRes.success ? new Date().toISOString() : null,
    }).catch(() => {});

    return { success: detailRes.success, error: detailRes.error };
  } catch (err: any) {
    const safeMsg = sanitizeErrorMessage(err);
    console.error(`[Admin Reply Email Failed] Ticket: #${ticketNum} to ${recipient}:`, safeMsg);
    return { success: false, error: safeMsg };
  }
}

// -------------------------------------------------------------
// 11. AUTOMATED FEEDBACK, COMPLAINT & SUPPORT EMAILS (USER + ADMIN)
// -------------------------------------------------------------

export interface FeedbackSubmissionEmailsParams {
  feedbackId: string;
  userId?: string | null;
  userName?: string | null;
  userEmail: string;
  rating: number;
  feedbackMessage: string;
  category?: string;
  submittedAt?: string;
}

export async function sendFeedbackSubmissionEmails(opts: FeedbackSubmissionEmailsParams): Promise<{
  userEmailSent: boolean;
  adminEmailSent: boolean;
  userLogId?: string;
  adminLogId?: string;
}> {
  const normalizedUserEmail = (opts.userEmail || '').trim().toLowerCase();
  const cleanSubmittedAt = opts.submittedAt || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const trustedUserName = (opts.userName || '').trim() || 'Valued User';
  const cleanFeedbackId = opts.feedbackId || `FB-${Date.now().toString(36).toUpperCase()}`;
  const adminEmail = await getEffectiveSupportAlertEmail();

  let userEmailSent = false;
  let adminEmailSent = false;
  let userLogId = '';
  let adminLogId = '';

  // 1. Send User Confirmation Email
  if (normalizedUserEmail) {
    const defaultUserTmpl = generateFeedbackReceivedEmail({
      userName: trustedUserName,
      feedbackId: cleanFeedbackId,
      rating: opts.rating,
      category: opts.category,
      feedbackMessage: opts.feedbackMessage,
      userEmail: normalizedUserEmail,
    });
    const customUserTmpl = await getRenderedCustomTemplateIfActive('feedback-confirmation', {
      user_name: trustedUserName,
      user_email: normalizedUserEmail,
      feedback_id: cleanFeedbackId,
      rating: opts.rating,
      category: opts.category || 'General',
      message: opts.feedbackMessage,
    });
    const userTemplate = customUserTmpl || defaultUserTmpl;

    try {
      userLogId = await createDispatchLogRecord({
        userId: opts.userId || null,
        email: normalizedUserEmail,
        emailType: 'feedback_user_confirmation',
        idempotencyKey: `feedback_user:${cleanFeedbackId}`,
        recipientName: trustedUserName,
        subject: userTemplate.subject,
        referenceId: cleanFeedbackId,
        triggerEvent: 'feedback_submission',
        metadata: { feedbackId: cleanFeedbackId, rating: opts.rating, category: opts.category },
        upsertIdempotency: true,
      });

      userEmailSent = await executeEmailDispatch(
        userLogId,
        normalizedUserEmail,
        userTemplate.subject,
        userTemplate.html,
        userTemplate.text,
        getBrandLogoAttachments(),
        1,
        3,
        opts.userId || undefined
      );
    } catch (uErr: any) {
      console.error('[Feedback User Confirmation Email Error]:', sanitizeErrorMessage(uErr));
    }
  }

  // 2. Send Admin Notification Email to HackifyPro / configured support email
  const defaultAdminTmpl = generateFeedbackAdminNotificationEmail({
    userName: trustedUserName,
    userEmail: normalizedUserEmail,
    userId: opts.userId || 'N/A',
    feedbackId: cleanFeedbackId,
    rating: opts.rating,
    message: opts.feedbackMessage,
    submittedAt: cleanSubmittedAt,
  });
  const customAdminTmpl = await getRenderedCustomTemplateIfActive('feedback-admin-alert', {
    user_name: trustedUserName,
    user_email: normalizedUserEmail,
    user_id: opts.userId || 'N/A',
    feedback_id: cleanFeedbackId,
    rating: opts.rating,
    message: opts.feedbackMessage,
    submitted_at: cleanSubmittedAt,
  });
  const adminTemplate = customAdminTmpl || defaultAdminTmpl;

  try {
    adminLogId = await createDispatchLogRecord({
      userId: null,
      email: adminEmail,
      emailType: 'feedback_admin_notification',
      idempotencyKey: `feedback_admin:${cleanFeedbackId}`,
      recipientName: 'HackifyPro Admin',
      subject: adminTemplate.subject,
      referenceId: cleanFeedbackId,
      triggerEvent: 'feedback_submission',
      metadata: { feedbackId: cleanFeedbackId, rating: opts.rating, submitterEmail: normalizedUserEmail },
      upsertIdempotency: true,
    });

    adminEmailSent = await executeEmailDispatch(
      adminLogId,
      adminEmail,
      adminTemplate.subject,
      adminTemplate.html,
      adminTemplate.text,
      getBrandLogoAttachments(),
      1,
      3
    );
  } catch (aErr: any) {
    console.error('[Feedback Admin Notification Email Error]:', sanitizeErrorMessage(aErr));
  }

  return { userEmailSent, adminEmailSent, userLogId, adminLogId };
}

export async function sendComplaintSubmissionEmails(opts: {
  ticketId: string;
  ticketNumber: string;
  userId?: string | null;
  userName?: string | null;
  userEmail: string;
  userPhone?: string | null;
  category: string;
  subject: string;
  description: string;
  submittedAt?: string;
}): Promise<{ userEmailSent: boolean; adminEmailSent: boolean; userLogId?: string; adminLogId?: string }> {
  const normalizedUserEmail = (opts.userEmail || '').trim().toLowerCase();
  const cleanSubmittedAt = opts.submittedAt || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const trustedUserName = (opts.userName || '').trim() || 'Valued User';
  const adminEmail = await getEffectiveSupportAlertEmail();

  let userEmailSent = false;
  let adminEmailSent = false;
  let userLogId = '';
  let adminLogId = '';

  if (normalizedUserEmail) {
    const defaultUserTmpl = generateComplaintReceivedEmail({
      userName: trustedUserName,
      ticketNumber: opts.ticketNumber,
      category: opts.category,
      subject: opts.subject,
      description: opts.description,
    });
    const customUserTmpl = await getRenderedCustomTemplateIfActive('complaint-confirmation', {
      user_name: trustedUserName,
      user_email: normalizedUserEmail,
      ticket_number: opts.ticketNumber,
      category: opts.category,
      subject: opts.subject,
      description: opts.description,
    });
    const userTemplate = customUserTmpl || defaultUserTmpl;

    try {
      userLogId = await createDispatchLogRecord({
        userId: opts.userId || null,
        email: normalizedUserEmail,
        emailType: 'complaint_user_confirmation',
        idempotencyKey: `complaint_user:${opts.ticketNumber}`,
        recipientName: trustedUserName,
        subject: userTemplate.subject,
        referenceId: opts.ticketId,
        triggerEvent: 'complaint_submission',
        metadata: { ticketNumber: opts.ticketNumber, category: opts.category },
        upsertIdempotency: true,
      });

      userEmailSent = await executeEmailDispatch(
        userLogId,
        normalizedUserEmail,
        userTemplate.subject,
        userTemplate.html,
        userTemplate.text,
        getBrandLogoAttachments(),
        1,
        3,
        opts.userId || undefined
      );
    } catch (err: any) {
      console.error('[Complaint User Email Error]:', sanitizeErrorMessage(err));
    }
  }

  const defaultAdminTmpl = generateComplaintAdminNotificationEmail({
    userName: trustedUserName,
    userEmail: normalizedUserEmail,
    userPhone: opts.userPhone,
    ticketNumber: opts.ticketNumber,
    category: opts.category,
    subject: opts.subject,
    description: opts.description,
    submittedAt: cleanSubmittedAt,
  });
  const customAdminTmpl = await getRenderedCustomTemplateIfActive('complaint-admin-alert', {
    user_name: trustedUserName,
    user_email: normalizedUserEmail,
    user_phone: opts.userPhone || 'Not provided',
    ticket_number: opts.ticketNumber,
    category: opts.category,
    subject: opts.subject,
    description: opts.description,
    submitted_at: cleanSubmittedAt,
  });
  const adminTemplate = customAdminTmpl || defaultAdminTmpl;

  try {
    adminLogId = await createDispatchLogRecord({
      userId: null,
      email: adminEmail,
      emailType: 'complaint_admin_notification',
      idempotencyKey: `complaint_admin:${opts.ticketNumber}`,
      recipientName: 'HackifyPro Admin',
      subject: adminTemplate.subject,
      referenceId: opts.ticketId,
      triggerEvent: 'complaint_submission',
      metadata: { ticketNumber: opts.ticketNumber, submitterEmail: normalizedUserEmail },
      upsertIdempotency: true,
    });

    adminEmailSent = await executeEmailDispatch(
      adminLogId,
      adminEmail,
      adminTemplate.subject,
      adminTemplate.html,
      adminTemplate.text,
      getBrandLogoAttachments(),
      1,
      3
    );
  } catch (err: any) {
    console.error('[Complaint Admin Email Error]:', sanitizeErrorMessage(err));
  }

  return { userEmailSent, adminEmailSent, userLogId, adminLogId };
}

export async function sendSupportTicketSubmissionEmails(opts: {
  ticketId: string;
  ticketNumber: string;
  userId?: string | null;
  userName?: string | null;
  userEmail: string;
  category: string;
  subject: string;
  description: string;
  submittedAt?: string;
}): Promise<{ userEmailSent: boolean; adminEmailSent: boolean; userLogId?: string; adminLogId?: string }> {
  const normalizedUserEmail = (opts.userEmail || '').trim().toLowerCase();
  const cleanSubmittedAt = opts.submittedAt || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }) + ' IST';
  const trustedUserName = (opts.userName || '').trim() || 'Valued User';
  const adminEmail = await getEffectiveSupportAlertEmail();

  let userEmailSent = false;
  let adminEmailSent = false;
  let userLogId = '';
  let adminLogId = '';

  if (normalizedUserEmail) {
    const defaultUserTmpl = generateSupportTicketReceivedEmail({
      userName: trustedUserName,
      ticketNumber: opts.ticketNumber,
      category: opts.category,
      subject: opts.subject,
      description: opts.description,
    });
    const customUserTmpl = await getRenderedCustomTemplateIfActive('support-confirmation', {
      user_name: trustedUserName,
      user_email: normalizedUserEmail,
      ticket_number: opts.ticketNumber,
      category: opts.category,
      subject: opts.subject,
      description: opts.description,
    });
    const userTemplate = customUserTmpl || defaultUserTmpl;

    try {
      userLogId = await createDispatchLogRecord({
        userId: opts.userId || null,
        email: normalizedUserEmail,
        emailType: 'support_user_confirmation',
        idempotencyKey: `support_user:${opts.ticketNumber}`,
        recipientName: trustedUserName,
        subject: userTemplate.subject,
        referenceId: opts.ticketId,
        triggerEvent: 'support_ticket_submission',
        metadata: { ticketNumber: opts.ticketNumber, category: opts.category },
        upsertIdempotency: true,
      });

      userEmailSent = await executeEmailDispatch(
        userLogId,
        normalizedUserEmail,
        userTemplate.subject,
        userTemplate.html,
        userTemplate.text,
        getBrandLogoAttachments(),
        1,
        3,
        opts.userId || undefined
      );
    } catch (err: any) {
      console.error('[Support User Email Error]:', sanitizeErrorMessage(err));
    }
  }

  const defaultAdminTmpl = generateSupportTicketAdminNotificationEmail({
    userName: trustedUserName,
    userEmail: normalizedUserEmail,
    ticketNumber: opts.ticketNumber,
    category: opts.category,
    subject: opts.subject,
    description: opts.description,
    submittedAt: cleanSubmittedAt,
  });
  const customAdminTmpl = await getRenderedCustomTemplateIfActive('support-admin-alert', {
    user_name: trustedUserName,
    user_email: normalizedUserEmail,
    ticket_number: opts.ticketNumber,
    category: opts.category,
    subject: opts.subject,
    description: opts.description,
    submitted_at: cleanSubmittedAt,
  });
  const adminTemplate = customAdminTmpl || defaultAdminTmpl;

  try {
    adminLogId = await createDispatchLogRecord({
      userId: null,
      email: adminEmail,
      emailType: 'support_admin_notification',
      idempotencyKey: `support_admin:${opts.ticketNumber}`,
      recipientName: 'HackifyPro Admin',
      subject: adminTemplate.subject,
      referenceId: opts.ticketId,
      triggerEvent: 'support_ticket_submission',
      metadata: { ticketNumber: opts.ticketNumber, submitterEmail: normalizedUserEmail },
      upsertIdempotency: true,
    });

    adminEmailSent = await executeEmailDispatch(
      adminLogId,
      adminEmail,
      adminTemplate.subject,
      adminTemplate.html,
      adminTemplate.text,
      getBrandLogoAttachments(),
      1,
      3
    );
  } catch (err: any) {
    console.error('[Support Admin Email Error]:', sanitizeErrorMessage(err));
  }

  return { userEmailSent, adminEmailSent, userLogId, adminLogId };
}

// -------------------------------------------------------------
// 12. AUTOMATED UDHAR NOTIFICATIONS (TWO-SIDED REGISTERED ONLY)
// -------------------------------------------------------------

export interface UdharCreatedEmailOpts {
  transactionId: string;
  linkId: string;
  initiatorUserId: string;
  initiatorName: string;
  initiatorEmail: string;
  counterpartUserId?: string | null;
  counterpartName: string;
  counterpartEmail?: string | null;
  direction: 'gave' | 'took';
  amount: number;
  description?: string;
  transactionDate: string;
  status: string;
}

export async function sendUdharCreatedEmails(opts: UdharCreatedEmailOpts): Promise<{
  initiatorSent: boolean;
  counterpartStatus: 'sent' | 'skipped_not_registered' | 'skipped_unverified' | 'failed';
}> {
  let initiatorSent = false;
  let counterpartStatus: 'sent' | 'skipped_not_registered' | 'skipped_unverified' | 'failed' = 'skipped_not_registered';

  const txIdStr = opts.transactionId;
  const initiatorEmail = (opts.initiatorEmail || '').trim().toLowerCase();
  const initiatorTypeStr = opts.direction === 'gave' ? 'Money Given (You Lent)' : 'Money Taken (You Borrowed)';

  // 1. Send confirmation to Initiator (Person A)
  if (initiatorEmail) {
    const defaultInitTmpl = generateUdharCreatedEmailForInitiator({
      userName: opts.initiatorName,
      transactionId: txIdStr,
      otherPersonName: opts.counterpartName,
      amount: opts.amount,
      gaveOrReceived: initiatorTypeStr,
      description: opts.description,
      transactionDate: opts.transactionDate,
      status: opts.status,
    });
    const customInitTmpl = await getRenderedCustomTemplateIfActive('udhar-created', {
      user_name: opts.initiatorName,
      other_person_name: opts.counterpartName,
      transaction_id: txIdStr,
      amount: opts.amount,
      direction_label: initiatorTypeStr,
      description: opts.description || 'None',
      transaction_date: opts.transactionDate,
      status: opts.status,
    });
    const initTmpl = customInitTmpl || defaultInitTmpl;

    const initKey = `udhar_create_init:${txIdStr}`;
    try {
      const logId = await createDispatchLogRecord({
        userId: opts.initiatorUserId,
        email: initiatorEmail,
        emailType: 'udhar_created_initiator',
        idempotencyKey: initKey,
        recipientName: opts.initiatorName,
        subject: initTmpl.subject,
        referenceId: txIdStr,
        triggerEvent: 'udhar_created',
        metadata: { linkId: opts.linkId, counterpartName: opts.counterpartName, amount: opts.amount, direction: opts.direction },
        upsertIdempotency: true,
      });
      initiatorSent = await executeEmailDispatch(
        logId,
        initiatorEmail,
        initTmpl.subject,
        initTmpl.html,
        initTmpl.text,
        getBrandLogoAttachments(),
        1,
        3,
        opts.initiatorUserId
      );
    } catch (e: any) {
      console.error('[Udhar Initiator Email Error]:', sanitizeErrorMessage(e));
    }
  }

  // 2. Identify if counterpart is a REGISTERED My Money Manager user
  let verifiedCounterpart: { id: string; full_name: string; email: string } | null = null;
  let unverifiedEmailProvided = false;

  try {
    if (opts.counterpartUserId && opts.counterpartUserId !== opts.initiatorUserId) {
      verifiedCounterpart = await lookupRegisteredUser({ userId: opts.counterpartUserId });
    } else if (opts.counterpartEmail) {
      const cleanCpEmail = opts.counterpartEmail.trim().toLowerCase();
      if (cleanCpEmail) {
        unverifiedEmailProvided = true;
        verifiedCounterpart = await lookupRegisteredUser({ email: cleanCpEmail });
      }
    }
  } catch (vErr) {
    console.warn('[Counterpart Verification DB Warn]:', vErr);
  }

  // 3. Counterpart Notification Handling
  const cpKey = `udhar_create_cp:${txIdStr}`;

  if (verifiedCounterpart && verifiedCounterpart.email) {
    const recipientPerspectiveType = opts.direction === 'gave'
      ? 'Money Received (You Borrowed)'
      : 'Money Given (You Lent)';

    const defaultCpTmpl = generateUdharCreatedEmailForRecipient({
      recipientName: verifiedCounterpart.full_name,
      senderName: opts.initiatorName,
      transactionId: txIdStr,
      amount: opts.amount,
      recipientTransactionType: recipientPerspectiveType,
      description: opts.description,
      transactionDate: opts.transactionDate,
      status: opts.status,
    });
    const customCpTmpl = await getRenderedCustomTemplateIfActive('udhar-created', {
      user_name: verifiedCounterpart.full_name,
      other_person_name: opts.initiatorName,
      transaction_id: txIdStr,
      amount: opts.amount,
      direction_label: recipientPerspectiveType,
      description: opts.description || 'None',
      transaction_date: opts.transactionDate,
      status: opts.status,
    });
    const cpTmpl = customCpTmpl || defaultCpTmpl;

    try {
      const cpLogId = await createDispatchLogRecord({
        userId: verifiedCounterpart.id,
        email: verifiedCounterpart.email.toLowerCase(),
        emailType: 'udhar_created_counterpart',
        idempotencyKey: cpKey,
        recipientName: verifiedCounterpart.full_name,
        subject: cpTmpl.subject,
        referenceId: txIdStr,
        triggerEvent: 'udhar_created',
        metadata: { linkId: opts.linkId, initiatorName: opts.initiatorName, amount: opts.amount, recipientType: recipientPerspectiveType },
        upsertIdempotency: true,
      });
      const sent = await executeEmailDispatch(
        cpLogId,
        verifiedCounterpart.email.toLowerCase(),
        cpTmpl.subject,
        cpTmpl.html,
        cpTmpl.text,
        getBrandLogoAttachments(),
        1,
        3,
        verifiedCounterpart.id
      );
      counterpartStatus = sent ? 'sent' : 'failed';
    } catch (cpErr: any) {
      console.error('[Udhar Counterpart Email Error]:', sanitizeErrorMessage(cpErr));
      counterpartStatus = 'failed';
    }
  } else {
    const skipStatus = unverifiedEmailProvided ? 'skipped_unverified' : 'skipped_not_registered';
    const reasonText = unverifiedEmailProvided
      ? 'Skipped: Counterpart email is not verified or registered in My Money Manager'
      : 'Skipped: Counterpart is not a registered My Money Manager user';

    try {
      await createDispatchLogRecord({
        userId: null,
        email: opts.counterpartEmail || null,
        emailType: 'udhar_created_counterpart',
        idempotencyKey: `udhar_skip_cp:${txIdStr}`,
        recipientName: opts.counterpartName,
        subject: `[Skipped] New Udhar Transaction Recorded – ${APP_CONFIG.appName}`,
        status: skipStatus,
        maxAttempts: 0,
        lastError: reasonText,
        referenceId: txIdStr,
        triggerEvent: 'udhar_created',
        metadata: { linkId: opts.linkId, counterpartName: opts.counterpartName, reason: 'unregistered_counterpart' },
        upsertIdempotency: true,
      });
      counterpartStatus = skipStatus;
    } catch (skipErr) {
      console.warn('[Udhar Skip Log Insert Warn]:', skipErr);
      counterpartStatus = skipStatus;
    }
  }

  return { initiatorSent, counterpartStatus };
}

// -------------------------------------------------------------
// 13. AUTOMATED UDHAR SETTLED NOTIFICATIONS
// -------------------------------------------------------------

export interface UdharSettledEmailOpts {
  transactionId: string;
  linkId: string;
  initiatorUserId: string;
  initiatorName: string;
  initiatorEmail: string;
  counterpartUserId?: string | null;
  counterpartName: string;
  counterpartEmail?: string | null;
  amountSettled: number;
  settlementDate: string;
  updatedBalance: number;
  direction: 'gave' | 'took';
}

export async function sendUdharSettledEmails(opts: UdharSettledEmailOpts): Promise<{
  initiatorSent: boolean;
  counterpartStatus: 'sent' | 'skipped_not_registered' | 'skipped_unverified' | 'failed';
}> {
  let initiatorSent = false;
  let counterpartStatus: 'sent' | 'skipped_not_registered' | 'skipped_unverified' | 'failed' = 'skipped_not_registered';

  const txIdStr = opts.transactionId;
  const initiatorEmail = (opts.initiatorEmail || '').trim().toLowerCase();

  // 1. Send confirmation to Initiator
  if (initiatorEmail) {
    const defaultInitTmpl = generateUdharSettledEmail({
      userName: opts.initiatorName,
      counterpartName: opts.counterpartName,
      transactionId: txIdStr,
      amountSettled: opts.amountSettled,
      settlementDate: opts.settlementDate,
      updatedBalance: opts.updatedBalance,
      isLenderPerspective: opts.direction === 'gave',
    });
    const customInitTmpl = await getRenderedCustomTemplateIfActive('udhar-settled', {
      user_name: opts.initiatorName,
      other_person_name: opts.counterpartName,
      transaction_id: txIdStr,
      amount_settled: opts.amountSettled,
      updated_balance: opts.updatedBalance,
      settlement_date: opts.settlementDate,
    });
    const initTmpl = customInitTmpl || defaultInitTmpl;

    const initKey = `udhar_settle_init:${txIdStr}_${Date.now()}`;
    try {
      const logId = await createDispatchLogRecord({
        userId: opts.initiatorUserId,
        email: initiatorEmail,
        emailType: 'udhar_settled_initiator',
        idempotencyKey: initKey,
        recipientName: opts.initiatorName,
        subject: initTmpl.subject,
        referenceId: txIdStr,
        triggerEvent: 'udhar_settled',
        metadata: { linkId: opts.linkId, counterpartName: opts.counterpartName, amountSettled: opts.amountSettled, updatedBalance: opts.updatedBalance },
      });
      initiatorSent = await executeEmailDispatch(
        logId,
        initiatorEmail,
        initTmpl.subject,
        initTmpl.html,
        initTmpl.text,
        getBrandLogoAttachments(),
        1,
        3,
        opts.initiatorUserId
      );
    } catch (e: any) {
      console.error('[Udhar Settled Initiator Email Error]:', sanitizeErrorMessage(e));
    }
  }

  // 2. Identify if counterpart is registered
  let verifiedCounterpart: { id: string; full_name: string; email: string } | null = null;
  let unverifiedEmailProvided = false;

  try {
    if (opts.counterpartUserId && opts.counterpartUserId !== opts.initiatorUserId) {
      verifiedCounterpart = await lookupRegisteredUser({ userId: opts.counterpartUserId });
    } else if (opts.counterpartEmail) {
      const cleanCpEmail = opts.counterpartEmail.trim().toLowerCase();
      if (cleanCpEmail) {
        unverifiedEmailProvided = true;
        verifiedCounterpart = await lookupRegisteredUser({ email: cleanCpEmail });
      }
    }
  } catch (vErr) {
    console.warn('[Counterpart Settlement Verification Warn]:', vErr);
  }

  // 3. Counterpart Settlement Notification
  const cpKey = `udhar_settle_cp:${txIdStr}_${Date.now()}`;

  if (verifiedCounterpart && verifiedCounterpart.email) {
    const defaultCpTmpl = generateUdharSettledEmail({
      userName: verifiedCounterpart.full_name,
      counterpartName: opts.initiatorName,
      transactionId: txIdStr,
      amountSettled: opts.amountSettled,
      settlementDate: opts.settlementDate,
      updatedBalance: opts.updatedBalance,
      isLenderPerspective: opts.direction !== 'gave',
    });
    const customCpTmpl = await getRenderedCustomTemplateIfActive('udhar-settled', {
      user_name: verifiedCounterpart.full_name,
      other_person_name: opts.initiatorName,
      transaction_id: txIdStr,
      amount_settled: opts.amountSettled,
      updated_balance: opts.updatedBalance,
      settlement_date: opts.settlementDate,
    });
    const cpTmpl = customCpTmpl || defaultCpTmpl;

    try {
      const cpLogId = await createDispatchLogRecord({
        userId: verifiedCounterpart.id,
        email: verifiedCounterpart.email.toLowerCase(),
        emailType: 'udhar_settled_counterpart',
        idempotencyKey: cpKey,
        recipientName: verifiedCounterpart.full_name,
        subject: cpTmpl.subject,
        referenceId: txIdStr,
        triggerEvent: 'udhar_settled',
        metadata: { linkId: opts.linkId, initiatorName: opts.initiatorName, amountSettled: opts.amountSettled, updatedBalance: opts.updatedBalance },
      });
      const sent = await executeEmailDispatch(
        cpLogId,
        verifiedCounterpart.email.toLowerCase(),
        cpTmpl.subject,
        cpTmpl.html,
        cpTmpl.text,
        getBrandLogoAttachments(),
        1,
        3,
        verifiedCounterpart.id
      );
      counterpartStatus = sent ? 'sent' : 'failed';
    } catch (cpErr: any) {
      console.error('[Udhar Settled Counterpart Email Error]:', sanitizeErrorMessage(cpErr));
      counterpartStatus = 'failed';
    }
  } else {
    const skipStatus = unverifiedEmailProvided ? 'skipped_unverified' : 'skipped_not_registered';
    const reasonText = unverifiedEmailProvided
      ? 'Skipped: Counterpart email is not verified or registered in My Money Manager'
      : 'Skipped: Counterpart is not a registered My Money Manager user';

    try {
      await createDispatchLogRecord({
        userId: null,
        email: opts.counterpartEmail || null,
        emailType: 'udhar_settled_counterpart',
        idempotencyKey: `udhar_skip_settle_cp:${txIdStr}_${Date.now()}`,
        recipientName: opts.counterpartName,
        subject: `[Skipped] Udhar Transaction Settled – ${APP_CONFIG.appName}`,
        status: skipStatus,
        maxAttempts: 0,
        lastError: reasonText,
        referenceId: txIdStr,
        triggerEvent: 'udhar_settled',
        metadata: { linkId: opts.linkId, counterpartName: opts.counterpartName, reason: 'unregistered_counterpart' },
      });
      counterpartStatus = skipStatus;
    } catch (skipErr) {
      console.warn('[Udhar Settle Skip Log Insert Warn]:', skipErr);
      counterpartStatus = skipStatus;
    }
  }

  return { initiatorSent, counterpartStatus };
}

// -------------------------------------------------------------
// 14. AUTOMATED UDHAR UPDATED NOTIFICATIONS
// -------------------------------------------------------------

export interface UdharUpdatedEmailOpts {
  transactionId: string;
  linkId: string;
  initiatorUserId: string;
  initiatorName: string;
  initiatorEmail: string;
  counterpartUserId?: string | null;
  counterpartName: string;
  counterpartEmail?: string | null;
  amount: number;
  direction: 'gave' | 'took';
  description?: string;
  transactionDate: string;
  status: string;
}

export async function sendUdharUpdatedEmails(opts: UdharUpdatedEmailOpts): Promise<{
  initiatorSent: boolean;
  counterpartStatus: 'sent' | 'skipped_not_registered' | 'skipped_unverified' | 'failed';
}> {
  let initiatorSent = false;
  let counterpartStatus: 'sent' | 'skipped_not_registered' | 'skipped_unverified' | 'failed' = 'skipped_not_registered';

  const txIdStr = opts.transactionId;
  const initiatorEmail = (opts.initiatorEmail || '').trim().toLowerCase();
  const initiatorTypeStr = opts.direction === 'gave' ? 'Money Given (You Lent)' : 'Money Taken (You Borrowed)';

  // 1. Send update notice to Initiator
  if (initiatorEmail) {
    const defaultInitTmpl = generateUdharUpdatedEmail({
      userName: opts.initiatorName,
      counterpartName: opts.counterpartName,
      transactionId: txIdStr,
      amount: opts.amount,
      gaveOrReceived: initiatorTypeStr,
      description: opts.description,
      transactionDate: opts.transactionDate,
      status: opts.status,
      isRecipientView: false,
    });
    const customInitTmpl = await getRenderedCustomTemplateIfActive('udhar-updated', {
      user_name: opts.initiatorName,
      other_person_name: opts.counterpartName,
      transaction_id: txIdStr,
      amount: opts.amount,
      direction_label: initiatorTypeStr,
      description: opts.description || 'None',
      transaction_date: opts.transactionDate,
      status: opts.status,
    });
    const initTmpl = customInitTmpl || defaultInitTmpl;

    const initKey = `udhar_update_init:${txIdStr}_${Date.now()}`;
    try {
      const logId = await createDispatchLogRecord({
        userId: opts.initiatorUserId,
        email: initiatorEmail,
        emailType: 'udhar_updated_initiator',
        idempotencyKey: initKey,
        recipientName: opts.initiatorName,
        subject: initTmpl.subject,
        referenceId: txIdStr,
        triggerEvent: 'udhar_updated',
        metadata: { linkId: opts.linkId, counterpartName: opts.counterpartName, amount: opts.amount },
      });
      initiatorSent = await executeEmailDispatch(
        logId,
        initiatorEmail,
        initTmpl.subject,
        initTmpl.html,
        initTmpl.text,
        getBrandLogoAttachments(),
        1,
        3,
        opts.initiatorUserId
      );
    } catch (e: any) {
      console.error('[Udhar Updated Initiator Email Error]:', sanitizeErrorMessage(e));
    }
  }

  // 2. Identify if counterpart is registered
  let verifiedCounterpart: { id: string; full_name: string; email: string } | null = null;
  let unverifiedEmailProvided = false;

  try {
    if (opts.counterpartUserId && opts.counterpartUserId !== opts.initiatorUserId) {
      verifiedCounterpart = await lookupRegisteredUser({ userId: opts.counterpartUserId });
    } else if (opts.counterpartEmail) {
      const cleanCpEmail = opts.counterpartEmail.trim().toLowerCase();
      if (cleanCpEmail) {
        unverifiedEmailProvided = true;
        verifiedCounterpart = await lookupRegisteredUser({ email: cleanCpEmail });
      }
    }
  } catch (vErr) {
    console.warn('[Counterpart Update Verification Warn]:', vErr);
  }

  // 3. Counterpart update notification
  const cpKey = `udhar_update_cp:${txIdStr}_${Date.now()}`;

  if (verifiedCounterpart && verifiedCounterpart.email) {
    const recipientPerspectiveType = opts.direction === 'gave'
      ? 'Money Received (You Borrowed)'
      : 'Money Given (You Lent)';

    const defaultCpTmpl = generateUdharUpdatedEmail({
      userName: verifiedCounterpart.full_name,
      counterpartName: opts.initiatorName,
      transactionId: txIdStr,
      amount: opts.amount,
      gaveOrReceived: recipientPerspectiveType,
      description: opts.description,
      transactionDate: opts.transactionDate,
      status: opts.status,
      isRecipientView: true,
    });
    const customCpTmpl = await getRenderedCustomTemplateIfActive('udhar-updated', {
      user_name: verifiedCounterpart.full_name,
      other_person_name: opts.initiatorName,
      transaction_id: txIdStr,
      amount: opts.amount,
      direction_label: recipientPerspectiveType,
      description: opts.description || 'None',
      transaction_date: opts.transactionDate,
      status: opts.status,
    });
    const cpTmpl = customCpTmpl || defaultCpTmpl;

    try {
      const cpLogId = await createDispatchLogRecord({
        userId: verifiedCounterpart.id,
        email: verifiedCounterpart.email.toLowerCase(),
        emailType: 'udhar_updated_counterpart',
        idempotencyKey: cpKey,
        recipientName: verifiedCounterpart.full_name,
        subject: cpTmpl.subject,
        referenceId: txIdStr,
        triggerEvent: 'udhar_updated',
        metadata: { linkId: opts.linkId, initiatorName: opts.initiatorName, amount: opts.amount },
      });
      const sent = await executeEmailDispatch(
        cpLogId,
        verifiedCounterpart.email.toLowerCase(),
        cpTmpl.subject,
        cpTmpl.html,
        cpTmpl.text,
        getBrandLogoAttachments(),
        1,
        3,
        verifiedCounterpart.id
      );
      counterpartStatus = sent ? 'sent' : 'failed';
    } catch (cpErr: any) {
      console.error('[Udhar Updated Counterpart Email Error]:', sanitizeErrorMessage(cpErr));
      counterpartStatus = 'failed';
    }
  } else {
    const skipStatus = unverifiedEmailProvided ? 'skipped_unverified' : 'skipped_not_registered';
    const reasonText = unverifiedEmailProvided
      ? 'Skipped: Counterpart email is not verified or registered in My Money Manager'
      : 'Skipped: Counterpart is not a registered My Money Manager user';

    try {
      await createDispatchLogRecord({
        userId: null,
        email: opts.counterpartEmail || null,
        emailType: 'udhar_updated_counterpart',
        idempotencyKey: `udhar_skip_update_cp:${txIdStr}_${Date.now()}`,
        recipientName: opts.counterpartName,
        subject: `[Skipped] Udhar Transaction Updated – ${APP_CONFIG.appName}`,
        status: skipStatus,
        maxAttempts: 0,
        lastError: reasonText,
        referenceId: txIdStr,
        triggerEvent: 'udhar_updated',
        metadata: { linkId: opts.linkId, counterpartName: opts.counterpartName, reason: 'unregistered_counterpart' },
      });
      counterpartStatus = skipStatus;
    } catch (skipErr) {
      console.warn('[Udhar Update Skip Log Insert Warn]:', skipErr);
      counterpartStatus = skipStatus;
    }
  }

  return { initiatorSent, counterpartStatus };
}

// -------------------------------------------------------------
// 17. CONTACT INVITATION EMAIL (FOR MANUAL/UNREGISTERED CONTACTS)
// -------------------------------------------------------------
export async function sendContactInvitationEmail(opts: {
  inviterName: string;
  inviterEmail?: string;
  recipientName: string;
  recipientEmail: string;
  inviteLink: string;
  inviteToken?: string;
}): Promise<boolean> {
  const subject = `You've been invited to ${APP_CONFIG.appName} by ${opts.inviterName}`;
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
        .feature-box { background: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px; margin: 20px 0; }
        .footer { background: #f1f5f9; padding: 16px; text-align: center; font-size: 11px; color: #64748b; border-top: 1px solid #e2e8f0; }
        .url-box { background: #f8fafc; border: 1px dashed #cbd5e1; padding: 10px; border-radius: 8px; font-size: 11px; color: #475569; word-break: break-all; margin-top: 12px; }
      </style>
    </head>
    <body>
      <div class="card">
        <div class="header">
          <h1>${APP_CONFIG.appName}</h1>
          <p>by ${APP_CONFIG.companyName} · Smart Money & Udhar Tracker</p>
        </div>
        <div class="content">
          <p style="font-size: 15px; font-weight: 600; color: #0f172a;">Hi ${opts.recipientName || 'Friend'},</p>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            <strong>${opts.inviterName}</strong> has added you as a contact in ${APP_CONFIG.appName} to help manage money lending, borrowing, and repayment records digitally.
          </p>
          <div class="feature-box">
            <p style="font-weight: 700; font-size: 13px; color: #065f46; margin: 0 0 10px 0;">With ${APP_CONFIG.appName}, you can:</p>
            <ul style="margin: 0; padding-left: 20px; font-size: 13px; color: #166534; line-height: 1.6;">
              <li>Track money given and received.</li>
              <li>Manage borrowing and repayment records.</li>
              <li>Maintain transparent transaction history.</li>
              <li>Keep track of outstanding balances.</li>
            </ul>
          </div>
          <p style="font-size: 13px; line-height: 1.6; color: #334155;">
            Create your account to join and manage your financial records:
          </p>
          <div style="text-align: center;">
            <a href="${opts.inviteLink}" class="btn" target="_blank">Create Your Account</a>
          </div>
          <p style="font-size: 12px; color: #64748b; margin-bottom: 4px;">Or copy and paste this link into your browser:</p>
          <div class="url-box">${opts.inviteLink}</div>
        </div>
        <div class="footer">
          &copy; ${new Date().getFullYear()} ${APP_CONFIG.appName} · Developed under ${APP_CONFIG.companyName}.
        </div>
      </div>
    </body>
    </html>
  `;
  const text = `Hi ${opts.recipientName || 'Friend'},\n\n${opts.inviterName} has added you as a contact in ${APP_CONFIG.appName} to help manage money lending, borrowing, and repayment records digitally.\n\nWith ${APP_CONFIG.appName}, you can:\n- Track money given and received.\n- Manage borrowing and repayment records.\n- Maintain transparent transaction history.\n- Keep track of outstanding balances.\n\nCreate your account to join and manage your financial records:\n${opts.inviteLink}\n\n${APP_CONFIG.appName} by ${APP_CONFIG.companyName}`;

  try {
    const customInvite = await getRenderedCustomTemplateIfActive('contact-invitation', {
      user_name: opts.recipientName || 'Friend',
      inviter_name: opts.inviterName,
      invite_link: opts.inviteLink,
    });
    const finalSubject = customInvite?.subject || subject;
    const finalHtml = customInvite?.html || html;
    const finalText = customInvite?.text || text;

    const cleanEmail = opts.recipientEmail.toLowerCase().trim();
    const logId = await createDispatchLogRecord({
      userId: null,
      email: cleanEmail,
      emailType: 'contact_invitation',
      idempotencyKey: `invite:${cleanEmail}_${Date.now()}`,
      recipientName: opts.recipientName,
      subject: finalSubject,
      referenceId: opts.inviteToken || null,
      triggerEvent: 'contact_invitation',
      metadata: { inviterName: opts.inviterName, inviterEmail: opts.inviterEmail },
    });
    return await executeEmailDispatch(
      logId,
      cleanEmail,
      finalSubject,
      finalHtml,
      finalText,
      getBrandLogoAttachments(),
      1,
      3
    );
  } catch (err: any) {
    console.error('[sendContactInvitationEmail Error]:', err.message);
    return false;
  }
}
