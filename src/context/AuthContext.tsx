import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';
import { AuthUser, AdminUserListItem } from '../types';
import {
  authApi,
  getStoredSessionToken,
  getStoredAuthUser,
  setStoredSessionToken,
  setStoredAuthUser,
  type ActiveDeviceSession,
} from '../lib/authApi';
import { getSupabaseClient } from '../lib/supabase';
import { syncDeviceRegistration } from './PwaInstallContext';
import { clearUpiProfileCache } from '../lib/upiProfileApi';
import {
  getDefaultPermissionsForRole,
  isAdminPortalUser,
  isStaffPortalUser,
} from '../lib/portalAuth';

export interface LoginResult {
  success: boolean;
  message?: string;
  code?: string;
  maxSessions?: number;
  activeSessions?: ActiveDeviceSession[];
  requiresAdmin?: boolean;
  requiresStaff?: boolean;
}

interface AuthContextType {
  user: AuthUser | null;
  isLoading: boolean;
  isAdmin: boolean;
  isStaff: boolean;
  portalPermissions: string[];
  isRecoveryMode: boolean;
  recoveryToken: string | null;
  recoveryEmail: string | null;
  setIsRecoveryMode: React.Dispatch<React.SetStateAction<boolean>>;
  setRecoveryToken: React.Dispatch<React.SetStateAction<string | null>>;
  login: (
    email: string,
    pass: string,
    rememberMe?: boolean,
    replaceSessionId?: string
  ) => Promise<LoginResult>;
  loginWithGoogle: (replaceSessionId?: string) => Promise<LoginResult>;
  loginWithPasskey: (email?: string, replaceSessionId?: string) => Promise<LoginResult>;
  adminLogin: (
    email: string,
    pass: string,
    rememberMe?: boolean,
    replaceSessionId?: string
  ) => Promise<LoginResult>;
  staffLogin: (
    email: string,
    pass: string,
    rememberMe?: boolean,
    replaceSessionId?: string
  ) => Promise<LoginResult>;
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
  const [user, setUser] = useState<AuthUser | null>(() => {
    const token = getStoredSessionToken();
    const cached = getStoredAuthUser();
    return token && cached ? cached : null;
  });
  const [portalPermissions, setPortalPermissions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState<boolean>(() => {
    const token = getStoredSessionToken();
    const cached = getStoredAuthUser();
    // Instant boot if user + token are already cached locally (2G resilience)
    return !(token && cached);
  });
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
        if (err?.status === 401 || err?.status === 403) {
          clearUpiProfileCache();
          setUser(null);
          setIsLoading(false);
          return;
        }
        // On 2G timeout / offline error, keep cached user instead of wiping session
        const cached = getStoredAuthUser();
        if (cached) {
          setUser(cached);
          setIsLoading(false);
          return;
        }
        console.warn('Notice verifying server session token:', err.message);
      }
    }

    // 2. Try Supabase persistent session (multi-device resilience)
    if (supabase) {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user && session.user.email && session.access_token) {
          setStoredSessionToken(session.access_token);
          try {
            const meRes = await authApi.getMe();
            if (meRes.success && meRes.user) {
              setUser(meRes.user);
              setIsLoading(false);
              return;
            }
          } catch (meErr: any) {
            if (meErr?.status === 401 || meErr?.status === 403) {
              clearUpiProfileCache();
              setUser(null);
              setIsLoading(false);
              return;
            }
          }

          const email = session.user.email;
          const { data: prof } = await supabase
            .from('profiles')
            .select('*')
            .eq('id', session.user.id)
            .single();

          const isMasterEmail =
            email.toLowerCase() === 'hackifypro@gmail.com' ||
            email.toLowerCase() === 'admin@mymoney.com';
          const profRole = (prof?.role || '').toLowerCase().trim();
          const effectiveRole = isMasterEmail
            ? 'superadmin'
            : (profRole === 'admin' || profRole === 'superadmin' || profRole === 'support' || profRole === 'analyst')
              ? profRole
              : 'user';
          const isAdm = effectiveRole !== 'user';
          const authUser: AuthUser = {
            uid: session.user.id,
            id: session.user.id,
            email,
            displayName: prof?.full_name || (isAdm ? 'Security Administrator' : email.split('@')[0]),
            full_name: prof?.full_name || (isAdm ? 'Security Administrator' : email.split('@')[0]),
            role: effectiveRole as any,
            status: prof?.status || 'active',
            email_verified: Boolean(session.user.email_confirmed_at),
            created_at: prof?.created_at || new Date().toISOString(),
          };
          setUser(authUser);
          setStoredAuthUser(authUser);
          setIsLoading(false);
          return;
        }
      } catch (e) {
        console.warn('Supabase getSession notice:', e);
      }
    }

    clearUpiProfileCache();
    setUser(null);
    setIsLoading(false);
  }, []);

  useEffect(() => {
    const safetyTimer = setTimeout(() => {
      setIsLoading(false);
    }, 4500);
    Promise.resolve(refreshUserProfile()).finally(() => clearTimeout(safetyTimer));
    return () => clearTimeout(safetyTimer);
  }, [refreshUserProfile]);

  // Automatically log out this browser if its session was revoked remotely from another device
  useEffect(() => {
    if (typeof window === 'undefined') return;
    const handleRemoteRevoked = () => {
      clearUpiProfileCache();
      setStoredSessionToken(null);
      setStoredAuthUser(null);
      setUser(null);
    };
    window.addEventListener('mymoney:session-revoked', handleRemoteRevoked);

    if (!user) {
      return () => {
        window.removeEventListener('mymoney:session-revoked', handleRemoteRevoked);
      };
    }

    const verifySessionAlive = () => {
      const token = getStoredSessionToken();
      if (!token) return;
      authApi.getMe().catch((err: any) => {
        if (err?.status === 401 || err?.status === 403) {
          handleRemoteRevoked();
        }
      });
    };

    const onVisible = () => {
      if (typeof document !== 'undefined' && document.visibilityState === 'visible') {
        verifySessionAlive();
      }
    };

    const interval = setInterval(() => {
      if (typeof document === 'undefined' || document.visibilityState === 'visible') {
        verifySessionAlive();
      }
    }, 60000);
    window.addEventListener('focus', verifySessionAlive);
    document.addEventListener('visibilitychange', onVisible);

    return () => {
      clearInterval(interval);
      window.removeEventListener('mymoney:session-revoked', handleRemoteRevoked);
      window.removeEventListener('focus', verifySessionAlive);
      document.removeEventListener('visibilitychange', onVisible);
    };
  }, [user]);

  // Login handler with Dual-Layer multi-device sync and strict 3-session enforcement
  const login = async (
    email: string,
    pass: string,
    rememberMe: boolean = false,
    replaceSessionId?: string
  ): Promise<LoginResult> => {
    const supabase = getSupabaseClient();

    // 1. Authenticate with backend API
    let apiSuccess = false;
    let apiMessage = '';
    try {
      const res = await authApi.login({ email, password: pass, rememberMe, replaceSessionId });
      if (res.success && res.user) {
        setUser(res.user);
        apiSuccess = true;
        apiMessage = res.message;
      }
    } catch (err: any) {
      if (err?.data?.code === 'MAX_SESSIONS_REACHED' || err?.status === 409) {
        return {
          success: false,
          code: 'MAX_SESSIONS_REACHED',
          message:
            err.message ||
            'Maximum 3 concurrent logins allowed per account. Please log out from one device first.',
          maxSessions: err?.data?.maxSessions || 3,
          activeSessions: err?.data?.activeSessions || [],
        };
      }
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
          if (!apiSuccess && supaData.session?.access_token) {
            setStoredSessionToken(supaData.session.access_token);
            try {
              const meRes = await authApi.getMe();
              if (meRes.success && meRes.user) {
                setUser(meRes.user);
                syncDeviceRegistration();
                return { success: true, message: 'Logged in successfully.' };
              }
            } catch (meErr: any) {
              if (meErr?.status === 403 || meErr?.status === 401) {
                setStoredSessionToken(null);
                setStoredAuthUser(null);
                return {
                  success: false,
                  message: meErr?.message || 'Account access denied.',
                };
              }
            }

            const { data: prof } = await supabase
              .from('profiles')
              .select('role, status, full_name')
              .eq('id', supaData.user.id)
              .single();
            const isMasterEmail =
              email.trim().toLowerCase() === 'hackifypro@gmail.com' ||
              email.trim().toLowerCase() === 'admin@mymoney.com';
            const profRole = (prof?.role || '').toLowerCase().trim();
            const effectiveRole = isMasterEmail
              ? 'superadmin'
              : (profRole === 'admin' || profRole === 'superadmin' || profRole === 'support' || profRole === 'analyst')
                ? profRole
                : 'user';
            const isAdm = effectiveRole !== 'user';
            const authUser: AuthUser = {
              uid: supaData.user.id,
              id: supaData.user.id,
              email: supaData.user.email || email,
              displayName: prof?.full_name || (isAdm ? 'Security Administrator' : email.split('@')[0]),
              full_name: prof?.full_name || (isAdm ? 'Security Administrator' : email.split('@')[0]),
              role: effectiveRole as any,
              status: (prof?.status as any) || 'active',
              email_verified: Boolean(supaData.user.email_confirmed_at),
              created_at: new Date().toISOString(),
            };
            setUser(authUser);
            setStoredAuthUser(authUser);
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

  // Dedicated Admin Portal Login handler (/myadmin) — strictly requires superadmin/admin role
  const adminLogin = async (
    email: string,
    pass: string,
    rememberMe: boolean = false,
    replaceSessionId?: string
  ): Promise<LoginResult> => {
    const supabase = getSupabaseClient();
    try {
      const res = await authApi.adminLogin({ email, password: pass, rememberMe, replaceSessionId });
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
        code: err?.data?.code,
        maxSessions: err?.data?.maxSessions,
        activeSessions: err?.data?.activeSessions,
        message: err?.message || 'Administrator authentication failed.',
        requiresAdmin: Boolean(err?.data?.code === 'ADMIN_ROLE_REQUIRED' || err?.status === 403),
      };
    }
  };

  // Dedicated Staff Portal Login handler (/mystaff) — strictly requires staff role
  const staffLogin = async (
    email: string,
    pass: string,
    rememberMe: boolean = false,
    replaceSessionId?: string
  ): Promise<LoginResult> => {
    const supabase = getSupabaseClient();
    try {
      const res = await authApi.staffLogin({ email, password: pass, rememberMe, replaceSessionId });
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
          message: res.message || 'Staff portal access granted.',
        };
      }
      return {
        success: false,
        message: res.message || 'Invalid staff credentials.',
      };
    } catch (err: any) {
      return {
        success: false,
        code: err?.data?.code,
        maxSessions: err?.data?.maxSessions,
        activeSessions: err?.data?.activeSessions,
        message: err?.message || 'Staff authentication failed.',
        requiresStaff: Boolean(err?.data?.code === 'STAFF_ROLE_REQUIRED' || err?.status === 403),
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
      clearUpiProfileCache();
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
      clearUpiProfileCache();
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
  const loginWithGoogle = async (replaceSessionId?: string): Promise<LoginResult> => {
    try {
      const { signInWithFirebaseGoogle } = await import('../lib/firebaseClient');
      const { idToken } = await signInWithFirebaseGoogle();
      const res = await authApi.loginWithGoogle(idToken, replaceSessionId);
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
        maxSessions: err?.data?.maxSessions,
        activeSessions: err?.data?.activeSessions,
        message: err?.message || 'Google sign-in failed.',
      };
    }
  };

  // Passkey (WebAuthn) Sign-In -> server-verified canonical app_users.id
  const loginWithPasskey = async (email?: string, replaceSessionId?: string): Promise<LoginResult> => {
    try {
      const { loginWithPasskeyOnDevice } = await import('../lib/webauthnClient');
      const res = await loginWithPasskeyOnDevice(email, replaceSessionId);
      if (res.success && res.user && res.sessionToken) {
        setStoredSessionToken(res.sessionToken);
        setStoredAuthUser(res.user);
        setUser(res.user);
        syncDeviceRegistration();
        return { success: true, message: res.message || 'Signed in with Passkey.' };
      }
      return { success: false, message: res.message || 'Passkey sign-in failed.' };
    } catch (err: any) {
      return {
        success: false,
        code: err?.data?.code,
        maxSessions: err?.data?.maxSessions,
        activeSessions: err?.data?.activeSessions,
        message: err?.message || 'Passkey sign-in failed.',
      };
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

  // Admin: Get users strictly via authenticated /api/admin/users
  const getAdminUsersList = async (): Promise<AdminUserListItem[]> => {
    try {
      const res = await authApi.adminGetUsers();
      return res?.users || [];
    } catch (err: any) {
      console.warn('Admin users fetch rejected:', err.message);
      return [];
    }
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

  const isAdmin = isAdminPortalUser(user);
  const isStaff = isStaffPortalUser(user);

  useEffect(() => {
    if (!user || (!isAdmin && !isStaff)) {
      setPortalPermissions([]);
      return;
    }
    const defaults = getDefaultPermissionsForRole(user);
    setPortalPermissions(defaults);
    if (getStoredSessionToken()) {
      authApi
        .getMyPermissions()
        .then((res) => {
          if (res?.success && Array.isArray(res.permissions)) {
            setPortalPermissions(res.permissions);
          }
        })
        .catch(() => {});
    }
  }, [user, isAdmin, isStaff]);

  return (
    <AuthContext.Provider
      value={{
        user,
        isLoading,
        isAdmin,
        isStaff,
        portalPermissions,
        isRecoveryMode,
        recoveryToken,
        recoveryEmail,
        setIsRecoveryMode,
        setRecoveryToken,
        login,
        loginWithGoogle,
        loginWithPasskey,
        adminLogin,
        staffLogin,
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
