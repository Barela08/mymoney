import { APP_CONFIG } from './config';

/**
 * Escapes HTML characters to prevent email HTML injection
 */
export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Generates personalized greeting following strict user name rules:
 * - Nilesh -> "Hi Nilesh,"
 * - Rahul -> "Hi Rahul,"
 * - Aman -> "Hi Aman,"
 * - Nilesh Barela -> "Hi Nilesh," (extract first name)
 * - Missing/Empty/Invalid/Null -> "Hi there,"
 */
export function formatPersonalizedGreeting(rawName?: string | null): string {
  if (!rawName || typeof rawName !== 'string') {
    return 'Hi there,';
  }
  const trimmed = rawName.trim();
  if (
    !trimmed ||
    trimmed.toLowerCase() === 'null' ||
    trimmed.toLowerCase() === 'undefined' ||
    trimmed.toLowerCase() === 'none' ||
    trimmed.toLowerCase() === 'nan'
  ) {
    return 'Hi there,';
  }

  // Extract first name if multi-word
  const firstName = trimmed.split(/\s+/)[0];
  if (!firstName || firstName.length === 0) {
    return 'Hi there,';
  }

  // Check if firstName contains actual letters
  if (!/[a-zA-Z\u00C0-\u024F\u0900-\u097F]/.test(firstName)) {
    return 'Hi there,';
  }

  const cleanName = escapeHtml(firstName);
  return `Hi ${cleanName},`;
}

export interface WelcomeEmailData {
  userName?: string | null;
  userEmail: string;
  loginUrl?: string;
  logoSrc?: string;
  supportEmail?: string;
  supportPhone?: string;
}

/**
 * Generates the approved Premium Welcome Email HTML and Plain-Text content
 */
export function generateWelcomeEmail(data: WelcomeEmailData): {
  subject: string;
  html: string;
  text: string;
} {
  const greeting = formatPersonalizedGreeting(data.userName);
  const plainGreeting = greeting;
  const loginUrl = data.loginUrl || APP_CONFIG.appLoginUrl;
  const logoSrc = data.logoSrc || (APP_CONFIG.appLogoUrl || 'cid:app_logo');
  const supportEmail = data.supportEmail || APP_CONFIG.supportEmail;
  const supportPhone = data.supportPhone || APP_CONFIG.supportPhone;
  const supportPhoneClean = (supportPhone || '').replace(/[^\d+]/g, '');

  const subject = `Welcome aboard! 👋 - ${APP_CONFIG.appName}`;

  // 1. Table-based HTML Email Template with Inline CSS for Gmail, Outlook, Apple Mail & Mobile
  const html = `<!DOCTYPE html PUBLIC "-//W3C//DTD XHTML 1.0 Transitional//EN" "http://www.w3.org/TR/xhtml1/DTD/xhtml1-transitional.dtd">
<html xmlns="http://www.w3.org/1999/xhtml" lang="en">
<head>
  <meta http-equiv="Content-Type" content="text/html; charset=UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <meta name="x-apple-disable-message-reformatting" />
  <title>${escapeHtml(APP_CONFIG.appName)} - Welcome Aboard</title>
  <!--[if mso]>
  <style type="text/css">
    body, table, td, a, span { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif !important; }
  </style>
  <![endif]-->
  <style type="text/css">
    /* Client-specific Resets */
    body, table, td, a { -webkit-text-size-adjust: 100%; -ms-text-size-adjust: 100%; }
    table, td { mso-table-lspace: 0pt; mso-table-rspace: 0pt; }
    img { -ms-interpolation-mode: bicubic; border: 0; outline: none; text-decoration: none; }
    body { margin: 0; padding: 0; width: 100% !important; min-width: 100%; background-color: #f4f7f5; }

    /* Interactive button styles */
    .btn-link:hover {
      background-color: #065f46 !important;
    }

    /* Mobile Responsive */
    @media only screen and (max-width: 600px) {
      .container-table {
        width: 100% !important;
        border-radius: 0px !important;
        border-left: none !important;
        border-right: none !important;
      }
      .content-padding {
        padding: 24px 20px !important;
      }
      .header-padding {
        padding: 28px 20px 20px 20px !important;
      }
      .highlight-card {
        padding: 16px 18px !important;
      }
      .support-box {
        padding: 16px 18px !important;
      }
      .btn-cell {
        display: block !important;
        width: 100% !important;
      }
      .btn-link {
        display: block !important;
        padding: 14px 20px !important;
      }
    }
  </style>
</head>
<body style="margin: 0; padding: 0; background-color: #f4f7f5; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; -webkit-font-smoothing: antialiased; color: #1e293b;">

  <!-- Outer wrapper table -->
  <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="background-color: #f4f7f5; min-height: 100%; padding: 32px 12px;">
    <tr>
      <td align="center" valign="top">

        <!--[if (gte mso 9)|(IE)]>
        <table align="center" border="0" cellspacing="0" cellpadding="0" width="580">
        <tr>
        <td align="center" valign="top" width="580">
        <![endif]-->

        <!-- Email Container Card -->
        <table role="presentation" class="container-table" border="0" cellpadding="0" cellspacing="0" width="100%" style="max-width: 580px; background-color: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; box-shadow: 0 4px 14px rgba(0, 0, 0, 0.04); overflow: hidden; margin: 0 auto;">

          <!-- 1. BRANDING & HEADER SECTION -->
          <tr>
            <td class="header-padding" align="center" style="padding: 36px 32px 24px 32px; background-color: #ffffff; text-align: center;">
              
              <!-- 1. App Logo -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" style="margin: 0 auto;">
                <tr>
                  <td align="center">
                    <img src="${logoSrc}" alt="${escapeHtml(APP_CONFIG.appName)} Logo" width="64" height="64" style="display: block; width: 64px; height: 64px; border-radius: 14px; object-fit: cover; border: 1px solid #e2e8f0;" />
                  </td>
                </tr>
              </table>

              <!-- 2. Brand Name -->
              <h1 style="margin: 14px 0 0 0; font-size: 22px; font-weight: 800; color: #065f46; letter-spacing: -0.3px; line-height: 1.3;">
                ${escapeHtml(APP_CONFIG.appName)}
              </h1>

              <!-- 3. Tagline -->
              <p style="margin: 4px 0 0 0; font-size: 13px; font-weight: 500; color: #475569; letter-spacing: 0.1px;">
                ${escapeHtml(APP_CONFIG.appTagline)}
              </p>

              <!-- 4. Subtle A product of HackifyPro -->
              <p style="margin: 8px 0 0 0; font-size: 11px; font-weight: 600; color: #047857; text-transform: uppercase; letter-spacing: 0.8px;">
                A product of ${escapeHtml(APP_CONFIG.companyName)}
              </p>

            </td>
          </tr>

          <!-- 5. Divider -->
          <tr>
            <td style="padding: 0 32px;">
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                <tr>
                  <td style="border-top: 1px solid #e2e8f0; font-size: 1px; line-height: 1px;">&nbsp;</td>
                </tr>
              </table>
            </td>
          </tr>

          <!-- MAIN CONTENT SECTION -->
          <tr>
            <td class="content-padding" style="padding: 28px 32px 32px 32px;">

              <!-- 6. Welcome Heading -->
              <h2 style="margin: 0 0 16px 0; font-size: 20px; font-weight: 700; color: #0f172a; line-height: 1.3;">
                Welcome aboard! 👋
              </h2>

              <!-- 7. Personalized User Greeting -->
              <p style="margin: 0 0 14px 0; font-size: 15px; font-weight: 600; color: #065f46; line-height: 1.5;">
                ${greeting}
              </p>

              <!-- 8. Short Welcome Message -->
              <p style="margin: 0 0 12px 0; font-size: 14px; font-weight: 400; color: #334155; line-height: 1.6;">
                Welcome to ${escapeHtml(APP_CONFIG.appName)}. We&#39;re happy to have you with us!
              </p>
              <p style="margin: 0 0 20px 0; font-size: 14px; font-weight: 400; color: #334155; line-height: 1.6;">
                Your money management journey just got simpler. Track your income, manage expenses, plan budgets, and build better financial habits—all in one place.
              </p>

              <!-- 9. Small Highlighted Message Card -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="highlight-card" style="margin: 0 0 24px 0; background-color: #f0fdf4; border: 1px solid #bbf7d0; border-radius: 12px; padding: 18px 20px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 6px 0; font-size: 14px; font-weight: 700; color: #065f46; line-height: 1.4;">
                      Your money. Your control.
                    </p>
                    <p style="margin: 0; font-size: 13px; font-weight: 400; color: #166534; line-height: 1.5;">
                      Make smarter decisions, save better, and take a step closer to your financial goals.
                    </p>
                  </td>
                </tr>
              </table>

              <!-- 10. Primary Button (Bulletproof table button for all email clients) -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 8px 0 28px 0;">
                <tr>
                  <td align="center">
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0">
                      <tr>
                        <td align="center" class="btn-cell" style="border-radius: 10px; background-color: #047857; text-align: center;">
                          <a href="${loginUrl}" target="_blank" rel="noopener noreferrer" class="btn-link" style="display: inline-block; background-color: #047857; color: #ffffff !important; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; font-size: 14px; font-weight: 700; line-height: 1; text-decoration: none; padding: 14px 32px; border-radius: 10px; border: 1px solid #047857; letter-spacing: 0.2px; text-align: center;">
                            Login to Your Account &rarr;
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- 11. Support Section -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" class="support-box" style="margin: 0 0 24px 0; background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px;">
                <tr>
                  <td>
                    <p style="margin: 0 0 6px 0; font-size: 13px; font-weight: 700; color: #0f172a; line-height: 1.4;">
                      Need help? We&#39;re here for you.
                    </p>
                    <p style="margin: 0 0 12px 0; font-size: 12px; font-weight: 400; color: #475569; line-height: 1.5;">
                      If you have any questions or need assistance, contact our support team.
                    </p>
                    <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%">
                      <tr>
                        <td style="font-size: 12px; color: #334155; line-height: 1.6;">
                          <strong style="color: #0f172a;">Support Email:</strong> 
                          <a href="mailto:${escapeHtml(supportEmail)}" style="color: #047857; text-decoration: underline; font-weight: 600;">
                            ${escapeHtml(supportEmail)}
                          </a>
                        </td>
                      </tr>
                      <tr>
                        <td style="font-size: 12px; color: #334155; line-height: 1.6; padding-top: 4px;">
                          <strong style="color: #0f172a;">Support Phone:</strong> 
                          <a href="tel:${escapeHtml(supportPhoneClean)}" style="color: #047857; text-decoration: underline; font-weight: 600;">
                            ${escapeHtml(supportPhone)}
                          </a>
                        </td>
                      </tr>
                    </table>
                  </td>
                </tr>
              </table>

              <!-- 12. Closing Message & 13. Team Signature -->
              <p style="margin: 0 0 14px 0; font-size: 14px; font-weight: 500; color: #1e293b; line-height: 1.5;">
                Let&#39;s make every rupee count! 🚀
              </p>
              <p style="margin: 0 0 4px 0; font-size: 13px; font-weight: 400; color: #64748b; line-height: 1.5;">
                Warm regards,
              </p>
              <p style="margin: 0; font-size: 14px; font-weight: 700; color: #065f46; line-height: 1.5;">
                Team ${escapeHtml(APP_CONFIG.appName)}
              </p>

            </td>
          </tr>

          <!-- 14. FOOTER: HackifyPro Branding Footer & 15. Copyright -->
          <tr>
            <td align="center" style="padding: 24px 32px; background-color: #f1f5f9; border-top: 1px solid #e2e8f0; text-align: center;">
              
              <p style="margin: 0 0 4px 0; font-size: 11px; font-weight: 600; color: #64748b; text-transform: uppercase; letter-spacing: 0.6px;">
                A product proudly built by
              </p>
              <p style="margin: 0 0 4px 0; font-size: 13px; font-weight: 800; color: #065f46; letter-spacing: 0.8px;">
                ${escapeHtml(APP_CONFIG.companyName.toUpperCase())}
              </p>
              <p style="margin: 0 0 14px 0; font-size: 11px; font-style: italic; color: #64748b;">
                ${escapeHtml(APP_CONFIG.companyTagline)}
              </p>

              <!-- Divider line in footer -->
              <table role="presentation" border="0" cellpadding="0" cellspacing="0" width="100%" style="margin: 0 0 12px 0;">
                <tr>
                  <td style="border-top: 1px solid #cbd5e1; font-size: 1px; line-height: 1px;">&nbsp;</td>
                </tr>
              </table>

              <!-- Copyright -->
              <p style="margin: 0; font-size: 11px; font-weight: 400; color: #94a3b8; line-height: 1.4;">
                ${escapeHtml(APP_CONFIG.footerCopyright)}
              </p>

            </td>
          </tr>

        </table>

        <!--[if (gte mso 9)|(IE)]>
        </td>
        </tr>
        </table>
        <![endif]-->

      </td>
    </tr>
  </table>

</body>
</html>`;

  // 2. Clean Plain-Text Fallback
  const text = `${APP_CONFIG.appName}
${APP_CONFIG.appTagline}
A product of ${APP_CONFIG.companyName}
--------------------------------------------------

Welcome aboard! 👋

${plainGreeting}

Welcome to ${APP_CONFIG.appName}. We're happy to have you with us!

Your money management journey just got simpler. Track your income, manage expenses, plan budgets, and build better financial habits—all in one place.

--------------------------------------------------
Your money. Your control.
Make smarter decisions, save better, and take a step closer to your financial goals.
--------------------------------------------------

Login to Your Account:
${loginUrl}

--------------------------------------------------
Need help? We're here for you.
If you have any questions or need assistance, contact our support team.

Support Email: ${supportEmail}
Support Phone: ${supportPhone}

Let's make every rupee count! 🚀

Warm regards,
Team ${APP_CONFIG.appName}

--------------------------------------------------
A product proudly built by
${APP_CONFIG.companyName.toUpperCase()}
${APP_CONFIG.companyTagline}

${APP_CONFIG.footerCopyright}
`;

  return { subject, html, text };
}
