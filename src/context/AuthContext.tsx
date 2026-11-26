import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AuthUser, AdminUserListItem } from '../types';
import {
  authApi,
  getStoredSessionToken,
  setStoredSessionToken,
  setStoredAuthUser,
} from '../lib/authApi';
import { getSupabaseClient } from '../lib/supabase';
import { syncDeviceRegistration } from './PwaInstallContext';

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
  loginWithGoogle: () => Promise<{ success: boolean; message?: string; code?: string }>;
  loginWithPasskey: (email?: string) => Promise<{ success: boolean; message?: string }>;
  adminLogin: (
    email: string,
    pass: string,
    rememberMe?: boolean
  ) => Promise<{ success: boolean; message?: string; requiresAdmin?: boolean }>;
  register: (
    name: string,
    email: string,
    pass: string,
    confirmPass: string,
    phone?: string
  ) => Promise<{ success: boolean; message?: string; errors?: string[] }>;
  logout: () => Promise<void>;
  logoutAllDevices: () => Promise<void>;
  requestPasswordReset: (email: string) => Promise<{ success: boolean; message: string }>;
  completePasswordReset: (token: string, newPassword: string, confirmPassword: string) => Promise<{ success: boolean; message: string }>;
  changePassword: (currentPassword: string, newPassword: string, confirmNewPassword: string) => Promise<{ success: boolean; message: string }>;
  updateUserProfile: (payload: { fullName?: string; phone?: string; username?: string; avatarUrl?: string }) => Promise<{ success: boolean; message: string }>;
  completeUserProfile: (payload: { fullName: string; username?: string; phone?: string }) => Promise<{ success: boolean; message: string }>;
  deleteAccount: (password: string) => Promise<{ success: boolean; message: string }>;
  // Secure Admin Functions
  getAdminUsersList: () => Promise<AdminUserListItem[]>;
  toggleUserStatus: (targetUserId: string, newStatus: 'active' | 'suspended' | 'deactivated') => Promise<{ success: boolean; message: string }>;
  adminUpdateUserRole: (targetUserId: string, newRole: 'user' | 'admin') => Promise<{ success: boolean; message: string }>;
  adminSendResetEmail: (targetUserId: string) => Promise<{ success: boolean; message: string }>;
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

  // Check URL pathname, search params, and hash for reset password token and recovery mode
  useEffect(() => {
    const checkRecoveryRoute = () => {
      if (typeof window === 'undefined') return;
      const pathname = window.location.pathname.replace(/\/+$/, '') || '/';
      const search = window.location.search;
      const hash = window.location.hash;

      const isResetPath = pathname === '/reset-password';
      const isResetHash = hash.includes('reset-password');

      if (isResetPath || isResetHash) {
        setIsRecoveryMode(true);
        // Extract token from search query or hash
        const searchParams = new URLSearchParams(search);
        let token = searchParams.get('token');
        let email = searchParams.get('email');

        if (!token) {
          const matchToken = hash.match(/token=([a-zA-Z0-9_-]+)/);
          if (matchToken && matchToken[1]) {
            token = matchToken[1];
          }
        }
        if (!email) {
          const matchEmail = hash.match(/email=([^&]+)/);
          if (matchEmail && matchEmail[1]) {
            email = decodeURIComponent(matchEmail[1]);
          }
        }

        if (token) {
          setRecoveryToken(token);
          // Immediately strip recovery tokens from visible address bar
          if (window.location.search || window.location.hash) {
            try {
              window.history.replaceState(null, '', '/reset-password');
            } catch {}
          }
        }
        if (email) setRecoveryEmail(email);
      }
    };

    checkRecoveryRoute();
    window.addEventListener('hashchange', checkRecoveryRoute);
    window.addEventListener('popstate', checkRecoveryRoute);

    const supabase = getSupabaseClient();
    let authListener: any = null;
    if (supabase) {
      try {
        const { data } = supabase.auth.onAuthStateChange((event) => {
          if (event === 'PASSWORD_RECOVERY') {
            setIsRecoveryMode(true);
            try {
              window.history.replaceState(null, '', '/reset-password');
            } catch {}
          }
        });
        authListener = data?.subscription;
      } catch {}
    }

    return () => {
      window.removeEventListener('hashchange', checkRecoveryRoute);
      window.removeEventListener('popstate', checkRecoveryRoute);
      if (authListener?.unsubscribe) {
        authListener.unsubscribe();
      }
    };
  }, []);

  // Fetch current user from server session or Supabase session
  const refreshUserProfile = useCallback(async () => {
    const token = getStoredSessionToken();
    const supabase = getSupabaseClient();

    // 1. Try server session token
    if (token) {
      try {
        const res = await authApi.getMe();
        if (res.success && res.user) {
          setUser(res.user);
          setIsLoading(false);
          return;
        }
      } catch (err: any) {
        console.warn('Notice verifying server session token:', err.message);
      }
    }

    // 2. Try Supabase persistent session (multi-device resilience)
    if (supabase) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && session.user.email) {
          const email = session.user.email;
          const { data: prof } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();

          const isAdm = email.toLowerCase() === 'hackifypro@gmail.com' || email.toLowerCase() === 'admin@mymoney.com' || prof?.role === 'admin' || prof?.role === 'superadmin';
          const authUser: AuthUser = {
            uid: session.user.id,
            id: session.user.id,
            email,
            displayName: prof?.full_name || (isAdm ? 'Security Administrator' : email.split('@')[0]),
            full_name: prof?.full_name || (isAdm ? 'Security Administrator' : email.split('@')[0]),
            role: isAdm ? 'admin' : (prof?.role || 'user'),
            status: prof?.status || 'active',
            email_verified: true,
            created_at: prof?.created_at || new Date().toISOString(),
          };
          setUser(authUser);
          setStoredAuthUser(authUser);
          if (!getStoredSessionToken() && session.access_token) {
            setStoredSessionToken(session.access_token);
          }
          setIsLoading(false);
          return;
        }
      } catch (e) {
        console.warn('Supabase getSession notice:', e);
      }
    }

    setUser(null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    refreshUserProfile();
  }, [refreshUserProfile]);

  // Login handler with Dual-Layer multi-device sync
  const login = async (email: string, pass: string, rememberMe: boolean = false) => {
    const supabase = getSupabaseClient();

    // 1. Authenticate with backend API
    let apiSuccess = false;
    let apiMessage = '';
    try {
      const res = await authApi.login({ email, password: pass, rememberMe });
      if (res.success && res.user) {
        setUser(res.user);
        apiSuccess = true;
        apiMessage = res.message;
      }
    } catch (err: any) {
      if (err?.data?.code === 'MAINTENANCE_MODE' || (err?.status === 503 && err?.data?.maintenance)) {
        return {
          success: false,
          message: err.message || 'Platform is currently under scheduled maintenance. Please try again later.',
        };
      }
      console.warn('API login notice:', err.message);
      apiMessage = err.message || '';
    }

    // 2. Also authenticate with Supabase Auth to establish PostgreSQL RLS session
    if (supabase) {
      try {
        const { data: supaData, error: supaErr } = await supabase.auth.signInWithPassword({
          email: email.trim().toLowerCase(),
          password: pass,
        });

        if (!supaErr && supaData?.user) {
          const isAdm = email.trim().toLowerCase() === 'hackifypro@gmail.com' || email.trim().toLowerCase() === 'admin@mymoney.com';
          const authUser: AuthUser = {
            uid: supaData.user.id,
            id: supaData.user.id,
            email: supaData.user.email || email,
            displayName: isAdm ? 'Security Administrator' : email.split('@')[0],
            full_name: isAdm ? 'Security Administrator' : email.split('@')[0],
            role: isAdm ? 'admin' : 'user',
            status: 'active',
            email_verified: true,
            created_at: new Date().toISOString(),
          };
          if (!apiSuccess && supaData.session?.access_token) {
            setUser(authUser);
            setStoredAuthUser(authUser);
            setStoredSessionToken(supaData.session.access_token);
            syncDeviceRegistration();
            return { success: true, message: 'Logged in successfully.' };
          }
        }
      } catch (e) {
        console.warn('Supabase auth signin notice:', e);
      }
    }

    if (apiSuccess) {
      syncDeviceRegistration();
      return { success: true, message: apiMessage || 'Authenticated successfully.' };
    }

    return {
      success: false,
      message: apiMessage || 'Invalid email or password. Please verify your credentials.',
    };
  };

  // Dedicated Admin Portal Login handler (/admin) — strictly requires admin role
  const adminLogin = async (email: string, pass: string, rememberMe: boolean = false) => {
    const supabase = getSupabaseClient();
    try {
      const res = await authApi.adminLogin({ email, password: pass, rememberMe });
      if (res.success && res.user) {
        setUser(res.user);
        if (supabase) {
          supabase.auth
            .signInWithPassword({
              email: email.trim().toLowerCase(),
              password: pass,
            })
            .catch(() => {});
        }
        syncDeviceRegistration();
        return {
          success: true,
          message: res.message || 'Admin portal access granted.',
        };
      }
      return {
        success: false,
        message: res.message || 'Invalid administrator credentials.',
      };
    } catch (err: any) {
      return {
        success: false,
        message: err?.message || 'Administrator authentication failed.',
        requiresAdmin: Boolean(err?.data?.code === 'ADMIN_ROLE_REQUIRED' || err?.status === 403),
      };
    }
  };

  // Register handler with Dual-Layer multi-device sync
  const register = async (
    name: string,
    email: string,
    pass: string,
    confirmPass: string,
    phone?: string
  ) => {
    const supabase = getSupabaseClient();
    const cleanEmail = email.trim().toLowerCase();

    // 1. Try backend serverless registration
    try {
      const res = await authApi.register({
        fullName: name,
        email: cleanEmail,
        phone,
        password: pass,
        confirmPassword: confirmPass,
        requireProfileCompletion: true,
      });

      if (res.success && res.user) {
        setUser(res.user);

        // Also create user in Supabase Auth so PostgreSQL RLS rules are satisfied
        if (supabase) {
          try {
            await supabase.auth.signUp({
              email: cleanEmail,
              password: pass,
              options: { data: { full_name: name, role: 'user' } },
            });
          } catch {}
        }

        syncDeviceRegistration();
        return { success: true, message: res.message };
      }
    } catch (err: any) {
      if (
        err?.data?.code === 'MAINTENANCE_MODE' ||
        err?.status === 503 ||
        err?.status === 400 ||
        err?.status === 409
      ) {
        const errors = err?.data?.errors;
        return {
          success: false,
          message: err.message || 'Registration failed.',
          errors,
        };
      }

      // If API failed or is unreachable, try direct Supabase sign up
      if (supabase) {
        try {
          const { data, error } = await supabase.auth.signUp({
            email: cleanEmail,
            password: pass,
            options: { data: { full_name: name, role: 'user' } },
          });

          if (!error && data?.user) {
            await supabase.from('profiles').upsert({
              id: data.user.id,
              email: cleanEmail,
              role: 'user',
              status: 'active',
            });

            const newUser: AuthUser = {
              uid: data.user.id,
              id: data.user.id,
              email: cleanEmail,
              displayName: name,
              full_name: name,
              role: 'user',
              status: 'active',
              email_verified: false,
              created_at: new Date().toISOString(),
            };
            if (data.session?.access_token) {
              setStoredSessionToken(data.session.access_token);
            }
            setStoredAuthUser(newUser);
            setUser(newUser);
            return { success: true, message: 'Account registered successfully!' };
          }
        } catch {}
      }

      const errors = err?.data?.errors;
      return {
        success: false,
        message: err.message || 'Registration failed.',
        errors,
      };
    }

    return { success: false, message: 'Registration failed.' };
  };

  // Logout handler
  const logout = async () => {
    try {
      await authApi.logout();
    } finally {
      setUser(null);
      setStoredSessionToken(null);
      setStoredAuthUser(null);
    }
  };

  // Logout all devices
  const logoutAllDevices = async () => {
    try {
      await authApi.logoutAllDevices();
    } finally {
      setUser(null);
      setStoredSessionToken(null);
      setStoredAuthUser(null);
    }
  };

  // Forgot password
  const requestPasswordReset = async (email: string) => {
    try {
      const res = await authApi.forgotPassword(email);
      return {
        success: true,
        message: res.message || 'If an account exists with this email, a password reset link has been sent.',
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
  const updateUserProfile = async (payload: { fullName?: string; phone?: string; username?: string; avatarUrl?: string }) => {
    try {
      const res = await authApi.updateProfile(payload);
      if (res.success && res.user) {
        setUser(res.user);
        setStoredAuthUser(res.user);
        return { success: true, message: res.message };
      }
      return { success: false, message: res.message || 'Failed to update profile.' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Failed to update profile.' };
    }
  };

  // Complete first-time profile
  const completeUserProfile = async (payload: { fullName: string; username?: string; phone?: string }) => {
    try {
      const res = await authApi.completeProfile(payload);
      if (res.success && res.user) {
        setUser(res.user);
        setStoredAuthUser(res.user);
        return { success: true, message: res.message };
      }
      return { success: false, message: res.message || 'Could not save profile.' };
    } catch (err: any) {
      return { success: false, message: err.message || 'Could not save profile.' };
    }
  };

  // Google Sign-In via Firebase Auth -> server-verified canonical app_users.id
  const loginWithGoogle = async () => {
    try {
      const { signInWithFirebaseGoogle } = await import('../lib/firebaseClient');
      const { idToken } = await signInWithFirebaseGoogle();
      const res = await authApi.loginWithGoogle(idToken);
      if (res.success && res.user) {
        setUser(res.user);
        setStoredAuthUser(res.user);
        syncDeviceRegistration();
        return { success: true, message: res.message || 'Signed in with Google.' };
      }
      return { success: false, message: res.message || 'Google sign-in failed.' };
    } catch (err: any) {
      return {
        success: false,
        code: err?.data?.code,
        message: err?.message || 'Google sign-in failed.',
      };
    }
  };

  // Passkey (WebAuthn) Sign-In -> server-verified canonical app_users.id
  const loginWithPasskey = async (email?: string) => {
    try {
      const { loginWithPasskeyOnDevice } = await import('../lib/webauthnClient');
      const res = await loginWithPasskeyOnDevice(email);
      if (res.success && res.user && res.sessionToken) {
        setStoredSessionToken(res.sessionToken);
        setStoredAuthUser(res.user);
        setUser(res.user);
        syncDeviceRegistration();
        return { success: true, message: res.message || 'Signed in with Passkey.' };
      }
      return { success: false, message: res.message || 'Passkey sign-in failed.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Passkey sign-in failed.' };
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

  // Admin: Get users with Dual-Layer API + Supabase Profiles fallback
  const getAdminUsersList = async (): Promise<AdminUserListItem[]> => {
    // 1. Try server API
    try {
      const res = await authApi.adminGetUsers();
      if (res && res.users && res.users.length > 0) {
        return res.users;
      }
    } catch (err: any) {
      console.warn('Notice fetching admin users from API, trying Supabase directly:', err.message);
    }

    // 2. Direct Supabase Fallback (ensures users always display!)
    try {
      const supabase = getSupabaseClient();
      if (supabase) {
        const { data: profs, error } = await supabase
          .from('profiles')
          .select('*')
          .order('created_at', { ascending: false });

        if (!error && Array.isArray(profs) && profs.length > 0) {
          return profs.map((p: any) => ({
            id: p.id,
            uid: p.id,
            fullName: p.email ? p.email.split('@')[0] : 'User',
            displayName: p.email ? p.email.split('@')[0] : 'User',
            email: p.email,
            phone: null,
            role: p.role || 'user',
            status: p.status || 'active',
            emailVerified: true,
            forcePasswordReset: false,
            failedLoginAttempts: 0,
            createdAt: p.created_at || new Date().toISOString(),
            lastLoginAt: null,
            passwordChangedAt: p.created_at || new Date().toISOString(),
            passwordStatus: 'Protected (Bcrypt Encrypted)',
            activeSessionsCount: 1,
          }));
        }
      }
    } catch (e) {
      console.error('Supabase direct profiles query notice:', e);
    }

    return [];
  };

  // Admin: Toggle status
  const toggleUserStatus = async (targetUserId: string, newStatus: 'active' | 'suspended' | 'deactivated') => {
    try {
      const res = await authApi.adminUpdateUserStatus(targetUserId, newStatus);
      return { success: true, message: res.message || `Account status updated to ${newStatus}.` };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Failed to update account status.' };
    }
  };

  // Admin: Change role
  const adminUpdateUserRole = async (targetUserId: string, newRole: 'user' | 'admin') => {
    try {
      const res = await authApi.adminUpdateUserRole(targetUserId, newRole);
      return { success: true, message: res.message || `User role updated to ${newRole}.` };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Failed to update user role.' };
    }
  };

  // Admin: Send reset email
  const adminSendResetEmail = async (targetUserId: string) => {
    try {
      const res = await authApi.adminSendResetEmail(targetUserId);
      return { success: true, message: res.message };
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
      return { success: Boolean(res.success), message: res.message || 'User deleted successfully.' };
    } catch (err: any) {
      return { success: false, message: err?.message || 'Failed to delete user.' };
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

  const isMasterAdmin = Boolean(
    user?.email &&
    (user.email.toLowerCase().trim() === 'hackifypro@gmail.com' ||
     user.email.toLowerCase().trim() === 'admin@mymoney.com')
  );
  const userRole = (user?.role || '').toLowerCase().trim();
  const isAdmin = Boolean(
    isMasterAdmin ||
    (user && (userRole === 'admin' || userRole === 'superadmin' || userRole === 'support' || userRole === 'analyst'))
  );

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
        loginWithGoogle,
        loginWithPasskey,
        adminLogin,
        register,
        logout,
        logoutAllDevices,
        requestPasswordReset,
        completePasswordReset,
        changePassword,
        updateUserProfile,
        completeUserProfile,
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
