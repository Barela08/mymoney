import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Search,
  QrCode,
  ArrowUpRight,
  ArrowDownLeft,
  CheckCircle2,
  AlertCircle,
  ChevronDown,
  ChevronUp,
  Paperclip,
  RefreshCw,
  Loader2,
  Sparkles,
  UserCheck,
  Lock,
  ShieldCheck,
  Zap,
  Clock,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  PRIVACY_CHANGED_EVENT,
  hasOptionalConsent,
  privacyConsentApi,
} from '../../lib/privacyConsentApi';
import {
  udharDeletionApi,
  UdharContact,
  SearchUserResult,
  UdharTransactionItem,
  ResolveQrResponse,
} from '../../lib/udharDeletionApi';
import { getCurrentISTDate, formatINR } from '../../lib/dateUtils';
import {
  UDHAR_CATEGORIES,
  UDHAR_PAYMENT_METHODS,
  normalizeSearchQuery,
  parseQrPayload,
} from '../../lib/sharedUdharEngine';

interface AddUdharModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: (createdTx?: UdharTransactionItem) => void;
  onOpenScanner?: () => void;
  initialPersonName?: string;
  initialPersonUserId?: string | null;
  initialMode?: 'saved' | 'registered' | 'manual' | 'qr_code';
  initialQrCode?: string;
}

function generateIdempotencyKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `udhar-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export const AddUdharModal: React.FC<AddUdharModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onOpenScanner,
  initialPersonName,
  initialPersonUserId,
  initialMode,
  initialQrCode,
}) => {
  const toast = useToast();

  // Core Form Fields (Amount FIRST!)
  const [amount, setAmount] = useState<string>('');
  const [direction, setDirection] = useState<'gave' | 'took'>('gave');
  const [personMode, setPersonMode] = useState<'saved' | 'registered' | 'manual' | 'qr_code'>('saved');
  const [personName, setPersonName] = useState<string>(initialPersonName || '');
  const [counterpartUserId, setCounterpartUserId] = useState<string | null>(
    initialPersonUserId || null
  );
  const [txDate, setTxDate] = useState<string>(getCurrentISTDate());
  const [category, setCategory] = useState<string>('Personal Loan');
  const [paymentMethod, setPaymentMethod] = useState<string>('UPI');
  const [description, setDescription] = useState<string>('');

  // Method B: QR / Confirmation Code Verification State
  const [qrCodeInput, setQrCodeInput] = useState<string>(initialQrCode || '');
  const [isVerifyingQr, setIsVerifyingQr] = useState<boolean>(false);
  const [qrVerifyError, setQrVerifyError] = useState<string | null>(null);
  const [resolvedQr, setResolvedQr] = useState<ResolveQrResponse | null>(null);

  // Optional Expandable Section
  const [showOptional, setShowOptional] = useState<boolean>(false);
  const [dueDate, setDueDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [attachmentUrl, setAttachmentUrl] = useState<string>('');

  // Submission & Idempotency
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);
  const [submitStage, setSubmitStage] = useState<string>('');
  const [formError, setFormError] = useState<string | null>(null);
  const isSubmittingRef = useRef<boolean>(false);
  const idempotencyKeyRef = useRef<string>(generateIdempotencyKey());

  // Live Registered User Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [retryNonce, setRetryNonce] = useState<number>(0);
  const searchAbortRef = useRef<AbortController | null>(null);
  const searchSeqRef = useRef<number>(0);

  // Saved Contacts
  const [savedContacts, setSavedContacts] = useState<UdharContact[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState<boolean>(false);

  // Two-way Udhar Sharing optional consent state
  const [hasUdharSharingConsent, setHasUdharSharingConsent] = useState<boolean>(() =>
    hasOptionalConsent('udhar_sharing')
  );
  const [isGrantingUdharConsent, setIsGrantingUdharConsent] = useState<boolean>(false);

  useEffect(() => {
    const syncConsent = () => setHasUdharSharingConsent(hasOptionalConsent('udhar_sharing'));
    window.addEventListener(PRIVACY_CHANGED_EVENT, syncConsent);
    if (isOpen) {
      syncConsent();
      privacyConsentApi
        .fetchConsents()
        .then((res) => setHasUdharSharingConsent(Boolean(res.choices.udhar_sharing)))
        .catch(() => {});
    }
    return () => window.removeEventListener(PRIVACY_CHANGED_EVENT, syncConsent);
  }, [isOpen]);

  // Escape key close when idle
  useEffect(() => {
    if (!isOpen) return;
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape' && !isSubmittingRef.current) {
        onClose();
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [isOpen, onClose]);

  const handleGrantUdharSharingConsent = async () => {
    if (isGrantingUdharConsent) return;
    setIsGrantingUdharConsent(true);
    try {
      await privacyConsentApi.saveSingleConsent({
        purpose: 'udhar_sharing',
        status: 'granted',
        source: 'udhar_sharing_prompt',
        language: 'en',
      });
      setHasUdharSharingConsent(true);
      toast.success(
        'Two-way Udhar Sharing enabled',
        'Only the Udhar entries you share with connected people will be synced.'
      );
    } catch (err: any) {
      toast.error('Could not save consent', err?.message || 'Please try again.');
    } finally {
      setIsGrantingUdharConsent(false);
    }
  };

  const resolveConfirmationCode = async (rawCode: string): Promise<ResolveQrResponse | null> => {
    const clean = rawCode.trim();
    if (!clean) {
      setQrVerifyError('Enter a confirmation code (e.g. MM-XXXXXX) or paste a QR link.');
      return null;
    }

    const parsed = parseQrPayload(clean);
    if (!parsed.valid) {
      const msg = parsed.error || 'Enter a valid My Money Manager confirmation code (MM-XXXXXX) or QR payload.';
      setQrVerifyError(msg);
      return null;
    }

    try {
      setIsVerifyingQr(true);
      setQrVerifyError(null);
      const res = await udharDeletionApi.resolveQrCode({
        qrData: parsed.kind === 'json' ? clean : undefined,
        pairingToken: parsed.token,
        pairingCode: parsed.code,
      });

      if (res.success && res.owner?.displayName) {
        setResolvedQr(res);
        setPersonName(res.owner.displayName);
        setCounterpartUserId(res.owner.id);
        setFormError(null);
        return res;
      }

      const msg = res.message || 'Could not verify confirmation code.';
      setQrVerifyError(msg);
      setResolvedQr(null);
      return null;
    } catch (err: any) {
      const msg = err?.message || 'Verification failed. Please check the code and retry.';
      setQrVerifyError(msg);
      setResolvedQr(null);
      return null;
    } finally {
      setIsVerifyingQr(false);
    }
  };

  // Initialize form whenever modal opens
  useEffect(() => {
    if (!isOpen) {
      searchAbortRef.current?.abort();
      return;
    }

    idempotencyKeyRef.current = generateIdempotencyKey();
    isSubmittingRef.current = false;
    setIsSubmitting(false);
    setSubmitStage('');
    setFormError(null);
    setQrVerifyError(null);
    setResolvedQr(null);
    setQrCodeInput(initialQrCode || '');
    setTxDate(getCurrentISTDate());
    setSearchQuery('');
    setSearchResults([]);
    setSearchError(null);

    if (initialMode === 'qr_code' || initialQrCode) {
      setPersonMode('qr_code');
      if (initialQrCode) {
        void resolveConfirmationCode(initialQrCode);
      }
    }

    const loadContactsAndPreservePerson = async () => {
      try {
        setIsLoadingContacts(true);
        const [res, reqRes] = await Promise.all([
          udharDeletionApi.getContacts(),
          udharDeletionApi.listConnectionRequests().catch(() => null),
        ]);
        const baseContacts = res.success ? res.contacts || [] : [];
        const existingLinkedIds = new Set(
          baseContacts.map((c) => c.linked_user_id).filter(Boolean) as string[]
        );
        const extraConnected: UdharContact[] = (reqRes?.connected || [])
          .filter((conn) => conn.userId && !existingLinkedIds.has(conn.userId))
          .map((conn) => ({
            id: `conn-${conn.userId}`,
            user_id: '',
            name: conn.displayName || 'Connected User',
            email: null,
            phone: null,
            photo_url: conn.avatarUrl || null,
            relationship_type: 'Friend',
            notes: null,
            linked_user_id: conn.userId,
            created_at: conn.createdAt,
            updated_at: conn.createdAt,
          }));
        const contacts = [...baseContacts, ...extraConnected];
        setSavedContacts(contacts);

        if (initialMode === 'qr_code' || initialQrCode) {
          return;
        }

        if (initialPersonName) {
          setPersonName(initialPersonName);
          const matchedContact = contacts.find(
            (c) =>
              (initialPersonUserId && c.linked_user_id === initialPersonUserId) ||
              c.name.toLowerCase().trim() === initialPersonName.toLowerCase().trim()
          );

          const resolvedUid = initialPersonUserId || matchedContact?.linked_user_id || null;
          setCounterpartUserId(resolvedUid);
          setPersonMode(initialMode || (matchedContact || resolvedUid ? 'saved' : 'manual'));
        } else {
          setPersonName('');
          setCounterpartUserId(null);
          setPersonMode(initialMode || (contacts.length > 0 ? 'saved' : 'registered'));
        }
      } catch {
        if (initialPersonName && initialMode !== 'qr_code') {
          setPersonName(initialPersonName);
          setCounterpartUserId(initialPersonUserId || null);
          setPersonMode(initialPersonUserId ? 'saved' : 'manual');
        }
      } finally {
        setIsLoadingContacts(false);
      }
    };

    void loadContactsAndPreservePerson();
  }, [isOpen, initialPersonName, initialPersonUserId, initialMode, initialQrCode]);

  // Debounced live search for registered users
  useEffect(() => {
    if (!isOpen || personMode !== 'registered') return;

    const normalized = normalizeSearchQuery(searchQuery);
    if (normalized.length < 2) {
      searchAbortRef.current?.abort();
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      return;
    }

    const seq = ++searchSeqRef.current;
    setIsSearching(true);
    setSearchError(null);

    const timer = setTimeout(async () => {
      searchAbortRef.current?.abort();
      const controller = new AbortController();
      searchAbortRef.current = controller;

      try {
        const res = await udharDeletionApi.searchUsers(normalized, controller.signal);
        if (seq !== searchSeqRef.current) return;
        if (res.success) {
          setSearchResults(res.users || []);
          setSearchError(null);
        } else {
          setSearchError('Could not search registered users. Please retry.');
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (seq !== searchSeqRef.current) return;
        setSearchError(err?.message || 'Unable to search right now. Check connection and retry.');
      } finally {
        if (seq === searchSeqRef.current) {
          setIsSearching(false);
        }
      }
    }, 280);

    return () => clearTimeout(timer);
  }, [searchQuery, personMode, isOpen, retryNonce]);

  if (!isOpen) return null;

  const isInstantMethodB = personMode === 'qr_code';
  const isManualTwoWay = !isInstantMethodB && Boolean(counterpartUserId);

  const handleSelectRegisteredUser = (u: SearchUserResult) => {
    if (u.isSelf || u.connectionStatus === 'self') return;
    setPersonName(u.displayName);
    setCounterpartUserId(u.id);
    setFormError(null);
    toast.info(
      'Recipient Selected',
      `${u.displayName} will receive an Udhar confirmation request (Method A).`
    );
  };

  const handleSelectSavedContact = (c: UdharContact) => {
    setPersonName(c.name);
    setCounterpartUserId(c.linked_user_id || null);
    setFormError(null);
  };

  const handleAttachmentUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    if (file.size > 1024 * 1024) {
      toast.error('Attachment Too Large', 'Please choose a receipt image under 1 MB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setAttachmentUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmittingRef.current) return;
    setFormError(null);

    const amt = parseFloat(amount);
    if (!Number.isFinite(amt) || amt <= 0) {
      setFormError('Please enter an amount greater than ₹0.');
      return;
    }

    if (isInstantMethodB) {
      let verified = resolvedQr;
      if (!verified?.owner) {
        verified = await resolveConfirmationCode(qrCodeInput);
        if (!verified?.owner) {
          setFormError('Verify a valid confirmation code (MM-XXXXXX) or scan a QR code first.');
          return;
        }
      }

      if (!hasUdharSharingConsent) {
        toast.info(
          'Two-way Udhar Sharing Consent Needed',
          'Enable Two-way Udhar Sharing below to record this instant shared Udhar.'
        );
        return;
      }

      try {
        isSubmittingRef.current = true;
        setIsSubmitting(true);
        setSubmitStage('Creating instant verified Udhar...');

        const res = await udharDeletionApi.createUdharViaQr({
          pairing_code: verified.pairingCode,
          qr_token: verified.pairingToken,
          direction,
          amount: amt,
          category,
          payment_method: paymentMethod,
          description: description.trim() || undefined,
          transaction_date: txDate,
          due_date: dueDate || null,
          notes: notes.trim() || undefined,
          attachment_url: attachmentUrl.trim() || null,
          idempotency_key: idempotencyKeyRef.current,
        });

        if (res.success) {
          toast.success(
            'Udhar Added Successfully',
            res.message || `Instant Udhar with ${verified.owner.displayName} confirmed and synced.`
          );
          setAmount('');
          setDescription('');
          setNotes('');
          setDueDate('');
          setAttachmentUrl('');
          setShowOptional(false);
          idempotencyKeyRef.current = generateIdempotencyKey();
          if (onSuccess) onSuccess(res.transaction);
          onClose();
        }
      } catch (err: any) {
        const msg = err?.message || 'Failed to add instant Udhar transaction.';
        setFormError(msg);
        toast.error('Could Not Add Instant Udhar', msg);
      } finally {
        isSubmittingRef.current = false;
        setIsSubmitting(false);
        setSubmitStage('');
      }
      return;
    }

    // Method A: Manual Entry (Shared = Pending Confirmation; Local = Confirmed)
    const cleanName = personName.trim();
    if (!cleanName) {
      setFormError('Please select a connected person or enter a name.');
      return;
    }

    if (counterpartUserId && !hasUdharSharingConsent) {
      toast.info(
        'Two-way Udhar Sharing Consent Needed',
        'Enable Two-way Udhar Sharing below to send this request, or click "Save Locally Only".'
      );
      return;
    }

    try {
      isSubmittingRef.current = true;
      setIsSubmitting(true);
      setSubmitStage(
        counterpartUserId ? 'Sending Udhar confirmation request...' : 'Saving local Udhar...'
      );

      const res = await udharDeletionApi.createUdharTransaction({
        counterpart_name: cleanName,
        counterpart_user_id: counterpartUserId,
        direction,
        amount: amt,
        category,
        payment_method: paymentMethod,
        description: description.trim() || undefined,
        transaction_date: txDate,
        due_date: dueDate || null,
        notes: notes.trim() || undefined,
        attachment_url: attachmentUrl.trim() || null,
        idempotency_key: idempotencyKeyRef.current,
      });

      if (res.success) {
        if (res.requiresConfirmation) {
          toast.success(
            'Udhar Request Sent',
            `Udhar request sent to ${cleanName}. Waiting for confirmation.`
          );
        } else {
          toast.success(
            direction === 'gave' ? 'Udhar Given Recorded' : 'Udhar Taken Recorded',
            res.message || `Local Udhar with ${cleanName} recorded.`
          );
        }

        setAmount('');
        setDescription('');
        setNotes('');
        setDueDate('');
        setAttachmentUrl('');
        setShowOptional(false);
        idempotencyKeyRef.current = generateIdempotencyKey();

        if (onSuccess) onSuccess(res.transaction);
        onClose();
      }
    } catch (err: any) {
      const msg = err?.message || 'Failed to save Udhar transaction.';
      setFormError(msg);
      toast.error('Could Not Record Udhar', msg);
    } finally {
      isSubmittingRef.current = false;
      setIsSubmitting(false);
      setSubmitStage('');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 bg-slate-950/75 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in"
      onClick={() => !isSubmitting && onClose()}
    >
      <div
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-5 sm:p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4 max-h-[92vh] overflow-y-auto"
      >
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                direction === 'gave'
                  ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
                  : 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
              }`}
            >
              {direction === 'gave' ? (
                <ArrowUpRight className="w-5 h-5" />
              ) : (
                <ArrowDownLeft className="w-5 h-5" />
              )}
            </div>
            <div>
              <h3 className="font-extrabold text-sm sm:text-base text-slate-900 dark:text-slate-100">
                Add Udhar Entry
              </h3>
              <p className="text-[11px] text-slate-500">
                {direction === 'gave'
                  ? "I Gave Money (You'll Receive)"
                  : "I Took Money (You'll Pay)"}
              </p>
            </div>
          </div>

          <button
            type="button"
            disabled={isSubmitting}
            onClick={onClose}
            aria-label="Close Add Udhar Modal"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer disabled:opacity-50"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {formError && (
          <div
            role="alert"
            className="p-3 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2"
          >
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
            <span>{formError}</span>
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* 1. Prominent Amount Field FIRST */}
          <div className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 space-y-2">
            <label className="block text-[11px] font-extrabold uppercase tracking-wider text-slate-500 dark:text-slate-400">
              Amount (₹ INR) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-xl font-black text-slate-400">
                ₹
              </span>
              <input
                type="number"
                step="any"
                min="0.01"
                required
                autoFocus
                disabled={isSubmitting}
                placeholder="0.00"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-9 pr-4 py-3 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-2xl font-black text-slate-900 dark:text-white focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center gap-1.5 flex-wrap pt-1">
              {[500, 1000, 2000, 5000, 10000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => setAmount(String(preset))}
                  className="px-2.5 py-1 rounded-lg text-[11px] font-bold bg-white dark:bg-slate-800 hover:bg-emerald-50 dark:hover:bg-emerald-950/50 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                >
                  {formatINR(preset)}
                </button>
              ))}
            </div>
          </div>

          {/* 2. Direction Toggle */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setDirection('gave')}
              className={`py-2.5 px-3 rounded-xl font-bold text-xs transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                direction === 'gave'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-1">
                <ArrowUpRight className="w-3.5 h-3.5" />
                <span>I Gave Money</span>
              </span>
              <span className={`text-[10px] ${direction === 'gave' ? 'text-emerald-100' : 'text-slate-400'}`}>
                You&apos;ll Receive
              </span>
            </button>

            <button
              type="button"
              disabled={isSubmitting}
              onClick={() => setDirection('took')}
              className={`py-2.5 px-3 rounded-xl font-bold text-xs transition-all flex flex-col items-center justify-center gap-0.5 cursor-pointer ${
                direction === 'took'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-slate-200'
              }`}
            >
              <span className="flex items-center gap-1">
                <ArrowDownLeft className="w-3.5 h-3.5" />
                <span>I Took Money</span>
              </span>
              <span className={`text-[10px] ${direction === 'took' ? 'text-rose-100' : 'text-slate-400'}`}>
                You&apos;ll Pay
              </span>
            </button>
          </div>

          {/* 3. Person & Method Selection */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                Person &amp; Confirmation Method <span className="text-rose-500">*</span>
              </span>
              {onOpenScanner && (
                <button
                  type="button"
                  disabled={isSubmitting}
                  onClick={() => {
                    onClose();
                    onOpenScanner();
                  }}
                  className="text-xs font-bold text-emerald-600 dark:text-emerald-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Open Camera QR</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-[11px] font-bold">
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setPersonMode('saved');
                  setFormError(null);
                }}
                className={`py-1.5 px-1 rounded-lg transition-all cursor-pointer truncate ${
                  personMode === 'saved'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                Connected ({savedContacts.length})
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setPersonMode('registered');
                  setFormError(null);
                }}
                className={`py-1.5 px-1 rounded-lg transition-all cursor-pointer truncate ${
                  personMode === 'registered'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                Search User
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setPersonMode('qr_code');
                  setFormError(null);
                  if (resolvedQr?.owner) {
                    setPersonName(resolvedQr.owner.displayName);
                    setCounterpartUserId(resolvedQr.owner.id);
                  }
                }}
                className={`py-1.5 px-1 rounded-lg transition-all cursor-pointer truncate flex items-center justify-center gap-1 ${
                  personMode === 'qr_code'
                    ? 'bg-emerald-600 text-white shadow-sm'
                    : 'text-emerald-700 dark:text-emerald-400'
                }`}
              >
                <Zap className="w-3 h-3 shrink-0" />
                <span>QR / Code</span>
              </button>
              <button
                type="button"
                disabled={isSubmitting}
                onClick={() => {
                  setPersonMode('manual');
                  setCounterpartUserId(null);
                  setFormError(null);
                }}
                className={`py-1.5 px-1 rounded-lg transition-all cursor-pointer truncate ${
                  personMode === 'manual'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                Local Person
              </button>
            </div>

            {/* Mode A1: Saved & Connected Contacts */}
            {personMode === 'saved' && (
              <div className="space-y-2">
                {isLoadingContacts ? (
                  <div className="p-3 rounded-xl bg-slate-50 dark:bg-slate-800/50 text-xs text-slate-400 flex items-center gap-2">
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Loading connected people...</span>
                  </div>
                ) : savedContacts.length > 0 ? (
                  <select
                    value={personName}
                    disabled={isSubmitting}
                    onChange={(e) => {
                      const val = e.target.value;
                      const sel = savedContacts.find((c) => c.name === val);
                      if (sel) handleSelectSavedContact(sel);
                      else {
                        setPersonName(val);
                        setCounterpartUserId(null);
                      }
                    }}
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold focus:ring-2 focus:ring-emerald-500"
                  >
                    <option value="">-- Choose a person --</option>
                    {savedContacts.map((c) => (
                      <option key={c.id} value={c.name}>
                        {c.name}{' '}
                        {c.linked_user_id
                          ? '(Connected • Requires Confirmation)'
                          : `(Local Contact • ${c.relationship_type || 'Manual'})`}
                      </option>
                    ))}
                  </select>
                ) : (
                  <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-center text-xs text-slate-500">
                    No saved people yet.{' '}
                    <button
                      type="button"
                      onClick={() => setPersonMode('registered')}
                      className="font-bold text-emerald-600 underline cursor-pointer"
                    >
                      Search users
                    </button>{' '}
                    or{' '}
                    <button
                      type="button"
                      onClick={() => setPersonMode('qr_code')}
                      className="font-bold text-emerald-600 underline cursor-pointer"
                    >
                      use QR / Code
                    </button>
                    .
                  </div>
                )}
              </div>
            )}

            {/* Mode A2: Live Registered User Search */}
            {personMode === 'registered' && (
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-2.5">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Type name, email, or phone..."
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    className="w-full pl-9 pr-8 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
                  />
                  {isSearching && (
                    <Loader2 className="w-3.5 h-3.5 animate-spin text-emerald-500 absolute right-3 top-2.5" />
                  )}
                </div>

                {searchError && (
                  <div className="p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300 flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5">
                      <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                      <span>{searchError}</span>
                    </span>
                    <button
                      type="button"
                      onClick={() => setRetryNonce((n) => n + 1)}
                      className="px-2 py-1 rounded-lg bg-rose-600 text-white text-[10px] font-bold flex items-center gap-1 cursor-pointer shrink-0"
                    >
                      <RefreshCw className="w-3 h-3" />
                      <span>Retry</span>
                    </button>
                  </div>
                )}

                {!isSearching &&
                  !searchError &&
                  normalizeSearchQuery(searchQuery).length >= 2 &&
                  searchResults.length === 0 && (
                    <p className="text-[11px] text-slate-400 text-center py-2">
                      No registered users found for &ldquo;{searchQuery}&rdquo;.
                    </p>
                  )}

                {searchResults.length > 0 && (
                  <div className="space-y-1.5 max-h-40 overflow-y-auto">
                    {searchResults.map((su) => {
                      const isSelf = su.isSelf || su.connectionStatus === 'self';
                      return (
                        <button
                          key={su.id}
                          type="button"
                          disabled={isSelf}
                          onClick={() => handleSelectRegisteredUser(su)}
                          className={`w-full text-left flex items-center justify-between p-2 rounded-xl border transition-all ${
                            isSelf
                              ? 'opacity-60 cursor-not-allowed bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700'
                              : counterpartUserId === su.id
                                ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-400 text-emerald-900 dark:text-emerald-200 cursor-pointer'
                                : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-300 cursor-pointer'
                          }`}
                        >
                          <div className="flex items-center gap-2 min-w-0">
                            <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                              {su.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div className="min-w-0">
                              <p className="text-xs font-bold leading-tight truncate">
                                {su.displayName} {isSelf ? '(You)' : ''}
                              </p>
                              <p className="text-[10px] text-slate-400 font-mono truncate">
                                {su.emailMasked || su.phoneMasked || 'Verified My Money Manager account'}
                              </p>
                            </div>
                          </div>
                          {isSelf ? (
                            <span className="text-[10px] font-bold text-slate-400">Self</span>
                          ) : counterpartUserId === su.id ? (
                            <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                          ) : (
                            <span className="text-[10px] font-bold text-emerald-600 shrink-0">
                              Select
                            </span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Mode B: Instant Verified Udhar via QR or Confirmation Code */}
            {personMode === 'qr_code' && (
              <div className="p-3.5 bg-emerald-50/70 dark:bg-emerald-950/25 rounded-2xl border border-emerald-200 dark:border-emerald-800/70 space-y-2.5">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <p className="text-xs font-extrabold text-emerald-900 dark:text-emerald-200 flex items-center gap-1.5">
                      <Zap className="w-3.5 h-3.5 text-emerald-600" />
                      <span>Method B: Instant Verified Udhar</span>
                    </p>
                    <p className="text-[11px] text-emerald-800/80 dark:text-emerald-300/80 mt-0.5">
                      Enter the recipient&apos;s Confirmation Code (<span className="font-mono font-bold">MM-XXXXXX</span>) or scan their QR code for immediate confirmation.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    placeholder="Enter code (e.g. MM-A1B2C3) or #pair link"
                    value={qrCodeInput}
                    disabled={isSubmitting || isVerifyingQr}
                    onChange={(e) => {
                      setQrCodeInput(e.target.value);
                      if (resolvedQr) {
                        setResolvedQr(null);
                      }
                      setQrVerifyError(null);
                    }}
                    className="flex-1 px-3 py-2 rounded-xl border border-emerald-300 dark:border-emerald-700 bg-white dark:bg-slate-900 text-xs font-mono font-bold focus:ring-2 focus:ring-emerald-500"
                  />
                  <button
                    type="button"
                    disabled={isVerifyingQr || isSubmitting || !qrCodeInput.trim()}
                    onClick={() => void resolveConfirmationCode(qrCodeInput)}
                    className="px-3 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-xs font-bold shrink-0 cursor-pointer flex items-center gap-1"
                  >
                    {isVerifyingQr ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <span>Verify</span>
                    )}
                  </button>
                </div>

                {qrVerifyError && (
                  <p className="text-[11px] text-rose-600 dark:text-rose-400 font-semibold flex items-center gap-1">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{qrVerifyError}</span>
                  </p>
                )}

                {resolvedQr?.owner && (
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-emerald-300 dark:border-emerald-700 flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div className="w-8 h-8 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center shrink-0">
                        {resolvedQr.owner.displayName.charAt(0).toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <p className="text-xs font-extrabold text-slate-900 dark:text-white truncate flex items-center gap-1">
                          <span>{resolvedQr.owner.displayName}</span>
                          <ShieldCheck className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                        </p>
                        <p className="text-[10px] text-slate-500 font-mono truncate">
                          {resolvedQr.owner.emailMasked || resolvedQr.owner.phoneMasked || 'Verified User'}
                        </p>
                      </div>
                    </div>
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 shrink-0">
                      Instant Confirm
                    </span>
                  </div>
                )}
              </div>
            )}

            {/* Mode C: Local Manual Person Name */}
            {personMode === 'manual' && (
              <div className="space-y-1.5">
                <input
                  type="text"
                  required
                  disabled={isSubmitting}
                  placeholder="Enter local contact's name (e.g. Ramesh, Priya)"
                  value={personName}
                  onChange={(e) => {
                    setPersonName(e.target.value);
                    setCounterpartUserId(null);
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            )}

            {/* Explicit Lifecycle & Sync Mode Status Indicator */}
            {isInstantMethodB && resolvedQr?.owner ? (
              <div className="p-2.5 rounded-xl text-[11px] font-semibold flex items-center justify-between gap-2 bg-emerald-50 dark:bg-emerald-950/50 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800/70">
                <span className="flex items-center gap-1.5 truncate">
                  <Zap className="w-3.5 h-3.5 text-emerald-600 shrink-0" />
                  <span className="truncate">
                    QR / Code Verified: Confirmed immediately on both accounts
                  </span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 bg-white/80 dark:bg-slate-900/60">
                  Instant Sync
                </span>
              </div>
            ) : !isInstantMethodB && personName.trim() ? (
              <div
                className={`p-2.5 rounded-xl text-[11px] font-semibold flex items-center justify-between gap-2 ${
                  isManualTwoWay
                    ? 'bg-amber-50 dark:bg-amber-950/40 text-amber-900 dark:text-amber-200 border border-amber-200 dark:border-amber-800/70'
                    : 'bg-slate-50 dark:bg-slate-800/60 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
                }`}
              >
                <span className="flex items-center gap-1.5 truncate">
                  {isManualTwoWay ? (
                    <Clock className="w-3.5 h-3.5 text-amber-600 shrink-0" />
                  ) : (
                    <UserCheck className="w-3.5 h-3.5 text-slate-500 shrink-0" />
                  )}
                  <span className="truncate">
                    {isManualTwoWay
                      ? `Method A: Request sent to ${personName} (Confirmed only after acceptance)`
                      : `Local Entry: ${personName}`}
                  </span>
                </span>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold shrink-0 bg-white/80 dark:bg-slate-900/60">
                  {isManualTwoWay ? 'Needs Confirmation' : 'Local Only'}
                </span>
              </div>
            ) : null}
          </div>

          {/* 4. Date, Category & Payment Method */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Date <span className="text-rose-500">*</span>
              </label>
              <input
                type="date"
                required
                disabled={isSubmitting}
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Category
              </label>
              <select
                disabled={isSubmitting}
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
              >
                {UDHAR_CATEGORIES.map((cat) => (
                  <option key={cat} value={cat}>
                    {cat}
                  </option>
                ))}
              </select>
            </div>

            <div className="space-y-1">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Payment Method
              </label>
              <select
                disabled={isSubmitting}
                value={paymentMethod}
                onChange={(e) => setPaymentMethod(e.target.value)}
                className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
              >
                {UDHAR_PAYMENT_METHODS.map((pm) => (
                  <option key={pm} value={pm}>
                    {pm}
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 5. Description */}
          <div className="space-y-1">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Description / Purpose
            </label>
            <input
              type="text"
              disabled={isSubmitting}
              placeholder="e.g. Hostel rent split, hospital deposit, trip booking"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* 6. Expandable Optional Details */}
          <div className="rounded-2xl border border-slate-200 dark:border-slate-800 overflow-hidden">
            <button
              type="button"
              aria-expanded={showOptional}
              onClick={() => setShowOptional((prev) => !prev)}
              className="w-full px-3.5 py-2.5 bg-slate-50 dark:bg-slate-800/50 text-xs font-bold text-slate-700 dark:text-slate-300 flex items-center justify-between cursor-pointer"
            >
              <span>Optional Details (Due Date, Notes, Receipt)</span>
              {showOptional ? (
                <ChevronUp className="w-4 h-4 text-slate-400" />
              ) : (
                <ChevronDown className="w-4 h-4 text-slate-400" />
              )}
            </button>

            {showOptional && (
              <div className="p-3.5 space-y-3 bg-white dark:bg-slate-900">
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Due Date (Optional)
                    </label>
                    <input
                      type="date"
                      value={dueDate}
                      onChange={(e) => setDueDate(e.target.value)}
                      className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>

                  <div className="space-y-1">
                    <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                      Receipt / Attachment
                    </label>
                    <label className="flex items-center justify-center gap-1.5 px-3 py-2 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 bg-slate-50 dark:bg-slate-800/50 text-xs font-semibold text-slate-600 dark:text-slate-300 cursor-pointer">
                      <Paperclip className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">
                        {attachmentUrl ? 'Receipt Attached ✓' : 'Attach Image'}
                      </span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handleAttachmentUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                {attachmentUrl && (
                  <div className="flex items-center justify-between p-2 rounded-xl bg-slate-50 dark:bg-slate-800 text-[11px]">
                    <span className="text-emerald-600 dark:text-emerald-400 font-semibold">
                      Receipt image ready to attach
                    </span>
                    <button
                      type="button"
                      onClick={() => setAttachmentUrl('')}
                      className="text-rose-500 font-bold hover:underline cursor-pointer"
                    >
                      Remove
                    </button>
                  </div>
                )}

                <div className="space-y-1">
                  <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                    Additional Note
                  </label>
                  <textarea
                    rows={2}
                    placeholder="Extra repayment terms or reminders..."
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500"
                  />
                </div>
              </div>
            )}
          </div>

          {/* Explicit Two-way Udhar Sharing Consent Notice when sharing with a connected user */}
          {(counterpartUserId || isInstantMethodB) && !hasUdharSharingConsent && (
            <div className="p-3.5 rounded-2xl bg-amber-50/90 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 space-y-2.5 text-xs">
              <div className="flex items-start gap-2">
                <Lock className="w-4 h-4 text-amber-700 dark:text-amber-400 shrink-0 mt-0.5" />
                <div className="space-y-0.5">
                  <p className="font-bold text-amber-900 dark:text-amber-200">
                    Two-way Udhar Sharing is currently off
                  </p>
                  <p className="text-[11px] text-amber-800/90 dark:text-amber-300/90 leading-relaxed">
                    Sharing this entry with {personName || 'your connected contact'} requires your explicit optional consent. Unrelated financial records are never shared.
                  </p>
                </div>
              </div>
              <div className="flex flex-wrap items-center gap-2">
                <button
                  type="button"
                  disabled={isGrantingUdharConsent}
                  onClick={() => void handleGrantUdharSharingConsent()}
                  className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white font-bold text-[11px] transition-colors cursor-pointer disabled:opacity-50"
                >
                  {isGrantingUdharConsent ? 'Saving...' : 'Enable Two-way Udhar Sharing'}
                </button>
                {!isInstantMethodB && (
                  <button
                    type="button"
                    onClick={() => {
                      setCounterpartUserId(null);
                      setPersonMode('manual');
                    }}
                    className="px-3 py-1.5 rounded-xl bg-white dark:bg-slate-800 border border-amber-300 dark:border-amber-700 text-amber-900 dark:text-amber-200 font-semibold text-[11px] cursor-pointer"
                  >
                    Save Locally Only (No Sharing)
                  </button>
                )}
              </div>
            </div>
          )}

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              disabled={isSubmitting}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 py-2.5 rounded-xl text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer disabled:opacity-50 ${
                direction === 'gave'
                  ? 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30'
                  : 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/30'
              }`}
            >
              {isSubmitting ? (
                <>
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                  <span>{submitStage || 'Saving...'}</span>
                </>
              ) : isInstantMethodB ? (
                <span>
                  Add Instant Udhar ({direction === 'gave' ? 'I Gave' : 'I Took'})
                </span>
              ) : isManualTwoWay ? (
                <span>
                  Send Request ({direction === 'gave' ? 'I Gave' : 'I Took'})
                </span>
              ) : (
                <span>
                  Save Udhar ({direction === 'gave' ? 'I Gave' : 'I Took'})
                </span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
