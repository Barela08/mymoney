import React, { useState, useEffect } from 'react';
import {
  Trash2,
  Clock,
  RefreshCw,
  CheckCircle2,
  XCircle,
  AlertTriangle,
  RotateCcw,
  Shield,
  Eye,
} from 'lucide-react';
import { adminClient } from '../../../lib/adminApi';
import { useToast } from '../../../context/ToastContext';

export const AdminDeletionsTab: React.FC = () => {
  const toast = useToast();
  const [deletions, setDeletions] = useState<any[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [selectedRequest, setSelectedRequest] = useState<any>(null);

  const loadDeletions = async () => {
    setIsLoading(true);
    try {
      const res = await adminClient.getAccountDeletions();
      if (res.success && Array.isArray(res.requests)) {
        setDeletions(res.requests);
      }
    } catch (err: any) {
      toast.error('Query Error', err.message);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    loadDeletions();
    const interval = setInterval(loadDeletions, 15000);
    return () => clearInterval(interval);
  }, []);

  const handleCancelDeletion = async (id: string) => {
    try {
      const res = await adminClient.cancelAccountDeletion(id);
      if (res.success) {
        toast.success('Deletion Cancelled', 'Account scheduled deletion was cancelled.');
        await loadDeletions();
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const formatRemainingTime = (seconds: number) => {
    if (seconds <= 0) return 'Grace Window Expired (Queued)';
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    return `${hrs}h ${mins}m remaining`;
  };

  return (
    <div className="space-y-6">
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-2">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-xl bg-rose-500/10 text-rose-600 flex items-center justify-center">
              <Trash2 className="w-4 h-4" />
            </div>
            <div>
              <h3 className="font-bold text-sm text-slate-800 dark:text-slate-200">
                24-Hour Account Deletion Lifecycle Management
              </h3>
              <p className="text-xs text-slate-400">
                Statutory DPDP Act 2023 24-hour grace window monitor and automated purge ledger
              </p>
            </div>
          </div>

          <button
            onClick={loadDeletions}
            className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 transition-all cursor-pointer"
            title="Refresh Requests"
          >
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>
      </div>

      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-sm overflow-hidden">
        <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
          <span className="font-bold text-slate-700 dark:text-slate-300">
            Account Deletion Queue ({deletions.length} Total Requests)
          </span>
          <span className="text-slate-400">Backend scheduled job controlled</span>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-50 dark:bg-slate-800/60 text-slate-400 uppercase text-[10px]">
              <tr>
                <th className="p-3.5">Target Account</th>
                <th className="p-3.5">Status</th>
                <th className="p-3.5">Requested At</th>
                <th className="p-3.5">Scheduled Execution</th>
                <th className="p-3.5">Time Remaining</th>
                <th className="p-3.5 text-right">Administrative Action</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
              {deletions.length === 0 ? (
                <tr>
                  <td colSpan={6} className="p-8 text-center text-slate-400">
                    No active account deletion requests in progress.
                  </td>
                </tr>
              ) : (
                deletions.map((d) => (
                  <tr key={d.id} className="hover:bg-slate-50/50 dark:hover:bg-slate-800/40">
                    <td className="p-3.5">
                      <p className="font-bold text-slate-800 dark:text-slate-200">{d.user_name || 'User'}</p>
                      <p className="font-mono text-[11px] text-slate-400">{d.user_email}</p>
                      {d.reason && (
                        <p className="text-[10px] text-slate-500 italic mt-0.5 max-w-xs truncate">
                          "{d.reason}"
                        </p>
                      )}
                    </td>

                    <td className="p-3.5">
                      <span
                        className={`px-2 py-0.5 rounded-full text-[10px] font-bold ${
                          d.status === 'pending_24h'
                            ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                            : d.status === 'cancelled'
                            ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                            : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                        }`}
                      >
                        ● {d.status}
                      </span>
                    </td>

                    <td className="p-3.5 text-slate-500 text-[11px] whitespace-nowrap">
                      {new Date(d.created_at).toLocaleString()}
                    </td>

                    <td className="p-3.5 text-slate-500 text-[11px] whitespace-nowrap font-mono">
                      {new Date(d.scheduled_for).toLocaleString()}
                    </td>

                    <td className="p-3.5">
                      {d.status === 'pending_24h' ? (
                        <span className="flex items-center gap-1 font-bold text-amber-600 dark:text-amber-400">
                          <Clock className="w-3.5 h-3.5" />
                          <span>{formatRemainingTime(d.remaining_seconds)}</span>
                        </span>
                      ) : (
                        <span className="text-slate-400 text-[11px]">—</span>
                      )}
                    </td>

                    <td className="p-3.5 text-right whitespace-nowrap">
                      <div className="flex items-center justify-end gap-2">
                        {d.status === 'pending_24h' && (
                          <button
                            onClick={() => handleCancelDeletion(d.id)}
                            className="px-2.5 py-1 bg-emerald-50 hover:bg-emerald-100 text-emerald-600 dark:bg-emerald-950/40 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1"
                          >
                            <RotateCcw className="w-3.5 h-3.5" />
                            <span>Cancel Request</span>
                          </button>
                        )}

                        <button
                          onClick={() => setSelectedRequest(d)}
                          className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 text-xs font-bold rounded-lg cursor-pointer flex items-center gap-1"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>Details</span>
                        </button>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Deletion Details Modal */}
      {selectedRequest && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100">
              Deletion Request Audit Record
            </h3>

            <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-100 dark:border-slate-700/60 space-y-2 text-xs">
              <div className="flex justify-between">
                <span className="text-slate-500">Account:</span>
                <span className="font-mono font-bold">{selectedRequest.user_email}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Request IP:</span>
                <span className="font-mono">{selectedRequest.ip_address || '127.0.0.1'}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Scheduled Date:</span>
                <span className="font-mono">{new Date(selectedRequest.scheduled_for).toLocaleString()}</span>
              </div>
              <div className="flex justify-between">
                <span className="text-slate-500">Cancellation Status:</span>
                <span className="font-bold">{selectedRequest.status}</span>
              </div>
              {selectedRequest.reason && (
                <div className="pt-2 border-t border-slate-100 dark:border-slate-700">
                  <span className="text-slate-500 block mb-1">User Stated Reason:</span>
                  <p className="italic text-slate-700 dark:text-slate-300 bg-white dark:bg-slate-900 p-2 rounded-lg">
                    {selectedRequest.reason}
                  </p>
                </div>
              )}
            </div>

            <button
              onClick={() => setSelectedRequest(null)}
              className="w-full py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-semibold"
            >
              Close
            </button>
          </div>
        </div>
      )}
    </div>
  );
};
