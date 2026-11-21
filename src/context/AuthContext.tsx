import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AuthUser, AdminUserListItem } from '../types';
import { authApi, getStoredSessionToken, setStoredSessionToken, UserProfileData } from '../lib/authApi';

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  isRecoveryMode: boolean;
  recoveryToken: string | null;
  recoveryEmail: string | null;
  setIsRecoveryMode: React.Dispatch<React.SetStateAction<boolean>>;
  setRecoveryToken: React.Dispatch<React.SetStateAction<string | null>>;
  login: (email: string, pass: string, rememberMe?: boolean) => Promise<{ success: boolean; message?: string }>;
  register: (
    name: string,
    email: string,
    pass: string,
    confirmPass: string,
    phone?: string
  ) => Promise<{ success: boolean; message?: string; errors?: string[] }>;
  logout: () => Promise<void>;
  logoutAllDevices: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; message: string; resetLink?: string }>;
  completePasswordReset: (token: string, newPassword: string, confirmPassword: string) => Promise<{ success: boolean; message: string }>;
  changePassword: (currentPassword: string, newPassword: string, confirmNewPassword: string) => Promise<{ success: boolean; message: string }>;
  updateUserProfile: (payload: { fullName?: string; phone?: string; avatarUrl?: string }) => Promise<{ success: boolean; message: string }>;
  deleteAccount: (password: string) => Promise<{ success: boolean; message: string }>;
  // Secure Admin Functions
  getAdminUsersList: () => Promise<AdminUserListItem[]>;
  toggleUserStatus: (targetUserId: string, newStatus: 'active' | 'suspended' | 'deactivated') => Promise<{ success: boolean; message: string }>;
  adminUpdateUserRole: (targetUserId: string, newRole: 'user' | 'admin') => Promise<{ success: boolean; message: string }>;
  adminSendResetEmail: (targetUserId: string) => Promise<{ success: boolean; message: string; resetLink?: string }>;
  adminForcePasswordReset: (targetUserId: string) => Promise<{ success: boolean; message: string }>;
  adminRevokeSessions: (targetUserId: string) => Promise<{ success: boolean; message: string }>;
  adminDeleteUser: (targetUserId: string) => Promise<{ success: boolean; message: string }>;
  adminGetAuditLogs: () => Promise<any[]>;
  refreshUserProfile: () => Promise<void>;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<AuthUser | null>(null);
  const [isLoading, setIsLoading] = useState<boolean>(true);
  const [isRecoveryMode, setIsRecoveryMode] = useState<boolean>(false);
  const [recoveryToken, setRecoveryToken] = useState<string | null>(null);
  const [recoveryEmail, setRecoveryEmail] = useState<string | null>(null);

  // Check URL hash for reset password token on initial load
  useEffect(() => {
    const handleHashChange = () => {
      const hash = window.location.hash;
      if (hash.includes('reset-password')) {
        setIsRecoveryMode(true);
        const matchToken = hash.match(/token=([a-zA-Z0-9_-]+)/);
        if (matchToken && matchToken[1]) {
          setRecoveryToken(matchToken[1]);
        }
        const matchEmail = hash.match(/email=([^&]+)/);
        if (matchEmail && matchEmail[1]) {
          setRecoveryEmail(decodeURIComponent(matchEmail[1]));
        }
      }
    };

    handleHashChange();
    window.addEventListener('hashchange', handleHashChange);
    return () => window.removeEventListener('hashchange', handleHashChange);
  }, []);

  // Fetch current user from server session
  const refreshUserProfile = useCallback(async () => {
    const token = getStoredSessionToken();
    if (!token) {
      setUser(null);
      setIsLoading(false);
      return;
    }

    try {
      const res = await authApi.getMe();
      if (res.success && res.user) {
        setUser(res.user);
      } else {
        setUser(null);
        setStoredSessionToken(null);
      }
    } catch (err: any) {
      setUser(null);
      setStoredSessionToken(null);
    } finally {
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshUserProfile();
  }, [refreshUserProfile]);

  // Login handler
  const login = async (email: string, pass: string, rememberMe: boolean = false) => {
    try {
      const res = await authApi.login({ email, password: pass, rememberMe });
      if (res.success && res.user) {
        setUser(res.user);
        return { success: true, message: res.message };
      }
      return { success: false, message: res.message || 'Login failed.' };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Invalid email or password.',
      };
    }
  };

  // Register handler
  const register = async (
    name: string,
    email: string,
    pass: string,
    confirmPass: string,
    phone?: string
  ) => {
    try {
      const res = await authApi.register({
        fullName: name,
        email,
        phone,
        password: pass,
        confirmPassword: confirmPass,
      });
      if (res.success && res.user) {
        setUser(res.user);
        return { success: true, message: res.message };
      }
      return { success: false, message: res.message || 'Registration failed.' };
    } catch (err: any) {
      const errors = err?.data?.errors;
      return {
        success: false,
        message: err.message || 'Registration failed.',
        errors,
      };
    }
  };

  // Logout handler
  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStoredSessionToken(null);
    }
  };

  // Logout all devices
  const logoutAllDevices = async () => {
    try {
      await authApi.logoutAllDevices();
    } finally {
      setUser(null);
      setStoredSessionToken(null);
    }
  };

  // Forgot password
  const requestPasswordReset = async (email: string) => {
    try {
      const res = await authApi.forgotPassword(email);
      return {
        success: true,
        message: res.message,
        resetLink: res.resetLink,
      };
    } catch (err: any) {
      return {
        success: false,
        message: err.message || 'Failed to dispatch reset request.',
      };
    }
  };

  // Complete reset password
  const completePasswordReset = async (token: string, newPassword: string, confirmPassword: string) => {
    try {
      const res = await authApi.resetPassword({
        token,
        newPassword,
        confirmPassword,
      });
      setIsRecoveryMode(false);
      setRecoveryToken(null);
      window.location.hash = '';
      return { success: true, message: res.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to reset password.' };
    }
  };

  // Change password for logged in user
  const changePassword = async (currentPassword: string, newPassword: string, confirmNewPassword: string) => {
    try {
      const res = await authApi.changePassword({
        currentPassword,
        newPassword,
        confirmNewPassword,
      });
      return { success: true, message: res.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to change password.' };
    }
  };

  // Update profile
  const updateUserProfile = async (payload: { fullName?: string; phone?: string; avatarUrl?: string }) => {
    try {
      const res = await authApi.updateProfile(payload);
      if (res.success && res.user) {
        setUser(res.user);
        return { success: true, message: res.message };
      }
      return { success: false, message: res.message || 'Failed to update profile.' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to update profile.' };
    }
  };

  // Delete account
  const deleteAccount = async (password: string) => {
    try {
      const res = await authApi.deleteAccount(password);
      setUser(null);
      return { success: true, message: res.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to delete account.' };
    }
  };

  // Admin: Get users
  const getAdminUsersList = async (): Promise<AdminUserListItem[]> => {
    try {
      const res = await authApi.adminGetUsers();
      return res.users || [];
    } catch (err: any) {
      console.error('Failed to fetch admin users:', err);
      return [];
    }
  };

  // Admin: Toggle status
  const toggleUserStatus = async (targetUserId: string, newStatus: 'active' | 'suspended' | 'deactivated') => {
    try {
      const res = await authApi.adminUpdateUserStatus(targetUserId, newStatus);
      return { success: true, message: res.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to update status.' };
    }
  };

  // Admin: Change role
  const adminUpdateUserRole = async (targetUserId: string, newRole: 'user' | 'admin') => {
    try {
      const res = await authApi.adminUpdateUserRole(targetUserId, newRole);
      return { success: true, message: res.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to update user role.' };
    }
  };

  // Admin: Send reset email
  const adminSendResetEmail = async (targetUserId: string) => {
    try {
      const res = await authApi.adminSendResetEmail(targetUserId);
      return { success: true, message: res.message, resetLink: res.resetLink };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to dispatch reset email.' };
    }
  };

  // Admin: Force reset
  const adminForcePasswordReset = async (targetUserId: string) => {
    try {
      const res = await authApi.adminForcePasswordReset(targetUserId);
      return { success: true, message: res.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to flag force reset.' };
    }
  };

  // Admin: Revoke sessions
  const adminRevokeSessions = async (targetUserId: string) => {
    try {
      const res = await authApi.adminRevokeSessions(targetUserId);
      return { success: true, message: res.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to revoke sessions.' };
    }
  };

  // Admin: Delete user
  const adminDeleteUser = async (targetUserId: string) => {
    try {
      const res = await authApi.adminDeleteUser(targetUserId);
      return { success: true, message: res.message };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to delete user.' };
    }
  };

  // Admin: Audit logs
  const adminGetAuditLogs = async () => {
    try {
      const res = await authApi.adminGetAuditLogs();
      return res.logs || [];
    } catch (err: any) {
      console.error('Failed to fetch audit logs:', err);
      return [];
    }
  };

  const isAdmin = Boolean(user && (user.role === 'admin' || user.role === 'superadmin'));

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAdmin,
        isRecoveryMode,
        recoveryToken,
        recoveryEmail,
        setIsRecoveryMode,
        setRecoveryToken,
        login,
        register,
        logout,
        logoutAllDevices,
        requestPasswordReset,
        completePasswordReset,
        changePassword,
        updateUserProfile,
        deleteAccount,
        getAdminUsersList,
        toggleUserStatus,
        adminUpdateUserRole,
        adminSendResetEmail,
        adminForcePasswordReset,
        adminRevokeSessions,
        adminDeleteUser,
        adminGetAuditLogs,
        refreshUserProfile,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (!context) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
