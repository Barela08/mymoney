import React, { useState, useRef, useEffect } from 'react';
import {
  User,
  Mail,
  Phone,
  AtSign,
  Calendar,
  CheckCircle2,
  Clock,
  Edit3,
  KeyRound,
  ShieldCheck,
  LogOut,
  ChevronDown,
  X,
  Loader2,
  AlertCircle,
  Eye,
  EyeOff,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';

interface ProfileDropdownProps {
  variant?: 'dashboard-header' | 'navbar';
  onOpenPrivacySettings?: () => void;
  onOpenFullSettings?: () => void;
  greetingText?: string;
}

export const ProfileDropdown: React.FC<ProfileDropdownProps> = ({
  variant = 'dashboard-header',
  onOpenPrivacySettings,
  onOpenFullSettings,
  greetingText,
}) => {
  const { user, updateUserProfile, changePassword, logout } = useAuth();
  const [open, setOpen] = useState(false);
  const [editModalOpen, setEditModalOpen] = useState(false);
  const [passwordModalOpen, setPasswordModalOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  // Edit profile form state
  const [fullName, setFullName] = useState('');
  const [username, setUsername] = useState('');
  const [phone, setPhone] = useState('');
  const [editLoading, setEditLoading] = useState(false);
  const [editError, setEditError] = useState<string | null>(null);
  const [editSuccess, setEditSuccess] = useState<string | null>(null);

  // Change password form state
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showPasswords, setShowPasswords] = useState(false);
  const [pwLoading, setPwLoading] = useState(false);
  const [pwError, setPwError] = useState<string | null>(null);
  const [pwSuccess, setPwSuccess] = useState<string | null>(null);

  useEffect(() => {
    const handleOutsideClick = (e: MouseEvent) => {
      if (dropdownRef.current && !dropdownRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
      }
    };
    if (open) {
      document.addEventListener('mousedown', handleOutsideClick);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleOutsideClick);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [open]);

  if (!user) return null;

  const displayName = user.full_name || user.displayName || user.email.split('@')[0] || 'User';
  const initials = displayName
    .split(/\s+/)
    .map((p) => p[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);

  const isVerified = Boolean(user.email_verified ?? user.emailVerified);
  const createdRaw = user.created_at || user.createdAt;
  const createdDateFormatted = createdRaw
    ? new Date(createdRaw).toLocaleDateString('en-IN', {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
      })
    : null;

  const openEditProfile = () => {
    setFullName(displayName);
    setUsername(user.username || '');
    setPhone(user.phone || '');
    setEditError(null);
    setEditSuccess(null);
    setOpen(false);
    setEditModalOpen(true);
  };

  const openChangePassword = () => {
    setCurrentPassword('');
    setNewPassword('');
    setConfirmNewPassword('');
    setPwError(null);
    setPwSuccess(null);
    setOpen(false);
    setPasswordModalOpen(true);
  };

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    setEditError(null);
    setEditSuccess(null);

    const trimmedName = fullName.trim();
    const trimmedPhone = phone.trim();
    const trimmedUsername = username.trim().toLowerCase();

    if (trimmedName.length < 2 || trimmedName.length > 80) {
      setEditError('Full name must be between 2 and 80 characters.');
      return;
    }
    if (trimmedUsername && !/^[a-z0-9_]{3,30}$/.test(trimmedUsername)) {
      setEditError('Username must be 3–30 characters (lowercase letters, numbers, or underscores).');
      return;
    }
    if (trimmedPhone && !/^[+]?[\d\s-]{10,16}$/.test(trimmedPhone)) {
      setEditError('Enter a valid mobile number (10–15 digits).');
      return;
    }

    setEditLoading(true);
    try {
      const res = await updateUserProfile({
        fullName: trimmedName,
        phone: trimmedPhone,
        username: trimmedUsername,
      });
      if (res.success) {
        setEditSuccess('Profile updated successfully.');
        setTimeout(() => {
          setEditModalOpen(false);
        }, 650);
      } else {
        setEditError(res.message || 'Could not update profile.');
      }
    } catch (err: any) {
      setEditError(err?.message || 'Could not update profile.');
    } finally {
      setEditLoading(false);
    }
  };

  const handleSavePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPwError(null);
    setPwSuccess(null);

    if (!currentPassword) {
      setPwError('Please enter your current password.');
      return;
    }
    if (newPassword.length < 8) {
      setPwError('New password must be at least 8 characters long.');
      return;
    }
    if (newPassword !== confirmNewPassword) {
      setPwError('New password and confirmation do not match.');
      return;
    }

    setPwLoading(true);
    try {
      const res = await changePassword(currentPassword, newPassword, confirmNewPassword);
      if (res.success) {
        setPwSuccess(res.message || 'Password changed successfully.');
        setTimeout(() => {
          setPasswordModalOpen(false);
        }, 800);
      } else {
        setPwError(res.message || 'Failed to change password.');
      }
    } catch (err: any) {
      setPwError(err?.message || 'Failed to change password.');
    } finally {
      setPwLoading(false);
    }
  };

  const avatarNode = (sizeClass: string) =>
    user.avatar_url || user.avatarUrl ? (
      <img
        src={user.avatar_url || user.avatarUrl || ''}
        alt={displayName}
        className={`${sizeClass} rounded-full object-cover border border-slate-200 dark:border-slate-700`}
      />
    ) : (
      <div
        className={`${sizeClass} rounded-full bg-gradient-to-br from-emerald-500 to-teal-600 text-white font-bold flex items-center justify-center shadow-sm shrink-0`}
      >
        {initials}
      </div>
    );

  return (
    <div ref={dropdownRef} className="relative">
      {variant === 'dashboard-header' ? (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="menu"
          data-testid="dashboard-profile-trigger"
          className="group flex items-center gap-3 text-left rounded-2xl px-2.5 py-1.5 -ml-2.5 transition-all hover:bg-slate-100/90 dark:hover:bg-slate-800/80 focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          {avatarNode('w-11 h-11 text-sm')}
          <div className="min-w-0">
            <div className="flex items-center gap-1.5">
              <h1 className="text-xl sm:text-2xl font-bold text-slate-900 dark:text-white tracking-tight truncate">
                {greetingText ? `${greetingText}, ${displayName}` : displayName}
              </h1>
              <ChevronDown
                className={`w-4 h-4 text-slate-400 group-hover:text-emerald-600 dark:group-hover:text-emerald-400 transition-transform duration-200 shrink-0 ${
                  open ? 'rotate-180 text-emerald-600' : ''
                }`}
              />
            </div>
            <p className="text-xs sm:text-sm text-slate-500 dark:text-slate-400 truncate flex items-center gap-1.5">
              <span>{user.email}</span>
              {user.username && (
                <span className="hidden sm:inline text-slate-400 dark:text-slate-500">
                  · @{user.username}
                </span>
              )}
            </p>
          </div>
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setOpen((prev) => !prev)}
          aria-expanded={open}
          aria-haspopup="menu"
          data-testid="navbar-profile-trigger"
          className="flex items-center gap-2.5 px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800/90 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl border border-slate-200/80 dark:border-slate-700/80 transition-colors focus:outline-none focus:ring-2 focus:ring-emerald-500/40"
        >
          {avatarNode('w-7 h-7 text-xs')}
          <div className="hidden sm:block text-left leading-tight max-w-[150px]">
            <p className="text-xs font-semibold text-slate-900 dark:text-white truncate">{displayName}</p>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 truncate">{user.email}</p>
          </div>
          <ChevronDown
            className={`w-3.5 h-3.5 text-slate-400 transition-transform duration-200 ${
              open ? 'rotate-180' : ''
            }`}
          />
        </button>
      )}

      {/* Dropdown Panel */}
      {open && (
        <div
          role="menu"
          data-testid="profile-dropdown-panel"
          className={`absolute ${
            variant === 'dashboard-header' ? 'left-0' : 'right-0'
          } mt-2 w-[310px] sm:w-[340px] max-w-[calc(100vw-2rem)] bg-white dark:bg-slate-900 rounded-2xl shadow-2xl border border-slate-200/90 dark:border-slate-700/90 z-50 overflow-hidden animate-in fade-in zoom-in-95 duration-150`}
        >
          {/* Identity Summary */}
          <div className="p-4 bg-gradient-to-br from-slate-50 to-emerald-50/40 dark:from-slate-800/80 dark:to-slate-900 border-b border-slate-200/80 dark:border-slate-800">
            <div className="flex items-start gap-3">
              {avatarNode('w-12 h-12 text-base')}
              <div className="min-w-0 flex-1">
                <p className="text-sm font-bold text-slate-900 dark:text-white truncate">{displayName}</p>
                <p className="text-xs text-slate-600 dark:text-slate-300 truncate flex items-center gap-1 mt-0.5">
                  <Mail className="w-3 h-3 text-slate-400 shrink-0" />
                  <span className="truncate">{user.email}</span>
                </p>
                <div className="mt-2 inline-flex items-center gap-1 text-[11px] font-semibold">
                  {isVerified ? (
                    <span className="inline-flex items-center gap-1 text-emerald-700 dark:text-emerald-400">
                      <CheckCircle2 className="w-3.5 h-3.5" />
                      Verified Account
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-amber-700 dark:text-amber-400">
                      <Clock className="w-3.5 h-3.5" />
                      Email Verification Pending
                    </span>
                  )}
                </div>
              </div>
            </div>

            {/* Metadata Details */}
            <div className="mt-3 pt-3 border-t border-slate-200/70 dark:border-slate-700/70 space-y-1.5 text-xs text-slate-600 dark:text-slate-300">
              {user.username && (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <AtSign className="w-3.5 h-3.5" /> Username
                  </span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">@{user.username}</span>
                </div>
              )}
              {user.phone && (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <Phone className="w-3.5 h-3.5" /> Mobile
                  </span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{user.phone}</span>
                </div>
              )}
              {createdDateFormatted && (
                <div className="flex items-center justify-between gap-2">
                  <span className="flex items-center gap-1.5 text-slate-500 dark:text-slate-400">
                    <Calendar className="w-3.5 h-3.5" /> Member Since
                  </span>
                  <span className="font-medium text-slate-800 dark:text-slate-200">{createdDateFormatted}</span>
                </div>
              )}
            </div>
          </div>

          {/* Actions */}
          <div className="p-2 space-y-0.5">
            <button
              type="button"
              role="menuitem"
              onClick={openEditProfile}
              data-testid="profile-menu-edit"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <Edit3 className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
              <span>Edit Profile</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={openChangePassword}
              data-testid="profile-menu-change-password"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <KeyRound className="w-4 h-4 text-blue-600 dark:text-blue-400" />
              <span>Change Password</span>
            </button>

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                if (onOpenPrivacySettings) {
                  onOpenPrivacySettings();
                } else if (onOpenFullSettings) {
                  onOpenFullSettings();
                }
              }}
              data-testid="profile-menu-privacy"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
            >
              <ShieldCheck className="w-4 h-4 text-indigo-600 dark:text-indigo-400" />
              <span>Privacy & Consent Settings</span>
            </button>

            {onOpenFullSettings && (
              <button
                type="button"
                role="menuitem"
                onClick={() => {
                  setOpen(false);
                  onOpenFullSettings();
                }}
                className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-medium text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              >
                <User className="w-4 h-4 text-slate-500 dark:text-slate-400" />
                <span>Account, Passkeys & UPI Settings</span>
              </button>
            )}

            <div className="my-1 border-t border-slate-100 dark:border-slate-800" />

            <button
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                logout();
              }}
              data-testid="profile-menu-logout"
              className="w-full flex items-center gap-3 px-3 py-2.5 rounded-xl text-sm font-semibold text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/40 transition-colors"
            >
              <LogOut className="w-4 h-4" />
              <span>Logout</span>
            </button>
          </div>
        </div>
      )}

      {/* Edit Profile Modal */}
      {editModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !editLoading && setEditModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Edit Profile</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Update your display name, username, or mobile number.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setEditModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSaveProfile} className="p-5 space-y-4">
              {editError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{editError}</span>
                </div>
              )}
              {editSuccess && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{editSuccess}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Full Name *
                </label>
                <input
                  type="text"
                  value={fullName}
                  onChange={(e) => setFullName(e.target.value)}
                  required
                  minLength={2}
                  maxLength={80}
                  data-testid="edit-profile-fullname"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                  placeholder="Enter your full name"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Registered Email
                </label>
                <input
                  type="email"
                  value={user.email}
                  disabled
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700/60 text-sm text-slate-500 dark:text-slate-400 cursor-not-allowed"
                />
                <p className="mt-1 text-[11px] text-slate-400">
                  Email address and account role are protected for your security.
                </p>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Username (optional)
                </label>
                <div className="relative">
                  <AtSign className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
                  <input
                    type="text"
                    value={username}
                    onChange={(e) => setUsername(e.target.value.toLowerCase().replace(/[^a-z0-9_]/g, ''))}
                    maxLength={30}
                    data-testid="edit-profile-username"
                    className="w-full pl-9 pr-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                    placeholder="your_handle"
                  />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Mobile Number (optional)
                </label>
                <input
                  type="tel"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  maxLength={16}
                  data-testid="edit-profile-phone"
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                  placeholder="+91 9876543210"
                />
              </div>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setEditModalOpen(false)}
                  disabled={editLoading}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={editLoading}
                  data-testid="edit-profile-save"
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
                >
                  {editLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Save Changes
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {passwordModalOpen && (
        <div
          className="fixed inset-0 z-50 bg-slate-950/60 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => !pwLoading && setPasswordModalOpen(false)}
        >
          <div
            className="w-full max-w-md bg-white dark:bg-slate-900 rounded-2xl border border-slate-200 dark:border-slate-700 shadow-2xl overflow-hidden"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 dark:border-slate-800">
              <div>
                <h2 className="text-base font-bold text-slate-900 dark:text-white">Change Password</h2>
                <p className="text-xs text-slate-500 dark:text-slate-400">
                  Minimum 8 characters with uppercase, lowercase, number & symbol.
                </p>
              </div>
              <button
                type="button"
                onClick={() => setPasswordModalOpen(false)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleSavePassword} className="p-5 space-y-4">
              {pwError && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-rose-50 dark:bg-rose-950/40 border border-rose-200 dark:border-rose-800 text-xs text-rose-700 dark:text-rose-300">
                  <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{pwError}</span>
                </div>
              )}
              {pwSuccess && (
                <div className="flex items-start gap-2 p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 text-xs text-emerald-700 dark:text-emerald-300">
                  <CheckCircle2 className="w-4 h-4 shrink-0 mt-0.5" />
                  <span>{pwSuccess}</span>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Current Password *
                </label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  required
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  New Password (min 8 chars) *
                </label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1.5">
                  Confirm New Password *
                </label>
                <input
                  type={showPasswords ? 'text' : 'password'}
                  value={confirmNewPassword}
                  onChange={(e) => setConfirmNewPassword(e.target.value)}
                  required
                  minLength={8}
                  className="w-full px-3.5 py-2.5 rounded-xl bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 text-sm text-slate-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-emerald-500/40 focus:border-emerald-500"
                />
              </div>

              <button
                type="button"
                onClick={() => setShowPasswords((v) => !v)}
                className="inline-flex items-center gap-1.5 text-xs font-medium text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200"
              >
                {showPasswords ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                {showPasswords ? 'Hide passwords' : 'Show passwords'}
              </button>

              <div className="flex items-center justify-end gap-2.5 pt-2">
                <button
                  type="button"
                  onClick={() => setPasswordModalOpen(false)}
                  disabled={pwLoading}
                  className="px-4 py-2 rounded-xl text-sm font-semibold text-slate-600 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={pwLoading}
                  className="inline-flex items-center gap-2 px-4 py-2 rounded-xl text-sm font-semibold bg-emerald-600 hover:bg-emerald-700 text-white shadow-sm disabled:opacity-50"
                >
                  {pwLoading && <Loader2 className="w-4 h-4 animate-spin" />}
                  Update Password
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
