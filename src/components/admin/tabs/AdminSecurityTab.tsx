import React, { useState, useEffect } from 'react';
import {
  ShieldAlert,
  ShieldCheck,
  Lock,
  Laptop,
  Plus,
  RefreshCw,
  Search,
  AlertTriangle,
  CheckCircle2,
  X,
  Clock,
  RotateCcw,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

export const AdminSecurityTab: React.FC = () => {
  const toast = useToast();
  const [subView, setSubView] = useState<'incidents' | 'logins' | 'sessions'>('incidents');
  const [incidents, setIncidents] = useState<any[]>([]);
  const [loginAttempts, setLoginAttempts] = useState<any[]>([]);
  const [sessions, setSessions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // New Incident Modal
  const [isNewIncidentOpen, setIsNewIncidentOpen] = useState(false);
  const [incidentTitle, setIncidentTitle] = useState('');
  const [incidentSeverity, setIncidentSeverity] = useState('medium');
  const [incidentDesc, setIncidentDesc] = useState('');
  const [incidentUserEmail, setIncidentUserEmail] = useState('');
  const [isCreatingIncident, setIsCreatingIncident] = useState(false);

  // Edit Incident Modal
  const [selectedIncident, setSelectedIncident] = useState<any>(null);
  const [incidentStatus, setIncidentStatus] = useState('investigating');
  const [incidentNotes, setIncidentNotes] = useState('');

  const loadData = async () => {
    setIsLoading(true);
    try {
      if (subView === 'incidents') {
        const res = await adminClient.getSecurityIncidents();
        if (res.success) setIncidents(res.incidents || []);
      } else if (subView === 'logins') {
        const res = await adminClient.getLoginAttempts();
        if (res.success) setLoginAttempts(res.attempts || []);
      } else if (subView === 'sessions') {
        const res = await adminClient.getActiveSessions();
        if (res.success) setSessions(res.sessions || []);
      }
    } catch (err: any) {
      toast.error('Security Query Error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, [subView]);

  const handleCreateIncident = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!incidentTitle.trim() || !incidentDesc.trim()) {
      toast.error('Validation', 'Title and description are required.');
      return;
    }

    setIsCreatingIncident(true);
    try {
      const res = await adminClient.createSecurityIncident({
        title: incidentTitle.trim(),
        severity: incidentSeverity,
        description: incidentDesc.trim(),
        userEmail: incidentUserEmail.trim() || undefined,
      });

      if (res.success) {
        toast.success('Incident Created', 'Security anomaly logged and queued for investigation.');
        setIsNewIncidentOpen(false);
        setIncidentTitle('');
        setIncidentDesc('');
        setIncidentUserEmail('');
        await loadData();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsCreatingIncident(false);
    }
  };

  const handleUpdateIncident = async () => {
    if (!selectedIncident) return;
    try {
      const res = await adminClient.updateSecurityIncident(selectedIncident.id, {
        status: incidentStatus,
        internal_notes: incidentNotes,
      });
      if (res.success) {
        toast.success('Incident Updated', 'Security incident status and notes saved.');
        setSelectedIncident(null);
        await loadData();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const handleRevokeSession = async (sessionId: string) => {
    try {
      const res = await adminClient.revokeSingleSession(sessionId);
      if (res.success) {
        toast.success('Session Revoked', 'Target session was terminated immediately.');
        await loadData();
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  return (
    <div className="space-y-6">
      {/* Sub-navigation Controls */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 bg-white dark:bg-slate-900 p-4 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-sm">
        <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl text-xs font-bold w-full sm:w-auto">
          <button
            onClick={() => setSubView('incidents')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all cursor-pointer ${
              subView === 'incidents' ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'
            }`}
          >
            Incidents & Anomalies
          </button>
          <button
            onClick={() => setSubView('logins')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all cursor-pointer ${
              subView === 'logins' ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'
            }`}
          >
            Login Attempts
          </button>
          <button
            onClick={() => setSubView('sessions')}
            className={`flex-1 sm:flex-none px-4 py-2 rounded-xl transition-all cursor-pointer ${
              subView === 'sessions' ? 'bg-white dark:bg-slate-700 text-emerald-600 shadow-sm' : 'text-slate-500'
            }`}
          >
            Active Sessions
          </button>
        </div>

        <div className="flex items-center gap-2">
          {subView === 'incidents' && (
            <button
              onClick={() => setIsNewIncidentOpen(true)}
              className="px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20 flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Report Incident</span>
            </button>
          )}

          <button
            onClick={loadData}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
            title="Refresh"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      {/* Sub-View 1: Incidents Table */}
      {subView === 'incidents' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-700 dark:text-slate-300">
              Security Incidents ({incidents.length} Recorded)
            </span>
            <span className="text-slate-400">Strict zero-disclosure incident tracking</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-3.5">Incident Number</th>
                  <th className="p-3.5">Title & Description</th>
                  <th className="p-3.5">Severity</th>
                  <th className="p-3.5">Status</th>
                  <th className="p-3.5">Target Account</th>
                  <th className="p-3.5">Assigned To</th>
                  <th className="p-3.5 text-right">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {incidents.length === 0 ? (
                  <tr>
                    <td colSpan={7} className="p-8 text-center text-slate-400">
                      No security incidents reported.
                    </td>
                  </tr>
                ) : (
                  incidents.map((inc) => (
                    <tr key={inc.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="p-3.5 font-mono font-bold text-indigo-600">{inc.incident_number}</td>
                      <td className="p-3.5">
                        <p className="font-bold text-slate-800 dark:text-slate-200">{inc.title}</p>
                        <p className="text-[11px] text-slate-400 max-w-sm truncate">{inc.description}</p>
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                            inc.severity === 'critical'
                              ? 'bg-rose-100 text-rose-700 dark:bg-rose-950 dark:text-rose-300'
                              : inc.severity === 'high'
                              ? 'bg-amber-100 text-amber-700 dark:bg-amber-950 dark:text-amber-300'
                              : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}
                        >
                          {inc.severity}
                        </span>
                      </td>
                      <td className="p-3.5">
                        <span className="font-bold capitalize text-slate-700 dark:text-slate-300">{inc.status}</span>
                      </td>
                      <td className="p-3.5 font-mono text-slate-500">{inc.user_email || 'General'}</td>
                      <td className="p-3.5 text-slate-500">{inc.assigned_to || 'Unassigned'}</td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => {
                            setSelectedIncident(inc);
                            setIncidentStatus(inc.status);
                            setIncidentNotes(inc.internal_notes || '');
                          }}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-xs font-bold rounded-lg cursor-pointer"
                        >
                          Manage
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub-View 2: Login Attempts Table */}
      {subView === 'logins' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-700 dark:text-slate-300">
              Authentication Audit Trail ({loginAttempts.length} Events)
            </span>
            <span className="text-slate-400">Rate-limited & brute-force monitored</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-3.5">Timestamp</th>
                  <th className="p-3.5">Authentication Result</th>
                  <th className="p-3.5">Account Email</th>
                  <th className="p-3.5">Client IP Address</th>
                  <th className="p-3.5">Details</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {loginAttempts.length === 0 ? (
                  <tr>
                    <td colSpan={5} className="p-8 text-center text-slate-400">
                      No login attempts recorded.
                    </td>
                  </tr>
                ) : (
                  loginAttempts.map((att) => (
                    <tr key={att.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="p-3.5 font-mono text-[11px] text-slate-500 whitespace-nowrap">
                        {new Date(att.created_at).toLocaleString()}
                      </td>
                      <td className="p-3.5">
                        <span
                          className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                            att.event_type.includes('SUCCESS')
                              ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                              : 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                          }`}
                        >
                          {att.event_type}
                        </span>
                      </td>
                      <td className="p-3.5 font-mono font-bold text-slate-700 dark:text-slate-300">
                        {att.user_email || 'Unknown'}
                      </td>
                      <td className="p-3.5 font-mono text-slate-400">{att.ip_address || '127.0.0.1'}</td>
                      <td className="p-3.5 font-mono text-[10px] text-slate-400 max-w-xs truncate">
                        {JSON.stringify(att.details || {})}
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* Sub-View 3: Active Sessions Table */}
      {subView === 'sessions' && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
            <span className="font-bold text-slate-700 dark:text-slate-300">
              Live Device Sessions ({sessions.length} Active Across Platform)
            </span>
            <span className="text-slate-400">Encrypted SHA-256 session token verification</span>
          </div>

          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px]">
                <tr>
                  <th className="p-3.5">User Identity</th>
                  <th className="p-3.5">Browser / Device Agent</th>
                  <th className="p-3.5">Client IP</th>
                  <th className="p-3.5">Last Active</th>
                  <th className="p-3.5">Expires At</th>
                  <th className="p-3.5 text-right">Session Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                {sessions.length === 0 ? (
                  <tr>
                    <td colSpan={6} className="p-8 text-center text-slate-400">
                      No active device sessions found.
                    </td>
                  </tr>
                ) : (
                  sessions.map((s) => (
                    <tr key={s.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                      <td className="p-3.5">
                        <p className="font-bold text-slate-800 dark:text-slate-200">{s.user_name || 'User'}</p>
                        <p className="text-[11px] font-mono text-slate-400">{s.user_email}</p>
                      </td>
                      <td className="p-3.5 text-slate-500 max-w-xs truncate text-[11px]">
                        {s.user_agent || 'Standard Web Session'}
                      </td>
                      <td className="p-3.5 font-mono text-slate-400">{s.ip_address || '127.0.0.1'}</td>
                      <td className="p-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                        {new Date(s.last_active_at).toLocaleString()}
                      </td>
                      <td className="p-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                        {new Date(s.expires_at).toLocaleDateString()}
                      </td>
                      <td className="p-3.5 text-right">
                        <button
                          onClick={() => handleRevokeSession(s.id)}
                          className="px-2.5 py-1 bg-rose-50 hover:bg-rose-100 text-rose-600 dark:bg-rose-950/40 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1 ml-auto"
                        >
                          <RotateCcw className="w-3.5 h-3.5" />
                          <span>Revoke</span>
                        </button>
                      </td>
                    </tr>
                  ))
                )}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {/* New Incident Modal */}
      {isNewIncidentOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <ShieldAlert className="w-4 h-4 text-emerald-600" />
              <span>Report Security Incident</span>
            </h3>

            <form onSubmit={handleCreateIncident} className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Incident Title *</label>
                <input
                  type="text"
                  placeholder="e.g. Unusual login spikes from proxy IP"
                  value={incidentTitle}
                  onChange={(e) => setIncidentTitle(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  required
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Severity Level</label>
                <select
                  value={incidentSeverity}
                  onChange={(e) => setIncidentSeverity(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="low">Low</option>
                  <option value="medium">Medium</option>
                  <option value="high">High</option>
                  <option value="critical">Critical</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Target Account (Optional)</label>
                <input
                  type="email"
                  placeholder="user@example.com"
                  value={incidentUserEmail}
                  onChange={(e) => setIncidentUserEmail(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
                />
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Description & Evidence *</label>
                <textarea
                  rows={3}
                  placeholder="Technical findings, attack vectors, or anomalous behavior..."
                  value={incidentDesc}
                  onChange={(e) => setIncidentDesc(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                  required
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsNewIncidentOpen(false)}
                  className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isCreatingIncident}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20"
                >
                  {isCreatingIncident ? 'Recording...' : 'Register Incident'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Manage Incident Modal */}
      {selectedIncident && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Manage Incident #{selectedIncident.incident_number}
            </h3>
            <p className="text-xs text-slate-400">{selectedIncident.title}</p>

            <div className="space-y-3">
              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Incident Status</label>
                <select
                  value={incidentStatus}
                  onChange={(e) => setIncidentStatus(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                >
                  <option value="new">New</option>
                  <option value="investigating">Investigating</option>
                  <option value="monitoring">Monitoring</option>
                  <option value="resolved">Resolved</option>
                  <option value="closed">Closed</option>
                </select>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Internal Investigation Notes</label>
                <textarea
                  rows={3}
                  value={incidentNotes}
                  onChange={(e) => setIncidentNotes(e.target.value)}
                  placeholder="Add technical mitigation steps or root cause analysis..."
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700"
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedIncident(null)}
                  className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  onClick={handleUpdateIncident}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold"
                >
                  Save Incident Status
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
