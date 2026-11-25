import { APP_CONFIG } from './config.js';

/**
 * Escapes HTML characters safely to prevent XSS in email bodies
 */
function escapeHtml(text?: string | number | null): string {
  if (text === null || text === undefined) return '';
  return String(text)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function formatGreeting(name?: string | null): string {
  const clean = (name || '').trim();
  return clean ? `Hello ${escapeHtml(clean)},` : 'Hello,';
}

function wrapEmailHtml(subject: string, contentHtml: string): string {
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${escapeHtml(subject)}</title>
</head>
<body style="margin: 0; padding: 0; background-color: #f8fafc; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b; -webkit-font-smoothing: antialiased;">
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f8fafc; padding: 24px 12px;">
    <tr>
      <td align="center">
        <!-- Main Card -->
        <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 560px; background-color: #ffffff; border-radius: 20px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0, 0, 0, 0.05);">
          <!-- Green Header Banner -->
          <tr>
            <td style="background-color: #065f46; padding: 28px 32px; text-align: left;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td>
                    <h1 style="margin: 0; font-size: 20px; font-weight: 800; color: #ffffff; letter-spacing: -0.5px;">
                      ${escapeHtml(APP_CONFIG.appName)}
                    </h1>
                    <p style="margin: 4px 0 0 0; font-size: 12px; font-weight: 500; color: #a7f3d0; text-transform: uppercase; letter-spacing: 0.5px;">
                      Powered by ${escapeHtml(APP_CONFIG.companyName)}
                    </p>
                  </td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- Email Body Content -->
          <tr>
            <td style="padding: 32px 32px 28px 32px;">
              ${contentHtml}
            </td>
          </tr>

          <!-- Footer -->
          <tr>
            <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px 32px; text-align: center;">
              <p style="margin: 0 0 6px 0; font-size: 12px; color: #64748b; font-weight: 600;">
                Support: <a href="mailto:${escapeHtml(APP_CONFIG.supportEmail)}" style="color: #047857; text-decoration: none;">${escapeHtml(APP_CONFIG.supportEmail)}</a> | WhatsApp: <a href="https://wa.me/917414935405" style="color: #047857; text-decoration: none;">+91 74149 35405</a>
              </p>
              <p style="margin: 0; font-size: 11px; color: #94a3b8;">
                &copy; ${new Date().getFullYear()} ${escapeHtml(APP_CONFIG.appName)}. All rights reserved.
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
// 1. UDHAR CREATED — INITIATOR (PERSON A)
// -----------------------------------------------------------------------------
export function generateUdharCreatedEmailForInitiator(data: {
  userName: string;
  transactionId: string;
  otherPersonName: string;
  amount: number;
  gaveOrReceived: string; // e.g. "Gave (You Lent)" or "Took (You Borrowed)"
  description?: string;
  transactionDate: string;
  status: string;
}): { subject: string; html: string; text: string } {
  const greeting = formatGreeting(data.userName);
  const subject = `Udhar Entry Added – ${APP_CONFIG.appName}`;
  const formattedAmt = data.amount.toLocaleString('en-IN');
  const desc = data.description || 'Personal loan / Udhar';

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 19px; font-weight: 700; color: #0f172a;">
      Udhar Entry Recorded
    </h2>
    <p style="margin: 0 0 16px 0; font-size: 15px; font-weight: 600; color: #065f46;">
      ${greeting}
    </p>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #334155; line-height: 1.6;">
      Your Udhar entry has been successfully recorded.
    </p>

    <!-- Details Card -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px 0; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 18px 20px;">
      <tr>
        <td>
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: 0.5px;">
            Transaction Details
          </h3>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0; width: 38%;">Transaction ID:</td>
              <td style="font-size: 13px; font-family: monospace; font-weight: 700; color: #0f172a; padding: 4px 0;">#${escapeHtml(data.transactionId)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Person:</td>
              <td style="font-size: 13px; font-weight: 700; color: #0f172a; padding: 4px 0;">${escapeHtml(data.otherPersonName)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Amount:</td>
              <td style="font-size: 15px; font-weight: 800; color: #047857; padding: 4px 0;">₹${escapeHtml(formattedAmt)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Type:</td>
              <td style="font-size: 13px; font-weight: 700; color: #0f172a; padding: 4px 0;">${escapeHtml(data.gaveOrReceived)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Description:</td>
              <td style="font-size: 13px; color: #334155; padding: 4px 0;">${escapeHtml(desc)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Date:</td>
              <td style="font-size: 13px; color: #334155; padding: 4px 0;">${escapeHtml(data.transactionDate)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Current Status:</td>
              <td style="font-size: 13px; font-weight: 700; color: #047857; padding: 4px 0; text-transform: capitalize;">${escapeHtml(data.status.replace(/_/g, ' '))}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
      The transaction has been saved in My Money Manager.
    </p>
  `;

  const html = wrapEmailHtml(subject, bodyContent);
  const text = `${APP_CONFIG.appName} — Udhar Entry Added\n--------------------------------------------------\n\nHello ${data.userName || 'User'},\n\nYour Udhar entry has been successfully recorded.\n\nTransaction Details:\n- Transaction ID: #${data.transactionId}\n- Person: ${data.otherPersonName}\n- Amount: ₹${formattedAmt}\n- Type: ${data.gaveOrReceived}\n- Description: ${desc}\n- Date: ${data.transactionDate}\n- Current Status: ${data.status}\n\nThe transaction has been saved in My Money Manager.\n\nRegards,\nTeam ${APP_CONFIG.appName}\n`;

  return { subject, html, text };
}

// -----------------------------------------------------------------------------
// 2. UDHAR CREATED — RECIPIENT / OTHER REGISTERED USER (PERSON B)
// -----------------------------------------------------------------------------
export function generateUdharCreatedEmailForRecipient(data: {
  recipientName: string;
  senderName: string;
  transactionId: string;
  amount: number;
  recipientTransactionType: string; // e.g. "Money Received (You Borrowed)" or "Money Given (You Lent)"
  description?: string;
  transactionDate: string;
  status: string;
}): { subject: string; html: string; text: string } {
  const greeting = formatGreeting(data.recipientName);
  const subject = `New Udhar Transaction Recorded – ${APP_CONFIG.appName}`;
  const formattedAmt = data.amount.toLocaleString('en-IN');
  const desc = data.description || 'Personal loan / Udhar';

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 19px; font-weight: 700; color: #0f172a;">
      New Udhar Transaction Involving Your Account
    </h2>
    <p style="margin: 0 0 16px 0; font-size: 15px; font-weight: 600; color: #065f46;">
      ${greeting}
    </p>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #334155; line-height: 1.6;">
      A Udhar transaction involving your account has been recorded in My Money Manager.
    </p>

    <!-- Details Card -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px 0; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 18px 20px;">
      <tr>
        <td>
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: 0.5px;">
            Transaction Details
          </h3>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0; width: 42%;">Transaction ID:</td>
              <td style="font-size: 13px; font-family: monospace; font-weight: 700; color: #0f172a; padding: 4px 0;">#${escapeHtml(data.transactionId)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Recorded By:</td>
              <td style="font-size: 13px; font-weight: 700; color: #0f172a; padding: 4px 0;">${escapeHtml(data.senderName)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Amount:</td>
              <td style="font-size: 15px; font-weight: 800; color: #047857; padding: 4px 0;">₹${escapeHtml(formattedAmt)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Transaction Type:</td>
              <td style="font-size: 13px; font-weight: 700; color: #0f172a; padding: 4px 0;">${escapeHtml(data.recipientTransactionType)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Description:</td>
              <td style="font-size: 13px; color: #334155; padding: 4px 0;">${escapeHtml(desc)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Date:</td>
              <td style="font-size: 13px; color: #334155; padding: 4px 0;">${escapeHtml(data.transactionDate)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Current Status:</td>
              <td style="font-size: 13px; font-weight: 700; color: #047857; padding: 4px 0; text-transform: capitalize;">${escapeHtml(data.status.replace(/_/g, ' '))}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin: 0 0 12px 0; font-size: 13px; color: #334155; line-height: 1.5;">
      Please open My Money Manager to review the details.
    </p>
    <p style="margin: 0 0 16px 0; font-size: 12px; color: #64748b; line-height: 1.5;">
      This notification is intended to keep both parties informed about their Udhar records.
    </p>
    <p style="margin: 0; font-size: 13px; color: #64748b;">
      Regards,<br>
      <strong style="color: #065f46;">My Money Manager — HackifyPro</strong>
    </p>
  `;

  const html = wrapEmailHtml(subject, bodyContent);
  const text = `${APP_CONFIG.appName} — New Udhar Transaction Recorded\n--------------------------------------------------\n\nHello ${data.recipientName || 'User'},\n\nA Udhar transaction involving your account has been recorded in My Money Manager.\n\nTransaction Details:\n- Transaction ID: #${data.transactionId}\n- Recorded By: ${data.senderName}\n- Amount: ₹${formattedAmt}\n- Transaction Type: ${data.recipientTransactionType}\n- Description: ${desc}\n- Date: ${data.transactionDate}\n- Current Status: ${data.status}\n\nPlease open My Money Manager to review the details.\nThis notification is intended to keep both parties informed about their Udhar records.\n\nRegards,\nMy Money Manager — HackifyPro\n`;

  return { subject, html, text };
}

// -----------------------------------------------------------------------------
// 3. UDHAR SETTLED / CLEARED (FOR BOTH REGISTERED USERS)
// -----------------------------------------------------------------------------
export function generateUdharSettledEmail(data: {
  userName: string;
  counterpartName: string;
  transactionId: string;
  amountSettled: number;
  settlementDate: string;
  updatedBalance: number;
  isLenderPerspective: boolean;
}): { subject: string; html: string; text: string } {
  const greeting = formatGreeting(data.userName);
  const subject = `Udhar Transaction Settled – ${APP_CONFIG.appName}`;
  const formattedAmt = data.amountSettled.toLocaleString('en-IN');
  const balanceText = data.updatedBalance <= 0.01 ? '₹0.00 (Fully Settled)' : `₹${data.updatedBalance.toLocaleString('en-IN')}`;

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 19px; font-weight: 700; color: #047857;">
      Udhar Settlement Confirmation
    </h2>
    <p style="margin: 0 0 16px 0; font-size: 15px; font-weight: 600; color: #065f46;">
      ${greeting}
    </p>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #334155; line-height: 1.6;">
      An Udhar settlement between you and <strong>${escapeHtml(data.counterpartName)}</strong> has been recorded.
    </p>

    <!-- Details Card -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px 0; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 18px 20px;">
      <tr>
        <td>
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: 0.5px;">
            Settlement Summary
          </h3>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0; width: 42%;">Transaction Ref:</td>
              <td style="font-size: 13px; font-family: monospace; font-weight: 700; color: #0f172a; padding: 4px 0;">#${escapeHtml(data.transactionId)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Person:</td>
              <td style="font-size: 13px; font-weight: 700; color: #0f172a; padding: 4px 0;">${escapeHtml(data.counterpartName)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Amount Settled:</td>
              <td style="font-size: 15px; font-weight: 800; color: #047857; padding: 4px 0;">₹${escapeHtml(formattedAmt)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Settlement Date:</td>
              <td style="font-size: 13px; color: #334155; padding: 4px 0;">${escapeHtml(data.settlementDate)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Updated Balance:</td>
              <td style="font-size: 14px; font-weight: 800; color: #065f46; padding: 4px 0;">${escapeHtml(balanceText)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Status:</td>
              <td style="font-size: 13px; font-weight: 700; color: #047857; padding: 4px 0;">Settled</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
      Your Udhar balance has been updated in My Money Manager.
    </p>
  `;

  const html = wrapEmailHtml(subject, bodyContent);
  const text = `${APP_CONFIG.appName} — Udhar Transaction Settled\n--------------------------------------------------\n\nHello ${data.userName || 'User'},\n\nAn Udhar settlement between you and ${data.counterpartName} has been recorded.\n\nSettlement Summary:\n- Transaction Ref: #${data.transactionId}\n- Person: ${data.counterpartName}\n- Amount Settled: ₹${formattedAmt}\n- Settlement Date: ${data.settlementDate}\n- Updated Balance: ${balanceText}\n- Status: Settled\n\nRegards,\nTeam ${APP_CONFIG.appName}\n`;

  return { subject, html, text };
}

// -----------------------------------------------------------------------------
// 4. UDHAR UPDATED EMAIL
// -----------------------------------------------------------------------------
export function generateUdharUpdatedEmail(data: {
  userName: string;
  counterpartName: string;
  transactionId: string;
  amount: number;
  gaveOrReceived: string;
  description?: string;
  transactionDate: string;
  status: string;
  isRecipientView: boolean;
}): { subject: string; html: string; text: string } {
  const greeting = formatGreeting(data.userName);
  const subject = data.isRecipientView
    ? `Udhar Transaction Updated – ${APP_CONFIG.appName}`
    : `Udhar Entry Updated – ${APP_CONFIG.appName}`;
  const formattedAmt = data.amount.toLocaleString('en-IN');
  const desc = data.description || 'Personal loan / Udhar';

  const bodyContent = `
    <h2 style="margin: 0 0 16px 0; font-size: 19px; font-weight: 700; color: #0f172a;">
      Udhar Transaction Updated
    </h2>
    <p style="margin: 0 0 16px 0; font-size: 15px; font-weight: 600; color: #065f46;">
      ${greeting}
    </p>
    <p style="margin: 0 0 20px 0; font-size: 14px; color: #334155; line-height: 1.6;">
      An Udhar transaction involving ${escapeHtml(data.counterpartName)} has been updated with latest records.
    </p>

    <!-- Details Card -->
    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 24px 0; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 18px 20px;">
      <tr>
        <td>
          <h3 style="margin: 0 0 12px 0; font-size: 13px; font-weight: 700; color: #065f46; text-transform: uppercase; letter-spacing: 0.5px;">
            Updated Transaction Details
          </h3>
          <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0; width: 42%;">Transaction ID:</td>
              <td style="font-size: 13px; font-family: monospace; font-weight: 700; color: #0f172a; padding: 4px 0;">#${escapeHtml(data.transactionId)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Person:</td>
              <td style="font-size: 13px; font-weight: 700; color: #0f172a; padding: 4px 0;">${escapeHtml(data.counterpartName)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Amount:</td>
              <td style="font-size: 15px; font-weight: 800; color: #047857; padding: 4px 0;">₹${escapeHtml(formattedAmt)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Transaction Type:</td>
              <td style="font-size: 13px; font-weight: 700; color: #0f172a; padding: 4px 0;">${escapeHtml(data.gaveOrReceived)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Description:</td>
              <td style="font-size: 13px; color: #334155; padding: 4px 0;">${escapeHtml(desc)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Date:</td>
              <td style="font-size: 13px; color: #334155; padding: 4px 0;">${escapeHtml(data.transactionDate)}</td>
            </tr>
            <tr>
              <td style="font-size: 13px; color: #64748b; padding: 4px 0;">Current Status:</td>
              <td style="font-size: 13px; font-weight: 700; color: #047857; padding: 4px 0; text-transform: capitalize;">${escapeHtml(data.status.replace(/_/g, ' '))}</td>
            </tr>
          </table>
        </td>
      </tr>
    </table>

    <p style="margin: 0; font-size: 13px; color: #64748b; line-height: 1.5;">
      Please open My Money Manager to review the updated entry.
    </p>
  `;

  const html = wrapEmailHtml(subject, bodyContent);
  const text = `${APP_CONFIG.appName} — Udhar Transaction Updated\n--------------------------------------------------\n\nHello ${data.userName || 'User'},\n\nAn Udhar transaction involving ${data.counterpartName} has been updated.\n\nUpdated Details:\n- Transaction ID: #${data.transactionId}\n- Person: ${data.counterpartName}\n- Amount: ₹${formattedAmt}\n- Type: ${data.gaveOrReceived}\n- Description: ${desc}\n- Date: ${data.transactionDate}\n- Current Status: ${data.status}\n\nRegards,\nTeam ${APP_CONFIG.appName}\n`;

  return { subject, html, text };
}
