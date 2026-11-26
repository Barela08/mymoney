import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Unlock,
  Clock,
  Eye,
  Download,
  AlertTriangle,
  CheckCircle2,
  XCircle,
  FileText,
  Search,
  RefreshCw,
  Plus,
  UserCheck,
  KeyRound,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useAuth } from '../../../context/AuthContext';
import { useToast } from '../../../context/ToastContext';
import { ConfirmModal } from '../../common/ConfirmModal';

interface AccessRequest {
  id: string;
  requesting_admin_id: string;
  requesting_admin_email: string;
  requesting_admin_name?: string;
  target_user_id: string;
  target_user_email: string;
  target_user_name?: string;
  reason: string;
  purpose: string;
  data_scopes: string[];
  duration_minutes: number;
  status: 'pending' | 'approved' | 'rejected' | 'revoked' | 'expired';
  approved_by?: string;
  approved_by_email?: string;
  approved_at?: string;
  expires_at?: string;
  created_at: string;
}

export const AdminFinancialAccessTab: React.FC = () => {
  const { user } = useAuth();
  const toast = useToast();

  const isSuperAdmin = Boolean(
    user?.email &&
    (user.email.toLowerCase().trim() === 'hackifypro@gmail.com' ||
     user.email.toLowerCase().trim() === 'admin@mymoney.com' ||
     (user as any).role === 'superadmin')
  );

  const [activeSubTab, setActiveSubTab] = useState<'requests' | 'active_grants' | 'logs'>('requests');
  const [requests, setRequests] = useState<AccessRequest[]>([]);
  const [accessLogs, setAccessLogs] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [searchQuery, setSearchQuery] = useState<string>('');

  // Request Access Modal State
  const [isRequestModalOpen, setIsRequestModalOpen] = useState<boolean>(false);
  const [targetUserId, setTargetUserId] = useState<string>('');
  const [reason, setReason] = useState<string>('');
  const [purpose, setPurpose] = useState<string>('Support Ticket Troubleshooting');
  const [selectedScopes, setSelectedScopes] = useState<string[]>(['balance', 'transactions']);
  const [durationMinutes, setDurationMinutes] = useState<number>(60);
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // View Financial Data Modal State
  const [inspectModalOpen, setInspectModalOpen] = useState<boolean>(false);
  const [inspectingUser, setInspectingUser] = useState<{ id: string; email: string; name?: string } | null>(null);
  const [financialData, setFinancialData] = useState<any>(null);
  const [activeGrantInfo, setActiveGrantInfo] = useState<any>(null);
  const [isDataLoading, setIsDataLoading] = useState<boolean>(false);

  // Reject Reason Modal & Revoke Confirmation State
  const [pendingRejectId, setPendingRejectId] = useState<string | null>(null);
  const [rejectReasonInput, setRejectReasonInput] = useState<string>('');
  const [isRejecting, setIsRejecting] = useState<boolean>(false);
  const [pendingRevokeId, setPendingRevokeId] = useState<string | null>(null);
  const [isRevoking, setIsRevoking] = useState<boolean>(false);

  const allScopes = [
    { key: 'balance', label: 'Account Balance & Totals', desc: 'Current available balance, income vs expense totals' },
    { key: 'transactions', label: 'Transaction History', desc: 'Recent debits, credits, and merchant descriptions' },
    { key: 'income', label: 'Received Money / Salary', desc: 'Salary, freelance and business earnings' },
    { key: 'expense', label: 'Daily Expense Records', desc: 'Food, Room, Travel and lifestyle expenses' },
    { key: 'budgets', label: 'Budget Thresholds', desc: 'Category-wise spending limits' },
    { key: 'recurring_bills', label: 'Recurring Subscriptions', desc: 'Scheduled bill amounts and due dates' },
    { key: 'udhar', label: 'Udhar Ledger', desc: 'Mutual loans given and borrowed' },
  ];

  const fetchRequests = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getFinancialAccessRequests();
      if (res.success && Array.isArray(res.requests)) {
        setRequests(res.requests);
      }
    } catch (err: any) {
      toast.error('Failed to load requests', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const fetchLogs = async () => {
    try {
      const res = await adminClient.getFinancialAccessLogs();
      if (res.success && Array.isArray(res.logs)) {
        setAccessLogs(res.logs);
      }
    } catch (err: any) {
      console.warn('Could not load access logs:', err.message);
    }
  };

  useEffect(() => {
    fetchRequests();
    fetchLogs();
  }, []);

  const handleCreateRequest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetUserId.trim()) {
      toast.error('Validation Error', 'Target User ID is required.');
      return;
    }
    if (reason.trim().length < 10) {
      toast.error('Validation Error', 'A specific reason (minimum 10 characters) is mandatory.');
      return;
    }
    if (selectedScopes.length === 0) {
      toast.error('Validation Error', 'Please select at least one data scope.');
      return;
    }

    setIsSubmitting(true);
    try {
      const res = await adminClient.requestFinancialAccess({
        targetUserId: targetUserId.trim(),
        reason: reason.trim(),
        purpose,
        dataScopes: selectedScopes,
        durationMinutes,
      });

      if (res.success) {
        toast.success('Access Request Submitted', res.message);
        setIsRequestModalOpen(false);
        setTargetUserId('');
        setReason('');
        setSelectedScopes(['balance', 'transactions']);
        fetchRequests();
      }
    } catch (err: any) {
      toast.error('Submission Failed', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleApprove = async (id: string) => {
    try {
      const res = await adminClient.approveFinancialAccess(id);
      if (res.success) {
        toast.success('Grant Approved', res.message);
        fetchRequests();
      }
    } catch (err: any) {
      toast.error('Approval Failed', err.message);
    }
  };

  const handleReject = (id: string) => {
    setPendingRejectId(id);
    setRejectReasonInput('');
  };

  const confirmReject = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!pendingRejectId || isRejecting) return;
    const trimmedReason = rejectReasonInput.trim();
    if (!trimmedReason) {
      toast.error('Validation Error', 'Please provide a reason for declining this access request.');
      return;
    }
    try {
      setIsRejecting(true);
      const res = await adminClient.rejectFinancialAccess(pendingRejectId, trimmedReason);
      if (res.success) {
        toast.success('Request Rejected', res.message);
        setPendingRejectId(null);
        setRejectReasonInput('');
        fetchRequests();
      }
    } catch (err: any) {
      toast.error('Rejection Failed', err.message);
    } finally {
      setIsRejecting(false);
    }
  };

  const handleRevoke = (id: string) => {
    setPendingRevokeId(id);
  };

  const confirmRevoke = async () => {
    if (!pendingRevokeId || isRevoking) return;
    try {
      setIsRevoking(true);
      const res = await adminClient.revokeFinancialAccess(pendingRevokeId, 'Manually terminated by administrator');
      if (res.success) {
        toast.success('Grant Revoked', res.message);
        setPendingRevokeId(null);
        fetchRequests();
      }
    } catch (err: any) {
      toast.error('Revocation Failed', err.message);
    } finally {
      setIsRevoking(false);
    }
  };

  const handleInspectFinancialData = async (reqItem: AccessRequest) => {
    setInspectingUser({
      id: reqItem.target_user_id,
      email: reqItem.target_user_email,
      name: reqItem.target_user_name,
    });
    setInspectModalOpen(true);
    setIsDataLoading(true);
    try {
      const res = await adminClient.getUserFinancialData(reqItem.target_user_id);
      if (res.success) {
        setFinancialData(res.financialData);
        setActiveGrantInfo(res.grant);
      }
    } catch (err: any) {
      toast.error('Access Blocked', err.message || 'Approved grant required.');
      setInspectModalOpen(false);
    } finally {
      setIsDataLoading(false);
    }
  };

  const handleExportData = async (userId: string) => {
    try {
      const res = await adminClient.exportUserFinancialData(userId);
      if (res.success && res.exportData) {
        const jsonStr = `data:text/json;charset=utf-8,${encodeURIComponent(JSON.stringify(res.exportData, null, 2))}`;
        const downloadAnchor = document.createElement('a');
        downloadAnchor.setAttribute('href', jsonStr);
        downloadAnchor.setAttribute('download', `financial_records_${userId}.json`);
        document.body.appendChild(downloadAnchor);
        downloadAnchor.click();
        downloadAnchor.remove();
        toast.success('Export Successful', `Exported ${res.recordCount} verified records.`);
      }
    } catch (err: any) {
      toast.error('Export Failed', err.message);
    }
  };

  const toggleScope = (scopeKey: string) => {
    if (selectedScopes.includes(scopeKey)) {
      setSelectedScopes(selectedScopes.filter((s) => s !== scopeKey));
    } else {
      setSelectedScopes([...selectedScopes, scopeKey]);
    }
  };

  // Filter requests
  const filteredRequests = requests.filter((r) => {
    const q = searchQuery.toLowerCase();
    const matchesQuery =
      r.target_user_email.toLowerCase().includes(q) ||
      (r.target_user_name || '').toLowerCase().includes(q) ||
      r.requesting_admin_email.toLowerCase().includes(q) ||
      r.reason.toLowerCase().includes(q);

    if (!matchesQuery) return false;
    if (activeSubTab === 'active_grants') return r.status === 'approved';
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Top Banner / Privacy Principle Notice */}
      <div className="bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-sm">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="flex items-start gap-3">
            <div className="p-2.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 shrink-0">
              <ShieldAlert className="w-5 h-5 stroke-[1.75]" />
            </div>
            <div>
              <h2 className="text-base font-bold text-white flex items-center gap-2">
                Sensitive Financial Data Access
                <span className="text-[11px] font-semibold px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20">
                  DPDP & Privacy Guarded
                </span>
              </h2>
              <p className="text-xs text-slate-400 mt-1 max-w-2xl leading-relaxed">
                By default, user financial records are strictly isolated. Staff administrators cannot view user finances without an explicit, purpose-limited, time-limited grant approved by the Super Admin. All views and exports generate immutable audit logs.
              </p>
            </div>
          </div>
          <button
            onClick={() => setIsRequestModalOpen(true)}
            className="flex items-center gap-1.5 px-4 py-2 bg-emerald-600 hover:bg-emerald-500 active:scale-[0.99] text-white text-xs font-semibold rounded-xl transition-colors shrink-0 shadow-sm shadow-emerald-600/20 cursor-pointer"
          >
            <Plus className="w-4 h-4 stroke-[2]" />
            <span>Request Access</span>
          </button>
        </div>
      </div>

      {/* Tabs Navigation */}
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-2 flex-wrap">
        <div className="flex items-center gap-2">
          <button
            onClick={() => setActiveSubTab('requests')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer ${
              activeSubTab === 'requests'
                ? 'bg-slate-800 text-white border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            All Requests ({requests.length})
          </button>
          <button
            onClick={() => setActiveSubTab('active_grants')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'active_grants'
                ? 'bg-emerald-950/60 text-emerald-300 border border-emerald-800'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <Unlock className="w-3.5 h-3.5 text-emerald-400" />
            <span>Active Grants ({requests.filter((r) => r.status === 'approved').length})</span>
          </button>
          <button
            onClick={() => setActiveSubTab('logs')}
            className={`px-3 py-1.5 rounded-xl text-xs font-semibold transition-colors cursor-pointer flex items-center gap-1.5 ${
              activeSubTab === 'logs'
                ? 'bg-slate-800 text-white border border-slate-700'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-3.5 h-3.5" />
            <span>Access Audit Logs ({accessLogs.length})</span>
          </button>
        </div>

        {/* Search Input */}
        <div className="relative w-full sm:w-64">
          <Search className="w-3.5 h-3.5 absolute left-3 top-2.5 text-slate-500" />
          <input
            type="text"
            placeholder="Search email, admin, reason..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="w-full pl-8 pr-3 py-1.5 bg-slate-900 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-500 focus:outline-none focus:border-emerald-500"
          />
        </div>
      </div>

      {/* Main Content Area */}
      {activeSubTab === 'logs' ? (
        /* Access Audit Trail Table */
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-slate-800 bg-slate-950/40 flex items-center justify-between">
            <span className="text-xs font-bold text-slate-300">Immutable Financial Access Audit Trail</span>
            <button
              onClick={fetchLogs}
              className="text-xs text-slate-400 hover:text-white flex items-center gap-1 cursor-pointer"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Refresh</span>
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-2.5 px-4">Timestamp</th>
                  <th className="py-2.5 px-4">Admin</th>
                  <th className="py-2.5 px-4">Target User</th>
                  <th className="py-2.5 px-4">Action</th>
                  <th className="py-2.5 px-4">Data Scope</th>
                  <th className="py-2.5 px-4">IP Address</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {accessLogs.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="text-center py-8 text-slate-500">
                      No financial data access events logged yet.
                    </td>
                  </tr>
                ) : (
                  accessLogs.map((log) => (
                    <tr key={log.id} className="hover:bg-slate-800/30 transition-colors">
                      <td className="py-2.5 px-4 text-slate-400 font-mono text-[11px]">
                        {new Date(log.created_at).toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' })}
                      </td>
                      <td className="py-2.5 px-4 font-medium text-white">{log.admin_email}</td>
                      <td className="py-2.5 px-4">{log.target_user_email}</td>
                      <td className="py-2.5 px-4">
                        <span className="px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 font-mono text-[11px]">
                          {log.action}
                        </span>
                      </td>
                      <td className="py-2.5 px-4 text-slate-400">{log.data_scope}</td>
                      <td className="py-2.5 px-4 font-mono text-[11px] text-slate-500">{log.ip_address || '—'}</td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      ) : (
        /* Requests & Grants Listing */
        <div className="bg-slate-900 border border-slate-800 rounded-2xl overflow-hidden">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-950/60 text-slate-400 font-semibold border-b border-slate-800">
                <tr>
                  <th className="py-3 px-4">Target User</th>
                  <th className="py-3 px-4">Requester</th>
                  <th className="py-3 px-4">Purpose & Reason</th>
                  <th className="py-3 px-4">Requested Scopes</th>
                  <th className="py-3 px-4">Duration</th>
                  <th className="py-3 px-4">Status</th>
                  <th className="py-3 px-4 text-right">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-800/60 text-slate-300">
                {isLoading ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8">
                      <div className="inline-flex items-center gap-2 text-slate-400">
                        <RefreshCw className="w-4 h-4 animate-spin text-emerald-500" />
                        <span>Loading access requests...</span>
                      </div>
                    </td>
                  </tr>
                ) : filteredRequests.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="text-center py-8 text-slate-500">
                      No access requests found matching your filter.
                    </td>
                  </tr>
                ) : (
                  filteredRequests.map((reqItem) => {
                    const isApproved = reqItem.status === 'approved';
                    const isPending = reqItem.status === 'pending';
                    const isExpired = reqItem.status === 'expired' || (reqItem.expires_at && new Date(reqItem.expires_at).getTime() < Date.now());

                    return (
                      <tr key={reqItem.id} className="hover:bg-slate-800/30 transition-colors">
                        <td className="py-3 px-4">
                          <p className="font-semibold text-white">{reqItem.target_user_email}</p>
                          <p className="text-[11px] text-slate-400">{reqItem.target_user_name || 'Registered Account'}</p>
                        </td>
                        <td className="py-3 px-4">
                          <p className="font-medium text-slate-300">{reqItem.requesting_admin_email}</p>
                          <p className="text-[11px] text-slate-500">
                            {new Date(reqItem.created_at).toLocaleDateString('en-IN')}
                          </p>
                        </td>
                        <td className="py-3 px-4 max-w-xs">
                          <p className="font-semibold text-emerald-400 text-[11px] uppercase tracking-wider">{reqItem.purpose}</p>
                          <p className="text-slate-300 truncate" title={reqItem.reason}>{reqItem.reason}</p>
                        </td>
                        <td className="py-3 px-4">
                          <div className="flex flex-wrap gap-1 max-w-xs">
                            {(reqItem.data_scopes || []).map((s) => (
                              <span key={s} className="px-1.5 py-0.5 rounded bg-slate-800 text-[10px] text-slate-300">
                                {s}
                              </span>
                            ))}
                          </div>
                        </td>
                        <td className="py-3 px-4">
                          <span className="font-mono text-slate-300">{reqItem.duration_minutes}m</span>
                        </td>
                        <td className="py-3 px-4">
                          {isApproved && !isExpired ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 text-[11px] font-semibold">
                              <Unlock className="w-3 h-3" />
                              <span>Active Grant</span>
                            </span>
                          ) : isPending ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-amber-500/10 text-amber-400 border border-amber-500/20 text-[11px] font-semibold">
                              <Clock className="w-3 h-3" />
                              <span>Pending Review</span>
                            </span>
                          ) : reqItem.status === 'rejected' ? (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose-500/10 text-rose-400 border border-rose-500/20 text-[11px] font-semibold">
                              <XCircle className="w-3 h-3" />
                              <span>Rejected</span>
                            </span>
                          ) : (
                            <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-slate-800 text-slate-400 text-[11px] font-medium">
                              <Lock className="w-3 h-3" />
                              <span>{reqItem.status === 'revoked' ? 'Revoked' : 'Expired'}</span>
                            </span>
                          )}
                        </td>
                        <td className="py-3 px-4 text-right">
                          <div className="flex items-center justify-end gap-1.5">
                            {isApproved && !isExpired && (
                              <button
                                onClick={() => handleInspectFinancialData(reqItem)}
                                className="px-2.5 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs flex items-center gap-1 transition-colors cursor-pointer"
                                title="View Scoped Financial Records"
                              >
                                <Eye className="w-3 h-3" />
                                <span>View Data</span>
                              </button>
                            )}

                            {isPending && isSuperAdmin && (
                              <>
                                <button
                                  onClick={() => handleApprove(reqItem.id)}
                                  className="px-2 py-1 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white font-medium text-xs transition-colors cursor-pointer"
                                  title="Approve Temporary Grant"
                                >
                                  Approve
                                </button>
                                <button
                                  onClick={() => handleReject(reqItem.id)}
                                  className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-950/60 hover:text-rose-400 text-slate-300 font-medium text-xs transition-colors cursor-pointer"
                                  title="Decline Request"
                                >
                                  Reject
                                </button>
                              </>
                            )}

                            {isApproved && !isExpired && isSuperAdmin && (
                              <button
                                onClick={() => handleRevoke(reqItem.id)}
                                className="px-2 py-1 rounded-lg bg-slate-800 hover:bg-rose-900/60 text-rose-400 font-medium text-xs transition-colors cursor-pointer"
                                title="Terminate Grant Early"
                              >
                                Revoke
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
      )}

      {/* REQUEST FINANCIAL DATA ACCESS MODAL */}
      {isRequestModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-lg w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <div className="flex items-center gap-2">
                <div className="p-2 rounded-lg bg-emerald-500/10 text-emerald-400">
                  <KeyRound className="w-4 h-4" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white">Request Financial Data Access</h3>
                  <p className="text-[11px] text-slate-400">Strictly purpose-limited & time-bound</p>
                </div>
              </div>
              <button
                onClick={() => setIsRequestModalOpen(false)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={handleCreateRequest} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Target User ID (UUID)</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. 6e39fc40-08a0-4eae-8d1e-66ba692838f4"
                  value={targetUserId}
                  onChange={(e) => setTargetUserId(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">Purpose Category</label>
                <select
                  value={purpose}
                  onChange={(e) => setPurpose(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white focus:outline-none focus:border-emerald-500"
                >
                  <option value="Support Ticket Troubleshooting">Customer Support Troubleshooting</option>
                  <option value="Disputed Transaction Audit">Disputed Transaction / Udhar Audit</option>
                  <option value="Data Correction Request">User-Authorized Data Correction</option>
                  <option value="Legal & Compliance Investigation">Legal & Statutory Compliance</option>
                </select>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Mandatory Specific Reason (Min 10 characters)
                </label>
                <textarea
                  required
                  rows={2}
                  placeholder="Detail why viewing this customer's private financial records is required..."
                  value={reason}
                  onChange={(e) => setReason(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1.5">
                  Minimum Required Data Scopes
                </label>
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-40 overflow-y-auto p-1 bg-slate-950/60 rounded-xl border border-slate-800">
                  {allScopes.map((scope) => (
                    <label
                      key={scope.key}
                      onClick={() => toggleScope(scope.key)}
                      className={`flex items-start gap-2 p-2 rounded-lg border text-xs cursor-pointer transition-colors ${
                        selectedScopes.includes(scope.key)
                          ? 'bg-emerald-950/40 border-emerald-600/50 text-white'
                          : 'bg-slate-900 border-slate-800 text-slate-400 hover:border-slate-700'
                      }`}
                    >
                      <input
                        type="checkbox"
                        checked={selectedScopes.includes(scope.key)}
                        onChange={() => {}}
                        className="mt-0.5 rounded text-emerald-500 focus:ring-0"
                      />
                      <div className="min-w-0">
                        <p className="font-semibold text-[11px] leading-tight">{scope.label}</p>
                        <p className="text-[10px] text-slate-500 truncate">{scope.desc}</p>
                      </div>
                    </label>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Grant Duration: <span className="text-emerald-400 font-mono">{durationMinutes} minutes</span>
                </label>
                <input
                  type="range"
                  min="15"
                  max="480"
                  step="15"
                  value={durationMinutes}
                  onChange={(e) => setDurationMinutes(parseInt(e.target.value, 10))}
                  className="w-full accent-emerald-500"
                />
                <div className="flex justify-between text-[10px] text-slate-500">
                  <span>15m (Quick fix)</span>
                  <span>60m (Standard)</span>
                  <span>480m (Max shift)</span>
                </div>
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  onClick={() => setIsRequestModalOpen(false)}
                  className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmitting}
                  className="px-5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white font-semibold text-xs shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  {isSubmitting ? 'Submitting...' : isSuperAdmin ? 'Authorize & Grant Access' : 'Submit for Approval'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* INSPECT AUTHORIZED FINANCIAL DATA DRAWER / MODAL */}
      {inspectModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-4xl w-full max-h-[90vh] flex flex-col shadow-2xl overflow-hidden">
            {/* Header */}
            <div className="px-6 py-4 border-b border-slate-800 flex items-center justify-between bg-slate-950/60">
              <div className="flex items-center gap-3">
                <div className="p-2 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                  <Unlock className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-bold text-sm text-white flex items-center gap-2">
                    Authorized Financial Ledger: {inspectingUser?.email}
                    {activeGrantInfo && (
                      <span className="text-[11px] font-mono px-2 py-0.5 rounded-full bg-emerald-500/10 text-emerald-400 border border-emerald-500/20">
                        Expires in {activeGrantInfo.minutesRemaining}m
                      </span>
                    )}
                  </h3>
                  <p className="text-xs text-slate-400">Viewing authorized records under active grant. All interactions audited.</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {inspectingUser && (
                  <button
                    onClick={() => handleExportData(inspectingUser.id)}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-white text-xs font-semibold transition-colors cursor-pointer"
                  >
                    <Download className="w-3.5 h-3.5" />
                    <span>Export JSON</span>
                  </button>
                )}
                <button
                  onClick={() => setInspectModalOpen(false)}
                  className="text-slate-400 hover:text-white p-1.5 rounded-lg cursor-pointer"
                >
                  ✕
                </button>
              </div>
            </div>

            {/* Body */}
            <div className="p-6 overflow-y-auto space-y-6 flex-1">
              {isDataLoading ? (
                <div className="py-20 text-center text-slate-400 flex flex-col items-center justify-center gap-2">
                  <RefreshCw className="w-6 h-6 animate-spin text-emerald-500" />
                  <span>Loading authorized customer financial records...</span>
                </div>
              ) : financialData ? (
                <>
                  {/* Summary Metric Cards */}
                  {financialData.summary && (
                    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                        <span className="text-[11px] text-slate-400 font-medium">Net Available Balance</span>
                        <p className={`text-lg font-bold font-mono mt-1 ${financialData.summary.netBalance >= 0 ? 'text-emerald-400' : 'text-rose-400'}`}>
                          ₹{financialData.summary.netBalance.toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                        <span className="text-[11px] text-slate-400 font-medium">Total Income</span>
                        <p className="text-lg font-bold font-mono text-emerald-400 mt-1">
                          ₹{financialData.summary.totalIncome.toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                        <span className="text-[11px] text-slate-400 font-medium">Total Expenses</span>
                        <p className="text-lg font-bold font-mono text-rose-400 mt-1">
                          ₹{financialData.summary.totalExpense.toLocaleString('en-IN')}
                        </p>
                      </div>
                      <div className="bg-slate-950 p-3.5 rounded-xl border border-slate-800">
                        <span className="text-[11px] text-slate-400 font-medium">Transactions Count</span>
                        <p className="text-lg font-bold font-mono text-white mt-1">
                          {financialData.summary.transactionCount}
                        </p>
                      </div>
                    </div>
                  )}

                  {/* Transactions Table */}
                  {financialData.transactions && (
                    <div className="border border-slate-800 rounded-xl overflow-hidden">
                      <div className="px-4 py-2.5 bg-slate-950 border-b border-slate-800 text-xs font-semibold text-slate-300">
                        Scoped Transaction Records ({financialData.transactions.length})
                      </div>
                      <div className="max-h-72 overflow-y-auto">
                        <table className="w-full text-left text-xs">
                          <thead className="bg-slate-950/70 text-slate-400 border-b border-slate-800 font-medium">
                            <tr>
                              <th className="py-2 px-3">Date</th>
                              <th className="py-2 px-3">Title</th>
                              <th className="py-2 px-3">Category</th>
                              <th className="py-2 px-3">Type</th>
                              <th className="py-2 px-3 text-right">Amount</th>
                            </tr>
                          </thead>
                          <tbody className="divide-y divide-slate-800/60 text-slate-300">
                            {financialData.transactions.length === 0 ? (
                              <tr>
                                <td colSpan={5} className="py-4 text-center text-slate-500">
                                  No transaction records found for this user.
                                </td>
                              </tr>
                            ) : (
                              financialData.transactions.map((tx: any) => (
                                <tr key={tx.id} className="hover:bg-slate-800/30">
                                  <td className="py-2 px-3 text-slate-400 font-mono text-[11px]">
                                    {tx.transaction_date}
                                  </td>
                                  <td className="py-2 px-3 font-medium text-white">{tx.title || 'Untitled'}</td>
                                  <td className="py-2 px-3 text-slate-400">{tx.category}</td>
                                  <td className="py-2 px-3">
                                    <span className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                      tx.transaction_type === 'income' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'
                                    }`}>
                                      {tx.transaction_type}
                                    </span>
                                  </td>
                                  <td className={`py-2 px-3 text-right font-mono font-bold ${
                                    tx.transaction_type === 'income' ? 'text-emerald-400' : 'text-rose-400'
                                  }`}>
                                    {tx.transaction_type === 'income' ? '+' : '-'}₹{Number(tx.amount).toLocaleString('en-IN')}
                                  </td>
                                </tr>
                              ))
                            )}
                          </tbody>
                        </table>
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <div className="py-12 text-center text-slate-500">No data returned.</div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* REJECT ACCESS REQUEST MODAL */}
      {pendingRejectId && (
        <div
          role="dialog"
          aria-modal="true"
          className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4"
        >
          <div className="bg-slate-900 border border-slate-800 rounded-2xl max-w-md w-full p-6 shadow-2xl space-y-4">
            <div className="flex items-center justify-between border-b border-slate-800 pb-3">
              <h3 className="font-bold text-sm text-white flex items-center gap-2">
                <XCircle className="w-4 h-4 text-rose-400" />
                <span>Decline Financial Access Request</span>
              </h3>
              <button
                type="button"
                disabled={isRejecting}
                onClick={() => setPendingRejectId(null)}
                className="text-slate-400 hover:text-white p-1 rounded-lg cursor-pointer"
              >
                ✕
              </button>
            </div>

            <form onSubmit={confirmReject} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-300 mb-1">
                  Reason for declining access request *
                </label>
                <textarea
                  required
                  rows={3}
                  autoFocus
                  placeholder="Enter the reason for declining this financial access request..."
                  value={rejectReasonInput}
                  onChange={(e) => setRejectReasonInput(e.target.value)}
                  className="w-full px-3 py-2 bg-slate-950 border border-slate-800 rounded-xl text-xs text-white placeholder-slate-600 focus:outline-none focus:border-rose-500"
                />
              </div>

              <div className="flex items-center justify-end gap-2 pt-2 border-t border-slate-800">
                <button
                  type="button"
                  disabled={isRejecting}
                  onClick={() => setPendingRejectId(null)}
                  className="px-4 py-2 rounded-xl text-xs text-slate-400 hover:text-white cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isRejecting || !rejectReasonInput.trim()}
                  className="px-5 py-2 rounded-xl bg-rose-600 hover:bg-rose-500 text-white font-semibold text-xs shadow-md transition-all cursor-pointer disabled:opacity-50"
                >
                  {isRejecting ? 'Declining...' : 'Decline Request'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      <ConfirmModal
        isOpen={!!pendingRevokeId}
        title="Revoke Financial Access Grant?"
        subtitle="Access to scoped user records will end immediately."
        message="Are you sure you want to immediately revoke this access grant?"
        confirmLabel="Revoke Grant"
        isDestructive={true}
        isLoading={isRevoking}
        onConfirm={confirmRevoke}
        onCancel={() => !isRevoking && setPendingRevokeId(null)}
      />
    </div>
  );
};
