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
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

export const AdminEmailsTab: React.FC = () => {
  const toast = useToast();
  const [subView, setSubView] = useState<'logs' | 'templates' | 'test'>('logs');
  const [logs, setLogs] = useState<any[]>([]);
  const [templates, setTemplates] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

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
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

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
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-700 dark:text-slate-300">
              Email Dispatch Logs ({logs.length} Recorded)
            </span>
            <span className="text-slate-400">Nodemailer SMTP verified delivery</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-3.5">Recipient</th>
                  <th className="p-3.5">Category & Subject</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Attempts</th>
                  <th className="p-3.5">Sent Timestamp</th>
                  <th className="p-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {logs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No email dispatch logs recorded.
                    </td>
                  </tr>
                ) : (
                  logs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="p-3.5">
                        <p className="font-bold text-slate-800 dark:text-slate-200">{log.recipient_name || 'User'}</p>
                        <p className="font-mono text-[11px] text-slate-400">{log.email}</p>
                      </td>

                      <td className="p-3.5">
                        <span className="text-[10px] font-bold text-indigo-600 uppercase tracking-wider block">
                          {log.email_type}
                        </span>
                        <p className="text-slate-700 dark:text-slate-300 font-semibold">{log.subject}</p>
                      </td>

                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            log.status === 'sent'
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          ● {log.status}
                        </span>
                      </td>

                      <td className="p-3.5 text-slate-500 font-mono text-[11px]">
                        {log.attempts} / {log.max_attempts}
                      </td>

                      <td className="p-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                        {log.sent_at ? new Date(log.sent_at).toLocaleString() : 'Pending'}
                      </td>

                      <td className="p-3.5 text-right">
                        {log.status === 'failed' && (
                          <button
                            onClick={() => handleRetryEmail(log.id)}
                            className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1 ml-auto"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Retry</span>
                          </button>
                        )}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
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
    </div>
  );
};
