import React, { useState, useEffect } from 'react';
import {
  Scale,
  FileText,
  History,
  Edit3,
  CheckCircle2,
  RefreshCw,
  X,
  RotateCcw,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

export const AdminLegalTab: React.FC = () => {
  const toast = useToast();
  const [policies, setPolicies] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);

  // Policy Edit State
  const [selectedPolicy, setSelectedPolicy] = useState<any>(null);
  const [editTitle, setEditTitle] = useState('');
  const [editVersion, setEditVersion] = useState('');
  const [editContent, setEditContent] = useState('');
  const [isSaving, setIsSaving] = useState(false);

  // Versions History State
  const [versionsPolicy, setVersionsPolicy] = useState<any>(null);
  const [policyVersions, setPolicyVersions] = useState<any[]>([]);
  const [isLoadingVersions, setIsLoadingVersions] = useState(false);

  const loadPolicies = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getLegalPolicies();
      if (res.success && Array.isArray(res.policies)) {
        setPolicies(res.policies);
      }
    } catch (err: any) {
      toast.error('Legal Query Error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadPolicies();
  }, []);

  const handleOpenEdit = (p: any) => {
    setSelectedPolicy(p);
    setEditTitle(p.title);
    setEditVersion(p.version);
    setEditContent(p.content);
  };

  const handleSavePolicy = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedPolicy) return;

    setIsSaving(true);
    try {
      const res = await adminClient.updateLegalPolicy(selectedPolicy.id, {
        title: editTitle,
        version: editVersion,
        content: editContent,
        status: 'published',
      });

      if (res.success) {
        toast.success('Policy Published', 'New legal policy version has been recorded and published.');
        setSelectedPolicy(null);
        await loadPolicies();
      } else {
        toast.error('Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleOpenVersions = async (p: any) => {
    setVersionsPolicy(p);
    setIsLoadingVersions(true);
    try {
      const res = await adminClient.getPolicyVersions(p.id);
      if (res.success) {
        setPolicyVersions(res.versions || []);
      }
    } catch (err: any) {
      toast.error('Version History Error', err.message);
    } finally {
      setIsLoadingVersions(false);
    }
  };

  const handleRollbackToVersion = (v: any) => {
    setSelectedPolicy(versionsPolicy);
    setEditTitle(versionsPolicy.title);
    setEditVersion(v.version + '.restored');
    setEditContent(v.content);
    setVersionsPolicy(null);
    toast.info('Version Loaded into Editor', 'Review and click Publish to commit restoration.');
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm flex items-center justify-between">
        <div>
          <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">
            Legal & Compliance Policy Management
          </h3>
          <p className="text-xs text-slate-400">
            Statutory disclosures, version history, and immutable DPDP Act 2023 compliance ledgers
          </p>
        </div>

        <button
          onClick={loadPolicies}
          className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
          title="Refresh"
        >
          <RefreshCw className="w-4 h-4" />
        </button>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
        {policies.map((p) => (
          <div
            key={p.id}
            className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4 flex flex-col justify-between"
          >
            <div>
              <div className="flex items-center justify-between">
                <span className="text-[10px] font-mono font-bold text-emerald-600 uppercase bg-emerald-50 dark:bg-emerald-950 px-2 py-0.5 rounded-full">
                  v{p.version}
                </span>
                <span className="text-[10px] text-slate-400 font-mono">
                  Updated: {new Date(p.updated_at).toLocaleDateString()}
                </span>
              </div>
              <h4 className="font-bold text-base text-slate-900 dark:text-slate-100 mt-2">{p.title}</h4>
              <p className="text-xs text-slate-500 dark:text-slate-400 line-clamp-3 mt-1 font-mono text-[11px] bg-slate-50 dark:bg-slate-800/40 p-2.5 rounded-xl border border-slate-100 dark:border-slate-800">
                {p.content}
              </p>
            </div>

            <div className="flex items-center gap-2 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                onClick={() => handleOpenVersions(p)}
                className="flex-1 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 cursor-pointer"
              >
                <History className="w-3.5 h-3.5" />
                <span>Version History</span>
              </button>

              <button
                onClick={() => handleOpenEdit(p)}
                className="flex-1 py-2 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center justify-center gap-1.5 shadow-md shadow-emerald-600/20 cursor-pointer"
              >
                <Edit3 className="w-3.5 h-3.5" />
                <span>Edit & Publish</span>
              </button>
            </div>
          </div>
        ))}
      </div>

      {/* Policy Edit Modal */}
      {selectedPolicy && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-2xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                Edit Policy: {selectedPolicy.title}
              </h3>
              <button onClick={() => setSelectedPolicy(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePolicy} className="space-y-3 flex-1 overflow-y-auto">
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Title</label>
                  <input
                    type="text"
                    value={editTitle}
                    onChange={(e) => setEditTitle(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-bold"
                    required
                  />
                </div>
                <div>
                  <label className="block text-[11px] font-bold text-slate-500 mb-1">Version Number</label>
                  <input
                    type="text"
                    value={editVersion}
                    onChange={(e) => setEditVersion(e.target.value)}
                    className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono"
                    required
                  />
                </div>
              </div>

              <div>
                <label className="block text-[11px] font-bold text-slate-500 mb-1">Policy Content (Markdown)</label>
                <textarea
                  rows={12}
                  value={editContent}
                  onChange={(e) => setEditContent(e.target.value)}
                  className="w-full px-3 py-2 text-xs rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 font-mono leading-relaxed"
                  required
                />
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setSelectedPolicy(null)}
                  className="flex-1 py-2 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSaving}
                  className="flex-1 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-xs shadow-md shadow-emerald-600/20"
                >
                  {isSaving ? 'Publishing...' : 'Publish New Version'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Version History Modal */}
      {versionsPolicy && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-xl w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[85vh] flex flex-col">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div>
                <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
                  Version History: {versionsPolicy.title}
                </h3>
                <p className="text-xs text-slate-400">Immutable policy revision ledger</p>
              </div>
              <button onClick={() => setVersionsPolicy(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="flex-1 overflow-y-auto space-y-3">
              {isLoadingVersions ? (
                <div className="p-6 text-center text-xs text-slate-400 animate-pulse">Loading history...</div>
              ) : policyVersions.length === 0 ? (
                <p className="text-xs text-slate-400 text-center py-6">No historical versions recorded.</p>
              ) : (
                policyVersions.map((v) => (
                  <div
                    key={v.id}
                    className="p-3.5 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-100 dark:border-slate-700/60 text-xs flex justify-between items-center"
                  >
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-bold font-mono text-emerald-600">v{v.version}</span>
                        <span className="text-[10px] uppercase font-bold text-slate-400">({v.status})</span>
                      </div>
                      <p className="text-[11px] text-slate-400">Published by: {v.created_by || 'Admin'}</p>
                      <p className="text-[10px] text-slate-500">{new Date(v.created_at).toLocaleString()}</p>
                    </div>

                    <button
                      onClick={() => handleRollbackToVersion(v)}
                      className="px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 text-indigo-600 dark:bg-indigo-950/40 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1"
                    >
                      <RotateCcw className="w-3 h-3" />
                      <span>Restore</span>
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
