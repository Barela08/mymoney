import React, { useEffect } from 'react';
import { X, ShieldCheck, Mail, Phone, ExternalLink } from 'lucide-react';
import {
  PRIVACY_POLICY_LAST_UPDATED,
  PRIVACY_POLICY_VERSION,
  STANDALONE_PRIVACY_NOTICE,
  type ConsentLanguage,
} from '../../lib/privacyConsent';
import { SUPPORT_CONTACT } from '../../config/contact';

interface PrivacyNoticeModalProps {
  isOpen: boolean;
  onClose: () => void;
  language: ConsentLanguage;
  onChangeLanguage: (lang: ConsentLanguage) => void;
  onOpenFullLegalCenter?: () => void;
}

const LANGUAGES: Array<{ code: ConsentLanguage; label: string }> = [
  { code: 'en', label: 'English' },
  { code: 'hi', label: 'हिंदी' },
  { code: 'mr', label: 'मराठी' },
];

export const PrivacyNoticeModal: React.FC<PrivacyNoticeModalProps> = ({
  isOpen,
  onClose,
  language,
  onChangeLanguage,
  onOpenFullLegalCenter,
}) => {
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  if (!isOpen) return null;

  const doc = STANDALONE_PRIVACY_NOTICE[language];

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center p-3 sm:p-4 bg-slate-950/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="standalone-privacy-notice-title"
    >
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl w-full max-w-2xl max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Header */}
        <div className="px-5 py-4 sm:px-6 sm:py-5 border-b border-slate-200 dark:border-slate-800 flex items-start justify-between gap-4 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-start gap-3 min-w-0">
            <div className="w-10 h-10 rounded-2xl bg-emerald-50 dark:bg-emerald-950/70 border border-emerald-200 dark:border-emerald-800/60 flex items-center justify-center text-emerald-700 dark:text-emerald-400 shrink-0">
              <ShieldCheck className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <h2
                id="standalone-privacy-notice-title"
                className="text-base sm:text-lg font-bold text-slate-900 dark:text-slate-100 leading-snug"
              >
                {doc.title}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                {doc.subtitle}
              </p>
              <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500 dark:text-slate-400 mt-1.5 tabular-nums">
                <span>{PRIVACY_POLICY_VERSION}</span>
                <span aria-hidden="true">·</span>
                <span>Updated {PRIVACY_POLICY_LAST_UPDATED}</span>
              </div>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close privacy notice"
            className="p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Language Switcher */}
        <div className="px-5 sm:px-6 py-2.5 border-b border-slate-100 dark:border-slate-800/80 bg-slate-50/70 dark:bg-slate-900/60 flex items-center justify-between gap-3 shrink-0">
          <span className="text-xs font-medium text-slate-500 dark:text-slate-400">
            Language / भाषा
          </span>
          <div className="inline-flex items-center gap-1 p-1 rounded-xl bg-slate-200/70 dark:bg-slate-800">
            {LANGUAGES.map((item) => (
              <button
                key={item.code}
                type="button"
                onClick={() => onChangeLanguage(item.code)}
                className={`px-3 py-1 rounded-lg text-xs font-semibold transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 ${
                  language === item.code
                    ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-400 shadow-sm'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                {item.label}
              </button>
            ))}
          </div>
        </div>

        {/* Scrollable Content */}
        <div className="p-5 sm:p-6 overflow-y-auto space-y-5 flex-1 text-left">
          <div className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
            {doc.disclaimer}
          </div>

          <div className="space-y-5">
            {doc.sections.map((section, idx) => (
              <section key={idx} className="space-y-1.5">
                <h3 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                  {section.heading}
                </h3>
                <div className="space-y-2">
                  {section.paragraphs.map((p, pIdx) => (
                    <p
                      key={pIdx}
                      className="text-xs sm:text-[13px] text-slate-600 dark:text-slate-300 leading-relaxed"
                    >
                      {p}
                    </p>
                  ))}
                </div>
              </section>
            ))}
          </div>

          {/* Direct Grievance Contacts */}
          <div className="p-4 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200/80 dark:border-emerald-900/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
            <div className="space-y-0.5 text-xs">
              <p className="font-bold text-slate-900 dark:text-slate-100">
                HackifyPro Grievance &amp; Support Desk
              </p>
              <p className="text-slate-600 dark:text-slate-300">
                {SUPPORT_CONTACT.operatingHours}
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <a
                href={`mailto:${SUPPORT_CONTACT.email}?subject=My%20Money%20Manager%20-%20Privacy%20%26%20DPDP%20Inquiry`}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-emerald-400 transition-colors"
              >
                <Mail className="w-3.5 h-3.5 text-emerald-600" />
                <span>{SUPPORT_CONTACT.email}</span>
              </a>
              <a
                href={SUPPORT_CONTACT.telUrl}
                className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl text-xs font-semibold bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 hover:border-emerald-400 transition-colors tabular-nums"
              >
                <Phone className="w-3.5 h-3.5 text-emerald-600" />
                <span>{SUPPORT_CONTACT.displayPhone}</span>
              </a>
            </div>
          </div>
        </div>

        {/* Footer */}
        <div className="px-5 py-3.5 sm:px-6 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-900 flex items-center justify-between gap-3 shrink-0">
          {onOpenFullLegalCenter ? (
            <button
              type="button"
              onClick={() => {
                onClose();
                onOpenFullLegalCenter();
              }}
              className="inline-flex items-center gap-1.5 text-xs font-semibold text-emerald-700 dark:text-emerald-400 hover:underline cursor-pointer whitespace-nowrap"
            >
              <ExternalLink className="w-3.5 h-3.5" />
              <span>Open Full Legal Center</span>
            </button>
          ) : (
            <span className="text-xs text-slate-500 dark:text-slate-400">
              My Money Manager by HackifyPro
            </span>
          )}
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-semibold transition-colors cursor-pointer whitespace-nowrap focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-600 focus-visible:ring-offset-2"
          >
            Close
          </button>
        </div>
      </div>
    </div>
  );
};
