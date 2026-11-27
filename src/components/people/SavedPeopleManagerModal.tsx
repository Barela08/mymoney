import React, { useState, useEffect, useRef } from 'react';
import {
  X,
  Users,
  UserPlus,
  Edit3,
  Trash2,
  Link,
  Share2,
  CheckCircle2,
  Search,
  Sparkles,
  Loader2,
  UserMinus,
  ShieldCheck,
  AlertCircle,
  QrCode,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  udharDeletionApi,
  UdharContact,
  SearchUserResult,
} from '../../lib/udharDeletionApi';
import { ConfirmModal } from '../common/ConfirmModal';
import { PersonUpiQrModal } from './PersonUpiQrModal';

interface SavedPeopleManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContactsUpdated?: () => void;
  onRequestsUpdated?: () => void;
  onSelectPersonForUdhar?: (personName: string) => void;
}

export const SavedPeopleManagerModal: React.FC<SavedPeopleManagerModalProps> = ({
  isOpen,
  onClose,
  onContactsUpdated,
  onRequestsUpdated,
  onSelectPersonForUdhar,
}) => {
  const toast = useToast();

  const [contacts, setContacts] = useState<UdharContact[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [contactsError, setContactsError] = useState<string | null>(null);
  const [filterQuery, setFilterQuery] = useState<string>('');
  const [selectedContactForUpi, setSelectedContactForUpi] = useState<UdharContact | null>(null);

  // Add / Edit Modal
  const [editingContact, setEditingContact] = useState<UdharContact | null>(null);
  const [isAddMode, setIsAddMode] = useState<boolean>(false);
  const [formName, setFormName] = useState<string>('');
  const [formEmail, setFormEmail] = useState<string>('');
  const [formPhone, setFormPhone] = useState<string>('');
  const [formRelationship, setFormRelationship] = useState<string>('Friend');
  const [formNotes, setFormNotes] = useState<string>('');
  const [isSaving, setIsSaving] = useState<boolean>(false);

  // Link unregistered contact to registered user
  const [linkingContact, setLinkingContact] = useState<UdharContact | null>(null);
  const [searchRegisteredQuery, setSearchRegisteredQuery] = useState<string>('');
  const [registeredSearchResults, setRegisteredSearchResults] = useState<SearchUserResult[]>([]);
  const [isSearchingRegistered, setIsSearchingRegistered] = useState<boolean>(false);
  const [isLinking, setIsLinking] = useState<boolean>(false);

  // Live Registered User Search inside Add Mode for instant 2-way sync
  const [selectedRegisteredUser, setSelectedRegisteredUser] = useState<SearchUserResult | null>(null);
  const [addModeUserSearch, setAddModeUserSearch] = useState<string>('');
  const [addModeSearchResults, setAddModeSearchResults] = useState<SearchUserResult[]>([]);
  const [isSearchingAddMode, setIsSearchingAddMode] = useState<boolean>(false);
  const [addModeSearchError, setAddModeSearchError] = useState<string | null>(null);

  const fetchContacts = async () => {
    try {
      setIsLoading(true);
      setContactsError(null);
      const res = await udharDeletionApi.getContacts();
      if (res.success) {
        setContacts(res.contacts || []);
      } else {
        setContactsError('Unable to load your saved people right now.');
      }
    } catch (err: any) {
      const msg = err?.message || 'Unable to fetch contacts.';
      setContactsError(msg);
      toast.error('Error', msg);
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      setPendingIds({});
      fetchContacts();
    } else {
      setPendingIds({});
      setLiveResults([]);
      setLiveState('initial');
    }
  }, [isOpen]);

  const [linkingSearchError, setLinkingSearchError] = useState<string | null>(null);

  // Handle Search for Linking
  useEffect(() => {
    if (!linkingContact || searchRegisteredQuery.trim().length < 2) {
      setRegisteredSearchResults([]);
      setLinkingSearchError(null);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setIsSearchingRegistered(true);
        setLinkingSearchError(null);
        const res = await udharDeletionApi.searchUsers(searchRegisteredQuery);
        if (res.success) {
          setRegisteredSearchResults(res.users || []);
        } else {
          setRegisteredSearchResults([]);
          setLinkingSearchError('Could not complete search. Please retry.');
        }
      } catch (err: any) {
        setRegisteredSearchResults([]);
        setLinkingSearchError(err?.message || 'Unable to reach user directory right now.');
      } finally {
        setIsSearchingRegistered(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [searchRegisteredQuery, linkingContact]);

  // Handle Search in Add Mode
  useEffect(() => {
    if (!isAddMode || addModeUserSearch.trim().length < 2) {
      setAddModeSearchResults([]);
      setAddModeSearchError(null);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setIsSearchingAddMode(true);
        setAddModeSearchError(null);
        const res = await udharDeletionApi.searchUsers(addModeUserSearch);
        if (res.success) {
          setAddModeSearchResults(res.users || []);
        } else {
          setAddModeSearchResults([]);
          setAddModeSearchError('Could not search registered users right now.');
        }
      } catch (err: any) {
        setAddModeSearchResults([]);
        setAddModeSearchError(err?.message || 'Unable to reach user directory.');
      } finally {
        setIsSearchingAddMode(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [addModeUserSearch, isAddMode]);

  // ----------------------------------------------------------------
  // Live registered-user search (debounced, abortable, real data only)
  // ----------------------------------------------------------------
  const [liveQuery, setLiveQuery] = useState<string>('');
  const [liveResults, setLiveResults] = useState<SearchUserResult[]>([]);
  const [liveState, setLiveState] = useState<'initial' | 'loading' | 'results' | 'empty' | 'error'>('initial');
  const [liveError, setLiveError] = useState<string>('');
  const [liveHint, setLiveHint] = useState<string>('');
  const [requestingId, setRequestingId] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Record<string, boolean>>({});
  const [disconnectingId, setDisconnectingId] = useState<string | null>(null);
  const [pendingDisconnectContact, setPendingDisconnectContact] = useState<UdharContact | null>(null);
  const [pendingDeleteContact, setPendingDeleteContact] = useState<{ id: string; name: string } | null>(null);
  const [isDeletingContact, setIsDeletingContact] = useState<boolean>(false);
  const liveAbortRef = useRef<AbortController | null>(null);
  const lastQueryRef = useRef<string>('');

  const runLiveSearch = React.useCallback(async (rawQuery: string) => {
    const query = rawQuery.normalize('NFKC').trim().replace(/\s+/g, ' ');
    lastQueryRef.current = query;
    setLiveHint('');

    if (query.length < 2) {
      liveAbortRef.current?.abort();
      setLiveResults([]);
      setLiveState('initial');
      return;
    }

    const digits = query.replace(/\D/g, '');
    const looksLikeEmail = query.includes('@');
    const looksLikePhone = !looksLikeEmail && /^[+\d][\d\s()\-]*$/.test(query);

    if (looksLikeEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(query)) {
      liveAbortRef.current?.abort();
      setLiveResults([]);
      setLiveState('initial');
      setLiveHint('Enter the complete email address to find an account.');
      return;
    }
    if (looksLikePhone && (digits.length < 10 || digits.length > 15)) {
      liveAbortRef.current?.abort();
      setLiveResults([]);
      setLiveState('initial');
      setLiveHint('Enter the complete mobile number (with country code if needed).');
      return;
    }

    liveAbortRef.current?.abort();
    const controller = new AbortController();
    liveAbortRef.current = controller;

    try {
      setLiveState('loading');
      setLiveError('');
      const res = await udharDeletionApi.searchUsers(query, controller.signal);
      if (lastQueryRef.current !== query) return;
      if (res.success) {
        const users = res.users || [];
        setLiveResults(users);
        setLiveState(users.length > 0 ? 'results' : 'empty');
      } else {
        setLiveResults([]);
        setLiveState('error');
        setLiveError('Could not complete the search. Please try again.');
      }
    } catch (err: any) {
      if (err?.name === 'AbortError') return;
      if (lastQueryRef.current !== query) return;
      setLiveResults([]);
      setLiveState('error');
      setLiveError(
        err?.status === 503 || err?.isNonJson
          ? 'Search is temporarily unavailable. Your data was not changed.'
          : err?.message || 'Could not reach the server. Check your connection and retry.'
      );
    }
  }, []);

  useEffect(() => {
    if (!isOpen) return;
    const timer = setTimeout(() => {
      void runLiveSearch(liveQuery);
    }, 320);
    return () => clearTimeout(timer);
  }, [liveQuery, isOpen, runLiveSearch]);

  useEffect(() => {
    return () => liveAbortRef.current?.abort();
  }, []);

  const handleSendRequest = async (user: SearchUserResult) => {
    if (!user || user.isSelf || requestingId) return;
    try {
      setRequestingId(user.id);
      if (user.connectionStatus === 'incoming_pending') {
        const res = await udharDeletionApi.respondToConnectionRequest(
          user.requestId || user.id,
          'accept'
        );
        toast.success('Connected!', res.message || `Connected with ${user.displayName}. Added to your Saved People.`);
        setLiveResults((prev) =>
          prev.map((u) =>
            u.id === user.id ? { ...u, connectionStatus: 'connected', isAlreadyConnected: true } : u
          )
        );
        await fetchContacts();
        onContactsUpdated?.();
        onRequestsUpdated?.();
        return;
      }

      const res = await udharDeletionApi.sendConnectionRequest({
        targetUserId: user.id,
        relationshipType: 'Friend',
        source: liveQuery.includes('@') ? 'manual' : 'search',
      });
      if (res.status === 'connected') {
        toast.success(
          res.alreadyConnected ? 'Already Connected' : 'Connected',
          res.message || 'You are now connected with this person.'
        );
        setLiveResults((prev) =>
          prev.map((u) =>
            u.id === user.id ? { ...u, connectionStatus: 'connected', isAlreadyConnected: true } : u
          )
        );
        await fetchContacts();
        onContactsUpdated?.();
        onRequestsUpdated?.();
      } else {
        toast.success('Request Sent', res.message || 'They must accept the request before both accounts are connected.');
        setPendingIds((prev) => ({ ...prev, [user.id]: true }));
        setLiveResults((prev) =>
          prev.map((u) =>
            u.id === user.id
              ? { ...u, connectionStatus: 'pending', requestId: res.requestId || u.requestId || null }
              : u
          )
        );
        onRequestsUpdated?.();
      }
    } catch (err: any) {
      toast.error('Request Failed', err?.message || 'Could not send the connection request.');
    } finally {
      setRequestingId(null);
    }
  };

  const handleRejectIncoming = async (user: SearchUserResult) => {
    if (!user.requestId || requestingId) return;
    try {
      setRequestingId(user.id);
      const res = await udharDeletionApi.respondToConnectionRequest(user.requestId, 'reject');
      toast.info('Request Rejected', res.message || `Declined request from ${user.displayName}.`);
      setLiveResults((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, connectionStatus: 'none', requestId: null } : u))
      );
      onRequestsUpdated?.();
    } catch (err: any) {
      toast.error('Reject Failed', err?.message || 'Could not reject this request.');
    } finally {
      setRequestingId(null);
    }
  };

  const handleCancelOutgoing = async (user: SearchUserResult) => {
    if (!user.requestId || requestingId) return;
    try {
      setRequestingId(user.id);
      const res = await udharDeletionApi.cancelConnectionRequest(user.requestId);
      toast.info('Request Cancelled', res.message || `Cancelled connection request to ${user.displayName}.`);
      setPendingIds((prev) => {
        const next = { ...prev };
        delete next[user.id];
        return next;
      });
      setLiveResults((prev) =>
        prev.map((u) => (u.id === user.id ? { ...u, connectionStatus: 'none', requestId: null } : u))
      );
      onRequestsUpdated?.();
    } catch (err: any) {
      toast.error('Cancel Failed', err?.message || 'Could not cancel this request.');
    } finally {
      setRequestingId(null);
    }
  };

  const handleDisconnect = (contact: UdharContact) => {
    if (!contact.linked_user_id || disconnectingId) return;
    setPendingDisconnectContact(contact);
  };

  const confirmDisconnect = async () => {
    const contact = pendingDisconnectContact;
    if (!contact || !contact.linked_user_id || disconnectingId) return;
    try {
      setDisconnectingId(contact.id);
      const res = await udharDeletionApi.disconnectConnection(contact.linked_user_id);
      toast.success('Disconnected', res.message || 'The Udhar connection was removed.');
      setPendingDisconnectContact(null);
      if (contact.linked_user_id) {
        const peerId = contact.linked_user_id;
        setPendingIds((prev) => {
          const next = { ...prev };
          delete next[peerId];
          return next;
        });
        setLiveResults((prev) =>
          prev.map((u) =>
            u.id === peerId
              ? { ...u, connectionStatus: 'none', isAlreadyConnected: false, requestId: null }
              : u
          )
        );
      }
      await fetchContacts();
      if (liveQuery.trim().length >= 2) {
        void runLiveSearch(liveQuery);
      }
      if (onContactsUpdated) onContactsUpdated();
      onRequestsUpdated?.();
    } catch (err: any) {
      toast.error('Disconnect Failed', err?.message || 'Could not disconnect right now.');
    } finally {
      setDisconnectingId(null);
    }
  };

  if (!isOpen) return null;



  const handleOpenAdd = () => {
    setEditingContact(null);
    setSelectedRegisteredUser(null);
    setAddModeUserSearch('');
    setAddModeSearchResults([]);
    setFormName('');
    setFormEmail('');
    setFormPhone('');
    setFormRelationship('Friend');
    setFormNotes('');
    setIsAddMode(true);
  };

  const handleOpenEdit = (c: UdharContact) => {
    setEditingContact(c);
    setSelectedRegisteredUser(null);
    setAddModeUserSearch('');
    setAddModeSearchResults([]);
    setFormName(c.name);
    setFormEmail(c.email || '');
    setFormPhone(c.phone || '');
    setFormRelationship(c.relationship_type || 'Friend');
    setFormNotes(c.notes || '');
    setIsAddMode(true);
  };

  const handleSelectRegisteredUserInAdd = (u: SearchUserResult) => {
    setSelectedRegisteredUser(u);
    setFormName(u.displayName || u.fullName);
    setAddModeSearchResults([]);
    setAddModeUserSearch('');
  };

  const handleSaveContact = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSaving) return;
    const trimmedName = formName.trim();
    if (!trimmedName) {
      toast.error('Name Required', 'Please enter a name for this contact.');
      return;
    }

    if (!editingContact) {
      const normalizedTarget = trimmedName.toLowerCase();
      const duplicate = contacts.find((c) => {
        if (selectedRegisteredUser?.id && c.linked_user_id === selectedRegisteredUser.id) return true;
        return c.name.trim().toLowerCase() === normalizedTarget;
      });
      if (duplicate) {
        toast.info(
          'Already Saved',
          `"${duplicate.name}" is already in your Saved People list.`
        );
        return;
      }
    }

    try {
      setIsSaving(true);
      if (editingContact) {
        const res = await udharDeletionApi.updateContact(editingContact.id, {
          name: trimmedName,
          email: formEmail.trim() || undefined,
          phone: formPhone.trim() || undefined,
          relationship_type: formRelationship,
          notes: formNotes.trim() || undefined,
          linked_user_id: selectedRegisteredUser?.id || editingContact.linked_user_id || undefined,
        });
        if (res.success) {
          if (res.reciprocallyLinked || selectedRegisteredUser || editingContact.linked_user_id) {
            toast.success(
              'Updated & 2-Way Synced!',
              `Saved contact for ${trimmedName} updated. Synced in both users' Saved People.`
            );
          } else {
            toast.success('Updated', `Saved contact for ${trimmedName} updated.`);
          }
        }
      } else {
        const res = await udharDeletionApi.saveContact({
          name: trimmedName,
          email: formEmail.trim() || undefined,
          phone: formPhone.trim() || undefined,
          relationship_type: formRelationship,
          notes: formNotes.trim() || undefined,
          linked_user_id: selectedRegisteredUser?.id,
        });
        if (res.success) {
          if (res.status === 'pending') {
            toast.success(
              'Request Sent',
              res.message || `Connection request sent to ${trimmedName}. Added once they accept.`
            );
            onRequestsUpdated?.();
          } else if (res.reciprocallyLinked) {
            toast.success(
              'Contact Added & 2-Way Synced!',
              `${trimmedName} saved. You are also in each other's Saved People!`
            );
          } else {
            toast.success('Contact Added', res.message || `${trimmedName} added to your saved people.`);
          }
        }
      }
      setIsAddMode(false);
      setSelectedRegisteredUser(null);
      await fetchContacts();
      if (onContactsUpdated) onContactsUpdated();
    } catch (err: any) {
      toast.error('Save Failed', err.message);
    } finally {
      setIsSaving(false);
    }
  };

  const handleDeleteContact = (id: string, name: string) => {
    setPendingDeleteContact({ id, name });
  };

  const confirmDeleteContact = async () => {
    if (!pendingDeleteContact || isDeletingContact) return;
    const { id, name } = pendingDeleteContact;
    try {
      setIsDeletingContact(true);
      const existingContact = contacts.find((c) => c.id === id);
      const res = await udharDeletionApi.deleteContact(id);
      if (res.success) {
        toast.info('Connection Removed', `${name} removed from both Saved People lists.`);
        setPendingDeleteContact(null);
        const peerId = existingContact?.linked_user_id;
        if (peerId) {
          setPendingIds((prev) => {
            const next = { ...prev };
            delete next[peerId];
            return next;
          });
          setLiveResults((prev) =>
            prev.map((u) =>
              u.id === peerId
                ? { ...u, connectionStatus: 'none', isAlreadyConnected: false, requestId: null }
                : u
            )
          );
        }
        await fetchContacts();
        if (liveQuery.trim().length >= 2) {
          void runLiveSearch(liveQuery);
        }
        if (onContactsUpdated) onContactsUpdated();
        onRequestsUpdated?.();
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsDeletingContact(false);
    }
  };

  const handleExecuteLink = async (targetUserId: string, targetName: string) => {
    if (!linkingContact) return;

    try {
      setIsLinking(true);
      const res = await udharDeletionApi.linkContactToRegistered(linkingContact.id, targetUserId);
      if (res.success) {
        if (res.pendingApproval || res.status === 'pending') {
          toast.success(
            'Request Sent',
            res.message || `Connection request sent to ${targetName}.`
          );
          onRequestsUpdated?.();
        } else {
          toast.success(
            'Linked Successfully!',
            res.message || `${linkingContact.name} is now connected with registered user ${targetName}.`
          );
        }
        setLinkingContact(null);
        await fetchContacts();
        if (onContactsUpdated) onContactsUpdated();
      }
    } catch (err: any) {
      toast.error('Linking Failed', err.message);
    } finally {
      setIsLinking(false);
    }
  };

  const handleShareAppInvitation = (c: UdharContact) => {
    const inviteText = `Hi ${c.name}! I'm tracking our mutual expenses and Udhar using My Money Manager. Join free to view real-time balances: ${window.location.origin}`;
    if (navigator.share) {
      navigator.share({ title: 'Invite to My Money Manager', text: inviteText });
    } else {
      navigator.clipboard.writeText(inviteText);
      toast.success('Copied', 'Invitation message copied to clipboard.');
    }
  };

  const filtered = contacts.filter((c) =>
    c.name.toLowerCase().includes(filterQuery.toLowerCase().trim()) ||
    (c.email && c.email.toLowerCase().includes(filterQuery.toLowerCase().trim())) ||
    (c.phone && c.phone.includes(filterQuery.trim()))
  );

  return (
    <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-lg w-full p-6 sm:p-7 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-5 max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-xl bg-emerald-50 dark:bg-emerald-950/60 text-emerald-600 dark:text-emerald-400 flex items-center justify-center">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-black text-sm sm:text-base text-slate-900 dark:text-slate-100">
                Saved People & Contacts
              </h3>
              <p className="text-[11px] text-slate-500">Reusable Udhar directory & accounts linking</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* View 1: Linking Modal Subview */}
        {linkingContact ? (
          <div className="space-y-4 animate-fade-in">
            <div className="p-3.5 bg-blue-50 dark:bg-blue-950/40 rounded-2xl border border-blue-200 dark:border-blue-900/60 space-y-1">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-blue-900 dark:text-blue-300">
                  Link "{linkingContact.name}" to Registered Account
                </span>
                <button
                  onClick={() => setLinkingContact(null)}
                  className="text-xs text-blue-600 hover:underline font-bold"
                >
                  Cancel
                </button>
              </div>
              <p className="text-[11px] text-blue-800 dark:text-blue-400">
                Search for their registered My Money Manager account by email or phone to bind future 2-way Udhar entries automatically.
              </p>
            </div>

            <div className="relative">
              <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
              <input
                type="text"
                autoFocus
                placeholder="Search registered user by email or mobile..."
                value={searchRegisteredQuery}
                onChange={(e) => setSearchRegisteredQuery(e.target.value)}
                className="w-full pl-9 pr-3.5 py-2 rounded-xl text-xs bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            {isSearchingRegistered && (
              <p className="text-xs text-slate-400 text-center py-2 animate-pulse">Searching users...</p>
            )}

            {!isSearchingRegistered && linkingSearchError && (
              <p className="text-xs text-rose-600 dark:text-rose-400 text-center py-2">{linkingSearchError}</p>
            )}

            {!isSearchingRegistered &&
              !linkingSearchError &&
              searchRegisteredQuery.trim().length >= 2 &&
              registeredSearchResults.length === 0 && (
                <p className="text-xs text-slate-500 text-center py-2">No matching registered accounts found.</p>
              )}

            <div className="space-y-1.5 max-h-48 overflow-y-auto">
              {registeredSearchResults.map((su) => (
                <div
                  key={su.id}
                  className="flex items-center justify-between p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700"
                >
                  <div className="flex items-center gap-2">
                    <div className="w-7 h-7 rounded-lg bg-emerald-600 text-white font-bold text-xs flex items-center justify-center">
                      {su.displayName.charAt(0).toUpperCase()}
                    </div>
                    <div>
                      <p className="text-xs font-bold text-slate-900 dark:text-slate-100">{su.displayName}</p>
                      <p className="text-[10px] text-slate-400 font-mono">
                        {su.emailMasked || su.phoneMasked || 'Registered My Money Manager account'}
                      </p>
                    </div>
                  </div>

                  <button
                    type="button"
                    disabled={isLinking}
                    onClick={() => handleExecuteLink(su.id, su.displayName)}
                    className="px-3 py-1.5 rounded-lg text-xs font-bold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm transition-colors cursor-pointer"
                  >
                    Link Account
                  </button>
                </div>
              ))}
            </div>
          </div>
        ) : isAddMode ? (
          /* View 2: Add or Edit Contact Form */
          <form onSubmit={handleSaveContact} className="space-y-4 animate-fade-in">
            <h4 className="font-bold text-xs uppercase tracking-wider text-slate-400">
              {editingContact ? `Edit Contact: ${editingContact.name}` : '+ Add New Person to Contacts'}
            </h4>

            {/* Registered User Search for instant 2-way sync */}
            {!editingContact && (
              <div className="p-3 bg-emerald-50/70 dark:bg-emerald-950/40 rounded-2xl border border-emerald-200 dark:border-emerald-800 space-y-2">
                <div className="flex items-center gap-1.5 text-emerald-800 dark:text-emerald-300 text-xs font-bold">
                  <Sparkles className="w-4 h-4 text-emerald-600" />
                  <span>Search Registered User (Connection Request)</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  Searching a registered user sends them a connection request. Both Saved People lists connect after they accept.
                </p>
                <div className="relative">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Search by registered name, email or phone..."
                    value={addModeUserSearch}
                    onChange={(e) => setAddModeUserSearch(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 font-medium"
                  />
                </div>

                {isSearchingAddMode && (
                  <p className="text-[10px] text-slate-400 animate-pulse">Searching users...</p>
                )}

                {!isSearchingAddMode && addModeSearchError && (
                  <p className="text-[10px] text-rose-600 dark:text-rose-400">{addModeSearchError}</p>
                )}

                {addModeSearchResults.length > 0 && (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto bg-white dark:bg-slate-800 p-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-md">
                    {addModeSearchResults.map((usr) => {
                      const isConnected = usr.connectionStatus === 'connected' || usr.isAlreadyConnected;
                      const isPending = usr.connectionStatus === 'pending';
                      const isIncoming = usr.connectionStatus === 'incoming_pending';
                      return (
                        <div
                          key={usr.id}
                          onClick={() => {
                            if (isConnected) {
                              toast.info('Already Connected', `${usr.displayName} is already in your Saved People.`);
                              return;
                            }
                            handleSelectRegisteredUserInAdd(usr);
                          }}
                          className="p-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between text-xs transition-colors"
                        >
                          <div className="flex items-center gap-2">
                            <div className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold text-[10px] flex items-center justify-center">
                              {usr.displayName.charAt(0).toUpperCase()}
                            </div>
                            <div>
                              <p className="font-bold text-slate-800 dark:text-slate-200">{usr.displayName}</p>
                              <p className="text-[10px] text-slate-400">
                                {usr.emailMasked || usr.phoneMasked || 'Registered My Money Manager account'}
                              </p>
                            </div>
                          </div>
                          {isConnected ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-blue-100 text-blue-800 dark:bg-blue-950/60 dark:text-blue-300">
                              Already Connected
                            </span>
                          ) : isPending ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-amber-100 text-amber-800">
                              Request Sent
                            </span>
                          ) : isIncoming ? (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-indigo-100 text-indigo-800">
                              Incoming Request
                            </span>
                          ) : (
                            <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                              Send Request
                            </span>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}

                {selectedRegisteredUser && (
                  <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-100/70 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-200 text-xs font-semibold">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Selected: <strong>{selectedRegisteredUser.displayName}</strong> (Sends connection request)</span>
                    </div>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedRegisteredUser(null);
                        setFormName('');
                        setFormEmail('');
                      }}
                      className="text-[10px] text-rose-600 hover:underline cursor-pointer"
                    >
                      Clear
                    </button>
                  </div>
                )}
              </div>
            )}

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Person Name <span className="text-rose-500">*</span>
              </label>
              <input
                type="text"
                required
                placeholder="e.g. Ramesh Kumar"
                value={formName}
                onChange={(e) => setFormName(e.target.value)}
                className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-bold focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Email (Optional)
                </label>
                <input
                  type="email"
                  placeholder="name@example.com"
                  value={formEmail}
                  onChange={(e) => setFormEmail(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                  Phone (Optional)
                </label>
                <input
                  type="tel"
                  placeholder="+91 98765 43210"
                  value={formPhone}
                  onChange={(e) => setFormPhone(e.target.value)}
                  className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500"
                />
              </div>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Relationship Tag
              </label>
              <select
                value={formRelationship}
                onChange={(e) => setFormRelationship(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-medium focus:ring-2 focus:ring-emerald-500"
              >
                <option value="Friend">Friend (दोस्त)</option>
                <option value="Roommate">Roommate (कमरेदार)</option>
                <option value="Colleague">Colleague (सहकर्मी)</option>
                <option value="Family">Family (परिवार)</option>
                <option value="Business">Business (व्यापार)</option>
                <option value="Other">Other</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Notes (Optional)
              </label>
              <input
                type="text"
                placeholder="e.g. Flat 302, College batchmate"
                value={formNotes}
                onChange={(e) => setFormNotes(e.target.value)}
                className="w-full px-3.5 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs focus:ring-2 focus:ring-emerald-500"
              />
            </div>

            <div className="flex items-center gap-3 pt-2">
              <button
                type="button"
                onClick={() => setIsAddMode(false)}
                className="flex-1 py-2.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold transition-colors cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white text-xs font-bold shadow-md shadow-emerald-600/30 transition-all cursor-pointer"
              >
                {isSaving ? 'Saving...' : editingContact ? 'Update Contact' : 'Save Person'}
              </button>
            </div>
          </form>
        ) : (
          /* View 3: Live search + compact saved people */
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Find people on My Money Manager
              </label>
              <div className="relative">
                <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="search"
                  inputMode="text"
                  autoComplete="off"
                  placeholder="Search by name, email or mobile number"
                  value={liveQuery}
                  onChange={(e) => setLiveQuery(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      void runLiveSearch(liveQuery);
                    }
                  }}
                  aria-label="Search registered users by name, email or mobile number"
                  className="w-full pl-9 pr-10 py-2.5 rounded-xl text-xs bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 focus:ring-2 focus:ring-emerald-500"
                />
                {liveState === 'loading' && (
                  <Loader2 className="w-4 h-4 text-emerald-600 animate-spin absolute right-3 top-2.5" />
                )}
              </div>
              <p className="text-[10.5px] text-slate-400">
                Name: 2+ characters · Email: complete address · Mobile: complete number
              </p>

              {liveHint && (
                <p className="text-[11px] text-amber-600 dark:text-amber-400">{liveHint}</p>
              )}

              {liveState === 'initial' && !liveHint && (
                <p className="text-[11px] text-slate-400 py-2">
                  Search by name, email or mobile number.
                </p>
              )}

              {liveState === 'loading' && (
                <p className="text-[11px] text-slate-500 py-2 animate-pulse">Searching users...</p>
              )}

              {liveState === 'empty' && (
                <p className="text-[11px] text-slate-500 py-2">No matching users found.</p>
              )}

              {liveState === 'error' && (
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800">
                  <p className="text-[11px] text-rose-700 dark:text-rose-300 flex items-center gap-1.5">
                    <AlertCircle className="w-3.5 h-3.5 shrink-0" />
                    <span>{liveError}</span>
                  </p>
                  <button
                    type="button"
                    onClick={() => void runLiveSearch(liveQuery)}
                    className="px-2.5 py-1 rounded-lg bg-rose-600 hover:bg-rose-500 text-white text-[10px] font-bold cursor-pointer shrink-0"
                  >
                    Retry
                  </button>
                </div>
              )}

              {liveState === 'results' && (
                <div className="space-y-1.5 max-h-48 overflow-y-auto pr-1">
                  {liveResults.map((u) => {
                    const isConnected = u.connectionStatus === 'connected' || u.isAlreadyConnected;
                    const isIncomingPending = !isConnected && u.connectionStatus === 'incoming_pending';
                    const isPending = !isConnected && !isIncomingPending && (u.connectionStatus === 'pending' || (u.connectionStatus !== 'none' && Boolean(pendingIds[u.id])));
                    return (
                      <div
                        key={u.id}
                        className="flex items-center justify-between gap-2 p-2.5 rounded-xl bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-lg bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-xs flex items-center justify-center shrink-0">
                            {(u.displayName || 'U').charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="text-xs font-bold text-slate-900 dark:text-slate-100 truncate">
                              {u.displayName}
                              {u.isSelf && <span className="ml-1 text-[9px] text-slate-400">(You)</span>}
                            </p>
                            <p className="text-[10px] text-slate-400 truncate flex items-center gap-1">
                              <ShieldCheck className="w-2.5 h-2.5 text-emerald-500" />
                              {u.emailMasked || u.phoneMasked
                                ? `${u.emailMasked || u.phoneMasked}`
                                : 'Registered My Money Manager account'}
                            </p>
                          </div>
                        </div>

                        {u.isSelf ? (
                          <span className="text-[10px] font-bold text-slate-400 px-2 py-1">You</span>
                        ) : isConnected ? (
                          <span className="text-[10px] font-bold text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-950/60 px-2 py-1 rounded-lg">
                            Already Connected
                          </span>
                        ) : isIncomingPending ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <button
                              type="button"
                              disabled={requestingId === u.id}
                              onClick={() => void handleRejectIncoming(u)}
                              className="px-2 py-1.5 rounded-lg bg-slate-200 dark:bg-slate-700 hover:bg-slate-300 dark:hover:bg-slate-600 disabled:opacity-50 text-slate-700 dark:text-slate-200 text-[10px] font-bold cursor-pointer"
                            >
                              Reject
                            </button>
                            <button
                              type="button"
                              disabled={requestingId === u.id}
                              onClick={() => void handleSendRequest(u)}
                              className="px-2.5 py-1.5 rounded-lg bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white text-[10px] font-bold cursor-pointer shrink-0 flex items-center gap-1"
                            >
                              {requestingId === u.id ? (
                                <Loader2 className="w-3 h-3 animate-spin" />
                              ) : (
                                <CheckCircle2 className="w-3 h-3" />
                              )}
                              <span>Accept</span>
                            </button>
                          </div>
                        ) : isPending ? (
                          <div className="flex items-center gap-1 shrink-0">
                            <span className="text-[10px] font-bold text-amber-700 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/60 px-2 py-1 rounded-lg">
                              Request Sent
                            </span>
                            {u.requestId && (
                              <button
                                type="button"
                                disabled={requestingId === u.id}
                                onClick={() => void handleCancelOutgoing(u)}
                                className="px-2 py-1 rounded-lg bg-rose-50 hover:bg-rose-100 dark:bg-rose-950/50 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800 text-[10px] font-bold cursor-pointer disabled:opacity-50"
                              >
                                Cancel Request
                              </button>
                            )}
                          </div>
                        ) : (
                          <button
                            type="button"
                            disabled={requestingId === u.id}
                            onClick={() => void handleSendRequest(u)}
                            className="px-2.5 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white text-[10px] font-bold cursor-pointer shrink-0 flex items-center gap-1"
                          >
                            {requestingId === u.id ? (
                              <Loader2 className="w-3 h-3 animate-spin" />
                            ) : (
                              <UserPlus className="w-3 h-3" />
                            )}
                            <span>Send Request</span>
                          </button>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            <div className="pt-3 border-t border-slate-100 dark:border-slate-800 space-y-2">
              <div className="flex items-center justify-between gap-3">
                <div className="relative flex-1">
                  <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    placeholder="Filter saved people..."
                    value={filterQuery}
                    onChange={(e) => setFilterQuery(e.target.value)}
                    className="w-full pl-8 pr-3 py-1.5 rounded-xl text-xs bg-slate-50 dark:bg-slate-800/80 border border-slate-200 dark:border-slate-700"
                  />
                </div>
                <button
                  type="button"
                  onClick={handleOpenAdd}
                  className="px-3.5 py-1.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold flex items-center gap-1.5 shadow-sm shrink-0 cursor-pointer"
                >
                  <UserPlus className="w-3.5 h-3.5" />
                  <span>+ Add Person</span>
                </button>
              </div>

              {isLoading ? (
                <p className="text-center py-6 text-xs text-slate-400 animate-pulse">Loading contacts...</p>
              ) : contactsError ? (
                <div className="text-center py-6 px-4 bg-rose-50 dark:bg-rose-950/30 rounded-2xl border border-rose-200 dark:border-rose-900 space-y-2">
                  <AlertCircle className="w-6 h-6 text-rose-500 mx-auto" />
                  <p className="text-xs font-bold text-rose-700 dark:text-rose-300">{contactsError}</p>
                  <button
                    type="button"
                    onClick={() => void fetchContacts()}
                    className="px-3 py-1.5 rounded-xl bg-rose-600 hover:bg-rose-500 text-white text-xs font-bold cursor-pointer"
                  >
                    Retry Loading
                  </button>
                </div>
              ) : filtered.length === 0 ? (
                <div className="text-center py-8 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <Users className="w-7 h-7 text-slate-300 mx-auto" />
                  <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No saved people yet</p>
                  <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                    Search a registered user above, scan their QR, or add a contact manually.
                  </p>
                </div>
              ) : (
                <div className="space-y-1.5 max-h-[300px] overflow-y-auto pr-1">
                  {filtered.map((c) => {
                    const isLinked = Boolean(c.linked_user_id);
                    const remaining = Number(c.net_balance ?? 0);
                    return (
                      <div
                        key={c.id}
                        className="px-2.5 py-2 bg-white dark:bg-slate-800/80 rounded-xl border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-2"
                      >
                        <div className="flex items-center gap-2 min-w-0">
                          <div className="w-8 h-8 rounded-full bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-[11px] flex items-center justify-center shrink-0">
                            {c.name.charAt(0).toUpperCase()}
                          </div>
                          <div className="min-w-0">
                            <p className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">
                              {c.name}
                            </p>
                            <p className="text-[10px] text-slate-400 truncate">
                              {isLinked ? 'Connected · 2-way Udhar' : 'Local contact'}
                              {Math.abs(remaining) > 0.009
                                ? ` · ${remaining > 0 ? 'Owes' : 'You owe'} ₹${Math.abs(remaining).toLocaleString('en-IN')}`
                                : ''}
                            </p>
                          </div>
                        </div>

                        <div className="flex items-center gap-0.5 shrink-0">
                          {onSelectPersonForUdhar && (
                            <button
                              type="button"
                              onClick={() => {
                                onSelectPersonForUdhar(c.name);
                                onClose();
                              }}
                              className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 rounded-lg text-[10px] font-bold border border-emerald-200 dark:border-emerald-800 cursor-pointer"
                            >
                              + Udhar
                            </button>
                          )}
                          {!isLinked && (
                            <button
                              type="button"
                              onClick={() => {
                                setLinkingContact(c);
                                setSearchRegisteredQuery(c.name);
                              }}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-slate-700 cursor-pointer"
                              title="Link with a registered My Money user (sends a request)"
                            >
                              <Link className="w-3.5 h-3.5" />
                            </button>
                          )}
                          {isLinked && (
                            <button
                              type="button"
                              disabled={disconnectingId === c.id}
                              onClick={() => void handleDisconnect(c)}
                              className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700 cursor-pointer disabled:opacity-50"
                              title="Disconnect this Udhar pairing"
                            >
                              {disconnectingId === c.id ? (
                                <Loader2 className="w-3.5 h-3.5 animate-spin" />
                              ) : (
                                <UserMinus className="w-3.5 h-3.5" />
                              )}
                            </button>
                          )}
                          <button
                            type="button"
                            onClick={() => setSelectedContactForUpi(c)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-slate-700 cursor-pointer"
                            title={`View ${c.name}'s UPI QR & Pay`}
                          >
                            <QrCode className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleOpenEdit(c)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-slate-700 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-700 cursor-pointer"
                            title="Edit contact details"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteContact(c.id, c.name)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-700 cursor-pointer"
                            title="Delete contact"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      <ConfirmModal
        isOpen={!!pendingDisconnectContact}
        title="Disconnect Udhar Sync?"
        subtitle="Existing Udhar records are preserved."
        message={`Disconnect from ${pendingDisconnectContact?.name || 'this person'}? You will both stop seeing 2-way Udhar sync. Existing Udhar records are kept.`}
        confirmLabel="Disconnect"
        isDestructive={true}
        isLoading={!!disconnectingId}
        onConfirm={confirmDisconnect}
        onCancel={() => !disconnectingId && setPendingDisconnectContact(null)}
      />

      <ConfirmModal
        isOpen={!!pendingDeleteContact}
        title="Remove Connection?"
        subtitle="Existing Udhaar transactions and balances remain completely intact."
        message="Are you sure you want to remove this person from your saved connections?"
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isDestructive={true}
        isLoading={isDeletingContact}
        onConfirm={confirmDeleteContact}
        onCancel={() => !isDeletingContact && setPendingDeleteContact(null)}
      />

      {/* Contact's UPI QR & Direct Payment Modal */}
      {selectedContactForUpi && (
        <PersonUpiQrModal
          isOpen={Boolean(selectedContactForUpi)}
          onClose={() => setSelectedContactForUpi(null)}
          personName={selectedContactForUpi.name}
          contactId={selectedContactForUpi.id}
          linkedUserId={selectedContactForUpi.linked_user_id}
          suggestedAmount={
            selectedContactForUpi.net_balance && Number(selectedContactForUpi.net_balance) < -0.01
              ? Math.abs(Number(selectedContactForUpi.net_balance))
              : undefined
          }
        />
      )}
    </div>
  );
};
