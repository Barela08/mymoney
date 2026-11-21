import React, { useState, useEffect } from 'react';
import {
  Star,
  Search,
  Filter,
  CheckCircle2,
  RefreshCw,
  Send,
  MessageSquare,
  Mail,
  Lock,
  User,
  Calendar,
  AlertCircle,
  Eye,
} from 'lucide-react';
import { supportApi, FeedbackRecord, FeedbackMetrics } from '../../lib/supportApi';
import { useToast } from '../../context/ToastContext';
import { formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';

const STAR_LABELS: Record<number, string> = {
  1: 'Poor',
  2: 'Needs Improvement',
  3: 'Average',
  4: 'Good',
  5: 'Excellent',
};

export const AdminFeedbackSection: React.FC = () => {
  const toast = useToast();

  const [feedbacks, setFeedbacks] = useState<FeedbackRecord[]>([]);
  const [metrics, setMetrics] = useState<FeedbackMetrics>({
    total: 0,
    avg_rating: 0,
    stars_5: 0,
    stars_4: 0,
    stars_3: 0,
    stars_2: 0,
    stars_1: 0,
    new_count: 0,
    reviewed_count: 0,
    resolved_count: 0,
  });
  const [isLoading, setIsLoading] = useState<boolean>(true);

  // Filters
  const [ratingFilter, setRatingFilter] = useState<string>('all');
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [categoryFilter, setCategoryFilter] = useState<string>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Selected feedback for detail / reply modal
  const [selectedFeedback, setSelectedFeedback] = useState<FeedbackRecord | null>(null);
  const [replyMessage, setReplyMessage] = useState<string>('');
  const [isInternalNote, setIsInternalNote] = useState<boolean>(false);
  const [isSubmittingReply, setIsSubmittingReply] = useState<boolean>(false);
  const [isUpdatingStatus, setIsUpdatingStatus] = useState<boolean>(false);

  useEffect(() => {
    loadFeedbacks();
  }, [ratingFilter, statusFilter, categoryFilter]);

  const loadFeedbacks = async () => {
    try {
      setIsLoading(true);
      const params: Record<string, string> = {};
      if (ratingFilter !== 'all') params.rating = ratingFilter;
      if (statusFilter !== 'all') params.status = statusFilter;
      if (categoryFilter !== 'all') params.category = categoryFilter;
      if (searchQuery.trim()) params.search = searchQuery.trim();

      const res = await supportApi.adminGetFeedbacks(params);
      if (res.success) {
        setFeedbacks(res.feedbacks || []);
        if (res.metrics) setMetrics(res.metrics);
      }
    } catch (err: any) {
      toast.error('Failed to Load Feedbacks', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSearchSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    loadFeedbacks();
  };

  const handleUpdateStatus = async (feedbackId: string, newStatus: 'new' | 'reviewed' | 'responded' | 'resolved') => {
    try {
      setIsUpdatingStatus(true);
      const res = await supportApi.adminUpdateFeedback(feedbackId, { status: newStatus });
      if (res.success) {
        toast.success('Status Updated', `Feedback marked as ${newStatus}.`);
        if (selectedFeedback && selectedFeedback.id === feedbackId) {
          setSelectedFeedback(res.feedback);
        }
        loadFeedbacks();
      }
    } catch (err: any) {
      toast.error('Update Failed', err.message);
    } finally {
      setIsUpdatingStatus(false);
    }
  };

  const handleSendReply = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedFeedback || !replyMessage.trim()) return;

    try {
      setIsSubmittingReply(true);
      const res = await supportApi.adminReplyToFeedback(selectedFeedback.id, {
        message: replyMessage.trim(),
        is_internal: isInternalNote,
      });

      if (res.success) {
        toast.success(
          isInternalNote ? 'Internal Note Saved' : 'Email Reply Sent',
          res.message
        );
        setSelectedFeedback(res.feedback);
        setReplyMessage('');
        loadFeedbacks();
      }
    } catch (err: any) {
      toast.error('Reply Failed', err.message);
    } finally {
      setIsSubmittingReply(false);
    }
  };

  return (
    <div className="space-y-6 animate-fade-in">
      {/* 1. METRICS DASHBOARD */}
      <div className="grid grid-cols-2 sm:grid-cols-4 lg:grid-cols-9 gap-3">
        {/* Total */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-4 border border-slate-200 dark:border-slate-800 shadow-sm col-span-2 sm:col-span-2">
          <p className="text-[11px] font-bold text-slate-500 uppercase tracking-wider">
            Total Feedback
          </p>
          <div className="flex items-baseline gap-2 mt-1">
            <span className="text-2xl font-black text-slate-900 dark:text-white">
              {metrics.total}
            </span>
            <span className="text-xs font-semibold text-emerald-600 bg-emerald-50 dark:bg-emerald-950/60 px-2 py-0.5 rounded-full">
              Avg: {metrics.avg_rating} ★
            </span>
          </div>
        </div>

        {/* 5-Star to 1-Star Breakdowns */}
        {[
          { label: '5 ★', count: metrics.stars_5, color: 'text-emerald-600 bg-emerald-50 dark:bg-emerald-950' },
          { label: '4 ★', count: metrics.stars_4, color: 'text-teal-600 bg-teal-50 dark:bg-teal-950' },
          { label: '3 ★', count: metrics.stars_3, color: 'text-amber-600 bg-amber-50 dark:bg-amber-950' },
          { label: '2 ★', count: metrics.stars_2, color: 'text-orange-600 bg-orange-50 dark:bg-orange-950' },
          { label: '1 ★', count: metrics.stars_1, color: 'text-rose-600 bg-rose-50 dark:bg-rose-950' },
        ].map((item, idx) => (
          <div
            key={idx}
            className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm text-center"
          >
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${item.color}`}>
              {item.label}
            </span>
            <p className="text-lg font-black text-slate-800 dark:text-slate-100 mt-1">
              {item.count}
            </p>
          </div>
        ))}

        {/* New & Reviewed */}
        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 dark:bg-blue-950 dark:text-blue-300">
            New
          </span>
          <p className="text-lg font-black text-blue-600 dark:text-blue-400 mt-1">
            {metrics.new_count}
          </p>
        </div>

        <div className="bg-white dark:bg-slate-900 rounded-2xl p-3 border border-slate-200 dark:border-slate-800 shadow-sm text-center">
          <span className="text-[10px] font-bold px-1.5 py-0.5 rounded bg-purple-50 text-purple-700 dark:bg-purple-950 dark:text-purple-300">
            Reviewed
          </span>
          <p className="text-lg font-black text-purple-600 dark:text-purple-400 mt-1">
            {metrics.reviewed_count}
          </p>
        </div>
      </div>

      {/* 2. FILTERS & SEARCH BAR */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl p-5 border border-slate-200 dark:border-slate-800 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
        <form onSubmit={handleSearchSubmit} className="flex-1 relative">
          <Search className="w-4 h-4 absolute left-3.5 top-1/2 -translate-y-1/2 text-slate-400" />
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search by user name, email, or feedback message..."
            className="w-full pl-10 pr-4 py-2 text-xs rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500"
          />
        </form>

        <div className="flex flex-wrap items-center gap-2 text-xs">
          {/* Rating filter */}
          <select
            value={ratingFilter}
            onChange={(e) => setRatingFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Ratings (1-5 ★)</option>
            <option value="5">5 Stars — Excellent</option>
            <option value="4">4 Stars — Good</option>
            <option value="3">3 Stars — Average</option>
            <option value="2">2 Stars — Needs Improvement</option>
            <option value="1">1 Star — Poor</option>
          </select>

          {/* Status filter */}
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Statuses</option>
            <option value="new">New</option>
            <option value="reviewed">Reviewed</option>
            <option value="responded">Responded</option>
            <option value="resolved">Resolved</option>
          </select>

          {/* Category filter */}
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="px-3 py-2 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 font-semibold focus:outline-none focus:ring-2 focus:ring-emerald-500"
          >
            <option value="all">All Categories</option>
            <option value="App Experience">App Experience</option>
            <option value="UI / Design">UI / Design</option>
            <option value="Performance">Performance</option>
            <option value="Features">Features</option>
            <option value="Calculator">Calculator</option>
            <option value="Udhar">Udhar</option>
            <option value="Other">Other</option>
          </select>

          <button
            type="button"
            onClick={loadFeedbacks}
            className="p-2 rounded-xl border border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
            title="Refresh list"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${isLoading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* 3. FEEDBACK TABLE */}
      <div className="bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="p-12 text-center text-xs text-slate-500">
            Loading feedbacks...
          </div>
        ) : feedbacks.length === 0 ? (
          <div className="p-12 text-center space-y-2">
            <MessageSquare className="w-10 h-10 text-slate-300 dark:text-slate-700 mx-auto" />
            <p className="text-sm font-bold text-slate-700 dark:text-slate-300">
              No feedback records found
            </p>
            <p className="text-xs text-slate-400">
              No user feedback matches the selected filters.
            </p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-950/60 border-b border-slate-200 dark:border-slate-800 text-slate-500 font-bold uppercase tracking-wider text-[10px]">
                <tr>
                  <th className="px-5 py-3.5">User</th>
                  <th className="px-4 py-3.5">Rating</th>
                  <th className="px-4 py-3.5">Category</th>
                  <th className="px-4 py-3.5">Message</th>
                  <th className="px-4 py-3.5">Date</th>
                  <th className="px-4 py-3.5">Status</th>
                  <th className="px-5 py-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {feedbacks.map((item) => (
                  <tr
                    key={item.id}
                    className="hover:bg-slate-50/70 dark:hover:bg-slate-800/40 transition-colors"
                  >
                    <td className="px-5 py-3.5">
                      <div className="font-bold text-slate-900 dark:text-white">
                        {item.user_name}
                      </div>
                      <div className="text-[11px] text-slate-400 font-mono">
                        {item.user_email}
                      </div>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      {item.rating ? (
                        <div className="flex items-center gap-1 text-amber-400">
                          {'★'.repeat(item.rating)}
                          <span className="text-[10px] font-bold text-slate-500 ml-1">
                            ({item.rating}/5)
                          </span>
                        </div>
                      ) : (
                        <span className="text-slate-400 italic">None</span>
                      )}
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span className="px-2.5 py-1 rounded-lg bg-slate-100 dark:bg-slate-800 font-semibold text-slate-700 dark:text-slate-300 text-[11px]">
                        {item.category || 'General'}
                      </span>
                    </td>

                    <td className="px-4 py-3.5 max-w-xs sm:max-w-md">
                      <p className="line-clamp-2 text-slate-700 dark:text-slate-300">
                        {item.message}
                      </p>
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap text-slate-500 text-[11px]">
                      {formatDisplayDate(item.created_at)}
                    </td>

                    <td className="px-4 py-3.5 whitespace-nowrap">
                      <span
                        className={`px-2 py-0.5 rounded-md font-bold uppercase text-[10px] tracking-wide ${
                          item.status === 'new'
                            ? 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300'
                            : item.status === 'reviewed'
                            ? 'bg-purple-100 text-purple-800 dark:bg-purple-950 dark:text-purple-300'
                            : item.status === 'responded'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                        }`}
                      >
                        {item.status}
                      </span>
                    </td>

                    <td className="px-5 py-3.5 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setSelectedFeedback(item)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 font-bold hover:bg-emerald-100 transition-all cursor-pointer"
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

      {/* 4. FEEDBACK DETAIL & EMAIL REPLY MODAL */}
      {selectedFeedback && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            {/* Header */}
            <div className="p-5 border-b border-slate-200 dark:border-slate-800 flex items-center justify-between">
              <div>
                <h3 className="text-base font-bold text-slate-900 dark:text-white">
                  Feedback Review &amp; Reply
                </h3>
                <p className="text-xs text-slate-400">
                  ID: <span className="font-mono">{selectedFeedback.id}</span>
                </p>
              </div>
              <button
                type="button"
                onClick={() => setSelectedFeedback(null)}
                className="p-2 rounded-xl text-slate-400 hover:text-slate-600 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer text-lg leading-none"
              >
                &times;
              </button>
            </div>

            {/* Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs flex-1">
              {/* User Identity & Rating */}
              <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-2">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-bold text-sm text-slate-900 dark:text-white">
                      {selectedFeedback.user_name}
                    </h4>
                    <a
                      href={`mailto:${selectedFeedback.user_email}`}
                      className="text-emerald-600 hover:underline font-mono"
                    >
                      {selectedFeedback.user_email}
                    </a>
                  </div>

                  {selectedFeedback.rating && (
                    <div className="text-right">
                      <div className="text-amber-400 text-sm">
                        {'★'.repeat(selectedFeedback.rating)}
                        {'☆'.repeat(5 - selectedFeedback.rating)}
                      </div>
                      <span className="text-[11px] font-bold text-slate-500">
                        {STAR_LABELS[selectedFeedback.rating]}
                      </span>
                    </div>
                  )}
                </div>

                <div className="flex items-center gap-3 text-slate-400 pt-1 text-[11px]">
                  <span>Category: <strong>{selectedFeedback.category || 'General'}</strong></span>
                  <span>&bull;</span>
                  <span>Submitted: {formatDisplayDate(selectedFeedback.created_at)}</span>
                </div>

                <div className="mt-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-slate-800 dark:text-slate-200 leading-relaxed whitespace-pre-wrap">
                  {selectedFeedback.message}
                </div>
              </div>

              {/* Status Update Quick Buttons */}
              <div className="space-y-1.5">
                <label className="font-bold text-slate-700 dark:text-slate-300 block text-[11px] uppercase tracking-wider">
                  Update Status:
                </label>
                <div className="flex flex-wrap gap-2">
                  {(['reviewed', 'resolved', 'new'] as const).map((st) => (
                    <button
                      key={st}
                      type="button"
                      disabled={isUpdatingStatus}
                      onClick={() => handleUpdateStatus(selectedFeedback.id, st)}
                      className={`px-3 py-1.5 rounded-xl font-bold capitalize transition-all cursor-pointer ${
                        selectedFeedback.status === st
                          ? 'bg-slate-900 dark:bg-white text-white dark:text-slate-900'
                          : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 hover:bg-slate-200'
                      }`}
                    >
                      Mark as {st}
                    </button>
                  ))}
                </div>
              </div>

              {/* Admin Notes / Response History */}
              {selectedFeedback.admin_notes && (
                <div className="p-3.5 rounded-2xl bg-amber-50/60 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-900 space-y-1 text-xs">
                  <span className="font-bold text-amber-900 dark:text-amber-300 block text-[11px]">
                    Admin Communication / History:
                  </span>
                  <p className="text-amber-950 dark:text-amber-200 whitespace-pre-wrap">
                    {selectedFeedback.admin_notes}
                  </p>
                  {selectedFeedback.reviewed_by && (
                    <span className="text-[10px] text-amber-700/80 block pt-1">
                      By {selectedFeedback.reviewed_by} on {formatDisplayDate(selectedFeedback.reviewed_at || selectedFeedback.updated_at)}
                    </span>
                  )}
                </div>
              )}

              {/* Reply Composer Form */}
              <form onSubmit={handleSendReply} className="space-y-3 pt-2 border-t border-slate-100 dark:border-slate-800">
                <div className="flex items-center justify-between">
                  <label className="font-bold text-slate-700 dark:text-slate-300">
                    Write Response
                  </label>

                  {/* Mode Toggle: Email Reply vs Internal Note */}
                  <div className="inline-flex rounded-xl p-0.5 bg-slate-100 dark:bg-slate-800 text-[11px]">
                    <button
                      type="button"
                      onClick={() => setIsInternalNote(false)}
                      className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-all cursor-pointer ${
                        !isInternalNote
                          ? 'bg-emerald-600 text-white shadow-sm'
                          : 'text-slate-500 hover:text-slate-800'
                      }`}
                    >
                      <Mail className="w-3 h-3" />
                      <span>Reply via Email</span>
                    </button>
                    <button
                      type="button"
                      onClick={() => setIsInternalNote(true)}
                      className={`px-2.5 py-1 rounded-lg font-bold flex items-center gap-1 transition-all cursor-pointer ${
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
                  rows={3}
                  value={replyMessage}
                  onChange={(e) => setReplyMessage(e.target.value)}
                  placeholder={
                    isInternalNote
                      ? 'Add an internal team note (never sent to user)...'
                      : `Write a response to ${selectedFeedback.user_name} (will be dispatched to ${selectedFeedback.user_email})...`
                  }
                  required
                  className="w-full px-3.5 py-2.5 rounded-2xl border border-slate-200 dark:border-slate-800 bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-emerald-500"
                />

                <div className="flex justify-between items-center pt-1">
                  <span className="text-[11px] text-slate-400">
                    {isInternalNote
                      ? '🔒 Visible to Admin team only'
                      : '📧 Dispatched via secure SMTP to registered email'}
                  </span>
                  <button
                    type="submit"
                    disabled={isSubmittingReply || !replyMessage.trim()}
                    className={`px-5 py-2 rounded-xl text-xs font-bold text-white transition-all cursor-pointer shadow-md flex items-center gap-1.5 disabled:opacity-50 ${
                      isInternalNote
                        ? 'bg-slate-800 hover:bg-slate-900'
                        : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/20'
                    }`}
                  >
                    <Send className="w-3.5 h-3.5" />
                    <span>{isSubmittingReply ? 'Sending...' : (isInternalNote ? 'Save Note' : 'Send Email Reply')}</span>
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
