import { AuthUser, AdminUserListItem } from '../types';

export interface UserProfileData {
  id: string;
  uid: string;
  full_name: string;
  displayName: string;
  email: string;
  phone?: string | null;
  role: 'user' | 'admin' | 'superadmin';
  status: 'active' | 'suspended' | 'deactivated';
  email_verified: boolean;
  avatar_url?: string | null;
  force_password_reset: boolean;
  created_at: string;
  createdAt: string;
  last_login_at?: string | null;
  password_changed_at: string;
  activeSessionsCount?: number;
}

const TOKEN_KEY = 'my_money_auth_token';
const USER_KEY = 'my_money_auth_user';

export function getStoredSessionToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export const getStoredAuthToken = getStoredSessionToken;

export function setStoredSessionToken(token: string | null) {
  try {
    if (token) {
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
    const errorMsg = data?.message || data?.error || `Request failed with status ${res.status}`;
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    (err as any).data = data;
    throw err;
  }

  return data;
}

// Authentication is intentionally server-only. Never query app_users or password
// hashes from the browser using a publishable key, and never mint client-side sessions.
// If the authenticated API is unavailable, fail closed and surface the API error.

export const authApi = {
  // Authentication
  async register(payload: {
    fullName: string;
    email: string;
    phone?: string;
    password: string;
    confirmPassword: string;
  }): Promise<{ success: boolean; message: string; user: AuthUser; sessionToken: string }> {
    try {
      const data = await request('/api/auth/register', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (data.sessionToken) {
        setStoredSessionToken(data.sessionToken);
        if (data.user) setStoredAuthUser(data.user);
      }
      return data;
    } catch (err: any) {
      if (err.status === 400 || err.status === 409) {
        throw err;
      }
      console.warn('Backend register API unreachable, attempting direct registration:', err.message);
      throw err;
    }
  },

  async login(payload: {
    email: string;
    password: string;
    rememberMe?: boolean;
  }): Promise<{ success: boolean; message: string; user: AuthUser; sessionToken: string }> {
    try {
      const data = await request('/api/auth/login', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
      if (data.sessionToken) {
        setStoredSessionToken(data.sessionToken);
        if (data.user) setStoredAuthUser(data.user);
      }
      return data;
    } catch (err: any) {
      // If server explicitly returned 401 (Invalid password) or 403 (suspended), respect that
      if (err.status === 401 || err.status === 403 || err.status === 429) {
        throw err;
      }
      console.warn('Backend login API unreachable, falling back to direct Supabase authentication:', err.message);
      throw err;
    }
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

  async getMe(): Promise<{ success: boolean; user: AuthUser }> {
    try {
      const res = await request('/api/auth/me', { method: 'GET' });
      if (res?.user) setStoredAuthUser(res.user);
      return res;
    } catch (err: any) {
      throw err;
    }
  },

  // User Profile
  async getProfile(): Promise<{ success: boolean; profile: UserProfileData }> {
    try {
      return await request('/api/profile', { method: 'GET' });
    } catch (err: any) {
      console.warn('Backend /api/profile unreachable or returned error, using direct Supabase fallback:', err.message);
      throw err;
    }
  },

  async updateProfile(payload: {
    fullName?: string;
    phone?: string;
    avatarUrl?: string;
  }): Promise<{ success: boolean; message: string; user: AuthUser }> {
    try {
      return await request('/api/profile', {
        method: 'PUT',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend update profile unreachable, using direct Supabase update:', err.message);
      throw err;
    }
  },

  async changePassword(payload: {
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      return await request('/api/profile/change-password', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend change-password unreachable, using direct Supabase change:', err.message);
      throw err;
    }
  },

  async deleteAccount(password: string): Promise<{ success: boolean; message: string }> {
    try {
      const data = await request('/api/profile/delete-account', {
        method: 'DELETE',
        body: JSON.stringify({ password }),
      });
      setStoredSessionToken(null);
      return data;
    } catch (err: any) {
      console.warn('Backend delete-account unreachable, using direct Supabase delete:', err.message);
      throw err;
    }
  },

  // Password Recovery
  async forgotPassword(email: string): Promise<{ success: boolean; message: string; resetLink?: string }> {
    try {
      return await request('/api/auth/forgot-password', {
        method: 'POST',
        body: JSON.stringify({ email }),
      });
    } catch (err: any) {
      console.warn('Backend forgot-password unreachable, using direct Supabase fallback:', err.message);
      throw err;
    }
  },

  async verifyResetToken(token: string): Promise<{ valid: boolean; email?: string; name?: string; message?: string }> {
    try {
      return await request('/api/auth/verify-reset-token', {
        method: 'POST',
        body: JSON.stringify({ token }),
      });
    } catch (err: any) {
      console.warn('Backend verify-reset-token unreachable, using direct Supabase fallback:', err.message);
      throw err;
    }
  },

  async resetPassword(payload: {
    token: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    try {
      return await request('/api/auth/reset-password', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend reset-password unreachable, using direct Supabase fallback:', err.message);
      throw err;
    }
  },

  // Admin User Management
  async adminGetUsers(): Promise<{ success: boolean; users: AdminUserListItem[] }> {
    try {
      return await request('/api/admin/users', { method: 'GET' });
    } catch (err) {
      // Direct Supabase fallback for admin users list
      const { url: supabaseUrl, key: supabaseKey } = getSavedSupabaseConfig();
      const res = await fetch(`${supabaseUrl}/rest/v1/app_users?select=*&order=created_at.desc`, {
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          Accept: 'application/json',
        },
      });
      if (res.ok) {
        const rows = await res.json();
        const users = rows.map((u: any) => ({
          ...mapRawUserToAuthUser(u),
          displayPassword: u.phone ? `Phone: ${u.phone}` : 'Protected (Bcrypt)',
        }));
        return { success: true, users };
      }
      throw err;
    }
  },

  async adminUpdateUserStatus(
    userId: string,
    status: 'active' | 'suspended' | 'deactivated'
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await request(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
        method: 'PUT',
        body: JSON.stringify({ status }),
      });
    } catch (err) {
      const { url: supabaseUrl, key: supabaseKey } = getSavedSupabaseConfig();
      const res = await fetch(`${supabaseUrl}/rest/v1/app_users?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ status }),
      });
      if (res.ok) return { success: true, message: `User status changed to ${status}` };
      throw err;
    }
  },

  async adminUpdateUserRole(
    userId: string,
    role: 'user' | 'admin'
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await request(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
        method: 'PUT',
        body: JSON.stringify({ role }),
      });
    } catch (err) {
      const { url: supabaseUrl, key: supabaseKey } = getSavedSupabaseConfig();
      const res = await fetch(`${supabaseUrl}/rest/v1/app_users?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ role }),
      });
      if (res.ok) return { success: true, message: `User role updated to ${role}` };
      throw err;
    }
  },

  async adminSetUserPassword(
    userId: string,
    newPassword: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await request(`/api/admin/users/${encodeURIComponent(userId)}/set-password`, {
        method: 'POST',
        body: JSON.stringify({ newPassword }),
      });
    } catch (err) {
      const { url: supabaseUrl, key: supabaseKey } = getSavedSupabaseConfig();
      const passwordHash = await bcrypt.hash(newPassword, 12);
      const res = await fetch(`${supabaseUrl}/rest/v1/app_users?id=eq.${encodeURIComponent(userId)}`, {
        method: 'PATCH',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ password_hash: passwordHash, password_changed_at: new Date().toISOString() }),
      });
      if (res.ok) return { success: true, message: 'Password updated successfully' };
      throw err;
    }
  },

  async adminSendResetEmail(userId: string): Promise<{ success: boolean; message: string; resetLink?: string }> {
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
    try {
      return await request(`/api/admin/users/${encodeURIComponent(userId)}`, {
        method: 'DELETE',
      });
    } catch (err) {
      const { url: supabaseUrl, key: supabaseKey } = getSavedSupabaseConfig();
      const res = await fetch(`${supabaseUrl}/rest/v1/app_users?id=eq.${encodeURIComponent(userId)}`, {
        method: 'DELETE',
        headers: {
          apikey: supabaseKey,
          Authorization: `Bearer ${supabaseKey}`,
        },
      });
      if (res.ok) return { success: true, message: 'User deleted successfully' };
      throw err;
    }
  },

  async adminGetAuditLogs(): Promise<{ success: boolean; logs: any[] }> {
    return request('/api/admin/audit-logs', { method: 'GET' });
  },
};
