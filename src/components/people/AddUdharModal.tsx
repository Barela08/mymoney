import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  Search,
  UserPlus,
  QrCode,
  ArrowUpRight,
  ArrowDownLeft,
  Calendar,
  Clock,
  Sparkles,
  CheckCircle2,
  BookmarkCheck,
  FileText,
  AlertCircle,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import {
  udharDeletionApi,
  UdharContact,
  SearchUserResult,
} from '../../lib/udharDeletionApi';
import { getCurrentISTDate, getCurrentISTTime, formatINR } from '../../lib/dateUtils';

interface AddUdharModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess?: () => void;
  onOpenScanner?: () => void;
  initialPersonName?: string;
}

export const AddUdharModal: React.FC<AddUdharModalProps> = ({
  isOpen,
  onClose,
  onSuccess,
  onOpenScanner,
  initialPersonName,
}) => {
  const { user } = useAuth();
  const toast = useToast();

  // Person Selection Mode: 'registered' | 'saved' | 'manual' | 'qr'
  const [personMode, setPersonMode] = useState<'registered' | 'saved' | 'manual'>('saved');

  // Selected Person Data
  const [personName, setPersonName] = useState<string>(initialPersonName || '');
  const [counterpartUserId, setCounterpartUserId] = useState<string | null>(null);
  const [saveToContacts, setSaveToContacts] = useState<boolean>(true);

  // Form Fields
  const [direction, setDirection] = useState<'gave' | 'took'>('gave');
  const [amount, setAmount] = useState<string>('');
  const [txDate, setTxDate] = useState<string>(getCurrentISTDate());
  const [dueDate, setDueDate] = useState<string>('');
  const [notes, setNotes] = useState<string>('');
  const [isSubmitting, setIsSubmitting] = useState<boolean>(false);

  // Registered User Search
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
  const [isSearching, setIsSearching] = useState<boolean>(false);

  // Saved Contacts
  const [savedContacts, setSavedContacts] = useState<UdharContact[]>([]);
  const [isLoadingContacts, setIsLoadingContacts] = useState<boolean>(false);

  // Fetch saved contacts when opening
  useEffect(() => {
    if (isOpen) {
      setTxDate(getCurrentISTDate());
      if (initialPersonName) {
        setPersonName(initialPersonName);
        setPersonMode('manual');
      }
      loadContacts();
    }
  }, [isOpen, initialPersonName]);

  const loadContacts = async () => {
    try {
      setIsLoadingContacts(true);
      const res = await udharDeletionApi.getContacts();
      if (res.success) {
        setSavedContacts(res.contacts);
        // Default to saved if contacts exist, otherwise manual
        if (res.contacts.length === 0 && !initialPersonName) {
          setPersonMode('manual');
        }
      }
    } catch {
      // ignore
    } finally {
      setIsLoadingContacts(false);
    }
  };

  // Search registered users
  useEffect(() => {
    if (personMode !== 'registered' || searchQuery.trim().length < 2) {
      setSearchResults([]);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearching(true);
        const res = await udharDeletionApi.searchUsers(searchQuery);
        if (res.success) {
          setSearchResults(res.users);
        }
      } catch {
        // ignore
      } finally {
        setIsSearching(false);
      }
    }, 350);

    return () => clearTimeout(timer);
  }, [searchQuery, personMode]);

  if (!isOpen) return null;

  const handleSelectRegisteredUser = (u: SearchUserResult) => {
    setPersonName(u.displayName);
    setCounterpartUserId(u.id);
    toast.success('Selected Registered User', `${u.displayName} selected for two-sided Udhar.`);
  };

  const handleSelectSavedContact = (c: UdharContact) => {
    setPersonName(c.name);
    setCounterpartUserId(c.linked_user_id || null);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const cleanName = personName.trim();
    if (!cleanName) {
      toast.error('Person Required', 'Please choose or enter the person name.');
      return;
    }

    const amt = parseFloat(amount);
    if (isNaN(amt) || amt <= 0) {
      toast.error('Invalid Amount', 'Please enter a valid amount greater than ₹0.');
      return;
    }

    try {
      setIsSubmitting(true);
      const res = await udharDeletionApi.createUdharTransaction({
        counterpart_name: cleanName,
        counterpart_user_id: counterpartUserId,
        direction,
        amount: amt,
        transaction_date: txDate,
        due_date: dueDate || null,
        notes: notes.trim() || undefined,
      });

      if (res.success) {
        toast.success(
          direction === 'gave' ? 'Udhar Given Recorded' : 'Udhar Taken Recorded',
          res.isLinked
            ? `Two-sided synchronized Udhar created with ${cleanName}.`
            : `Udhar with ${cleanName} saved.`
        );

        // Reset and close
        setAmount('');
        setNotes('');
        setDueDate('');
        if (onSuccess) onSuccess();
        onClose();
      }
    } catch (err: any) {
      toast.error('Error', err.message || 'Failed to record Udhar transaction.');
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div
              className={`w-9 h-9 rounded-xl flex items-center justify-center ${
                direction === 'gave'
                  ? 'bg-rose-50 dark:bg-rose-950/60 text-rose-600 dark:text-rose-400'
                  : 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400'
              }`}
            >
              {direction === 'gave' ? <ArrowUpRight className="w-5 h-5" /> : <ArrowDownLeft className="w-5 h-5" />}
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                {direction === 'gave' ? '+ Add Udhar Diya (I Gave / Lend)' : '+ Add Udhar Liya (I Took / Borrow)'}
              </h3>
              <p className="text-[11px] text-slate-500">Track smart debts with optional 2-way sync</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          {/* Direction Toggle: I Gave vs I Took */}
          <div className="grid grid-cols-2 gap-2 p-1 bg-slate-100 dark:bg-slate-800 rounded-2xl">
            <button
              type="button"
              onClick={() => setDirection('gave')}
              className={`py-2.5 px-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                direction === 'gave'
                  ? 'bg-rose-600 text-white shadow-md shadow-rose-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <ArrowUpRight className="w-4 h-4" />
              <span>I Gave (मैंने दिए / Lend)</span>
            </button>

            <button
              type="button"
              onClick={() => setDirection('took')}
              className={`py-2.5 px-3 rounded-xl font-bold text-xs transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
                direction === 'took'
                  ? 'bg-emerald-600 text-white shadow-md shadow-emerald-600/30'
                  : 'text-slate-600 dark:text-slate-400 hover:text-slate-900'
              }`}
            >
              <ArrowDownLeft className="w-4 h-4" />
              <span>I Took (मैंने लिए / Borrow)</span>
            </button>
          </div>

          {/* Person Selection Segmented Control */}
          <div className="space-y-2">
            <div className="flex items-center justify-between text-xs">
              <span className="font-bold text-slate-700 dark:text-slate-300">
                Person Selection Mode:
              </span>
              {onOpenScanner && (
                <button
                  type="button"
                  onClick={() => {
                    onClose();
                    onOpenScanner();
                  }}
                  className="text-xs font-bold text-blue-600 dark:text-blue-400 hover:underline flex items-center gap-1 cursor-pointer"
                >
                  <QrCode className="w-3.5 h-3.5" />
                  <span>Scan QR Code</span>
                </button>
              )}
            </div>

            <div className="grid grid-cols-3 gap-1 p-1 bg-slate-100 dark:bg-slate-800 rounded-xl text-xs font-bold">
              <button
                type="button"
                onClick={() => setPersonMode('saved')}
                className={`py-1.5 rounded-lg transition-all ${
                  personMode === 'saved'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                Saved People ({savedContacts.length})
              </button>
              <button
                type="button"
                onClick={() => setPersonMode('registered')}
                className={`py-1.5 rounded-lg transition-all ${
                  personMode === 'registered'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                Search User (2-Way)
              </button>
              <button
                type="button"
                onClick={() => {
                  setPersonMode('manual');
                  setCounterpartUserId(null);
                }}
                className={`py-1.5 rounded-lg transition-all ${
                  personMode === 'manual'
                    ? 'bg-white dark:bg-slate-900 text-slate-900 dark:text-white shadow-sm'
                    : 'text-slate-500'
                }`}
              >
                Add New Person
              </button>
            </div>
          </div>

          {/* Mode 1: Search Registered User */}
          {personMode === 'registered' && (
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 rounded-2xl border border-slate-200 dark:border-slate-700 space-y-3">
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Search by registered email or mobile..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3.5 py-2 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              {isSearching && (
                <p className="text-[11px] text-slate-400 text-center py-2 animate-pulse">
                  Searching registered users...
                </p>
              )}

              {searchResults.length > 0 && (
                <div className="space-y-1.5 max-h-40 overflow-y-auto">
                  {searchResults.map((su) => (
                    <div
                      key={su.id}
                      onClick={() => handleSelectRegisteredUser(su)}
                      className={`flex items-center justify-between p-2 rounded-xl border transition-all cursor-pointer ${
                        counterpartUserId === su.id
                          ? 'bg-emerald-50 dark:bg-emerald-950 border-emerald-400 text-emerald-900 dark:text-emerald-200'
                          : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 hover:border-emerald-300'
                      }`}
                    >
                      <div className="flex items-center gap-2">
                        <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
                          {su.displayName.charAt(0).toUpperCase()}
                        </div>
                        <div>
                          <p className="text-xs font-bold leading-tight">{su.displayName}</p>
                          <p className="text-[10px] text-slate-400 font-mono">{su.emailMasked}</p>
                        </div>
                      </div>
                      {counterpartUserId === su.id ? (
                        <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
                      ) : (
                        <span className="text-[10px] font-bold text-emerald-600">Select</span>
                      )}
                    </div>
                  ))}
                </div>
              )}

              {personName && counterpartUserId && (
                <div className="p-2 rounded-xl bg-emerald-100/70 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-200 text-xs flex items-center justify-between font-bold">
                  <span>Selected: {personName}</span>
                  <span className="text-[10px] font-semibold bg-emerald-200 dark:bg-emerald-900 px-2 py-0.5 rounded-full">
                    2-Sided Sync Active
                  </span>
                </div>
              )}
            </div>
          )}

          {/* Mode 2: Select from Saved Contacts */}
          {personMode === 'saved' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Choose from Saved Contacts:
              </label>
              {savedContacts.length > 0 ? (
                <select
                  value={personName}
                  onChange={(e) => {
                    const sel = savedContacts.find((c) => c.name === e.target.value);
                    if (sel) handleSelectSavedContact(sel);
                    else {
                      setPersonName(e.target.value);
                      setCounterpartUserId(null);
                    }
                  }}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold focus:ring-2 focus:ring-emerald-500"
                >
                  <option value="">-- Choose a contact --</option>
                  {savedContacts.map((c) => (
                    <option key={c.id} value={c.name}>
                      {c.name} {c.linked_user_id ? '(Linked User ★)' : `(${c.relationship_type || 'Contact'})`}
                    </option>
                  ))}
                </select>
              ) : (
                <div className="p-3 bg-slate-50 dark:bg-slate-800/60 rounded-xl text-center text-xs text-slate-500">
                  No saved contacts yet.{' '}
                  <button
                    type="button"
                    onClick={() => setPersonMode('manual')}
                    className="font-bold text-emerald-600 underline"
                  >
                    Add new person
                  </button>
                </div>
              )}
            </div>
          )}

          {/* Mode 3: Manual Person Name Entry */}
          {personMode === 'manual' && (
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Person Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="Enter person's name (e.g. Ramesh, Priya)"
                value={personName}
                onChange={(e) => {
                  setPersonName(e.target.value);
                  setCounterpartUserId(null);
                }}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          )}

          {/* Amount Field */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Amount (₹ INR) <span className="text-rose-500">*</span>
            </label>
            <div className="relative">
              <span className="absolute left-3.5 top-2.5 font-bold text-slate-400">₹</span>
              <input
                type="number"
                step="any"
                min="1"
                required
                placeholder="e.g. 1500"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full pl-8 pr-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm font-bold focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {/* Quick preset buttons */}
            <div className="flex items-center gap-1.5 pt-1">
              {[500, 1000, 2000, 5000].map((preset) => (
                <button
                  key={preset}
                  type="button"
                  onClick={() => setAmount(String(preset))}
                  className="px-2.5 py-1 rounded-lg text-[10px] font-bold bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 transition-colors cursor-pointer"
                >
                  +{formatINR(preset)}
                </button>
              ))}
            </div>
          </div>

          {/* Dates: Transaction Date & Due Date */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Transaction Date
              </label>
              <input
                type="date"
                required
                value={txDate}
                onChange={(e) => setTxDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Due Date (Optional)
              </label>
              <input
                type="date"
                value={dueDate}
                onChange={(e) => setDueDate(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
              />
            </div>
          </div>

          {/* Notes */}
          <div className="space-y-1.5">
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
              Notes / Purpose (Optional)
            </label>
            <input
              type="text"
              placeholder="e.g. For dinner bill, college fee, emergency loan"
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500"
            />
          </div>

          {/* Action Buttons */}
          <div className="flex items-center gap-3 pt-3 border-t border-slate-100 dark:border-slate-800">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={isSubmitting}
              className={`flex-1 py-2.5 rounded-xl text-white text-xs font-bold shadow-md transition-all flex items-center justify-center gap-2 cursor-pointer ${
                direction === 'gave'
                  ? 'bg-rose-600 hover:bg-rose-700 shadow-rose-600/30'
                  : 'bg-emerald-600 hover:bg-emerald-700 shadow-emerald-600/30'
              }`}
            >
              {isSubmitting ? (
                <span>Recording...</span>
              ) : (
                <span>Record Udhar ({direction === 'gave' ? 'I Gave' : 'I Took'})</span>
              )}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};
