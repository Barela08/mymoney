import React, { useCallback, useEffect, useState } from 'react';
import { Check, X, Loader2, Inbox, Clock, AlertCircle } from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { udharDeletionApi, ConnectionRequestItem } from '../../lib/udharDeletionApi';

interface ConnectionRequestsPanelProps {
  /** Bump this value to force a reload (e.g. after scanning a QR). */
  refreshKey?: number;
  /** Called after accepting/rejecting so the parent can refresh its lists. */
  onChanged?: () => void;
}

/**
 * Pending Udhar connection requests. Nothing is connected until the target
 * user accepts, so this is the only place a request becomes active.
 */
export const ConnectionRequestsPanel: React.FC<ConnectionRequestsPanelProps> = ({
  refreshKey = 0,
  onChanged,
}) => {
  const toast = useToast();
  const [incoming, setIncoming] = useState<ConnectionRequestItem[]>([]);
  const [outgoing, setOutgoing] = useState<ConnectionRequestItem[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [actingId, setActingId] = useState<string | null>(null);
  const [error, setError] = useState<string>('');

  const load = useCallback(async () => {
    try {
      setIsLoading(true);
      setError('');
      const res = await udharDeletionApi.listConnectionRequests();
      const dedupeByKey = (list: ConnectionRequestItem[], keyFn: (r: ConnectionRequestItem) => string) => {
        const seen = new Set<string>();
        return list.filter((item) => {
          const k = keyFn(item);
          if (!k || seen.has(k)) return false;
          seen.add(k);
          return true;
        });
      };
      setIncoming(dedupeByKey(res.incoming || [], (r) => r.requesterUserId || r.id));
      setOutgoing(dedupeByKey(res.outgoing || [], (r) => r.targetUserId || r.id));
    } catch (err: any) {
      setError(
        err?.status === 503 || err?.isNonJson
          ? 'Connection requests are temporarily unavailable. No data was changed.'
          : err?.message || 'Could not load connection requests.'
      );
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load, refreshKey]);

  const respond = async (request: ConnectionRequestItem, action: 'accept' | 'reject') => {
    if (actingId) return;
    try {
      setActingId(request.id);
      const res = await udharDeletionApi.respondToConnectionRequest(request.id, action);
      toast.success(
        action === 'accept' ? 'Connection Accepted' : 'Request Declined',
        res.message ||
          (action === 'accept'
            ? `You are now connected with ${request.displayName}.`
            : 'The request was declined. No information was shared.')
      );
      await load();
      if (onChanged) onChanged();
    } catch (err: any) {
      toast.error('Action Failed', err?.message || 'Could not update this request.');
    } finally {
      setActingId(null);
    }
  };

  const cancelOutgoing = async (request: ConnectionRequestItem) => {
    if (actingId) return;
    try {
      setActingId(request.id);
      const res = await udharDeletionApi.cancelConnectionRequest(request.id);
      setOutgoing((prev) => prev.filter((item) => item.id !== request.id && item.targetUserId !== request.targetUserId));
      toast.info(
        (res as any)?.alreadyCancelled ? 'Already Cancelled' : 'Request Cancelled',
        res.message || `Cancelled connection request to ${request.displayName}.`
      );
      await load();
      if (onChanged) onChanged();
    } catch (err: any) {
      if (err?.status === 404) {
        setOutgoing((prev) => prev.filter((item) => item.id !== request.id));
        await load();
        if (onChanged) onChanged();
      }
      toast.error('Cancel Failed', err?.message || 'Could not cancel this request.');
    } finally {
      setActingId(null);
    }
  };

  if (isLoading && incoming.length === 0 && outgoing.length === 0) {
    return (
      <div className="p-3 rounded-2xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 flex items-center gap-2 text-xs text-slate-400">
        <Loader2 className="w-3.5 h-3.5 animate-spin" />
        <span>Checking connection requests...</span>
      </div>
    );
  }

  if (error) {
    return (
      <div className="p-3 rounded-2xl border border-amber-200 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 flex items-center justify-between gap-3">
        <p className="text-[11px] text-amber-800 dark:text-amber-300 flex items-center gap-1.5">
          <AlertCircle className="w-3.5 h-3.5 shrink-0" />
          <span>{error}</span>
        </p>
        <button
          type="button"
          onClick={() => void load()}
          className="px-2.5 py-1 rounded-lg bg-amber-600 hover:bg-amber-500 text-white text-[10px] font-bold shrink-0 cursor-pointer"
        >
          Retry
        </button>
      </div>
    );
  }

  if (incoming.length === 0 && outgoing.length === 0) return null;

  return (
    <div className="bg-white dark:bg-slate-900 border border-emerald-200 dark:border-emerald-900/60 rounded-2xl p-4 shadow-sm space-y-3">
      <div className="flex items-center gap-2">
        <Inbox className="w-4 h-4 text-emerald-600" />
        <h3 className="text-sm font-black text-slate-900 dark:text-slate-100">
          Connection requests
        </h3>
        {incoming.length > 0 && (
          <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-emerald-600 text-white">
            {incoming.length}
          </span>
        )}
      </div>

      {incoming.map((request) => (
        <div
          key={request.id}
          className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/70 border border-slate-200 dark:border-slate-700"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-9 h-9 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-xs flex items-center justify-center shrink-0 overflow-hidden">
              {request.avatarUrl ? (
                <img src={request.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                request.displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                {request.displayName} wants to connect with you
              </p>
              <p className="text-[10px] text-slate-400 truncate">
                {request.emailMasked || request.phoneMasked || 'On My Money Manager Udhar'} · {request.relationshipType || 'Friend'}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              disabled={actingId === request.id}
              onClick={() => void respond(request, 'reject')}
              className="px-2.5 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 text-slate-700 dark:text-slate-200 text-[10px] font-bold disabled:opacity-50 cursor-pointer flex items-center gap-1"
            >
              <X className="w-3 h-3" />
              <span>Reject</span>
            </button>
            <button
              type="button"
              disabled={actingId === request.id}
              onClick={() => void respond(request, 'accept')}
              className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 text-white text-[10px] font-bold disabled:opacity-50 cursor-pointer flex items-center gap-1"
            >
              {actingId === request.id ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <Check className="w-3 h-3" />
              )}
              <span>Accept</span>
            </button>
          </div>
        </div>
      ))}

      {outgoing.map((request) => (
        <div
          key={request.id}
          className="flex items-center justify-between gap-3 p-2.5 rounded-xl bg-slate-50/60 dark:bg-slate-800/40 border border-dashed border-slate-200 dark:border-slate-700"
        >
          <div className="flex items-center gap-2.5 min-w-0">
            <div className="w-8 h-8 rounded-full bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 font-bold text-[11px] flex items-center justify-center shrink-0 overflow-hidden">
              {request.avatarUrl ? (
                <img src={request.avatarUrl} alt="" className="w-full h-full object-cover" />
              ) : (
                request.displayName.charAt(0).toUpperCase()
              )}
            </div>
            <div className="min-w-0">
              <p className="text-[11px] text-slate-700 dark:text-slate-200 truncate">
                <strong>{request.displayName}</strong>
              </p>
              {(request.emailMasked || request.phoneMasked) && (
                <p className="text-[10px] text-slate-400 font-mono truncate">
                  {request.emailMasked || request.phoneMasked}
                </p>
              )}
            </div>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 px-2 py-1 rounded-lg flex items-center gap-1">
              <Clock className="w-3 h-3" />
              <span>Request Sent</span>
            </span>
            <button
              type="button"
              disabled={actingId === request.id}
              onClick={() => void cancelOutgoing(request)}
              className="px-2.5 py-1 rounded-lg bg-rose-50 dark:bg-rose-950/50 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[10px] font-bold disabled:opacity-50 cursor-pointer flex items-center gap-1"
            >
              {actingId === request.id ? (
                <Loader2 className="w-3 h-3 animate-spin" />
              ) : (
                <X className="w-3 h-3" />
              )}
              <span>Cancel Request</span>
            </button>
          </div>
        </div>
      ))}

      <p className="text-[10.5px] text-slate-400 leading-relaxed">
        Saved People connections become active only after a request is accepted. Both people can remove a connection at any time.
      </p>
    </div>
  );
};
