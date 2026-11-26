import React, { useState, useEffect, useMemo } from 'react';
import {
  Mail,
  Send,
  RefreshCw,
  RotateCcw,
  AlertTriangle,
  Edit3,
  X,
  Eye,
  Search,
  Filter,
  UserCheck,
  UserX,
  Plus,
  Trash2,
  Users,
  Sparkles,
  CheckCircle2,
  Bell,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

interface AdminEmailsTabProps {
  initialSubView?: 'logs' | 'templates' | 'test';
}

const TEMPLATE_CATEGORIES = [
  'all',
  'authentication',
  'support',
  'udhar',
  'notifications',
  'broadcast',
  'security',
  'lifecycle',
  'custom',
];

const DEFAULT_SAMPLE_VARS: Record<string, string> = {
  user_name: 'Aarav Sharma',
  user_email: 'aarav@example.com',
  title: 'Important Update from My Money Manager',
  message: 'Your account features and smart alerts are active.',
  category: 'Announcement',
  rating: '5',
  feedback_id: 'FB-2026-01',
  ticket_number: 'TKT-2026-01',
  subject: 'Account Update',
  original_subject: 'Support Inquiry',
  description: 'Details about your request or update.',
  admin_name: 'HackifyPro Admin',
  admin_reply: 'Your request has been reviewed and resolved by HackifyPro Support.',
  status: 'active',
  other_person_name: 'Rohan Verma',
  inviter_name: 'Aarav Sharma',
  transaction_id: 'TXN-1001',
  amount: '2,500',
  amount_settled: '1,250',
  updated_balance: '1,250',
  direction_label: 'Money Given (You Lent)',
  transaction_date: new Date().toLocaleDateString('en-IN'),
  settlement_date: new Date().toLocaleDateString('en-IN'),
  action_text: 'Open My Money Manager',
};

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
  const [registeredUsers, setRegisteredUsers] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Email Logs Filtering & Inspect State
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logStatusFilter, setLogStatusFilter] = useState('all');
  const [selectedLog, setSelectedLog] = useState<any>(null);

  // Template Filtering State
  const [tmplSearchQuery, setTmplSearchQuery] = useState('');
  const [tmplCategoryFilter, setTmplCategoryFilter] = useState('all');

  // Template Edit / Create Modal State
  const [editingTemplate, setEditingTemplate] = useState<any>(null);
  const [isCreatingTemplate, setIsCreatingTemplate] = useState(false);
  const [editName, setEditName] = useState('');
  const [editCategory, setEditCategory] = useState('custom');
  const [editSubject, setEditSubject] = useState('');
  const [editHtml, setEditHtml] = useState('');
  const [editText, setEditText] = useState('');
  const [editActive, setEditActive] = useState(true);
  const [editorMode, setEditorMode] = useState<'code' | 'preview'>('code');
  const [editorPreviewHtml, setEditorPreviewHtml] = useState('');
  const [editorPreviewSubject, setEditorPreviewSubject] = useState('');
  const [isSavingTemplate, setIsSavingTemplate] = useState(false);

  // Standalone Preview Modal State
  const [previewTemplateModal, setPreviewTemplateModal] = useState<{
    name: string;
    subject: string;
    html: string;
    text: string;
  } | null>(null);

  // Send Template Modal State
  const [sendTemplateModal, setSendTemplateModal] = useState<any>(null);
  const [sendTargetMode, setSendTargetMode] = useState<'custom_email' | 'selected_users' | 'all_active_users'>('custom_email');
  const [sendCustomEmails, setSendCustomEmails] = useState('');
  const [sendSelectedUserIds, setSendSelectedUserIds] = useState<string[]>([]);
  const [sendUserSearch, setSendUserSearch] = useState('');
  const [sendVariables, setSendVariables] = useState<Record<string, string>>({});
  const [sendAlsoPush, setSendAlsoPush] = useState(true);
  const [isDispatchingTemplate, setIsDispatchingTemplate] = useState(false);

  // Test Email State
  const [selectedTestTemplateId, setSelectedTestTemplateId] = useState('');
  const [testRecipient, setTestRecipient] = useState('');
  const [testSubject, setTestSubject] = useState('Test Transmission from My Money Manager Admin');
  const [testHtml, setTestHtml] = useState('<p>This is a live test transmission from the HackifyPro Admin Control Center.</p>');
  const [isSendingTest, setIsSendingTest] = useState(false);

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (subView === 'logs') {
        const res = await adminClient.getEmailLogs();
        if (res.success) setLogs(res.logs || []);
      } else if (subView === 'templates' || subView === 'test') {
        const [tmplRes, usersRes] = await Promise.all([
          adminClient.getEmailTemplates(),
          registeredUsers.length === 0 ? adminClient.getUsers().catch(() => null) : Promise.resolve(null),
        ]);
        if (tmplRes?.success) setTemplates(tmplRes.templates || []);
        if (usersRes?.success && Array.isArray(usersRes.users)) {
          setRegisteredUsers(usersRes.users);
        }
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
      case 'complaint_user_confirmation':
        return 'Complaint User';
      case 'complaint_admin_notification':
        return 'Complaint Admin';
      case 'support_user_confirmation':
        return 'Support User';
      case 'support_admin_notification':
        return 'Support Admin';
      case 'admin_ticket_reply':
        return 'Admin Reply';
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
      case 'password_changed':
        return 'Password Changed';
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

  const filteredTemplates = useMemo(() => {
    return templates.filter((tmpl) => {
      if (tmplCategoryFilter !== 'all' && (tmpl.category || '').toLowerCase() !== tmplCategoryFilter) {
        return false;
      }
      if (!tmplSearchQuery.trim()) return true;
      const q = tmplSearchQuery.toLowerCase();
      return (
        (tmpl.name && tmpl.name.toLowerCase().includes(q)) ||
        (tmpl.slug && tmpl.slug.toLowerCase().includes(q)) ||
        (tmpl.subject && tmpl.subject.toLowerCase().includes(q)) ||
        (tmpl.category && tmpl.category.toLowerCase().includes(q))
      );
    });
  }, [templates, tmplCategoryFilter, tmplSearchQuery]);

  const filteredSendUsers = useMemo(() => {
    const q = sendUserSearch.trim().toLowerCase();
    return registeredUsers.filter((u) => {
      if (!u?.email) return false;
      if (u.status && ['deleted', 'suspended', 'banned', 'inactive'].includes(String(u.status).toLowerCase())) {
        return false;
      }
      if (!q) return true;
      return (
        String(u.email || '').toLowerCase().includes(q) ||
        String(u.full_name || '').toLowerCase().includes(q)
      );
    });
  }, [registeredUsers, sendUserSearch]);

  const handleOpenEditTemplate = (tmpl: any) => {
    setIsCreatingTemplate(false);
    setEditingTemplate(tmpl);
    setEditName(tmpl.name || '');
    setEditCategory(tmpl.category || 'custom');
    setEditSubject(tmpl.subject || '');
    setEditHtml(tmpl.html_content || '');
    setEditText(tmpl.text_content || '');
    setEditActive(tmpl.is_active !== false);
    setEditorMode('code');
    setEditorPreviewHtml('');
    setEditorPreviewSubject('');
  };

  const handleOpenCreateTemplate = () => {
    setIsCreatingTemplate(true);
    setEditingTemplate({
      id: 'new',
      name: 'New Custom Template',
      is_custom: true,
      variables: ['user_name', 'title', 'message', 'app_name', 'company_name', 'action_url'],
    });
    setEditName('');
    setEditCategory('custom');
    setEditSubject('{{title}} — {{app_name}}');
    setEditHtml(
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;"><div style="background: #065f46; padding: 20px; text-align: center; color: #ffffff;"><h2 style="margin: 0;">{{title}}</h2><p style="margin: 4px 0 0; font-size: 12px; color: #a7f3d0;">{{app_name}} by {{company_name}}</p></div><div style="padding: 24px; color: #1e293b; font-size: 14px; line-height: 1.6;"><p>Hi <strong>{{user_name}}</strong>,</p><p>{{message}}</p><p style="text-align: center; margin: 24px 0;"><a href="{{action_url}}" style="background: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 10px; font-weight: 700;">Open {{app_name}}</a></p></div></div>'
    );
    setEditText('Hi {{user_name}},\n\n{{title}}\n\n{{message}}\n\nOpen: {{action_url}}');
    setEditActive(true);
    setEditorMode('code');
    setEditorPreviewHtml('');
    setEditorPreviewSubject('');
  };

  const handleInsertVariable = (varName: string) => {
    setEditHtml((prev) => `${prev}{{${varName}}}`);
  };

  const handleLoadEditorPreview = async () => {
    if (!editingTemplate) return;
    try {
      const targetId = isCreatingTemplate ? 'tmpl_campaign_announcement' : editingTemplate.id;
      const res = await adminClient.previewEmailTemplate(targetId, {
        subject: editSubject,
        html_content: editHtml,
        text_content: editText,
      });
      if (res.success && res.rendered) {
        setEditorPreviewSubject(res.rendered.subject);
        setEditorPreviewHtml(res.rendered.html);
        setEditorMode('preview');
      } else {
        toast.error('Preview Error', res.message || 'Unable to render preview.');
      }
    } catch (err: any) {
      toast.error('Preview Error', err.message);
    }
  };

  const handleSaveTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingTemplate) return;

    setIsSavingTemplate(true);
    try {
      if (isCreatingTemplate) {
        const res = await adminClient.createEmailTemplate({
          name: editName,
          category: editCategory,
          subject: editSubject,
          html_content: editHtml,
          text_content: editText,
          is_active: editActive,
        });
        if (res.success) {
          toast.success('Template Created', 'Custom email template created and ready to send.');
          setEditingTemplate(null);
          setIsCreatingTemplate(false);
          await loadData();
        } else {
          toast.error('Create Failed', res.message || 'Could not create template.');
        }
      } else {
        const res = await adminClient.updateEmailTemplate(editingTemplate.id, {
          name: editName,
          category: editCategory,
          subject: editSubject,
          html_content: editHtml,
          text_content: editText,
          is_active: editActive,
        });
        if (res.success) {
          toast.success('Template Saved', 'Template updated and active for all automated & manual sends.');
          setEditingTemplate(null);
          await loadData();
        } else {
          toast.error('Failed', res.message || 'Could not save template.');
        }
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsSavingTemplate(false);
    }
  };

  const handleResetTemplate = async (tmpl: any) => {
    try {
      const res = await adminClient.resetEmailTemplate(tmpl.id);
      if (res.success) {
        toast.success('Restored Default', 'Template restored to HackifyPro default.');
        if (editingTemplate?.id === tmpl.id && res.template) {
          setEditName(res.template.name);
          setEditCategory(res.template.category);
          setEditSubject(res.template.subject);
          setEditHtml(res.template.html_content);
          setEditText(res.template.text_content);
          setEditActive(true);
        }
        await loadData();
      } else {
        toast.error('Reset Failed', res.message || 'Unable to reset template.');
      }
    } catch (err: any) {
      toast.error('Reset Error', err.message);
    }
  };

  const handleDeleteTemplate = async (tmpl: any) => {
    try {
      const res = await adminClient.deleteEmailTemplate(tmpl.id);
      if (res.success) {
        toast.success('Deleted', 'Custom template removed.');
        await loadData();
      } else {
        toast.error('Delete Failed', res.message || 'Built-in system templates cannot be deleted.');
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const handleOpenPreviewModal = async (tmpl: any) => {
    try {
      const res = await adminClient.previewEmailTemplate(tmpl.id);
      if (res.success && res.rendered) {
        setPreviewTemplateModal({
          name: tmpl.name,
          subject: res.rendered.subject,
          html: res.rendered.html,
          text: res.rendered.text,
        });
      } else {
        toast.error('Preview Error', res.message || 'Failed to render template preview.');
      }
    } catch (err: any) {
      toast.error('Preview Error', err.message);
    }
  };

  const handleOpenSendTemplateModal = (tmpl: any) => {
    const initialVars: Record<string, string> = {};
    const varsList: string[] = Array.isArray(tmpl.variables) ? tmpl.variables : [];
    for (const v of varsList) {
      if (['app_name', 'company_name', 'support_email', 'support_phone', 'date', 'year', 'login_url', 'app_url', 'action_url'].includes(v)) {
        continue;
      }
      if (v === 'user_name' || v === 'user_email' || v === 'user_id') continue;
      initialVars[v] = DEFAULT_SAMPLE_VARS[v] || '';
    }
    setSendVariables(initialVars);
    setSendTargetMode('custom_email');
    setSendCustomEmails('');
    setSendSelectedUserIds([]);
    setSendUserSearch('');
    setSendAlsoPush(true);
    setSendTemplateModal(tmpl);
  };

  const handleToggleSendUser = (uid: string) => {
    setSendSelectedUserIds((prev) =>
      prev.includes(uid) ? prev.filter((id) => id !== uid) : [...prev, uid]
    );
  };

  const handleDispatchTemplate = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!sendTemplateModal) return;

    if (sendTargetMode === 'custom_email' && !sendCustomEmails.trim()) {
      toast.error('Recipient Required', 'Please enter at least one recipient email address.');
      return;
    }
    if (sendTargetMode === 'selected_users' && sendSelectedUserIds.length === 0) {
      toast.error('Select Users', 'Please select at least one registered user.');
      return;
    }

    setIsDispatchingTemplate(true);
    try {
      const res = await adminClient.sendEmailTemplate(sendTemplateModal.id, {
        targetMode: sendTargetMode,
        emails: sendCustomEmails,
        userIds: sendSelectedUserIds,
        variables: sendVariables,
        alsoNotifyInAppAndPush: sendTargetMode !== 'custom_email' && sendAlsoPush,
      });

      if (res.success) {
        toast.success('Template Sent', res.message || 'Template dispatched successfully.');
        setSendTemplateModal(null);
      } else {
        toast.error('Send Failed', res.message || 'Could not dispatch template.');
      }
    } catch (err: any) {
      toast.error('Dispatch Error', err.message);
    } finally {
      setIsDispatchingTemplate(false);
    }
  };

  const handleSelectTestTemplate = (tmplId: string) => {
    setSelectedTestTemplateId(tmplId);
    const match = templates.find((t) => t.id === tmplId);
    if (match) {
      setTestSubject(match.subject);
      setTestHtml(match.html_content);
      toast.info('Template Loaded', `Loaded "${match.name}" into test composer.`);
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
            Template Manager ({templates.length || '17+'})
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
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
        </button>
      </div>

      {/* Sub-View 1: Email Logs Table */}
      {subView === 'logs' && (
        <div className="space-y-4">
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

                          <td className="p-3.5 max-w-xs">
                            <p className="text-slate-700 dark:text-slate-300 font-semibold line-clamp-2">
                              {log.subject}
                            </p>
                          </td>

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

                          <td className="p-3.5 text-slate-500 font-mono text-[11px] whitespace-nowrap">
                            {isSkipped ? (
                              <span className="text-slate-400 text-[10px]">0 / 0 (Skipped)</span>
                            ) : (
                              `${log.attempts} / ${log.max_attempts}`
                            )}
                          </td>

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

      {/* Sub-View 2: Templates Manager */}
      {subView === 'templates' && (
        <div className="space-y-4">
          {/* Toolbar */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 shadow-sm flex flex-col md:flex-row items-stretch md:items-center justify-between gap-3">
            <div className="flex flex-col sm:flex-row items-stretch sm:items-center gap-2.5 flex-1">
              <div className="relative flex-1">
                <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <input
                  type="text"
                  value={tmplSearchQuery}
                  onChange={(e) => setTmplSearchQuery(e.target.value)}
                  placeholder="Search templates (feedback, support, welcome, udhar, announcement)..."
                  className="w-full pl-9 pr-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-slate-800 dark:text-slate-200"
                />
              </div>

              <select
                value={tmplCategoryFilter}
                onChange={(e) => setTmplCategoryFilter(e.target.value)}
                className="px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold text-slate-700 dark:text-slate-300 capitalize cursor-pointer"
              >
                {TEMPLATE_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat === 'all' ? 'All Categories' : cat}
                  </option>
                ))}
              </select>
            </div>

            <button
              onClick={handleOpenCreateTemplate}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Create Custom Template</span>
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {filteredTemplates.map((tmpl) => (
              <div
                key={tmpl.id}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm flex flex-col justify-between gap-3"
              >
                <div className="space-y-3">
                  <div className="flex items-start justify-between gap-2">
                    <div>
                      <div className="flex flex-wrap items-center gap-1.5">
                        <span className="text-[10px] font-black uppercase tracking-wider text-emerald-600 bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full">
                          {tmpl.category}
                        </span>
                        {tmpl.is_custom && (
                          <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50 dark:bg-indigo-950 px-2 py-0.5 rounded-full">
                            Custom
                          </span>
                        )}
                        {!tmpl.is_custom && tmpl.is_customized && (
                          <span className="text-[10px] font-bold text-amber-600 bg-amber-50 dark:bg-amber-950/60 px-2 py-0.5 rounded-full">
                            Customized
                          </span>
                        )}
                      </div>
                      <h4 className="font-bold text-sm text-slate-800 dark:text-slate-200 mt-1.5">{tmpl.name}</h4>
                      <p className="text-[10px] font-mono text-slate-400">slug: {tmpl.slug}</p>
                    </div>
                    <span className="text-[10px] font-mono text-slate-400 shrink-0">v{tmpl.version || 1}.0</span>
                  </div>

                  <div>
                    <span className="text-[11px] font-semibold text-slate-400">Subject:</span>
                    <p className="text-xs font-bold text-slate-700 dark:text-slate-300 line-clamp-2">{tmpl.subject}</p>
                  </div>

                  {Array.isArray(tmpl.variables) && tmpl.variables.length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      {tmpl.variables.slice(0, 6).map((v: string) => (
                        <span
                          key={v}
                          className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300"
                        >
                          {`{{${v}}}`}
                        </span>
                      ))}
                      {tmpl.variables.length > 6 && (
                        <span className="text-[10px] text-slate-400 px-1">+{tmpl.variables.length - 6} more</span>
                      )}
                    </div>
                  )}
                </div>

                <div className="flex flex-wrap items-center justify-between gap-2 pt-3 border-t border-slate-100 dark:border-slate-800">
                  <span
                    className={`text-[10px] font-bold ${
                      tmpl.is_active ? 'text-emerald-600' : 'text-slate-400'
                    }`}
                  >
                    {tmpl.is_active ? '● Active' : 'Disabled'}
                  </span>

                  <div className="flex flex-wrap items-center gap-1.5">
                    <button
                      onClick={() => handleOpenPreviewModal(tmpl)}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold rounded-xl flex items-center gap-1 cursor-pointer"
                      title="Preview Rendered Template"
                    >
                      <Eye className="w-3.5 h-3.5" />
                      <span>Preview</span>
                    </button>

                    <button
                      onClick={() => handleOpenEditTemplate(tmpl)}
                      className="px-2.5 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-[11px] font-bold rounded-xl flex items-center gap-1 cursor-pointer"
                      title="Set / Edit Template"
                    >
                      <Edit3 className="w-3.5 h-3.5" />
                      <span>Set / Edit</span>
                    </button>

                    <button
                      onClick={() => handleOpenSendTemplateModal(tmpl)}
                      className="px-3 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-[11px] font-bold rounded-xl flex items-center gap-1 shadow-sm shadow-emerald-600/20 cursor-pointer"
                      title="Send This Template"
                    >
                      <Send className="w-3.5 h-3.5" />
                      <span>Send</span>
                    </button>

                    {tmpl.is_custom && (
                      <button
                        onClick={() => handleDeleteTemplate(tmpl)}
                        className="p-1.5 rounded-xl bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/40 text-rose-600 cursor-pointer"
                        title="Delete Custom Template"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
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
            Verifies SMTP connectivity or load any saved template to send a live test email right away.
          </p>

          <div>
            <label className="block text-[11px] font-bold text-slate-500 mb-1">Load from Saved Template (Optional)</label>
            <select
              value={selectedTestTemplateId}
              onChange={(e) => handleSelectTestTemplate(e.target.value)}
              className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold cursor-pointer"
            >
              <option value="">-- Custom / Blank Message --</option>
              {templates.map((t) => (
                <option key={t.id} value={t.id}>
                  [{t.category}] {t.name}
                </option>
              ))}
            </select>
          </div>

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
                rows={5}
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

      {/* Edit / Create Template Modal */}
      {editingTemplate && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  {isCreatingTemplate ? 'Create Custom Email Template' : `Set & Edit Template: ${editingTemplate.name}`}
                </h3>
                {!isCreatingTemplate && (
                  <p className="text-[11px] text-slate-400">
                    Changes saved here immediately apply to automated app emails and manual sends.
                  </p>
                )}
              </div>
              <button
                onClick={() => {
                  setEditingTemplate(null);
                  setIsCreatingTemplate(false);
                }}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode Switcher: Code vs Live Preview */}
            <div className="flex items-center justify-between gap-2">
              <div className="inline-flex bg-slate-100 dark:bg-slate-800 p-1 rounded-xl text-[11px] font-bold">
                <button
                  type="button"
                  onClick={() => setEditorMode('code')}
                  className={`px-3 py-1 rounded-lg cursor-pointer ${
                    editorMode === 'code' ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  Edit Template
                </button>
                <button
                  type="button"
                  onClick={handleLoadEditorPreview}
                  className={`px-3 py-1 rounded-lg cursor-pointer flex items-center gap-1 ${
                    editorMode === 'preview' ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'
                  }`}
                >
                  <Eye className="w-3 h-3" />
                  <span>Live Preview</span>
                </button>
              </div>

              {!isCreatingTemplate && !editingTemplate.is_custom && (
                <button
                  type="button"
                  onClick={() => handleResetTemplate(editingTemplate)}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-[11px] font-bold text-slate-600 dark:text-slate-300 flex items-center gap-1 cursor-pointer"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset to Default</span>
                </button>
              )}
            </div>

            {editorMode === 'preview' ? (
              <div className="flex-1 overflow-y-auto space-y-3">
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
                  <span className="text-[10px] font-bold uppercase text-slate-400 block">Rendered Subject</span>
                  <p className="font-bold text-slate-800 dark:text-slate-100 mt-0.5">{editorPreviewSubject}</p>
                </div>
                <iframe
                  title="Email Template Live Preview"
                  sandbox=""
                  srcDoc={editorPreviewHtml}
                  className="w-full h-80 bg-white rounded-2xl border border-slate-200 dark:border-slate-700"
                />
                <div className="flex justify-end">
                  <button
                    type="button"
                    onClick={() => setEditorMode('code')}
                    className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-xs font-bold cursor-pointer"
                  >
                    Back to Editor
                  </button>
                </div>
              </div>
            ) : (
              <form onSubmit={handleSaveTemplate} className="space-y-3 flex-1 overflow-y-auto pr-1">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Template Name *</label>
                    <input
                      type="text"
                      value={editName}
                      onChange={(e) => setEditName(e.target.value)}
                      placeholder="e.g. Monthly Update Announcement"
                      className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold"
                      required
                    />
                  </div>
                  <div>
                    <label className="block text-[11px] font-bold text-slate-500 mb-1">Category</label>
                    <select
                      value={editCategory}
                      onChange={(e) => setEditCategory(e.target.value)}
                      className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-semibold capitalize"
                    >
                      {TEMPLATE_CATEGORIES.filter((c) => c !== 'all').map((cat) => (
                        <option key={cat} value={cat}>
                          {cat}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Subject Line *</label>
                  <input
                    type="text"
                    value={editSubject}
                    onChange={(e) => setEditSubject(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                    required
                  />
                </div>

                {Array.isArray(editingTemplate.variables) && editingTemplate.variables.length > 0 && (
                  <div>
                    <span className="block text-[10px] font-bold text-slate-400 uppercase mb-1">
                      Click variable to insert into HTML body:
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {editingTemplate.variables.map((v: string) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => handleInsertVariable(v)}
                          className="text-[10px] font-mono px-2 py-0.5 rounded-lg bg-emerald-50 hover:bg-emerald-100 dark:bg-emerald-950/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800 cursor-pointer"
                        >
                          +{`{{${v}}}`}
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">HTML Template Body *</label>
                  <textarea
                    rows={7}
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
                    Template Active & Live for App Emails
                  </label>
                </div>

                <div className="flex items-center gap-3 pt-3">
                  <button
                    type="button"
                    onClick={() => {
                      setEditingTemplate(null);
                      setIsCreatingTemplate(false);
                    }}
                    className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSavingTemplate}
                    className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50"
                  >
                    {isSavingTemplate
                      ? 'Saving...'
                      : isCreatingTemplate
                        ? 'Create Template'
                        : 'Save & Set Template'}
                  </button>
                </div>
              </form>
            )}
          </div>
        </div>
      )}

      {/* Standalone Preview Modal */}
      {previewTemplateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-emerald-600" />
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Preview: {previewTemplateModal.name}
                </h3>
              </div>
              <button
                onClick={() => setPreviewTemplateModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-xs">
              <span className="text-[10px] font-bold uppercase text-slate-400 block">Subject</span>
              <p className="font-bold text-slate-800 dark:text-slate-100 mt-0.5">{previewTemplateModal.subject}</p>
            </div>

            <iframe
              title="Template Preview Frame"
              sandbox=""
              srcDoc={previewTemplateModal.html}
              className="w-full h-96 bg-white rounded-2xl border border-slate-200 dark:border-slate-700"
            />

            <div className="flex justify-end">
              <button
                onClick={() => setPreviewTemplateModal(null)}
                className="px-4 py-2 rounded-xl bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-200 text-xs font-bold cursor-pointer"
              >
                Close Preview
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Send Template Modal */}
      {sendTemplateModal && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[92vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2">
                <Send className="w-4 h-4 text-emerald-600" />
                <div>
                  <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                    Send Template: {sendTemplateModal.name}
                  </h3>
                  <p className="text-[11px] text-slate-400">
                    Dispatch to custom email addresses, selected registered users, or all active users.
                  </p>
                </div>
              </div>
              <button
                onClick={() => setSendTemplateModal(null)}
                className="p-1 text-slate-400 hover:text-slate-600 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleDispatchTemplate} className="space-y-4 flex-1 overflow-y-auto pr-1">
              {/* Target Mode Selector */}
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1.5">Recipients *</label>
                <div className="grid grid-cols-3 gap-2 text-xs font-bold">
                  <button
                    type="button"
                    onClick={() => setSendTargetMode('custom_email')}
                    className={`p-2.5 rounded-xl border text-center cursor-pointer transition-all ${
                      sendTargetMode === 'custom_email'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Mail className="w-4 h-4 mx-auto mb-1" />
                    Email Address(es)
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendTargetMode('selected_users')}
                    className={`p-2.5 rounded-xl border text-center cursor-pointer transition-all ${
                      sendTargetMode === 'selected_users'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <UserCheck className="w-4 h-4 mx-auto mb-1" />
                    Select Users
                  </button>
                  <button
                    type="button"
                    onClick={() => setSendTargetMode('all_active_users')}
                    className={`p-2.5 rounded-xl border text-center cursor-pointer transition-all ${
                      sendTargetMode === 'all_active_users'
                        ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-500 text-emerald-700 dark:text-emerald-300'
                        : 'bg-slate-50 dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300'
                    }`}
                  >
                    <Users className="w-4 h-4 mx-auto mb-1" />
                    All Active Users
                  </button>
                </div>
              </div>

              {sendTargetMode === 'custom_email' && (
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">
                    Recipient Email(s) (comma or new-line separated) *
                  </label>
                  <textarea
                    rows={2}
                    value={sendCustomEmails}
                    onChange={(e) => setSendCustomEmails(e.target.value)}
                    placeholder="user1@example.com, user2@example.com"
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
                    required
                  />
                </div>
              )}

              {sendTargetMode === 'selected_users' && (
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <label className="text-[11px] font-bold text-slate-500">
                      Select Registered Users ({sendSelectedUserIds.length} selected)
                    </label>
                    <input
                      type="text"
                      value={sendUserSearch}
                      onChange={(e) => setSendUserSearch(e.target.value)}
                      placeholder="Filter users..."
                      className="px-2.5 py-1 text-xs rounded-lg bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                    />
                  </div>
                  <div className="max-h-40 overflow-y-auto rounded-2xl border border-slate-200 dark:border-slate-700 divide-y divide-slate-100 dark:divide-slate-800">
                    {filteredSendUsers.length === 0 ? (
                      <p className="p-4 text-center text-xs text-slate-400">No active users found.</p>
                    ) : (
                      filteredSendUsers.map((u) => {
                        const checked = sendSelectedUserIds.includes(String(u.id));
                        return (
                          <label
                            key={u.id}
                            className="flex items-center justify-between px-3 py-2 text-xs hover:bg-slate-50 dark:hover:bg-slate-800/50 cursor-pointer"
                          >
                            <div className="flex items-center gap-2">
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={() => handleToggleSendUser(String(u.id))}
                                className="rounded text-emerald-600"
                              />
                              <span className="font-semibold text-slate-800 dark:text-slate-200">
                                {u.full_name || 'User'}
                              </span>
                            </div>
                            <span className="font-mono text-[11px] text-slate-500">{u.email}</span>
                          </label>
                        );
                      })
                    )}
                  </div>
                </div>
              )}

              {sendTargetMode === 'all_active_users' && (
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-800 text-xs text-amber-800 dark:text-amber-200 flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 shrink-0" />
                  <span>
                    Personalized with each user&apos;s name and sent to all{' '}
                    <strong>{filteredSendUsers.length || registeredUsers.length}</strong> active registered user(s).
                  </span>
                </div>
              )}

              {sendTargetMode !== 'custom_email' && (
                <label className="flex items-center gap-2 p-3 rounded-2xl bg-emerald-50/60 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900 cursor-pointer">
                  <input
                    type="checkbox"
                    checked={sendAlsoPush}
                    onChange={(e) => setSendAlsoPush(e.target.checked)}
                    className="rounded text-emerald-600"
                  />
                  <Bell className="w-4 h-4 text-emerald-600 shrink-0" />
                  <span className="text-xs font-semibold text-slate-700 dark:text-slate-200">
                    Also send External Push & In-App Notification (with sound) to selected user(s)
                  </span>
                </label>
              )}

              {/* Variable Inputs */}
              {Object.keys(sendVariables).length > 0 && (
                <div className="space-y-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <span className="block text-[11px] font-bold text-slate-500 uppercase">
                    Template Variables (Personalize Values)
                  </span>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2.5">
                    {Object.entries(sendVariables).map(([key, val]) => (
                      <div key={key}>
                        <label className="block text-[10px] font-mono font-bold text-slate-500 mb-1">
                          {`{{${key}}}`}
                        </label>
                        <input
                          type="text"
                          value={val}
                          onChange={(e) =>
                            setSendVariables((prev) => ({ ...prev, [key]: e.target.value }))
                          }
                          className="w-full px-3 py-1.5 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
                <button
                  type="button"
                  onClick={() => setSendTemplateModal(null)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isDispatchingTemplate}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 cursor-pointer disabled:opacity-50 flex items-center justify-center gap-1.5"
                >
                  <Send className="w-3.5 h-3.5" />
                  <span>{isDispatchingTemplate ? 'Sending Template...' : 'Send Template Now'}</span>
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

            <div className="p-5 overflow-y-auto space-y-4 text-xs">
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

              {selectedLog.last_error && (
                <div className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-900/60 text-rose-800 dark:text-rose-200">
                  <p className="font-bold text-[11px] flex items-center gap-1.5 mb-1">
                    <AlertTriangle className="w-3.5 h-3.5" />
                    Delivery Error / Reason
                  </p>
                  <p className="font-mono text-[11px] leading-relaxed break-words">{selectedLog.last_error}</p>
                </div>
              )}

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

              <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1">Subject</span>
                <p className="font-semibold text-slate-800 dark:text-slate-200">{selectedLog.subject}</p>
              </div>

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

              {selectedLog.metadata && Object.keys(selectedLog.metadata).length > 0 && (
                <div className="p-3 rounded-2xl bg-slate-50 dark:bg-slate-800/40 border border-slate-100 dark:border-slate-800">
                  <span className="text-[10px] uppercase font-bold text-slate-400 block mb-1.5">Attached Metadata</span>
                  <pre className="font-mono text-[10px] text-slate-600 dark:text-slate-300 bg-white dark:bg-slate-900 p-2.5 rounded-xl border border-slate-200 dark:border-slate-800 overflow-x-auto">
                    {JSON.stringify(selectedLog.metadata, null, 2)}
                  </pre>
                </div>
              )}
            </div>

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
