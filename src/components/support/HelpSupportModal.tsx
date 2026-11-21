import React, { useState } from 'react';
import {
  X,
  Phone,
  Mail,
  MessageSquare,
  AlertOctagon,
  ShieldCheck,
  Send,
  Star,
  ExternalLink,
  CheckCircle2,
  AlertTriangle,
  HelpCircle,
  Sparkles,
  Smartphone,
  Lock,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { submitFeedbackToSupabase } from '../../lib/supabase';
import { FeedbackType, FeedbackUrgency } from '../../types';

interface HelpSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'help' | 'feedback' | 'complaint' | 'dpdp';
}

const SUPPORT_PHONE = '74149345405';
const SUPPORT_EMAIL = 'hackifypro@gmail.com';
const DEVELOPER_NAME = 'HackifyPro';

export const HelpSupportModal: React.FC<HelpSupportModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'help',
}) => {
  const { user } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'help' | 'feedback' | 'complaint' | 'dpdp'>(initialTab);

  // Form Fields - Feedback
  const [feedbackRating, setFeedbackRating] = useState<number>(5);
  const [feedbackCategory, setFeedbackCategory] = useState<string>('Feature Request');
  const [feedbackSubject, setFeedbackSubject] = useState<string>('');
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [feedbackDpdpConsent, setFeedbackDpdpConsent] = useState<boolean>(true);

  // Form Fields - Complaint
  const [complaintUrgency, setComplaintUrgency] = useState<FeedbackUrgency>('normal');
  const [complaintCategory, setComplaintCategory] = useState<string>('Data Sync Issue');
  const [complaintSubject, setComplaintSubject] = useState<string>('');
  const [complaintMessage, setComplaintMessage] = useState<string>('');
  const [complaintPhone, setComplaintPhone] = useState<string>('');
  const [complaintDpdpConsent, setComplaintDpdpConsent] = useState<boolean>(true);

  // State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submittedSuccess, setSubmittedSuccess] = useState<string | null>(null);

  if (!isOpen) return null;

  // WhatsApp Link Helper
  const getWhatsAppUrl = (customText: string) => {
    return `https://wa.me/91${SUPPORT_PHONE}?text=${encodeURIComponent(customText)}`;
  };

  // Submit Feedback
  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!feedbackSubject.trim() || !feedbackMessage.trim()) {
      toast.error('Validation Error', 'Please enter subject and message.');
      return;
    }
    if (!feedbackDpdpConsent) {
      toast.warning('DPDP Consent Required', 'Please accept the DPDP data processing consent checkbox.');
      return;
    }

    try {
      setIsSubmitting(true);
      await submitFeedbackToSupabase({
        user_id: user?.uid,
        user_name: user?.displayName || 'User',
        user_email: user?.email || 'user@mymoney.com',
        type: 'feedback',
        category: feedbackCategory,
        subject: feedbackSubject.trim(),
        message: feedbackMessage.trim(),
        rating: feedbackRating,
        dpdp_consent: feedbackDpdpConsent,
        dpdp_consent_at: new Date().toISOString(),
        status: 'pending',
      });

      setSubmittedSuccess('आपका फीडबैक सफलतापूर्वक दर्ज कर लिया गया है! धन्यवाद।');
      toast.success('Feedback Submitted', 'Thank you for your valuable feedback!');
      setFeedbackSubject('');
      setFeedbackMessage('');
    } catch (err: any) {
      toast.error('Submission Failed', err.message || 'Could not submit feedback.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Complaint
  const handleComplaintSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintSubject.trim() || !complaintMessage.trim()) {
      toast.error('Validation Error', 'Please describe the problem and subject.');
      return;
    }
    if (!complaintDpdpConsent) {
      toast.warning('DPDP Consent Required', 'Please accept the DPDP data processing consent checkbox.');
      return;
    }

    try {
      setIsSubmitting(true);
      await submitFeedbackToSupabase({
        user_id: user?.uid,
        user_name: user?.displayName || 'User',
        user_email: user?.email || 'user@mymoney.com',
        user_phone: complaintPhone.trim() || undefined,
        type: 'complaint',
        category: complaintCategory,
        subject: complaintSubject.trim(),
        message: complaintMessage.trim(),
        urgency: complaintUrgency,
        dpdp_consent: complaintDpdpConsent,
        dpdp_consent_at: new Date().toISOString(),
        status: 'pending',
      });

      setSubmittedSuccess('आपकी शिकायत दर्ज कर ली गई है। हमारी टीम जल्द से जल्द इसका निवारण करेगी।');
      toast.success('Complaint Registered', 'Ticket created. Developer will review immediately.');
      setComplaintSubject('');
      setComplaintMessage('');
    } catch (err: any) {
      toast.error('Submission Failed', err.message || 'Could not submit complaint.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in overflow-y-auto">
      <div className="relative w-full max-w-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-auto">
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-800/40">
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-600 dark:text-emerald-400">
              <HelpCircle className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-base font-extrabold text-slate-900 dark:text-slate-100">
                Help, Feedback & Complaints
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Created & Supported by <span className="font-bold text-emerald-600">{DEVELOPER_NAME}</span>
              </p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
            aria-label="Close"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Developer Contact Quick Card */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-600/10 via-teal-600/10 to-emerald-600/10 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100">
                  Developer & Support Helpline
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500 text-white">
                  Direct Support
                </span>
              </div>
              <p className="text-xs text-slate-600 dark:text-slate-300 mt-1">
                फोन / WhatsApp: <a href={`tel:+91${SUPPORT_PHONE}`} className="font-bold text-emerald-600 underline">+91 {SUPPORT_PHONE}</a> • Email: <a href={`mailto:${SUPPORT_EMAIL}`} className="font-bold text-emerald-600 underline">{SUPPORT_EMAIL}</a>
              </p>
            </div>

            <a
              href={getWhatsAppUrl(`Hello ${DEVELOPER_NAME}, I need help with My Money Manager app.`)}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20 active:scale-95 transition-all cursor-pointer whitespace-nowrap"
            >
              <Smartphone className="w-4 h-4" />
              <span>Chat on WhatsApp</span>
              <ExternalLink className="w-3 h-3 opacity-80" />
            </a>
          </div>
        </div>

        {/* Tab Switcher */}
        <div className="flex p-2 gap-1 border-b border-slate-100 dark:border-slate-800 bg-slate-100/60 dark:bg-slate-800/40 text-xs font-bold">
          <button
            type="button"
            onClick={() => {
              setActiveTab('help');
              setSubmittedSuccess(null);
            }}
            className={`flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'help'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <HelpCircle className="w-3.5 h-3.5" />
            <span>Help & Info</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('feedback');
              setSubmittedSuccess(null);
            }}
            className={`flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'feedback'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Feedback (फीडबैक)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('complaint');
              setSubmittedSuccess(null);
            }}
            className={`flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'complaint'
                ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>Complaint (शिकायत)</span>
          </button>

          <button
            type="button"
            onClick={() => {
              setActiveTab('dpdp');
              setSubmittedSuccess(null);
            }}
            className={`flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'dpdp'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>DPDP Privacy</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
          {submittedSuccess && (
            <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-start gap-2.5">
              <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
              <div>
                <p className="font-bold">{submittedSuccess}</p>
                <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1">
                  अगर आप तुरंत डेवलपर से संपर्क करना चाहते हैं तो ऊपर दिए गए 'Chat on WhatsApp' बटन का उपयोग करें।
                </p>
              </div>
            </div>
          )}

          {/* TAB 1: HELP & INFO */}
          {activeTab === 'help' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  <span>About My Money Manager</span>
                </h4>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  यह एक संपूर्ण पर्सनल फाइनेंस, रूम खर्च, फूड व डाइनिंग, और उधार (People Ledger) प्रबंधन ऐप है जिसे <b>HackifyPro</b> द्वारा विकसित किया गया है।
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                    <p className="font-bold text-slate-800 dark:text-slate-200">📱 Multi-Device Sync</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      लैपटॉप या मोबाइल में लॉगिन करें, दोनों जगह एक जैसा रियल-टाइम डेटा दिखेगा।
                    </p>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                    <p className="font-bold text-slate-800 dark:text-slate-200">🤝 Udhar Settle & Clear</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      हिसाब पूरा होने पर 1-क्लिक में हिसाब क्लियर या सेटल करें।
                    </p>
                  </div>
                </div>
              </div>

              {/* Direct WhatsApp Callout */}
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-emerald-900 dark:text-emerald-200">
                    डेवलपर से सीधा संपर्क करें
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                    कोई भी परेशानी आने पर 74149345405 पर WhatsApp मैसेज भेजें।
                  </p>
                </div>
                <a
                  href={getWhatsAppUrl(`Hello ${DEVELOPER_NAME}, I need assistance with My Money App.`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shrink-0 shadow-sm"
                >
                  WhatsApp &rarr;
                </a>
              </div>
            </div>
          )}

          {/* TAB 2: FEEDBACK FORM */}
          {activeTab === 'feedback' && (
            <form onSubmit={handleFeedbackSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  1. आपका अनुभव कैसा रहा? (Rating)
                </label>
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((star) => (
                    <button
                      key={star}
                      type="button"
                      onClick={() => setFeedbackRating(star)}
                      className="p-1 text-amber-400 hover:scale-110 transition-transform cursor-pointer"
                    >
                      <Star
                        className={`w-6 h-6 ${
                          star <= feedbackRating ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-600'
                        }`}
                      />
                    </button>
                  ))}
                  <span className="text-xs font-bold text-slate-600 dark:text-slate-300 ml-2">
                    {feedbackRating === 5 && '🌟 Excellent! (बहुत बढ़िया)'}
                    {feedbackRating === 4 && '👍 Very Good (अच्छा)'}
                    {feedbackRating === 3 && '👌 Good (ठीक है)'}
                    {feedbackRating === 2 && '😐 Needs Improvement (सुधार चाहिए)'}
                    {feedbackRating === 1 && '👎 Poor (खराब)'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  2. फीडबैक प्रकार (Category)
                </label>
                <select
                  value={feedbackCategory}
                  onChange={(e) => setFeedbackCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                >
                  <option value="Feature Request">नया फीचर सुझाव (New Feature Request)</option>
                  <option value="UI Design">डिज़ाइन और लुक (UI / Visual Design)</option>
                  <option value="Performance">स्पीड और परफॉरमेंस (Speed / Performance)</option>
                  <option value="Appreciation">प्रशंसा (Appreciation / Love it)</option>
                  <option value="Other">अन्य (Other)</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  3. विषय (Subject) *
                </label>
                <input
                  type="text"
                  required
                  value={feedbackSubject}
                  onChange={(e) => setFeedbackSubject(e.target.value)}
                  placeholder="उदा. 'होम स्क्रीन पर नया चार्ट चाहिए'"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  4. आपका फीडबैक / सुझाव विस्तार से लिखें *
                </label>
                <textarea
                  rows={3}
                  required
                  value={feedbackMessage}
                  onChange={(e) => setFeedbackMessage(e.target.value)}
                  placeholder="अपने विचार यहाँ साझा करें..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                />
              </div>

              {/* DPDP Act Consent Checkbox */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="dpdp-feedback-consent"
                  checked={feedbackDpdpConsent}
                  onChange={(e) => setFeedbackDpdpConsent(e.target.checked)}
                  className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                />
                <label htmlFor="dpdp-feedback-consent" className="text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer leading-relaxed">
                  <b>DPDP Act 2023 Consent:</b> मैं अपने फीडबैक, नाम और ईमेल को ऐप सुधार और सेवा गुणवत्ता हेतु <b>HackifyPro</b> द्वारा प्रोसेस किए जाने की स्पष्ट सहमति देता हूँ।
                </label>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <a
                  href={getWhatsAppUrl(`[Feedback for ${DEVELOPER_NAME}]\nSubject: ${feedbackSubject || 'General Feedback'}\nRating: ${feedbackRating}/5\n${feedbackMessage}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 font-bold"
                >
                  <span>WhatsApp पर भी भेजें</span>
                  <ExternalLink className="w-3 h-3" />
                </a>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'भेज रहे हैं...' : 'फीडबैक सबमिट करें'}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 3: COMPLAINT FORM */}
          {activeTab === 'complaint' && (
            <form onSubmit={handleComplaintSubmit} className="space-y-4">
              <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200">
                <p className="font-bold flex items-center gap-1.5">
                  <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />
                  <span>शिकायत निवारण (Grievance Redressal)</span>
                </p>
                <p className="text-[11px] mt-0.5 opacity-90">
                  आपकी शिकायत सीधे एडमिन और डेवलपर तक पहुंचेगी और प्राथमिकता के आधार पर समाधान किया जाएगा।
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    1. समस्या की गंभीरता (Urgency)
                  </label>
                  <select
                    value={complaintUrgency}
                    onChange={(e) => setComplaintUrgency(e.target.value as FeedbackUrgency)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    <option value="normal">Normal (सामान्य)</option>
                    <option value="high">High (गंभीर)</option>
                    <option value="urgent">Urgent (अति आवश्यक - तुरंत हल करें)</option>
                    <option value="low">Low (साधारण)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    2. शिकायत प्रकार (Category)
                  </label>
                  <select
                    value={complaintCategory}
                    onChange={(e) => setComplaintCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    <option value="Data Sync Issue">डेटा सिंक समस्या (दूसरे डिवाइस में नहीं दिखा)</option>
                    <option value="Calculation Error">हिसाब या राशि में गड़बड़ी (Calculation Error)</option>
                    <option value="Bug / Crash">ऐप हैंग या एरर (Bug / Crash)</option>
                    <option value="Account / Login">लॉगिन या पासवर्ड समस्या (Account Issue)</option>
                    <option value="Privacy Concern">डेटा प्राइवेसी चिंता (Privacy Issue)</option>
                    <option value="Other">अन्य शिकायत (Other)</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  3. शिकायत का विषय (Subject) *
                </label>
                <input
                  type="text"
                  required
                  value={complaintSubject}
                  onChange={(e) => setComplaintSubject(e.target.value)}
                  placeholder="उदा. 'उधार क्लियर करने के बाद दूसरे मोबाइल में नहीं दिखा'"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  4. समस्या का पूरा विवरण लिखें *
                </label>
                <textarea
                  rows={3}
                  required
                  value={complaintMessage}
                  onChange={(e) => setComplaintMessage(e.target.value)}
                  placeholder="कदम-दर-कदम बताएं कि क्या समस्या आ रही है..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  5. आपका मोबाइल / WhatsApp नंबर (समाधान हेतु संपर्क के लिए)
                </label>
                <input
                  type="tel"
                  value={complaintPhone}
                  onChange={(e) => setComplaintPhone(e.target.value)}
                  placeholder="उदा. 74149345405"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                />
              </div>

              {/* DPDP Act Consent Checkbox */}
              <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5">
                <input
                  type="checkbox"
                  id="dpdp-complaint-consent"
                  checked={complaintDpdpConsent}
                  onChange={(e) => setComplaintDpdpConsent(e.target.checked)}
                  className="mt-0.5 rounded text-rose-600 focus:ring-rose-500 cursor-pointer"
                />
                <label htmlFor="dpdp-complaint-consent" className="text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer leading-relaxed">
                  <b>DPDP Act 2023 Consent:</b> मैं शिकायत के त्वरित समाधान हेतु <b>HackifyPro</b> को मेरा नाम, फोन, ईमेल और विवरण प्रोसेस करने तथा मुझसे संपर्क करने की सहमति देता हूँ।
                </label>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <a
                  href={getWhatsAppUrl(`[COMPLAINT URGENT - ${complaintUrgency.toUpperCase()}]\nCategory: ${complaintCategory}\nSubject: ${complaintSubject}\nDetails: ${complaintMessage}\nPhone: ${complaintPhone || 'N/A'}`)}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-xs text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 font-bold"
                >
                  <span>WhatsApp पर तुरंत शिकायत भेजें</span>
                  <ExternalLink className="w-3 h-3" />
                </a>

                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <AlertOctagon className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'दर्ज कर रहे हैं...' : 'शिकायत दर्ज करें'}</span>
                </button>
              </div>
            </form>
          )}

          {/* TAB 4: DPDP ACT PRIVACY STATUS */}
          {activeTab === 'dpdp' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 space-y-2.5">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-600" />
                  <h4 className="font-bold text-blue-950 dark:text-blue-100 text-sm">
                    डिजिटल व्यक्तिगत डेटा संरक्षण अधिनियम (DPDP Act, 2023)
                  </h4>
                </div>
                <p className="text-blue-900 dark:text-blue-200 leading-relaxed text-[11px]">
                  My Money Manager भारतीय डेटा सुरक्षा कानून (DPDP Act 2023) का पूर्ण अनुपालन करता है। आपकी वित्तीय गोपनीयता हमारा सर्वोच्च सिद्धांत है।
                </p>
              </div>

              <div className="space-y-2">
                <h5 className="font-bold text-slate-800 dark:text-slate-200">
                  आपके DPDP अधिकार (Your Statutory Rights):
                </h5>
                <ul className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-400 list-disc pl-5">
                  <li><b>डेटा एक्सेस का अधिकार (Right to Access):</b> आप अपने सभी खर्चों और विवरणों को कभी भी देख और एक्सपोर्ट कर सकते हैं।</li>
                  <li><b>डेटा सुधार का अधिकार (Right to Correction):</b> किसी भी लेन-देन को संपादित करने का पूर्ण नियंत्रण आपके हाथ में है।</li>
                  <li><b>डेटा डिलीट करने का अधिकार (Right to Erasure):</b> आप रीसायकल बिन के माध्यम से रिकॉर्ड्स स्थायी रूप से डिलीट कर सकते हैं।</li>
                  <li><b>शिकायत निवारण का अधिकार (Right to Grievance Redressal):</b> सीधे डेवलपर (<a href={`tel:+91${SUPPORT_PHONE}`} className="underline text-emerald-600 font-bold">+91 {SUPPORT_PHONE}</a> / <a href={`mailto:${SUPPORT_EMAIL}`} className="underline text-emerald-600 font-bold">{SUPPORT_EMAIL}</a>) से संपर्क करें।</li>
                </ul>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                    डेटा कलेक्शन सहमति (Consent Status)
                  </p>
                  <p className="text-[11px] text-emerald-600 font-semibold">
                    ✅ Active & Consented under DPDP Act 2023
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('my_money_dpdp_consent_v1');
                    toast.info('Consent Reset', 'डेटा सहमति रिसेट कर दी गई है।');
                    onClose();
                  }}
                  className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-300 cursor-pointer"
                >
                  सहमति बदलें (Reset)
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
