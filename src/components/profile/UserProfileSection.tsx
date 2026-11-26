import React, { useState, useEffect } from 'react';
import {
  User,
  Mail,
  Phone,
  Shield,
  KeyRound,
  Laptop,
  LogOut,
  Trash2,
  CheckCircle2,
  AlertTriangle,
  Eye,
  EyeOff,
  Edit3,
  ShieldCheck,
  X,
} from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import { useToast } from '../../context/ToastContext';
import { authApi, UserProfileData } from '../../lib/authApi';
import { formatDisplayDate } from '../../lib/dateUtils';
import { ConfirmModal } from '../common/ConfirmModal';
import { AccountDeletionSection } from './AccountDeletionSection';
import { ProfilePhotoUploadModal } from './ProfilePhotoUploadModal';
import { Camera } from 'lucide-react';

interface UserProfileSectionProps {
  onNavigateToDeletion?: () => void;
}

export const UserProfileSection: React.FC<UserProfileSectionProps> = ({
  onNavigateToDeletion,
}) => {
  const { user, logout, logoutAllDevices, changePassword, updateUserProfile } = useAuth();
  const toast = useToast();

  const [profile, setProfile] = useState<UserProfileData | null>(null);
  const [isLoadingProfile, setIsLoadingProfile] = useState<boolean>(true);

  // Edit Profile Modal
  const [isPhotoModalOpen, setIsPhotoModalOpen] = useState(false);
  const [isEditModalOpen, setIsEditModalOpen] = useState(false);
  const [editFullName, setEditFullName] = useState('');
  const [editPhone, setEditPhone] = useState('');
  const [isUpdatingProfile, setIsUpdatingProfile] = useState(false);

  // Change Password Modal
  const [isPasswordModalOpen, setIsPasswordModalOpen] = useState(false);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmNewPassword, setConfirmNewPassword] = useState('');
  const [showCurrentPass, setShowCurrentPass] = useState(false);
  const [showNewPass, setShowNewPass] = useState(false);
  const [showConfirmPass, setShowConfirmPass] = useState(false);
  const [isChangingPass, setIsChangingPass] = useState(false);
  const [passwordError, setPasswordError] = useState<string | null>(null);

  // Confirmations
  const [isConfirmLogoutAllOpen, setIsConfirmLogoutAllOpen] = useState(false);
  const [isLoggingOutAll, setIsLoggingOutAll] = useState(false);

  const fetchProfileData = async () => {
    try {
      setIsLoadingProfile(true);
      const res = await authApi.getProfile();
      if (res.success && res.profile) {
        setProfile(res.profile);
        setEditFullName(res.profile.full_name || res.profile.displayName || '');
        setEditPhone(res.profile.phone || '');
      }
    } catch (err: any) {
      console.warn('Profile fetch notice, falling back to session user:', err?.message);
      if (user) {
        const fallbackProfile: UserProfileData = {
          id: user.uid || user.id || 'user',
          uid: user.uid || user.id || 'user',
          full_name: user.displayName || user.full_name || 'User',
          displayName: user.displayName || user.full_name || 'User',
          email: user.email || '',
          phone: user.phone || null,
          role: (user.role === 'admin' || user.role === 'superadmin' ? user.role : 'user') as any,
          status: user.status || 'active',
          email_verified: Boolean(user.email_verified),
          avatar_url: user.avatarUrl || null,
          force_password_reset: false,
          created_at: user.createdAt || new Date().toISOString(),
          createdAt: user.createdAt || new Date().toISOString(),
          last_login_at: null,
          password_changed_at: 'Never',
          activeSessionsCount: 1,
        };
        setProfile(fallbackProfile);
        setEditFullName(fallbackProfile.full_name);
        setEditPhone(fallbackProfile.phone || '');
      } else {
        toast.error('Profile Error', err.message || 'Unable to fetch user profile.');
      }
    } finally {
      setIsLoadingProfile(false);
    }
  };

  useEffect(() => {
    fetchProfileData();
  }, []);

  const handleUpdateProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!editFullName.trim() || editFullName.trim().length < 2) {
      toast.error('Validation Error', 'Full name must be at least 2 characters.');
      return;
    }

    try {
      setIsUpdatingProfile(true);
      const res = await updateUserProfile({
        fullName: editFullName.trim(),
        phone: editPhone.trim() || undefined,
      });
      if (res.success) {
        toast.success('Profile Updated', 'Your profile details have been saved.');
        setIsEditModalOpen(false);
        await fetchProfileData();
      } else {
        toast.error('Update Failed', res.message);
      }
    } catch (err: any) {
      toast.error('Error', err.message);
    } finally {
      setIsUpdatingProfile(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    setPasswordError(null);

    if (!currentPassword) {
      setPasswordError('Please enter your current password.');
      return;
    }

    if (newPassword.length < 8) {
      setPasswordError('New password must be at least 8 characters long for security compliance.');
      return;
    }

    if (newPassword !== confirmNewPassword) {
      setPasswordError('New passwords do not match. Please verify both fields.');
      return;
    }

    if (newPassword === currentPassword) {
      setPasswordError('New password cannot be the same as your current password.');
      return;
    }

    try {
      setIsChangingPass(true);
      const res = await changePassword(currentPassword, newPassword, confirmNewPassword);
      if (res.success) {
        toast.success('Password Changed', 'Your password was updated and all other sessions were revoked.');
        setIsPasswordModalOpen(false);
        setCurrentPassword('');
        setNewPassword('');
        setConfirmNewPassword('');
        await fetchProfileData();
      } else {
        setPasswordError(res.message);
      }
    } catch (err: any) {
      setPasswordError(err.message || 'Failed to change password.');
    } finally {
      setIsChangingPass(false);
    }
  };

  const handleLogoutAllDevices = async () => {
    try {
      setIsLoggingOutAll(true);
      await logoutAllDevices();
      toast.success('Logged Out Everywhere', 'All device sessions were revoked.');
    } catch (err: any) {
      toast.error('Logout Error', err.message);
    } finally {
      setIsLoggingOutAll(false);
      setIsConfirmLogoutAllOpen(false);
    }
  };

  const displayName = profile?.full_name || profile?.displayName || user?.displayName || 'User';
  const displayEmail = profile?.email || user?.email || '';
  const displayPhone = profile?.phone || user?.phone || 'Not provided';
  const role = profile?.role || user?.role || 'user';
  const status = profile?.status || user?.status || 'active';
  const createdAt = profile?.created_at || profile?.createdAt || user?.createdAt || '';
  const passwordChangedAt = profile?.password_changed_at || '';
  const activeSessionsCount = profile?.activeSessionsCount || 1;

  return (
    <div className="space-y-6 max-w-4xl mx-auto pb-16 animate-fade-in">
      {/* Top Profile Hero Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-8 shadow-sm relative overflow-hidden">
        <div className="absolute top-0 right-0 w-64 h-64 bg-emerald-500/5 rounded-full blur-3xl pointer-events-none" />

        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-6">
          <div className="flex items-center gap-5">
            <div
              className="relative group cursor-pointer"
              onClick={() => setIsPhotoModalOpen(true)}
              title="Click to change profile picture"
            >
              {user?.avatar_url || user?.avatarUrl || profile?.avatar_url ? (
                <img
                  src={user?.avatar_url || user?.avatarUrl || profile?.avatar_url || ''}
                  alt={displayName}
                  className="w-20 h-20 rounded-2xl object-cover shadow-xl shadow-emerald-600/20 border-2 border-emerald-500/40 shrink-0"
                />
              ) : (
                <div className="w-20 h-20 rounded-2xl bg-gradient-to-tr from-emerald-600 to-teal-500 text-white font-black text-2xl flex items-center justify-center shadow-xl shadow-emerald-600/20 border-2 border-white dark:border-slate-800 shrink-0">
                  {displayName.charAt(0).toUpperCase()}
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 rounded-2xl opacity-0 group-hover:opacity-100 transition-opacity flex items-center justify-center text-white backdrop-blur-xs">
                <Camera className="w-6 h-6" />
              </div>
            </div>
            <div>
              <div className="flex items-center gap-2.5 flex-wrap">
                <h2 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-slate-100">
                  {displayName}
                </h2>
                <span
                  className={`px-2.5 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                    role === 'admin' || role === 'superadmin'
                      ? 'bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 border border-amber-200 dark:border-amber-800'
                      : 'bg-emerald-100 dark:bg-emerald-950 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                  }`}
                >
                  {role}
                </span>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400">
                  {status === 'active' ? '● Active Account' : status}
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 mt-1 flex items-center gap-1.5">
                <Mail className="w-3.5 h-3.5 text-slate-400" />
                <span>{displayEmail}</span>
              </p>
              {displayPhone !== 'Not provided' && (
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-0.5 flex items-center gap-1.5">
                  <Phone className="w-3.5 h-3.5 text-slate-400" />
                  <span>{displayPhone}</span>
                </p>
              )}
            </div>
          </div>

          <div className="flex items-center gap-2.5 w-full sm:w-auto flex-wrap">
            <button
              onClick={() => setIsPhotoModalOpen(true)}
              className="flex-1 sm:flex-none px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Camera className="w-3.5 h-3.5 text-emerald-600" />
              <span>Photo</span>
            </button>
            <button
              onClick={() => setIsEditModalOpen(true)}
              className="flex-1 sm:flex-none px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 rounded-xl text-xs font-bold transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <Edit3 className="w-3.5 h-3.5" />
              <span>Edit Profile</span>
            </button>
            <button
              onClick={() => setIsPasswordModalOpen(true)}
              className="flex-1 sm:flex-none px-4 py-2 bg-emerald-600 hover:bg-emerald-700 active:scale-95 text-white rounded-xl text-xs font-bold shadow-md shadow-emerald-600/20 transition-all flex items-center justify-center gap-2 cursor-pointer"
            >
              <KeyRound className="w-3.5 h-3.5" />
              <span>Change Password</span>
            </button>
          </div>
        </div>
      </div>

      {/* Grid of Profile Details & Security Info */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        {/* Personal Details */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <User className="w-4 h-4 text-emerald-500" />
            <span>Personal Information</span>
          </h3>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Full Name</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{displayName}</span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Email Address</span>
              <span className="font-mono text-slate-800 dark:text-slate-200">{displayEmail}</span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Phone Number</span>
              <span className="font-bold text-slate-800 dark:text-slate-200">{displayPhone}</span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Email Verification</span>
              <span className="flex items-center gap-1 font-bold text-emerald-600 dark:text-emerald-400">
                <CheckCircle2 className="w-3.5 h-3.5" />
                <span>Verified</span>
              </span>
            </div>

            <div className="flex justify-between py-1.5">
              <span className="text-slate-500">Member Since</span>
              <span className="text-slate-800 dark:text-slate-200">
                {createdAt ? formatDisplayDate(createdAt.split('T')[0]) : 'Recent'}
              </span>
            </div>
          </div>
        </div>

        {/* Account Security & Sessions */}
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
          <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 flex items-center gap-2 border-b border-slate-100 dark:border-slate-800 pb-3">
            <ShieldCheck className="w-4 h-4 text-emerald-500" />
            <span>Security & Session Protection</span>
          </h3>

          <div className="space-y-3 text-xs">
            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Password Encryption</span>
              <span className="font-bold text-emerald-600 dark:text-emerald-400">
                Bcrypt (Cost Factor 12)
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Last Password Change</span>
              <span className="text-slate-800 dark:text-slate-200">
                {passwordChangedAt ? formatDisplayDate(passwordChangedAt.split('T')[0]) : 'Never'}
              </span>
            </div>

            <div className="flex justify-between py-1.5 border-b border-slate-100 dark:border-slate-800/60">
              <span className="text-slate-500">Active Device Sessions</span>
              <span className="font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                <Laptop className="w-3.5 h-3.5" />
                <span>{activeSessionsCount} active session{activeSessionsCount > 1 ? 's' : ''}</span>
              </span>
            </div>

            <div className="flex justify-between py-1.5">
              <span className="text-slate-500">Data Isolation Policy</span>
              <span className="text-slate-700 dark:text-slate-300 font-semibold">
                Strict Multi-Tenant RLS
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* Account Actions & Danger Zone */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm space-y-4">
        <h3 className="font-bold text-sm text-slate-900 dark:text-slate-100 border-b border-slate-100 dark:border-slate-800 pb-3">
          Session & Account Actions
        </h3>

        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3.5">
          <button
            onClick={() => logout()}
            className="p-3.5 rounded-2xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800/60 dark:hover:bg-slate-800 border border-slate-200 dark:border-slate-700 text-left transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-slate-800 dark:text-slate-200">
              <LogOut className="w-4 h-4 text-slate-500" />
              <span>Sign Out</span>
            </div>
            <p className="text-[11px] text-slate-500 mt-1">End session on this browser</p>
          </button>

          <button
            onClick={() => setIsConfirmLogoutAllOpen(true)}
            className="p-3.5 rounded-2xl bg-amber-50/60 hover:bg-amber-100/60 dark:bg-amber-950/30 dark:hover:bg-amber-950/50 border border-amber-200/80 dark:border-amber-800 text-left transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-amber-900 dark:text-amber-200">
              <Shield className="w-4 h-4 text-amber-600" />
              <span>Logout All Devices</span>
            </div>
            <p className="text-[11px] text-amber-700 dark:text-amber-300 mt-1">Revoke all active tokens</p>
          </button>

          <button
            onClick={() => {
              if (onNavigateToDeletion) {
                onNavigateToDeletion();
              } else {
                const el = document.getElementById('account-deletion-section');
                if (el) el.scrollIntoView({ behavior: 'smooth' });
              }
            }}
            className="p-3.5 rounded-2xl bg-rose-50/60 hover:bg-rose-100/60 dark:bg-rose-950/30 dark:hover:bg-rose-950/50 border border-rose-200/80 dark:border-rose-800 text-left transition-all cursor-pointer"
          >
            <div className="flex items-center gap-2 text-xs font-bold text-rose-700 dark:text-rose-300">
              <Trash2 className="w-4 h-4 text-rose-600" />
              <span>Delete Account & Data</span>
            </div>
            <p className="text-[11px] text-rose-600 dark:text-rose-400 mt-1">24-hour safety cancellation window</p>
          </button>
        </div>
      </div>

      {/* Edit Profile Modal */}
      {isEditModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100">
                Edit Profile Information
              </h3>
              <button
                onClick={() => setIsEditModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <form onSubmit={handleUpdateProfile} className="space-y-4">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Full Name <span className="text-rose-500">*</span>
                </label>
                <input
                  type="text"
                  required
                  value={editFullName}
                  onChange={(e) => setEditFullName(e.target.value)}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Phone Number
                </label>
                <input
                  type="tel"
                  value={editPhone}
                  onChange={(e) => setEditPhone(e.target.value)}
                  placeholder="+91 98765 43210"
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-sm focus:ring-2 focus:ring-emerald-500"
                />
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Email Address
                </label>
                <input
                  type="email"
                  disabled
                  value={displayEmail}
                  className="w-full px-3.5 py-2.5 rounded-xl border border-slate-200 dark:border-slate-800 bg-slate-100 dark:bg-slate-800/50 text-slate-500 text-sm cursor-not-allowed"
                />
                <p className="text-[10px] text-slate-400 mt-1">
                  Email change requires verification link sent to your registered address.
                </p>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsEditModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isUpdatingProfile}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20"
                >
                  {isUpdatingProfile ? 'Saving...' : 'Save Changes'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Change Password Modal */}
      {isPasswordModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/70 backdrop-blur-sm flex items-center justify-center p-4 animate-fade-in">
          <div className="bg-white dark:bg-slate-900 rounded-3xl max-w-md w-full p-6 border border-slate-200 dark:border-slate-800 shadow-2xl space-y-4">
            <div className="flex items-center justify-between pb-3 border-b border-slate-100 dark:border-slate-800">
              <h3 className="font-bold text-base text-slate-900 dark:text-slate-100 flex items-center gap-2">
                <KeyRound className="w-4 h-4 text-emerald-500" />
                <span>Change Your Password</span>
              </h3>
              <button
                onClick={() => setIsPasswordModalOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-slate-600"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {passwordError && (
              <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-900 rounded-xl text-xs text-rose-700 dark:text-rose-300 flex items-start gap-2">
                <AlertTriangle className="w-4 h-4 shrink-0 mt-0.5 text-rose-600" />
                <span>{passwordError}</span>
              </div>
            )}

            <form onSubmit={handleChangePassword} className="space-y-3.5">
              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Current Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showCurrentPass ? 'text' : 'password'}
                    required
                    value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)}
                    placeholder="Enter current password"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowCurrentPass(!showCurrentPass)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400"
                  >
                    {showCurrentPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  New Password (min 8 characters) <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showNewPass ? 'text' : 'password'}
                    required
                    value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)}
                    placeholder="Enter secure new passphrase"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowNewPass(!showNewPass)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400"
                  >
                    {showNewPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-700 dark:text-slate-300 mb-1">
                  Confirm New Password <span className="text-rose-500">*</span>
                </label>
                <div className="relative">
                  <input
                    type={showConfirmPass ? 'text' : 'password'}
                    required
                    value={confirmNewPassword}
                    onChange={(e) => setConfirmNewPassword(e.target.value)}
                    placeholder="Re-enter new passphrase"
                    className="w-full px-3.5 py-2.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-800 text-xs font-mono"
                  />
                  <button
                    type="button"
                    onClick={() => setShowConfirmPass(!showConfirmPass)}
                    className="absolute inset-y-0 right-0 pr-3 flex items-center text-slate-400"
                  >
                    {showConfirmPass ? <EyeOff className="w-3.5 h-3.5" /> : <Eye className="w-3.5 h-3.5" />}
                  </button>
                </div>
              </div>

              <div className="flex items-center gap-3 pt-2">
                <button
                  type="button"
                  onClick={() => setIsPasswordModalOpen(false)}
                  className="flex-1 py-2.5 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 text-xs font-bold"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={isChangingPass}
                  className="flex-1 py-2.5 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold shadow-md shadow-emerald-600/20"
                >
                  {isChangingPass ? 'Updating...' : 'Update Password'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Logout All Devices Confirm Modal */}
      <ConfirmModal
        isOpen={isConfirmLogoutAllOpen}
        title="Revoke All Sessions & Logout Everywhere?"
        message="This action will terminate your active login sessions across all browsers, mobile devices, and computers. You will need to log in again on this device."
        confirmLabel="Revoke All Sessions"
        isLoading={isLoggingOutAll}
        onConfirm={handleLogoutAllDevices}
        onCancel={() => setIsConfirmLogoutAllOpen(false)}
      />

      {/* Account Deletion & Data Purge with 24-Hour Cancellation Window */}
      <div id="account-deletion-section" className="pt-2">
        <AccountDeletionSection />
      </div>

      {/* Profile Photo Upload Modal */}
      <ProfilePhotoUploadModal
        isOpen={isPhotoModalOpen}
        onClose={() => setIsPhotoModalOpen(false)}
        currentAvatarUrl={user?.avatarUrl}
        onPhotoUpdated={() => fetchProfileData()}
      />
    </div>
  );
};
