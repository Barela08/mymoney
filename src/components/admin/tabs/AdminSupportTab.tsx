import React, { useState, useEffect, useCallback } from 'react';
import {
  MessageSquare,
  Send,
  RefreshCw,
  Clock,
  CheckCircle2,
  AlertTriangle,
  User,
  Eye,
  X,
  Lock,
  Star,
  Mail,
  Search,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { supportApi, FeedbackRecord, FeedbackMetrics } from '../../../lib/supportApi';
import { useToast } from '../../../context/ToastContext';

export const AdminSupportTab: React.FC = () => {
  const toast = useToast();
  const [subView, setSubView] = useState<'tickets' | 'feedback'>('tickets');
  const [tickets, setTickets] = useState<any[]>([]);
  const [feedbacks, setFeedbacks] = useState<FeedbackRecord[]>([]);
  const [feedbackMetrics, setFeedbackMetrics] = useState<FeedbackMetrics | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  // Ticket Filters
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [priorityFilter, setPriorityFilter] = useState('all');

  // Feedback Filters
  const [ratingFilter, setRatingFilter] = useState('all');
  const [fbStatusFilter, setFbStatusFilter] = useState('all');
  const [fbSearch, setFbSearch] = useState('');

  // Ticket Thread Modal
  const [selectedTicket, setSelectedTicket] = useState<any>(null);
  const [ticketReplies, setTicketReplies] = useState<any[]>([]);
  const [replyMessage, setReplyMessage] = useState('');
  const [isInternalNote, setIsInternalNote] = useState(false);
  const [isSendingReply, setIsSendingReply] = useState(false);
  const [editStatus, setEditStatus] = useState('open');
  const [editPriority, setEditPriority] = useState('normal');

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
      const [ticketsRes, fbRes] = await Promise.all([
        adminClient.getSupportTickets(categoryFilter, statusFilter, priorityFilter).catch(() => ({ success: false, tickets: [] })),
        supportApi
          .adminGetFeedbacks({
            rating: ratingFilter,
            status: fbStatusFilter,
            search: fbSearch.trim(),
          })
          .catch(() => ({ success: false, feedbacks: [], metrics: null })),
      ]);

      if (ticketsRes.success) {
        setTickets(ticketsRes.tickets || []);
      }
      if (fbRes.success) {
        setFeedbacks(fbRes.feedbacks || []);
        if (fbRes.metrics) setFeedbackMetrics(fbRes.metrics);
      }
    } catch (err: any) {
      toast.error('Support Query Error', err.message);
    } finally {
      setIsLoading(false);
    }
  }, [categoryFilter, statusFilter, priorityFilter, ratingFilter, fbStatusFilter, fbSearch, toast]);

  useEffect(() => {
    loadData();
  }, [loadData, subView]);

  const handleOpenTicket = async (ticket: any) => {
    setSelectedTicket(ticket);
    setEditStatus(ticket.status);
    setEditPriority(ticket.priority);
    try {
      const res = await adminClient.getTicketDetails(ticket.id);
      if (res.success) {
        setTicketReplies(res.replies || []);
      }
    } catch (e: any) {
      toast.error('Error', e.message);
    }
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
        if (details.success) setTicketReplies(details.replies || []);
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

  const handleUpdateTicketProps = async () => {
    if (!selectedTicket) return;
    try {
      const res = await adminClient.updateSupportTicket(selectedTicket.id, {
        status: editStatus,
        priority: editPriority,
      });
      if (res.success) {
        toast.success('Ticket Attributes Updated');
        setSelectedTicket({ ...selectedTicket, status: editStatus, priority: editPriority });
        await loadData();
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const handleOpenFeedback = (fb: FeedbackRecord) => {
    setSelectedFeedback(fb);
    setFbEditStatus(fb.status || 'new');
    setFbAdminNotes(fb.admin_notes || '');
    setFbReplyMessage('');
    setFbIsInternal(false);
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
        toast.success('Feedback Updated', 'Status and notes saved.');
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

  return (
    <div className="space-y-6">
      {/* Sub-view Switcher */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-200 dark:border-slate-800 pb-3">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setSubView('tickets')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              subView === 'tickets'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50'
            }`}
          >
            <MessageSquare className="w-3.5 h-3.5" />
            <span>Support &amp; Complaint Tickets ({tickets.length})</span>
          </button>

          <button
            type="button"
            onClick={() => setSubView('feedback')}
            className={`flex items-center gap-2 px-4 py-2.5 rounded-xl text-xs font-extrabold transition-all cursor-pointer ${
              subView === 'feedback'
                ? 'bg-emerald-600 text-white shadow-sm'
                : 'bg-white dark:bg-slate-900 text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-800 hover:bg-slate-50'
            }`}
          >
            <Star className="w-3.5 h-3.5" />
            <span>User Feedback &amp; Ratings ({feedbackMetrics?.total ?? feedbacks.length})</span>
          </button>
        </div>

        <button
          type="button"
          onClick={loadData}
          disabled={isLoading}
          className="inline-flex items-center gap-1.5 px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:bg-slate-100 dark:hover:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold transition-all cursor-pointer self-end sm:self-auto"
          title="Refresh Data"
        >
          <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          <span>Refresh</span>
        </button>
      </div>

      {/* ================= TICKETS VIEW ================= */}
      {subView === 'tickets' && (
        <>
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap">
              <select
                value={categoryFilter}
                onChange={(e) => setCategoryFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
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
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
              >
                <option value="all">All Statuses</option>
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="waiting_for_user">Waiting on User</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>

              <select
                value={priorityFilter}
                onChange={(e) => setPriorityFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
              >
                <option value="all">All Priorities</option>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>
            </div>
          </div>

          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                Support Tickets Queue ({tickets.length} Active)
              </span>
              <span className="text-slate-400">Strict separation of user complaints &amp; internal staff notes</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="p-3.5">Ticket #</th>
                    <th className="p-3.5">User</th>
                    <th className="p-3.5">Category &amp; Subject</th>
                    <th className="p-3.5">Priority</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Created Date</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {tickets.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-8 text-center text-slate-400">
                        No support tickets matching filters found.
                      </td>
                    </tr>
                  ) : (
                    tickets.map((t) => (
                      <tr key={t.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="p-3.5 font-mono font-bold text-indigo-600">#{t.ticket_number}</td>

                        <td className="p-3.5">
                          <p className="font-bold text-slate-800 dark:text-slate-200">{t.user_name || 'Customer'}</p>
                          <p className="text-[11px] font-mono text-slate-400">{t.user_email}</p>
                        </td>

                        <td className="p-3.5">
                          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                            {t.category}
                          </span>
                          <p className="font-semibold text-slate-700 dark:text-slate-300 max-w-sm truncate">{t.subject}</p>
                        </td>

                        <td className="p-3.5">
                          <span
                            className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              t.priority === 'urgent'
                                ? 'bg-rose-100 text-rose-700'
                                : t.priority === 'high'
                                ? 'bg-amber-100 text-amber-700'
                                : 'bg-slate-100 text-slate-700'
                            }`}
                          >
                            {t.priority}
                          </span>
                        </td>

                        <td className="p-3.5">
                          <span className="font-bold capitalize text-slate-700 dark:text-slate-300">
                            {String(t.status || '').replace(/_/g, ' ')}
                          </span>
                        </td>

                        <td className="p-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                          {new Date(t.created_at).toLocaleString()}
                        </td>

                        <td className="p-3.5 text-right">
                          <button
                            onClick={() => handleOpenTicket(t)}
                            className="px-3 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-xs font-bold rounded-xl cursor-pointer"
                          >
                            Reply &amp; Manage
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
          {/* Feedback Metrics */}
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-3 sm:gap-4">
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Total Reviews</p>
              <p className="text-2xl font-black text-slate-900 dark:text-slate-100 mt-1">
                {feedbackMetrics?.total ?? feedbacks.length}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Average Rating</p>
              <p className="text-2xl font-black text-amber-500 mt-1 flex items-center gap-1.5">
                <span>{feedbackMetrics?.avg_rating ?? 0}</span>
                <Star className="w-5 h-5 fill-amber-400 text-amber-400" />
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">New / Pending</p>
              <p className="text-2xl font-black text-blue-600 mt-1">
                {feedbackMetrics?.new_count ?? feedbacks.filter((f) => f.status === 'new').length}
              </p>
            </div>
            <div className="p-4 rounded-2xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm">
              <p className="text-[10px] font-bold uppercase tracking-wider text-slate-400">Responded / Resolved</p>
              <p className="text-2xl font-black text-emerald-600 mt-1">
                {feedbackMetrics?.reviewed_count ?? feedbacks.filter((f) => f.status !== 'new').length}
              </p>
            </div>
          </div>

          {/* Feedback Filters */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-5 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex items-center gap-2 flex-wrap flex-1">
              <div className="relative flex-1 min-w-[200px] max-w-xs">
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
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
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
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
              >
                <option value="all">All Statuses</option>
                <option value="new">New</option>
                <option value="reviewed">Reviewed</option>
                <option value="responded">Responded</option>
                <option value="resolved">Resolved</option>
              </select>
            </div>
          </div>

          {/* Feedback Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                User Feedback Submissions ({feedbacks.length})
              </span>
              <span className="text-slate-400">Confirmation email is sent automatically to the user on submit</span>
            </div>

            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="p-3.5">User</th>
                    <th className="p-3.5">Rating</th>
                    <th className="p-3.5">Category &amp; Message</th>
                    <th className="p-3.5">Status</th>
                    <th className="p-3.5">Submitted</th>
                    <th className="p-3.5 text-right">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {feedbacks.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="p-8 text-center text-slate-400">
                        No user feedback submissions found yet.
                      </td>
                    </tr>
                  ) : (
                    feedbacks.map((fb) => (
                      <tr key={fb.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                        <td className="p-3.5">
                          <p className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
                            <User className="w-3.5 h-3.5 text-slate-400" />
                            <span>{fb.user_name || 'User'}</span>
                          </p>
                          <p className="text-[11px] font-mono text-slate-400">{fb.user_email}</p>
                        </td>

                        <td className="p-3.5 whitespace-nowrap">
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

                        <td className="p-3.5 max-w-md">
                          <span className="text-[10px] font-bold text-emerald-600 uppercase tracking-wider block">
                            {fb.category || 'General Feedback'}
                          </span>
                          <p className="text-slate-700 dark:text-slate-300 line-clamp-2 mt-0.5">{fb.message}</p>
                        </td>

                        <td className="p-3.5">
                          <span
                            className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase ${
                              fb.status === 'resolved' || fb.status === 'responded'
                                ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-950/60 dark:text-emerald-300'
                                : fb.status === 'reviewed'
                                ? 'bg-blue-100 text-blue-700 dark:bg-blue-950/60 dark:text-blue-300'
                                : 'bg-amber-100 text-amber-700 dark:bg-amber-950/60 dark:text-amber-300'
                            }`}
                          >
                            {fb.status}
                          </span>
                        </td>

                        <td className="p-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                          <span className="inline-flex items-center gap-1">
                            <Clock className="w-3 h-3" />
                            {new Date(fb.created_at).toLocaleString()}
                          </span>
                        </td>

                        <td className="p-3.5 text-right">
                          <button
                            type="button"
                            onClick={() => handleOpenFeedback(fb)}
                            className="inline-flex items-center gap-1.5 px-3 py-1.5 bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/50 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 text-xs font-bold rounded-xl cursor-pointer"
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
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <span className="text-xs font-mono font-bold text-emerald-600">#{selectedTicket.ticket_number}</span>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">{selectedTicket.subject}</h3>
                <p className="text-xs text-slate-400">
                  Customer: {selectedTicket.user_name} ({selectedTicket.user_email})
                </p>
              </div>
              <button onClick={() => setSelectedTicket(null)} className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex items-center gap-3 bg-slate-50 dark:bg-slate-800/60 p-2.5 rounded-2xl text-xs">
              <span className="font-bold text-slate-500">Status:</span>
              <select
                value={editStatus}
                onChange={(e) => setEditStatus(e.target.value)}
                className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold"
              >
                <option value="open">Open</option>
                <option value="in_progress">In Progress</option>
                <option value="waiting_for_user">Waiting on User</option>
                <option value="resolved">Resolved</option>
                <option value="closed">Closed</option>
              </select>

              <span className="font-bold text-slate-500 ml-2">Priority:</span>
              <select
                value={editPriority}
                onChange={(e) => setEditPriority(e.target.value)}
                className="px-2 py-1 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-lg font-bold"
              >
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
                <option value="urgent">Urgent</option>
              </select>

              <button
                onClick={handleUpdateTicketProps}
                className="ml-auto px-3 py-1 bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 text-slate-800 dark:text-slate-200 font-bold rounded-lg cursor-pointer"
              >
                Update
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3 p-1">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800 space-y-1">
                <div className="flex justify-between items-center text-[11px] text-slate-400">
                  <span className="font-bold text-slate-700 dark:text-slate-300">{selectedTicket.user_name} (User)</span>
                  <span>{new Date(selectedTicket.created_at).toLocaleString()}</span>
                </div>
                <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {selectedTicket.description}
                </p>
              </div>

              {ticketReplies.map((r) => (
                <div
                  key={r.id}
                  className={`p-4 rounded-2xl border text-xs space-y-1 ${
                    r.is_internal
                      ? 'bg-amber-50/70 dark:bg-amber-950/20 border-amber-200 dark:border-amber-800/40'
                      : 'bg-emerald-50/60 dark:bg-emerald-950/20 border-emerald-200 dark:border-emerald-800/40'
                  }`}
                >
                  <div className="flex justify-between items-center text-[11px]">
                    <span className="font-bold flex items-center gap-1.5 text-slate-700 dark:text-slate-300">
                      {r.is_internal && <Lock className="w-3 h-3 text-amber-600" />}
                      <span>{r.sender_name}</span>
                      <span className="uppercase text-[9px] font-black text-slate-400">({r.sender_role})</span>
                    </span>
                    <span className="text-slate-400">{new Date(r.created_at).toLocaleString()}</span>
                  </div>
                  <p className="text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                    {r.message}
                  </p>
                </div>
              ))}
            </div>

            <form onSubmit={handleSendReply} className="space-y-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-3">
                <label className="flex items-center gap-1.5 cursor-pointer text-xs font-bold text-slate-600 dark:text-slate-400">
                  <input
                    type="checkbox"
                    checked={isInternalNote}
                    onChange={(e) => setIsInternalNote(e.target.checked)}
                    className="rounded text-amber-600"
                  />
                  <span>Internal Staff Note (Never emailed to user)</span>
                </label>
              </div>

              <textarea
                rows={3}
                placeholder={isInternalNote ? 'Write internal note for staff review...' : 'Write customer response (sent directly to user email)...'}
                value={replyMessage}
                onChange={(e) => setReplyMessage(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                required
              />

              <div className="flex items-center justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setSelectedTicket(null)}
                  className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                >
                  Close
                </button>
                <button
                  type="submit"
                  disabled={isSendingReply}
                  className={`px-4 py-2 rounded-xl text-white text-xs font-bold shadow-md cursor-pointer ${
                    isInternalNote ? 'bg-amber-600 hover:bg-amber-700' : 'bg-emerald-600 hover:bg-emerald-700'
                  }`}
                >
                  {isSendingReply ? 'Sending...' : isInternalNote ? 'Save Internal Note' : 'Send User Reply'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* ================= FEEDBACK DETAIL & REPLY MODAL ================= */}
      {selectedFeedback && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
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
                <p className="text-xs text-slate-400">
                  From: {selectedFeedback.user_name} ({selectedFeedback.user_email}) · {new Date(selectedFeedback.created_at).toLocaleString()}
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFeedback(null)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-4 p-1">
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-100 dark:border-slate-800 space-y-1.5">
                <span className="text-[10px] font-bold uppercase tracking-wider text-emerald-600">User Message</span>
                <p className="text-xs text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {selectedFeedback.message}
                </p>
              </div>

              {/* Status & Internal Notes */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/30 border border-slate-200/70 dark:border-slate-800 space-y-3 text-xs">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="font-bold text-slate-600 dark:text-slate-300">Status:</span>
                  <select
                    value={fbEditStatus}
                    onChange={(e: any) => setFbEditStatus(e.target.value)}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 font-bold"
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
                    className="ml-auto inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-700 hover:bg-slate-800 text-white font-bold cursor-pointer disabled:opacity-50"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    <span>{isSavingFb ? 'Saving...' : 'Save Status & Notes'}</span>
                  </button>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Admin Notes / Log</label>
                  <textarea
                    rows={2}
                    value={fbAdminNotes}
                    onChange={(e) => setFbAdminNotes(e.target.value)}
                    placeholder="Add review notes..."
                    className="w-full px-3 py-2 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-700 text-xs"
                  />
                </div>
              </div>

              {/* Reply to User via Email + In-App */}
              <form onSubmit={handleReplyFeedback} className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="flex items-center gap-1.5 text-xs font-bold text-slate-700 dark:text-slate-300">
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
                    <span>Internal note only (no email)</span>
                  </label>
                </div>

                <textarea
                  rows={3}
                  required
                  value={fbReplyMessage}
                  onChange={(e) => setFbReplyMessage(e.target.value)}
                  placeholder={
                    fbIsInternal
                      ? 'Write internal review note...'
                      : 'Write a thank-you or follow-up reply (emailed directly to the user and shown in their Notification Center)...'
                  }
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />

                <div className="flex items-center justify-end gap-2">
                  <button
                    type="button"
                    onClick={() => setSelectedFeedback(null)}
                    className="px-4 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-semibold cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    type="submit"
                    disabled={isReplyingFb}
                    className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-xl text-white text-xs font-bold shadow-md cursor-pointer disabled:opacity-50 ${
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

      {/* Unused icon import safeguard */}
      <span className="hidden">
        <AlertTriangle className="w-0 h-0" />
      </span>
    </div>
  );
};
