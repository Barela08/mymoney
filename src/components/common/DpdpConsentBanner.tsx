import React, { useState, useEffect } from 'react';
import {
  ShieldCheck,
  Check,
  Cloud,
  Calculator,
  Users,
  Sparkles,
  BarChart3,
} from 'lucide-react';

export const DPDP_STORAGE_KEY = 'my_money_dpdp_consent_v2';
export const CONSENT_VERSION = 'v1.3 — DPDP Act 2023';

export type ConsentCategory =
  | 'cloud_sync'
  | 'financial_processing'
  | 'udhar_sharing'
  | 'ai_processing'
  | 'analytics';

export const CONSENT_CATEGORIES: ConsentCategory[] = [
  'cloud_sync',
  'financial_processing',
  'udhar_sharing',
  'ai_processing',
  'analytics',
];

export type ConsentChoices = Record<ConsentCategory, boolean>;

export interface DpdpConsentState {
  hasAnswered: boolean;
  isConsented: boolean;
  consentedAt?: string;
  version?: string;
  categories?: Partial<ConsentChoices>;
}

export const EMPTY_CONSENT_CHOICES: ConsentChoices = {
  cloud_sync: false,
  financial_processing: false,
  udhar_sharing: false,
  ai_processing: false,
  analytics: false,
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
    // Migrate the older blanket flag, which was granted without a real choice.
    localStorage.removeItem('my_money_dpdp_consent_v1');
  } catch {
    /* storage unavailable */
  }
  return { hasAnswered: false, isConsented: false };
};

export const getStoredConsentChoices = (): ConsentChoices => {
  const state = getStoredDpdpConsent();
  const stored = state.categories || {};
  return CONSENT_CATEGORIES.reduce((acc, key) => {
    acc[key] = Boolean(stored[key]);
    return acc;
  }, { ...EMPTY_CONSENT_CHOICES });
};

export const hasConsent = (category: ConsentCategory): boolean => {
  if (typeof window === 'undefined') return false;
  return Boolean(getStoredConsentChoices()[category]);
};

/** Persist an explicit, per-category consent decision. */
export const saveConsentChoices = (
  choices: Partial<ConsentChoices>,
  options: { explicitAction?: boolean } = {}
): DpdpConsentState => {
  const current = getStoredConsentChoices();
  const next = { ...current, ...choices };
  const state: DpdpConsentState = {
    hasAnswered: options.explicitAction !== false,
    isConsented: Boolean(next.cloud_sync || next.financial_processing),
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

/** Backwards-compatible single-flag helper used by the banner. */
export const saveDpdpConsent = (isConsented: boolean): DpdpConsentState =>
  saveConsentChoices({
    cloud_sync: isConsented,
    financial_processing: isConsented,
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

export const DpdpConsentBanner: React.FC<DpdpConsentBannerProps> = ({ onOpenPrivacyModal }) => {
  const [consentState, setConsentState] = useState<DpdpConsentState>(getStoredDpdpConsent);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    const current = getStoredDpdpConsent();
    setConsentState(current);
    // Show only when the user has not made a choice yet.
    if (!current.hasAnswered) {
      const timer = setTimeout(() => setIsVisible(true), 800);
      return () => clearTimeout(timer);
    }
    setIsVisible(false);
  }, []);

  const handleChoice = (accepted: boolean) => {
    const updated = saveDpdpConsent(accepted);
    setConsentState(updated);
    setIsVisible(false);
  };

  if (!isVisible || consentState.hasAnswered) {
    return null;
  }

  return (
    <div className="fixed bottom-0 inset-x-0 z-50 p-3 sm:p-4 bg-slate-900/95 dark:bg-slate-950/95 text-white backdrop-blur-md border-t border-emerald-500/30 shadow-2xl animate-fade-in">
      <div className="max-w-6xl mx-auto flex flex-col md:flex-row items-center justify-between gap-3 sm:gap-4">
        <div className="flex items-start gap-3 text-left w-full md:w-auto">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xs uppercase tracking-wider text-emerald-400">
                Data &amp; privacy choices
              </span>
              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-300 border border-slate-700">
                Optional
              </span>
            </div>
            <p className="text-xs font-bold text-slate-100">
              Allow cloud sync of your financial records?
            </p>
            <p className="text-[11px] text-slate-400 max-w-2xl leading-relaxed">
              Cloud sync stores your expenses, budgets and Udhar records against your account so they
              appear on your other devices. You can turn it off here or in Settings → Privacy &amp;
              Permissions. Local-only use keeps working without it.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 w-full md:w-auto shrink-0 justify-end pt-1 md:pt-0">
          {onOpenPrivacyModal && (
            <button
              type="button"
              onClick={onOpenPrivacyModal}
              className="text-xs text-slate-400 hover:text-emerald-400 underline px-2 py-1.5 cursor-pointer mr-1"
            >
              Privacy Policy
            </button>
          )}

          <button
            type="button"
            onClick={() => handleChoice(false)}
            className="px-3.5 py-2 text-xs font-semibold text-slate-300 hover:text-white bg-slate-800 hover:bg-slate-700 border border-slate-700 rounded-xl transition-colors cursor-pointer"
            title="Keep data on this device only"
          >
            Not now
          </button>

          <button
            type="button"
            onClick={() => handleChoice(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer"
          >
            <Check className="w-3.5 h-3.5 stroke-[3]" />
            <span>Allow cloud sync</span>
          </button>
        </div>
      </div>
    </div>
  );
};

export const CONSENT_CATEGORY_META: Array<{
  key: ConsentCategory;
  label: string;
  data: string;
  purpose: string;
  optional: boolean;
  icon: any;
}> = [
  {
    key: 'cloud_sync',
    label: 'Cloud sync',
    data: 'Expenses, income, budgets, bills, savings and Udhar records',
    purpose: 'Keeps your records on your account so they appear on your other devices.',
    optional: true,
    icon: Cloud,
  },
  {
    key: 'financial_processing',
    label: 'Financial data processing',
    data: 'Your transactions and budgets',
    purpose: 'Required for totals, summaries, reports and Udhar balances to be calculated.',
    optional: false,
    icon: Calculator,
  },
  {
    key: 'udhar_sharing',
    label: 'Two-way Udhar sharing',
    data: 'Display name, avatar and the Udhar entries you choose to share',
    purpose:
      'Lets a connected person see only the Udhar entries you send them, after they accept your request.',
    optional: true,
    icon: Users,
  },
  {
    key: 'ai_processing',
    label: 'AI Financial Assistant',
    data: 'A summary of your financial context, sent to the AI provider when you ask a question',
    purpose:
      'Powers the assistant. Leave this off and you can still use every other feature; the assistant will ask before sending anything.',
    optional: true,
    icon: Sparkles,
  },
  {
    key: 'analytics',
    label: 'Optional analytics',
    data: 'Anonymous usage events',
    purpose: 'Helps improve the app. Never required, never enabled by default.',
    optional: true,
    icon: BarChart3,
  },
];
