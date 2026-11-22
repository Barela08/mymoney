import { APP_CONFIG } from './config';
import { escapeHtml, formatPersonalizedGreeting } from './welcomeEmailTemplate';
export { escapeHtml, formatPersonalizedGreeting };

export const STAR_LABELS: Record<number, string> = {
  1: 'Poor (1/5)',
  2: 'Needs Improvement (2/5)',
  3: 'Average (3/5)',
  4: 'Good (4/5)',
  5: 'Excellent (5/5)',
};

/**
 * Common outer email wrapper for all support-related emails
 */
function wrapEmailHtml(title: string, bodyContent: string): string {
  const logoSrc = APP_CONFIG.appLogoUrl || 'cid:app_logo';
  return `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(title)}</title>
  <style type="text/css">
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; min-width: 100%; background-color: #f4f7f5; }
    @media only screen and (max-width: 600px) {
      .container-table { width: 100% !important; border-radius: 0px !important; }
      .content-padding { padding: 24px 20px !important; }
      .header-padding { padding: 24px 20px 16px 20px !important; }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f7f5; min-height: 100%; padding: 32px 12px;">
    <tr>
      <td align="center" valign="top">
        <table role="presentation" class="container-table" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04); overflow: hidden; margin: 0 auto;">
          <!-- HEADER -->
          <tr>
            <td class="header-padding" align="center" style="padding: 32px 32px 20px 32px; background-color: #ffffff; text-align: center;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td align="center">
                    <img src="${logoSrc}" alt="${escapeHtml(APP_CONFIG.appName)} Logo" width="56" height="56" style="display: block; width: 56px; height: 56px; border-radius: 12px; object-fit: cover; border: 1px solid #e2e8f0;" />
                  </td>
                </tr>
              </table>
              <h1 style="margin: 12px 0 0 0; font-size: 20px; font-weight: 800; color: #065f46; letter-spacing: -0.3px;">
                ${escapeHtml(APP_CONFIG.appName)}
              </h1>
              <p style="margin: 4px 0 0 0; font-size: 12px; font-weight: 500; color: #475569;">
                ${escapeHtml(APP_CONFIG.appTagline)}
              </p>
              <p style="margin: 6px 0 0 0; font-size: 11px; font-weight: 600; color: #047857; text-transform: uppercase; letter-spacing: 0.8px;">
                A product of ${escapeHtml(APP_CONFIG.companyName)}
              </p>
            </td>
          </tr>
          <!-- DIVIDER -->
          <tr>
            <td style="padding: 0 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr><td style="border-top: 1px solid #e2e8f0; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>
              </table>
            </td>
          </tr>
          <!-- BODY CONTENT -->
          <tr>
            <td class="content-padding" style="padding: 28px 32px 32px 32px;">
              ${bodyContent}
            </td>
          </tr>
          <!-- FOOTER -->
          <tr>
            <td align="center" style="padding: 24px 32px; background-color: #f1f5f9; border-top: 1px solid #e2e8f0; text-align: center;">
              <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px;">
                A product proudly built by
              </p>
              <p style="margin: 0 0 4px 0; font-size: 13px; font-weight: 800; color: #065f46; letter-spacing: 0.8px;">
                ${escapeHtml(APP_CONFIG.companyName.toUpperCase())}
              </p>
              <p style="margin: 0 0 12px 0; font-size: 11px; font-style: italic; color: #64748b;">
                ${escapeHtml(APP_CONFIG.companyTagline)}
              </p>
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 10px 0;">
                <tr><td style="border-top: 1px solid #cbd5e1; font-size: 1px; line-height: 1px;">&nbsp;</td></tr>
              </table>
              <p style="margin: 0; font-size: 11px; font-weight: 400; color: #94a3b8; line-height: 1.4;">
                ${escapeHtml(APP_CONFIG.footerCopyright)}
              </p>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
}

// -----------------------------------------------------------------------------
// 1. FEEDBACK RECEIVED EMAIL
// -----------------------------------------------------------------------------
export function generateFeedbackReceivedEmail(data: {
  userName?: string | null;
  rating?: number | null;
  category?: string;
  message?: string;
  feedbackMessage?: string;
  userEmail?: string;
}): { subject: string; html: string; text: string } {
  const greeting = formatPersonalizedGreeting(data.userName);
  const ratingText = data.rating ? STAR_LABELS[data.rating] || `${data.rating} Stars` : 'Not specified';
  const starsRender = data.rating ? '★'.repeat(data.rating) + '☆'.repeat(5 - data.rating) : '';
  const messageContent = data.message || data.feedbackMessage || '';
  const subject = `Thank you for your feedback — ${APP_CONFIG.appName}`;

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 19px; font-weight: 700; color: #0f172a;">
      Thank You for Your Feedback! ✨
    </h2>
    <p style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #065f46;">
      ${greeting}
    </p>
    <p style="margin: 0 0 16px 0; font-size: 14px; font-weight: 400; color: #334155; line-height: 1.6;">
      We have received your feedback. Your opinion helps us continuously improve My Money Manager and build a better personal finance experience for you.
    </p>
    
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 20px 0; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px 18px;">
      <tr>
        <td>
          <p style="margin: 0 0 4px 0; font-size: 13px; font-weight: 700; color: #065f46;">
            Your Rating: <span style="font-size: 16px; color: #eab308; letter-spacing: 2px;">${starsRender}</span> (${escapeHtml(ratingText)})
          </p>
          ${data.category ? `<p style="margin: 0 0 8px 0; font-size: 12px; font-weight: 600; color: #166534;">Category: ${escapeHtml(data.category)}</p>` : ''}
          <p style="margin: 8px 0 0 0; font-size: 13px; font-style: italic; color: #334155; line-height: 1.5; background: #ffffff; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0;">
            &ldquo;${escapeHtml(messageContent)}&rdquo;
          </p>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 12px 0; font-size: 13px; color: #64748b; line-height: 1.5;">
      Our product team regularly reviews user ratings and feature requests to guide future enhancements.
    </p>
    <p style="margin: 0 0 4px 0; font-size: 13px; color: #64748b;">
      Warm regards,
    </p>
    <p style="margin: 0; font-size: 14px; font-weight: 700; color: #065f46;">
      Team ${escapeHtml(APP_CONFIG.appName)}
    </p>
  `;

  const html = wrapEmailHtml(subject, bodyContent);
  const text = `${APP_CONFIG.appName}\n${APP_CONFIG.appTagline}\nA product of ${APP_CONFIG.companyName}\n--------------------------------------------------\n\nThank you for your feedback!\n\n${greeting}\n\nWe have received your feedback.\nRating: ${ratingText}\n${data.category ? `Category: ${data.category}\n` : ''}\nYour Message:\n"${data.message}"\n\nWarm regards,\nTeam ${APP_CONFIG.appName}\n`;
  return { subject, html, text };
}

// -----------------------------------------------------------------------------
// 2. COMPLAINT RECEIVED EMAIL
// -----------------------------------------------------------------------------
export function generateComplaintReceivedEmail(data: {
  userName?: string | null;
  ticketNumber: string;
  category: string;
  subject: string;
  description: string;
}): { subject: string; html: string; text: string } {
  const greeting = formatPersonalizedGreeting(data.userName);
  const subject = `Your complaint has been registered — #${data.ticketNumber}`;

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 19px; font-weight: 700; color: #0f172a;">
      Complaint Registered Successfully 📋
    </h2>
    <p style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #065f46;">
      ${greeting}
    </p>
    <p style="margin: 0 0 16px 0; font-size: 14px; font-weight: 400; color: #334155; line-height: 1.6;">
      We have registered your complaint. Our support specialists have been notified and will investigate the issue promptly.
    </p>

    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 20px 0; background-color: #fef2f2; border: 1px solid #fecaca; border-radius: 12px; padding: 16px 18px;">
      <tr>
        <td>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size: 13px; color: #991b1b; padding-bottom: 6px;">
                <strong>Complaint / Ticket ID:</strong> <span style="font-family: monospace; font-size: 14px; background: #ffffff; padding: 2px 8px; border-radius: 6px; border: 1px solid #fca5a5;">#${escapeHtml(data.ticketNumber)}</span>
              </td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #991b1b; padding-bottom: 6px;">
                <strong>Category:</strong> ${escapeHtml(data.category)}
              </td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #991b1b; padding-bottom: 6px;">
                <strong>Subject:</strong> ${escapeHtml(data.subject)}
              </td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #991b1b;">
                <strong>Status:</strong> <span style="display: inline-block; background: #fee2e2; color: #991b1b; font-weight: 700; font-size: 11px; padding: 2px 8px; border-radius: 4px; text-transform: uppercase;">Open</span>
              </td>
            </tr>
          </table>
          <p style="margin: 12px 0 0 0; font-size: 13px; color: #4b5563; background: #ffffff; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; line-height: 1.5;">
            ${escapeHtml(data.description)}
          </p>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 16px 0; font-size: 13px; color: #475569; line-height: 1.5;">
      You can track the real-time status of your complaint or post updates directly from the <strong>Feedback & Support History</strong> section in the app.
    </p>

    <!-- Support Details -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 20px 0; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 14px 16px;">
      <tr>
        <td style="font-size: 12px; color: #334155; line-height: 1.6;">
          <strong>Need urgent assistance?</strong> Contact us directly:<br/>
          Email: <a href="mailto:${escapeHtml(APP_CONFIG.supportEmail)}" style="color: #047857; text-decoration: underline;">${escapeHtml(APP_CONFIG.supportEmail)}</a> &bull; Phone: <a href="tel:${escapeHtml(APP_CONFIG.supportPhoneRaw)}" style="color: #047857; text-decoration: underline;">${escapeHtml(APP_CONFIG.supportPhone)}</a>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 4px 0; font-size: 13px; color: #64748b;">
      Warm regards,
    </p>
    <p style="margin: 0; font-size: 14px; font-weight: 700; color: #065f46;">
      Team ${escapeHtml(APP_CONFIG.appName)}
    </p>
  `;

  const html = wrapEmailHtml(subject, bodyContent);
  const text = `${APP_CONFIG.appName}\n${APP_CONFIG.appTagline}\nA product of ${APP_CONFIG.companyName}\n--------------------------------------------------\n\nComplaint Registered: #${data.ticketNumber}\n\n${greeting}\n\nWe have registered your complaint (#${data.ticketNumber}).\nCategory: ${data.category}\nSubject: ${data.subject}\nStatus: Open\n\nDescription:\n${data.description}\n\nOur team is reviewing your complaint. You can track this in your Feedback & Support History section.\n\nWarm regards,\nTeam ${APP_CONFIG.appName}\n`;
  return { subject, html, text };
}

// -----------------------------------------------------------------------------
// 3. SUPPORT REQUEST RECEIVED EMAIL
// -----------------------------------------------------------------------------
export function generateSupportTicketReceivedEmail(data: {
  userName?: string | null;
  ticketNumber: string;
  category: string;
  subject: string;
  description: string;
}): { subject: string; html: string; text: string } {
  const greeting = formatPersonalizedGreeting(data.userName);
  const subject = `Your support request has been received — #${data.ticketNumber}`;

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 19px; font-weight: 700; color: #0f172a;">
      Support Request Received 🤝
    </h2>
    <p style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #065f46;">
      ${greeting}
    </p>
    <p style="margin: 0 0 16px 0; font-size: 14px; font-weight: 400; color: #334155; line-height: 1.6;">
      Thank you for reaching out. We have opened a support ticket for your inquiry and a support representative will assist you soon.
    </p>

    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 20px 0; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 16px 18px;">
      <tr>
        <td>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size: 13px; color: #166534; padding-bottom: 6px;">
                <strong>Ticket ID:</strong> <span style="font-family: monospace; font-size: 14px; background: #ffffff; padding: 2px 8px; border-radius: 6px; border: 1px solid #86efac;">#${escapeHtml(data.ticketNumber)}</span>
              </td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #166534; padding-bottom: 6px;">
                <strong>Category:</strong> ${escapeHtml(data.category)}
              </td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #166534;">
                <strong>Subject:</strong> ${escapeHtml(data.subject)}
              </td>
            </tr>
          </table>
          <p style="margin: 12px 0 0 0; font-size: 13px; color: #334155; background: #ffffff; padding: 12px; border-radius: 8px; border: 1px solid #e2e8f0; line-height: 1.5;">
            ${escapeHtml(data.description)}
          </p>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 16px 0; font-size: 13px; color: #475569; line-height: 1.5;">
      You can view and reply to this ticket anytime in your <strong>Feedback & Support History</strong>.
    </p>

    <p style="margin: 0 0 4px 0; font-size: 13px; color: #64748b;">
      Warm regards,
    </p>
    <p style="margin: 0; font-size: 14px; font-weight: 700; color: #065f46;">
      Team ${escapeHtml(APP_CONFIG.appName)}
    </p>
  `;

  const html = wrapEmailHtml(subject, bodyContent);
  const text = `${APP_CONFIG.appName}\n${APP_CONFIG.appTagline}\nA product of ${APP_CONFIG.companyName}\n--------------------------------------------------\n\nSupport Ticket: #${data.ticketNumber}\n\n${greeting}\n\nWe have received your support request (#${data.ticketNumber}).\nCategory: ${data.category}\nSubject: ${data.subject}\n\nDescription:\n${data.description}\n\nYou can track this ticket in your Feedback & Support History section.\n\nWarm regards,\nTeam ${APP_CONFIG.appName}\n`;
  return { subject, html, text };
}

// -----------------------------------------------------------------------------
// 4. ADMIN REPLY EMAIL (TO COMPLAINT / SUPPORT TICKET / FEEDBACK)
// -----------------------------------------------------------------------------
export function generateAdminReplyEmail(data: {
  userName?: string | null;
  ticketNumber: string;
  ticketType: 'complaint' | 'support' | 'feedback';
  originalSubject: string;
  adminReply: string;
  adminName?: string;
}): { subject: string; html: string; text: string } {
  const greeting = formatPersonalizedGreeting(data.userName);
  const ticketLabel = data.ticketType === 'complaint' ? 'complaint' : data.ticketType === 'feedback' ? 'feedback' : 'support request';
  const subject = `Update regarding your ${ticketLabel} #${data.ticketNumber}`;

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 19px; font-weight: 700; color: #0f172a;">
      Support Team Update 💬
    </h2>
    <p style="margin: 0 0 12px 0; font-size: 15px; font-weight: 600; color: #065f46;">
      ${greeting}
    </p>
    <p style="margin: 0 0 16px 0; font-size: 14px; font-weight: 400; color: #334155; line-height: 1.6;">
      Our support team has reviewed your ${ticketLabel} regarding <strong>&ldquo;${escapeHtml(data.originalSubject)}&rdquo;</strong> (Ticket: <span style="font-family: monospace; font-weight: bold; background: #f1f5f9; padding: 2px 6px; border-radius: 4px;">#${escapeHtml(data.ticketNumber)}</span>).
    </p>

    <!-- Admin Message Box -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 20px 0; background-color: #f0fdf4; border: 1px solid #86efac; border-radius: 12px; padding: 18px 20px;">
      <tr>
        <td>
          <p style="margin: 0 0 6px 0; font-size: 12px; font-weight: 700; color: #166534; text-transform: uppercase; letter-spacing: 0.5px;">
            Message from ${escapeHtml(data.adminName || 'Support Team')}:
          </p>
          <div style="font-size: 14px; color: #1e293b; line-height: 1.6; white-space: pre-wrap;">
${escapeHtml(data.adminReply)}
          </div>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 16px 0; font-size: 13px; color: #475569; line-height: 1.6;">
      If you need any further assistance, you can reply directly inside the <strong>Feedback & Support History</strong> section in the app, or email us at <a href="mailto:${escapeHtml(APP_CONFIG.supportEmail)}" style="color: #047857; text-decoration: underline; font-weight: 600;">${escapeHtml(APP_CONFIG.supportEmail)}</a>.
    </p>

    <!-- Quick Link Button to App -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 12px 0 24px 0;">
      <tr>
        <td align="center">
          <table role="presentation" border="0" cellpadding="0" cellspacing="0">
            <tr>
              <td align="center" style="border-radius: 10px; background-color: #047857; text-align: center;">
                <a href="${escapeHtml(APP_CONFIG.appLoginUrl)}" target="_blank" rel="noopener noreferrer" style="display: inline-block; background-color: #047857; color: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 700; line-height: 1; text-decoration: none; padding: 13px 28px; border-radius: 10px; border: 1px solid #047857;">
                  View Ticket in App &rarr;
                </a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 4px 0; font-size: 13px; color: #64748b;">
      Warm regards,
    </p>
    <p style="margin: 0; font-size: 14px; font-weight: 700; color: #065f46;">
      My Money Manager Support<br/>
      <span style="font-size: 12px; font-weight: 400; color: #64748b;">A product of ${escapeHtml(APP_CONFIG.companyName)}</span>
    </p>
  `;

  const html = wrapEmailHtml(subject, bodyContent);
  const text = `${APP_CONFIG.appName} Support Update\nA product of ${APP_CONFIG.companyName}\n--------------------------------------------------\n\nUpdate regarding your ${ticketLabel} #${data.ticketNumber}\n\n${greeting}\n\nOur support team has reviewed your ${ticketLabel} regarding "${data.originalSubject}".\n\nMessage from ${data.adminName || 'Support Team'}:\n${data.adminReply}\n\nIf you need any further assistance, you can reply in the app or contact our support team at ${APP_CONFIG.supportEmail}.\n\nRegards,\nMy Money Manager Support\nA product of ${APP_CONFIG.companyName}\n`;
  return { subject, html, text };
}
