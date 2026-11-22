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
  Copy,
  Check,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { supportApi } from '../../lib/supportApi';
import { FeedbackUrgency } from '../../types';
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

  // Copy-to-clipboard state
  const [copiedPhone, setCopiedPhone] = useState<boolean>(false);
  const [copiedEmail, setCopiedEmail] = useState<boolean>(false);

  // Submission State
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submittedSuccess, setSubmittedSuccess] = useState<string | null>(null);

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
    if (!feedbackMessage.trim()) {
      toast.error('Validation Error', 'Please enter your feedback message.');
      return;
    }
    if (!feedbackDpdpConsent) {
      toast.warning('DPDP Consent Required', 'Please accept the DPDP data processing consent checkbox.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await supportApi.submitFeedback({
        rating: feedbackRating,
        category: feedbackCategory,
        subject: feedbackSubject.trim() || undefined,
        message: feedbackMessage.trim(),
      });

      setSubmittedSuccess(res.message || 'Your feedback has been successfully submitted. Thank you for helping us improve!');
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
      toast.error('Validation Error', 'Please describe the problem and enter a subject.');
      return;
    }
    if (!complaintDpdpConsent) {
      toast.warning('DPDP Consent Required', 'Please accept the DPDP data processing consent checkbox.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await supportApi.raiseComplaint({
        category: complaintCategory,
        subject: complaintSubject.trim(),
        description: complaintMessage.trim(),
      });

      const ticketNum = res.ticket?.ticket_number ? `#${res.ticket.ticket_number}` : '';
      setSubmittedSuccess(`Your complaint has been registered (${ticketNum}). Our support team will investigate and follow up promptly.`);
      toast.success('Complaint Registered', `Ticket ${ticketNum} created. Support will review immediately.`);
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
            <span>Feedback</span>
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
            <span>Complaint</span>
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
            <span>Privacy & DPDP</span>
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
                  If you need immediate live support, feel free to use the 'Chat on WhatsApp' button above or dial {SUPPORT_CONTACT.displayPhone}.
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

          {/* TAB 2: FEEDBACK FORM */}
          {activeTab === 'feedback' && (
            <form onSubmit={handleFeedbackSubmit} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  1. How would you rate your experience?
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
                    {feedbackRating === 5 && '🌟 Excellent'}
                    {feedbackRating === 4 && '👍 Very Good'}
                    {feedbackRating === 3 && '👌 Good'}
                    {feedbackRating === 2 && '😐 Needs Improvement'}
                    {feedbackRating === 1 && '👎 Poor'}
                  </span>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  2. Feedback Category
                </label>
                <select
                  value={feedbackCategory}
                  onChange={(e) => setFeedbackCategory(e.target.value)}
                  className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                >
                  <option value="Feature Request">New Feature Request</option>
                  <option value="UI Design">UI & Visual Design</option>
                  <option value="Performance">Speed & Performance</option>
                  <option value="Appreciation">Appreciation & Compliments</option>
                  <option value="Other">Other</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  3. Subject *
                </label>
                <input
                  type="text"
                  required
                  value={feedbackSubject}
                  onChange={(e) => setFeedbackSubject(e.target.value)}
                  placeholder="e.g., 'Request for new chart on home screen'"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  4. Your Feedback / Suggestions in Detail *
                </label>
                <textarea
                  rows={3}
                  required
                  value={feedbackMessage}
                  onChange={(e) => setFeedbackMessage(e.target.value)}
                  placeholder="Share your thoughts, ideas, or experiences here..."
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
                  <b>DPDP Act 2023 Consent:</b> I give explicit consent to <b>{SUPPORT_CONTACT.companyName}</b> to process my feedback, name, and email solely for application improvement and service quality purposes.
                </label>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <a
                  href={buildWhatsAppSupportUrl(
                    `[Feedback for ${SUPPORT_CONTACT.companyName}]\nSubject: ${feedbackSubject || 'General Feedback'}\nRating: ${feedbackRating}/5\n${feedbackMessage}`
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
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Submitting...' : 'Submit Feedback'}</span>
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
                  <span>Official Grievance Redressal</span>
                </p>
                <p className="text-[11px] mt-0.5 opacity-90">
                  Your complaint will be reviewed with high priority by our technical and administrative team.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    1. Problem Urgency
                  </label>
                  <select
                    value={complaintUrgency}
                    onChange={(e) => setComplaintUrgency(e.target.value as FeedbackUrgency)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    <option value="normal">Normal (Standard resolution)</option>
                    <option value="high">High (Priority investigation)</option>
                    <option value="urgent">Urgent (Critical - immediate action)</option>
                    <option value="low">Low (Minor inquiry)</option>
                  </select>
                </div>

                <div>
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                    2. Complaint Category
                  </label>
                  <select
                    value={complaintCategory}
                    onChange={(e) => setComplaintCategory(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                  >
                    <option value="Data Sync Issue">Data Sync Issue (Not showing on another device)</option>
                    <option value="Calculation Error">Calculation / Balance Discrepancy</option>
                    <option value="Bug / Crash">Application Crash or Technical Bug</option>
                    <option value="Account / Login">Login or Password Access Issue</option>
                    <option value="Privacy Concern">Data Privacy Concern</option>
                    <option value="Other">Other Grievance</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  3. Complaint Subject *
                </label>
                <input
                  type="text"
                  required
                  value={complaintSubject}
                  onChange={(e) => setComplaintSubject(e.target.value)}
                  placeholder="e.g., 'Udhar balance not updating after settlement'"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  4. Detailed Description of the Issue *
                </label>
                <textarea
                  rows={3}
                  required
                  value={complaintMessage}
                  onChange={(e) => setComplaintMessage(e.target.value)}
                  placeholder="Please describe what happened step-by-step, including unexpected behavior..."
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  5. Contact Phone / WhatsApp (For resolution follow-up)
                </label>
                <input
                  type="tel"
                  value={complaintPhone}
                  onChange={(e) => setComplaintPhone(e.target.value)}
                  placeholder="e.g., +91 74149 35405"
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
                  <b>DPDP Act 2023 Consent:</b> I give consent to <b>{SUPPORT_CONTACT.companyName}</b> to process my contact details (name, phone, email, issue details) to investigate and resolve this grievance.
                </label>
              </div>

              <div className="flex items-center justify-between gap-3 pt-2">
                <a
                  href={buildWhatsAppSupportUrl(
                    `[COMPLAINT - ${complaintUrgency.toUpperCase()}]\nCategory: ${complaintCategory}\nSubject: ${complaintSubject}\nDetails: ${complaintMessage}\nPhone: ${complaintPhone || 'N/A'}`
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
                  disabled={isSubmitting}
                  className="px-5 py-2.5 bg-rose-600 hover:bg-rose-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-rose-600/20 flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
                >
                  <AlertOctagon className="w-3.5 h-3.5" />
                  <span>{isSubmitting ? 'Registering...' : 'Register Complaint'}</span>
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
                    Digital Personal Data Protection Act (DPDP Act, 2023)
                  </h4>
                </div>
                <p className="text-blue-900 dark:text-blue-200 leading-relaxed text-[11px]">
                  My Money Manager complies fully with the statutory standards of India's Digital Personal Data Protection Act, 2023. Your financial confidentiality and privacy are strictly safeguarded.
                </p>
              </div>

              <div className="space-y-2">
                <h5 className="font-bold text-slate-800 dark:text-slate-200">
                  Your Statutory Privacy Rights:
                </h5>
                <ul className="space-y-1.5 text-[11px] text-slate-600 dark:text-slate-400 list-disc pl-5">
                  <li><b>Right to Access:</b> Review and export all your transactions and profile records at any time.</li>
                  <li><b>Right to Correction:</b> Edit, update, or correct any historical entry or personal detail.</li>
                  <li><b>Right to Erasure:</b> Permanently delete specific transactions or request full account deletion with a 24-hour safety window.</li>
                  <li><b>Right to Grievance Redressal:</b> Contact our official Data Grievance Desk directly at{' '}
                    <a href={SUPPORT_CONTACT.telUrl} className="underline text-emerald-600 font-bold">{SUPPORT_CONTACT.displayPhone}</a> or{' '}
                    <a href={SUPPORT_CONTACT.mailToUrl} className="underline text-emerald-600 font-bold">{SUPPORT_CONTACT.email}</a>.
                  </li>
                </ul>
              </div>

              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-between">
                <div>
                  <p className="font-bold text-slate-800 dark:text-slate-200 text-xs">
                    Data Consent Standing
                  </p>
                  <p className="text-[11px] text-emerald-600 font-semibold">
                    Active & Consented under DPDP Act 2023
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    localStorage.removeItem('my_money_dpdp_consent_v1');
                    toast.info('Consent Reset', 'Data processing consent has been reset.');
                    onClose();
                  }}
                  className="px-3 py-1.5 bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-lg text-xs font-semibold hover:bg-slate-300 cursor-pointer"
                >
                  Reset Consent
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};