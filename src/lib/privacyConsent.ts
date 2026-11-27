/**
 * Privacy Choices & Consent Center — Domain Model, Pure Logic & Trilingual Copy
 * My Money Manager by HackifyPro
 *
 * Strictly separates:
 * - 6 Optional Consent Categories (ALL default to FALSE / unchecked)
 * - Essential Financial Data Processing (Informational only — NO checkbox, excluded from Select All)
 * - Browser/OS Hardware Permissions (Managed separately — NEVER toggled by Select All)
 */

export const PRIVACY_POLICY_VERSION = 'v2.1 — DPDP Act 2023 & Rules 2025';
export const PRIVACY_POLICY_LAST_UPDATED = '2026-11-25';

export type ConsentLanguage = 'en' | 'hi' | 'mr';

export type OptionalConsentCategory =
  | 'cloud_sync'
  | 'ai_processing'
  | 'udhar_sharing'
  | 'upi_qr'
  | 'analytics'
  | 'personalization'
  | 'marketing_updates';

export const OPTIONAL_CONSENT_CATEGORIES: readonly OptionalConsentCategory[] = [
  'cloud_sync',
  'ai_processing',
  'udhar_sharing',
  'upi_qr',
  'analytics',
  'personalization',
  'marketing_updates',
] as const;

export type OptionalConsentChoices = Record<OptionalConsentCategory, boolean>;

export type SelectAllState = 'checked' | 'unchecked' | 'indeterminate';

export type ConsentStatusValue = 'granted' | 'withdrawn' | 'not_granted';

export interface ConsentCategoryState {
  purpose: OptionalConsentCategory;
  status: ConsentStatusValue;
  granted: boolean;
  policyVersion: string | null;
  grantedAt: string | null;
  withdrawnAt: string | null;
  updatedAt: string | null;
  source: string | null;
}

export interface ConsentHistoryEntry {
  id: string;
  user_id?: string;
  purpose: string;
  status: ConsentStatusValue;
  consent_status?: ConsentStatusValue;
  action: 'granted' | 'withdrawn' | string;
  policy_version: string;
  consent_wording?: string | null;
  granted_at?: string | null;
  withdrawn_at?: string | null;
  source?: string | null;
  audit_metadata?: Record<string, unknown> | null;
  created_at: string;
  updated_at?: string | null;
}

/**
 * CRITICAL: Every optional category defaults strictly to FALSE (unchecked).
 * Never pre-select any optional consent.
 */
export function createEmptyOptionalChoices(): OptionalConsentChoices {
  return {
    cloud_sync: false,
    ai_processing: false,
    udhar_sharing: false,
    upi_qr: false,
    analytics: false,
    personalization: false,
    marketing_updates: false,
  };
}

export const EMPTY_OPTIONAL_CONSENT_CHOICES: Readonly<OptionalConsentChoices> = Object.freeze(
  createEmptyOptionalChoices()
);

/**
 * Computes the visual & ARIA state of the "Select All Optional" control
 * strictly from the 6 optional categories (never includes essential processing).
 */
export function getSelectAllState(choices: OptionalConsentChoices): SelectAllState {
  const selectedCount = countSelectedOptional(choices);
  if (selectedCount === 0) return 'unchecked';
  if (selectedCount === OPTIONAL_CONSENT_CATEGORIES.length) return 'checked';
  return 'indeterminate';
}

export function countSelectedOptional(choices: OptionalConsentChoices): number {
  return OPTIONAL_CONSENT_CATEGORIES.reduce((acc, key) => acc + (choices[key] ? 1 : 0), 0);
}

/**
 * Explicit toggle for "Select All Optional":
 * - If all optional categories are currently selected -> deselects all optional categories.
 * - If none or only some are selected -> selects all optional categories.
 * Never affects essential processing or browser/OS permissions.
 */
export function toggleSelectAllOptional(choices: OptionalConsentChoices): OptionalConsentChoices {
  const nextValue = getSelectAllState(choices) !== 'checked';
  return OPTIONAL_CONSENT_CATEGORIES.reduce((acc, key) => {
    acc[key] = nextValue;
    return acc;
  }, createEmptyOptionalChoices());
}

/**
 * Explicitly clears every optional category.
 */
export function deselectAllOptional(): OptionalConsentChoices {
  return createEmptyOptionalChoices();
}

/**
 * Builds the exact list of category choices to save on explicit user submission.
 * Each category is saved as its own separate consent record.
 */
export function buildConsentSavePayload(
  choices: OptionalConsentChoices,
  previousSaved: Partial<Record<OptionalConsentCategory, ConsentStatusValue>> | null
): Array<{ purpose: OptionalConsentCategory; status: 'granted' | 'withdrawn' }> {
  const entries: Array<{ purpose: OptionalConsentCategory; status: 'granted' | 'withdrawn' }> = [];

  for (const purpose of OPTIONAL_CONSENT_CATEGORIES) {
    const nextStatus: 'granted' | 'withdrawn' = choices[purpose] ? 'granted' : 'withdrawn';
    const prevStatus = previousSaved?.[purpose] ?? 'not_granted';

    // Always record explicit grants; record explicit withdrawals if previously granted
    // or if this is the user's explicit first save (so explicit choice is persisted).
    if (previousSaved === null) {
      entries.push({ purpose, status: nextStatus });
    } else if (prevStatus !== nextStatus) {
      entries.push({ purpose, status: nextStatus });
    }
  }

  return entries;
}

export function isValidOptionalConsentCategory(value: string): value is OptionalConsentCategory {
  return (OPTIONAL_CONSENT_CATEGORIES as readonly string[]).includes(value);
}

// ============================================================================
// CATEGORY METADATA & PROGRESSIVE DISCLOSURE ("LEARN MORE") CONTENT
// ============================================================================

export interface LocalizedCategoryDetails {
  title: string;
  shortDescription: string;
  dataSummary: string;
  purposeDetail: string;
  dataCategories: string[];
  howUsed: string;
  externalProcessors: string;
  retention: string;
  withdrawalProcedure: string;
  importantNote?: string;
}

export interface ConsentCategoryDefinition {
  key: OptionalConsentCategory;
  defaultValue: false;
  optional: true;
  translations: Record<ConsentLanguage, LocalizedCategoryDetails>;
}

export const OPTIONAL_CONSENT_DEFINITIONS: readonly ConsentCategoryDefinition[] = [
  {
    key: 'cloud_sync',
    defaultValue: false,
    optional: true,
    translations: {
      en: {
        title: 'Cloud Sync',
        shortDescription:
          'Keep your financial records synchronized and backed up across your connected devices.',
        dataSummary: 'Income, expenses, budgets, bills, savings, and Udhar records (where applicable)',
        purposeDetail:
          'Replicates your account ledger across multiple signed-in devices and maintains optional cloud backups so your balances stay consistent when you switch phones or browsers.',
        dataCategories: [
          'Income and received money entries',
          'Expense transactions (Room, Food, Other, Custom)',
          'Monthly budgets, recurring bills, and savings goals',
          'Udhar records and saved contacts, where applicable',
        ],
        howUsed:
          'Used exclusively to synchronize your own records across devices authenticated to your account. Essential account records required to operate your registered Supabase account remain stored separately from optional multi-device sync replication.',
        externalProcessors:
          'Supabase (PostgreSQL managed database with Row Level Security isolation per account).',
        retention:
          'Retained while your account is active or until you delete entries or schedule account erasure under Settings → Delete Account & Data.',
        withdrawalProcedure:
          'Switch off Cloud Sync anytime under Settings → Privacy → Manage Consent. Turning off optional sync pauses multi-device backup replication without deleting your existing records.',
        importantNote:
          'Your signed-in account still uses core account storage on Supabase to keep your account operational; this toggle controls optional multi-device sync & backup replication.',
      },
      hi: {
        title: 'क्लाउड सिंक (Cloud Sync)',
        shortDescription:
          'अपने जुड़े हुए उपकरणों (डिवाइस) पर अपने वित्तीय रिकॉर्ड सिंक और बैकअप रखें।',
        dataSummary: 'आय, खर्च, बजट, बिल, बचत और उधार रिकॉर्ड (जहाँ लागू हो)',
        purposeDetail:
          'आपके खाते के रिकॉर्ड को आपके अन्य लॉग-इन डिवाइसों पर सिंक और बैकअप करता है ताकि फोन या ब्राउज़र बदलने पर डेटा उपलब्ध रहे।',
        dataCategories: [
          'आय और प्राप्त राशि की प्रविष्टियाँ',
          'खर्च के लेनदेन (रूम, भोजन, अन्य)',
          'मासिक बजट, आवर्ती बिल और बचत लक्ष्य',
          'उधार रिकॉर्ड और सहेजे गए संपर्क (जहाँ लागू हो)',
        ],
        howUsed:
          'केवल आपके खाते से जुड़े डिवाइसों पर आपका डेटा सिंक करने के लिए। आपके पंजीकृत खाते को चलाने के लिए आवश्यक कोर स्टोरेज, वैकल्पिक मल्टी-डिवाइस सिंक से अलग है।',
        externalProcessors: 'Supabase (Row Level Security के साथ प्रबंधित PostgreSQL डेटाबेस)।',
        retention:
          'खाता सक्रिय रहने तक या Settings → Delete Account & Data से खाता हटाने का अनुरोध करने तक सुरक्षित।',
        withdrawalProcedure:
          'Settings → Privacy → Manage Consent से कभी भी बंद करें। इसे बंद करने से आपके पुराने रिकॉर्ड नहीं मिटते।',
      },
      mr: {
        title: 'क्लाउड सिंक (Cloud Sync)',
        shortDescription:
          'तुमच्या जोडलेल्या सर्व डिव्हाइसवर आर्थिक नोंदी सिंक आणि बॅकअप ठेवा.',
        dataSummary: 'उत्पन्न, खर्च, बजेट, बिले, बचत आणि उधार नोंदी (लागू असल्यास)',
        purposeDetail:
          'तुमच्या खात्यातील नोंदी तुमच्या इतर साइन-इन डिव्हाइसवर सिंक व बॅकअप ठेवते ज्यामुळे फोन किंवा ब्राउझर बदलल्यावर माहिती उपलब्ध राहते.',
        dataCategories: [
          'उत्पन्न आणि मिळालेले पैसे नोंदी',
          'खर्चाचे व्यवहार (रूम, जेवण, इतर)',
          'मासिक बजेट, नियमित बिले आणि बचत उद्दिष्टे',
          'उधार नोंदी आणि जतन केलेले संपर्क (लागू असल्यास)',
        ],
        howUsed:
          'फक्त तुमच्या खात्याशी जोडलेल्या डिव्हाइसवर डेटा सिंक करण्यासाठी. नोंदणीकृत खाते चालवण्यासाठी आवश्यक मूळ स्टोरेज हे पर्यायी मल्टी-डिव्हाइस सिंकपेक्षा वेगळे आहे.',
        externalProcessors: 'Supabase (Row Level Security सह व्यवस्थापित PostgreSQL डेटाबेस).',
        retention:
          'खाते सक्रिय असेपर्यंत किंवा Settings → Delete Account & Data मधून खाते हटवेपर्यंत जतन.',
        withdrawalProcedure:
          'Settings → Privacy → Manage Consent मधून कधीही बंद करा. यामुळे तुमच्या जतन केलेल्या नोंदी हटवल्या जात नाहीत.',
      },
    },
  },
  {
    key: 'ai_processing',
    defaultValue: false,
    optional: true,
    translations: {
      en: {
        title: 'AI External Processing',
        shortDescription:
          'Allow selected summaries or receipt photos you submit to be processed by an external AI provider.',
        dataSummary: 'Prompts, aggregated financial summary snapshots, or receipt images you explicitly submit',
        purposeDetail:
          'Enables AI Money Assistant Q&A, AI receipt OCR extraction, and optional AI fallback categorization when you explicitly invoke an AI feature.',
        dataCategories: [
          'Questions you type into AI Money Assistant',
          'Aggregated summary snapshot of your spending, budgets, bills, savings, net worth, and Udhar totals',
          'Receipt images you explicitly upload or capture for AI OCR extraction',
        ],
        howUsed:
          'Sent strictly on demand via our server-side proxy when you submit an AI query or scan a receipt. Without this consent, zero financial data is sent to any external AI provider — local calculators, deterministic categorization, manual receipt entry, Net Worth, Safe-to-Spend, Calendar, and Reports continue working normally.',
        externalProcessors:
          'Google Gemini API (Google LLC), accessed via HackifyPro server-side API routes. Under Google Gemini API paid/developer terms, API request payloads are processed to generate responses and are subject to Google’s published Gemini API data handling and abuse-monitoring retention terms (verify current Google Gemini API Terms for details).',
        retention:
          'Conversation history saved under your My Money Manager account can be cleared anytime in AI Money Assistant. External provider retention follows verified Gemini API terms.',
        withdrawalProcedure:
          'Withdraw anytime in Settings → Privacy → Manage Consent. External AI transmission stops immediately; all non-AI features remain fully available.',
      },
      hi: {
        title: 'AI बाहरी प्रोसेसिंग (AI External Processing)',
        shortDescription:
          'AI सुविधाओं का उपयोग करते समय आपके द्वारा चुने गए सारांश या रसीद फोटो को बाहरी AI प्रदाता को भेजने की अनुमति दें।',
        dataSummary: 'आपके द्वारा भेजे गए प्रश्न, वित्तीय सारांश या रसीद की छवियाँ',
        purposeDetail:
          'जब आप AI Money Assistant से प्रश्न पूछते हैं या AI रसीद OCR स्कैन चलाते हैं, तो उत्तर और डेटा निकालने के लिए आवश्यक है।',
        dataCategories: [
          'AI सहायक में आपके द्वारा पूछे गए प्रश्न',
          'खर्च, बजट, बिल, बचत और उधार का सारांश स्नैपशॉट',
          'AI OCR के लिए आपके द्वारा अपलोड की गई रसीद की तस्वीर',
        ],
        howUsed:
          'केवल तभी भेजा जाता है जब आप स्वयं AI सुविधा का उपयोग करते हैं। सहमति के बिना कोई भी डेटा बाहरी AI को नहीं भेजा जाता — लोकल कैलकुलेटर, रिपोर्ट्स, बजट और मैनुअल एंट्री हमेशा काम करते रहेंगे।',
        externalProcessors:
          'Google Gemini API (Google LLC), HackifyPro सर्वर प्रॉक्सी के माध्यम से। डेटा हैंडलिंग और रिटेंशन Google Gemini API की सत्यापित शर्तों के अधीन है।',
        retention:
          'ऐप में सहेजी गई AI चैट हिस्ट्री आप कभी भी डिलीट कर सकते हैं। बाहरी प्रदाता रिटेंशन Google API शर्तों के अनुसार है।',
        withdrawalProcedure:
          'Settings → Privacy → Manage Consent में कभी भी वापस लें। बाहरी AI प्रोसेसिंग तुरंत बंद हो जाएगी।',
      },
      mr: {
        title: 'AI बाह्य प्रक्रिया (AI External Processing)',
        shortDescription:
          'AI वैशिष्ट्ये वापरताना तुम्ही निवडलेला सारांश किंवा पावतीचा फोटो बाह्य AI प्रदात्याकडे पाठवण्यास परवानगी द्या.',
        dataSummary: 'तुम्ही पाठवलेले प्रश्न, आर्थिक सारांश किंवा पावतीच्या प्रतिमा',
        purposeDetail:
          'AI Money Assistant प्रश्नोत्तरे आणि AI पावती OCR स्कॅनिंगसाठी आवश्यक.',
        dataCategories: [
          'AI सहाय्यकामध्ये तुम्ही विचारलेले प्रश्न',
          'खर्च, बजेट, बिले, बचत आणि उधार यांचा एकत्रित सारांश',
          'AI OCR साठी तुम्ही अपलोड केलेला पावतीचा फोटो',
        ],
        howUsed:
          'फक्त तुम्ही AI वैशिष्ट्य वापरल्यावरच सर्वर प्रॉक्सीद्वारे पाठवले जाते. संमती नसल्यास कोणताही डेटा बाह्य AI कडे पाठवला जात नाही; स्थानिक साधने व मॅन्युअल नोंदी नेहमीप्रमाणे कार्य करतात.',
        externalProcessors:
          'Google Gemini API (Google LLC), HackifyPro सर्वर प्रॉक्सीमार्फत. डेटा हाताळणी व जतन कालावधी Google Gemini API च्या प्रमाणित अटींनुसार आहे.',
        retention:
          'ॲपमधील AI संवाद इतिहास तुम्ही कधीही हटवू शकता. बाह्य प्रदात्याकडील जतन Google API अटींनुसार असते.',
        withdrawalProcedure:
          'Settings → Privacy → Manage Consent मध्ये कधीही संमती मागे घ्या. बाह्य AI प्रक्रिया त्वरित थांबेल.',
      },
    },
  },
  {
    key: 'udhar_sharing',
    defaultValue: false,
    optional: true,
    translations: {
      en: {
        title: 'Two-way Udhar Sharing',
        shortDescription:
          'Share selected Udhar entries with connected people after mutual pairing acceptance.',
        dataSummary: 'Your display name, avatar, and only the specific Udhar entries you choose to share',
        purposeDetail:
          'Lets you send selected lend/borrow entries to a connected My Money Manager user so both sides see matching balances, repayments, and settlements.',
        dataCategories: [
          'Display name and profile avatar shown to your paired contact',
          'Only the individual Udhar entries you explicitly link to that connected person',
          'Repayment confirmations and dispute notes on those shared entries',
        ],
        howUsed:
          'Strictly opt-in and entry-specific. Connecting via QR pairing or search requires recipient acceptance first. Pairing alone never exposes your income, expenses, budgets, bank balances, or unrelated Udhar records.',
        externalProcessors:
          'None outside My Money Manager’s Supabase database (isolated by authenticated participant user IDs).',
        retention:
          'Shared Udhar ledger entries remain visible to participants for accurate debt records even if you disconnect or stop future sharing.',
        withdrawalProcedure:
          'Turn off Two-way Udhar Sharing anytime in Settings → Privacy → Manage Consent or disconnect a person in People (Udhar). Personal/manual Udhar tracking continues working normally.',
      },
      hi: {
        title: 'टू-वे उधार शेयरिंग (Two-way Udhar Sharing)',
        shortDescription:
          'आपसी पेयरिंग स्वीकृति के बाद चुने हुए उधार लेनदेन जुड़े लोगों के साथ साझा करें।',
        dataSummary: 'आपका नाम, अवतार और केवल वे उधार प्रविष्टियाँ जिन्हें आप साझा करना चुनते हैं',
        purposeDetail:
          'आपके द्वारा चुने गए उधार लेनदेन को जुड़े हुए व्यक्ति के साथ साझा करता है ताकि दोनों ओर सटीक शेष राशि और भुगतान दिखे।',
        dataCategories: [
          'जुड़े संपर्क को दिखने वाला आपका नाम और प्रोफ़ाइल फ़ोटो',
          'केवल वे विशेष उधार प्रविष्टियाँ जिन्हें आप उस व्यक्ति से लिंक करते हैं',
          'उन साझा प्रविष्टियों के भुगतान और सेटलमेंट अपडेट',
        ],
        howUsed:
          'पूरी तरह वैकल्पिक। QR पेयरिंग या अनुरोध के लिए सामने वाले की स्वीकृति आवश्यक है। पेयरिंग से आपके अन्य खर्च, आय या बजट कभी साझा नहीं होते।',
        externalProcessors: 'कोई बाहरी तृतीय-पक्ष नहीं (केवल My Money Manager Supabase डेटाबेस)।',
        retention:
          'पहले से साझा किए गए उधार लेनदेन का इतिहास सटीक हिसाब के लिए सुरक्षित रहता है, भले ही आप भविष्य की शेयरिंग बंद कर दें।',
        withdrawalProcedure:
          'Settings → Privacy → Manage Consent से कभी भी बंद करें या People अनुभाग से संपर्क डिस्कनेक्ट करें।',
      },
      mr: {
        title: 'टू-वे उधार शेअरिंग (Two-way Udhar Sharing)',
        shortDescription:
          'परस्पर पेअरिंग स्वीकृतीनंतर निवडक उधार नोंदी जोडलेल्या व्यक्तींसोबत शेअर करा.',
        dataSummary: 'तुमचे नाव, अवतार आणि फक्त तुम्ही शेअर करण्यासाठी निवडलेल्या उधार नोंदी',
        purposeDetail:
          'तुम्ही निवडलेले देणे-घेणे व्यवहार जोडलेल्या व्यक्तीसोबत सिंक करते जेणेकरून दोन्ही बाजूंनी अचूक शिल्लक दिसेल.',
        dataCategories: [
          'जोडलेल्या संपर्काला दिसणारे तुमचे नाव व प्रोफाइल फोटो',
          'फक्त त्या व्यक्तीशी जोडलेल्या विशिष्ट उधार नोंदी',
          'त्या नोंदींची परतफेड आणि सेटलमेंट माहिती',
        ],
        howUsed:
          'पूर्णपणे पर्यायी. QR पेअरिंगसाठी समोरच्या व्यक्तीची स्वीकृती आवश्यक आहे. तुमचे उत्पन्न, खर्च, बजेट किंवा इतर नोंदी कधीही शेअर होत नाहीत.',
        externalProcessors: 'कोणताही बाह्य तृतीय-पक्ष नाही (फक्त My Money Manager Supabase डेटाबेस).',
        retention:
          'पूर्वी शेअर केलेल्या उधार नोंदींचा इतिहास अचूक हिशोबासाठी जतन राहतो, जरी तुम्ही पुढील शेअरिंग थांबवले तरी.',
        withdrawalProcedure:
          'Settings → Privacy → Manage Consent मधून कधीही बंद करा किंवा People मधून कनेक्शन काढा.',
      },
    },
  },
  {
    key: 'analytics',
    defaultValue: false,
    optional: true,
    translations: {
      en: {
        title: 'Analytics & Usage Data',
        shortDescription:
          'Help us understand feature usage, performance, and reliability issues.',
        dataSummary: 'Aggregated feature interaction events, screen load timings, and error diagnostics',
        purposeDetail:
          'Measures app reliability, broken flows, and page load latency so HackifyPro can fix bugs and improve performance.',
        dataCategories: [
          'Feature usage counts and navigation events (no rupee amounts or transaction notes)',
          'Application error logs and client performance timings',
          'Device class, browser family, and pseudonymized session identifier',
        ],
        howUsed:
          'Compiled strictly into aggregated product diagnostics. Analytics is never a condition for using any core financial feature and is never shared with ad networks or data brokers.',
        externalProcessors:
          'Processed within HackifyPro / Supabase infrastructure; not shared with third-party advertising trackers.',
        retention: 'Aggregated diagnostic records are retained for up to 12 months.',
        withdrawalProcedure:
          'Switch off anytime in Settings → Privacy → Manage Consent. Core features are unaffected.',
      },
      hi: {
        title: 'एनालिटिक्स और उपयोग डेटा (Analytics & Usage Data)',
        shortDescription: 'ऐप के उपयोग, प्रदर्शन और विश्वसनीयता को बेहतर बनाने में मदद करें।',
        dataSummary: 'समेकित फ़ीचर उपयोग इवेंट, परफ़ॉर्मेंस और त्रुटि (एरर) लॉग',
        purposeDetail:
          'बग ठीक करने और ऐप की गति सुधारने के लिए प्रदर्शन और त्रुटियों को समझने हेतु।',
        dataCategories: [
          'फ़ीचर उपयोग और नेविगेशन इवेंट (कोई व्यक्तिगत राशि या नोट्स नहीं)',
          'ऐप त्रुटि लॉग और लोड समय',
          'डिवाइस प्रकार और छद्मनाम (pseudonymized) सत्र पहचानकर्ता',
        ],
        howUsed:
          'केवल ऐप सुधार के लिए। यह मुख्य सुविधाओं के लिए कभी आवश्यक नहीं है और विज्ञापन नेटवर्क के साथ साझा नहीं किया जाता।',
        externalProcessors: 'केवल HackifyPro / Supabase बुनियादी ढाँचे में संसाधित; कोई विज्ञापन ट्रैकर नहीं।',
        retention: 'समेकित डायग्नोस्टिक डेटा अधिकतम 12 महीनों तक रखा जाता है।',
        withdrawalProcedure: 'Settings → Privacy → Manage Consent में कभी भी बंद करें।',
      },
      mr: {
        title: 'ॲनालिटिक्स आणि वापर डेटा (Analytics & Usage Data)',
        shortDescription: 'ॲपचा वापर, वेग आणि विश्वासार्हता सुधारण्यास मदत करा.',
        dataSummary: 'एकत्रित वैशिष्ट्य वापर नोंदी, वेग आणि त्रुटी निदान',
        purposeDetail:
          'त्रुटी दुरुस्त करण्यासाठी आणि ॲपची कार्यक्षमता सुधारण्यासाठी तांत्रिक माहिती गोळा करणे.',
        dataCategories: [
          'वैशिष्ट्य वापर नोंदी (कोणतीही रक्कम किंवा व्यवहार टिपा नाहीत)',
          'ॲप त्रुटी लॉग आणि लोडिंग वेग',
          'डिव्हाइस प्रकार आणि छद्मनाम सत्र ओळखकर्ता',
        ],
        howUsed:
          'फक्त तांत्रिक सुधारणेसाठी. मूळ सेवा वापरण्यासाठी हे कधीही अनिवार्य नाही आणि जाहिरात नेटवर्कसोबत शेअर केले जात नाही.',
        externalProcessors: 'फक्त HackifyPro / Supabase प्रणालीवर प्रक्रिया; कोणतेही जाहिरात ट्रॅकर नाहीत.',
        retention: 'एकत्रित तांत्रिक नोंदी कमाल 12 महिन्यांपर्यंत जतन.',
        withdrawalProcedure: 'Settings → Privacy → Manage Consent मधून कधीही बंद करा.',
      },
    },
  },
  {
    key: 'personalization',
    defaultValue: false,
    optional: true,
    translations: {
      en: {
        title: 'Personalization',
        shortDescription:
          'Customize dashboard suggestions, quick category shortcuts, and optional app preferences.',
        dataSummary: 'UI layout preferences, frequently used category shortcuts, and optional suggestions',
        purposeDetail:
          'Tailors optional dashboard tips, quick-add category suggestions, and workspace convenience preferences to your usage style.',
        dataCategories: [
          'Preferred dashboard widgets and display preferences',
          'Frequently used expense/income category shortcuts',
          'Optional workspace workflow hints',
        ],
        howUsed:
          'Used only to customize in-app convenience features. Does not perform sensitive financial profiling, credit scoring, or third-party ad targeting.',
        externalProcessors: 'None — processed within My Money Manager.',
        retention: 'Stored until changed or withdrawn in Settings → Privacy → Manage Consent.',
        withdrawalProcedure:
          'Turn off anytime in Settings → Privacy → Manage Consent to revert to standard neutral defaults.',
      },
      hi: {
        title: 'पर्सनलाइज़ेशन (Personalization)',
        shortDescription: 'डैशबोर्ड सुझाव, श्रेणी शॉर्टकट और वैकल्पिक ऐप अनुभव को अनुकूलित करें।',
        dataSummary: 'UI प्राथमिकताएँ, अक्सर उपयोग की जाने वाली श्रेणियाँ और वैकल्पिक सुझाव',
        purposeDetail:
          'आपकी सुविधा के अनुसार डैशबोर्ड सुझाव और त्वरित श्रेणी शॉर्टकट को अनुकूलित करता है।',
        dataCategories: [
          'पसंदीदा डैशबोर्ड और डिस्प्ले विकल्प',
          'अक्सर उपयोग किए जाने वाले खर्च/आय श्रेणी शॉर्टकट',
          'वैकल्पिक उपयोग सुझाव',
        ],
        howUsed:
          'केवल ऐप अनुभव बेहतर बनाने के लिए। बिना अलग सूचना के कोई संवेदनशील वित्तीय प्रोफ़ाइलिंग या क्रेडिट स्कोरिंग नहीं की जाती।',
        externalProcessors: 'कोई नहीं — केवल My Money Manager के भीतर।',
        retention: 'Settings → Privacy → Manage Consent से बदलने या हटाने तक।',
        withdrawalProcedure: 'Settings → Privacy → Manage Consent से कभी भी बंद करें।',
      },
      mr: {
        title: 'पर्सनलायझेशन (Personalization)',
        shortDescription: 'डॅशबोर्ड सूचना, श्रेणी शॉर्टकट आणि पर्यायी ॲप अनुभव सानुकूलित करा.',
        dataSummary: 'UI प्राधान्ये, वारंवार वापरल्या जाणाऱ्या श्रेणी आणि पर्यायी सूचना',
        purposeDetail:
          'तुमच्या सोयीनुसार डॅशबोर्ड सूचना आणि झटपट श्रेणी शॉर्टकट दाखवण्यासाठी.',
        dataCategories: [
          'आवडते डॅशबोर्ड व प्रदर्शन प्राधान्ये',
          'वारंवार वापरल्या जाणाऱ्या खर्च/उत्पन्न श्रेणी',
          'पर्यायी कार्यप्रवाह सूचना',
        ],
        howUsed:
          'फक्त ॲपमधील सोयीसाठी. वेगळ्या खुलाशाशिवाय कोणतीही संवेदनशील आर्थिक प्रोफाइलिंग केली जात नाही.',
        externalProcessors: 'कोणीही नाही — फक्त My Money Manager मध्ये.',
        retention: 'Settings → Privacy → Manage Consent मधून बदलेपर्यंत किंवा बंद करेपर्यंत.',
        withdrawalProcedure: 'Settings → Privacy → Manage Consent मधून कधीही बंद करा.',
      },
    },
  },
  {
    key: 'marketing_updates',
    defaultValue: false,
    optional: true,
    translations: {
      en: {
        title: 'Marketing & Promotional Updates',
        shortDescription:
          'Receive optional promotional announcements, new feature offers, and product updates.',
        dataSummary: 'Registered email address and notification channel preference',
        purposeDetail:
          'Sends occasional promotional offers, product announcements, and tips from HackifyPro.',
        dataCategories: [
          'Registered email address (when email notifications are enabled)',
          'In-app / push promotional preference flag',
        ],
        howUsed:
          'Strictly separate from essential account and security notifications (such as password resets, login security alerts, and account deletion confirmations), which are always sent for account safety.',
        externalProcessors:
          'HackifyPro configured SMTP / Web Push delivery service solely to dispatch opted-in updates.',
        retention: 'Active only until you withdraw consent.',
        withdrawalProcedure:
          'Withdraw anytime in Settings → Privacy → Manage Consent or Notification Preferences. Promotional messages stop immediately.',
      },
      hi: {
        title: 'मार्केटिंग और प्रचार अपडेट (Marketing & Promotional Updates)',
        shortDescription: 'वैकल्पिक प्रचार संदेश, नई सुविधाओं की जानकारी और विशेष ऑफ़र प्राप्त करें।',
        dataSummary: 'पंजीकृत ईमेल पता और नोटिफ़िकेशन प्राथमिकता',
        purposeDetail: 'HackifyPro की ओर से वैकल्पिक ऑफ़र और नए फ़ीचर अपडेट भेजने के लिए।',
        dataCategories: ['पंजीकृत ईमेल पता', 'इन-ऐप / पुश प्रचार प्राथमिकता'],
        howUsed:
          'यह आवश्यक खाता और सुरक्षा सूचनाओं (जैसे पासवर्ड रीसेट, सुरक्षा अलर्ट) से पूरी तरह अलग है।',
        externalProcessors: 'केवल ऑप्ट-इन अपडेट भेजने के लिए HackifyPro SMTP / वेब पुश सेवा।',
        retention: 'केवल आपकी सहमति वापस लेने तक सक्रिय।',
        withdrawalProcedure:
          'Settings → Privacy → Manage Consent या Notification Preferences में कभी भी वापस लें।',
      },
      mr: {
        title: 'मार्केटिंग आणि प्रचारात्मक अपडेट्स (Marketing & Promotional Updates)',
        shortDescription: 'पर्यायी प्रचारात्मक संदेश, नवीन वैशिष्ट्ये आणि ऑफर्स मिळवा.',
        dataSummary: 'नोंदणीकृत ईमेल पत्ता आणि सूचना प्राधान्य',
        purposeDetail: 'HackifyPro कडून पर्यायी ऑफर्स आणि नवीन उत्पादनांच्या घोषणा पाठवण्यासाठी.',
        dataCategories: ['नोंदणीकृत ईमेल पत्ता', 'इन-ॲप / पुश प्रचार प्राधान्य'],
        howUsed:
          'हे आवश्यक खाते आणि सुरक्षा सूचनांपासून (पासवर्ड रीसेट, सुरक्षा अलर्ट) पूर्णपणे वेगळे आहे.',
        externalProcessors: 'फक्त संमती दिलेल्या अपडेट्ससाठी HackifyPro SMTP / वेब पुश सेवा.',
        retention: 'तुम्ही संमती मागे घेईपर्यंतच सक्रिय.',
        withdrawalProcedure:
          'Settings → Privacy → Manage Consent किंवा Notification Preferences मधून कधीही मागे घ्या.',
      },
    },
  },
  {
    key: 'upi_qr',
    defaultValue: false,
    optional: true,
    translations: {
      en: {
        title: 'Personal UPI QR Profile Storage',
        shortDescription:
          'Securely store your UPI ID, payee name, and optional payment note to generate personal Normal & Fixed Amount UPI QR codes.',
        dataSummary: 'UPI ID (VPA), Payee Name, and optional default Payment Note (never UPI PIN or banking passwords)',
        purposeDetail:
          'Stores your UPI ID and payee details privately under your account so you can generate scannable Normal and Fixed Amount UPI payment request QR codes.',
        dataCategories: [
          'UPI ID (e.g., yourname@upi)',
          'Payee Display Name',
          'Optional Payment Note',
        ],
        howUsed:
          'Used solely to encode local UPI payment request URIs (upi://pay?...) and render QR codes for you to download or share. Never exposed publicly in People Search and never triggers automatic balance changes.',
        externalProcessors:
          'Stored privately in your encrypted Supabase account record protected by Row-Level Security (RLS). Never shared with third parties.',
        retention: 'Retained only until you edit, remove your UPI ID, or withdraw this consent.',
        withdrawalProcedure:
          'Withdraw anytime from Settings → Privacy → Manage Consent or by clicking Remove Saved UPI ID in the Dashboard UPI QR section.',
      },
      hi: {
        title: 'व्यक्तिगत UPI QR प्रोफ़ाइल संग्रहण (Personal UPI QR Storage)',
        shortDescription:
          'व्यक्तिगत सामान्य और निश्चित राशि वाले UPI QR कोड बनाने के लिए अपनी UPI ID, प्राप्तकर्ता नाम और नोट सुरक्षित रूप से सेव करें।',
        dataSummary: 'UPI ID, प्राप्तकर्ता नाम और वैकल्पिक भुगतान नोट (कभी भी UPI PIN या बैंकिंग पासवर्ड नहीं)',
        purposeDetail: 'आपके खाते के अंतर्गत आपकी UPI ID सेव करने के लिए ताकि आप नॉर्मल और अमाउंट QR कोड बना सकें।',
        dataCategories: ['UPI ID', 'प्राप्तकर्ता नाम', 'वैकल्पिक भुगतान नोट'],
        howUsed: 'केवल आपके व्यक्तिगत UPI भुगतान अनुरोध QR कोड बनाने के लिए उपयोग किया जाता है। कभी सार्वजनिक रूप से साझा नहीं किया जाता।',
        externalProcessors: 'RLS से सुरक्षित आपके निजी Supabase खाते में संग्रहीत।',
        retention: 'केवल तब तक जब तक आप इसे हटाते नहीं हैं या सहमति वापस नहीं लेते।',
        withdrawalProcedure: 'Settings → Privacy या Dashboard UPI QR सेक्शन से कभी भी हटाएं या सहमति वापस लें।',
      },
      mr: {
        title: 'वैयक्तिक UPI QR प्रोफाइल संचयन (Personal UPI QR Storage)',
        shortDescription:
          'वैयक्तिक सामान्य आणि निश्चित रकमेचे UPI QR कोड तयार करण्यासाठी तुमचा UPI ID, नाव आणि टीप सुरक्षितपणे सेव्ह करा.',
        dataSummary: 'UPI ID, प्राप्तकर्त्याचे नाव आणि पर्यायी टीप (कधीही UPI PIN किंवा बँकिंग पासवर्ड नाही)',
        purposeDetail: 'तुमच्या खात्यात UPI ID सुरक्षित ठेवण्यासाठी जेणेकरून तुम्ही Normal आणि Amount QR कोड तयार करू शकाल.',
        dataCategories: ['UPI ID', 'प्राप्तकर्त्याचे नाव', 'पर्यायी टीप'],
        howUsed: 'फक्त तुमच्या वैयक्तिक UPI पेमेंट विनंती QR कोडसाठी वापरले जाते. कधीही सार्वजनिक केले जात नाही.',
        externalProcessors: 'RLS ने सुरक्षित तुमच्या खाजगी Supabase खात्यात संग्रहित.',
        retention: 'तुम्ही माहिती हटवेपर्यंत किंवा संमती मागे घेईपर्यंतच.',
        withdrawalProcedure: 'Settings → Privacy किंवा Dashboard UPI QR मधून कधीही काढून टाका किंवा संमती मागे घ्या.',
      },
    },
  },
] as const;

// ============================================================================
// TRILINGUAL UI COPY (ENGLISH, HINDI, MARATHI)
// ============================================================================

export interface PrivacyUiCopy {
  languageName: string;
  headerBadge: string;
  headerTitle: string;
  headerSubtitle: string;
  selectAllTitle: string;
  selectAllDescription: string;
  selectAllPartial: string;
  selectAllSelected: string;
  selectAllHint: string;
  deselectAll: string;
  selectedCountLabel: (selected: number, total: number) => string;
  optionalBadge: string;
  learnMore: string;
  hideDetails: string;
  dataInvolvedLabel: string;
  detailPurpose: string;
  detailDataCategories: string;
  detailHowUsed: string;
  detailProcessors: string;
  detailRetention: string;
  detailWithdrawal: string;
  essentialTitle: string;
  essentialBadge: string;
  essentialIntro: string;
  essentialItems: string[];
  essentialLawfulBasis: string;
  essentialNotOptionalNote: string;
  saveMyChoices: string;
  savingLabel: string;
  privacyNoticeLink: string;
  footerMeta: string;
  retrySave: string;
  saveErrorTitle: string;
  noImplicitConsentNote: string;
  allOffInfoNote: string;
  // Settings Manage Consent copy
  settingsTitle: string;
  settingsSubtitle: string;
  withdrawAllOptional: string;
  withdrawingLabel: string;
  policyVersionLabel: string;
  lastUpdatedLabel: string;
  statusGranted: string;
  statusWithdrawn: string;
  statusNotGranted: string;
  historyTab: string;
  preferencesTab: string;
  historyEmpty: string;
  historySubtitle: string;
  rightsHeading: string;
  rightsDescription: string;
  rightsExport: string;
  rightsCorrection: string;
  rightsErasure: string;
  rightsGrievance: string;
  hardwarePermsSeparation: string;
  dpdpHonestNote: string;
}

export const PRIVACY_UI_COPY: Record<ConsentLanguage, PrivacyUiCopy> = {
  en: {
    languageName: 'English',
    headerBadge: 'YOUR PRIVACY CHOICES',
    headerTitle: 'Choose what you share, category by category.',
    headerSubtitle:
      'Nothing optional is pre-selected. You can change or withdraw any choice in Settings.',
    selectAllTitle: 'Select All Optional',
    selectAllDescription: 'Enable or clear all 6 optional privacy categories below.',
    selectAllPartial: 'Some optional categories selected',
    selectAllSelected: 'All optional categories selected',
    selectAllHint:
      'Does not include Essential Financial Data Processing or browser/OS permissions.',
    deselectAll: 'Deselect all',
    selectedCountLabel: (selected, total) => `${selected} of ${total} optional selected`,
    optionalBadge: 'Optional',
    learnMore: 'Learn more',
    hideDetails: 'Hide details',
    dataInvolvedLabel: 'Data involved',
    detailPurpose: 'Purpose',
    detailDataCategories: 'Data categories',
    detailHowUsed: 'How the information is used',
    detailProcessors: 'External processors',
    detailRetention: 'Retention',
    detailWithdrawal: 'How to withdraw',
    essentialTitle: 'Essential Financial Data Processing',
    essentialBadge: 'Core service · Not optional consent',
    essentialIntro:
      'Processing certain financial records you enter is necessary to provide the core personal finance services of My Money Manager by HackifyPro:',
    essentialItems: [
      'Transaction recording',
      'Income and expense calculations',
      'Account balances',
      'Financial summaries',
      'Reports',
      'Budget calculations',
      'User-requested Udhar functionality',
    ],
    essentialLawfulBasis:
      'Processed strictly to deliver the core features you request (contractual necessity / user-provided data for requested service as detailed in the Privacy Notice).',
    essentialNotOptionalNote:
      'Essential service processing is not bundled with optional consent and is never toggled by Select All.',
    saveMyChoices: 'Save My Choices',
    savingLabel: 'Saving choices...',
    privacyNoticeLink: 'Privacy Notice',
    footerMeta: 'Purpose-specific consent · Saved only when you click Save',
    retrySave: 'Retry Save',
    saveErrorTitle: 'Could not save your privacy choices',
    noImplicitConsentNote:
      'No optional choice is saved until you click Save My Choices.',
    allOffInfoNote:
      'You can save with all optional categories off. Core transaction recording, balances, budgets, and reports remain available.',
    settingsTitle: 'Manage Privacy & Consent',
    settingsSubtitle:
      'Review active optional consents, withdraw any category anytime, or inspect your full consent audit history.',
    withdrawAllOptional: 'Withdraw All Optional',
    withdrawingLabel: 'Withdrawing...',
    policyVersionLabel: 'Policy Version',
    lastUpdatedLabel: 'Last Updated',
    statusGranted: 'Active',
    statusWithdrawn: 'Withdrawn',
    statusNotGranted: 'Not granted',
    historyTab: 'Consent History',
    preferencesTab: 'Consent Controls',
    historyEmpty:
      'No consent events recorded yet. Optional categories remain off until you save an explicit choice.',
    historySubtitle:
      'Append-only record of every grant and withdrawal made for your account. Historical entries are preserved intact.',
    rightsHeading: 'Your Data Principal Rights',
    rightsDescription:
      'Access, export, correct, or erase your data anytime. Withdrawing optional consent never automatically deletes legally required or core financial ledger records.',
    rightsExport: 'Export Data (JSON)',
    rightsCorrection: 'Correct Profile Data',
    rightsErasure: 'Delete Account & Data',
    rightsGrievance: 'Contact Grievance Officer',
    hardwarePermsSeparation:
      'Browser & OS hardware permissions (Camera, Microphone, Push) are controlled separately by your device and are never enabled via Select All.',
    dpdpHonestNote:
      'Designed to align with applicable principles of the Digital Personal Data Protection Act, 2023 and DPDP Rules, 2025. Statutory applicability remains subject to notified commencement provisions and independent legal review.',
  },
  hi: {
    languageName: 'हिंदी',
    headerBadge: 'आपकी गोपनीयता पसंद (YOUR PRIVACY CHOICES)',
    headerTitle: 'श्रेणी के अनुसार चुनें कि आप क्या साझा करना चाहते हैं।',
    headerSubtitle:
      'कोई भी वैकल्पिक विकल्प पहले से चुना हुआ नहीं है। आप Settings में कभी भी किसी भी विकल्प को बदल या वापस ले सकते हैं।',
    selectAllTitle: 'सभी वैकल्पिक चुनें (Select All Optional)',
    selectAllDescription: 'नीचे दी गई सभी 6 वैकल्पिक श्रेणियों को एक साथ चुनें या हटाएँ।',
    selectAllPartial: 'कुछ वैकल्पिक श्रेणियाँ चुनी गई हैं',
    selectAllSelected: 'सभी वैकल्पिक श्रेणियाँ चुनी गई हैं',
    selectAllHint:
      'इसमें आवश्यक वित्तीय डेटा प्रोसेसिंग या ब्राउज़र/OS अनुमतियाँ शामिल नहीं हैं।',
    deselectAll: 'सभी हटाएँ',
    selectedCountLabel: (selected, total) => `${total} में से ${selected} वैकल्पिक चुने गए`,
    optionalBadge: 'वैकल्पिक',
    learnMore: 'और जानें',
    hideDetails: 'विवरण छुपाएँ',
    dataInvolvedLabel: 'शामिल डेटा',
    detailPurpose: 'उद्देश्य',
    detailDataCategories: 'डेटा श्रेणियाँ',
    detailHowUsed: 'जानकारी का उपयोग कैसे होता है',
    detailProcessors: 'बाहरी प्रोसेसर',
    detailRetention: 'डेटा संरक्षण अवधि',
    detailWithdrawal: 'सहमति वापस लेने की प्रक्रिया',
    essentialTitle: 'आवश्यक वित्तीय डेटा प्रोसेसिंग (Essential Financial Data Processing)',
    essentialBadge: 'मूल सेवा · वैकल्पिक सहमति नहीं',
    essentialIntro:
      'My Money Manager by HackifyPro की मुख्य सेवाएँ प्रदान करने के लिए आपके द्वारा दर्ज कुछ वित्तीय रिकॉर्ड की प्रोसेसिंग आवश्यक है:',
    essentialItems: [
      'लेनदेन रिकॉर्डिंग',
      'आय और व्यय गणना',
      'खाता शेष (Account balances)',
      'वित्तीय सारांश',
      'रिपोर्ट्स',
      'बजट गणना',
      'उपयोगकर्ता द्वारा अनुरोधित उधार सुविधा',
    ],
    essentialLawfulBasis:
      'केवल आपके द्वारा अनुरोधित मूल सेवा प्रदान करने हेतु संसाधित (विवरण गोपनीयता सूचना में उपलब्ध)।',
    essentialNotOptionalNote:
      'आवश्यक सेवा प्रोसेसिंग वैकल्पिक सहमति के साथ बंडल नहीं है और Select All में शामिल नहीं है।',
    saveMyChoices: 'मेरी पसंद सहेजें',
    savingLabel: 'सहेजा जा रहा है...',
    privacyNoticeLink: 'गोपनीयता सूचना',
    footerMeta: 'उद्देश्य-विशिष्ट सहमति · केवल सहेजने पर ही रिकॉर्ड होगी',
    retrySave: 'पुनः प्रयास करें',
    saveErrorTitle: 'आपकी गोपनीयता पसंद सहेजी नहीं जा सकी',
    noImplicitConsentNote:
      'जब तक आप "मेरी पसंद सहेजें" पर क्लिक नहीं करते, कोई वैकल्पिक सहमति सहेजी नहीं जाती।',
    allOffInfoNote:
      'आप सभी वैकल्पिक श्रेणियों को बंद रखकर भी सहेज सकते हैं। मुख्य वित्तीय सुविधाएँ उपलब्ध रहेंगी।',
    settingsTitle: 'गोपनीयता और सहमति प्रबंधन',
    settingsSubtitle:
      'सक्रिय वैकल्पिक सहमतियाँ देखें, किसी भी श्रेणी को कभी भी वापस लें, या पूरा सहमति इतिहास जाँचें।',
    withdrawAllOptional: 'सभी वैकल्पिक वापस लें',
    withdrawingLabel: 'वापस लिया जा रहा है...',
    policyVersionLabel: 'नीति संस्करण',
    lastUpdatedLabel: 'अंतिम अद्यतन',
    statusGranted: 'सक्रिय',
    statusWithdrawn: 'वापस ली गई',
    statusNotGranted: 'सहमति नहीं दी गई',
    historyTab: 'सहमति इतिहास',
    preferencesTab: 'सहमति नियंत्रण',
    historyEmpty:
      'अभी तक कोई सहमति रिकॉर्ड नहीं है। जब तक आप स्पष्ट चयन न सहेजें, सभी वैकल्पिक श्रेणियाँ बंद रहेंगी।',
    historySubtitle:
      'आपके खाते की हर सहमति और वापसी का अपरिवर्तनीय (append-only) इतिहास सुरक्षित रखा जाता है।',
    rightsHeading: 'डेटा प्रिंसिपल के रूप में आपके अधिकार',
    rightsDescription:
      'कभी भी अपना डेटा देखें, सुधारें, निर्यात करें या हटाने का अनुरोध करें। वैकल्पिक सहमति वापस लेने से आपके मुख्य वित्तीय रिकॉर्ड अपने आप नहीं मिटते।',
    rightsExport: 'डेटा निर्यात (JSON)',
    rightsCorrection: 'प्रोफ़ाइल सुधारें',
    rightsErasure: 'खाता और डेटा हटाएँ',
    rightsGrievance: 'शिकायत अधिकारी से संपर्क करें',
    hardwarePermsSeparation:
      'कैमरा, माइक्रोफ़ोन और पुश अनुमतियाँ आपके ब्राउज़र/डिवाइस द्वारा अलग से नियंत्रित होती हैं।',
    dpdpHonestNote:
      'डिजिटल पर्सनल डेटा प्रोटेक्शन एक्ट, 2023 और DPDP नियम, 2025 के लागू सिद्धांतों के अनुरूप डिज़ाइन किया गया। पूर्ण वैधानिक अनुपालन अधिसूचित प्रावधानों और स्वतंत्र कानूनी समीक्षा के अधीन है।',
  },
  mr: {
    languageName: 'मराठी',
    headerBadge: 'तुमची गोपनीयता निवड (YOUR PRIVACY CHOICES)',
    headerTitle: 'प्रत्येक श्रेणीनुसार तुम्ही काय शेअर करू इच्छिता ते निवडा.',
    headerSubtitle:
      'कोणताही पर्यायी पर्याय आधीपासून निवडलेला नाही. तुम्ही Settings मध्ये कधीही निवड बदलू किंवा मागे घेऊ शकता.',
    selectAllTitle: 'सर्व पर्यायी निवडा (Select All Optional)',
    selectAllDescription: 'खालील सर्व 6 पर्यायी गोपनीयता श्रेणी एकत्र निवडा किंवा काढून टाका.',
    selectAllPartial: 'काही पर्यायी श्रेणी निवडल्या आहेत',
    selectAllSelected: 'सर्व पर्यायी श्रेणी निवडल्या आहेत',
    selectAllHint:
      'यामध्ये आवश्यक आर्थिक डेटा प्रक्रिया किंवा ब्राउझर/OS परवानग्या समाविष्ट नाहीत.',
    deselectAll: 'सर्व काढा',
    selectedCountLabel: (selected, total) => `${total} पैकी ${selected} पर्यायी निवडले`,
    optionalBadge: 'पर्यायी',
    learnMore: 'अधिक जाणून घ्या',
    hideDetails: 'तपशील लपवा',
    dataInvolvedLabel: 'संबंधित डेटा',
    detailPurpose: 'उद्देश',
    detailDataCategories: 'डेटा श्रेणी',
    detailHowUsed: 'माहितीचा वापर कसा होतो',
    detailProcessors: 'बाह्य प्रोसेसर',
    detailRetention: 'जतन कालावधी',
    detailWithdrawal: 'संमती मागे घेण्याची प्रक्रिया',
    essentialTitle: 'आवश्यक आर्थिक डेटा प्रक्रिया (Essential Financial Data Processing)',
    essentialBadge: 'मूळ सेवा · पर्यायी संमती नाही',
    essentialIntro:
      'My Money Manager by HackifyPro च्या मुख्य सेवा देण्यासाठी तुम्ही नोंदवलेल्या काही आर्थिक नोंदींवर प्रक्रिया करणे आवश्यक आहे:',
    essentialItems: [
      'व्यवहारांची नोंद',
      'उत्पन्न आणि खर्चाची गणना',
      'खाते शिल्लक (Account balances)',
      'आर्थिक सारांश',
      'अहवाल (Reports)',
      'बजेट गणना',
      'वापरकर्त्याने विनंती केलेली उधार सुविधा',
    ],
    essentialLawfulBasis:
      'फक्त तुम्ही विनंती केलेल्या मूळ सेवा पुरवण्यासाठी प्रक्रिया केली जाते (तपशील गोपनीयता सूचनेत उपलब्ध).',
    essentialNotOptionalNote:
      'आवश्यक सेवा प्रक्रिया पर्यायी संमतीशी जोडलेली नाही आणि Select All मध्ये समाविष्ट नाही.',
    saveMyChoices: 'माझी निवड जतन करा',
    savingLabel: 'जतन होत आहे...',
    privacyNoticeLink: 'गोपनीयता सूचना',
    footerMeta: 'उद्देश-विशिष्ट संमती · फक्त जतन केल्यावरच नोंदवली जाते',
    retrySave: 'पुन्हा प्रयत्न करा',
    saveErrorTitle: 'तुमची गोपनीयता निवड जतन करता आली नाही',
    noImplicitConsentNote:
      'जोपर्यंत तुम्ही "माझी निवड जतन करा" क्लिक करत नाही तोपर्यंत कोणतीही संमती जतन होत नाही.',
    allOffInfoNote:
      'तुम्ही सर्व पर्यायी श्रेणी बंद ठेवूनही जतन करू शकता. मुख्य आर्थिक सुविधा सुरू राहतील.',
    settingsTitle: 'गोपनीयता आणि संमती व्यवस्थापन',
    settingsSubtitle:
      'सक्रिय पर्यायी संमती पहा, कोणतीही श्रेणी कधीही मागे घ्या किंवा संपूर्ण संमती इतिहास तपासा.',
    withdrawAllOptional: 'सर्व पर्यायी मागे घ्या',
    withdrawingLabel: 'मागे घेत आहे...',
    policyVersionLabel: 'धोरण आवृत्ती',
    lastUpdatedLabel: 'अंतिम अद्यतन',
    statusGranted: 'सक्रिय',
    statusWithdrawn: 'मागे घेतली',
    statusNotGranted: 'संमती दिलेली नाही',
    historyTab: 'संमती इतिहास',
    preferencesTab: 'संमती नियंत्रणे',
    historyEmpty:
      'अद्याप कोणतीही संमती नोंद नाही. तुम्ही स्पष्ट निवड जतन करेपर्यंत सर्व पर्यायी श्रेणी बंद राहतील.',
    historySubtitle:
      'तुमच्या खात्यासाठी दिलेल्या आणि मागे घेतलेल्या प्रत्येक संमतीचा अबाधित इतिहास जतन केला जातो.',
    rightsHeading: 'डेटा प्रिन्सिपल म्हणून तुमचे अधिकार',
    rightsDescription:
      'तुमचा डेटा कधीही पहा, दुरुस्त करा, एक्सपोर्ट करा किंवा हटवण्याची विनंती करा. पर्यायी संमती मागे घेतल्याने मूळ आर्थिक नोंदी आपोआप हटवल्या जात नाहीत.',
    rightsExport: 'डेटा एक्सपोर्ट (JSON)',
    rightsCorrection: 'प्रोफाइल दुरुस्ती',
    rightsErasure: 'खाते व डेटा हटवा',
    rightsGrievance: 'तक्रार अधिकाऱ्याशी संपर्क साधा',
    hardwarePermsSeparation:
      'कॅमेरा, मायक्रोफोन आणि पुश परवानग्या तुमच्या डिव्हाइस/ब्राउझरद्वारे वेगळ्या नियंत्रित केल्या जातात.',
    dpdpHonestNote:
      'डिजिटल पर्सनल डेटा प्रोटेक्शन कायदा, 2023 आणि DPDP नियम, 2025 च्या लागू तत्त्वांनुसार तयार केले आहे. पूर्ण वैधानिक अनुपालन अधिसूचित तरतुदी आणि स्वतंत्र कायदेशीर पुनरावलोकनाच्या अधीन आहे.',
  },
};

// ============================================================================
// STANDALONE TRILINGUAL PRIVACY NOTICE (PART 11)
// ============================================================================

export interface PrivacyNoticeDocument {
  title: string;
  subtitle: string;
  disclaimer: string;
  sections: Array<{
    heading: string;
    paragraphs: string[];
  }>;
}

export const STANDALONE_PRIVACY_NOTICE: Record<ConsentLanguage, PrivacyNoticeDocument> = {
  en: {
    title: 'Standalone Privacy Notice',
    subtitle: 'My Money Manager by HackifyPro · Plain-language data & consent disclosures',
    disclaimer:
      'This notice is aligned with applicable transparency and consent principles of the Digital Personal Data Protection Act, 2023 and DPDP Rules, 2025. Full legal compliance depends on notified commencement dates and independent legal review.',
    sections: [
      {
        heading: '1. Data Fiduciary & Product Identity',
        paragraphs: [
          'My Money Manager is a personal finance application developed and operated by HackifyPro.',
          'We do not sell, rent, or trade your personal or financial records to advertising networks, data brokers, or credit bureaus.',
        ],
      },
      {
        heading: '2. Essential Financial Data Processing (Core Service)',
        paragraphs: [
          'To provide the core account and ledger features you explicitly request, we process your account identity (name, email, securely hashed password) and the financial entries you create: transactions, income and expense calculations, account balances, summaries, reports, budget calculations, and user-requested Udhar tracking.',
          'Essential processing is strictly limited to delivering these core services and is never bundled with optional marketing, analytics, or external AI processing.',
        ],
      },
      {
        heading: '3. Purpose-Specific Optional Consents',
        paragraphs: [
          'Optional features — Cloud Sync replication, AI External Processing (Google Gemini API), Two-way Udhar Sharing, Analytics & Usage Data, Personalization, and Marketing & Promotional Updates — are strictly opt-in and unchecked by default.',
          'You may grant, skip, change, or withdraw any optional category independently in Settings → Privacy → Manage Consent. Withdrawing optional consent stops that consent-based processing without deleting your core financial records.',
        ],
      },
      {
        heading: '4. Data Retention & Safeguards',
        paragraphs: [
          'Account and ledger data are isolated per user via PostgreSQL Row Level Security (RLS), encrypted in transit (HTTPS/TLS), and protected by hashed credentials (bcrypt) and authenticated sessions.',
          'Consent history entries are stored append-only (preserving policy version, timestamps, and status) so you can inspect when each consent was granted or withdrawn. UPI detection logs, when enabled, are retained for 90 days; aggregated analytics, if opted in, up to 12 months.',
        ],
      },
      {
        heading: '5. Your Rights (Access, Correction, Erasure & Withdrawal)',
        paragraphs: [
          'Access & Portability: View all records in-app or export a complete JSON backup under Settings → Preferences & Backup.',
          'Correction: Update your name, phone, avatar, or transaction entries directly in Settings → Profile & Security or the transaction ledger.',
          'Erasure: Schedule permanent account & data deletion (with a 24-hour cancellation safeguard) under Settings → Delete Account & Data.',
          'Withdrawal & Consent History: Withdraw any or all optional consents in one click under Settings → Privacy → Manage Consent.',
        ],
      },
      {
        heading: '6. Grievance Redressal Officer',
        paragraphs: [
          'For privacy questions, consent concerns, correction requests, or grievances, contact HackifyPro Support & Grievance Desk:',
          'Email: hackifypro@gmail.com · Helpline: +91 74149 35405 (Monday – Saturday, 10:00 AM – 6:00 PM IST).',
        ],
      },
    ],
  },
  hi: {
    title: 'स्वतंत्र गोपनीयता सूचना (Standalone Privacy Notice)',
    subtitle: 'My Money Manager by HackifyPro · सरल भाषा में डेटा और सहमति विवरण',
    disclaimer:
      'यह सूचना डिजिटल पर्सनल डेटा प्रोटेक्शन एक्ट, 2023 और DPDP नियम, 2025 के लागू सिद्धांतों के अनुरूप तैयार की गई है। पूर्ण वैधानिक अनुपालन अधिसूचित प्रारंभ तिथियों और स्वतंत्र कानूनी समीक्षा के अधीन है।',
    sections: [
      {
        heading: '1. डेटा फ़िड्यूशियरी और उत्पाद पहचान',
        paragraphs: [
          'My Money Manager, HackifyPro द्वारा विकसित और संचालित एक व्यक्तिगत वित्त ऐप है।',
          'हम आपका व्यक्तिगत या वित्तीय डेटा विज्ञापन नेटवर्क, डेटा ब्रोकर या क्रेडिट ब्यूरो को कभी नहीं बेचते या किराए पर नहीं देते।',
        ],
      },
      {
        heading: '2. आवश्यक वित्तीय डेटा प्रोसेसिंग (मूल सेवा)',
        paragraphs: [
          'आपके द्वारा अनुरोधित मुख्य खाता और लेजर सुविधाएँ प्रदान करने के लिए, हम आपकी खाता पहचान (नाम, ईमेल, एन्क्रिप्टेड पासवर्ड) और आपके द्वारा दर्ज वित्तीय प्रविष्टियाँ (लेनदेन, आय/व्यय गणना, शेष राशि, सारांश, रिपोर्ट्स, बजट और उधार ट्रैकिंग) संसाधित करते हैं।',
          'यह आवश्यक प्रोसेसिंग केवल मूल सेवा प्रदान करने तक सीमित है और वैकल्पिक सहमति के साथ बंडल नहीं की जाती।',
        ],
      },
      {
        heading: '3. उद्देश्य-विशिष्ट वैकल्पिक सहमतियाँ',
        paragraphs: [
          'क्लाउड सिंक, AI बाहरी प्रोसेसिंग (Google Gemini API), टू-वे उधार शेयरिंग, एनालिटिक्स, पर्सनलाइज़ेशन और मार्केटिंग अपडेट सभी पूरी तरह वैकल्पिक हैं और डिफ़ॉल्ट रूप से अनचेक रहते हैं।',
          'आप Settings → Privacy → Manage Consent में किसी भी समय किसी भी श्रेणी को चालू या बंद (वापस) कर सकते हैं। सहमति वापस लेने से आपके मुख्य वित्तीय रिकॉर्ड नहीं मिटते।',
        ],
      },
      {
        heading: '4. डेटा संरक्षण और सुरक्षा उपाय',
        paragraphs: [
          'आपका डेटा PostgreSQL Row Level Security (RLS), HTTPS/TLS एन्क्रिप्शन और bcrypt पासवर्ड हैशिंग से सुरक्षित है।',
          'सहमति इतिहास (नीति संस्करण, समय और स्थिति सहित) अपरिवर्तनीय रूप से सहेजा जाता है ताकि आप कभी भी अपनी सहमतियाँ देख सकें।',
        ],
      },
      {
        heading: '5. आपके अधिकार (एक्सेस, सुधार, विलोपन और वापसी)',
        paragraphs: [
          'एक्सेस और बैकअप: Settings → Preferences & Backup से अपना पूरा JSON बैकअप डाउनलोड करें।',
          'सुधार: Settings → Profile & Security में अपनी जानकारी कभी भी अपडेट करें।',
          'खाता विलोपन (Erasure): Settings → Delete Account & Data से 24 घंटे के सुरक्षा समय के साथ स्थायी विलोपन शेड्यूल करें।',
          'सहमति वापसी: Settings → Privacy → Manage Consent से एक क्लिक में किसी भी या सभी वैकल्पिक सहमतियों को वापस लें।',
        ],
      },
      {
        heading: '6. शिकायत निवारण अधिकारी (Grievance Contact)',
        paragraphs: [
          'गोपनीयता प्रश्नों या शिकायतों के लिए HackifyPro से संपर्क करें:',
          'ईमेल: hackifypro@gmail.com · हेल्पलाइन: +91 74149 35405 (सोमवार – शनिवार, सुबह 10:00 – शाम 6:00 IST)।',
        ],
      },
    ],
  },
  mr: {
    title: 'स्वतंत्र गोपनीयता सूचना (Standalone Privacy Notice)',
    subtitle: 'My Money Manager by HackifyPro · सोप्या भाषेत डेटा व संमती तपशील',
    disclaimer:
      'ही सूचना डिजिटल पर्सनल डेटा प्रोटेक्शन कायदा, 2023 आणि DPDP नियम, 2025 च्या लागू तत्त्वांशी सुसंगत आहे. पूर्ण कायदेशीर अनुपालन अधिसूचित तारखा आणि स्वतंत्र कायदेशीर पुनरावलोकनाच्या अधीन आहे.',
    sections: [
      {
        heading: '1. डेटा फिड्युशियरी आणि उत्पादन ओळख',
        paragraphs: [
          'My Money Manager हे HackifyPro ने विकसित व संचालित केलेले वैयक्तिक आर्थिक व्यवस्थापन ॲप आहे.',
          'आम्ही तुमचा वैयक्तिक किंवा आर्थिक डेटा जाहिरात नेटवर्क, डेटा ब्रोकर किंवा क्रेडिट ब्युरोला कधीही विकत किंवा भाड्याने देत नाही.',
        ],
      },
      {
        heading: '2. आवश्यक आर्थिक डेटा प्रक्रिया (मूळ सेवा)',
        paragraphs: [
          'तुम्ही विनंती केलेल्या मुख्य सेवा देण्यासाठी आम्ही तुमची खाते ओळख (नाव, ईमेल, सुरक्षित हॅश केलेला पासवर्ड) आणि तुमच्या आर्थिक नोंदी (व्यवहार, उत्पन्न/खर्च गणना, शिल्लक, सारांश, अहवाल, बजेट आणि उधार नोंदी) प्रक्रिया करतो.',
          'आवश्यक प्रक्रिया केवळ मूळ सेवा देण्यापुरती मर्यादित असून पर्यायी संमतीशी जोडलेली नाही.',
        ],
      },
      {
        heading: '3. उद्देश-विशिष्ट पर्यायी संमती',
        paragraphs: [
          'क्लाउड सिंक, AI बाह्य प्रक्रिया (Google Gemini API), टू-वे उधार शेअरिंग, ॲनालिटिक्स, पर्सनलायझेशन आणि मार्केटिंग अपडेट्स हे सर्व पर्यायी असून डीफॉल्टनुसार अनचेक असतात.',
          'तुम्ही Settings → Privacy → Manage Consent मध्ये कधीही कोणतीही संमती देऊ किंवा मागे घेऊ शकता. संमती मागे घेतल्याने तुमच्या मुख्य आर्थिक नोंदी हटवल्या जात नाहीत.',
        ],
      },
      {
        heading: '4. डेटा जतन कालावधी आणि सुरक्षा उपाय',
        paragraphs: [
          'तुमचा डेटा PostgreSQL Row Level Security (RLS), HTTPS/TLS एन्क्रिप्शन आणि bcrypt पासवर्ड सुरक्षेने संरक्षित केला जातो.',
          'संमतीचा इतिहास (धोरण आवृत्ती, तारीख व स्थितीसह) अपरिवर्तनीय स्वरूपात जतन केला जातो.',
        ],
      },
      {
        heading: '5. तुमचे अधिकार (प्रवेश, दुरुस्ती, हटवणे आणि माघार)',
        paragraphs: [
          'डेटा प्रवेश आणि बॅकअप: Settings → Preferences & Backup मधून संपूर्ण JSON बॅकअप एक्सपोर्ट करा.',
          'दुरुस्ती: Settings → Profile & Security मध्ये तुमची माहिती कधीही अद्ययावत करा.',
          'खाते हटवणे (Erasure): Settings → Delete Account & Data मधून 24 तासांच्या सुरक्षित कालावधीसह कायमस्वरूपी खाते हटवण्याची विनंती करा.',
          'संमती माघार: Settings → Privacy → Manage Consent मधून एका क्लिकवर कोणतीही किंवा सर्व पर्यायी संमती मागे घ्या.',
        ],
      },
      {
        heading: '6. तक्रार निवारण अधिकारी (Grievance Contact)',
        paragraphs: [
          'गोपनीयता प्रश्न किंवा तक्रारींसाठी HackifyPro शी संपर्क साधा:',
          'ईमेल: hackifypro@gmail.com · हेल्पलाइन: +91 74149 35405 (सोमवार – शनिवार, सकाळी 10:00 – संध्याकाळी 6:00 IST).',
        ],
      },
    ],
  },
};
