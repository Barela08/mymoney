import React, { useState, useEffect } from 'react';
import {
  X,
  Users,
  UserPlus,
  Edit3,
  Trash2,
  Link,
  Share2,
  CheckCircle2,
  Phone,
  Mail,
  Search,
  Sparkles,
  ArrowRight,
  UserCheck,
} from 'lucide-react';
import { useToast } from '../../context/ToastContext';
import {
  udharDeletionApi,
  UdharContact,
  SearchUserResult,
} from '../../lib/udharDeletionApi';

interface SavedPeopleManagerModalProps {
  isOpen: boolean;
  onClose: () => void;
  onContactsUpdated?: () => void;
  onSelectPersonForUdhar?: (personName: string) => void;
}

export const SavedPeopleManagerModal: React.FC<SavedPeopleManagerModalProps> = ({
  isOpen,
  onClose,
  onContactsUpdated,
  onSelectPersonForUdhar,
}) => {
  const toast = useToast();

  const [contacts, setContacts] = useState<UdharContact[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [filterQuery, setFilterQuery] = useState<string>('');

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

  const fetchContacts = async () => {
    try {
      setIsLoading(true);
      const res = await udharDeletionApi.getContacts();
      if (res.success) {
        setContacts(res.contacts);
      }
    } catch (err: any) {
      toast.error('Error', err.message || 'Unable to fetch contacts.');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    if (isOpen) {
      fetchContacts();
    }
  }, [isOpen]);

  // Handle Search for Linking
  useEffect(() => {
    if (!linkingContact || searchRegisteredQuery.trim().length < 2) {
      setRegisteredSearchResults([]);
      return;
    }

    const t = setTimeout(async () => {
      try {
        setIsSearchingRegistered(true);
        const res = await udharDeletionApi.searchUsers(searchRegisteredQuery);
        if (res.success) {
          setRegisteredSearchResults(res.users);
        }
      } catch {
        // ignore
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
      return;
    }

    const t = setTimeout(async () => {
      try {
        setIsSearchingAddMode(true);
        const res = await udharDeletionApi.searchUsers(addModeUserSearch);
        if (res.success) {
          setAddModeSearchResults(res.users);
        }
      } catch {
        // ignore
      } finally {
        setIsSearchingAddMode(false);
      }
    }, 300);

    return () => clearTimeout(t);
  }, [addModeUserSearch, isAddMode]);

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
    if (!formName.trim()) {
      toast.error('Name Required', 'Please enter a name for this contact.');
      return;
    }

    try {
      setIsSaving(true);
      if (editingContact) {
        const res = await udharDeletionApi.updateContact(editingContact.id, {
          name: formName.trim(),
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
              `Saved contact for ${formName.trim()} updated. Synced in both users' Saved People.`
            );
          } else {
            toast.success('Updated', `Saved contact for ${formName.trim()} updated.`);
          }
        }
      } else {
        const res = await udharDeletionApi.saveContact({
          name: formName.trim(),
          email: formEmail.trim() || undefined,
          phone: formPhone.trim() || undefined,
          relationship_type: formRelationship,
          notes: formNotes.trim() || undefined,
          linked_user_id: selectedRegisteredUser?.id,
        });
        if (res.success) {
          if (res.reciprocallyLinked || selectedRegisteredUser) {
            toast.success(
              'Contact Added & 2-Way Synced!',
              `${formName.trim()} saved. You are also automatically added to their Saved People!`
            );
          } else {
            toast.success('Contact Added', `${formName.trim()} added to your saved people.`);
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

  const handleDeleteContact = async (id: string, name: string) => {
    if (!confirm(`Are you sure you want to remove "${name}" from your saved contacts? Previous transactions with this person will remain intact.`)) {
      return;
    }

    try {
      const res = await udharDeletionApi.deleteContact(id);
      if (res.success) {
        toast.info('Removed', `${name} removed from saved contacts.`);
        await fetchContacts();
        if (onContactsUpdated) onContactsUpdated();
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    }
  };

  const handleExecuteLink = async (targetUserId: string, targetName: string) => {
    if (!linkingContact) return;

    try {
      setIsLinking(true);
      const res = await udharDeletionApi.linkContactToRegistered(linkingContact.id, targetUserId);
      if (res.success) {
        toast.success(
          'Linked Successfully!',
          `${linkingContact.name} is now connected with registered user ${targetName}.`
        );
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
                      <p className="text-[10px] text-slate-400 font-mono">{su.emailMasked}</p>
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
                  <span>Search Registered User (Instant 2-Way Sync)</span>
                </div>
                <p className="text-[11px] text-slate-500">
                  User ko search karke add karein, vo aapke saved people me add ho jayenge aur aap unke saved people me turant jud jayenge!
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

                {addModeSearchResults.length > 0 && (
                  <div className="space-y-1.5 max-h-36 overflow-y-auto bg-white dark:bg-slate-800 p-2 rounded-xl border border-slate-200 dark:border-slate-700 shadow-md">
                    {addModeSearchResults.map((usr) => (
                      <div
                        key={usr.id}
                        onClick={() => handleSelectRegisteredUserInAdd(usr)}
                        className="p-2 rounded-lg hover:bg-emerald-50 dark:hover:bg-slate-700/60 cursor-pointer flex items-center justify-between text-xs transition-colors"
                      >
                        <div className="flex items-center gap-2">
                          <div className="w-6 h-6 rounded-full bg-emerald-600 text-white font-bold text-[10px] flex items-center justify-center">
                            {usr.displayName.charAt(0).toUpperCase()}
                          </div>
                          <div>
                            <p className="font-bold text-slate-800 dark:text-slate-200">{usr.displayName}</p>
                            <p className="text-[10px] text-slate-400">{usr.emailMasked}</p>
                          </div>
                        </div>
                        <span className="text-[10px] px-2 py-0.5 rounded-full font-bold bg-emerald-100 text-emerald-800">
                          + Select & Sync
                        </span>
                      </div>
                    ))}
                  </div>
                )}

                {selectedRegisteredUser && (
                  <div className="flex items-center justify-between p-2 rounded-xl bg-emerald-100/70 dark:bg-emerald-950/70 text-emerald-900 dark:text-emerald-200 text-xs font-semibold">
                    <div className="flex items-center gap-1.5">
                      <CheckCircle2 className="w-4 h-4 text-emerald-600" />
                      <span>Selected: <strong>{selectedRegisteredUser.displayName}</strong> (2-Way Synced)</span>
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
          /* View 3: Contacts List */
          <div className="space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div className="relative flex-1">
                <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                <input
                  type="text"
                  placeholder="Filter saved contacts..."
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
              <p className="text-center py-8 text-xs text-slate-400 animate-pulse">Loading contacts...</p>
            ) : filtered.length === 0 ? (
              <div className="text-center py-10 bg-slate-50 dark:bg-slate-800/40 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2">
                <Users className="w-8 h-8 text-slate-300 mx-auto" />
                <p className="text-xs font-bold text-slate-700 dark:text-slate-300">No Saved Contacts Found</p>
                <p className="text-[11px] text-slate-400 max-w-xs mx-auto">
                  Add contacts or scan QR codes to reuse people in Udhar entries effortlessly.
                </p>
              </div>
            ) : (
              <div className="space-y-2 max-h-[380px] overflow-y-auto pr-1">
                {filtered.map((c) => {
                  const isLinked = Boolean(c.linked_user_id);
                  return (
                    <div
                      key={c.id}
                      className="p-3 bg-white dark:bg-slate-800/80 rounded-2xl border border-slate-200/80 dark:border-slate-700/80 flex items-center justify-between gap-3 hover:border-emerald-300 transition-all shadow-sm"
                    >
                      <div className="flex items-center gap-3 min-w-0">
                        <div className="w-9 h-9 rounded-xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-bold text-xs flex items-center justify-center shrink-0">
                          {c.name.charAt(0).toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="flex items-center gap-1.5 flex-wrap">
                            <span className="font-bold text-xs text-slate-900 dark:text-slate-100 truncate">
                              {c.name}
                            </span>
                            <span className="text-[9.5px] px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-700 text-slate-600 dark:text-slate-300">
                              {c.relationship_type || 'Contact'}
                            </span>
                            {isLinked && (
                              <span
                                className="text-[9.5px] px-1.5 py-0.5 rounded font-bold bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 flex items-center gap-0.5"
                                title="Connected in both users' Saved People for mutual Udhar tracking"
                              >
                                <Sparkles className="w-2.5 h-2.5 text-emerald-600" />
                                <span>2-Way Synced</span>
                              </span>
                            )}
                          </div>

                          <div className="flex items-center gap-2 text-[10px] text-slate-400 mt-0.5 truncate">
                            {c.email && <span>{c.email}</span>}
                            {c.phone && <span>• {c.phone}</span>}
                          </div>
                        </div>
                      </div>

                      {/* Contact Action Buttons */}
                      <div className="flex items-center gap-1 shrink-0">
                        {onSelectPersonForUdhar && (
                          <button
                            type="button"
                            onClick={() => {
                              onSelectPersonForUdhar(c.name);
                              onClose();
                            }}
                            className="px-2 py-1 bg-emerald-50 dark:bg-emerald-950/60 hover:bg-emerald-100 text-emerald-700 dark:text-emerald-300 rounded-lg text-[10px] font-bold border border-emerald-200 dark:border-emerald-800 cursor-pointer"
                            title="Create Udhar with this person"
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
                            title="Link with registered My Money user"
                          >
                            <Link className="w-3.5 h-3.5" />
                          </button>
                        )}

                        {!isLinked && (
                          <button
                            type="button"
                            onClick={() => handleShareAppInvitation(c)}
                            className="p-1.5 rounded-lg text-slate-400 hover:text-emerald-600 hover:bg-emerald-50 dark:hover:bg-slate-700 cursor-pointer"
                            title="Send app invite link"
                          >
                            <Share2 className="w-3.5 h-3.5" />
                          </button>
                        )}

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
        )}
      </div>
    </div>
  );
};
