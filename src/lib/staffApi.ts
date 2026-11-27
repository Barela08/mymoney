/**
 * Dedicated Staff Portal (/mystaff) Frontend API Client
 * Strictly scoped to /api/staff/* endpoints separated from Admin & User portals.
 */
import { getStoredSessionToken } from './authApi';
import type { StaffTaskItem } from '../types';

function getStaffHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const token =
    getStoredSessionToken() ||
    localStorage.getItem('my_money_auth_token') ||
    localStorage.getItem('my_money_session_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function staffRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = getStaffHeaders((options.headers as Record<string, string>) || {});
  const res = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include',
  });
  const text = await res.text();
  let data: any = null;
  try {
    data = JSON.parse(text);
  } catch {
    data = { success: false, message: text || `HTTP error ${res.status}` };
  }
  if (!res.ok) {
    throw new Error(data.message || `Staff request failed (${res.status})`);
  }
  return data;
}

export const staffClient = {
  async getTasks(status?: string): Promise<{
    success: boolean;
    tasks: StaffTaskItem[];
    counts: { total: number; open: number; in_progress: number; completed: number; blocked: number };
  }> {
    const qs = status && status !== 'all' ? `?status=${encodeURIComponent(status)}` : '';
    return staffRequest(`/api/staff/tasks${qs}`, { method: 'GET' });
  },

  async updateTaskStatus(
    taskId: string,
    status: 'open' | 'in_progress' | 'completed' | 'blocked'
  ): Promise<{ success: boolean; message?: string; task: StaffTaskItem }> {
    return staffRequest(`/api/staff/tasks/${encodeURIComponent(taskId)}`, {
      method: 'PATCH',
      body: JSON.stringify({ status }),
    });
  },

  async getNotifications(): Promise<{
    success: boolean;
    notifications: any[];
    unreadCount: number;
  }> {
    return staffRequest('/api/staff/notifications', { method: 'GET' });
  },

  async markNotificationRead(id: string): Promise<{ success: boolean }> {
    return staffRequest(`/api/staff/notifications/${encodeURIComponent(id)}/read`, {
      method: 'POST',
    });
  },

  async markAllNotificationsRead(): Promise<{ success: boolean }> {
    return staffRequest('/api/staff/notifications/read-all', { method: 'POST' });
  },

  async getProfile(): Promise<{ success: boolean; staff: any; portalRole: string }> {
    return staffRequest('/api/staff/profile', { method: 'GET' });
  },
};
