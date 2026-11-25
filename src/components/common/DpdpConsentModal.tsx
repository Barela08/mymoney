import React, { useState, useEffect } from 'react';
import { ShieldCheck, Check, FileText, ShieldAlert } from 'lucide-react';
import {
  getStoredDpdpConsent,
  saveConsentChoices,
  getStoredConsentChoices,
  CONSENT_CATEGORIES,
  CONSENT_CATEGORY_META,
  ConsentChoices,
  ConsentCategory,
} from './DpdpConsentBanner';

interface DpdpConsentModalProps {
  isOpen?: boolean;
  onSave?: (choices: ConsentChoices) => void;
  onOpenPrivacyPolicy?: () => void;
}

/**
 * Purpose-specific consent. Every control starts unchecked, nothing is stored
 * until the user saves, and declining optional processing keeps the app usable.
 */
export const DpdpConsentModal: React.FC<DpdpConsentModalProps> = ({
  isOpen: forcedIsOpen,
  onSave,
  onOpenPrivacyPolicy,
}) => {
  const [isModalVisible, setIsModalVisible] = useState<boolean>(false);
  const [choices, setChoices] = useState<ConsentChoices>(getStoredConsentChoices);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const current = getStoredDpdpConsent();
    // Never pre-tick anything that was not explicitly granted before.
    setChoices(getStoredConsentChoices());
    if (forcedIsOpen !== undefined) {
      setIsModalVisible(forcedIsOpen);
    } else {
      setIsModalVisible(!current.hasAnswered);
    }
  }, [forcedIsOpen]);

  const toggle = (key: ConsentCategory) => {
    setChoices((prev) => ({ ...prev, [key]: !prev[key] }));
  };

  const handleSave = () => {
    const saved = saveConsentChoices(choices);
    setIsModalVisible(false);
    if (onSave) onSave({ ...choices, ...(saved.categories || {}) });
  };

  if (!isModalVisible) return null;

  const anySelected = CONSENT_CATEGORIES.some((key) => choices[key]);

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-emerald-500/30 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        <div className="bg-gradient-to-r from-emerald-700 to-teal-800 p-5 text-white text-left relative">
          <div className="flex items-center justify-between mb-2">
            <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-white/20 border border-white/30 backdrop-blur-sm">
              Your privacy choices
            </span>
            <ShieldCheck className="w-5 h-5 text-emerald-200" />
          </div>
          <h2 className="text-lg font-black tracking-tight leading-snug">
            Choose what you share, category by category
          </h2>
          <p className="text-[11px] text-emerald-100/90 mt-1">
            Nothing here is pre-selected. You can change or withdraw any choice in Settings.
          </p>
        </div>

        <div className="p-5 space-y-3 text-left overflow-y-auto">
          {CONSENT_CATEGORY_META.map((item) => {
            const Icon = item.icon;
            return (
              <label
                key={item.key}
                className="flex items-start gap-3 p-3 rounded-2xl border border-slate-200 dark:border-slate-700 bg-slate-50/60 dark:bg-slate-800/50 cursor-pointer hover:border-emerald-300 transition-colors"
              >
                <input
                  type="checkbox"
                  checked={Boolean(choices[item.key])}
                  onChange={() => toggle(item.key)}
                  className="mt-0.5 h-4 w-4 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer shrink-0"
                />
                <div className="min-w-0">
                  <div className="flex items-center gap-1.5 flex-wrap">
                    <Icon className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400" />
                    <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {item.label}
                    </span>
                    <span
                      className={`text-[9px] px-1.5 py-0.5 rounded font-bold ${
                        item.optional
                          ? 'bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300'
                          : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                      }`}
                    >
                      {item.optional ? 'Optional' : 'Needed for calculations'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-600 dark:text-slate-300 mt-1 leading-relaxed">
                    {item.purpose}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-1">Data involved: {item.data}</p>
                </div>
              </label>
            );
          })}

          {!anySelected && (
            <div className="flex items-start gap-2 p-3 rounded-xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800">
              <ShieldAlert className="w-4 h-4 text-amber-600 shrink-0 mt-0.5" />
              <p className="text-[11px] text-amber-800 dark:text-amber-300 leading-relaxed">
                With everything off, the app still works on this device, but records will not sync to
                your account or other devices.
              </p>
            </div>
          )}
        </div>

        <div className="p-5 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          {onOpenPrivacyPolicy ? (
            <button
              type="button"
              onClick={onOpenPrivacyPolicy}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer order-2 sm:order-1"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>Read the privacy notice</span>
            </button>
          ) : (
            <div className="text-[11px] text-slate-400 order-2 sm:order-1">
              Purpose-specific consent · DPDP Act 2023
            </div>
          )}

          <button
            type="button"
            onClick={handleSave}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer order-1 sm:order-2"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>Save my choices</span>
          </button>
        </div>
      </div>
    </div>
  );
};
