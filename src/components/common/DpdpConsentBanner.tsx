import React from 'react';
import {
  Cloud,
  Users,
  Cpu,
  BarChart3,
  SlidersHorizontal,
  Megaphone,
} from 'lucide-react';
import {
  OPTIONAL_CONSENT_CATEGORIES,
  PRIVACY_POLICY_VERSION,
  isValidOptionalConsentCategory,
  type OptionalConsentCategory,
} from '../../lib/privacyConsent';
import { hasOptionalConsent } from '../../lib/privacyConsentApi';

export const DPDP_STORAGE_KEY = 'my_money_dpdp_consent_v2';
export const CONSENT_VERSION = PRIVACY_POLICY_VERSION;

export type ConsentCategory = OptionalConsentCategory | 'financial_processing';

export const CONSENT_CATEGORIES: OptionalConsentCategory[] = [...OPTIONAL_CONSENT_CATEGORIES];

export type ConsentChoices = Record<ConsentCategory, boolean>;

export interface DpdpConsentState {
  hasAnswered: boolean;
  isConsented: boolean;
  consentedAt?: string;
  version?: string;
  categories?: Partial<ConsentChoices>;
}

/**
 * CRITICAL: Every optional consent category defaults strictly to FALSE (unchecked).
 */
export const EMPTY_CONSENT_CHOICES: ConsentChoices = {
  cloud_sync: false,
  ai_processing: false,
  udhar_sharing: false,
  upi_qr: false,
  analytics: false,
  personalization: false,
  marketing_updates: false,
  financial_processing: false,
};

/**
 * Consent defaults to NOT granted. Only an explicit user action stores consent.
 */
export const getStoredDpdpConsent = (): DpdpConsentState => {
  try {
    const saved = localStorage.getItem(DPDP_STORAGE_KEY);
    if (saved) {
      const parsed = JSON.parse(saved) as DpdpConsentState;
      return {
        hasAnswered: Boolean(parsed.hasAnswered),
        isConsented: Boolean(parsed.isConsented),
        consentedAt: parsed.consentedAt,
        version: parsed.version,
        categories: parsed.categories || {},
      };
    }
    // Clear legacy blanket flag that predated category-by-category consent.
    localStorage.removeItem('my_money_dpdp_consent_v1');
  } catch {
    /* storage unavailable */
  }
  return { hasAnswered: false, isConsented: false };
};

export const getStoredConsentChoices = (): ConsentChoices => {
  const state = getStoredDpdpConsent();
  const stored = state.categories || {};
  const result: ConsentChoices = { ...EMPTY_CONSENT_CHOICES };
  for (const key of OPTIONAL_CONSENT_CATEGORIES) {
    result[key] = Boolean(stored[key]);
  }
  result.financial_processing = Boolean(stored.financial_processing);
  return result;
};

export const hasConsent = (category: ConsentCategory): boolean => {
  if (typeof window === 'undefined') return false;
  if (isValidOptionalConsentCategory(category)) {
    if (hasOptionalConsent(category)) return true;
  }
  return Boolean(getStoredConsentChoices()[category]);
};

/** Persist an explicit, per-category consent decision (legacy helper kept for compatibility). */
export const saveConsentChoices = (
  choices: Partial<ConsentChoices>,
  options: { explicitAction?: boolean } = {}
): DpdpConsentState => {
  const current = getStoredConsentChoices();
  const next: ConsentChoices = { ...current, ...choices };
  const state: DpdpConsentState = {
    hasAnswered: options.explicitAction !== false,
    isConsented: Boolean(
      next.cloud_sync ||
        next.ai_processing ||
        next.udhar_sharing ||
        next.analytics ||
        next.personalization ||
        next.marketing_updates ||
        next.financial_processing
    ),
    consentedAt: new Date().toISOString(),
    version: CONSENT_VERSION,
    categories: next,
  };
  try {
    localStorage.setItem(DPDP_STORAGE_KEY, JSON.stringify(state));
    window.dispatchEvent(new CustomEvent('my-money-consent-changed', { detail: state }));
  } catch {
    /* storage unavailable */
  }
  return state;
};

/** Backwards-compatible single-flag helper retained for existing unit tests. */
export const saveDpdpConsent = (isConsented: boolean): DpdpConsentState =>
  saveConsentChoices({
    cloud_sync: isConsented,
  });

if (typeof window !== 'undefined') {
  window.addEventListener('storage', (event) => {
    if (event.key === DPDP_STORAGE_KEY) {
      window.dispatchEvent(new CustomEvent('my-money-consent-changed'));
    }
  });
}

interface DpdpConsentBannerProps {
  onOpenPrivacyModal?: () => void;
}

/**
 * The legacy bottom banner previously offered a single bundled "Allow cloud sync" button.
 * It is intentionally disabled because the redesigned PrivacyChoicesModal now provides
 * granular, non-bundled, category-by-category optional choices with full disclosure.
 */
export const DpdpConsentBanner: React.FC<DpdpConsentBannerProps> = () => {
  return null;
};

export const CONSENT_CATEGORY_META: Array<{
  key: OptionalConsentCategory;
  label: string;
  data: string;
  purpose: string;
  optional: true;
  icon: React.ComponentType<{ className?: string }>;
}> = [
  {
    key: 'cloud_sync',
    label: 'Cloud Sync',
    data: 'Income, expenses, budgets, bills, savings and Udhar records',
    purpose: 'Keeps your records synchronized and backed up across your connected devices.',
    optional: true,
    icon: Cloud,
  },
  {
    key: 'ai_processing',
    label: 'AI External Processing',
    data: 'Selected financial summaries, chat queries, or receipt images when you use AI features',
    purpose: 'Sends selected data to Google Gemini API only when you invoke AI features.',
    optional: true,
    icon: Cpu,
  },
  {
    key: 'udhar_sharing',
    label: 'Two-way Udhar Sharing',
    data: 'Display name, avatar and only the Udhar entries you explicitly select to share',
    purpose: 'Shares selected Udhar entries with connected people after recipient acceptance.',
    optional: true,
    icon: Users,
  },
  {
    key: 'analytics',
    label: 'Analytics & Usage Data',
    data: 'Aggregated feature usage and reliability diagnostics',
    purpose: 'Helps improve app performance and reliability. Never required for core features.',
    optional: true,
    icon: BarChart3,
  },
  {
    key: 'personalization',
    label: 'Personalization',
    data: 'Dashboard preferences, suggestion interactions and saved UI layout choices',
    purpose: 'Customizes dashboard preferences and optional in-app suggestions.',
    optional: true,
    icon: SlidersHorizontal,
  },
  {
    key: 'marketing_updates',
    label: 'Marketing & Promotional Updates',
    data: 'Name, email address and promotional communication preference',
    purpose: 'Optional product news and offers, separate from essential security alerts.',
    optional: true,
    icon: Megaphone,
  },
];
