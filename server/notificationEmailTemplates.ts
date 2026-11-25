import { APP_CONFIG } from './config.js';

export interface CampaignEmailData {
  userName: string;
  userEmail: string;
  title: string;
  message: string;
  category?: string;
  deepLink?: string;
  actionText?: string;
}

export function generateCampaignEmail(data: CampaignEmailData): { html: string; text: string } {
  const loginUrl = APP_CONFIG.appLoginUrl;
  const actionUrl = data.deepLink
    ? `${loginUrl.split('#')[0]}#${data.deepLink.replace(/^\//, '')}`
    : loginUrl;
  const actionText = data.actionText || 'Open My Money Manager';

  const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>${data.title}</title>
  <style>
    body {
      margin: 0;
      padding: 0;
      background-color: #f1f5f9;
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
      color: #1e293b;
      -webkit-font-smoothing: antialiased;
    }
    .wrapper {
      width: 100%;
      background-color: #f1f5f9;
      padding: 32px 16px;
    }
    .container {
      max-width: 580px;
      margin: 0 auto;
      background-color: #ffffff;
      border-radius: 20px;
      overflow: hidden;
      border: 1px solid #e2e8f0;
      box-shadow: 0 10px 25px -5px rgba(0, 0, 0, 0.05);
    }
    .header {
      background: linear-gradient(135deg, #065f46 0%, #047857 100%);
      padding: 32px 28px;
      text-align: center;
    }
    .header h1 {
      color: #ffffff;
      font-size: 22px;
      margin: 0;
      font-weight: 800;
      letter-spacing: -0.02em;
    }
    .header p {
      color: #a7f3d0;
      font-size: 13px;
      margin: 6px 0 0;
      font-weight: 500;
    }
    .badge {
      display: inline-block;
      background: rgba(255, 255, 255, 0.2);
      color: #ffffff;
      padding: 4px 12px;
      border-radius: 9999px;
      font-size: 11px;
      font-weight: 700;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 8px;
    }
    .content {
      padding: 32px 28px;
    }
    .greeting {
      font-size: 16px;
      font-weight: 700;
      color: #0f172a;
      margin-bottom: 16px;
    }
    .message-card {
      background-color: #f8fafc;
      border-left: 4px solid #059669;
      padding: 18px;
      border-radius: 0 12px 12px 0;
      margin: 20px 0;
      font-size: 14px;
      line-height: 1.6;
      color: #334155;
    }
    .btn-container {
      text-align: center;
      margin: 30px 0 20px;
    }
    .btn {
      display: inline-block;
      background-color: #059669;
      color: #ffffff !important;
      font-weight: 700;
      font-size: 14px;
      padding: 14px 32px;
      text-decoration: none;
      border-radius: 12px;
      box-shadow: 0 4px 12px rgba(5, 150, 105, 0.25);
    }
    .footer {
      background-color: #f8fafc;
      border-top: 1px solid #e2e8f0;
      padding: 24px;
      text-align: center;
      font-size: 12px;
      color: #64748b;
      line-height: 1.6;
    }
    .footer strong {
      color: #334155;
    }
  </style>
</head>
<body>
  <div class="wrapper">
    <div class="container">
      <div class="header">
        <div class="badge">${data.category || 'Notification'}</div>
        <h1>${APP_CONFIG.appName}</h1>
        <p>${APP_CONFIG.appTagline} · A product of ${APP_CONFIG.companyName}</p>
      </div>
      <div class="content">
        <div class="greeting">Hi ${data.userName || 'there'},</div>
        <h2 style="font-size: 18px; color: #0f172a; margin: 0 0 12px; font-weight: 800;">${data.title}</h2>
        <div class="message-card">
          ${data.message.replace(/\n/g, '<br/>')}
        </div>
        <div class="btn-container">
          <a href="${actionUrl}" class="btn">${actionText}</a>
        </div>
      </div>
      <div class="footer">
        <p><strong>${APP_CONFIG.appName}</strong> — ${APP_CONFIG.companyTagline}</p>
        <p>Support: <a href="mailto:${APP_CONFIG.supportEmail}" style="color: #059669;">${APP_CONFIG.supportEmail}</a> | WhatsApp: ${APP_CONFIG.supportPhone}</p>
        <p style="margin-top: 8px; font-size: 11px; color: #94a3b8;">
          You received this email because you are a registered user of ${APP_CONFIG.appName}. You can adjust your notification preferences anytime from the in-app Settings.
        </p>
        <p style="margin-top: 4px; font-size: 11px; color: #94a3b8;">${APP_CONFIG.footerCopyright}</p>
      </div>
    </div>
  </div>
</body>
</html>`;

  const text = `${data.title}
${APP_CONFIG.appName} · A product of ${APP_CONFIG.companyName}

Hi ${data.userName || 'there'},

${data.message}

Access your account here: ${actionUrl}

---
${APP_CONFIG.appName}
Support: ${APP_CONFIG.supportEmail}
${APP_CONFIG.footerCopyright}`;

  return { html, text };
}
