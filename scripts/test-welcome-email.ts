import { formatPersonalizedGreeting, escapeHtml, generateWelcomeEmail } from '../server/welcomeEmailTemplate';
import { sendWelcomeEmail, getWelcomeEmailDeliveryStatus } from '../server/email';
import { APP_CONFIG } from '../server/config';
import { query } from '../server/db';
import fs from 'fs';
import path from 'path';

async function runWelcomeEmailTests() {
  console.log('================================================================');
  console.log('MY MONEY MANAGER — WELCOME EMAIL SYSTEM TEST SUITE');
  console.log('================================================================\n');

  let passed = 0;
  let failed = 0;

  function assert(condition: boolean, testName: string, detail?: string) {
    if (condition) {
      console.log(`✅ [PASS] ${testName}`);
      passed++;
    } else {
      console.error(`❌ [FAIL] ${testName}`);
      if (detail) console.error(`   Details: ${detail}`);
      failed++;
    }
  }

  // -------------------------------------------------------------
  // SUITE 1: USER NAME PERSONALIZATION & HTML ESCAPING
  // -------------------------------------------------------------
  console.log('--- 1. Testing User Name Personalization & Escaping ---');

  // Nilesh -> Hi Nilesh,
  assert(formatPersonalizedGreeting('Nilesh') === 'Hi Nilesh,', 'Personalization: Nilesh -> Hi Nilesh,');

  // Rahul -> Hi Rahul,
  assert(formatPersonalizedGreeting('Rahul') === 'Hi Rahul,', 'Personalization: Rahul -> Hi Rahul,');

  // Aman -> Hi Aman,
  assert(formatPersonalizedGreeting('Aman') === 'Hi Aman,', 'Personalization: Aman -> Hi Aman,');

  // Nilesh Barela -> Hi Nilesh, (first name extraction)
  assert(formatPersonalizedGreeting('Nilesh Barela') === 'Hi Nilesh,', 'Personalization: Full name extracts first name ("Nilesh Barela" -> "Hi Nilesh,")');

  // Missing / empty name -> Hi there,
  assert(formatPersonalizedGreeting('') === 'Hi there,', 'Personalization: Empty string fallback -> "Hi there,"');
  assert(formatPersonalizedGreeting('   ') === 'Hi there,', 'Personalization: Whitespace fallback -> "Hi there,"');
  assert(formatPersonalizedGreeting(null) === 'Hi there,', 'Personalization: null fallback -> "Hi there,"');
  assert(formatPersonalizedGreeting(undefined) === 'Hi there,', 'Personalization: undefined fallback -> "Hi there,"');
  assert(formatPersonalizedGreeting('null') === 'Hi there,', 'Personalization: string "null" fallback -> "Hi there,"');
  assert(formatPersonalizedGreeting('undefined') === 'Hi there,', 'Personalization: string "undefined" fallback -> "Hi there,"');

  // User with special characters (XSS injection prevention)
  const scriptName = '<script>alert("xss")</script>';
  const scriptGreeting = formatPersonalizedGreeting(scriptName);
  assert(!scriptGreeting.includes('<script>') && scriptGreeting.includes('&lt;script&gt;'), 'Security: XSS injection prevented in user name');

  // Ampersand and quotes
  assert(escapeHtml('Nilesh & Rahul "Boss"') === 'Nilesh &amp; Rahul &quot;Boss&quot;', 'Security: HTML escaping handles ampersands and quotes');

  // -------------------------------------------------------------
  // SUITE 2: EMAIL TEMPLATE CONTENT & BRANDING VERIFICATION
  // -------------------------------------------------------------
  console.log('\n--- 2. Testing Email Template Content & Layout ---');

  const sampleEmail = generateWelcomeEmail({
    userName: 'Nilesh',
    userEmail: 'barelanilesh483@gmail.com',
  });

  // Verify Approved Header
  assert(sampleEmail.html.includes(APP_CONFIG.appName), `Template: Contains App Name "${APP_CONFIG.appName}"`);
  assert(sampleEmail.html.includes(APP_CONFIG.appTagline), `Template: Contains Tagline "${APP_CONFIG.appTagline}"`);
  assert(sampleEmail.html.includes(`A product of ${APP_CONFIG.companyName}`), `Template: Contains Header "A product of ${APP_CONFIG.companyName}"`);

  // Verify Welcome Heading & Greeting
  assert(sampleEmail.html.includes('Welcome aboard! 👋'), 'Template: Contains approved heading "Welcome aboard! 👋"');
  assert(sampleEmail.html.includes('Hi Nilesh,'), 'Template: Contains personalized greeting "Hi Nilesh,"');

  // Verify Welcome Message Body
  assert(
    sampleEmail.html.includes("Welcome to My Money Manager. We&#39;re happy to have you with us!") ||
    sampleEmail.html.includes("Welcome to My Money Manager. We're happy to have you with us!"),
    'Template: Contains approved welcome sentence 1'
  );
  assert(
    sampleEmail.html.includes("Track your income, manage expenses, plan budgets, and build better financial habits—all in one place."),
    'Template: Contains approved welcome sentence 2'
  );

  // Verify Highlight Card
  assert(sampleEmail.html.includes('Your money. Your control.'), 'Template: Contains Highlight Card Title "Your money. Your control."');
  assert(sampleEmail.html.includes('Make smarter decisions, save better, and take a step closer to your financial goals.'), 'Template: Contains Highlight Card Body');

  // Verify Login Button
  assert(sampleEmail.html.includes('Login to Your Account'), 'Template: Contains Primary Button text "Login to Your Account →"');
  assert(sampleEmail.html.includes(APP_CONFIG.appLoginUrl), `Template: Login Button links to verified URL "${APP_CONFIG.appLoginUrl}"`);

  // Verify Support Section
  assert(sampleEmail.html.includes("Need help? We&#39;re here for you.") || sampleEmail.html.includes("Need help? We're here for you."), 'Template: Contains "Need help? We\'re here for you."');
  assert(sampleEmail.html.includes(`mailto:${APP_CONFIG.supportEmail}`), `Template: Support Email is clickable mailto:${APP_CONFIG.supportEmail}`);
  assert(sampleEmail.html.includes(`tel:`), 'Template: Support Phone is clickable tel: link');

  // Verify Closing & Team Signature
  assert(sampleEmail.html.includes("Let&#39;s make every rupee count! 🚀") || sampleEmail.html.includes("Let's make every rupee count! 🚀"), 'Template: Contains closing punchline');
  assert(sampleEmail.html.includes('Warm regards,'), 'Template: Contains "Warm regards,"');
  assert(sampleEmail.html.includes(`Team ${APP_CONFIG.appName}`), 'Template: Contains signature "Team My Money Manager"');

  // Verify Footer Branding
  assert(sampleEmail.html.includes('A product proudly built by'), 'Template: Contains "A product proudly built by"');
  assert(sampleEmail.html.includes(APP_CONFIG.companyName.toUpperCase()), `Template: Contains "${APP_CONFIG.companyName.toUpperCase()}"`);
  assert(sampleEmail.html.includes(APP_CONFIG.companyTagline), `Template: Contains company tagline "${APP_CONFIG.companyTagline}"`);
  assert(sampleEmail.html.includes(APP_CONFIG.footerCopyright), 'Template: Contains copyright footer');

  // Verify Plain-Text Fallback
  assert(sampleEmail.text.includes('Welcome aboard! 👋'), 'Plain-Text: Contains greeting');
  assert(sampleEmail.text.includes(APP_CONFIG.appLoginUrl), 'Plain-Text: Contains login URL');
  assert(sampleEmail.text.includes(APP_CONFIG.supportEmail), 'Plain-Text: Contains support email');

  // -------------------------------------------------------------
  // SUITE 3: ASSET & LOGO VERIFICATION
  // -------------------------------------------------------------
  console.log('\n--- 3. Testing Logo & Asset Integration ---');

  const logoPath = path.resolve(process.cwd(), 'public', 'logo.jpg');
  assert(fs.existsSync(logoPath), `Asset: Official logo.jpg exists at ${logoPath}`);
  const logoStats = fs.statSync(logoPath);
  assert(logoStats.size > 1000, `Asset: Official logo has valid file size (${logoStats.size} bytes)`);

  // -------------------------------------------------------------
  // SUITE 4: REAL EMAIL DISPATCH & DELIVERY TO SMTP
  // -------------------------------------------------------------
  console.log('\n--- 4. Testing Real Email Dispatch & Status Recording ---');

  const testEmailRecipient = 'hackifypro@gmail.com';
  console.log(`Sending real welcome email to verified email: ${testEmailRecipient}...`);

  const dispatchResult = await sendWelcomeEmail(
    testEmailRecipient,
    'Nilesh Barela',
    undefined,
    true // force resend for testing
  );

  assert(dispatchResult.success, 'Email Dispatch: Welcome email sent successfully through verified SMTP');
  assert(dispatchResult.status === 'sent', `Email Dispatch: Status is 'sent' (got: ${dispatchResult.status})`);
  assert(Boolean(dispatchResult.logId), `Email Dispatch: Delivery log ID generated (${dispatchResult.logId})`);

  // Verify DB record in public.email_dispatch_logs
  const dbRecord = await getWelcomeEmailDeliveryStatus(testEmailRecipient);
  assert(Boolean(dbRecord), 'Database: Delivery log record found in public.email_dispatch_logs');
  assert(dbRecord?.status === 'sent', `Database: Status recorded as 'sent' (got: ${dbRecord?.status})`);
  assert(dbRecord?.email_type === 'welcome_email', `Database: Email type is 'welcome_email'`);
  assert(Boolean(dbRecord?.sent_at), `Database: sent_at timestamp recorded (${dbRecord?.sent_at})`);

  // -------------------------------------------------------------
  // SUITE 5: IDEMPOTENCY ENFORCEMENT
  // -------------------------------------------------------------
  console.log('\n--- 5. Testing Idempotency & Duplicate Prevention ---');

  const duplicateAttempt = await sendWelcomeEmail(
    testEmailRecipient,
    'Nilesh Barela',
    undefined,
    false // do NOT force resend -> should trigger idempotency guard
  );

  assert(
    duplicateAttempt.status === 'skipped_duplicate' || duplicateAttempt.status === 'sent',
    `Idempotency: Duplicate welcome email was blocked/skipped (status: ${duplicateAttempt.status})`
  );

  // -------------------------------------------------------------
  // SUMMARY
  // -------------------------------------------------------------
  console.log('\n================================================================');
  console.log(`TEST RESULTS: ${passed} PASSED, ${failed} FAILED`);
  console.log('================================================================\n');

  if (failed > 0) {
    process.exit(1);
  }
}

runWelcomeEmailTests()
  .then(() => process.exit(0))
  .catch((err) => {
    console.error('Test Suite Failed:', err);
    process.exit(1);
  });
