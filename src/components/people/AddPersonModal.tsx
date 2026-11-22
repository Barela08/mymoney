import React, { useState, useEffect } from 'react';
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
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import { udharDeletionApi, SearchUserResult } from '../../lib/udharDeletionApi';

interface AddPersonModalProps {
  isOpen: boolean;
  onClose: () => void;
  onPersonAdded: (personName: string) => void;
}

export const AddPersonModal: React.FC<AddPersonModalProps> = ({
  isOpen,
  onClose,
  onPersonAdded,
}) => {
  const toast = useToast();

  const [activeTab, setActiveTab] = useState<'search' | 'manual'>('search');

  // Search state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchUserResult[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [connectingUserId, setConnectingUserId] = useState<string | null>(null);

  // Manual form state
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('Friend');
  const [notes, setNotes] = useState('');
  const [isSubmitting, setIsSubmitting] = useState(false);

  // Debounced search for registered users
  useEffect(() => {
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setIsSearching(false);
      return;
    }

    const timer = setTimeout(async () => {
      try {
        setIsSearching(true);
        const res = await udharDeletionApi.searchUsers(q);
        if (res.success) {
          setSearchResults(res.users || []);
        }
      } catch (err: any) {
        console.warn('User search error:', err.message);
      } finally {
        setIsSearching(false);
      }
    }, 250);

    return () => clearTimeout(timer);
  }, [searchQuery]);

  if (!isOpen) return null;

  const handleConnectUser = async (userItem: SearchUserResult) => {
    try {
      setConnectingUserId(userItem.id);
      const res = await udharDeletionApi.saveContact({
        name: userItem.fullName,
        email: userItem.email || undefined,
        linked_user_id: userItem.id,
        relationship_type: 'Friend',
      });

      if (res.success) {
        toast.success(
          'Connected & Added!',
          `"${userItem.fullName}" added to your Saved People for 2-way Udhar sync.`
        );
        onPersonAdded(userItem.fullName);
        onClose();
      }
    } catch (err: any) {
      toast.error('Connection failed', err.message);
    } finally {
      setConnectingUserId(null);
    }
  };

  const handleManualSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
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
        relationship_type: relationship.trim() || 'Friend',
        notes: notes.trim() || undefined,
      });

      if (res.success) {
        toast.success('Person Added', `"${cleanName}" added to your saved contacts.`);
        onPersonAdded(cleanName);
        onClose();
      }
    } catch (err: any) {
      toast.error('Failed to add person', err.message);
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-fade-in">
      <div className="relative w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-2xl space-y-4">
        {/* Header */}
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="w-10 h-10 rounded-2xl bg-emerald-100 dark:bg-emerald-950/60 text-emerald-600 flex items-center justify-center">
              <UserPlus className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-extrabold text-base text-slate-900 dark:text-slate-100">
                Add Person (व्यक्ति जोड़ें)
              </h3>
              <p className="text-[11px] text-slate-400">Search registered users or add contact manually</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab switch */}
        <div className="flex items-center p-1 rounded-xl bg-slate-100 dark:bg-slate-800 text-xs font-bold">
          <button
            type="button"
            onClick={() => setActiveTab('search')}
            className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'search'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <Search className="w-3.5 h-3.5" />
            <span>Search Registered</span>
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('manual')}
            className={`flex-1 py-1.5 rounded-lg transition-all flex items-center justify-center gap-1.5 cursor-pointer ${
              activeTab === 'manual'
                ? 'bg-white dark:bg-slate-900 text-emerald-600 dark:text-emerald-400 shadow-sm'
                : 'text-slate-500 hover:text-slate-700 dark:hover:text-slate-300'
            }`}
          >
            <UserPlus className="w-3.5 h-3.5" />
            <span>Add Manually</span>
          </button>
        </div>

        {/* Tab 1: Live User Search */}
        {activeTab === 'search' && (
          <div className="space-y-3 animate-fade-in">
            <div className="relative">
              <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                type="text"
                autoFocus
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder="Search by full name, partial name, or email..."
                className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
              />
              {isSearching && (
                <Loader2 className="w-4 h-4 absolute right-3 top-1/2 -translate-y-1/2 animate-spin text-emerald-500" />
              )}
            </div>

            {/* Results list */}
            <div className="max-h-60 overflow-y-auto space-y-2 pr-1">
              {searchQuery.trim().length >= 2 && searchResults.length === 0 && !isSearching && (
                <div className="p-4 text-center text-xs text-slate-400 rounded-2xl bg-slate-50 dark:bg-slate-800/50">
                  <p>No registered users found matching "{searchQuery}".</p>
                  <button
                    type="button"
                    onClick={() => {
                      setName(searchQuery);
                      setActiveTab('manual');
                    }}
                    className="mt-2 text-emerald-600 dark:text-emerald-400 font-bold hover:underline cursor-pointer"
                  >
                    + Add as Manual Contact instead
                  </button>
                </div>
              )}

              {searchResults.map((userItem) => (
                <div
                  key={userItem.id}
                  className="p-3 rounded-2xl border border-slate-100 dark:border-slate-800 bg-slate-50 dark:bg-slate-800/40 hover:bg-slate-100/80 dark:hover:bg-slate-800 transition-colors flex items-center justify-between gap-3"
                >
                  <div className="flex items-center gap-2.5 min-w-0">
                    {userItem.avatarUrl ? (
                      <img
                        src={userItem.avatarUrl}
                        alt={userItem.fullName}
                        className="w-10 h-10 rounded-xl object-cover border border-emerald-500/30 flex-shrink-0"
                      />
                    ) : (
                      <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold flex items-center justify-center text-xs flex-shrink-0">
                        {userItem.fullName ? userItem.fullName.charAt(0).toUpperCase() : 'U'}
                      </div>
                    )}
                    <div className="min-w-0">
                      <div className="flex items-center gap-1.5">
                        <p className="font-bold text-xs text-slate-800 dark:text-slate-200 truncate">
                          {userItem.fullName}
                        </p>
                        <span className="px-1.5 py-0.2 rounded text-[9px] font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-700 dark:text-emerald-300">
                          Verified
                        </span>
                      </div>
                      <p className="text-[11px] text-slate-400 truncate">
                        {userItem.email || userItem.emailMasked}
                      </p>
                    </div>
                  </div>

                  {userItem.isAlreadyConnected ? (
                    <span className="px-2.5 py-1 rounded-xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-300 text-[11px] font-bold flex items-center gap-1 flex-shrink-0">
                      <CheckCircle2 className="w-3 h-3" />
                      <span>Connected</span>
                    </span>
                  ) : (
                    <button
                      type="button"
                      disabled={connectingUserId === userItem.id}
                      onClick={() => handleConnectUser(userItem)}
                      className="px-3 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-[11px] font-bold transition-all flex items-center gap-1 flex-shrink-0 cursor-pointer shadow-sm shadow-emerald-600/30"
                    >
                      {connectingUserId === userItem.id ? (
                        <Loader2 className="w-3 h-3 animate-spin" />
                      ) : (
                        <Sparkles className="w-3 h-3" />
                      )}
                      <span>Connect</span>
                    </button>
                  )}
                </div>
              ))}

              {searchQuery.trim().length < 2 && (
                <div className="p-4 text-center text-xs text-slate-400 rounded-2xl bg-slate-50 dark:bg-slate-800/40">
                  <Users className="w-6 h-6 mx-auto mb-1 text-slate-300 dark:text-slate-600" />
                  Type a name or email above to find registered My Money Manager users for instant 2-way sync.
                </div>
              )}
            </div>
          </div>
        )}

        {/* Tab 2: Manual Add Form */}
        {activeTab === 'manual' && (
          <form onSubmit={handleManualSubmit} className="space-y-3.5 text-xs animate-fade-in">
            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Full Name *
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

            <div className="grid grid-cols-2 gap-3">
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

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Relationship Tag
              </label>
              <select
                value={relationship}
                onChange={(e) => setRelationship(e.target.value)}
                className="w-full px-3 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-slate-900 dark:text-slate-100 text-xs font-semibold focus:ring-2 focus:ring-emerald-500"
              >
                <option value="Friend">Friend (दोस्त)</option>
                <option value="Roommate">Roommate (कमरेदार)</option>
                <option value="Colleague">Colleague (सहकर्मी)</option>
                <option value="Family">Family (परिवार)</option>
                <option value="Business">Business (व्यापार)</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div>
              <label className="block font-bold text-slate-700 dark:text-slate-300 mb-1">
                Personal Notes (Optional)
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
                className="px-4 py-2.5 rounded-xl text-xs font-bold text-slate-600 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSubmitting}
                className="px-5 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold transition-all cursor-pointer shadow-md shadow-emerald-600/30"
              >
                {isSubmitting ? 'Saving...' : 'Save Person'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
};
