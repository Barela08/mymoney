import React, { useState, useEffect } from 'react';
import {
  Mail,
  FileText,
  Send,
  RefreshCw,
  RotateCcw,
  CheckCircle2,
  AlertTriangle,
  Clock,
  Edit3,
  X,
  Eye,
  Search,
  Filter,
  UserCheck,
  UserX,
  ExternalLink,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

interface AdminEmailsTabProps {
  initialSubView?: 'logs' | 'templates' | 'test';
}

export const AdminEmailsTab: React.FC<AdminEmailsTabProps> = ({ initialSubView = 'logs' }) => {
  const toast = useToast();
  const [subView, setSubView] = useState<'logs' | 'templates' | 'test'>(initialSubView);

  useEffect(() => {
    if (initialSubView) {
      setSubView(initialSubView);
    }
  }, [initialSubView]);
  const [logs, setLogs] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Email Logs Filtering & Inspect State
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState('all');
  const [selectedLog, setSelectedLog] = useState<any>(null);

  // Template Edit State
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [editSubject, setEditSubject] = useState('');
  const [editHtml, setEditHtml] = useState('');
  const [editText, setEditText] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Test Email State
  const [testRecipient, setTestRecipient] = useState('');
  const [testSubject, setTestSubject] = useState('Test Transmission from My Money Manager Admin');
  const [testHtml, setTestHtml] = useState('<p>This is a live test transmission from the Admin Control Center.</p>');
  const [isSendingTest, setIsSendingTest] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (subView === 'logs') {
        const res = await adminClient.getEmailLogs();
        if (res.success) setLogs(res.logs || []);
      } else if (subView === 'templates') {
        const res = await adminClient.getEmailTemplates();
        if (res.success) setTemplates(res.templates || []);
      }
    } catch (err: any) {
      toast.error('Email Query Error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [subView]);

  const handleRetryEmail = async (id: string) => {
    try {
      const res = await adminClient.retryEmail(id);
      if (res.success) {
        toast.success('Retried', 'Email redelivery triggered.');
        await loadData();
        if (selectedLog && selectedLog.id === id) {
          setSelectedLog(null);
        }
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const getStatusBadge = (status: string) => {
    switch (status) {
      case 'sent':
        return {
          label: 'Sent',
          classes: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-800',
        };
      case 'pending':
        return {
          label: 'Pending',
          classes: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-800',
        };
      case 'retrying':
        return {
          label: 'Retrying',
          classes: 'bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-300 dark:border-blue-800',
        };
      case 'failed':
        return {
          label: 'Failed',
          classes: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300 border border-rose-300 dark:border-rose-800',
        };
      case 'skipped_not_registered':
        return {
          label: 'Skipped — recipient is not a registered user',
          classes: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 border border-slate-300 dark:border-slate-700',
        };
      case 'skipped_unverified':
        return {
          label: 'Skipped — identity could not be verified',
          classes: 'bg-orange-100 text-orange-800 dark:bg-orange-950 dark:text-orange-300 border border-orange-300 dark:border-orange-800',
        };
      default:
        return {
          label: status,
          classes: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
        };
    }
  };

  const getNotificationTypeLabel = (type: string) => {
    switch (type) {
      case 'feedback_user_confirmation':
        return 'Feedback User';
      case 'feedback_admin_notification':
        return 'Feedback Admin';
      case 'udhar_created_initiator':
        return 'Udhar Initiator';
      case 'udhar_created_counterpart':
        return 'Udhar Counterpart';
      case 'udhar_settled_initiator':
        return 'Settlement Initiator';
      case 'udhar_settled_counterpart':
        return 'Settlement Counterpart';
      case 'udhar_updated_initiator':
        return 'Udhar Update (Init)';
      case 'udhar_updated_counterpart':
        return 'Udhar Update (CP)';
      case 'welcome_email':
        return 'Welcome Email';
      case 'password_reset':
        return 'Password Reset';
      case 'account_deletion_requested':
        return 'Deletion Requested';
      case 'account_deletion_cancelled':
        return 'Deletion Cancelled';
      case 'account_deletion_completed':
        return 'Deletion Completed';
      default:
        return type ? type.replace(/_/g, ' ') : 'General Notification';
    }
  };

  const filteredLogs = logs.filter((log) => {
    if (logStatusFilter !== 'all') {
      if (logStatusFilter === 'skipped') {
        if (!log.status?.startsWith('skipped')) return false;
      } else if (log.status !== logStatusFilter) {
        return false;
      }
    }
    if (!logSearchQuery) return true;
    const q = logSearchQuery.toLowerCase();
    return (
      (log.email && log.email.toLowerCase().includes(q)) ||
      (log.recipient_name && log.recipient_name.toLowerCase().includes(q)) ||
      (log.subject && log.subject.toLowerCase().includes(q)) ||
      (log.reference_id && log.reference_id.toLowerCase().includes(q)) ||
      (log.user_id && log.user_id.toLowerCase().includes(q)) ||
      (log.trigger_event && log.trigger_event.toLowerCase().includes(q))
    );
  });

  const handleOpenEditTemplate = (tmpl: any) => {
    setEditingTemplate(tmpl);
    setEditSubject(tmpl.subject);
    setEditHtml(tmpl.html_content);
    setEditText(tmpl.text_content);
    setEditActive(tmpl.is_active);
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;

    setIsSavingTemplate(true);
    try {
      const res = await adminClient.updateEmailTemplate(editingTemplate.id, {
        subject: editSubject,
        html_content: editHtml,
        text_content: editText,
        is_active: editActive,
      });

      if (res.success) {
        toast.success('Template Saved', 'Email template updated and version bumped.');
        setEditingTemplate(null);
        await loadData();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleSendTestEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!testRecipient) {
      toast.error('Required', 'Please enter a recipient email.');
      return;
    }

    setIsSendingTest(true);
    try {
      const res = await adminClient.sendTestEmail({
        recipient: testRecipient,
        subject: testSubject,
        html_content: testHtml,
      });

      if (res.success) {
        toast.success('Test Email Dispatched', res.message);
      } else {
        toast.error('Dispatch Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsSendingTest(false);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-view Navigation */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl text-xs font-bold w-full sm:w-auto">
          <button
            onClick={() => setSubView('logs')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all cursor-pointer ${
              subView === 'logs' ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'
            }`}
          >
            Dispatch History Logs
          </button>
          <button
            onClick={() => setSubView('templates')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all cursor-pointer ${
              subView === 'templates' ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'
            }`}
          >
            Template Manager
          </button>
          <button
            onClick={() => setSubView('test')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all cursor-pointer ${
              subView === 'test' ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'
            }`}
          >
            Send Test Transmission
          </button>
        </div>

        <button
          onClick={loadData}
          className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      {/* Sub-View 1: Email Logs Table */}
      {subView === 'logs' && (
        <div className="space-y-4">
          {/* Summary Stat Pills & Search Filters */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 shadow-sm space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-3 text-xs">
              <div className="flex items-center gap-2">
                <span className="font-bold text-slate-800 dark:text-slate-200">
                  Email Dispatch Audit Logs
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300">
                  {filteredLogs.length} of {logs.length}
                </span>
              </div>

              {/* Status Counts */}
              <div className="flex flex-wrap items-center gap-2 text-[11px] font-semibold">
                <span className="px-2 py-0.5 rounded-lg bg-emerald-50 text-emerald-700 dark:bg-emerald-950/50 dark:text-emerald-400">
                  ✓ {logs.filter((l) => l.status === 'sent').length} Sent
                </span>
                <span className="px-2 py-0.5 rounded-lg bg-amber-50 text-amber-700 dark:bg-amber-950/50 dark:text-amber-400">
                  ⏳ {logs.filter((l) => l.status === 'pending' || l.status === 'retrying').length} Pending
                </span>
                <span className="px-2 py-0.5 rounded-lg bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300">
                  ⏭️ {logs.filter((l) => l.status?.startsWith('skipped')).length} Skipped
                </span>
                <span className="px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 dark:bg-rose-950/50 dark:text-rose-400">
                  ✕ {logs.filter((l) => l.status === 'failed').length} Failed
                </span>
              </div>
            </div>

            {/* Filter & Search Bar */}
            <div className="flex flex-col sm:flex-row items-center gap-3 pt-2 border-t border-slate-100 dark:border-slate-800">
              <div className="relative flex-1 w-full">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={logSearchQuery}
                  onChange={(e) => setLogSearchQuery(e.target.value)}
                  placeholder="Search by recipient email, name, user ID, reference ID (FB-..., tx-...), subject..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200 placeholder-slate-400"
                />
              </div>

              <div className="flex items-center gap-2 w-full sm:w-auto">
                <Filter className="w-3.5 h-3.5 text-slate-400" />
                <select
                  value={logStatusFilter}
                  onChange={(e) => setLogStatusFilter(e.target.value)}
                  className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300 cursor-pointer"
                >
                  <option value="all">All Delivery Statuses</option>
                  <option value="sent">Sent</option>
                  <option value="pending">Pending</option>
                  <option value="retrying">Retrying</option>
                  <option value="failed">Failed</option>
                  <option value="skipped">All Skipped</option>
                  <option value="skipped_not_registered">Skipped (Not Registered)</option>
                  <option value="skipped_unverified">Skipped (Unverified Identity)</option>
                </select>
              </div>
            </div>
          </div>

          {/* Logs Table */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full text-left text-xs">
                <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                  <tr>
                    <th className="p-3.5">Recipient & User ID</th>
                    <th className="p-3.5">Notification Type & Ref</th>
                    <th className="p-3.5">Subject</th>
                    <th className="p-3.5">Delivery Status</th>
                    <th className="p-3.5">Attempts</th>
                    <th className="p-3.5">Timestamps</th>
                    <th className="p-3.5 text-right">Actions</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {filteredLogs.length === 0 ? (
                    <tr>
                      <td colSpan={7} className="p-10 text-center text-slate-400">
                        {logSearchQuery || logStatusFilter !== 'all'
                          ? 'No email dispatch logs match your search or filter.'
                          : 'No email dispatch logs recorded.'}
                      </td>
                    </tr>
                  ) : (
                    filteredLogs.map((log) => {
                      const badge = getStatusBadge(log.status);
                      const isSkipped = log.status?.startsWith('skipped');
                      const typeLabel = getNotificationTypeLabel(log.email_type);

                      return (
                        <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                          {/* Recipient */}
                          <td className="p-3.5">
                            <div className="flex items-center gap-1.5">
                              {log.user_id ? (
                                <span title="Registered User" className="inline-flex shrink-0">
                                  <UserCheck className="w-3.5 h-3.5 text-emerald-500" />
                                </span>
                              ) : (
                                <span title="Unregistered / System Admin" className="inline-flex shrink-0">
                                  <UserX className="w-3.5 h-3.5 text-slate-400" />
                                </span>
                              )}
                              <p className="font-bold text-slate-800 dark:text-slate-200">
                                {log.recipient_name || 'System / User'}
                              </p>
                            </div>
                            <p className="font-mono text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                              {log.email || <span className="italic text-slate-400">No email (Unregistered)</span>}
                            </p>
                            {log.user_id && (
                              <p className="font-mono text-[10px] text-emerald-600 dark:text-emerald-400 mt-0.5">
                                UID: {log.user_id.slice(0, 8)}...
                              </p>
                            )}
                          </td>

                          {/* Category, Trigger Event & Reference ID */}
                          <td className="p-3.5">
                            <div className="flex flex-wrap items-center gap-1.5 mb-1">
                              <span className="text-[10px] font-bold text-indigo-600 dark:text-indigo-400 bg-indigo-50 dark:bg-indigo-950/60 px-2 py-0.5 rounded-md uppercase tracking-wider">
                                {typeLabel}
                              </span>
                              {log.reference_id && (
                                <span className="font-mono text-[10px] font-bold text-emerald-700 dark:text-emerald-300 bg-emerald-50 dark:bg-emerald-950/60 px-1.5 py-0.5 rounded border border-emerald-200 dark:border-emerald-800">
                                  #{log.reference_id}
                                </span>
                              )}
                            </div>
                            {log.trigger_event && (
                              <p className="text-[10px] text-slate-400">
                                Event: <span className="font-mono text-slate-600 dark:text-slate-300">{log.trigger_event}</span>
                              </p>
                            )}
                          </td>

                          {/* Subject */}
                          <td className="p-3.5 max-w-xs">
                            <p className="text-slate-700 dark:text-slate-300 font-semibold line-clamp-2">
                              {log.subject}
                            </p>
                          </td>

                          {/* Status */}
                          <td className="p-3.5 whitespace-nowrap">
                            <span className={`inline-block px-2.5 py-1 rounded-full text-[10px] font-bold ${badge.classes}`}>
                              ● {badge.label}
                            </span>
                            {log.last_error && !isSkipped && (
                              <p className="text-[10px] text-rose-500 max-w-xs truncate mt-1" title={log.last_error}>
                                Error: {log.last_error}
                              </p>
                            )}
                          </td>

                          {/* Attempts */}
                          <td className="p-3.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                            {isSkipped ? (
                              <span className="text-slate-400 text-[10px]">0 / 0 (Skipped)</span>
                            ) : (
                              `${log.attempts} / ${log.max_attempts}`
                            )}
                          </td>

                          {/* Timestamps */}
                          <td className="p-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                            <p title="Created At">
                              {log.created_at ? new Date(log.created_at).toLocaleString() : '—'}
                            </p>
                            {log.sent_at && (
                              <p className="text-[10px] text-emerald-600 dark:text-emerald-400" title="Delivered At">
                                Sent: {new Date(log.sent_at).toLocaleTimeString()}
                              </p>
                            )}
                          </td>

                          {/* Action Buttons */}
                          <td className="p-3.5 text-right whitespace-nowrap">
                            <div className="flex items-center justify-end gap-1.5">
                              <button
                                onClick={() => setSelectedLog(log)}
                                className="p-1.5 rounded-lg bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 cursor-pointer"
                                title="Inspect Details"
                              >
                                <Eye className="w-3.5 h-3.5" />
                              </button>

                              {log.status === 'failed' && (
                                <button
                                  onClick={() => handleRetryEmail(log.id)}
                                  className="px-2 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 text-[11px] font-bold rounded-lg cursor-pointer flex items-center gap-1"
                                  title="Retry Delivery"
                                >
                                  <RotateCcw className="w-3 h-3" />
                                  <span>Retry</span>
                                </button>
                              )}
                            </div>
                          </td>
                        </tr>
                      );
                    })
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}

      {/* Sub-View 2: Templates List */}
      {subView === 'templates' && (
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {templates.map((tmpl) => (
            <div
              key={tmpl.id}
              className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-3"
            >
              <div className="flex items-center justify-between">
                <div>
                  <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full">
                    {tmpl.category}
                  </span>
                  <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 mt-1">{tmpl.name}</h4>
                </div>
                <span className="text-[10px] font-mono text-slate-400">v{tmpl.version}.0</span>
              </div>

              <div>
                <span className="text-[11px] font-semibold text-slate-400">Subject:</span>
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">{tmpl.subject}</p>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100 dark:border-slate-800">
                <span
                  className={`text-[10px] font-bold ${
                    tmpl.is_active ? 'text-emerald-600' : 'text-slate-400'
                  }`}
                >
                  {tmpl.is_active ? '● Active' : 'Disabled'}
                </span>

                <button
                  onClick={() => handleOpenEditTemplate(tmpl)}
                  className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl flex items-center gap-1.5 cursor-pointer"
                >
                  <Edit3 className="w-3.5 h-3.5" />
                  <span>Edit Template</span>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Sub-View 3: Test Email Transmission Form */}
      {subView === 'test' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm max-w-xl mx-auto space-y-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
            <Send className="w-4 h-4 text-emerald-600" />
            <span>Send Live Test Transmission</span>
          </h3>
          <p className="text-xs text-slate-400">
            Verifies SMTP connectivity and renders HTML payloads without affecting real users.
          </p>

          <form onSubmit={handleSendTestEmail} className="space-y-3">
            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Recipient Email *</label>
              <input
                type="email"
                placeholder="admin@example.com"
                value={testRecipient}
                onChange={(e) => setTestRecipient(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">Subject</label>
              <input
                type="text"
                value={testSubject}
                onChange={(e) => setTestSubject(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                required
              />
            </div>

            <div>
              <label className="block text-[11px] font-bold text-slate-500 mb-1">HTML Content Payload</label>
              <textarea
                rows={4}
                value={testHtml}
                onChange={(e) => setTestHtml(e.target.value)}
                className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
              />
            </div>

            <button
              type="submit"
              disabled={isSendingTest}
              className="w-full py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
            >
              {isSendingTest ? 'Dispatching via SMTP...' : 'Dispatch Test Email'}
            </button>
          </form>
        </div>
      )}

      {/* Edit Template Modal */}
      {editingTemplate && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Edit Template: {editingTemplate.name}
              </h3>
              <button onClick={() => setEditingTemplate(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveTemplate} className="space-y-3 flex-1 overflow-y-auto">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Subject Line</label>
                <input
                  type="text"
                  value={editSubject}
                  onChange={(e) => setEditSubject(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">HTML Template Body</label>
                <textarea
                  rows={6}
                  value={editHtml}
                  onChange={(e) => setEditHtml(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px]"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Plain Text Fallback</label>
                <textarea
                  rows={3}
                  value={editText}
                  onChange={(e) => setEditText(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono text-[11px]"
                />
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input
                  type="checkbox"
                  id="tmplActive"
                  checked={editActive}
                  onChange={(e) => setEditActive(e.target.checked)}
                  className="rounded text-emerald-600"
                />
                <label htmlFor="tmplActive" className="text-xs font-bold text-slate-700 dark:text-slate-300">
                  Template Active & Dispatchable
                </label>
              </div>

              <div className="flex items-center gap-3 pt-3">
                <button
                  type="button"
                  onClick={() => setEditingTemplate(null)}
                  className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSavingTemplate}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20"
                >
                  {isSavingTemplate ? 'Saving...' : 'Save Template Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Log Inspection Modal */}
      {selectedLog && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm animate-fade-in">
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl max-w-xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Mail className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">
                  Email Dispatch Audit Record
                </h3>
              </div>
              <button
                onClick={() => setSelectedLog(null)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Content Body */}
            <div className="p-5 overflow-y-auto space-y-4 text-xs">
              {/* Status Header Bar */}
              <div className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-800">
                <div>
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Delivery Status</span>
                  <span className={`inline-block mt-0.5 px-2.5 py-0.5 rounded-full text-xs font-bold ${getStatusBadge(selectedLog.status).classes}`}>
                    ● {getStatusBadge(selectedLog.status).label}
                  </span>
                </div>
                <div className="text-right">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Attempts</span>
                  <span className="font-mono font-bold text-slate-700 dark:text-slate-300">
                    {selectedLog.attempts} / {selectedLog.max_attempts}
                  </span>
                </div>
              </div>

              {/* Error / Skip Reason Alert */}
              {selectedLog.last_error && (
                <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-200">
                  <p className="font-bold text-[11px] flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Delivery Error / Reason
                  </p>
                  <p className="font-mono text-[11px] leading-relaxed break-words">{selectedLog.last_error}</p>
                </div>
              )}

              {/* Core Details Grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Notification Type</span>
                  <span className="font-bold text-indigo-600 dark:text-indigo-400">
                    {getNotificationTypeLabel(selectedLog.email_type)}
                  </span>
                  <p className="font-mono text-[10px] text-slate-400 mt-0.5">{selectedLog.email_type}</p>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Reference ID</span>
                  <span className="font-mono font-bold text-emerald-600 dark:text-emerald-400">
                    {selectedLog.reference_id ? `#${selectedLog.reference_id}` : 'None'}
                  </span>
                  {selectedLog.trigger_event && (
                    <p className="text-[10px] text-slate-400 mt-0.5">Event: {selectedLog.trigger_event}</p>
                  )}
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">Recipient Name</span>
                  <span className="font-bold text-slate-800 dark:text-slate-200">
                    {selectedLog.recipient_name || 'Valued User'}
                  </span>
                  <p className="font-mono text-[11px] text-slate-500 mt-0.5">{selectedLog.email || 'No email specified'}</p>
                </div>

                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block">User Account Link</span>
                  {selectedLog.user_id ? (
                    <div>
                      <span className="font-bold text-emerald-600 flex items-center gap-1">
                        <UserCheck className="w-3 h-3" /> Registered App User
                      </span>
                      <p className="font-mono text-[10px] text-slate-400 mt-0.5 truncate">{selectedLog.user_id}</p>
                    </div>
                  ) : (
                    <div>
                      <span className="text-slate-500 flex items-center gap-1">
                        <UserX className="w-3 h-3" /> Unregistered / External
                      </span>
                      <p className="text-[10px] text-slate-400 mt-0.5">Not linked to app_users ID</p>
                    </div>
                  )}
                </div>
              </div>

              {/* Subject */}
              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Subject</span>
                <p className="font-semibold text-slate-800 dark:text-slate-200">{selectedLog.subject}</p>
              </div>

              {/* Timestamps */}
              <div className="grid grid-cols-3 gap-2 text-[10px] font-mono">
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block">Created At</span>
                  <span className="text-slate-700 dark:text-slate-300 font-semibold">
                    {selectedLog.created_at ? new Date(selectedLog.created_at).toLocaleString() : '—'}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block">Sent At</span>
                  <span className="text-slate-700 dark:text-slate-300 font-semibold">
                    {selectedLog.sent_at ? new Date(selectedLog.sent_at).toLocaleString() : 'Pending / Skipped'}
                  </span>
                </div>
                <div className="p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-slate-400 block">Updated At</span>
                  <span className="text-slate-700 dark:text-slate-300 font-semibold">
                    {selectedLog.updated_at ? new Date(selectedLog.updated_at).toLocaleString() : '—'}
                  </span>
                </div>
              </div>

              {/* Metadata JSON */}
              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Attached Metadata</span>
                  <pre className="font-mono text-[10px] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>

            {/* Footer Actions */}
            <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between gap-3 bg-slate-50 dark:bg-slate-800/40">
              <button
                onClick={() => setSelectedLog(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 hover:bg-slate-300 dark:bg-slate-700 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 font-semibold text-xs cursor-pointer"
              >
                Close Audit View
              </button>
              {selectedLog.status === 'failed' && (
                <button
                  onClick={() => handleRetryEmail(selectedLog.id)}
                  className="px-4 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-bold text-xs shadow-md shadow-indigo-600/20 cursor-pointer flex items-center gap-1.5"
                >
                  <RotateCcw className="w-3.5 h-3.5" />
                  <span>Retry Dispatch Now</span>
                </button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
