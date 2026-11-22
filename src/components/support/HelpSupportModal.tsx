import React, { useState, useEffect, useCallback } from 'react';
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
  Copy,
  Check,
  RefreshCw,
  Clock,
  ShieldAlert,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { supportApi, UserConsentRecord } from '../../lib/supportApi';
import { formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';
import {
  SUPPORT_CONTACT,
  buildWhatsAppSupportUrl,
  buildMailToUrl,
} from '../../config/contact';

interface HelpSupportModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialTab?: 'help' | 'feedback' | 'complaint' | 'dpdp';
}

const STAR_LABELS: Record<number, string> = {
  1: '👎 Poor',
  2: '😐 Needs Improvement',
  3: '👌 Good',
  4: '👍 Very Good',
  5: '🌟 Excellent',
};

export const HelpSupportModal: React.FC<HelpSupportModalProps> = ({
  isOpen,
  onClose,
  initialTab = 'help',
}) => {
  const { user } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'help' | 'feedback' | 'complaint' | 'dpdp'>(initialTab);

  // Form Fields - Feedback (Cleaned: stars default to null/0, category & subject removed)
  const [feedbackRating, setFeedbackRating] = useState<number | null>(null);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [feedbackDpdpConsent, setFeedbackDpdpConsent] = useState<boolean>(false);

  // Form Fields - Complaint (Cleaned: urgency & category removed)
  const [complaintSubject, setComplaintSubject] = useState<string>('');
  const [complaintMessage, setComplaintMessage] = useState<string>('');
  const [complaintPhone, setComplaintPhone] = useState<string>('');

  // Copy-to-clipboard state
  const [copiedPhone, setCopiedPhone] = useState<boolean>(false);
  const [copiedEmail, setCopiedEmail] = useState<boolean>(false);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submittedFeedbackId, setSubmittedFeedbackId] = useState<string | null>(null);
  const [submittedComplaintTicket, setSubmittedComplaintTicket] = useState<string | null>(null);

  // Privacy & Consent State (Verified real database records)
  const [consentStatus, setConsentStatus] = useState<'granted' | 'withdrawn' | 'not_granted'>('not_granted');
  const [consentLatest, setConsentLatest] = useState<UserConsentRecord | null>(null);
  const [consentHistory, setConsentHistory] = useState<UserConsentRecord[]>([]);
  const [isLoadingConsent, setIsLoadingConsent] = useState<boolean>(false);
  const [isUpdatingConsent, setIsUpdatingConsent] = useState<boolean>(false);
  const [showWithdrawConfirm, setShowWithdrawConfirm] = useState<boolean>(false);

  // Fetch verified consent records from backend
  const loadConsentData = useCallback(async () => {
    if (!user) return;
    try {
      setIsLoadingConsent(true);
      const res = await supportApi.getConsentStatus();
      if (res.success) {
        setConsentStatus(res.status);
        setConsentLatest(res.latest);
        setConsentHistory(res.history || []);
      }
    } catch (err: any) {
      console.warn('Could not load privacy consent records:', err.message);
    } finally {
      setIsLoadingConsent(false);
    }
  }, [user]);

  useEffect(() => {
    if (isOpen && activeTab === 'dpdp') {
      loadConsentData();
    }
  }, [isOpen, activeTab, loadConsentData]);

  if (!isOpen) return null;

  // Copy handlers
  const handleCopyPhone = () => {
    navigator.clipboard.writeText(SUPPORT_CONTACT.phone);
    setCopiedPhone(true);
    toast.success('Copied to Clipboard', `Support phone number ${SUPPORT_CONTACT.displayPhone} copied.`);
    setTimeout(() => setCopiedPhone(false), 2500);
  };

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(SUPPORT_CONTACT.email);
    setCopiedEmail(true);
    toast.success('Copied to Clipboard', `Support email ${SUPPORT_CONTACT.email} copied.`);
    setTimeout(() => setCopiedEmail(false), 2500);
  };

  // Submit Feedback
  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!feedbackMessage.trim()) {
      toast.error('Validation Error', 'Please enter your feedback message.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await supportApi.submitFeedback({
        rating: feedbackRating || null,
        message: feedbackMessage.trim(),
        dpdp_consent: feedbackDpdpConsent,
      });

      const fbId = res.feedback_id || (res.feedback?.id ? `#FB-${res.feedback.id.slice(0, 8).toUpperCase()}` : '#FB-ACK');
      setSubmittedFeedbackId(fbId);
      toast.success('Feedback Submitted', `Your feedback (${fbId}) has been received. Thank you!`);
      setFeedbackMessage('');
      setFeedbackRating(null);
      setFeedbackDpdpConsent(false);

      // Refresh consent data if user granted consent
      if (feedbackDpdpConsent) {
        loadConsentData();
      }
    } catch (err: any) {
      toast.error('Submission Failed', err.message || 'Could not submit feedback.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Submit Complaint
  const handleComplaintSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    if (!complaintSubject.trim() || complaintSubject.trim().length < 3) {
      toast.error('Validation Error', 'Please enter a complaint subject (min 3 characters).');
      return;
    }
    if (!complaintMessage.trim() || complaintMessage.trim().length < 5) {
      toast.error('Validation Error', 'Please provide a detailed description (min 5 characters).');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await supportApi.raiseComplaint({
        subject: complaintSubject.trim(),
        description: complaintMessage.trim(),
        phone: complaintPhone.trim() || undefined,
      });

      const ticketNum = res.ticket_number || res.ticket?.ticket_number || '#CMP-ACK';
      setSubmittedComplaintTicket(ticketNum);
      toast.success('Complaint Registered', `Complaint ${ticketNum} created. Our support team will follow up.`);
      setComplaintSubject('');
      setComplaintMessage('');
      setComplaintPhone('');
    } catch (err: any) {
      toast.error('Submission Failed', err.message || 'Could not submit complaint.');
    } finally {
      setIsSubmitting(false);
    }
  };

  // Grant Optional Consent
  const handleGrantConsent = async () => {
    try {
      setIsUpdatingConsent(true);
      const res = await supportApi.grantConsent(
        'optional_feedback_support',
        'User explicitly granted optional processing consent for service quality feedback and support inquiries under the DPDP Act 2023.'
      );
      if (res.success) {
        toast.success('Consent Granted', 'Your optional processing consent has been recorded.');
        await loadConsentData();
      }
    } catch (err: any) {
      toast.error('Consent Update Failed', err.message || 'Could not record consent.');
    } finally {
      setIsUpdatingConsent(false);
    }
  };

  // Withdraw Optional Consent
  const handleWithdrawConsent = async () => {
    try {
      setIsUpdatingConsent(true);
      setShowWithdrawConfirm(false);
      const res = await supportApi.withdrawConsent(
        'optional_feedback_support',
        'User explicitly withdrew optional processing consent. All optional data processing ceased. Core app functionality and account remain active.'
      );
      if (res.success) {
        toast.success('Consent Withdrawn', 'Your optional processing consent has been withdrawn. Core services remain active.');
        await loadConsentData();
      }
    } catch (err: any) {
      toast.error('Withdrawal Failed', err.message || 'Could not withdraw consent.');
    } finally {
      setIsUpdatingConsent(false);
    }
  };

  const currentDisplayRating = hoverRating !== null ? hoverRating : feedbackRating;

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
                Help, Feedback & Support
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Official Support Desk by <span className="font-bold text-emerald-600">{SUPPORT_CONTACT.companyName}</span>
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

        {/* Official Contact Quick Card */}
        <div className="p-4 sm:p-5 bg-gradient-to-r from-emerald-600/10 via-teal-600/10 to-emerald-600/10 border-b border-slate-100 dark:border-slate-800">
          <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-xs text-slate-900 dark:text-slate-100">
                  Direct Support Helpline
                </span>
                <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-500 text-white">
                  Official
                </span>
              </div>
              <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600 dark:text-slate-300">
                {/* Phone */}
                <span className="inline-flex items-center gap-1">
                  <Phone className="w-3.5 h-3.5 text-emerald-600" />
                  <a
                    href={SUPPORT_CONTACT.telUrl}
                    className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                    title="Call support helpline"
                  >
                    {SUPPORT_CONTACT.displayPhone}
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyPhone}
                    className="p-1 hover:text-emerald-600 transition-colors text-slate-400 cursor-pointer"
                    title="Copy phone number"
                  >
                    {copiedPhone ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  </button>
                </span>

                <span className="text-slate-300 dark:text-slate-700 hidden sm:inline">•</span>

                {/* Email */}
                <span className="inline-flex items-center gap-1">
                  <Mail className="w-3.5 h-3.5 text-emerald-600" />
                  <a
                    href={SUPPORT_CONTACT.mailToUrl}
                    className="font-bold text-emerald-600 dark:text-emerald-400 hover:underline"
                    title="Send email to support"
                  >
                    {SUPPORT_CONTACT.email}
                  </a>
                  <button
                    type="button"
                    onClick={handleCopyEmail}
                    className="p-1 hover:text-emerald-600 transition-colors text-slate-400 cursor-pointer"
                    title="Copy email address"
                  >
                    {copiedEmail ? <Check className="w-3 h-3 text-emerald-600" /> : <Copy className="w-3 h-3" />}
                  </button>
                </span>
              </div>
            </div>

            {/* WhatsApp Direct Action Button */}
            <a
              href={SUPPORT_CONTACT.whatsappUrl}
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
            onClick={() => setActiveTab('help')}
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
            onClick={() => setActiveTab('feedback')}
            className={`flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'feedback'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Feedback</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('complaint')}
            className={`flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'complaint'
                ? 'bg-white dark:bg-slate-900 text-rose-600 dark:text-rose-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <AlertOctagon className="w-3.5 h-3.5" />
            <span>Complaint</span>
          </button>

          <button
            type="button"
            onClick={() => setActiveTab('dpdp')}
            className={`flex-1 py-2 px-3 rounded-xl transition-all cursor-pointer flex items-center justify-center gap-1.5 ${
              activeTab === 'dpdp'
                ? 'bg-white dark:bg-slate-900 text-blue-600 dark:text-blue-400 shadow-sm'
                : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-100'
            }`}
          >
            <ShieldCheck className="w-3.5 h-3.5" />
            <span>Privacy & DPDP</span>
          </button>
        </div>

        {/* Tab Contents */}
        <div className="p-6 max-h-[60vh] overflow-y-auto space-y-4">
          {/* TAB 1: HELP & INFO */}
          {activeTab === 'help' && (
            <div className="space-y-4 text-xs">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-3">
                <h4 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
                  <Sparkles className="w-4 h-4 text-emerald-500" />
                  <span>About My Money Manager</span>
                </h4>
                <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
                  A comprehensive personal finance, room expense, dining, and peer-to-peer ledger application engineered and maintained by <b>{SUPPORT_CONTACT.companyName}</b>.
                </p>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 pt-2">
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                    <p className="font-bold text-slate-800 dark:text-slate-200">📱 Multi-Device Synchronization</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Log in securely from any device (laptop, phone, tablet) and access your financial data in real time.
                    </p>
                  </div>
                  <div className="p-3 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800">
                    <p className="font-bold text-slate-800 dark:text-slate-200">🤝 Udhar Settle & Clear</p>
                    <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                      Track who owes you and whom you owe with 1-click settlements and transparent history.
                    </p>
                  </div>
                </div>
              </div>

              {/* Direct Support Callout */}
              <div className="p-4 rounded-2xl bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-between gap-3">
                <div>
                  <p className="font-bold text-emerald-900 dark:text-emerald-200">
                    Need Immediate Assistance?
                  </p>
                  <p className="text-[11px] text-emerald-700 dark:text-emerald-300">
                    Reach our official support desk via WhatsApp or phone call at {SUPPORT_CONTACT.displayPhone}.
                  </p>
                </div>
                <a
                  href={SUPPORT_CONTACT.whatsappUrl}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl text-xs font-bold shrink-0 shadow-sm flex items-center gap-1"
                >
                  <span>WhatsApp</span>
                  <span>&rarr;</span>
                </a>
              </div>
            </div>
          )}

          {/* TAB 2: CLEAN FEEDBACK FORM */}
          {activeTab === 'feedback' && (
            <div className="space-y-4">
              {submittedFeedbackId && (
                <div className="p-4 rounded-2xl bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-200 text-xs flex items-start gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-emerald-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Feedback Submitted Successfully</p>
                    <p className="text-[11px] text-emerald-700 dark:text-emerald-300 mt-1">
                      Your feedback reference ID is <strong className="font-mono">{submittedFeedbackId}</strong>. Thank you for helping us improve My Money Manager!
                    </p>
                  </div>
                </div>
              )}

              <form onSubmit={handleFeedbackSubmit} className="space-y-4">
                {/* 1. Experience Rating (Stars unselected by default, label only shows after selection) */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                    How would you rate your experience? (Optional)
                  </label>
                  <div className="flex items-center gap-2">
                    <div className="flex items-center">
                      {[1, 2, 3, 4, 5].map((star) => {
                        const isFilled = currentDisplayRating !== null && star <= currentDisplayRating;
                        return (
                          <button
                            key={star}
                            type="button"
                            onClick={() => setFeedbackRating(star)}
                            onMouseEnter={() => setHoverRating(star)}
                            onMouseLeave={() => setHoverRating(null)}
                            className="p-1 text-amber-400 hover:scale-110 transition-transform cursor-pointer focus:outline-none"
                            aria-label={`Rate ${star} out of 5 stars`}
                          >
                            <Star
                              className={`w-6 h-6 transition-colors ${
                                isFilled
                                  ? 'fill-amber-400 text-amber-400'
                                  : 'text-slate-300 dark:text-slate-600 hover:text-amber-300'
                              }`}
                            />
                          </button>
                        );
                      })}
                    </div>

                    <span className="text-xs font-bold text-slate-600 dark:text-slate-300 ml-2">
                      {feedbackRating ? (
                        STAR_LABELS[feedbackRating]
                      ) : (
                        <span className="text-slate-400 font-normal text-[11px]">Click a star to rate (optional)</span>
                      )}
                    </span>
                  </div>
                </div>

                {/* 2. Feedback / Suggestions Textarea */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Your Feedback / Suggestions *
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={feedbackMessage}
                    onChange={(e) => setFeedbackMessage(e.target.value)}
                    placeholder="Share your thoughts, suggestions, or experience with My Money Manager..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                </div>

                {/* 3. Optional DPDP Consent Checkbox (Defaults to unchecked) */}
                <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 flex items-start gap-2.5">
                  <input
                    type="checkbox"
                    id="dpdp-feedback-consent"
                    checked={feedbackDpdpConsent}
                    onChange={(e) => setFeedbackDpdpConsent(e.target.checked)}
                    className="mt-0.5 rounded text-emerald-600 focus:ring-emerald-500 cursor-pointer"
                  />
                  <label htmlFor="dpdp-feedback-consent" className="text-[11px] text-slate-600 dark:text-slate-300 cursor-pointer leading-relaxed">
                    <b>Optional Consent:</b> I voluntarily consent to <b>{SUPPORT_CONTACT.companyName}</b> processing my feedback and contact information for service quality improvement and support inquiries under the DPDP Act 2023. You may withdraw this consent at any time.
                  </label>
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <a
                    href={buildWhatsAppSupportUrl(
                      `[Feedback for ${SUPPORT_CONTACT.companyName}]\nRating: ${feedbackRating ? `${feedbackRating}/5` : 'Not specified'}\nMessage: ${feedbackMessage}`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 font-bold"
                  >
                    <span>Send via WhatsApp as well</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  <button
                    type="submit"
                    disabled={isSubmitting || !feedbackMessage.trim()}
                    className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSubmitting ? 'Submitting...' : 'Submit Feedback'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 3: SIMPLIFIED COMPLAINT FORM */}
          {activeTab === 'complaint' && (
            <div className="space-y-4">
              {submittedComplaintTicket && (
                <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 text-rose-800 dark:text-rose-200 text-xs flex items-start gap-2.5">
                  <CheckCircle2 className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                  <div>
                    <p className="font-bold">Complaint Registered Successfully</p>
                    <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-1">
                      Your complaint ticket number is <strong className="font-mono">{submittedComplaintTicket}</strong>. Our support team will investigate and follow up on your account.
                    </p>
                  </div>
                </div>
              )}

              <form onSubmit={handleComplaintSubmit} className="space-y-4">
                <div className="p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-xs text-rose-800 dark:text-rose-200">
                  <p className="font-bold flex items-center gap-1.5">
                    <AlertOctagon className="w-4 h-4 text-rose-600 shrink-0" />
                    <span>Grievance Redressal</span>
                  </p>
                  <p className="text-[11px] mt-0.5 opacity-90">
                    Your complaint is linked securely to your authenticated account and will be reviewed with high priority.
                  </p>
                </div>

                {/* 1. Complaint Subject */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Complaint Subject *
                  </label>
                  <input
                    type="text"
                    required
                    value={complaintSubject}
                    onChange={(e) => setComplaintSubject(e.target.value)}
                    placeholder="e.g., 'Discrepancy in Udhar calculation or sync delay'"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                {/* 2. Detailed Description */}
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Detailed Description *
                  </label>
                  <textarea
                    rows={4}
                    required
                    value={complaintMessage}
                    onChange={(e) => setComplaintMessage(e.target.value)}
                    placeholder="Please describe what happened step-by-step, including error messages or unexpected behavior..."
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
                  />
                </div>

                <div className="flex items-center justify-between gap-3 pt-2">
                  <a
                    href={buildWhatsAppSupportUrl(
                      `[COMPLAINT]\nSubject: ${complaintSubject}\nDetails: ${complaintMessage}`
                    )}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-xs text-rose-600 dark:text-rose-400 hover:underline flex items-center gap-1 font-bold"
                  >
                    <span>Submit via WhatsApp as well</span>
                    <ExternalLink className="w-3 h-3" />
                  </a>

                  <button
                    type="submit"
                    disabled={isSubmitting || !complaintSubject.trim() || !complaintMessage.trim()}
                    className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                  >
                    <AlertOctagon className="w-3.5 h-3.5" />
                    <span>{isSubmitting ? 'Registering...' : 'Register Complaint'}</span>
                  </button>
                </div>
              </form>
            </div>
          )}

          {/* TAB 4: VERIFIED PRIVACY & DPDP CONSENT (NO FALSE CONSENT, REAL RECORDS) */}
          {activeTab === 'dpdp' && (
            <div className="space-y-4 text-xs">
              {/* Statutory Framework Card */}
              <div className="p-4 rounded-2xl bg-blue-50 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900 space-y-2">
                <div className="flex items-center gap-2">
                  <ShieldCheck className="w-5 h-5 text-blue-600 shrink-0" />
                  <h4 className="font-bold text-blue-950 dark:text-blue-100 text-sm">
                    Digital Personal Data Protection Act (DPDP Act, 2023)
                  </h4>
                </div>
                <p className="text-blue-900 dark:text-blue-200 leading-relaxed text-[11px]">
                  My Money Manager implements statutory data protection safeguards under India's Digital Personal Data Protection Act, 2023. Optional data processing is never assumed or pre-granted without your explicit voluntary consent.
                </p>
              </div>

              {/* Verified Consent Status Card */}
              <div className="p-4 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
                <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 dark:border-slate-700/60 pb-3">
                  <div>
                    <span className="text-[10px] uppercase font-bold tracking-wider text-slate-400">
                      Verified Data Processing Consent Standing
                    </span>
                    <h5 className="text-sm font-bold text-slate-900 dark:text-slate-100 mt-0.5">
                      Optional Feedback & Service Analytics
                    </h5>
                  </div>

                  {/* Dynamic Status Badge */}
                  <div>
                    {isLoadingConsent ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                        <RefreshCw className="w-3 h-3 animate-spin" />
                        <span>Verifying...</span>
                      </span>
                    ) : consentStatus === 'granted' ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-emerald-100 dark:bg-emerald-950/80 text-emerald-700 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800">
                        <CheckCircle2 className="w-3.5 h-3.5 text-emerald-600" />
                        <span>Consent Granted</span>
                      </span>
                    ) : consentStatus === 'withdrawn' ? (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-rose-100 dark:bg-rose-950/80 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800">
                        <AlertTriangle className="w-3.5 h-3.5 text-rose-600" />
                        <span>Consent Withdrawn</span>
                      </span>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-bold bg-slate-200 dark:bg-slate-700/80 text-slate-700 dark:text-slate-300 border border-slate-300 dark:border-slate-600">
                        <span>Consent Not Granted</span>
                      </span>
                    )}
                  </div>
                </div>

                {/* Consent Metadata */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5 text-[11px] text-slate-600 dark:text-slate-300 pt-1">
                  <div>
                    <span className="font-semibold text-slate-500">Processing Purpose:</span>
                    <p className="font-medium text-slate-800 dark:text-slate-200">
                      User feedback analysis, product improvement, voluntary support follow-up.
                    </p>
                  </div>
                  <div>
                    <span className="font-semibold text-slate-500">Applicable Policy Version:</span>
                    <p className="font-medium text-slate-800 dark:text-slate-200 font-mono">
                      {consentLatest?.policy_version || 'v1.2 - DPDP Act 2023'}
                    </p>
                  </div>
                  {consentLatest?.created_at && (
                    <div className="sm:col-span-2">
                      <span className="font-semibold text-slate-500">Last Recorded Action:</span>
                      <p className="font-medium text-slate-800 dark:text-slate-200">
                        {consentLatest.action === 'granted' ? 'Granted on ' : 'Withdrawn on '}
                        {formatDisplayDate(consentLatest.created_at)} at {formatDisplayTime(consentLatest.created_at)}
                      </p>
                    </div>
                  )}
                </div>

                {/* Action Area */}
                <div className="pt-2 border-t border-slate-200/60 dark:border-slate-700/60 flex flex-wrap items-center justify-between gap-2">
                  <p className="text-[11px] text-slate-500">
                    Core account operations and financial records do not depend on optional consent.
                  </p>

                  {consentStatus === 'granted' ? (
                    <button
                      type="button"
                      disabled={isUpdatingConsent}
                      onClick={() => setShowWithdrawConfirm(true)}
                      className="px-3.5 py-1.5 bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 dark:hover:bg-rose-900/40 text-rose-700 dark:text-rose-300 border border-rose-300 dark:border-rose-800 rounded-xl font-bold text-xs transition-colors cursor-pointer"
                    >
                      Withdraw Consent
                    </button>
                  ) : (
                    <button
                      type="button"
                      disabled={isUpdatingConsent}
                      onClick={handleGrantConsent}
                      className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white rounded-xl font-bold text-xs transition-colors cursor-pointer shadow-sm"
                    >
                      {consentStatus === 'withdrawn' ? 'Re-grant Optional Consent' : 'Grant Optional Consent'}
                    </button>
                  )}
                </div>

                {/* Confirmation Dialog for Consent Withdrawal */}
                {showWithdrawConfirm && (
                  <div className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 space-y-3 animate-fade-in">
                    <div className="flex items-start gap-2.5">
                      <ShieldAlert className="w-5 h-5 text-rose-600 shrink-0 mt-0.5" />
                      <div>
                        <h6 className="font-bold text-rose-950 dark:text-rose-100 text-xs">
                          Confirm Consent Withdrawal
                        </h6>
                        <p className="text-[11px] text-rose-800 dark:text-rose-200 mt-1 leading-relaxed">
                          Are you sure you want to withdraw your optional data processing consent? Future processing based on optional consent will stop immediately.
                        </p>
                        <p className="text-[11px] text-rose-700 dark:text-rose-300 mt-1 font-semibold">
                          Note: Your user account, transactions, and core app services will remain completely unaffected and preserved.
                        </p>
                      </div>
                    </div>

                    <div className="flex justify-end gap-2 pt-1">
                      <button
                        type="button"
                        onClick={() => setShowWithdrawConfirm(false)}
                        className="px-3 py-1 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-300 rounded-lg text-xs font-semibold cursor-pointer"
                      >
                        Cancel
                      </button>
                      <button
                        type="button"
                        onClick={handleWithdrawConsent}
                        disabled={isUpdatingConsent}
                        className="px-3 py-1 bg-rose-600 hover:bg-rose-700 text-white rounded-lg text-xs font-bold cursor-pointer"
                      >
                        {isUpdatingConsent ? 'Processing...' : 'Confirm Withdrawal'}
                      </button>
                    </div>
                  </div>
                )}
              </div>

              {/* Statutory Privacy Rights List */}
              <div className="space-y-2">
                <h5 className="font-bold text-slate-800 dark:text-slate-200">
                  Your Statutory Rights under the DPDP Act, 2023:
                </h5>
                <ul className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-400 list-disc pl-5">
                  <li>
                    <b>Right to Access:</b> You have the right to obtain a summary of your personal data processed by the platform and export your financial transactions.
                  </li>
                  <li>
                    <b>Right to Correction &amp; Erasure:</b> You can correct outdated entries or soft-delete individual transactions to your Recycle Bin. Full account deletion with a 24-hour grace cancellation window is available in Settings.
                  </li>
                  <li>
                    <b>Right to Grievance Redressal:</b> You may register grievances directly through the Complaint tab or contact our Data Grievance Desk at{' '}
                    <a href={SUPPORT_CONTACT.telUrl} className="underline text-emerald-600 font-bold">{SUPPORT_CONTACT.displayPhone}</a> or{' '}
                    <a href={SUPPORT_CONTACT.mailToUrl} className="underline text-emerald-600 font-bold">{SUPPORT_CONTACT.email}</a>.
                  </li>
                  <li>
                    <b>Right to Withdraw Consent:</b> You may freely withdraw optional consent at any time using the control above without affecting core app functionality.
                  </li>
                </ul>
              </div>

              {/* Historical Consent Audit Trail */}
              {consentHistory.length > 0 && (
                <div className="space-y-2 pt-2 border-t border-slate-200 dark:border-slate-800">
                  <h5 className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                    Consent Audit Trail (Historical Log)
                  </h5>
                  <div className="space-y-1.5 max-h-32 overflow-y-auto">
                    {consentHistory.map((item) => (
                      <div
                        key={item.id}
                        className="p-2.5 bg-slate-50 dark:bg-slate-800/40 rounded-xl border border-slate-200/60 dark:border-slate-700/60 flex items-center justify-between text-[11px]"
                      >
                        <div className="flex items-center gap-2">
                          <span
                            className={`w-2 h-2 rounded-full shrink-0 ${
                              item.action === 'granted' ? 'bg-emerald-500' : 'bg-rose-500'
                            }`}
                          />
                          <span className="font-semibold text-slate-800 dark:text-slate-200">
                            {item.action === 'granted' ? 'Consent Granted' : 'Consent Withdrawn'}
                          </span>
                          <span className="text-slate-400 font-mono text-[10px]">
                            ({item.policy_version})
                          </span>
                        </div>
                        <span className="text-slate-500 text-[10px]">
                          {formatDisplayDate(item.created_at)} {formatDisplayTime(item.created_at)}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
