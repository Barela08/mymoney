import React, { useState, useEffect } from 'react';
import {
  AlertOctagon,
  HelpCircle,
  Search,
  RefreshCw,
  Eye,
  Mail,
  Lock,
  Send,
  User,
  Paperclip,
  CheckCircle2,
  Clock,
  RotateCcw,
  AlertTriangle,
  UserCheck,
  Shield,
  Tag,
  ChevronDown,
} from 'lucide-react';
import {
  supportApi,
  SupportTicketRecord,
  SupportTicketReplyRecord,
  TicketStatusHistoryRecord,
  TicketMetrics,
} from '../../lib/supportApi';
import { useToast } from '../../context/ToastContext';
import { formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';

interface AdminTicketsSectionProps {
  ticketType: 'complaint' | 'support';
}

export const AdminTicketsSection: React.FC<AdminTicketsSectionProps> = ({ ticketType }) => {
  const toast = useToast();
  const isComplaint = ticketType === 'complaint';

  const [tickets, setTickets] = useState<SupportTicketRecord[]>([]);
  const [metrics, setMetrics] = useState<TicketMetrics>({
    total: 0,
    open: 0,
    in_progress: 0,
    waiting_user: 0,
    resolved: 0,
    closed: 0,
    urgent: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filters
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [priorityFilter, setPriorityFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected Ticket for Detail Modal
  const [selectedTicket, setSelectedTicket] = useState<SupportTicketRecord | null>(null);
  const [ticketReplies, setTicketReplies] = useState<SupportTicketReplyRecord[]>([]);
  const [statusHistory, setStatusHistory] = useState<TicketStatusHistoryRecord[]>([]);
  const [isLoadingDetails, setIsLoadingDetails] = useState<boolean>(false);

  // Reply Composer State
  const [replyMessage, setReplyMessage] = useState<string>('');
  const [isInternalNote, setIsInternalNote] = useState<boolean>(false);
  const [replyStatusTransition, setReplyStatusTransition] = useState<string>('');
  const [isSubmittingReply, setIsSubmittingReply] = useState<boolean>(false);

  // Attribute Update States
  const [targetPriority, setTargetPriority] = useState<string>('');
  const [targetStatus, setTargetStatus] = useState<string>('');
  const [targetAssignee, setTargetAssignee] = useState<string>('');
  const [statusChangeReason, setStatusChangeReason] = useState<string>('');
  const [isUpdatingAttributes, setIsUpdatingAttributes] = useState<boolean>(false);
  const [retryingReplyId, setRetryingReplyId] = useState<string | null>(null);

  useEffect(() => {
    loadTickets();
  }, [ticketType, statusFilter, priorityFilter, categoryFilter]);

  const loadTickets = async () => {
    try {
      setIsLoading(true);
      const params: Record<string, string> = { type: ticketType };
      if (statusFilter !== 'all') params.status = statusFilter;
      if (priorityFilter !== 'all') params.priority = priorityFilter;
      if (categoryFilter !== 'all') params.category = categoryFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await supportApi.adminGetTickets(params);
      if (res.success) {
        setTickets(res.tickets || []);
        if (res.metrics) setMetrics(res.metrics);
      }
    } catch (err: any) {
      toast.error(`Failed to Load ${isComplaint ? 'Complaints' : 'Tickets'}`, err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadTickets();
  };

  const handleOpenTicket = async (ticket: SupportTicketRecord) => {
    setSelectedTicket(ticket);
    setTargetPriority(ticket.priority);
    setTargetStatus(ticket.status);
    setTargetAssignee(ticket.assigned_to || '');
    setReplyStatusTransition(ticket.status === 'open' ? 'in_progress' : ticket.status);
    setReplyMessage('');
    setIsInternalNote(false);

    try {
      setIsLoadingDetails(true);
      const res = await supportApi.adminGetTicketDetails(ticket.id);
      if (res.success) {
        setSelectedTicket(res.ticket);
        setTicketReplies(res.replies || []);
        setStatusHistory(res.statusHistory || []);
      }
    } catch (err: any) {
      toast.error('Could not load ticket details', err.message);
    } finally {
      setIsLoadingDetails(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedTicket || !replyMessage.trim()) return;

    try {
      setIsSubmittingReply(true);
      const res = await supportApi.adminReplyToTicket(selectedTicket.id, {
        message: replyMessage.trim(),
        is_internal: isInternalNote,
        status: replyStatusTransition || undefined,
      });

      if (res.success) {
        toast.success(
          isInternalNote ? 'Internal Note Saved' : 'Reply Dispatched',
          res.message
        );
        setReplyMessage('');
        // Refresh details
        const refreshed = await supportApi.adminGetTicketDetails(selectedTicket.id);
        if (refreshed.success) {
          setSelectedTicket(refreshed.ticket);
          setTicketReplies(refreshed.replies || []);
          setStatusHistory(refreshed.statusHistory || []);
        }
        loadTickets();
      }
    } catch (err: any) {
      toast.error('Reply Failed', err.message);
    } finally {
      setIsSubmittingReply(false);
    }
  };

  const handleUpdateAttributes = async () => {
    if (!selectedTicket) return;

    try {
      setIsUpdatingAttributes(true);
      const res = await supportApi.adminUpdateTicket(selectedTicket.id, {
        priority: targetPriority || undefined,
        status: targetStatus || undefined,
        assigned_to: targetAssignee || undefined,
        reason: statusChangeReason.trim() || undefined,
      });

      if (res.success) {
        toast.success('Ticket Updated', res.message);
        setStatusChangeReason('');
        // Refresh details
        const refreshed = await supportApi.adminGetTicketDetails(selectedTicket.id);
        if (refreshed.success) {
          setSelectedTicket(refreshed.ticket);
          setTicketReplies(refreshed.replies || []);
          setStatusHistory(refreshed.statusHistory || []);
        }
        loadTickets();
      }
    } catch (err: any) {
      toast.error('Update Failed', err.message);
    } finally {
      setIsUpdatingAttributes(false);
    }
  };

  const handleRetryEmail = async (replyId: string) => {
    try {
      setRetryingReplyId(replyId);
      const res = await supportApi.adminRetryEmailReply(replyId);
      if (res.success) {
        toast.success('Email Dispatched', res.message);
      } else {
        toast.error('Retry Failed', res.message);
      }
      if (selectedTicket) {
        const refreshed = await supportApi.adminGetTicketDetails(selectedTicket.id);
        if (refreshed.success) setTicketReplies(refreshed.replies || []);
      }
    } catch (err: any) {
      toast.error('Retry Error', err.message);
    } finally {
      setRetryingReplyId(null);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 1. DASHBOARD METRICS */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-7 gap-3">
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm col-span-2 sm:col-span-1">
          <p className="text-[10px] font-bold text-slate-500 uppercase tracking-wider">
            Total {isComplaint ? 'Complaints' : 'Tickets'}
          </p>
          <p className="text-2xl font-black text-slate-900 dark:text-white mt-1">
            {metrics.total}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 uppercase">
            Open
          </span>
          <p className="text-xl font-black text-blue-600 dark:text-blue-400 mt-1">
            {metrics.open}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 uppercase">
            In Progress
          </span>
          <p className="text-xl font-black text-amber-600 dark:text-amber-400 mt-1">
            {metrics.in_progress}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300 uppercase">
            Waiting User
          </span>
          <p className="text-xl font-black text-purple-600 dark:text-purple-400 mt-1">
            {metrics.waiting_user}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 uppercase">
            Resolved
          </span>
          <p className="text-xl font-black text-emerald-600 dark:text-emerald-400 mt-1">
            {metrics.resolved}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 uppercase">
            Closed
          </span>
          <p className="text-xl font-black text-slate-700 dark:text-slate-300 mt-1">
            {metrics.closed}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-bold px-2 py-0.5 rounded bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 uppercase">
            Urgent
          </span>
          <p className="text-xl font-black text-rose-600 dark:text-rose-400 mt-1">
            {metrics.urgent}
          </p>
        </div>
      </div>

      {/* 2. SEARCH & FILTERS BAR */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder={`Search by Ticket #, subject, user name, email, or message...`}
            className="w-full pl-10 pr-4 py-2 text-xs rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Status Filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Statuses</option>
            <option value="open">Open</option>
            <option value="in_progress">In Progress</option>
            <option value="waiting_user">Waiting for User</option>
            <option value="resolved">Resolved</option>
            <option value="closed">Closed</option>
          </select>

          {/* Priority Filter */}
          <select
            value={priorityFilter}
            onChange={(e) => setPriorityFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Priorities</option>
            <option value="urgent">Urgent</option>
            <option value="high">High</option>
            <option value="normal">Normal</option>
            <option value="low">Low</option>
          </select>

          <button
            type="button"
            onClick={loadTickets}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 3. TABLE */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-slate-500">
            Loading {isComplaint ? 'complaints' : 'support tickets'}...
          </div>
        ) : tickets.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            {isComplaint ? (
              <AlertOctagon className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
            ) : (
              <HelpCircle className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
            )}
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              No {isComplaint ? 'complaints' : 'support tickets'} found
            </p>
            <p className="text-xs text-slate-400">
              There are no records matching your current filter criteria.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3.5">ID</th>
                  <th className="px-4 py-3.5">User</th>
                  <th className="px-4 py-3.5">Subject &amp; Category</th>
                  <th className="px-4 py-3.5">Priority</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-4 py-3.5">Created</th>
                  <th className="px-4 py-3.5">Assigned</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {tickets.map((t) => (
                  <tr
                    key={t.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="px-5 py-3.5 whitespace-nowrap font-mono font-bold text-slate-900 dark:text-white">
                      #{t.ticket_number}
                    </td>

                    <td className="px-4 py-3.5">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {t.user_name}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {t.user_email}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 max-w-xs">
                      <div className="font-semibold text-slate-800 dark:text-slate-200 line-clamp-1">
                        {t.subject}
                      </div>
                      <span className="text-[10px] text-slate-400">
                        {t.category}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold uppercase text-[10px] tracking-wide ${
                          t.priority === 'urgent'
                            ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                            : t.priority === 'high'
                            ? 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300'
                            : t.priority === 'normal'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        {t.priority}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold uppercase text-[10px] tracking-wide ${
                          t.status === 'open'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : t.status === 'in_progress'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : t.status === 'waiting_user'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {t.status.replace('_', ' ')}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap text-slate-500 text-[11px]">
                      {formatDisplayDate(t.created_at)}
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap text-slate-500 text-[11px]">
                      {t.assigned_to || <span className="italic text-slate-400">Unassigned</span>}
                    </td>

                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => handleOpenTicket(t)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-900 dark:bg-white text-white dark:text-slate-900 font-bold hover:opacity-90 transition-all cursor-pointer"
                      >
                        <Eye className="w-3.5 h-3.5" />
                        <span>Manage</span>
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* 4. DETAIL / MANAGEMENT MODAL */}
      {selectedTicket && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm animate-fade-in overflow-y-auto">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-4xl w-full max-h-[92vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden my-auto">
            {/* Modal Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-mono text-sm font-bold px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200">
                    #{selectedTicket.ticket_number}
                  </span>
                  <span className="text-[10px] uppercase font-bold px-2 py-0.5 rounded bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300">
                    {selectedTicket.ticket_type}
                  </span>
                </div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white mt-1">
                  {selectedTicket.subject}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setSelectedTicket(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Modal Content: 2-column layout (Left: Conversation & Reply; Right: Status Controls & History) */}
            <div className="flex-1 overflow-y-auto p-5 grid grid-cols-1 lg:grid-cols-3 gap-6 text-xs">
              {/* Left Column: Conversation Thread & Reply Composer (2 cols) */}
              <div className="lg:col-span-2 space-y-5">
                {/* Initial Description Card */}
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                  <div className="flex justify-between items-start text-xs">
                    <div>
                      <strong className="text-slate-900 dark:text-white block">
                        {selectedTicket.user_name}
                      </strong>
                      <span className="text-slate-400 font-mono text-[11px]">
                        {selectedTicket.user_email}
                      </span>
                    </div>
                    <span className="text-slate-400 text-[11px]">
                      {formatDisplayDate(selectedTicket.created_at)} at {formatDisplayTime(selectedTicket.created_at)}
                    </span>
                  </div>

                  <p className="text-slate-800 dark:text-slate-200 whitespace-pre-wrap leading-relaxed pt-1">
                    {selectedTicket.description}
                  </p>

                  {selectedTicket.attachment_url && (
                    <div className="pt-2 border-t border-slate-200 dark:border-slate-800">
                      <a
                        href={selectedTicket.attachment_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center gap-1.5 text-xs text-emerald-600 hover:underline"
                      >
                        <Paperclip className="w-3.5 h-3.5" />
                        <span>View Attachment / Evidence</span>
                      </a>
                    </div>
                  )}
                </div>

                {/* Conversation Timeline */}
                <div className="space-y-3">
                  <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400">
                    Communication Timeline ({ticketReplies.length})
                  </h4>

                  {ticketReplies.length === 0 ? (
                    <p className="text-xs text-slate-400 italic p-3 rounded-xl bg-slate-50 dark:bg-slate-950">
                      No replies logged yet. Use the composer below to reply to the user or record an internal note.
                    </p>
                  ) : (
                    ticketReplies.map((r) => (
                      <div
                        key={r.id}
                        className={`rounded-2xl p-4 space-y-1.5 border transition-all ${
                          r.is_internal
                            ? 'bg-amber-50/70 dark:bg-amber-950/30 border-amber-200 dark:border-amber-900 text-amber-950 dark:text-amber-100'
                            : r.sender_type === 'admin'
                            ? 'bg-emerald-50/60 dark:bg-emerald-950/40 border-emerald-200 dark:border-emerald-800 text-slate-800 dark:text-slate-200'
                            : 'bg-indigo-50/60 dark:bg-indigo-950/40 border-indigo-200 dark:border-indigo-800 text-slate-800 dark:text-slate-200'
                        }`}
                      >
                        <div className="flex items-center justify-between text-[11px]">
                          <div className="flex items-center gap-2">
                            <span className="font-bold">
                              {r.sender_name}
                            </span>
                            <span
                              className={`px-1.5 py-0.5 rounded text-[10px] font-bold uppercase ${
                                r.is_internal
                                  ? 'bg-amber-200 text-amber-900 dark:bg-amber-900 dark:text-amber-200'
                                  : r.sender_type === 'admin'
                                  ? 'bg-emerald-200 text-emerald-900 dark:bg-emerald-900 dark:text-emerald-200'
                                  : 'bg-indigo-200 text-indigo-900 dark:bg-indigo-900 dark:text-indigo-200'
                              }`}
                            >
                              {r.is_internal ? '🔒 Internal Note' : (r.sender_type === 'admin' ? 'Support Specialist' : 'User')}
                            </span>
                          </div>

                          <div className="flex items-center gap-2 text-slate-400">
                            {/* Email delivery status badge if external admin reply */}
                            {!r.is_internal && r.sender_type === 'admin' && (
                              <span
                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
                                  r.email_status === 'sent'
                                    ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                    : r.email_status === 'failed'
                                    ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                                    : 'bg-slate-100 text-slate-600'
                                }`}
                              >
                                Email: {r.email_status}
                              </span>
                            )}
                            <span>{formatDisplayDate(r.created_at)} {formatDisplayTime(r.created_at)}</span>
                          </div>
                        </div>

                        <p className="whitespace-pre-wrap leading-relaxed text-xs sm:text-sm">
                          {r.message}
                        </p>

                        {/* Retry button if email failed */}
                        {r.email_status === 'failed' && (
                          <div className="pt-1 flex items-center justify-between text-[11px] text-rose-600">
                            <span>Delivery notice: {r.delivery_error || 'SMTP failed'}</span>
                            <button
                              type="button"
                              disabled={retryingReplyId === r.id}
                              onClick={() => handleRetryEmail(r.id)}
                              className="px-2.5 py-1 rounded-lg bg-rose-600 text-white font-bold hover:bg-rose-700 cursor-pointer flex items-center gap-1"
                            >
                              <RotateCcw className={`w-3 h-3 ${retryingReplyId === r.id ? 'animate-spin' : ''}`} />
                              <span>{retryingReplyId === r.id ? 'Retrying...' : 'Retry Email'}</span>
                            </button>
                          </div>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Reply Composer Form */}
                <form onSubmit={handleSendReply} className="space-y-3 pt-3 border-t border-slate-200 dark:border-slate-800">
                  <div className="flex items-center justify-between">
                    <span className="font-bold text-slate-800 dark:text-slate-200">
                      Compose Response
                    </span>

                    {/* Mode Toggle */}
                    <div className="inline-flex rounded-xl p-0.5 bg-slate-100 dark:bg-slate-800 text-[11px]">
                      <button
                        type="button"
                        onClick={() => setIsInternalNote(false)}
                        className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                          !isInternalNote
                            ? 'bg-emerald-600 text-white shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Mail className="w-3 h-3" />
                        <span>Reply to User (Email)</span>
                      </button>
                      <button
                        type="button"
                        onClick={() => setIsInternalNote(true)}
                        className={`px-3 py-1 rounded-lg font-bold flex items-center gap-1.5 transition-all cursor-pointer ${
                          isInternalNote
                            ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900 shadow-sm'
                            : 'text-slate-500 hover:text-slate-800'
                        }`}
                      >
                        <Lock className="w-3 h-3" />
                        <span>Internal Note</span>
                      </button>
                    </div>
                  </div>

                  <textarea
                    rows={4}
                    value={replyMessage}
                    onChange={(e) => setReplyMessage(e.target.value)}
                    placeholder={
                      isInternalNote
                        ? 'Write a confidential internal note (only visible to admins, never emailed)...'
                        : `Write response to ${selectedTicket.user_name} (an official email will be dispatched to ${selectedTicket.user_email})...`
                    }
                    required
                    className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  />

                  <div className="flex flex-col sm:flex-row items-stretch sm:items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <span className="text-[11px] text-slate-400">Set Status on Reply:</span>
                      <select
                        value={replyStatusTransition}
                        onChange={(e) => setReplyStatusTransition(e.target.value)}
                        className="px-2.5 py-1 rounded-lg border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 text-xs font-semibold"
                      >
                        <option value="in_progress">In Progress</option>
                        <option value="waiting_user">Waiting for User</option>
                        <option value="resolved">Resolved</option>
                        <option value="closed">Closed</option>
                      </select>
                    </div>

                    <button
                      type="submit"
                      disabled={isSubmittingReply || !replyMessage.trim()}
                      className={`px-6 py-2.5 rounded-xl text-xs font-bold text-white transition-all cursor-pointer shadow-md flex items-center justify-center gap-1.5 disabled:opacity-50 ${
                        isInternalNote
                          ? 'bg-slate-800 hover:bg-slate-900'
                          : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                      }`}
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>{isSubmittingReply ? 'Dispatching...' : (isInternalNote ? 'Save Internal Note' : 'Send Email Reply')}</span>
                    </button>
                  </div>
                </form>
              </div>

              {/* Right Column: Status, Priority, Staff Assignment & History (1 col) */}
              <div className="space-y-4 lg:border-l lg:border-slate-200 dark:lg:border-slate-800 lg:pl-5">
                <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3">
                  <h4 className="font-bold text-slate-900 dark:text-white uppercase tracking-wider text-[11px]">
                    Ticket Controls
                  </h4>

                  {/* Status Dropdown */}
                  <div>
                    <label className="block text-slate-500 text-[11px] font-semibold mb-1">
                      Status
                    </label>
                    <select
                      value={targetStatus}
                      onChange={(e) => setTargetStatus(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-xs font-bold"
                    >
                      <option value="open">Open</option>
                      <option value="in_progress">In Progress</option>
                      <option value="waiting_user">Waiting for User</option>
                      <option value="resolved">Resolved</option>
                      <option value="closed">Closed</option>
                    </select>
                  </div>

                  {/* Priority Dropdown */}
                  <div>
                    <label className="block text-slate-500 text-[11px] font-semibold mb-1">
                      Priority
                    </label>
                    <select
                      value={targetPriority}
                      onChange={(e) => setTargetPriority(e.target.value)}
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-xs font-bold"
                    >
                      <option value="low">Low</option>
                      <option value="normal">Normal</option>
                      <option value="high">High</option>
                      <option value="urgent">Urgent</option>
                    </select>
                  </div>

                  {/* Assignee Input */}
                  <div>
                    <label className="block text-slate-500 text-[11px] font-semibold mb-1">
                      Assigned Staff
                    </label>
                    <input
                      type="text"
                      value={targetAssignee}
                      onChange={(e) => setTargetAssignee(e.target.value)}
                      placeholder="e.g. Nilesh (Support Lead)"
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-xs"
                    />
                  </div>

                  {/* Reason for Change */}
                  <div>
                    <label className="block text-slate-500 text-[11px] font-semibold mb-1">
                      Reason for Change (Logged in Audit)
                    </label>
                    <input
                      type="text"
                      value={statusChangeReason}
                      onChange={(e) => setStatusChangeReason(e.target.value)}
                      placeholder="Optional reason..."
                      className="w-full px-3 py-1.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-800 dark:text-slate-200 text-xs"
                    />
                  </div>

                  <button
                    type="button"
                    disabled={isUpdatingAttributes}
                    onClick={handleUpdateAttributes}
                    className="w-full py-2 rounded-xl text-xs font-bold text-white bg-slate-900 dark:bg-white dark:text-slate-900 hover:opacity-90 cursor-pointer shadow-sm disabled:opacity-50"
                  >
                    {isUpdatingAttributes ? 'Saving...' : 'Update Ticket Controls'}
                  </button>
                </div>

                {/* Status History Audit */}
                <div className="space-y-2">
                  <h4 className="font-bold text-slate-500 uppercase tracking-wider text-[10px]">
                    Status History Audit ({statusHistory.length})
                  </h4>
                  {statusHistory.length === 0 ? (
                    <p className="text-[11px] text-slate-400 italic">No previous status changes.</p>
                  ) : (
                    <div className="space-y-2 max-h-48 overflow-y-auto pr-1">
                      {statusHistory.map((h) => (
                        <div
                          key={h.id}
                          className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-[11px] space-y-0.5"
                        >
                          <div className="flex justify-between font-bold text-slate-700 dark:text-slate-300">
                            <span>{h.old_status || 'init'} &rarr; {h.new_status}</span>
                            <span className="text-[10px] text-slate-400 font-normal">{formatDisplayDate(h.created_at)}</span>
                          </div>
                          {h.changed_by_name && (
                            <p className="text-slate-500 text-[10px]">By: {h.changed_by_name}</p>
                          )}
                          {h.reason && (
                            <p className="text-slate-400 text-[10px] italic">&ldquo;{h.reason}&rdquo;</p>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
