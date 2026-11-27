import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  UserPlus,
  User,
  Phone,
  Mail,
  FileText,
  Search,
  Sparkles,
  CheckCircle2,
  Loader2,
  Users,
  QrCode,
  AlertCircle,
  RefreshCw,
  ShieldCheck,
  ArrowLeft,
  Clock,
  Image as ImageIcon,
  Info,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { udharDeletionApi, SearchUserResult } from '../../lib/udharDeletionApi';
import { normalizeSearchQuery } from '../../lib/sharedUdharEngine';

interface AddPersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPersonAdded: (personName: string, linkedUserId?: string | null) => void;
  onRequestSent?: () => void;
  onOpenScanner?: () => void;
  onOpenProfile?: (personName: string, linkedUserId?: string | null) => void;
}

export const AddPersonModal: React.FC<AddPersonModalProps> = ({
  isOpen,
  onClose,
  onPersonAdded,
  onRequestSent,
  onOpenScanner,
  onOpenProfile,
}) => {
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'search' | 'qr' | 'manual'>('search');

  // Instant Live Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [searchError, setSearchError] = useState<string | null>(null);
  const [hasSearched, setHasSearched] = useState(false);
  const [retryNonce, setRetryNonce] = useState(0);

  // Selected user for explicit profile confirmation before connecting
  const [selectedCandidate, setSelectedCandidate] = useState<SearchUserResult | null>(null);
  const [connectRelationship, setConnectRelationship] = useState('Friend');
  const [isConnecting, setIsConnecting] = useState(false);

  // Stale-response & dedup refs
  const abortControllerRef = useRef<AbortController | null>(null);
  const requestSeqRef = useRef<number>(0);
  const lastFetchedQueryRef = useRef<string>('');

  // Manual Local Contact form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('Friend');
  const [notes, setNotes] = useState('');
  const [photoUrl, setPhotoUrl] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Reset modal state on close/open
  useEffect(() => {
    if (!isOpen) {
      abortControllerRef.current?.abort();
      setSelectedCandidate(null);
      setSearchError(null);
      setIsConnecting(false);
      setIsSubmitting(false);
      lastFetchedQueryRef.current = '';
    }
  }, [isOpen]);

  // Debounced instant live search (280ms) with AbortController, sequence guard, and query dedup
  useEffect(() => {
    if (!isOpen || activeTab !== 'search') return;

    const normalized = normalizeSearchQuery(searchQuery);
    if (normalized.length < 2) {
      abortControllerRef.current?.abort();
      setSearchResults([]);
      setSearchError(null);
      setIsSearching(false);
      setHasSearched(false);
      lastFetchedQueryRef.current = '';
      return;
    }

    if (normalized === lastFetchedQueryRef.current && retryNonce === 0) {
      return;
    }

    const seq = ++requestSeqRef.current;
    setIsSearching(true);
    setSearchError(null);

    const timer = setTimeout(async () => {
      abortControllerRef.current?.abort();
      const controller = new AbortController();
      abortControllerRef.current = controller;

      try {
        const res = await udharDeletionApi.searchUsers(normalized, controller.signal);
        if (seq !== requestSeqRef.current) return;

        if (res.success) {
          setSearchResults(res.users || []);
          setSearchError(null);
          setHasSearched(true);
          lastFetchedQueryRef.current = normalized;
        } else {
          setSearchResults([]);
          setSearchError('Could not complete search. Please try again.');
          setHasSearched(true);
        }
      } catch (err: any) {
        if (err?.name === 'AbortError') return;
        if (seq !== requestSeqRef.current) return;
        setSearchResults([]);
        setSearchError(
          err?.message || 'Unable to reach server right now. Check your connection and retry.'
        );
        setHasSearched(true);
      } finally {
        if (seq === requestSeqRef.current) {
          setIsSearching(false);
        }
      }
    }, 280);

    return () => {
      clearTimeout(timer);
    };
  }, [searchQuery, activeTab, isOpen, retryNonce]);

  if (!isOpen) return null;

  const handleRetrySearch = () => {
    lastFetchedQueryRef.current = '';
    setSearchError(null);
    setRetryNonce((n) => n + 1);
  };

  const handleConfirmConnect = async () => {
    if (!selectedCandidate || isConnecting) return;

    try {
      setIsConnecting(true);
      const res = await udharDeletionApi.connectUser({
        targetUserId: selectedCandidate.id,
        relationshipType: connectRelationship,
      });

      if (res.status === 'connected') {
        toast.success(
          res.alreadyConnected ? 'Already Connected' : 'Connected!',
          res.message || `"${selectedCandidate.fullName}" is now connected for 2-way shared Udhar.`
        );
        onPersonAdded(selectedCandidate.fullName, selectedCandidate.id);
        onRequestSent?.();
      } else {
        toast.success(
          'Request Sent',
          res.message ||
            'Your connection request was sent. They must accept it before any profile details are shared.'
        );
        onRequestSent?.();
      }
      setSelectedCandidate(null);
      setSearchQuery('');
      setSearchResults([]);
      onClose();
    } catch (err: any) {
      toast.error('Connection Failed', err.message || 'Could not connect with this user.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handleAcceptIncoming = async (userItem: SearchUserResult) => {
    if (isConnecting) return;
    try {
      setIsConnecting(true);
      const res = await udharDeletionApi.respondToConnectionRequest(
        userItem.requestId || userItem.id,
        'accept'
      );
      toast.success(
        'Connected!',
        res.message || `Connected with ${userItem.fullName}. Added to your Saved People.`
      );
      onPersonAdded(userItem.fullName, userItem.id);
      onRequestSent?.();
      setSearchQuery('');
      setSearchResults([]);
      onClose();
    } catch (err: any) {
      toast.error('Accept Failed', err?.message || 'Could not accept connection request.');
    } finally {
      setIsConnecting(false);
    }
  };

  const handlePhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > 500 * 1024) {
      toast.error('Image Too Large', 'Please choose an image smaller than 500 KB.');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === 'string') {
        setPhotoUrl(reader.result);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;

    const cleanName = name.trim();
    if (!cleanName || cleanName.length < 2) {
      toast.error('Validation Error', 'Full name must be at least 2 characters.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await udharDeletionApi.saveContact({
        name: cleanName,
        phone: phone.trim() || undefined,
        email: email.trim() || undefined,
        photo_url: photoUrl.trim() || undefined,
        relationship_type: relationship.trim() || 'Friend',
        notes: notes.trim() || undefined,
        linked_user_id: null, // Explicitly local contact — never silently auto-link
      });

      if (res.success) {
        toast.success(
          'Local Person Added',
          `"${cleanName}" saved as a local contact (no 2-way sync).`
        );
        onPersonAdded(cleanName, null);
        setName('');
        setPhone('');
        setEmail('');
        setNotes('');
        setPhotoUrl('');
        onClose();
      }
    } catch (err: any) {
      toast.error('Failed to Add Person', err.message || 'Could not save contact.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/75 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-2xl space-y-4 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center shrink-0">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                Add Person
              </h3>
              <p className="text-[11px] text-slate-500 dark:text-slate-400">
                Search registered users, scan QR, or add local contact
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close Add Person Modal"
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* 3 Integrated Methods Tab Switch */}
        {!selectedCandidate && (
          <div className="grid grid-cols-3 gap-1 p-1 rounded-2xl bg-slate-100 dark:bg-slate-800 text-[11px] sm:text-xs font-bold">
            <button
              type="button"
              onClick={() => setActiveTab('search')}
              className={`py-2 px-1.5 rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer ${
                activeTab === 'search'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <Search className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Search People</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('qr')}
              className={`py-2 px-1.5 rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer ${
                activeTab === 'qr'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <QrCode className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Scan QR</span>
            </button>
            <button
              type="button"
              onClick={() => setActiveTab('manual')}
              className={`py-2 px-1.5 rounded-xl transition-all flex items-center justify-center gap-1 cursor-pointer ${
                activeTab === 'manual'
                  ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                  : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
              }`}
            >
              <UserPlus className="w-3.5 h-3.5 shrink-0" />
              <span className="truncate">Add Manually</span>
            </button>
          </div>
        )}

        {/* Profile Confirmation Step (after selecting a user from live search) */}
        {selectedCandidate ? (
          <div className="space-y-4 animate-fade-in">
            <button
              type="button"
              onClick={() => setSelectedCandidate(null)}
              className="inline-flex items-center gap-1.5 text-xs font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
              <span>Back to search results</span>
            </button>

            <div className="p-5 rounded-3xl bg-gradient-to-br from-emerald-50 via-teal-50/40 to-blue-50/40 dark:from-emerald-950/40 dark:via-slate-800 dark:to-slate-900 border border-emerald-200 dark:border-emerald-800 text-center space-y-3">
              <div className="relative inline-block mx-auto">
                {selectedCandidate.avatarUrl ? (
                  <img
                    src={selectedCandidate.avatarUrl}
                    alt={selectedCandidate.fullName}
                    className="w-16 h-16 rounded-2xl object-cover border-2 border-emerald-500/40 shadow-md"
                  />
                ) : (
                  <div className="w-16 h-16 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black text-2xl flex items-center justify-center shadow-md">
                    {selectedCandidate.fullName.charAt(0).toUpperCase()}
                  </div>
                )}
                <span className="absolute -bottom-1 -right-1 w-5 h-5 rounded-full bg-emerald-600 text-white flex items-center justify-center text-[10px] border-2 border-white dark:border-slate-900">
                  ✓
                </span>
              </div>

              <div>
                <span className="inline-flex items-center gap-1 px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300">
                  <ShieldCheck className="w-3 h-3 text-emerald-600" />
                  <span>Verified My Money Manager User</span>
                </span>
                <h4 className="text-lg font-black text-slate-900 dark:text-slate-100 mt-1.5">
                  {selectedCandidate.fullName}
                </h4>
                <p className="text-xs text-slate-500 font-mono mt-0.5">
                  {selectedCandidate.emailMasked || 'Registered My Money Manager account'}
                </p>
                {selectedCandidate.phoneMasked && (
                  <p className="text-[11px] text-slate-400 font-mono">
                    {selectedCandidate.phoneMasked}
                  </p>
                )}
              </div>

              <p className="text-[11px] text-emerald-800 dark:text-emerald-300 bg-emerald-100/70 dark:bg-emerald-950/60 p-2.5 rounded-xl font-medium">
                Connecting enables real-time 2-way Shared Udhar tracking, mutual repayment
                confirmation, and synchronized balances for both accounts.
              </p>
            </div>

            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Relationship Tag
              </label>
              <select
                value={connectRelationship}
                onChange={(e) => setConnectRelationship(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-semibold focus:ring-2 focus:ring-emerald-500"
              >
                <option value="Friend">Friend</option>
                <option value="Family">Family</option>
                <option value="Roommate">Roommate</option>
                <option value="Colleague">Colleague</option>
                <option value="Business">Business</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="flex items-center gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedCandidate(null)}
                disabled={isConnecting}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="button"
                disabled={isConnecting}
                onClick={handleConfirmConnect}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 disabled:opacity-50 text-white text-xs font-bold shadow-md shadow-emerald-600/30 flex items-center justify-center gap-1.5 cursor-pointer"
              >
                {isConnecting ? (
                  <>
                    <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    <span>Connecting...</span>
                  </>
                ) : (
                  <>
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Confirm &amp; Connect</span>
                  </>
                )}
              </button>
            </div>
          </div>
        ) : (
          <>
            {/* Tab 1: Instant Live User Search */}
            {activeTab === 'search' && (
              <div className="space-y-3 animate-fade-in">
                <div className="relative">
                  <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                  <input
                    type="text"
                    autoFocus
                    value={searchQuery}
                    onChange={(e) => {
                      setSearchQuery(e.target.value);
                      setRetryNonce(0);
                    }}
                    placeholder="Type name, email, or phone to search live..."
                    aria-label="Search registered people"
                    className="w-full pl-9 pr-9 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
                  />
                  {isSearching ? (
                    <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-emerald-500" />
                  ) : searchQuery.length > 0 ? (
                    <button
                      type="button"
                      onClick={() => {
                        setSearchQuery('');
                        setSearchResults([]);
                        setSearchError(null);
                        setHasSearched(false);
                      }}
                      aria-label="Clear search"
                      className="absolute right-2.5 top-1/2 -translate-y-1/2 p-0.5 text-slate-400 hover:text-slate-600 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </button>
                  ) : null}
                </div>

                {/* Live Results Container */}
                <div className="max-h-72 overflow-y-auto space-y-2 pr-0.5">
                  {/* Loading Skeletons */}
                  {isSearching && (
                    <div className="space-y-2" aria-live="polite">
                      {[1, 2, 3].map((idx) => (
                        <div
                          key={idx}
                          className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 flex items-center justify-between gap-3 animate-pulse"
                        >
                          <div className="flex items-center gap-2.5 flex-1">
                            <div className="w-10 h-10 rounded-xl bg-slate-200 dark:bg-slate-700 shrink-0" />
                            <div className="space-y-1.5 flex-1">
                              <div className="h-3 w-28 rounded bg-slate-200 dark:bg-slate-700" />
                              <div className="h-2.5 w-36 rounded bg-slate-200 dark:bg-slate-700" />
                            </div>
                          </div>
                          <div className="h-7 w-16 rounded-xl bg-slate-200 dark:bg-slate-700" />
                        </div>
                      ))}
                    </div>
                  )}

                  {/* Real Error State (NEVER masked as "No people found") */}
                  {!isSearching && searchError && (
                    <div
                      role="alert"
                      className="p-4 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-center space-y-2.5"
                    >
                      <AlertCircle className="w-6 h-6 text-rose-500 mx-auto" />
                      <div>
                        <p className="text-xs font-bold text-rose-800 dark:text-rose-200">
                          Search Error
                        </p>
                        <p className="text-[11px] text-rose-600 dark:text-rose-300 mt-0.5">
                          {searchError}
                        </p>
                      </div>
                      <button
                        type="button"
                        onClick={handleRetrySearch}
                        className="inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-700 text-white text-xs font-bold cursor-pointer"
                      >
                        <RefreshCw className="w-3.5 h-3.5" />
                        <span>Retry</span>
                      </button>
                    </div>
                  )}

                  {/* True Empty State */}
                  {!isSearching &&
                    !searchError &&
                    hasSearched &&
                    normalizeSearchQuery(searchQuery).length >= 2 &&
                    searchResults.length === 0 && (
                      <div className="p-5 text-center rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200/70 dark:border-slate-800 space-y-2">
                        <Users className="w-7 h-7 mx-auto text-slate-300 dark:text-slate-600" />
                        <p className="text-xs font-bold text-slate-700 dark:text-slate-300">
                          No people found
                        </p>
                        <p className="text-[11px] text-slate-500 dark:text-slate-400">
                          Try another search by full name, email, or phone number, or save them as a
                          local contact.
                        </p>
                        <button
                          type="button"
                          onClick={() => {
                            setName(searchQuery.trim());
                            setActiveTab('manual');
                          }}
                          className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold cursor-pointer"
                        >
                          <UserPlus className="w-3.5 h-3.5" />
                          <span>Add Person Manually</span>
                        </button>
                      </div>
                    )}

                  {/* Search Result Cards */}
                  {!isSearching &&
                    !searchError &&
                    searchResults.map((userItem) => {
                      const status =
                        userItem.connectionStatus ||
                        (userItem.isSelf
                          ? 'self'
                          : userItem.isAlreadyConnected
                            ? 'connected'
                            : 'none');

                      return (
                        <div
                          key={userItem.id}
                          className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100/80 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-3"
                        >
                          <div className="flex items-center gap-2.5 min-w-0">
                            {userItem.avatarUrl ? (
                              <img
                                src={userItem.avatarUrl}
                                alt={userItem.fullName}
                                className="w-10 h-10 rounded-xl object-cover border border-emerald-500/30 shrink-0"
                              />
                            ) : (
                              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold flex items-center justify-center text-xs shrink-0">
                                {userItem.fullName
                                  ? userItem.fullName.charAt(0).toUpperCase()
                                  : 'U'}
                              </div>
                            )}
                            <div className="min-w-0">
                              <div className="flex items-center gap-1.5">
                                <p className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate">
                                  {userItem.fullName}
                                </p>
                                {status === 'self' ? (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-slate-200 dark:bg-slate-700 text-slate-600 dark:text-slate-300 shrink-0">
                                    You
                                  </span>
                                ) : (
                                  <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300 shrink-0">
                                    Verified
                                  </span>
                                )}
                              </div>
                              <p className="text-[11px] text-slate-500 dark:text-slate-400 font-mono truncate">
                                {userItem.emailMasked || 'Registered My Money Manager account'}
                                {userItem.phoneMasked ? ` · ${userItem.phoneMasked}` : ''}
                              </p>
                            </div>
                          </div>

                          {/* State-specific Action Button */}
                          {status === 'self' ? (
                            <span className="px-2.5 py-1.5 rounded-xl bg-slate-200/80 dark:bg-slate-700 text-slate-500 dark:text-slate-400 text-[11px] font-bold shrink-0">
                              You
                            </span>
                          ) : status === 'connected' ? (
                            <div className="flex items-center gap-1.5 shrink-0">
                              <span className="px-2 py-1 rounded-lg bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 text-[10px] font-bold flex items-center gap-1">
                                <CheckCircle2 className="w-3 h-3" />
                                <span>Connected</span>
                              </span>
                              {onOpenProfile && (
                                <button
                                  type="button"
                                  onClick={() => {
                                    onClose();
                                    onOpenProfile(userItem.fullName, userItem.id);
                                  }}
                                  className="px-2.5 py-1.5 rounded-xl bg-slate-900 dark:bg-slate-100 text-white dark:text-slate-900 text-[11px] font-bold cursor-pointer"
                                >
                                  Open Profile
                                </button>
                              )}
                            </div>
                          ) : status === 'incoming_pending' ? (
                            <button
                              type="button"
                              disabled={isConnecting}
                              onClick={() => void handleAcceptIncoming(userItem)}
                              className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 active:scale-95 disabled:opacity-50 text-white text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 cursor-pointer shadow-sm"
                            >
                              {isConnecting ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3" />
                              )}
                              <span>Accept Request</span>
                            </button>
                          ) : status === 'pending' ? (
                            <span className="px-2.5 py-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/60 text-amber-700 dark:text-amber-300 text-[11px] font-bold flex items-center gap-1 shrink-0">
                              <Clock className="w-3 h-3" />
                              <span>Pending</span>
                            </span>
                          ) : (
                            <button
                              type="button"
                              onClick={() => {
                                setConnectRelationship('Friend');
                                setSelectedCandidate(userItem);
                              }}
                              className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-[11px] font-bold transition-all flex items-center gap-1 shrink-0 cursor-pointer shadow-sm shadow-emerald-600/30"
                            >
                              <Sparkles className="w-3 h-3" />
                              <span>Select</span>
                            </button>
                          )}
                        </div>
                      );
                    })}

                  {/* Idle Prompt */}
                  {normalizeSearchQuery(searchQuery).length < 2 && (
                    <div className="p-5 text-center text-xs text-slate-500 dark:text-slate-400 rounded-2xl bg-slate-50 dark:bg-slate-800/40 space-y-1.5">
                      <Users className="w-6 h-6 mx-auto text-slate-300 dark:text-slate-600" />
                      <p className="font-semibold text-slate-700 dark:text-slate-300">
                        Instant Registered User Search
                      </p>
                      <p className="text-[11px]">
                        Start typing at least 2 characters of a name, email, or phone number to find
                        registered My Money Manager users for 2-way Shared Udhar.
                      </p>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Tab 2: Scan QR */}
            {activeTab === 'qr' && (
              <div className="p-5 rounded-2xl bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-800 text-center space-y-4 animate-fade-in">
                <div className="w-14 h-14 rounded-2xl bg-emerald-100 dark:bg-emerald-950/70 text-emerald-600 dark:text-emerald-400 flex items-center justify-center mx-auto">
                  <QrCode className="w-8 h-8" />
                </div>
                <div className="space-y-1">
                  <h4 className="font-extrabold text-sm text-slate-900 dark:text-slate-100">
                    Connect Instantly via QR Code
                  </h4>
                  <p className="text-xs text-slate-500 dark:text-slate-400 leading-relaxed">
                    Scan another user&apos;s unique My Money Manager QR code with your camera,
                    upload a QR screenshot, or enter their pairing code (MM-XXXXXX) for verified
                    2-way sync.
                  </p>
                </div>
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    if (onOpenScanner) onOpenScanner();
                  }}
                  className="w-full py-3 px-4 rounded-2xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-bold text-xs shadow-md shadow-emerald-600/30 flex items-center justify-center gap-2 cursor-pointer"
                >
                  <QrCode className="w-4 h-4" />
                  <span>Open QR Scanner / Pair Code</span>
                </button>
              </div>
            )}

            {/* Tab 3: Manual Add Form (Explicitly Local Contact Only) */}
            {activeTab === 'manual' && (
              <form onSubmit={handleManualSubmit} className="space-y-3.5 text-xs animate-fade-in">
                <div className="p-3 rounded-2xl bg-amber-50 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/60 flex items-start gap-2.5 text-amber-900 dark:text-amber-200">
                  <Info className="w-4 h-4 text-amber-600 dark:text-amber-400 shrink-0 mt-0.5" />
                  <div className="text-[11px] leading-relaxed">
                    <span className="font-bold block">Local / Manual Contact (No 2-Way Sync)</span>
                    This person is stored only in your personal ledger and will never be silently
                    auto-linked to another account. You can invite or connect them later anytime.
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Full Name <span className="text-rose-500">*</span>
                  </label>
                  <div className="relative">
                    <User className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                    <input
                      type="text"
                      required
                      autoFocus
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. Rahul Sharma, Priya Singh"
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-bold focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Mobile (Optional)
                    </label>
                    <div className="relative">
                      <Phone className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="tel"
                        value={phone}
                        onChange={(e) => setPhone(e.target.value)}
                        placeholder="e.g. 9876543210"
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Email (Optional)
                    </label>
                    <div className="relative">
                      <Mail className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                      <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        placeholder="email@domain.com"
                        className="w-full pl-9 pr-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
                      />
                    </div>
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Relationship Tag
                    </label>
                    <select
                      value={relationship}
                      onChange={(e) => setRelationship(e.target.value)}
                      className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-semibold focus:ring-2 focus:ring-emerald-500"
                    >
                      <option value="Friend">Friend</option>
                      <option value="Roommate">Roommate</option>
                      <option value="Colleague">Colleague</option>
                      <option value="Family">Family</option>
                      <option value="Business">Business</option>
                      <option value="Other">Other</option>
                    </select>
                  </div>

                  <div>
                    <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                      Profile Photo (Optional)
                    </label>
                    <label className="flex items-center justify-center gap-1.5 px-3 py-2.5 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 hover:border-emerald-500 bg-slate-50 dark:bg-slate-800/60 text-slate-600 dark:text-slate-300 font-semibold cursor-pointer">
                      <ImageIcon className="w-3.5 h-3.5 text-slate-400" />
                      <span className="truncate">{photoUrl ? 'Photo Attached' : 'Upload Image'}</span>
                      <input
                        type="file"
                        accept="image/*"
                        onChange={handlePhotoUpload}
                        className="hidden"
                      />
                    </label>
                  </div>
                </div>

                <div>
                  <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                    Personal Note (Optional)
                  </label>
                  <div className="relative">
                    <FileText className="w-4 h-4 absolute left-3 top-3 text-slate-400" />
                    <textarea
                      rows={2}
                      value={notes}
                      onChange={(e) => setNotes(e.target.value)}
                      placeholder="e.g. Flatmate for flat 402, shared grocery expense..."
                      className="w-full pl-9 pr-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-end gap-2.5 pt-2 border-t border-slate-100 dark:border-slate-800">
                  <button
                    type="button"
                    onClick={onClose}
                    disabled={isSubmitting}
                    className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
                  >
                    Cancel
                  </button>
                  <button
                    type="submit"
                    disabled={isSubmitting}
                    className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 disabled:opacity-50 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-emerald-600/30"
                  >
                    {isSubmitting ? 'Saving...' : 'Save Local Contact'}
                  </button>
                </div>
              </form>
            )}
          </>
        )}
      </div>
    </div>
  );
};
