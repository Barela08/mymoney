export interface LegalPolicySection {
  title: string;
  content: string[];
}

export interface LegalPolicyItem {
  id: string;
  title: string;
  shortTitle: string;
  category: 'legal' | 'privacy' | 'security' | 'company';
  lastUpdated: string;
  summary: string;
  sections: LegalPolicySection[];
}

export const LEGAL_POLICIES: LegalPolicyItem[] = [
  // 1. PRIVACY POLICY
  {
    id: 'privacy_policy',
    title: 'Privacy Policy',
    shortTitle: 'Privacy Policy',
    category: 'privacy',
    lastUpdated: 'November 20, 2026',
    summary:
      'Details how My Money Manager collects, stores, processes, and protects your personal and financial information in compliance with the DPDP Act 2023.',
    sections: [
      {
        title: '1. Introduction & Scope',
        content: [
          'My Money Manager ("we", "our", or "the Application"), developed by HackifyPro, is committed to safeguarding the privacy and financial data of our users.',
          'This Privacy Policy applies to all personal, transaction, and account information collected through our web application, mobile interface, and associated backend APIs.',
          'By creating an account, registering an email, or recording financial transactions, you acknowledge and agree to the data collection and processing practices described herein.',
        ],
      },
      {
        title: '2. Information We Collect',
        content: [
          'Personal Identity Data: Your full name, registered email address, optional contact phone number, and avatar preference.',
          'Authentication Credentials: Cryptographically hashed passwords (using bcrypt with work factor 12). Plaintext passwords are never stored, logged, or visible to system administrators.',
          'Financial Records & Ledgers: Income entries, home and room expenses (groceries, rent, electricity, cooking gas), food and personal expenses, custom dynamic categories, and notes.',
          'Udhar (Lend / Borrow) Data: Money lent to others, money borrowed, due dates, repayment history, dispute notes, and saved contact names.',
          'Technical Audit Data: IP addresses, user agents, active session tokens, and security event logs to prevent brute-force attacks and unauthorized account access.',
        ],
      },
      {
        title: '3. Legal Basis & Purposes for Processing',
        content: [
          'We process your data strictly to provide core personal money management features, including calculating live cash flow, generating category charts, synchronizing multi-device sessions, and tracking debts.',
          'We do not sell, rent, monetize, or trade your personal or financial data to advertising networks, credit bureaus, or marketing intermediaries.',
          'All transaction data is processed under the lawful basis of user consent and contractual necessity pursuant to the Digital Personal Data Protection (DPDP) Act, 2023.',
        ],
      },
      {
        title: '4. Data Storage & Multi-Device Synchronization',
        content: [
          'Your account data is stored in dedicated PostgreSQL database tables hosted by Supabase with Row Level Security (RLS) policies.',
          'To ensure seamless offline availability, transactions are cached locally in your browser storage (localStorage) and synchronized when an active internet connection is detected.',
        ],
      },
      {
        title: '5. Your Rights as a Data Principal',
        content: [
          'Right to Access: You may view your complete transaction history, profile data, and saved contacts directly within the application.',
          'Right to Correction: You may update your profile name, contact phone, transaction details, and passwords anytime.',
          'Right to Data Portability: You can export your full transaction ledger as JSON or CSV files from Settings → Data & Privacy.',
          'Right to Erasure (Account Deletion): You may schedule your account for permanent deletion with a 24-hour cancellation safeguard under Settings → Account → Delete Account & Data.',
        ],
      },
    ],
  },

  // 2. TERMS & CONDITIONS
  {
    id: 'terms_conditions',
    title: 'Terms & Conditions',
    shortTitle: 'Terms & Conditions',
    category: 'legal',
    lastUpdated: 'November 20, 2026',
    summary:
      'The contractual agreement between you and HackifyPro governing your access and use of the My Money Manager platform.',
    sections: [
      {
        title: '1. Acceptance of Terms',
        content: [
          'By accessing or using My Money Manager, you agree to be bound by these Terms & Conditions and all applicable laws of India.',
          'If you do not agree with any portion of these terms, you must refrain from using the platform and delete your account.',
        ],
      },
      {
        title: '2. User Accounts & Responsibilities',
        content: [
          'You are responsible for maintaining the confidentiality of your login credentials and session tokens.',
          'You agree to notify us immediately of any unauthorized use or security compromise of your account.',
          'You must provide accurate and verifiable information during registration. Impersonating another person or creating fraudulent accounts is strictly prohibited.',
        ],
      },
      {
        title: '3. Acceptable Use Policy',
        content: [
          'You agree not to reverse engineer, decompile, spam, or probe vulnerabilities in the My Money Manager infrastructure.',
          'You shall not use the service for money laundering, recording fraudulent claims, or harassing other users through disputed Udhar entries.',
        ],
      },
      {
        title: '4. Service Availability & Modifications',
        content: [
          'We strive to maintain 99.9% uptime, but scheduled maintenance and unforeseen network disruptions may occur.',
          'HackifyPro reserves the right to modify or discontinue features with reasonable notice to users.',
        ],
      },
    ],
  },

  // 3. DISCLAIMER
  {
    id: 'disclaimer',
    title: 'Disclaimer & Financial Advice Disclosure',
    shortTitle: 'Disclaimer',
    category: 'legal',
    lastUpdated: 'November 20, 2026',
    summary:
      'Clarifies that My Money Manager is an informational bookkeeping utility and not a bank, NBFC, or SEBI-registered financial advisor.',
    sections: [
      {
        title: '1. Not a Financial Institution or Bank',
        content: [
          'My Money Manager is a personal bookkeeping and expense tracking utility software developed by HackifyPro.',
          'The application does not hold deposits, execute banking transfers, process payment settlements, or issue credit lines.',
          'All calculations, including balances, totals, and Splitwise debts, represent user-entered figures for personal budgeting only.',
        ],
      },
      {
        title: '2. No Investment or Tax Advice',
        content: [
          'Content, summary cards, and reports provided within the app do not constitute financial, investment, legal, or tax advice.',
          'You should consult a licensed Chartered Accountant (CA) or certified financial planner before making critical financial commitments.',
        ],
      },
      {
        title: '3. Limitation of Liability',
        content: [
          'HackifyPro and its developers shall not be liable for any discrepancies, calculation mismatches resulting from user input errors, or financial losses.',
        ],
      },
    ],
  },

  // 4. DATA COLLECTION & USAGE POLICY
  {
    id: 'data_collection',
    title: 'Data Collection & Usage Policy',
    shortTitle: 'Data Collection',
    category: 'privacy',
    lastUpdated: 'November 20, 2026',
    summary:
      'Transparent disclosure of every specific data point captured, its storage mechanism, and why it is necessary.',
    sections: [
      {
        title: '1. Explicit Data Fields Collected',
        content: [
          'Full Name: Used for personal identification and greeting across reports and receipts.',
          'Email Address: Used as the primary authentication identifier, for password reset dispatches, and for 24-hour account deletion notifications.',
          'Mobile Phone Number: Optional field used for contact discovery and Udhar matching.',
          'Financial Transactions: Category, subcategory, monetary amount in INR (₹), date, time (IST), description, and custom notes.',
          'Udhar Lend/Borrow Entries: Counterpart name, linked user reference, lent/borrowed flag, due date, dispute reasons, and repayment logs.',
        ],
      },
      {
        title: '2. Technical Diagnostics & Telemetry',
        content: [
          'Device & Browser Fingerprints: User-Agent strings and remote IP addresses recorded in security logs for brute-force prevention and session validation.',
          'No Third-Party Advertising Trackers: We do not load Google Analytics, Meta Pixel, or any behavioral ad networks.',
        ],
      },
    ],
  },

  // 5. COOKIE POLICY
  {
    id: 'cookie_policy',
    title: 'Cookie & Local Storage Policy',
    shortTitle: 'Cookie Policy',
    category: 'privacy',
    lastUpdated: 'November 20, 2026',
    summary:
      'Explains our use of strictly necessary session cookies and browser local storage for authentication and offline support.',
    sections: [
      {
        title: '1. Use of Strictly Necessary Cookies',
        content: [
          'session_token: An HttpOnly, SameSite=Lax cookie containing an encrypted cryptographic reference to your active server session.',
          'This cookie is essential for authenticating API requests and protecting against Cross-Site Request Forgery (CSRF).',
          'We do not use advertising, marketing, or behavioral tracking cookies.',
        ],
      },
      {
        title: '2. Web Storage (localStorage & sessionStorage)',
        content: [
          'my_money_auth_token: Holds the client-side session token for SPA API requests.',
          'my_money_transactions_real: Scoped offline cache storing your transaction records for instant rendering without network lag.',
          'my_money_theme: Preserves your visual preference (Light Mode vs Dark Mode).',
          'my_money_dpdp_consent: Stores your explicit consent choice under India DPDP Act 2023.',
        ],
      },
    ],
  },

  // 6. SECURITY POLICY
  {
    id: 'security_policy',
    title: 'Security & Vulnerability Management Policy',
    shortTitle: 'Security Policy',
    category: 'security',
    lastUpdated: 'November 20, 2026',
    summary:
      'Overview of technical safeguards, cryptographic standards, anti-IDOR checks, and incident response procedures.',
    sections: [
      {
        title: '1. Cryptographic Safeguards',
        content: [
          'Passwords are salted and hashed using bcrypt with 12 computational rounds on the server side.',
          'Session tokens and password reset tokens are generated using 32 bytes of cryptographically secure pseudorandom entropy (crypto.randomBytes) and stored as SHA-256 hashes.',
          'Transport Layer Security (TLS 1.3) protects all data in transit across HTTPS.',
        ],
      },
      {
        title: '2. Multi-Tenant Isolation & Anti-IDOR Protections',
        content: [
          'Every database query is strictly filtered by the authenticated user ID (auth.uid()).',
          'Users cannot inspect, edit, or delete another user’s financial records. Even in two-sided Udhar transactions, each user owns their discrete ledger record.',
        ],
      },
      {
        title: '3. Brute-Force & Rate Limiting Controls',
        content: [
          'Accounts are automatically locked for 15 minutes after 5 consecutive failed login attempts.',
          'Rate limiters protect sensitive endpoints including login, registration, password resets, user search, and account deletion.',
        ],
      },
    ],
  },

  // 7. ACCOUNT & AUTHENTICATION POLICY
  {
    id: 'account_auth_policy',
    title: 'Account & Authentication Policy',
    shortTitle: 'Account & Auth',
    category: 'security',
    lastUpdated: 'November 20, 2026',
    summary:
      'Rules regarding password strength, session lifetimes, multi-device management, and credential protection.',
    sections: [
      {
        title: '1. Password Policy Requirements',
        content: [
          'Passwords must be at least 12 characters in length and no longer than 128 characters.',
          'Commonly breached and easily guessed sequences (e.g., "password1234") are rejected automatically.',
          'Passwords must demonstrate character diversity including letters, numbers, and symbols.',
        ],
      },
      {
        title: '2. Session Lifetimes & Device Management',
        content: [
          'Standard sessions expire automatically after 7 days of inactivity.',
          '"Remember Me" extended sessions remain active for up to 30 days.',
          'Users can review active session counts and click "Logout All Devices" at any time from Profile & Settings.',
        ],
      },
    ],
  },

  // 8. DATA RETENTION POLICY
  {
    id: 'data_retention',
    title: 'Data Retention & Archival Policy',
    shortTitle: 'Data Retention',
    category: 'privacy',
    lastUpdated: 'November 20, 2026',
    summary:
      'Specifies how long data is retained, the 24-hour deletion cancellation grace period, and permanent purge procedures.',
    sections: [
      {
        title: '1. Active Account Retention',
        content: [
          'Your financial transactions, room budgets, and Udhar records are retained indefinitely for as long as your account remains in active standing.',
          'Soft-deleted transactions are preserved in the Recycle Bin where they can be restored at any time.',
        ],
      },
      {
        title: '2. Account Deletion: 24-Hour Cancellation Period',
        content: [
          'When an account deletion request is submitted, it enters a mandatory 24-hour pending status.',
          'During these 24 hours, the user can cancel the request from the in-app interface or via the secure email link.',
          'No financial data is purged during the 24-hour cancellation window.',
        ],
      },
      {
        title: '3. Permanent Purge Execution',
        content: [
          'After the 24-hour window lapses without cancellation, all personal profile records, transactions, Udhar ledgers, and saved contacts are permanently deleted.',
          'Immutable security audit logs (recording only security event types, IP address, and timestamps without PII) are retained for 180 days for legal compliance under Indian IT regulations.',
        ],
      },
    ],
  },

  // 9. CONSENT & PERMISSIONS
  {
    id: 'consent_permissions',
    title: 'Consent & Permissions Management',
    shortTitle: 'Consent & Permissions',
    category: 'privacy',
    lastUpdated: 'November 20, 2026',
    summary:
      'How user consent is acquired under DPDP Act 2023, camera access for QR scanning, and withdrawal procedures.',
    sections: [
      {
        title: '1. Explicit DPDP Consent',
        content: [
          'We obtain unambiguous, affirmative consent before processing personal information for cloud synchronization.',
          'You may opt to use the application strictly in local-only offline mode if you decline cloud synchronization.',
        ],
      },
      {
        title: '2. Camera Permission for QR Code Scanning',
        content: [
          'The application requests camera access solely when you click "Scan QR" to connect with another user.',
          'Camera video frames are processed locally in your browser to extract QR tokens. Video feeds are never recorded or uploaded.',
        ],
      },
    ],
  },

  // 10. THIRD-PARTY SERVICES DISCLOSURE
  {
    id: 'third_party_disclosure',
    title: 'Third-Party Services & Sub-Processors',
    shortTitle: 'Third-Party Services',
    category: 'security',
    lastUpdated: 'November 20, 2026',
    summary:
      'Complete, transparent inventory of all third-party platforms, APIs, and infrastructure partners used.',
    sections: [
      {
        title: '1. Cloud Infrastructure & Database',
        content: [
          'Supabase Inc.: Provides managed PostgreSQL database hosting, encrypted connections, and real-time subscription infrastructure.',
          'Data center region: Asia-South (Mumbai, India) to ensure regional data residency and low latency.',
        ],
      },
      {
        title: '2. Transactional Email Dispatch',
        content: [
          'Nodemailer / Gmail SMTP: Used exclusively for sending critical security alerts, password reset links, and account deletion cancellation notices.',
          'Emails contain no financial records or raw transaction details.',
        ],
      },
      {
        title: '3. Client-Side Rendering Libraries',
        content: [
          'Recharts & Lucide React: Open-source front-end component libraries executing purely within your browser without external network requests.',
        ],
      },
    ],
  },

  // 11. GRIEVANCE REDRESSAL POLICY
  {
    id: 'grievance_redressal',
    title: 'Grievance Redressal Policy (India)',
    shortTitle: 'Grievance Redressal',
    category: 'legal',
    lastUpdated: 'November 20, 2026',
    summary:
      'Statutory redressal mechanism, designated Grievance Officer details, and escalation timelines under Indian law.',
    sections: [
      {
        title: '1. Statutory Compliance',
        content: [
          'In accordance with the Information Technology Act, 2000 and the Digital Personal Data Protection (DPDP) Act, 2023, HackifyPro has appointed a dedicated Grievance Officer.',
        ],
      },
      {
        title: '2. Grievance Officer Contact Details',
        content: [
          'Officer Name: Security & Legal Compliance Desk, HackifyPro',
          'Official Email: hackifypro@gmail.com',
          'Helpline Phone / WhatsApp: +91 74149 35405',
          'Operating Hours: Monday to Saturday, 10:00 AM – 6:00 PM IST',
        ],
      },
      {
        title: '3. Resolution Timelines',
        content: [
          'All grievances and complaints will be formally acknowledged within 24 hours of receipt with a unique reference number.',
          'Substantive resolution and investigation reports will be provided within 15 working days.',
        ],
      },
    ],
  },

  // 12. CONTACT & SUPPORT
  {
    id: 'contact_support',
    title: 'Contact & Support Directory',
    shortTitle: 'Contact & Support',
    category: 'company',
    lastUpdated: 'November 20, 2026',
    summary:
      'Official support channels, helpline numbers, WhatsApp support, and technical assistance points of contact.',
    sections: [
      {
        title: '1. Primary Channels',
        content: [
          'Email Support: hackifypro@gmail.com',
          'Direct Phone / WhatsApp Helpline: +91 74149 35405',
          'In-App Feedback: Open Help & Support from the side menu to submit feedback or report technical issues directly.',
        ],
      },
      {
        title: '2. Security Vulnerability Reports',
        content: [
          'Responsible security researchers can report vulnerabilities to security@hackifypro.com. Please include reproducible steps and allow reasonable time for patching before public disclosure.',
        ],
      },
    ],
  },

  // 13. HELP CENTER / FAQ
  {
    id: 'help_faq',
    title: 'Help Center & Frequently Asked Questions',
    shortTitle: 'Help / FAQ',
    category: 'company',
    lastUpdated: 'November 20, 2026',
    summary:
      'Answers to common questions about Udhar synchronization, QR pairing, calculations, and account deletion.',
    sections: [
      {
        title: '1. How does the 2-Sided Udhar synchronization work?',
        content: [
          'When you record an Udhar entry with a registered My Money Manager user (e.g. giving ₹1,000 to Rahul), a reciprocal entry is automatically created on Rahul’s account showing that Rahul took ₹1,000 from you.',
          'Rahul can review the details and click "Confirm" or "Dispute". Repayments update the balance for both users simultaneously.',
        ],
      },
      {
        title: '2. How does the Udhar QR code pairing work?',
        content: [
          'Every user has a unique Udhar QR code. When a friend scans your QR code, your accounts are paired once as connected users.',
          'After pairing, your friend is saved in your contacts list so you never need to type their email or phone again.',
        ],
      },
      {
        title: '3. What happens if I click "Delete My Account & Data"?',
        content: [
          'Your account enters a 24-hour cancellation period. You will receive an automated email confirmation and see a live countdown in the app.',
          'You can cancel the deletion at any time during those 24 hours. After 24 hours, all your records are permanently purged.',
        ],
      },
      {
        title: '4. Does the Calculator automatically save transactions?',
        content: [
          'No. The calculator is an independent financial tool. Calculations never create expense or income records automatically unless you click "Save as Transaction".',
        ],
      },
    ],
  },

  // 14. OPEN SOURCE LICENSES
  {
    id: 'open_source_licenses',
    title: 'Open Source Software Notices & Licenses',
    shortTitle: 'Open Source Licenses',
    category: 'legal',
    lastUpdated: 'November 20, 2026',
    summary:
      'Credits and copyright notices for third-party open-source libraries utilized in building My Money Manager.',
    sections: [
      {
        title: '1. Frontend Libraries',
        content: [
          'React (MIT License) - Copyright (c) Meta Platforms, Inc.',
          'Lucide React (ISC License) - Copyright (c) Lucide Contributors',
          'Tailwind CSS (MIT License) - Copyright (c) Tailwind Labs, Inc.',
          'Recharts (MIT License) - Copyright (c) 2015-2024 Recharts Group',
          'Vite (MIT License) - Copyright (c) 2019-present Yuxi (Evan) You & Vite Contributors',
        ],
      },
      {
        title: '2. Backend & Utilities',
        content: [
          '@supabase/supabase-js (MIT License) - Copyright (c) 2020 Supabase',
          'pg / node-postgres (MIT License) - Copyright (c) 2010-2024 Brian Carlson',
          'bcryptjs (MIT License) - Copyright (c) Daniel Schwarz, Max Antipin',
          'Nodemailer (MIT License) - Copyright (c) 2011-2024 Andris Reinman',
        ],
      },
    ],
  },

  // 15. ABOUT MY MONEY MANAGER
  {
    id: 'about_my_money',
    title: 'About My Money Manager',
    shortTitle: 'About My Money',
    category: 'company',
    lastUpdated: 'November 20, 2026',
    summary:
      'The story, mission, and architectural philosophy behind My Money Manager application.',
    sections: [
      {
        title: '1. Mission & Vision',
        content: [
          'My Money Manager was created to provide a modern, transparent, and private personal finance tracking experience.',
          'We believe managing your hard-earned money, room bills, home remittances, and friend loans should be effortless, secure, and free from intrusive advertisements.',
        ],
      },
      {
        title: '2. Key Pillars',
        content: [
          'Simplicity & Speed: Record transactions in seconds with automated Indian Standard Time (IST) timestamps.',
          'Privacy by Design: Multi-tenant database isolation, bcrypt encryption, and zero advertising trackers.',
          'Collaboration: Two-sided Udhar tracking and QR user linking for transparent mutual accountability.',
        ],
      },
    ],
  },

  // 16. ABOUT HACKIFYPRO
  {
    id: 'about_hackifypro',
    title: 'About HackifyPro',
    shortTitle: 'About HackifyPro',
    category: 'company',
    lastUpdated: 'November 20, 2026',
    summary:
      'Overview of HackifyPro, the technology engineering team designing secure software solutions.',
    sections: [
      {
        title: '1. Who We Are',
        content: [
          'HackifyPro is an agile software engineering and cybersecurity innovation lab dedicated to building dependable, privacy-focused digital tools.',
          'Our projects emphasize clean architecture, robust security principles, and user-centric software design.',
        ],
      },
      {
        title: '2. Contact & Corporate Identity',
        content: [
          'Official Website: hackifypro.com',
          'Contact: hackifypro@gmail.com',
          'Phone: +91 74149 35405',
          'Copyright © 2026 HackifyPro. All rights reserved.',
        ],
      },
    ],
  },
];
