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
  try {
    data = await res.json();
  } catch (e) {
    data = { success: false, message: 'Invalid response from server' };
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

export const authApi = {
  // Authentication
  async register(payload: {
    fullName: string;
    email: string;
    phone?: string;
    password: string;
    confirmPassword: string;
  }): Promise<{ success: boolean; message: string; user: AuthUser; sessionToken: string }> {
    const data = await request('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.sessionToken) {
      setStoredSessionToken(data.sessionToken);
    }
    return data;
  },

  async login(payload: {
    email: string;
    password: string;
    rememberMe?: boolean;
  }): Promise<{ success: boolean; message: string; user: AuthUser; sessionToken: string }> {
    const data = await request('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    if (data.sessionToken) {
      setStoredSessionToken(data.sessionToken);
    }
    return data;
  },

  async logout(): Promise<void> {
    try {
      await request('/api/auth/logout', { method: 'POST' });
    } finally {
      setStoredSessionToken(null);
    }
  },

  async logoutAllDevices(): Promise<void> {
    try {
      await request('/api/auth/logout-all-devices', { method: 'POST' });
    } finally {
      setStoredSessionToken(null);
    }
  },

  async getMe(): Promise<{ success: boolean; user: AuthUser }> {
    return request('/api/auth/me', { method: 'GET' });
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
    return request('/api/admin/users', { method: 'GET' });
  },

  async adminUpdateUserStatus(
    userId: string,
    status: 'active' | 'suspended' | 'deactivated'
  ): Promise<{ success: boolean; message: string }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status }),
    });
  },

  async adminUpdateUserRole(
    userId: string,
    role: 'user' | 'admin'
  ): Promise<{ success: boolean; message: string }> {
    return request(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role }),
    });
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
    return request(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
    });
  },

  async adminGetAuditLogs(): Promise<{ success: boolean; logs: any[] }> {
    return request('/api/admin/audit-logs', { method: 'GET' });
  },
};
