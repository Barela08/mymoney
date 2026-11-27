import { AuthUser, AdminUserListItem } from '../types';

export interface UserProfileData {
  id: string;
  uid: string;
  full_name: string;
  displayName: string;
  email: string;
  username?: string | null;
  phone?: string | null;
  role: 'user' | 'admin' | 'superadmin';
  status: 'active' | 'suspended' | 'deactivated';
  email_verified: boolean;
  avatar_url?: string | null;
  force_password_reset: boolean;
  profile_completed?: boolean;
  profileCompleted?: boolean;
  created_at: string;
  createdAt: string;
  last_login_at?: string | null;
  password_changed_at: string;
  activeSessionsCount?: number;
}

export interface SecurityMethodsData {
  email: {
    address: string;
    verified: boolean;
    hasPassword: boolean;
  };
  google: {
    linked: boolean;
    email: string | null;
    linkedAt: string | null;
  };
  passkeys: Array<{
    id: string;
    deviceName: string;
    transports: string[];
    createdAt: string;
    lastUsedAt: string | null;
  }>;
}

export interface ActiveDeviceSession {
  id: string;
  deviceName: string;
  deviceType: 'mobile' | 'tablet' | 'desktop';
  browser: string;
  os: string;
  ipAddress: string | null;
  createdAt: string;
  lastActiveAt: string | null;
  expiresAt: string;
  isCurrent: boolean;
}

const TOKEN_KEY = 'my_money_auth_token';
const USER_KEY = 'my_money_auth_user';

export function getStoredSessionToken(): string | null {
  try {
    const token = localStorage.getItem(TOKEN_KEY);
    // Automatically purge legacy unsigned direct_ tokens that are rejected by backend APIs
    if (token && token.startsWith('direct_')) {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
      return null;
    }
    return token;
  } catch {
    return null;
  }
}

export const getStoredAuthToken = getStoredSessionToken;

export function setStoredSessionToken(token: string | null) {
  try {
    if (token && !token.startsWith('direct_')) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
      localStorage.removeItem(USER_KEY);
    }
  } catch {}
}

export function getStoredAuthUser(): AuthUser | null {
  try {
    const raw = localStorage.getItem(USER_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function setStoredAuthUser(user: AuthUser | null) {
  try {
    if (user) {
      localStorage.setItem(USER_KEY, JSON.stringify(user));
    } else {
      localStorage.removeItem(USER_KEY);
    }
  } catch {}
}

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string> || {}),
  };

  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include', // sends cookies
  });

  let data: any = {};
  const contentType = res.headers.get('content-type') || '';
  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (e) {
      data = { success: false, message: 'Invalid JSON response from server' };
    }
  } else {
    // Received HTML or non-JSON (e.g. 404/500/SPA fallback)
    const err = new Error(`Server returned non-JSON response (${res.status})`);
    (err as any).status = res.status;
    (err as any).isNonJson = true;
    throw err;
  }

  if (!res.ok) {
    if (
      res.status === 401 &&
      token &&
      typeof window !== 'undefined' &&
      !endpoint.startsWith('/api/auth/login') &&
      !endpoint.startsWith('/api/admin/auth/login') &&
      !endpoint.startsWith('/api/staff/auth/login') &&
      !endpoint.startsWith('/api/auth/register') &&
      !endpoint.startsWith('/api/auth/google') &&
      !endpoint.startsWith('/api/auth/passkey/login')
    ) {
      setStoredSessionToken(null);
      setStoredAuthUser(null);
      window.dispatchEvent(new CustomEvent('mymoney:session-revoked', { detail: { message: data?.message } }));
    }
    if (data?.code === 'MAINTENANCE_MODE' && typeof window !== 'undefined') {
      window.dispatchEvent(
        new CustomEvent('mymoney:maintenance-detected', {
          detail: {
            message: data?.message,
            expectedRestoration: data?.expectedRestoration,
          },
        })
      );
    }
    const errorMsg = data?.message || data?.error || `Request failed with status ${res.status}`;
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    (err as any).data = data;
    throw err;
  }

  return data;
}

export const authApi = {
  // Authentication
  async register(payload: {
    fullName: string;
    email: string;
    phone?: string;
    password: string;
    confirmPassword: string;
    requireProfileCompletion?: boolean;
  }): Promise<{ success: boolean; message: string; user: AuthUser; sessionToken: string }> {
    const data = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.sessionToken) {
      setStoredSessionToken(data.sessionToken);
      if (data.user) setStoredAuthUser(data.user);
    }
    return data;
  },

  async loginWithGoogle(
    idToken: string,
    replaceSessionId?: string
  ): Promise<{
    success: boolean;
    message?: string;
    isNewUser?: boolean;
    requiresProfileCompletion?: boolean;
    user: AuthUser;
    sessionToken: string;
  }> {
    const data = await request('/api/auth/google', {
      method: 'POST',
      body: JSON.stringify(replaceSessionId ? { idToken, replaceSessionId } : { idToken }),
    });
    if (data.sessionToken) {
      setStoredSessionToken(data.sessionToken);
      if (data.user) setStoredAuthUser(data.user);
    }
    return data;
  },

  async login(payload: {
    email: string;
    password: string;
    rememberMe?: boolean;
    replaceSessionId?: string;
  }): Promise<{ success: boolean; message: string; user: AuthUser; sessionToken: string }> {
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.sessionToken) {
      setStoredSessionToken(data.sessionToken);
      if (data.user) setStoredAuthUser(data.user);
    }
    return data;
  },

  async adminLogin(payload: {
    email: string;
    password: string;
    rememberMe?: boolean;
    replaceSessionId?: string;
  }): Promise<{ success: boolean; message: string; user: AuthUser; sessionToken: string }> {
    const data = await request('/api/admin/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.sessionToken) {
      setStoredSessionToken(data.sessionToken);
      if (data.user) setStoredAuthUser(data.user);
    }
    return data;
  },

  async staffLogin(payload: {
    email: string;
    password: string;
    rememberMe?: boolean;
    replaceSessionId?: string;
  }): Promise<{ success: boolean; message: string; user: AuthUser; sessionToken: string }> {
    const data = await request('/api/staff/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.sessionToken) {
      setStoredSessionToken(data.sessionToken);
      if (data.user) setStoredAuthUser(data.user);
    }
    return data;
  },

  async getMyPermissions(): Promise<{ success: boolean; role: string; permissions: string[] }> {
    return await request('/api/admin/my-permissions', { method: 'GET' });
  },

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } catch {} finally {
      setStoredSessionToken(null);
    }
  },

  async logoutAllDevices(): Promise<void> {
    try {
      await request('/api/auth/logout-all-devices', { method: 'POST' });
    } catch {} finally {
      setStoredSessionToken(null);
    }
  },

  async getActiveSessions(): Promise<{
    success: boolean;
    maxSessions: number;
    activeCount: number;
    sessions: ActiveDeviceSession[];
  }> {
    return await request('/api/auth/sessions', { method: 'GET' });
  },

  async revokeSession(sessionId: string): Promise<{
    success: boolean;
    message: string;
    revokedCurrent: boolean;
    maxSessions: number;
    activeCount: number;
    sessions: ActiveDeviceSession[];
  }> {
    return await request(`/api/auth/sessions/${encodeURIComponent(sessionId)}`, {
      method: 'DELETE',
    });
  },

  async getMe(): Promise<{ success: boolean; user: AuthUser }> {
    try {
      const res = await request('/api/auth/me', { method: 'GET' });
      if (res?.user) setStoredAuthUser(res.user);
      return res;
    } catch (err: any) {
      if (err?.status === 401 || err?.status === 403) {
        setStoredSessionToken(null);
        setStoredAuthUser(null);
      }
      throw err;
    }
  },

  // User Profile (strictly server-verified; never fall back to localStorage on 401/403)
  async getProfile(): Promise<{ success: boolean; profile: UserProfileData }> {
    return await request('/api/profile', { method: 'GET' });
  },

  async updateProfile(payload: {
    fullName?: string;
    phone?: string;
    username?: string;
    avatarUrl?: string;
  }): Promise<{ success: boolean; message: string; user: AuthUser }> {
    const data = await request('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    if (data?.user) setStoredAuthUser(data.user);
    return data;
  },

  async completeProfile(payload: {
    fullName: string;
    username?: string;
    phone?: string;
  }): Promise<{ success: boolean; message: string; user: AuthUser }> {
    const data = await request('/api/profile/complete', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data?.user) setStoredAuthUser(data.user);
    return data;
  },

  async getSecurityMethods(): Promise<{ success: boolean; security: SecurityMethodsData }> {
    return request('/api/profile/security-methods', { method: 'GET' });
  },

  async linkGoogleAccount(idToken: string): Promise<{ success: boolean; message: string }> {
    return request('/api/auth/google/link', {
      method: 'POST',
      body: JSON.stringify({ idToken }),
    });
  },

  async unlinkGoogleAccount(): Promise<{ success: boolean; message: string }> {
    return request('/api/auth/google/link', { method: 'DELETE' });
  },

  async deletePasskey(passkeyId: string): Promise<{ success: boolean; message: string }> {
    return request(`/api/auth/passkeys/${encodeURIComponent(passkeyId)}`, { method: 'DELETE' });
  },

  async changePassword(payload: {
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    return await request('/api/profile/change-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async deleteAccount(password: string): Promise<{ success: boolean; message: string }> {
    const data = await request('/api/profile/delete-account', {
      method: 'DELETE',
      body: JSON.stringify({ password }),
    });
    setStoredSessionToken(null);
    return data;
  },

  // Password Recovery (Strictly server-side SMTP + single-use SHA-256 tokens; no insecure client fallback)
  async forgotPassword(email: string): Promise<{ success: boolean; message: string }> {
    return await request('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async verifyResetToken(token: string): Promise<{ valid: boolean; email?: string; name?: string; message?: string }> {
    return await request('/api/auth/verify-reset-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  async resetPassword(payload: {
    token: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    return await request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Admin User Management (Strictly server-verified; never bypass with anon client calls)
  async adminGetUsers(): Promise<{ success: boolean; users: AdminUserListItem[] }> {
    return await request('/api/admin/users', { method: 'GET' });
  },

  async adminUpdateUserStatus(
    userId: string,
    status: 'active' | 'suspended' | 'deactivated'
  ): Promise<{ success: boolean; message: string }> {
    return await request(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  },

  async adminUpdateUserRole(
    userId: string,
    role: 'user' | 'admin'
  ): Promise<{ success: boolean; message: string }> {
    return await request(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
  },

  async adminSetUserPassword(
    userId: string,
    newPassword: string
  ): Promise<{ success: boolean; message: string }> {
    return await request(`/api/admin/users/${encodeURIComponent(userId)}/set-password`, {
      method: 'POST',
      body: JSON.stringify({ newPassword }),
    });
  },

  async adminSendResetEmail(userId: string): Promise<{ success: boolean; message: string }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/send-reset-email`, {
      method: 'POST',
    });
  },

  async adminForcePasswordReset(userId: string): Promise<{ success: boolean; message: string }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/force-password-reset`, {
      method: 'POST',
    });
  },

  async adminRevokeSessions(userId: string): Promise<{ success: boolean; message: string }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
      method: 'POST',
    });
  },

  async adminDeleteUser(userId: string): Promise<{ success: boolean; message: string }> {
    return await request(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  },

  async adminGetAuditLogs(): Promise<{ success: boolean; logs: any[] }> {
    return request('/api/admin/audit-logs', { method: 'GET' });
  },
};
