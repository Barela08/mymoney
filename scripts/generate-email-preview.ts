import { generateWelcomeEmail } from '../server/welcomeEmailTemplate';
import { APP_CONFIG } from '../server/config';
import fs from 'fs';
import path from 'path';

function createEmailPreviews() {
  const previewData = [
    { name: 'Nilesh', email: 'barelanilesh483@gmail.com', filename: 'preview-nilesh.html' },
    { name: 'Rahul', email: 'rahul@example.com', filename: 'preview-rahul.html' },
    { name: 'Aman', email: 'aman@example.com', filename: 'preview-aman.html' },
    { name: '', email: 'guest@example.com', filename: 'preview-fallback.html' },
  ];

  for (const item of previewData) {
    const email = generateWelcomeEmail({
      userName: item.name,
      userEmail: item.email,
      logoSrc: '/logo.jpg', // For browser viewing
      loginUrl: APP_CONFIG.appLoginUrl,
      supportEmail: APP_CONFIG.supportEmail,
      supportPhone: APP_CONFIG.supportPhone,
    });

    const outPath = path.resolve(process.cwd(), 'public', item.filename);
    fs.writeFileSync(outPath, email.html, 'utf8');
    console.log(`Saved email preview: ${outPath}`);
  }

  // Also write the primary preview as public/welcome-email-preview.html
  const primaryEmail = generateWelcomeEmail({
    userName: 'Nilesh',
    userEmail: 'barelanilesh483@gmail.com',
    logoSrc: '/logo.jpg',
    loginUrl: APP_CONFIG.appLoginUrl,
    supportEmail: APP_CONFIG.supportEmail,
    supportPhone: APP_CONFIG.supportPhone,
  });

  const primaryOut = path.resolve(process.cwd(), 'public', 'welcome-email-preview.html');
  fs.writeFileSync(primaryOut, primaryEmail.html, 'utf8');
  console.log(`Primary preview ready at: ${primaryOut}`);
}

createEmailPreviews();
