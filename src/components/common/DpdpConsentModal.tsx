import React, { useState, useEffect } from 'react';
import { ShieldCheck, Lock, Check, FileText, ArrowRight, ShieldAlert, Sparkles } from 'lucide-react';
import { getStoredDpdpConsent, saveDpdpConsent, DpdpConsentState } from './DpdpConsentBanner';

interface DpdpConsentModalProps {
  isOpen?: boolean;
  onAccept?: () => void;
  onOpenPrivacyPolicy?: () => void;
}

export const DpdpConsentModal: React.FC<DpdpConsentModalProps> = ({
  isOpen: forcedIsOpen,
  onAccept,
  onOpenPrivacyPolicy,
}) => {
  const [consent, setConsent] = useState<DpdpConsentState>(getStoredDpdpConsent);
  const [isModalVisible, setIsModalVisible] = useState<boolean>(false);

  useEffect(() => {
    // If not answered yet or explicitly not consented, show modal
    const current = getStoredDpdpConsent();
    setConsent(current);
    if (forcedIsOpen !== undefined) {
      setIsModalVisible(forcedIsOpen);
    } else if (!current.hasAnswered || !current.isConsented) {
      setIsModalVisible(true);
    } else {
      setIsModalVisible(false);
    }
  }, [forcedIsOpen]);

  const handleAccept = () => {
    const updated = saveDpdpConsent(true);
    setConsent(updated);
    setIsModalVisible(false);
    if (onAccept) onAccept();
  };

  if (!isModalVisible) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-md animate-fade-in">
      <div className="bg-white dark:bg-slate-900 border border-emerald-500/30 rounded-3xl max-w-lg w-full shadow-2xl overflow-hidden flex flex-col">
        {/* Top Header Card */}
        <div className="bg-gradient-to-r from-emerald-600 to-teal-700 p-6 text-white text-left relative">
          <div className="flex items-center justify-between mb-3">
            <div className="flex items-center gap-2">
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-extrabold uppercase tracking-wider bg-white/20 border border-white/30 backdrop-blur-sm">
                DPDP Act 2023
              </span>
              <span className="px-2.5 py-0.5 rounded-full text-[10px] font-semibold bg-emerald-950/40 text-emerald-100">
                भारत सरकार डेटा संरक्षण
              </span>
            </div>
            <ShieldCheck className="w-6 h-6 text-emerald-200" />
          </div>

          <h2 className="text-xl font-black tracking-tight leading-snug">
            डिजिटल व्यक्तिगत डेटा संरक्षण सहमति
          </h2>
          <p className="text-xs text-emerald-100/90 mt-1">
            Data Privacy & Security Consent under India DPDP Act 2023
          </p>
        </div>

        {/* Content Body */}
        <div className="p-6 space-y-4 text-left max-h-[60vh] overflow-y-auto">
          <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800/60 rounded-2xl">
            <p className="text-xs text-emerald-900 dark:text-emerald-200 leading-relaxed font-medium">
              <b>My Money Manager</b> में आपका स्वागत है। आपके वित्तीय डेटा (खर्च, होम बजट, रूम किराया, और उधार का हिसाब) को सुरक्षित रखने और आपके फोन व लैपटॉप में सिंक करने के लिए आपकी स्पष्ट सहमति आवश्यक है।
            </p>
          </div>

          <div className="space-y-3">
            <h4 className="text-xs font-bold text-slate-800 dark:text-slate-200 uppercase tracking-wider">
              हम आपका डेटा कैसे सुरक्षित रखते हैं?
            </h4>

            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5">
                <Lock className="w-4 h-4" />
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <span className="font-bold text-slate-900 dark:text-slate-100 block">
                  एन्क्रिप्टेड एवं सुरक्षित आर्किटेक्चर
                </span>
                आपका पासवर्ड और वित्तीय रिकॉर्ड सुरक्षित क्लाउड पर एन्क्रिप्टेड रूप में स्टोर किए जाते हैं।
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5">
                <ShieldCheck className="w-4 h-4" />
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <span className="font-bold text-slate-900 dark:text-slate-100 block">
                  शून्य विज्ञापन एवं कोई तृतीय-पक्ष बिक्री नहीं
                </span>
                हम आपका व्यक्तिगत या वित्तीय डेटा कभी किसी तीसरे पक्ष, विज्ञापनदाता या कंपनी को नहीं बेचते।
              </div>
            </div>

            <div className="flex items-start gap-3">
              <div className="w-7 h-7 rounded-lg bg-slate-100 dark:bg-slate-800 flex items-center justify-center shrink-0 text-emerald-600 dark:text-emerald-400 mt-0.5">
                <Sparkles className="w-4 h-4" />
              </div>
              <div className="text-xs text-slate-600 dark:text-slate-300 leading-relaxed">
                <span className="font-bold text-slate-900 dark:text-slate-100 block">
                  पूर्ण नियंत्रण एवं सहमति वापसी
                </span>
                आप किसी भी समय सेटिंग्स में जाकर अपनी सहमति बदल सकते हैं, डेटा डाउनलोड कर सकते हैं, या खाता हटा सकते हैं।
              </div>
            </div>
          </div>
        </div>

        {/* Footer Actions */}
        <div className="p-6 bg-slate-50 dark:bg-slate-900/80 border-t border-slate-200 dark:border-slate-800 flex flex-col sm:flex-row items-center justify-between gap-3">
          {onOpenPrivacyPolicy ? (
            <button
              type="button"
              onClick={onOpenPrivacyPolicy}
              className="text-xs font-semibold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer order-2 sm:order-1"
            >
              <FileText className="w-3.5 h-3.5" />
              <span>प्राइवेसी पॉलिसी पढ़ें</span>
            </button>
          ) : (
            <div className="text-[11px] text-slate-400 order-2 sm:order-1">
              Compliant with India DPDP Act 2023
            </div>
          )}

          <button
            type="button"
            onClick={handleAccept}
            className="w-full sm:w-auto flex items-center justify-center gap-2 px-6 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs sm:text-sm font-bold shadow-lg shadow-emerald-600/30 transition-all cursor-pointer order-1 sm:order-2"
          >
            <Check className="w-4 h-4 stroke-[3]" />
            <span>हाँ, मैं सहमत हूँ (Accept & Continue)</span>
          </button>
        </div>
      </div>
    </div>
  );
};
