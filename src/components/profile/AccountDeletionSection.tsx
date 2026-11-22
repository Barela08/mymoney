import React, { useState, useEffect, useCallback } from 'react';
import {
  Trash2,
  AlertTriangle,
  Clock,
  ShieldAlert,
  CheckCircle2,
  Lock,
  ArrowRight,
  RotateCcw,
  Mail,
  Phone,
  HelpCircle,
  X,
  Sparkles,
  Info,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { udharDeletionApi, DeletionStatusResponse } from '../../lib/udharDeletionApi';
import { formatDisplayDate, formatDisplayTime } from '../../lib/dateUtils';
import { SUPPORT_CONTACT } from '../../config/contact';

interface AccountDeletionSectionProps {
  onDeletionCancelled?: () => void;
}

export const AccountDeletionSection: React.FC<AccountDeletionSectionProps> = ({
  onDeletionCancelled,
}) => {
  const { user, logout } = useAuth();
  const toast = useToast();

  const [deletionStatus, setDeletionStatus] = useState<DeletionStatusResponse | null>(null);
  const [isLoadingStatus, setIsLoadingStatus] = useState<boolean>(true);

  // Modal State
  const [isConfirmModalOpen, setIsConfirmModalOpen] = useState(false);
  const [verifyPassword, setVerifyPassword] = useState('');
  const [deletionReason, setDeletionReason] = useState('');
  const [isSubmittingRequest, setIsSubmittingRequest] = useState(false);
  const [isCancelling, setIsCancelling] = useState(false);
  const [modalError, setModalError] = useState<string | null>(null);

  // Live countdown state
  const [secondsRemaining, setSecondsRemaining] = useState<number>(0);

  // Fetch status
  const fetchStatus = useCallback(async () => {
    try {
      setIsLoadingStatus(true);
      const res = await udharDeletionApi.getAccountDeletionStatus();
      setDeletionStatus(res);
      if (res.isPending && res.remainingSeconds !== undefined) {
        setSecondsRemaining(res.remainingSeconds);
      }
    } catch (err: any) {
      console.warn('Could not fetch deletion status:', err.message);
    } finally {
      setIsLoadingStatus(false);
    }
  }, []);

  useEffect(() => {
    fetchStatus();
  }, [fetchStatus]);

  // Live countdown timer ticker
  useEffect(() => {
    if (!deletionStatus?.isPending || secondsRemaining <= 0) return;

    const timer = setInterval(() => {
      setSecondsRemaining((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          fetchStatus();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [deletionStatus?.isPending, secondsRemaining, fetchStatus]);

  // Format seconds into HH hours MM minutes SS seconds
  const formatCountdown = (totalSeconds: number) => {
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    const seconds = totalSeconds % 60;
    return `${hours}h ${minutes}m ${seconds}s`;
  };

  const formatScheduledDate = (isoStr?: string) => {
    if (!isoStr) return 'in 24 hours';
    try {
      const d = new Date(isoStr);
      return (
        d.toLocaleString('en-IN', {
          timeZone: 'Asia/Kolkata',
          dateStyle: 'medium',
          timeStyle: 'medium',
        }) + ' IST'
      );
    } catch {
      return isoStr;
    }
  };

  // Submit Deletion Request
  const handleSubmitDeletion = async (e: React.FormEvent) => {
    e.preventDefault();
    setModalError(null);

    if (!verifyPassword) {
      setModalError('Password is required to verify your identity.');
      return;
    }

    try {
      setIsSubmittingRequest(true);
      const res = await udharDeletionApi.requestAccountDeletion(
        verifyPassword,
        deletionReason.trim() || undefined
      );

      if (res.success) {
        toast.warning(
          'Deletion Scheduled',
          'Your account is scheduled for deletion in 24 hours. A confirmation email was sent.'
        );
        setIsConfirmModalOpen(false);
        setVerifyPassword('');
        setDeletionReason('');
        await fetchStatus();
      } else {
        setModalError(res.message);
      }
    } catch (err: any) {
      setModalError(err.message || 'Failed to submit deletion request.');
    } finally {
      setIsSubmittingRequest(false);
    }
  };

  // Cancel Deletion Request
  const handleCancelDeletion = async () => {
    try {
      setIsCancelling(true);
      const res = await udharDeletionApi.cancelAccountDeletion();
      if (res.success) {
        toast.success('Deletion Cancelled', 'Your account has been restored to normal active status.');
        await fetchStatus();
        if (onDeletionCancelled) onDeletionCancelled();
      } else {
        toast.error('Cancellation Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message || 'Unable to cancel deletion request.');
    } finally {
      setIsCancelling(false);
    }
  };

  if (isLoadingStatus) {
    return (
      <div className="p-8 text-center bg-white dark:bg-slate-900 rounded-3xl border border-slate-200 dark:border-slate-800">
        <div className="w-8 h-8 border-3 border-emerald-500 border-t-transparent rounded-full animate-spin mx-auto" />
        <p className="text-xs text-slate-500 mt-3 font-semibold">Checking account deletion status...</p>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // STATE A: ACCOUNT IS CURRENTLY IN 24-HOUR CANCELLATION WINDOW
  // ---------------------------------------------------------------------------
  if (deletionStatus?.isPending) {
    return (
      <div className="bg-gradient-to-br from-rose-50 via-red-50/50 to-amber-50/40 dark:from-rose-950/40 dark:via-red-950/20 dark:to-slate-900 border-2 border-rose-300 dark:border-rose-900 rounded-3xl p-6 sm:p-8 shadow-xl space-y-6 animate-pulse-subtle">
        {/* Header Alert */}
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 pb-5 border-b border-rose-200/80 dark:border-rose-900/60">
          <div className="flex items-center gap-3.5">
            <div className="w-12 h-12 rounded-2xl bg-rose-600 text-white flex items-center justify-center shadow-lg shadow-rose-600/30 shrink-0">
              <ShieldAlert className="w-6 h-6 animate-bounce" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-rose-600 text-white">
                  Pending Deletion
                </span>
                <span className="text-xs font-bold text-rose-700 dark:text-rose-400">
                  24-Hour Safety Grace Period
                </span>
              </div>
              <h3 className="text-lg sm:text-xl font-black text-rose-950 dark:text-rose-200 mt-0.5">
                Your Account is Scheduled for Permanent Deletion
              </h3>
            </div>
          </div>

          <button
            onClick={handleCancelDeletion}
            disabled={isCancelling}
            className="w-full sm:w-auto px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white font-bold text-xs rounded-xl shadow-lg shadow-emerald-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer shrink-0"
          >
            <RotateCcw className="w-4 h-4" />
            <span>{isCancelling ? 'Cancelling...' : 'Cancel Deletion Request (Restore Account)'}</span>
          </button>
        </div>

        {/* Live Countdown Clock Box */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm rounded-2xl p-5 border border-rose-200 dark:border-rose-900/60 space-y-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-rose-600 dark:text-rose-400 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>Time Remaining to Cancel</span>
            </span>
            <div className="text-3xl sm:text-4xl font-black font-mono text-rose-900 dark:text-rose-300 tracking-tight">
              {formatCountdown(secondsRemaining)}
            </div>
            <p className="text-xs text-slate-500">
              Live backend-synchronized countdown. Cancelling restores full active standing immediately.
            </p>
          </div>

          <div className="bg-white/80 dark:bg-slate-900/80 backdrop-blur-sm rounded-2xl p-5 border border-rose-200 dark:border-rose-900/60 space-y-2">
            <span className="text-[11px] font-extrabold uppercase tracking-wider text-slate-500 flex items-center gap-1.5">
              <Clock className="w-3.5 h-3.5" />
              <span>Scheduled Execution Timestamp</span>
            </span>
            <div className="text-sm sm:text-base font-bold text-slate-900 dark:text-slate-100 font-mono">
              {formatScheduledDate(deletionStatus.scheduledFor)}
            </div>
            <p className="text-xs text-slate-500">
              If not cancelled, the automated backend worker will execute permanent data purge at this exact time.
            </p>
          </div>
        </div>

        {/* Informational safeguards */}
        <div className="space-y-2 text-xs text-slate-600 dark:text-slate-300">
          <p className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>A cancellation link with an expiring, single-use token was dispatched to <strong>{user?.email}</strong>.</span>
          </p>
          <p className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>You can cancel inside the app or from the link in your email at any time before the countdown hits 0.</span>
          </p>
          <p className="flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 text-emerald-500 shrink-0" />
            <span>Cancellation permanently aborts the scheduled backend deletion job and records the event securely.</span>
          </p>
          <p className="flex items-center gap-2 text-rose-700 dark:text-rose-400 font-medium pt-1">
            <Phone className="w-4 h-4 shrink-0" />
            <span>
              Did not request this? Contact HackifyPro Helpline immediately at{' '}
              <a href={SUPPORT_CONTACT.telUrl} className="underline font-bold">{SUPPORT_CONTACT.displayPhone}</a> or{' '}
              <a href={SUPPORT_CONTACT.mailToUrl} className="underline font-bold">{SUPPORT_CONTACT.email}</a>.
            </span>
          </p>
        </div>
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // STATE B: NORMAL ACTIVE STANDING (ALLOW INITIATING DELETION)
  // ---------------------------------------------------------------------------
  return (
    <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm space-y-6">
      {/* Title & Intro */}
      <div className="flex items-start gap-4 pb-5 border-b border-slate-100 dark:border-slate-800">
        <div className="w-11 h-11 rounded-2xl bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400 flex items-center justify-center border border-rose-200/80 dark:border-rose-900/60 shrink-0 mt-0.5">
          <Trash2 className="w-5 h-5" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <h3 className="text-base sm:text-lg font-black text-slate-900 dark:text-slate-100">
              Delete Account & Data (डेटा और अकाउंट हटाएँ)
            </h3>
            <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-rose-100 dark:bg-rose-950 text-rose-700 dark:text-rose-300">
              Permanent
            </span>
          </div>
          <p className="text-xs text-slate-500 mt-1 leading-relaxed">
            Submit a formal request to permanently delete your personal profile, credentials, and all recorded financial ledgers from My Money Manager.
          </p>
        </div>
      </div>

      {/* Step 1: Detailed Explanation of What Will Be Deleted */}
      <div className="space-y-3">
        <h4 className="text-xs font-extrabold uppercase tracking-wider text-slate-700 dark:text-slate-300">
          What will be deleted upon execution:
        </h4>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 text-xs">
          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60 space-y-1">
            <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>User Account & Identity</span>
            </span>
            <p className="text-slate-500 text-[11px]">
              Profile name, email, phone number, password hash, and active device sessions.
            </p>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60 space-y-1">
            <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>Financial Records & History</span>
            </span>
            <p className="text-slate-500 text-[11px]">
              All income entries, home expenses, room rents, groceries, electricity, and custom logs.
            </p>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60 space-y-1">
            <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>Budgets & Financial Goals</span>
            </span>
            <p className="text-slate-500 text-[11px]">
              Allocated room budgets, custom categories, and personal balance targets.
            </p>
          </div>

          <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl border border-slate-200/60 dark:border-slate-700/60 space-y-1">
            <span className="font-bold text-slate-800 dark:text-slate-200 flex items-center gap-1.5">
              <span className="w-2 h-2 rounded-full bg-rose-500" />
              <span>Saved Contacts & Udhar Records</span>
            </span>
            <p className="text-slate-500 text-[11px]">
              Saved people list, QR pairings, lending/borrowing ledgers, and personal notes.
            </p>
          </div>
        </div>
      </div>

      {/* Safety Notice Callout */}
      <div className="p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/60 flex items-start gap-3">
        <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
        <div className="text-xs text-amber-900 dark:text-amber-300 leading-relaxed space-y-1">
          <p className="font-bold">24-Hour Safety Cancellation Guarantee</p>
          <p className="text-amber-800 dark:text-amber-400">
            Clicking "Delete My Account & Data" does not immediately wipe your records. You will have a full 24-hour window to cancel your request either in-app or via an automated email confirmation link.
          </p>
        </div>
      </div>

      {/* Step 2 Trigger Button */}
      <div className="flex flex-col sm:flex-row items-center justify-between gap-4 pt-2">
        <p className="text-xs text-slate-400">
          Identity verification required before request submission.
        </p>

        <button
          type="button"
          onClick={() => {
            setModalError(null);
            setVerifyPassword('');
            setDeletionReason('');
            setIsConfirmModalOpen(true);
          }}
          className="w-full sm:w-auto px-5 py-3 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white font-bold text-xs shadow-lg shadow-rose-600/25 transition-all flex items-center justify-center gap-2 cursor-pointer"
        >
          <Trash2 className="w-4 h-4" />
          <span>Delete My Account & Data</span>
        </button>
      </div>

      {/* Step 3: Identity Verification & Final Confirmation Modal */}
      {isConfirmModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 sm:p-7 border border-rose-200 dark:border-rose-900 shadow-2xl space-y-5">
            {/* Modal Header */}
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <div className="flex items-center gap-2.5">
                <div className="w-9 h-9 rounded-xl bg-rose-100 dark:bg-rose-950 text-rose-600 flex items-center justify-center">
                  <AlertTriangle className="w-5 h-5" />
                </div>
                <div>
                  <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                    Verify Identity to Schedule Deletion
                  </h3>
                  <p className="text-[11px] text-slate-500">Security step for {user?.email}</p>
                </div>
              </div>

              <button
                type="button"
                onClick={() => setIsConfirmModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Error Message */}
            {modalError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 rounded-xl text-xs text-rose-700 dark:text-rose-300 font-semibold">
                {modalError}
              </div>
            )}

            <form onSubmit={handleSubmitDeletion} className="space-y-4">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Confirm Current Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type="password"
                    required
                    placeholder="Enter your current password"
                    value={verifyPassword}
                    onChange={(e) => setVerifyPassword(e.target.value)}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-rose-500 font-mono"
                  />
                  <Lock className="w-4 h-4 text-slate-400 absolute right-3.5 top-3" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1.5">
                  Reason for Leaving (Optional)
                </label>
                <textarea
                  rows={2}
                  placeholder="Help us understand how we can improve (optional)"
                  value={deletionReason}
                  onChange={(e) => setDeletionReason(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-rose-500 resize-none"
                />
              </div>

              <div className="p-3.5 rounded-xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/80 text-[11px] text-slate-600 dark:text-slate-300 space-y-1">
                <p className="font-bold text-slate-900 dark:text-slate-100">Summary of Scheduled Action:</p>
                <p>• A pending deletion request will be created immediately.</p>
                <p>• A 24-hour countdown will begin with an email dispatch.</p>
                <p>• You can cancel anytime during the 24 hours.</p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsConfirmModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isSubmittingRequest}
                  className="flex-1 py-2.5 rounded-xl bg-rose-600 hover:bg-rose-700 active:scale-95 text-white text-xs font-bold shadow-md shadow-rose-600/30 transition-all flex items-center justify-center gap-2 cursor-pointer"
                >
                  {isSubmittingRequest ? (
                    <span>Verifying...</span>
                  ) : (
                    <>
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Confirm & Schedule</span>
                    </>
                  )}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
