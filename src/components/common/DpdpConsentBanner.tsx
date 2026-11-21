import React, { useState, useEffect } from 'react';
import { ShieldCheck, ShieldAlert, X, ExternalLink, Check, Lock } from 'lucide-react';

const DPDP_STORAGE_KEY = 'my_money_dpdp_consent_v1';

export interface DpdpConsentState {
  hasAnswered: boolean;
  isConsented: boolean;
  consentedAt?: string;
}

export const getStoredDpdpConsent = (): DpdpConsentState => {
  try {
    const saved = localStorage.getItem(DPDP_STORAGE_KEY);
    if (saved) return JSON.parse(saved);
  } catch {}
  return { hasAnswered: false, isConsented: true };
};

export const saveDpdpConsent = (isConsented: boolean): DpdpConsentState => {
  const state: DpdpConsentState = {
    hasAnswered: true,
    isConsented,
    consentedAt: new Date().toISOString(),
  };
  try {
    localStorage.setItem(DPDP_STORAGE_KEY, JSON.stringify(state));
  } catch {}
  return state;
};

interface DpdpConsentBannerProps {
  onOpenPrivacyModal?: () => void;
}

export const DpdpConsentBanner: React.FC<DpdpConsentBannerProps> = ({ onOpenPrivacyModal }) => {
  const [consentState, setConsentState] = useState<DpdpConsentState>(getStoredDpdpConsent);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    // Show banner only if the user hasn't made a choice yet
    if (!consentState.hasAnswered) {
      // Delay slightly for smooth page entrance
      const timer = setTimeout(() => setIsVisible(true), 800);
      return () => clearTimeout(timer);
    }
  }, [consentState.hasAnswered]);

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
        {/* Left: DPDP Notice & Hindi Explanation */}
        <div className="flex items-start gap-3 text-left w-full md:w-auto">
          <div className="w-10 h-10 rounded-2xl bg-emerald-500/20 border border-emerald-500/40 flex items-center justify-center text-emerald-400 shrink-0 mt-0.5">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div className="space-y-0.5">
            <div className="flex items-center gap-2">
              <span className="font-extrabold text-xs uppercase tracking-wider text-emerald-400">
                DPDP Act 2023 Compliance
              </span>
              <span className="text-[10px] px-1.5 py-0.2 rounded bg-slate-800 text-slate-300 border border-slate-700">
                डिजिटल व्यक्तिगत डेटा संरक्षण
              </span>
            </div>
            <p className="text-xs font-bold text-slate-100">
              क्या आप डेटा कलेक्शन और मल्टी-डिवाइस सिंक की अनुमति देते हैं?
            </p>
            <p className="text-[11px] text-slate-400 max-w-2xl leading-relaxed">
              हम आपके खर्च, रूम बजट और उधार का हिसाब दोनों मोबाइल और लैपटॉप में सुरक्षित सिंक करने के लिए डेटा प्रोसेस करते हैं। हम आपका डेटा कभी किसी तीसरे पक्ष को नहीं बेचते। आप जब चाहें सेटिंग्स में इसे बदल सकते हैं।
            </p>
          </div>
        </div>

        {/* Right: Actions */}
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
            title="डेटा केवल इसी डिवाइस पर रहेगा, क्लाउड में नहीं जाएगा"
          >
            केवल लोकल रखें (Deny)
          </button>

          <button
            type="button"
            onClick={() => handleChoice(true)}
            className="flex items-center gap-1.5 px-4 py-2 text-xs font-bold text-slate-950 bg-emerald-400 hover:bg-emerald-300 rounded-xl shadow-lg shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer"
          >
            <Check className="w-3.5 h-3.5 stroke-[3]" />
            <span>हाँ, अनुमति दें (Allow)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
