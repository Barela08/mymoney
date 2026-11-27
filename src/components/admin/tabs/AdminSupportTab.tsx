import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Send,
  RefreshCw,
  Clock,
  CheckCircle2,
  User,
  Eye,
  X,
  Lock,
  Star,
  Mail,
  Search,
  AlertOctagon,
  LifeBuoy,
  History,
  RotateCcw,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import {
  supportApi,
  FeedbackRecord,
  FeedbackMetrics,
  TicketMetrics,
  TicketStatusHistoryRecord,
} from '../../../lib/supportApi';
import { useToast } from '../../../context/ToastContext';
import { subscribeAdminRealtimeEvent } from '../../../lib/useAdminRealtime';

export type AdminSupportMode = 'all' | 'feedback' | 'complaints' | 'support';

interface AdminSupportTabProps {
  mode?: AdminSupportMode;
  focusRecordId?: string | null;
  onClearFocusRecord?: () => void;
}

const DEFAULT_TICKET_METRICS: TicketMetrics = {
  total: 0,
  open: 0,
  under_review: 0,
  in_progress: 0,
  waiting_user: 0,
  resolved: 0,
  closed: 0,
  urgent: 0,
};

export const AdminSupportTab: React.FC<AdminSupportTabProps> = ({
  mode = 'all',
  focusRecordId = null,
  onClearFocusRecord,
}) => {
  const toast = useToast();
  const [subView, setSubView] = useState<'complaints' | 'support' | 'feedback'>(() =>
    mode === 'feedback' ? 'feedback' : mode === 'support' ? 'support' : 'complaints'
  );

  useEffect(() => {
    if (mode === 'feedback') setSubView('feedback');
    else if (mode === 'complaints') setSubView('complaints');
    else if (mode === 'support') setSubView('support');
  }, [mode]);

  const [tickets, setTickets] = useState<any[]>([]);
  const [ticketMetrics, setTicketMetrics] = useState<TicketMetrics>(DEFAULT_TICKET_METRICS);
  const [feedbacks, setFeedbacks] = useState<FeedbackRecord[]>([]);
  const [feedbackMetrics, setFeedbackMetrics] = useState<FeedbackMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Ticket Filters
  const [ticketSearch, setTicketSearch] = useState('');
  const [debouncedTicketSearch, setDebouncedTicketSearch] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  useEffect(() => {
    const t = setTimeout(() => setDebouncedTicketSearch(ticketSearch.trim()), 220);
    return () => clearTimeout(t);
  }, [ticketSearch]);

  // Feedback Filters
  const [ratingFilter, setRatingFilter] = useState('all');
  const [fbStatusFilter, setFbStatusFilter] = useState('all');
  const [fbSearch, setFbSearch] = useState('');

  // Ticket Thread Modal
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [ticketReplies, setTicketReplies] = useState<any[]>([]);
  const [statusHistory, setStatusHistory] = useState<TicketStatusHistoryRecord[]>([]);
  const [replyMessage, setReplyMessage] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [editStatus, setEditStatus] = useState('open');
  const [editPriority, setEditPriority] = useState('normal');
  const [retryingReplyId, setRetryingReplyId] = useState<string | null>(null);

  // Feedback Detail & Reply Modal
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackRecord | null>(null);
  const [fbEditStatus, setFbEditStatus] = useState<'new' | 'reviewed' | 'responded' | 'resolved'>('new');
  const [fbAdminNotes, setFbAdminNotes] = useState('');
  const [fbReplyMessage, setFbReplyMessage] = useState('');
  const [fbIsInternal, setFbIsInternal] = useState(false);
  const [isSavingFb, setIsSavingFb] = useState(false);
  const [isReplyingFb, setIsReplyingFb] = useState(false);

  const loadData = useCallback(async () => {
    setIsLoading(true);
    try {
      if (subView === 'feedback') {
        const fbRes = await supportApi.adminGetFeedbacks({
          rating: ratingFilter,
          status: fbStatusFilter,
          search: fbSearch.trim(),
        });
        if (fbRes.success) {
          setFeedbacks(fbRes.feedbacks || []);
          if (fbRes.metrics) setFeedbackMetrics(fbRes.metrics);
        }
      } else {
        const ticketType = subView === 'complaints' ? 'complaint' : 'support';
        const params: Record<string, string> = { type: ticketType };
        if (categoryFilter !== 'all') params.category = categoryFilter;
        if (statusFilter !== 'all') params.status = statusFilter;
        if (priorityFilter !== 'all') params.priority = priorityFilter;
        if (debouncedTicketSearch) params.search = debouncedTicketSearch;

        const ticketsRes = await supportApi.adminGetTickets(params);
        if (ticketsRes.success) {
          setTickets(ticketsRes.tickets || []);
          setTicketMetrics(ticketsRes.metrics || DEFAULT_TICKET_METRICS);
        }
      }
    } catch (err: any) {
      toast.error('Support Query Error', err.message);
    } finally {
      setIsLoading(false);
    }
  }, [subView, categoryFilter, statusFilter, priorityFilter, debouncedTicketSearch, ratingFilter, fbStatusFilter, fbSearch, toast]);

  useEffect(() => {
    loadData();
  }, [loadData]);

  // Realtime sync on feedbacks / support_tickets / support_ticket_replies
  useEffect(() => {
    return subscribeAdminRealtimeEvent((detail) => {
      if (
        detail.table === 'feedbacks' ||
        detail.table === 'support_tickets' ||
        detail.table === 'support_ticket_replies' ||
        detail.table === 'all'
      ) {
        loadData();
      }
    });
  }, [loadData]);

  const handleOpenTicket = useCallback(async (ticket: any) => {
    setSelectedTicket(ticket);
    setEditStatus(ticket.status || 'open');
    setEditPriority(ticket.priority || 'normal');
    setStatusHistory([]);
    try {
      const res = await adminClient.getTicketDetails(ticket.id);
      if (res.success) {
        if (res.ticket) setSelectedTicket(res.ticket);
        setTicketReplies(res.replies || []);
        setStatusHistory(res.statusHistory || []);
      }
    } catch (e: any) {
      toast.error('Error', e.message);
    }
  }, [toast]);

  const handleOpenFeedback = useCallback((fb: FeedbackRecord) => {
    setSelectedFeedback(fb);
    setFbEditStatus(fb.status || 'new');
    setFbAdminNotes(fb.admin_notes || '');
    setFbReplyMessage('');
    setFbIsInternal(false);
  }, []);

  // Auto-open deep-linked record
  useEffect(() => {
    if (!focusRecordId) return;
    if (subView === 'feedback') {
      const found = feedbacks.find((f) => String(f.id) === String(focusRecordId));
      if (found) {
        handleOpenFeedback(found);
      }
      return;
    }

    const foundTicket = tickets.find((t) => String(t.id) === String(focusRecordId));
    if (foundTicket) {
      handleOpenTicket(foundTicket);
      return;
    }

    let cancelled = false;
    (async () => {
      try {
        const res = await adminClient.getTicketDetails(focusRecordId);
        if (!cancelled && res.success && res.ticket) {
          setSelectedTicket(res.ticket);
          setEditStatus(res.ticket.status || 'open');
          setEditPriority(res.ticket.priority || 'normal');
          setTicketReplies(res.replies || []);
          setStatusHistory(res.statusHistory || []);
        }
      } catch {
        // Ignore missing deep-linked record
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [focusRecordId, subView, feedbacks, tickets, handleOpenFeedback, handleOpenTicket]);

  const closeTicketModal = () => {
    setSelectedTicket(null);
    onClearFocusRecord?.();
  };

  const closeFeedbackModal = () => {
    setSelectedFeedback(null);
    onClearFocusRecord?.();
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!replyMessage.trim() || !selectedTicket) return;

    setIsSendingReply(true);
    try {
      const res = await adminClient.replySupportTicket(
        selectedTicket.id,
        replyMessage.trim(),
        isInternalNote
      );

      if (res.success) {
        toast.success(isInternalNote ? 'Internal Note Saved' : 'Reply Dispatched to User');
        setReplyMessage('');
        setIsInternalNote(false);
        const details = await adminClient.getTicketDetails(selectedTicket.id);
        if (details.success) {
          setSelectedTicket(details.ticket || selectedTicket);
          setEditStatus(details.ticket?.status || editStatus);
          setTicketReplies(details.replies || []);
          setStatusHistory(details.statusHistory || []);
        }
        await loadData();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsSendingReply(false);
    }
  };

  const handleRetryEmail = async (replyId: string) => {
    if (!selectedTicket) return;
    setRetryingReplyId(replyId);
    try {
      const res = await supportApi.adminRetryEmailReply(replyId);
      if (res.success) {
        toast.success('Email Sent', res.message);
      } else {
        toast.error('Email Retry Failed', res.message);
      }
      const details = await adminClient.getTicketDetails(selectedTicket.id);
      if (details.success) {
        setTicketReplies(details.replies || []);
      }
    } catch (err: any) {
      toast.error('Retry Failed', err.message);
    } finally {
      setRetryingReplyId(null);
    }
  };

  const handleUpdateTicketProps = async () => {
    if (!selectedTicket) return;
    try {
      const res = await adminClient.updateSupportTicket(selectedTicket.id, {
        status: editStatus,
        priority: editPriority,
      });
      if (res.success) {
        toast.success('Ticket Updated');
        const details = await adminClient.getTicketDetails(selectedTicket.id);
        if (details.success) {
          setSelectedTicket(details.ticket || { ...selectedTicket, status: editStatus, priority: editPriority });
          setStatusHistory(details.statusHistory || []);
        }
        await loadData();
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const handleUpdateFeedbackStatus = async () => {
    if (!selectedFeedback) return;
    setIsSavingFb(true);
    try {
      const res = await supportApi.adminUpdateFeedback(selectedFeedback.id, {
        status: fbEditStatus,
        admin_notes: fbAdminNotes,
      });
      if (res.success) {
        toast.success('Feedback Updated', 'Status and internal notes saved.');
        setSelectedFeedback(res.feedback);
        await loadData();
      }
    } catch (err: any) {
      toast.error('Update Failed', err.message);
    } finally {
      setIsSavingFb(false);
    }
  };

  const handleReplyFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFeedback || !fbReplyMessage.trim()) return;
    setIsReplyingFb(true);
    try {
      const res = await supportApi.adminReplyToFeedback(selectedFeedback.id, {
        message: fbReplyMessage.trim(),
        is_internal: fbIsInternal,
      });
      if (res.success) {
        toast.success(
          fbIsInternal ? 'Internal Note Saved' : 'Reply Sent to User',
          res.message
        );
        setSelectedFeedback(res.feedback);
        setFbEditStatus(res.feedback?.status || fbEditStatus);
        setFbAdminNotes(res.feedback?.admin_notes || fbAdminNotes);
        setFbReplyMessage('');
        await loadData();
      }
    } catch (err: any) {
      toast.error('Reply Failed', err.message);
    } finally {
      setIsReplyingFb(false);
    }
  };

  const ticketSectionTitle =
    subView === 'complaints' ? 'Complaints Queue' : 'Help & Support Requests';

  return (
    <div className="space-y-5">
      {/* Header / Mode Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        {mode === 'all' ? (
          <div className="flex items-center gap-2 flex-wrap">
            <button
              type="button"
              onClick={() => setSubView('complaints')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                subView === 'complaints'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50'
              }`}
            >
              <AlertOctagon className="w-3.5 h-3.5" />
              <span>Complaints</span>
            </button>

            <button
              type="button"
              onClick={() => setSubView('support')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                subView === 'support'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50'
              }`}
            >
              <LifeBuoy className="w-3.5 h-3.5" />
              <span>Help &amp; Support</span>
            </button>

            <button
              type="button"
              onClick={() => setSubView('feedback')}
              className={`inline-flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-semibold transition-all cursor-pointer whitespace-nowrap shrink-0 ${
                subView === 'feedback'
                  ? 'bg-emerald-600 text-white'
                  : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50'
              }`}
            >
              <Star className="w-3.5 h-3.5" />
              <span>Feedback &amp; Ratings</span>
            </button>
          </div>
        ) : (
          <div className="flex items-center gap-2.5">
            {subView === 'complaints' && <AlertOctagon className="w-4 h-4 text-rose-500" />}
            {subView === 'support' && <LifeBuoy className="w-4 h-4 text-sky-500" />}
            {subView === 'feedback' && <Star className="w-4 h-4 text-amber-500" />}
            <div>
              <h2 className="text-sm font-bold text-slate-900 dark:text-slate-100">
                {subView === 'feedback' ? 'User Feedback & Ratings' : ticketSectionTitle}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {subView === 'feedback'
                  ? 'Manage ratings, email responses, and internal staff review notes'
                  : subView === 'complaints'
                  ? 'Formal user complaints with SLA escalation, replies, and internal notes'
                  : 'General help inquiries separated cleanly from formal complaints and feedback'}
              </p>
            </div>
          </div>
        )}

        <button
          type="button"
          onClick={loadData}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-semibold transition-all cursor-pointer self-end sm:self-auto whitespace-nowrap shrink-0"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* ================= TICKETS VIEW (COMPLAINTS OR SUPPORT) ================= */}
      {(subView === 'complaints' || subView === 'support') && (
        <>
          {/* Ticket KPI Strip */}
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3">
            {[
              { label: 'Total', value: ticketMetrics.total, color: 'text-slate-900 dark:text-slate-100', target: 'all' },
              { label: 'Open', value: ticketMetrics.open, color: 'text-sky-600 dark:text-sky-400', target: 'open' },
              { label: 'Under Review', value: ticketMetrics.under_review ?? 0, color: 'text-indigo-600 dark:text-indigo-400', target: 'under_review' },
              { label: 'In Progress', value: ticketMetrics.in_progress, color: 'text-amber-600 dark:text-amber-400', target: 'in_progress' },
              { label: 'Resolved / Closed', value: (ticketMetrics.resolved || 0) + (ticketMetrics.closed || 0), color: 'text-emerald-600 dark:text-emerald-400', target: 'resolved' },
              { label: 'Urgent Active', value: ticketMetrics.urgent, color: 'text-rose-600 dark:text-rose-400', target: 'urgent' },
            ].map((stat) => (
              <button
                key={stat.label}
                type="button"
                onClick={() => {
                  if (stat.target === 'urgent') {
                    setPriorityFilter((p) => (p === 'urgent' ? 'all' : 'urgent'));
                  } else {
                    setStatusFilter((s) => (s === stat.target ? 'all' : stat.target));
                  }
                }}
                className="text-left p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 cursor-pointer transition-colors"
              >
                <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400 truncate">
                  {stat.label}
                </p>
                <p className={`text-xl font-bold mt-1 tabular-nums ${stat.color}`}>
                  {stat.value}
                </p>
              </button>
            ))}
          </div>

          {/* Ticket Filters */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col lg:flex-row items-stretch lg:items-center justify-between gap-3">
            <div className="relative flex-1 min-w-0">
              <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                value={ticketSearch}
                onChange={(e) => setTicketSearch(e.target.value)}
                placeholder="Search by ticket #, subject, user name, email..."
                className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
              />
            </div>

            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold"
              >
                <option value="all">All Categories</option>
                <option value="login">Login &amp; Auth</option>
                <option value="account">Account &amp; Profile</option>
                <option value="calculator">Calculator Issues</option>
                <option value="udhar">Udhar &amp; Debt</option>
                <option value="privacy">Privacy &amp; Deletion</option>
                <option value="bug">Bug Report</option>
                <option value="other">Other Inquiries</option>
              </select>

              <select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold"
              >
                <option value="all">All Statuses</option>
                <option value="open">Open</option>
                <option value="under_review">Under Review</option>
                <option value="in_progress">In Progress</option>
                <option value="waiting_user">Waiting on User</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>

              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold"
              >
                <option value="all">All Priorities</option>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          {/* Tickets Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                {ticketSectionTitle} ({tickets.length})
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Internal staff notes are strictly isolated from end users
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 uppercase text-[10px] border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">Ticket #</th>
                    <th className="py-3 px-3">User</th>
                    <th className="py-3 px-3">Category &amp; Subject</th>
                    <th className="py-3 px-3">Priority</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Created</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {isLoading && tickets.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        Loading records...
                      </td>
                    </tr>
                  ) : tickets.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        No records match the current filters.
                      </td>
                    </tr>
                  ) : (
                    tickets.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4 font-mono font-semibold text-indigo-600 dark:text-indigo-400 whitespace-nowrap">
                          #{t.ticket_number}
                        </td>

                        <td className="py-3 px-3">
                          <p className="font-semibold text-slate-900 dark:text-slate-100">{t.user_name || 'Customer'}</p>
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{t.user_email}</p>
                        </td>

                        <td className="py-3 px-3 max-w-md">
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                            {t.category}
                          </span>
                          <p className="font-semibold text-slate-800 dark:text-slate-200 truncate">{t.subject}</p>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${
                              t.priority === 'urgent'
                                ? 'bg-rose-100 text-rose-700 dark:bg-rose-950/60 dark:text-rose-300'
                                : t.priority === 'high'
                                ? 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                                : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                            }`}
                          >
                            {t.priority}
                          </span>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <span className="font-semibold capitalize text-slate-700 dark:text-slate-300">
                            {String(t.status || '').replace(/_/g, ' ')}
                          </span>
                        </td>

                        <td className="py-3 px-3 text-slate-500 dark:text-slate-400 text-[11px] whitespace-nowrap tabular-nums">
                          {new Date(t.created_at).toLocaleString()}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleOpenTicket(t)}
                            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                          >
                            Inspect &amp; Reply
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ================= FEEDBACK VIEW ================= */}
      {subView === 'feedback' && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3">
            <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Total Reviews</p>
              <p className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1 tabular-nums">
                {feedbackMetrics?.total ?? feedbacks.length}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Average Rating</p>
              <p className="text-xl font-bold text-amber-500 mt-1 flex items-center gap-1.5 tabular-nums">
                <span>{feedbackMetrics?.avg_rating ?? 0}</span>
                <Star className="w-4 h-4 fill-amber-400 text-amber-400" />
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">New / Pending</p>
              <p className="text-xl font-bold text-sky-600 mt-1 tabular-nums">
                {feedbackMetrics?.new_count ?? feedbacks.filter((f) => f.status === 'new').length}
              </p>
            </div>
            <div className="p-3.5 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
              <p className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">Responded / Resolved</p>
              <p className="text-xl font-bold text-emerald-600 mt-1 tabular-nums">
                {feedbackMetrics?.reviewed_count ?? feedbacks.filter((f) => f.status !== 'new').length}
              </p>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl p-4 flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-sm">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                <input
                  type="text"
                  value={fbSearch}
                  onChange={(e) => setFbSearch(e.target.value)}
                  placeholder="Search user, email, message..."
                  className="w-full pl-8 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>

              <select
                value={ratingFilter}
                onChange={(e) => setRatingFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold"
              >
                <option value="all">All Ratings</option>
                <option value="5">5 Stars</option>
                <option value="4">4 Stars</option>
                <option value="3">3 Stars</option>
                <option value="2">2 Stars</option>
                <option value="1">1 Star</option>
              </select>

              <select
                value={fbStatusFilter}
                onChange={(e) => setFbStatusFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold"
              >
                <option value="all">All Statuses</option>
                <option value="new">New</option>
                <option value="reviewed">Reviewed</option>
                <option value="responded">Responded</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="font-semibold text-slate-800 dark:text-slate-200">
                User Feedback Submissions ({feedbacks.length})
              </span>
              <span className="text-[11px] text-slate-500 dark:text-slate-400">
                Internal staff notes are never shared with users
              </span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-500 dark:text-slate-400 uppercase text-[10px] border-b border-slate-200 dark:border-slate-800">
                  <tr>
                    <th className="py-3 px-4">User</th>
                    <th className="py-3 px-3">Rating</th>
                    <th className="py-3 px-3">Category &amp; Message</th>
                    <th className="py-3 px-3">Status</th>
                    <th className="py-3 px-3">Submitted</th>
                    <th className="py-3 px-4 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {isLoading && feedbacks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        Loading feedback...
                      </td>
                    </tr>
                  ) : feedbacks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        No user feedback submissions found.
                      </td>
                    </tr>
                  ) : (
                    feedbacks.map((fb) => (
                      <tr key={fb.id} className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            <span>{fb.user_name || 'User'}</span>
                          </p>
                          <p className="text-[11px] font-mono text-slate-500 dark:text-slate-400">{fb.user_email}</p>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <div className="flex items-center gap-0.5 text-amber-400">
                            {[1, 2, 3, 4, 5].map((s) => (
                              <Star
                                key={s}
                                className={`w-3.5 h-3.5 ${
                                  s <= (fb.rating || 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-700'
                                }`}
                              />
                            ))}
                          </div>
                        </td>

                        <td className="py-3 px-3 max-w-md">
                          <span className="text-[10px] font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider block">
                            {fb.category || 'General Feedback'}
                          </span>
                          <p className="text-slate-700 dark:text-slate-300 line-clamp-2 mt-0.5">{fb.message}</p>
                        </td>

                        <td className="py-3 px-3 whitespace-nowrap">
                          <span
                            className={`px-2 py-0.5 rounded-md text-[10px] font-semibold uppercase ${
                              fb.status === 'resolved' || fb.status === 'responded'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : fb.status === 'reviewed'
                                ? 'bg-sky-100 text-sky-700 dark:bg-sky-950/60 dark:text-sky-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}
                          >
                            {fb.status}
                          </span>
                        </td>

                        <td className="py-3 px-3 text-slate-500 dark:text-slate-400 text-[11px] whitespace-nowrap tabular-nums">
                          {new Date(fb.created_at).toLocaleString()}
                        </td>

                        <td className="py-3 px-4 text-right whitespace-nowrap">
                          <button
                            type="button"
                            onClick={() => handleOpenFeedback(fb)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 text-xs font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0"
                          >
                            <Eye className="w-3.5 h-3.5" />
                            <span>View &amp; Reply</span>
                          </button>
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}

      {/* ================= TICKET THREAD MODAL ================= */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-3xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-emerald-600">#{selectedTicket.ticket_number}</span>
                  <span className="text-[11px] uppercase font-semibold text-slate-400">
                    {selectedTicket.ticket_type || 'support'} &middot; {selectedTicket.category}
                  </span>
                </div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-0.5">{selectedTicket.subject}</h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  {selectedTicket.user_name} ({selectedTicket.user_email})
                </p>
              </div>
              <button
                type="button"
                onClick={closeTicketModal}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-2.5 bg-slate-50 dark:bg-slate-800/60 p-3 rounded-xl text-xs border border-slate-200/80 dark:border-slate-800">
              <span className="font-semibold text-slate-500">Status:</span>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold"
              >
                <option value="open">Open</option>
                <option value="under_review">Under Review</option>
                <option value="in_progress">In Progress</option>
                <option value="waiting_user">Waiting on User</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>

              <span className="font-semibold text-slate-500 ml-1">Priority:</span>
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value)}
                className="px-2.5 py-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 rounded-lg font-semibold"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>

              <button
                type="button"
                onClick={handleUpdateTicketProps}
                className="ml-auto px-3 py-1.5 bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white font-semibold rounded-lg cursor-pointer whitespace-nowrap shrink-0"
              >
                Save Status
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 pr-1">
              {/* Original Submission */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-800 space-y-1.5">
                <div className="flex justify-between items-center text-[11px] text-slate-400">
                  <span className="font-semibold text-slate-700 dark:text-slate-300">
                    {selectedTicket.user_name} &middot; Original Submission
                  </span>
                  <span className="tabular-nums">{new Date(selectedTicket.created_at).toLocaleString()}</span>
                </div>
                <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {selectedTicket.description}
                </p>
              </div>

              {/* Replies & Internal Notes */}
              {ticketReplies.map((r) => (
                <div
                  key={r.id}
                  className={`p-4 rounded-xl border text-xs space-y-1.5 ${
                    r.is_internal
                      ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40'
                      : 'bg-emerald-50/50 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
                  }`}
                >
                  <div className="flex flex-wrap justify-between items-center gap-2 text-[11px]">
                    <span className="font-semibold flex items-center gap-1.5 text-slate-800 dark:text-slate-200">
                      {r.is_internal ? (
                        <Lock className="w-3 h-3 text-amber-600" />
                      ) : (
                        <MessageSquare className="w-3 h-3 text-emerald-600" />
                      )}
                      <span>{r.sender_name}</span>
                      <span className="uppercase text-[10px] text-slate-400">({r.sender_role})</span>
                      {r.is_internal ? (
                        <span className="text-[10px] font-semibold text-amber-700 dark:text-amber-300">
                          &middot; Internal staff note (hidden from user)
                        </span>
                      ) : (
                        <span className="text-[10px] text-slate-500">
                          &middot; Email: {r.email_status || 'sent'}
                        </span>
                      )}
                    </span>
                    <div className="flex items-center gap-2">
                      {!r.is_internal && r.email_status === 'failed' && (
                        <button
                          type="button"
                          disabled={retryingReplyId === r.id}
                          onClick={() => handleRetryEmail(r.id)}
                          className="inline-flex items-center gap-1 px-2 py-0.5 rounded bg-rose-100 text-rose-700 text-[10px] font-semibold cursor-pointer"
                        >
                          <RotateCcw className="w-3 h-3" />
                          <span>{retryingReplyId === r.id ? 'Retrying...' : 'Retry Email'}</span>
                        </button>
                      )}
                      <span className="text-slate-400 tabular-nums">{new Date(r.created_at).toLocaleString()}</span>
                    </div>
                  </div>
                  <p className="text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {r.message}
                  </p>
                </div>
              ))}

              {/* Status History Timeline */}
              {statusHistory.length > 0 && (
                <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 space-y-2">
                  <p className="text-[11px] font-semibold text-slate-600 dark:text-slate-300 flex items-center gap-1.5">
                    <History className="w-3.5 h-3.5 text-slate-400" />
                    <span>Status Audit Timeline</span>
                  </p>
                  <div className="space-y-1.5">
                    {statusHistory.map((h) => (
                      <div key={h.id} className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-slate-500 dark:text-slate-400">
                        <span>
                          {h.old_status ? `${h.old_status.replace(/_/g, ' ')} → ` : ''}
                          <strong className="text-slate-800 dark:text-slate-200 capitalize">
                            {String(h.new_status || '').replace(/_/g, ' ')}
                          </strong>
                          {h.changed_by_name ? ` by ${h.changed_by_name}` : ''}
                          {h.reason ? ` (${h.reason})` : ''}
                        </span>
                        <span className="tabular-nums">{new Date(h.created_at).toLocaleString()}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            <form onSubmit={handleSendReply} className="space-y-2.5 pt-3 border-t border-slate-200 dark:border-slate-800">
              <label className="inline-flex items-center gap-2 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-300">
                <input
                  type="checkbox"
                  checked={isInternalNote}
                  onChange={(e) => setIsInternalNote(e.target.checked)}
                  className="rounded text-amber-600"
                />
                <span>Internal staff note (never emailed or exposed to user)</span>
              </label>

              <textarea
                rows={3}
                placeholder={
                  isInternalNote
                    ? 'Write internal note for staff review...'
                    : 'Write customer reply (delivered via email and in-app notifications)...'
                }
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                required
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={closeTicketModal}
                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSendingReply}
                  className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-semibold cursor-pointer whitespace-nowrap shrink-0 ${
                    isInternalNote ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isSendingReply ? 'Sending...' : isInternalNote ? 'Save Internal Note' : 'Send User Reply'}</span>
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= FEEDBACK DETAIL & REPLY MODAL ================= */}
      {selectedFeedback && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-2xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-start justify-between pb-3 border-b border-slate-200 dark:border-slate-800">
              <div>
                <div className="flex items-center gap-2">
                  <span className="text-xs font-mono font-bold text-emerald-600">
                    FB-{String(selectedFeedback.id).slice(0, 8).toUpperCase()}
                  </span>
                  <div className="flex items-center gap-0.5">
                    {[1, 2, 3, 4, 5].map((s) => (
                      <Star
                        key={s}
                        className={`w-3.5 h-3.5 ${
                          s <= (selectedFeedback.rating || 0) ? 'fill-amber-400 text-amber-400' : 'text-slate-300 dark:text-slate-700'
                        }`}
                      />
                    ))}
                  </div>
                </div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 mt-0.5">
                  {selectedFeedback.subject || selectedFeedback.category || 'User Feedback'}
                </h3>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  From: {selectedFeedback.user_name} ({selectedFeedback.user_email}) &middot;{' '}
                  {new Date(selectedFeedback.created_at).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={closeFeedbackModal}
                className="p-1 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 pr-1">
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 space-y-1.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-600">User Message</span>
                <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {selectedFeedback.message}
                </p>
              </div>

              {selectedFeedback.admin_response && (
                <div className="p-4 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 border border-emerald-200 dark:border-emerald-800/40 space-y-1">
                  <span className="text-[10px] font-semibold uppercase tracking-wider text-emerald-700 dark:text-emerald-300">
                    Public Support Response Sent to User
                  </span>
                  <p className="text-xs text-slate-800 dark:text-slate-200 whitespace-pre-wrap">
                    {selectedFeedback.admin_response}
                  </p>
                </div>
              )}

              {/* Status & Internal Staff Notes */}
              <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200 dark:border-slate-800 space-y-3 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-semibold text-slate-600 dark:text-slate-300">Status:</span>
                  <select
                    value={fbEditStatus}
                    onChange={(e: any) => setFbEditStatus(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-semibold"
                  >
                    <option value="new">New</option>
                    <option value="reviewed">Reviewed</option>
                    <option value="responded">Responded</option>
                    <option value="resolved">Resolved</option>
                  </select>
                  <button
                    type="button"
                    disabled={isSavingFb}
                    onClick={handleUpdateFeedbackStatus}
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isSavingFb ? 'Saving...' : 'Save Status & Staff Notes'}</span>
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-semibold text-slate-500 mb-1">
                    Internal Staff Notes (Never emailed or visible to user)
                  </label>
                  <textarea
                    rows={2}
                    value={fbAdminNotes}
                    onChange={(e) => setFbAdminNotes(e.target.value)}
                    placeholder="Add internal review notes..."
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  />
                </div>
              </div>

              {/* Public Reply or Internal Log */}
              <form onSubmit={handleReplyFeedback} className="space-y-2.5 pt-2 border-t border-slate-200 dark:border-slate-800">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <label className="flex items-center gap-1.5 text-xs font-semibold text-slate-700 dark:text-slate-300">
                    <Mail className="w-3.5 h-3.5 text-emerald-600" />
                    <span>Reply to {selectedFeedback.user_email}</span>
                  </label>

                  <label className="flex items-center gap-1.5 cursor-pointer text-xs font-semibold text-slate-600 dark:text-slate-400">
                    <input
                      type="checkbox"
                      checked={fbIsInternal}
                      onChange={(e) => setFbIsInternal(e.target.checked)}
                      className="rounded text-amber-600"
                    />
                    <span>Internal staff note only (hidden from user)</span>
                  </label>
                </div>

                <textarea
                  rows={3}
                  required
                  value={fbReplyMessage}
                  onChange={(e) => setFbReplyMessage(e.target.value)}
                  placeholder={
                    fbIsInternal
                      ? 'Write internal staff note...'
                      : 'Write a public reply (emailed directly to the user and shown in their Help History)...'
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={closeFeedbackModal}
                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={isReplyingFb}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-semibold cursor-pointer disabled:opacity-50 whitespace-nowrap shrink-0 ${
                      fbIsInternal ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>
                      {isReplyingFb ? 'Sending...' : fbIsInternal ? 'Save Internal Note' : 'Send Email & Notification'}
                    </span>
                  </button>
                </div>
              </form>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
