import bcrypt from 'bcryptjs';
import { AuthUser, AdminUserListItem } from '../types';
import { getSavedSupabaseConfig } from './supabase';

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

// -----------------------------------------------------------------------------
// Direct Supabase Fallback Authentication Engine
// Used automatically if backend serverless endpoints are offline, 404, or unreachable
// -----------------------------------------------------------------------------
function mapRawUserToAuthUser(u: any): AuthUser {
  const isMasterAdmin = Boolean(u.email && u.email.toLowerCase().trim() === 'admin@mymoney.com');
  const rawRole = (u.role || '').toLowerCase().trim();
  const effectiveRole = isMasterAdmin ? 'superadmin' : (rawRole || 'user');

  return {
    uid: u.id,
    id: u.id,
    email: u.email,
    displayName: u.full_name || u.email?.split('@')[0] || (isMasterAdmin ? 'Security Administrator' : 'User'),
    full_name: u.full_name || (isMasterAdmin ? 'Security Administrator' : undefined),
    role: effectiveRole as any,
    email_verified: Boolean(u.email_verified),
    emailVerified: Boolean(u.email_verified),
    status: (u.status as any) || 'active',
    phone: u.phone || null,
    avatar_url: u.avatar_url || null,
    avatarUrl: u.avatar_url || null,
    createdAt: u.created_at || new Date().toISOString(),
    created_at: u.created_at || new Date().toISOString(),
  };
}

async function directSupabaseLogin(payload: { email: string; password: string; rememberMe?: boolean }) {
  const { url: supabaseUrl, key: supabaseKey } = getSavedSupabaseConfig();
  const normEmail = payload.email.toLowerCase().trim();

  const queryUrl = `${supabaseUrl}/rest/v1/app_users?email=ilike.${encodeURIComponent(normEmail)}&select=*`;
  const res = await fetch(queryUrl, {
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      Accept: 'application/json',
    },
  });

  if (!res.ok) {
    throw new Error('Unable to verify credentials with database.');
  }

  const users = await res.json();
  if (!Array.isArray(users) || users.length === 0) {
    throw new Error('Invalid email or password.');
  }

  const user = users[0];
  if (user.status === 'suspended') {
    throw new Error('Your account has been suspended by an administrator. Please contact support.');
  }
  if (user.status === 'deactivated') {
    throw new Error('This account has been deactivated. Please contact support.');
  }

  // Compare bcrypt password
  const isMatch = await bcrypt.compare(payload.password, user.password_hash);
  if (!isMatch) {
    throw new Error('Invalid email or password.');
  }

  const sessionToken = `direct_${user.id}_${Date.now()}`;
  const authUser = mapRawUserToAuthUser(user);

  setStoredSessionToken(sessionToken);
  setStoredAuthUser(authUser);

  return {
    success: true,
    message: 'Signed in successfully!',
    user: authUser,
    sessionToken,
  };
}

async function directSupabaseRegister(payload: {
  fullName: string;
  email: string;
  phone?: string;
  password: string;
  confirmPassword: string;
}) {
  const { url: supabaseUrl, key: supabaseKey } = getSavedSupabaseConfig();
  const normEmail = payload.email.toLowerCase().trim();

  // 1. Check duplicate email
  const checkRes = await fetch(
    `${supabaseUrl}/rest/v1/app_users?email=ilike.${encodeURIComponent(normEmail)}&select=id`,
    {
      headers: {
        apikey: supabaseKey,
        Authorization: `Bearer ${supabaseKey}`,
        Accept: 'application/json',
      },
    }
  );
  if (checkRes.ok) {
    const existing = await checkRes.json();
    if (Array.isArray(existing) && existing.length > 0) {
      throw new Error('An account with this email address already exists. Please log in.');
    }
  }

  // 2. Hash password
  const passwordHash = await bcrypt.hash(payload.password, 12);

  // 3. Insert user
  const insertRes = await fetch(`${supabaseUrl}/rest/v1/app_users`, {
    method: 'POST',
    headers: {
      apikey: supabaseKey,
      Authorization: `Bearer ${supabaseKey}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    },
    body: JSON.stringify({
      full_name: payload.fullName.trim(),
      email: normEmail,
      phone: payload.phone?.trim() || null,
      password_hash: passwordHash,
      role: 'user',
      status: 'active',
      email_verified: false,
    }),
  });

  if (!insertRes.ok) {
    const errText = await insertRes.text();
    throw new Error(`Failed to create account: ${errText}`);
  }

  const createdUsers = await insertRes.json();
  const newUser = createdUsers[0];
  const sessionToken = `direct_${newUser.id}_${Date.now()}`;
  const authUser = mapRawUserToAuthUser(newUser);

  setStoredSessionToken(sessionToken);
  setStoredAuthUser(authUser);

  return {
    success: true,
    message: 'Account created successfully!',
    user: authUser,
    sessionToken,
  };
}

async function directSupabaseGetMe(): Promise<{ success: boolean; user: AuthUser }> {
  const cachedUser = getStoredAuthUser();
  const token = getStoredSessionToken();

  if (!token) {
    throw new Error('No active session.');
  }

  // If token is direct or we have cached user, verify fresh status from Supabase
  if (cachedUser?.uid) {
    try {
      const { url: supabaseUrl, key: supabaseKey } = getSavedSupabaseConfig();
      const res = await fetch(
        `${supabaseUrl}/rest/v1/app_users?id=eq.${encodeURIComponent(cachedUser.uid)}&select=*`,
        {
          headers: {
            apikey: supabaseKey,
            Authorization: `Bearer ${supabaseKey}`,
            Accept: 'application/json',
          },
        }
      );
      if (res.ok) {
        const rows = await res.json();
        if (Array.isArray(rows) && rows.length > 0) {
          const freshUser = mapRawUserToAuthUser(rows[0]);
          setStoredAuthUser(freshUser);
          return { success: true, user: freshUser };
        }
      }
    } catch {}
    return { success: true, user: cachedUser };
  }

  throw new Error('Session not found');
}

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
      return await directSupabaseRegister(payload);
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
      return await directSupabaseLogin(payload);
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
      return await directSupabaseGetMe();
    }
  },

  // User Profile
  async getProfile(): Promise<{ success: boolean; profile: UserProfileData }> {
    return request('/api/profile', { method: 'GET' });
  },

  async updateProfile(payload: {
    fullName?: string;
    phone?: string;
    avatarUrl?: string;
  }): Promise<{ success: boolean; message: string; user: AuthUser }> {
    return request('/api/profile', {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async changePassword(payload: {
    currentPassword: string;
    newPassword: string;
    confirmNewPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    return request('/api/profile/change-password', {
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

  // Password Recovery
  async forgotPassword(email: string): Promise<{ success: boolean; message: string; resetLink?: string }> {
    return request('/api/auth/forgot-password', {
      method: 'POST',
      body: JSON.stringify({ email }),
    });
  },

  async verifyResetToken(token: string): Promise<{ valid: boolean; email?: string; name?: string; message?: string }> {
    return request('/api/auth/verify-reset-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  async resetPassword(payload: {
    token: string;
    newPassword: string;
    confirmPassword: string;
  }): Promise<{ success: boolean; message: string }> {
    return request('/api/auth/reset-password', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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
