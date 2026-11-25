import React, { useEffect, useState } from 'react';
import { ShieldCheck, Lock, ExternalLink, RotateCcw } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  CONSENT_CATEGORY_META,
  ConsentCategory,
  ConsentChoices,
  EMPTY_CONSENT_CHOICES,
  getStoredConsentChoices,
  saveConsentChoices,
} from '../common/DpdpConsentBanner';

interface PrivacyConsentCardProps {
  onOpenPrivacyPolicy?: () => void;
}

/**
 * Settings → Privacy & Permissions. Each consent is independent, stored only
 * on explicit change, and can be withdrawn at any time.
 */
export const PrivacyConsentCard: React.FC<PrivacyConsentCardProps> = ({ onOpenPrivacyPolicy }) => {
  const toast = useToast();
  const [choices, setChoices] = useState<ConsentChoices>(getStoredConsentChoices);

  useEffect(() => {
    const sync = () => setChoices(getStoredConsentChoices());
    window.addEventListener('my-money-consent-changed', sync);
    return () => window.removeEventListener('my-money-consent-changed', sync);
  }, []);

  const update = (key: ConsentCategory, value: boolean) => {
    const next = { ...choices, [key]: value };
    setChoices(next);
    saveConsentChoices({ [key]: value } as Partial<ConsentChoices>);
    toast.success(
      value ? 'Consent granted' : 'Consent withdrawn',
      value
        ? 'Your choice was saved for this category only.'
        : 'This processing is now switched off for your account.'
    );
  };

  const withdrawAll = () => {
    setChoices({ ...EMPTY_CONSENT_CHOICES });
    saveConsentChoices(EMPTY_CONSENT_CHOICES);
    toast.info('Optional consents withdrawn', 'Only essential security processing remains active.');
  };

  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center border border-emerald-500/20">
            <ShieldCheck className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100">
              Privacy &amp; Permissions
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Each choice is separate. Turning something off never deletes your records.
            </p>
          </div>
        </div>
        <button
          type="button"
          onClick={withdrawAll}
          className="text-[11px] font-semibold text-slate-500 hover:text-rose-600 flex items-center gap-1 cursor-pointer shrink-0"
        >
          <RotateCcw className="w-3 h-3" />
          <span>Withdraw all</span>
        </button>
      </div>

      <div className="divide-y divide-slate-100 dark:divide-slate-800">
        {CONSENT_CATEGORY_META.map((item) => {
          const Icon = item.icon;
          const enabled = Boolean(choices[item.key]);
          return (
            <div key={item.key} className="py-3 flex items-start justify-between gap-3">
              <div className="flex items-start gap-2.5 min-w-0">
                <Icon className="w-4 h-4 text-emerald-600 dark:text-emerald-400 mt-0.5 shrink-0" />
                <div className="min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <p className="text-xs font-bold text-slate-900 dark:text-slate-100">
                      {item.label}
                    </p>
                    <span
                      className={`text-[9px] font-bold px-1.5 py-0.5 rounded ${
                        enabled
                          ? 'bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                      }`}
                    >
                      {enabled ? 'Enabled' : 'Disabled'}
                    </span>
                  </div>
                  <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5 leading-relaxed">
                    {item.purpose}
                  </p>
                  <p className="text-[10px] text-slate-400 mt-0.5">Data: {item.data}</p>
                </div>
              </div>

              <button
                type="button"
                role="switch"
                aria-checked={enabled}
                aria-label={`${item.label} consent`}
                onClick={() => update(item.key, !enabled)}
                className={`relative w-10 h-5 rounded-full transition-colors shrink-0 cursor-pointer mt-0.5 ${
                  enabled ? 'bg-emerald-600' : 'bg-slate-300 dark:bg-slate-700'
                }`}
              >
                <span
                  className={`absolute top-0.5 w-4 h-4 rounded-full bg-white shadow transition-all ${
                    enabled ? 'left-[22px]' : 'left-0.5'
                  }`}
                />
              </button>
            </div>
          );
        })}
      </div>

      <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex items-start justify-between gap-3">
        <p className="text-[10.5px] text-slate-400 leading-relaxed flex items-start gap-1.5">
          <Lock className="w-3 h-3 mt-0.5 shrink-0" />
          <span>
            Camera and microphone permissions are controlled by your browser and are requested only
            when you use that feature. Change them in your browser or device settings.
          </span>
        </p>
        {onOpenPrivacyPolicy && (
          <button
            type="button"
            onClick={onOpenPrivacyPolicy}
            className="text-[11px] font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 shrink-0 cursor-pointer"
          >
            <ExternalLink className="w-3 h-3" />
            <span>Notice</span>
          </button>
        )}
      </div>
    </div>
  );
};
