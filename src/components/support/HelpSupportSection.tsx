import React, { useState, useEffect } from 'react';
import {
  Star,
  MessageSquare,
  AlertOctagon,
  HelpCircle,
  Clock,
  CheckCircle2,
  Send,
  ExternalLink,
  ChevronRight,
  Shield,
  FileText,
  Mail,
  Phone,
  RefreshCw,
  Search,
  MessageCircle,
  Paperclip,
  Check,
  Smartphone,
  Copy,
  Sparkles,
  ShieldCheck,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { supportApi, FeedbackRecord, SupportTicketRecord, SupportTicketReplyRecord } from '../../lib/supportApi';
import { formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';
import { SUPPORT_CONTACT, buildWhatsAppSupportUrl, buildMailToUrl } from '../../config/contact';
import { PrivacyConsentCard } from '../settings/PrivacyConsentCard';

const STAR_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Needs Improvement',
  3: 'Average',
  4: 'Good',
  5: 'Excellent',
};

const FEEDBACK_CATEGORIES = [
  'App Experience',
  'UI / Design',
  'Performance',
  'Features',
  'Calculator',
  'Udhar',
  'Other',
];

const COMPLAINT_CATEGORIES = [
  'Account & Login',
  'Data / Sync Issue',
  'Income & Expense',
  'Udhar Management',
  'Calculator',
  'App Bug',
  'Incorrect Information',
  'Security Concern',
  'Privacy Concern',
  'Account Deletion',
  'Other',
];

const SUPPORT_CATEGORIES = [
  'How to use the app',
  'Account help',
  'Calculator help',
  'Udhar help',
  'Data issue',
  'Technical issue',
  'Feature request',
  'Other',
];

type HelpTab = 'help' | 'feedback' | 'complaint' | 'support' | 'history' | 'dpdp';

interface HelpSupportSectionProps {
  initialTab?: HelpTab;
}

/**
 * Single Help & Feedback surface: about/help, feedback, complaint, support
 * ticket, history and privacy consent all live here.
 */
export const HelpSupportSection: React.FC<HelpSupportSectionProps> = ({ initialTab }) => {
  const { user } = useAuth();
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<HelpTab>(initialTab ?? 'feedback');

  // FEEDBACK FORM STATE (Rating defaults to 0 - no star preselected; categories removed from user UI)
  const [rating, setRating] = useState<number>(0);
  const [hoverRating, setHoverRating] = useState<number | null>(null);
  const [feedbackCategory, setFeedbackCategory] = useState<string>('General');
  const [feedbackMessage, setFeedbackMessage] = useState<string>('');
  const [isSubmittingFeedback, setIsSubmittingFeedback] = useState<boolean>(false);
  const [feedbackSubmittedSuccess, setFeedbackSubmittedSuccess] = useState<boolean>(false);

  // COMPLAINT FORM STATE (Simplified strictly to Subject + Description + Submit only)
  const [complaintCategory, setComplaintCategory] = useState<string>('General');
  const [complaintSubject, setComplaintSubject] = useState<string>('');
  const [complaintDescription, setComplaintDescription] = useState<string>('');
  const [complaintAttachment, setComplaintAttachment] = useState<string>('');
  const [isSubmittingComplaint, setIsSubmittingComplaint] = useState<boolean>(false);
  const [submittedComplaintTicket, setSubmittedComplaintTicket] = useState<Partial<SupportTicketRecord> | null>(null);

  // SUPPORT REQUEST FORM STATE
  const [supportCategory, setSupportCategory] = useState<string>('How to use the app');
  const [supportSubject, setSupportSubject] = useState<string>('');
  const [supportMessage, setSupportMessage] = useState<string>('');
  const [isSubmittingSupport, setIsSubmittingSupport] = useState<boolean>(false);
  const [submittedSupportTicket, setSubmittedSupportTicket] = useState<Partial<SupportTicketRecord> | null>(null);

  // HISTORY STATE
  const [historyFeedbacks, setHistoryFeedbacks] = useState<FeedbackRecord[]>([]);
  const [historyTickets, setHistoryTickets] = useState<SupportTicketRecord[]>([]);
  const [isLoadingHistory, setIsLoadingHistory] = useState<boolean>(false);
  const [historySubTab, setHistorySubTab] = useState<'all' | 'complaints' | 'support' | 'feedback'>('all');
  const [historySearchQuery, setHistorySearchQuery] = useState<string>('');

  // TICKET DETAIL MODAL STATE
  const [selectedTicketId, setSelectedTicketId] = useState<string | null>(null);
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketRecord | null>(null);
  const [ticketReplies, setTicketReplies] = useState<SupportTicketReplyRecord[]>([]);
  const [isLoadingTicketDetails, setIsLoadingTicketDetails] = useState<boolean>(false);
  const [userReplyText, setUserReplyText] = useState<string>('');
  const [isSendingUserReply, setIsSendingUserReply] = useState<boolean>(false);

  // Copy state
  const [copiedPhone, setCopiedPhone] = useState<boolean>(false);
  const [copiedEmail, setCopiedEmail] = useState<boolean>(false);

  const handleCopyPhone = () => {
    navigator.clipboard.writeText(SUPPORT_CONTACT.phone);
    setCopiedPhone(true);
    toast.success('Copied to Clipboard', `Helpline ${SUPPORT_CONTACT.displayPhone} copied.`);
    setTimeout(() => setCopiedPhone(false), 2500);
  };

  const handleCopyEmail = () => {
    navigator.clipboard.writeText(SUPPORT_CONTACT.email);
    setCopiedEmail(true);
    toast.success('Copied to Clipboard', `Support email ${SUPPORT_CONTACT.email} copied.`);
    setTimeout(() => setCopiedEmail(false), 2500);
  };

  // Load history when tab is switched to history
  useEffect(() => {
    if (activeTab === 'history') {
      loadHistory();
    }
  }, [activeTab]);

  const loadHistory = async () => {
    try {
      setIsLoadingHistory(true);
      const res = await supportApi.getSupportHistory();
      if (res.success) {
        setHistoryFeedbacks(res.feedbacks || []);
        setHistoryTickets(res.tickets || []);
      }
    } catch (err: any) {
      toast.error('Failed to Load History', err.message);
    } finally {
      setIsLoadingHistory(false);
    }
  };

  const handleOpenTicket = async (ticketId: string) => {
    setSelectedTicketId(ticketId);
    try {
      setIsLoadingTicketDetails(true);
      const res = await supportApi.getUserTicketDetails(ticketId);
      if (res.success) {
        setSelectedTicket(res.ticket);
        setTicketReplies(res.replies || []);
      }
    } catch (err: any) {
      toast.error('Could not load ticket', err.message);
    } finally {
      setIsLoadingTicketDetails(false);
    }
  };

  const handleSendUserReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicketId || !userReplyText.trim()) return;

    try {
      setIsSendingUserReply(true);
      const res = await supportApi.userReplyToTicket(selectedTicketId, userReplyText.trim());
      if (res.success) {
        toast.success('Reply Sent', 'Your message has been posted to the ticket.');
        setUserReplyText('');
        setTicketReplies((prev) => [...prev, res.reply]);
        loadHistory();
      }
    } catch (err: any) {
      toast.error('Failed to Send Reply', err.message);
    } finally {
      setIsSendingUserReply(false);
    }
  };

  // 1. SUBMIT FEEDBACK
  const handleFeedbackSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rating || rating === 0) {
      toast.error('Rating Required', 'Please select an overall star rating (1 to 5).');
      return;
    }
    if (!feedbackMessage.trim()) {
      toast.error('Message Required', 'Please share your experience, suggestions, or ideas.');
      return;
    }

    try {
      setIsSubmittingFeedback(true);
      const res = await supportApi.submitFeedback({
        rating,
        category: feedbackCategory,
        message: feedbackMessage.trim(),
      });

      if (res.success) {
        setFeedbackSubmittedSuccess(true);
        toast.success('Thank You!', res.message);
        setFeedbackMessage('');
      }
    } catch (err: any) {
      toast.error('Submission Failed', err.message);
    } finally {
      setIsSubmittingFeedback(false);
    }
  };

  // 2. SUBMIT COMPLAINT
  const handleComplaintSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!complaintSubject.trim() || complaintSubject.trim().length < 3) {
      toast.error('Subject Required', 'Please enter a clear complaint subject (min 3 characters).');
      return;
    }
    if (!complaintDescription.trim() || complaintDescription.trim().length < 5) {
      toast.error('Description Required', 'Please provide detailed complaint information (min 5 characters).');
      return;
    }

    try {
      setIsSubmittingComplaint(true);
      const res = await supportApi.raiseComplaint({
        category: complaintCategory,
        subject: complaintSubject.trim(),
        description: complaintDescription.trim(),
        attachment_url: complaintAttachment.trim() || undefined,
      });

      if (res.success && res.ticket) {
        setSubmittedComplaintTicket(res.ticket);
        toast.success('Complaint Registered', res.message);
        setComplaintSubject('');
        setComplaintDescription('');
        setComplaintAttachment('');
      }
    } catch (err: any) {
      toast.error('Submission Failed', err.message);
    } finally {
      setIsSubmittingComplaint(false);
    }
  };

  // 3. SUBMIT SUPPORT REQUEST
  const handleSupportSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!supportSubject.trim() || supportSubject.trim().length < 3) {
      toast.error('Subject Required', 'Please enter your request subject.');
      return;
    }
    if (!supportMessage.trim() || supportMessage.trim().length < 5) {
      toast.error('Message Required', 'Please describe what you need assistance with.');
      return;
    }

    try {
      setIsSubmittingSupport(true);
      const res = await supportApi.submitSupportTicket({
        category: supportCategory,
        subject: supportSubject.trim(),
        message: supportMessage.trim(),
      });

      if (res.success && res.ticket) {
        setSubmittedSupportTicket(res.ticket);
        toast.success('Support Request Sent', res.message);
        setSupportSubject('');
        setSupportMessage('');
      }
    } catch (err: any) {
      toast.error('Submission Failed', err.message);
    } finally {
      setIsSubmittingSupport(false);
    }
  };

  const effectiveRating = hoverRating || rating;

  return (
    <div className="space-y-6 pb-20 max-w-5xl mx-auto">
      {/* Header Banner */}
      <div className="bg-gradient-to-br from-emerald-600 via-emerald-700 to-teal-800 rounded-3xl p-6 sm:p-8 text-white shadow-xl shadow-emerald-950/10 relative overflow-hidden">
        <div className="relative z-10 space-y-2">
          <div className="inline-flex items-center gap-1.5 px-3 py-1 rounded-full bg-white/15 backdrop-blur-md text-[11px] font-bold tracking-wide uppercase">
            <Shield className="w-3.5 h-3.5" />
            Official Support Desk
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold tracking-tight">
            Help, Feedback &amp; Grievances
          </h1>
          <p className="text-emerald-100 text-xs sm:text-sm max-w-xl">
            We are dedicated to providing you with the best personal finance experience. Submit suggestions, register issues, or get direct help from our team.
          </p>
        </div>
      </div>

      {/* Official Contact Quick Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
        {/* Phone */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Phone className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Direct Helpline</p>
              <a
                href={SUPPORT_CONTACT.telUrl}
                className="text-xs font-bold text-slate-900 dark:text-slate-100 hover:text-emerald-600 dark:hover:text-emerald-400"
              >
                {SUPPORT_CONTACT.displayPhone}
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopyPhone}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
            title="Copy phone number"
          >
            {copiedPhone ? <Check className="w-3.5 h-3.5 text-emerald-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* Email */}
        <div className="p-4 bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-800 flex items-center justify-between shadow-sm">
          <div className="flex items-center gap-3 truncate">
            <div className="w-9 h-9 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 flex items-center justify-center shrink-0">
              <Mail className="w-4 h-4" />
            </div>
            <div className="truncate">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Support Email</p>
              <a
                href={SUPPORT_CONTACT.mailToUrl}
                className="text-xs font-bold text-slate-900 dark:text-slate-100 hover:text-blue-600 dark:hover:text-blue-400 truncate block"
              >
                {SUPPORT_CONTACT.email}
              </a>
            </div>
          </div>
          <button
            type="button"
            onClick={handleCopyEmail}
            className="p-1.5 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer shrink-0"
            title="Copy email address"
          >
            {copiedEmail ? <Check className="w-3.5 h-3.5 text-blue-600" /> : <Copy className="w-3.5 h-3.5" />}
          </button>
        </div>

        {/* WhatsApp */}
        <a
          href={SUPPORT_CONTACT.whatsappUrl}
          target="_blank"
          rel="noopener noreferrer"
          className="p-4 bg-emerald-600 hover:bg-emerald-700 active:scale-98 transition-all rounded-2xl text-white flex items-center justify-between shadow-md shadow-emerald-600/20 cursor-pointer"
        >
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-xl bg-white/20 flex items-center justify-center">
              <Smartphone className="w-4 h-4" />
            </div>
            <div>
              <p className="text-[10px] font-bold uppercase tracking-wider text-emerald-200">Instant Chat</p>
              <p className="text-xs font-bold">WhatsApp Direct</p>
            </div>
          </div>
          <ExternalLink className="w-4 h-4 opacity-80" />
        </a>
      </div>

      {/* Main Tabs */}
      <div className="flex items-center gap-2 overflow-x-auto pb-1 no-scrollbar border-b border-slate-200 dark:border-slate-800 text-xs font-bold">
        <button
          onClick={() => setActiveTab('help')}
          className={`flex items-center gap-2 px-4 py-3 rounded-2xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'help'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Sparkles className="w-4 h-4" />
          <span>Help</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('feedback');
            setFeedbackSubmittedSuccess(false);
          }}
          className={`flex items-center gap-2 px-4 py-3 rounded-2xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'feedback'
              ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Star className="w-4 h-4" />
          <span>Submit Feedback</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('complaint');
            setSubmittedComplaintTicket(null);
          }}
          className={`flex items-center gap-2 px-4 py-3 rounded-2xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'complaint'
              ? 'bg-rose-600 text-white shadow-md shadow-rose-600/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <AlertOctagon className="w-4 h-4" />
          <span>Raise a Complaint</span>
        </button>

        <button
          onClick={() => {
            setActiveTab('support');
            setSubmittedSupportTicket(null);
          }}
          className={`flex items-center gap-2 px-4 py-3 rounded-2xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'support'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <HelpCircle className="w-4 h-4" />
          <span>Contact Support</span>
        </button>

        <button
          onClick={() => setActiveTab('history')}
          className={`flex items-center gap-2 px-4 py-3 rounded-2xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'history'
              ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-md'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <Clock className="w-4 h-4" />
          <span>Feedback &amp; Support History</span>
          {(historyTickets.length > 0 || historyFeedbacks.length > 0) && (
            <span className="px-2 py-0.5 rounded-full text-[10px] bg-slate-200 dark:bg-slate-700 text-slate-800 dark:text-slate-200">
              {historyTickets.length + historyFeedbacks.length}
            </span>
          )}
        </button>

        <button
          onClick={() => setActiveTab('dpdp')}
          className={`flex items-center gap-2 px-4 py-3 rounded-2xl transition-all cursor-pointer whitespace-nowrap ${
            activeTab === 'dpdp'
              ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/20'
              : 'text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800'
          }`}
        >
          <ShieldCheck className="w-4 h-4" />
          <span>Privacy &amp; Consent</span>
        </button>
      </div>

      {/* 0. HELP TAB                                                    */}
      {activeTab === 'help' && (
        <div className="space-y-4 text-xs">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <h3 className="font-bold text-slate-900 dark:text-slate-100 text-sm flex items-center gap-2">
              <Sparkles className="w-4 h-4 text-emerald-500" />
              <span>About My Money Manager</span>
            </h3>
            <p className="text-slate-600 dark:text-slate-300 leading-relaxed">
              A personal finance, room expense, dining and peer-to-peer ledger app maintained by{' '}
              <b>{SUPPORT_CONTACT.companyName}</b>. Use the tabs above to send feedback, raise a
              complaint, contact support or review your history.
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                <p className="font-bold text-slate-800 dark:text-slate-200">Multi-device sync</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Sign in from any device and your financial data stays in sync.
                </p>
              </div>
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200 dark:border-slate-800">
                <p className="font-bold text-slate-800 dark:text-slate-200">Udhar settle &amp; clear</p>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                  Track who owes you and whom you owe with clear settlement history.
                </p>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* DPDP / PRIVACY CONSENT TAB                                     */}
      {activeTab === 'dpdp' && (
        <div className="space-y-4">
          <PrivacyConsentCard
            onOpenPrivacyPolicy={() => {
              window.location.hash = '#legal=privacy_policy';
            }}
          />
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm text-xs text-slate-600 dark:text-slate-300">
            <p>
              Each consent above is independent and can be withdrawn at any time. Read the full{' '}
              <button
                type="button"
                onClick={() => {
                  window.location.hash = '#legal=privacy_policy';
                }}
                className="text-emerald-600 dark:text-emerald-400 font-bold underline cursor-pointer"
              >
                Privacy Policy
              </button>{' '}
              for how your data is processed under the DPDP Act, 2023.
            </p>
          </div>
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 1. FEEDBACK TAB                                                */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'feedback' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
          {feedbackSubmittedSuccess ? (
            <div className="text-center py-12 space-y-4">
              <div className="w-16 h-16 bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Thank you for your feedback!
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                Your opinion helps us improve My Money Manager. A confirmation email has been dispatched to your registered address.
              </p>
              <button
                type="button"
                onClick={() => setFeedbackSubmittedSuccess(false)}
                className="mt-4 px-6 py-2.5 rounded-2xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 transition-all cursor-pointer shadow-md shadow-emerald-600/20"
              >
                Submit Another Feedback
              </button>
            </div>
          ) : (
            <form onSubmit={handleFeedbackSubmit} className="space-y-6">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mb-1">
                  How would you rate your experience? <span className="text-rose-500">*</span>
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mb-4">
                  Select a star rating from 1 to 5 stars.
                </p>

                {/* 5-STAR RATING COMPONENT */}
                <div className="flex items-center gap-2">
                  {[1, 2, 3, 4, 5].map((starVal) => {
                    const isFilled = starVal <= effectiveRating;
                    return (
                      <button
                        key={starVal}
                        type="button"
                        onClick={() => setRating(starVal)}
                        onMouseEnter={() => setHoverRating(starVal)}
                        onMouseLeave={() => setHoverRating(null)}
                        className="p-1 transition-transform hover:scale-110 active:scale-95 cursor-pointer focus:outline-none"
                        aria-label={`${starVal} Star`}
                      >
                        <Star
                          className={`w-8 h-8 sm:w-10 sm:h-10 transition-colors ${
                            isFilled
                              ? 'text-amber-400 fill-amber-400'
                              : 'text-slate-300 dark:text-slate-700'
                          }`}
                        />
                      </button>
                    );
                  })}
                  <span className="ml-3 text-sm font-bold text-slate-800 dark:text-slate-200">
                    {effectiveRating > 0 ? STAR_LABELS[effectiveRating] : 'Select rating (1 to 5)'}
                  </span>
                </div>
              </div>

              {/* Feedback Message */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Tell us more about your experience <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={feedbackMessage}
                  onChange={(e) => setFeedbackMessage(e.target.value)}
                  placeholder="Share your experience, suggestions, or ideas to help us improve My Money Manager..."
                  required
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500 transition-all resize-y"
                />
              </div>

              {/* User Identity Note */}
              <div className="flex items-center gap-2 p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-950/60 border border-slate-200 dark:border-slate-800 text-xs text-slate-500">
                <Shield className="w-4 h-4 text-emerald-600 flex-shrink-0" />
                <span>
                  Submitting as verified account: <strong className="text-slate-800 dark:text-slate-200">{user?.displayName || user?.email}</strong>.
                </span>
              </div>

              <button
                type="submit"
                disabled={isSubmittingFeedback}
                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition-all cursor-pointer shadow-lg shadow-emerald-600/25 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>{isSubmittingFeedback ? 'Submitting...' : 'Submit Feedback'}</span>
              </button>
            </form>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 2. COMPLAINT TAB                                               */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'complaint' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
          {submittedComplaintTicket ? (
            <div className="text-center py-10 space-y-4">
              <div className="w-16 h-16 bg-rose-100 dark:bg-rose-950/60 text-rose-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Complaint Registered Successfully
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                Your complaint has been submitted successfully. Our support team will review it and get back to you.
              </p>

              {/* TICKET DETAILS CARD */}
              <div className="max-w-md mx-auto p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900 text-left space-y-2 text-xs">
                <div className="flex justify-between items-center">
                  <span className="text-slate-500">Complaint ID:</span>
                  <span className="font-mono font-bold text-rose-700 dark:text-rose-400 bg-white dark:bg-slate-900 px-2.5 py-1 rounded-lg border border-rose-200">
                    #{submittedComplaintTicket.ticket_number}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Subject:</span>
                  <span className="font-semibold text-slate-900 dark:text-white">{submittedComplaintTicket.subject}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Current Status:</span>
                  <span className="font-bold text-emerald-600 uppercase text-[11px] bg-emerald-100 dark:bg-emerald-950 px-2 py-0.5 rounded">
                    {submittedComplaintTicket.status || 'Open'}
                  </span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-500">Submission Date:</span>
                  <span className="text-slate-600 dark:text-slate-400">
                    {submittedComplaintTicket.created_at ? formatDisplayDate(submittedComplaintTicket.created_at) : 'Just now'}
                  </span>
                </div>
              </div>

              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className="px-6 py-2.5 rounded-2xl text-xs font-bold text-white bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 transition-all cursor-pointer"
                >
                  View in Support History
                </button>
                <button
                  type="button"
                  onClick={() => setSubmittedComplaintTicket(null)}
                  className="px-6 py-2.5 rounded-2xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  Raise Another Complaint
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleComplaintSubmit} className="space-y-6">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Formal Complaint Submission
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Raise an official grievance regarding data discrepancies, bugs, billing, or security.
                </p>
              </div>

              {/* Subject */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Subject / Summary <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  value={complaintSubject}
                  onChange={(e) => setComplaintSubject(e.target.value)}
                  placeholder="e.g. Transactions not synchronizing on mobile"
                  required
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500"
                />
              </div>

              {/* Description */}
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Detailed Complaint Description <span className="text-rose-500">*</span>
                </label>
                <textarea
                  rows={5}
                  value={complaintDescription}
                  onChange={(e) => setComplaintDescription(e.target.value)}
                  placeholder="Please describe the issue thoroughly, including steps to reproduce, device, or relevant details..."
                  required
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-rose-500 resize-y"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingComplaint}
                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl text-xs font-bold text-white bg-rose-600 hover:bg-rose-700 active:scale-95 transition-all cursor-pointer shadow-lg shadow-rose-600/25 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <AlertOctagon className="w-4 h-4" />
                <span>{isSubmittingComplaint ? 'Registering...' : 'Submit Complaint'}</span>
              </button>
            </form>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 3. CONTACT SUPPORT TAB                                         */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'support' && (
        <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 sm:p-8 border border-slate-200 dark:border-slate-800 shadow-sm space-y-6">
          {submittedSupportTicket ? (
            <div className="text-center py-10 space-y-4">
              <div className="w-16 h-16 bg-indigo-100 dark:bg-indigo-950/60 text-indigo-600 rounded-full flex items-center justify-center mx-auto">
                <CheckCircle2 className="w-8 h-8" />
              </div>
              <h3 className="text-lg font-bold text-slate-900 dark:text-white">
                Support Request Submitted
              </h3>
              <p className="text-xs sm:text-sm text-slate-500 max-w-md mx-auto">
                Your ticket <strong className="font-mono text-indigo-600">#{submittedSupportTicket.ticket_number}</strong> has been created. A support specialist will respond shortly.
              </p>
              <div className="flex flex-wrap justify-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setActiveTab('history')}
                  className="px-6 py-2.5 rounded-2xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 transition-all cursor-pointer"
                >
                  View Support History
                </button>
                <button
                  type="button"
                  onClick={() => setSubmittedSupportTicket(null)}
                  className="px-6 py-2.5 rounded-2xl text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 transition-all cursor-pointer"
                >
                  Submit Another Request
                </button>
              </div>
            </div>
          ) : (
            <form onSubmit={handleSupportSubmit} className="space-y-6">
              <div className="border-b border-slate-100 dark:border-slate-800 pb-4">
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Contact Support Desk
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5">
                  Need help with calculations, people udhar balances, or feature setup? Ask our specialists.
                </p>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Help Category <span className="text-indigo-500">*</span>
                </label>
                <select
                  value={supportCategory}
                  onChange={(e) => setSupportCategory(e.target.value)}
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-indigo-500"
                >
                  {SUPPORT_CATEGORIES.map((cat) => (
                    <option key={cat} value={cat}>
                      {cat}
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Subject <span className="text-indigo-500">*</span>
                </label>
                <input
                  type="text"
                  value={supportSubject}
                  onChange={(e) => setSupportSubject(e.target.value)}
                  placeholder="e.g. How to export PDF statements for my room budget"
                  required
                  className="w-full px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Message <span className="text-indigo-500">*</span>
                </label>
                <textarea
                  rows={4}
                  value={supportMessage}
                  onChange={(e) => setSupportMessage(e.target.value)}
                  placeholder="Describe what you need assistance with..."
                  required
                  className="w-full px-4 py-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-950 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-y"
                />
              </div>

              <button
                type="submit"
                disabled={isSubmittingSupport}
                className="w-full sm:w-auto px-8 py-3.5 rounded-2xl text-xs font-bold text-white bg-indigo-600 hover:bg-indigo-700 active:scale-95 transition-all cursor-pointer shadow-lg shadow-indigo-600/25 flex items-center justify-center gap-2 disabled:opacity-50"
              >
                <Send className="w-4 h-4" />
                <span>{isSubmittingSupport ? 'Sending...' : 'Submit Support Request'}</span>
              </button>
            </form>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* 4. HISTORY TAB (USER SUPPORT & FEEDBACK HISTORY)               */}
      {/* ------------------------------------------------------------- */}
      {activeTab === 'history' && (
        <div className="space-y-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl p-6 border border-slate-200 dark:border-slate-800 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Your Support &amp; Feedback History
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Track tickets, review status updates, and view team responses.
                </p>
              </div>

              <button
                type="button"
                onClick={loadHistory}
                disabled={isLoadingHistory}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 text-xs font-bold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <RefreshCw className={`w-3.5 h-3.5 ${isLoadingHistory ? 'animate-spin' : ''}`} />
                <span>Refresh</span>
              </button>
            </div>

            {/* Sub-tabs & Search */}
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-1 overflow-x-auto pb-1 text-xs">
                {(['all', 'complaints', 'support', 'feedback'] as const).map((st) => (
                  <button
                    key={st}
                    type="button"
                    onClick={() => setHistorySubTab(st)}
                    className={`px-3 py-1.5 rounded-xl font-bold capitalize transition-all cursor-pointer ${
                      historySubTab === st
                        ? 'bg-emerald-600 text-white'
                        : 'text-slate-500 hover:bg-slate-100 dark:hover:bg-slate-800'
                    }`}
                  >
                    {st}
                  </button>
                ))}
              </div>

              <div className="relative">
                <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={historySearchQuery}
                  onChange={(e) => setHistorySearchQuery(e.target.value)}
                  placeholder="Search your tickets..."
                  className="w-full sm:w-60 pl-8 pr-3 py-1.5 text-xs rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-800 dark:text-slate-200 focus:outline-none focus:ring-1 focus:ring-emerald-500"
                />
              </div>
            </div>
          </div>

          {/* LIST OF TICKETS & FEEDBACKS */}
          {isLoadingHistory ? (
            <div className="bg-white dark:bg-slate-900 rounded-3xl p-12 text-center text-xs text-slate-500 border border-slate-200 dark:border-slate-800">
              Loading your records...
            </div>
          ) : (
            <div className="space-y-3">
              {/* Filtered Tickets */}
              {historyTickets
                .filter((t) => {
                  if (historySubTab === 'complaints') return t.ticket_type === 'complaint';
                  if (historySubTab === 'support') return t.ticket_type === 'support';
                  if (historySubTab === 'feedback') return false;
                  return true;
                })
                .filter((t) => {
                  if (!historySearchQuery.trim()) return true;
                  const q = historySearchQuery.toLowerCase();
                  return (
                    t.ticket_number.toLowerCase().includes(q) ||
                    t.subject.toLowerCase().includes(q) ||
                    t.category.toLowerCase().includes(q)
                  );
                })
                .map((ticket) => (
                  <div
                    key={ticket.id}
                    onClick={() => handleOpenTicket(ticket.id)}
                    className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 hover:border-emerald-500 dark:hover:border-emerald-500 transition-all cursor-pointer shadow-sm hover:shadow flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3"
                  >
                    <div className="space-y-1">
                      <div className="flex items-center gap-2">
                        <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                          #{ticket.ticket_number}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                            ticket.ticket_type === 'complaint'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300'
                          }`}
                        >
                          {ticket.ticket_type}
                        </span>
                        <span
                          className={`text-[10px] font-bold px-2 py-0.5 rounded-md uppercase tracking-wider ${
                            ticket.status === 'open'
                              ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                              : ticket.status === 'in_progress'
                              ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                              : ticket.status === 'waiting_user'
                              ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                              : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                          }`}
                        >
                          {ticket.status.replace('_', ' ')}
                        </span>
                      </div>
                      <h4 className="text-sm font-bold text-slate-900 dark:text-white">
                        {ticket.subject}
                      </h4>
                      <p className="text-xs text-slate-500 line-clamp-1">
                        {ticket.description}
                      </p>
                    </div>

                    <div className="flex items-center gap-3 self-end sm:self-center text-xs text-slate-400">
                      <span>{formatDisplayDate(ticket.created_at)}</span>
                      <ChevronRight className="w-4 h-4 text-slate-400" />
                    </div>
                  </div>
                ))}

              {/* Feedbacks in History */}
              {(historySubTab === 'all' || historySubTab === 'feedback') &&
                historyFeedbacks
                  .filter((f) => {
                    if (!historySearchQuery.trim()) return true;
                    const q = historySearchQuery.toLowerCase();
                    return (
                      (f.category || '').toLowerCase().includes(q) ||
                      f.message.toLowerCase().includes(q)
                    );
                  })
                  .map((fb) => (
                    <div
                      key={fb.id}
                      className="bg-white dark:bg-slate-900 rounded-2xl p-4 sm:p-5 border border-slate-200 dark:border-slate-800 shadow-sm space-y-2"
                    >
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] font-bold px-2 py-0.5 rounded-md uppercase bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                            Feedback
                          </span>
                          <span className="text-xs font-semibold text-slate-500">
                            {fb.category || 'App Experience'}
                          </span>
                        </div>
                        <span className="text-[11px] text-slate-400">
                          {formatDisplayDate(fb.created_at)}
                        </span>
                      </div>
                      {fb.rating && (
                        <div className="flex items-center gap-1 text-amber-400 text-xs">
                          {'★'.repeat(fb.rating)}
                          {'☆'.repeat(5 - fb.rating)}
                          <span className="ml-1 text-[11px] font-bold text-slate-600 dark:text-slate-400">
                            ({STAR_LABELS[fb.rating] || `${fb.rating} Stars`})
                          </span>
                        </div>
                      )}
                      <p className="text-xs text-slate-700 dark:text-slate-300 italic">
                        &ldquo;{fb.message}&rdquo;
                      </p>
                      {fb.admin_notes && (
                        <div className="mt-2 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 text-xs text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-800">
                          <strong className="text-slate-800 dark:text-slate-200 block mb-0.5">Admin Response:</strong>
                          {fb.admin_notes}
                        </div>
                      )}
                    </div>
                  ))}

              {historyTickets.length === 0 && historyFeedbacks.length === 0 && (
                <div className="bg-white dark:bg-slate-900 rounded-3xl p-12 text-center border border-slate-200 dark:border-slate-800 space-y-2">
                  <MessageSquare className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
                  <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
                    No tickets or feedback submitted yet
                  </p>
                  <p className="text-xs text-slate-400">
                    When you raise complaints, seek assistance, or submit ratings, they will be tracked here.
                  </p>
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* ------------------------------------------------------------- */}
      {/* TICKET DETAIL & REPLIES MODAL                                 */}
      {/* ------------------------------------------------------------- */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div className="space-y-0.5">
                <div className="flex items-center gap-2">
                  <span className="font-mono text-xs font-bold px-2 py-0.5 rounded-lg bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    #{selectedTicket.ticket_number}
                  </span>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300">
                    {selectedTicket.status.replace('_', ' ')}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  {selectedTicket.subject}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => {
                  setSelectedTicket(null);
                  setSelectedTicketId(null);
                }}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                &times;
              </button>
            </div>

            {/* Modal Body: Ticket Details & Message Thread */}
            <div className="p-5 overflow-y-auto space-y-4 flex-1">
              {/* Original Complaint / Ticket */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex items-center justify-between text-xs text-slate-500">
                  <span className="font-bold text-slate-700 dark:text-slate-300">
                    Initial Description
                  </span>
                  <span>{formatDisplayDate(selectedTicket.created_at)} at {formatDisplayTime(selectedTicket.created_at)}</span>
                </div>
                <p className="text-xs sm:text-sm text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed">
                  {selectedTicket.description}
                </p>
                {selectedTicket.attachment_url && (
                  <div className="pt-2">
                    <a
                      href={selectedTicket.attachment_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center gap-1.5 text-xs text-emerald-600 hover:underline"
                    >
                      <Paperclip className="w-3.5 h-3.5" />
                      <span>View Attached Screenshot / Link</span>
                    </a>
                  </div>
                )}
              </div>

              {/* Message Thread */}
              <div className="space-y-3 pt-2">
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                  Conversation Thread ({ticketReplies.length} {ticketReplies.length === 1 ? 'Message' : 'Messages'})
                </h4>

                {ticketReplies.length === 0 ? (
                  <p className="text-xs text-slate-400 italic">
                    No replies yet. Our support team is reviewing your ticket and will message you here.
                  </p>
                ) : (
                  ticketReplies.map((reply) => {
                    const isAdmin = reply.sender_type === 'admin' || reply.sender_role === 'admin' || reply.sender_role === 'superadmin';
                    return (
                      <div
                        key={reply.id}
                        className={`flex flex-col ${isAdmin ? 'items-start' : 'items-end'}`}
                      >
                        <div
                          className={`max-w-[85%] rounded-2xl p-4 text-xs sm:text-sm space-y-1 ${
                            isAdmin
                              ? 'bg-emerald-50 dark:bg-emerald-950/60 border border-emerald-200 dark:border-emerald-800 text-slate-800 dark:text-slate-100 rounded-tl-sm'
                              : 'bg-indigo-600 text-white rounded-tr-sm'
                          }`}
                        >
                          <div className="flex items-center justify-between gap-4 text-[11px] opacity-75">
                            <span className="font-bold">
                              {isAdmin ? `Support Specialist (${reply.sender_name})` : 'You'}
                            </span>
                            <span>{formatDisplayTime(reply.created_at)}</span>
                          </div>
                          <p className="whitespace-pre-wrap leading-relaxed">
                            {reply.message}
                          </p>
                        </div>
                      </div>
                    );
                  })
                )}
              </div>
            </div>

            {/* Modal Footer: Reply Composer (Disabled if ticket is closed) */}
            <div className="p-4 border-t border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950">
              {selectedTicket.status === 'closed' ? (
                <p className="text-xs text-slate-500 text-center py-1">
                  This ticket is closed. If you have additional inquiries, please submit a new ticket.
                </p>
              ) : (
                <form onSubmit={handleSendUserReply} className="flex gap-2">
                  <input
                    type="text"
                    value={userReplyText}
                    onChange={(e) => setUserReplyText(e.target.value)}
                    placeholder="Write a reply to the support team..."
                    className="flex-1 px-4 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-xs sm:text-sm text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="submit"
                    disabled={isSendingUserReply || !userReplyText.trim()}
                    className="px-5 py-2.5 rounded-2xl text-xs font-bold text-white bg-emerald-600 hover:bg-emerald-700 active:scale-95 transition-all cursor-pointer shadow-md shadow-emerald-600/20 flex items-center gap-1.5 disabled:opacity-50"
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSendingUserReply ? 'Sending...' : 'Send'}</span>
                  </button>
                </form>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
