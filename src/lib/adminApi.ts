/**
 * Admin Control Center Frontend API Client
 * Securely communicates with /api/admin/* endpoints using session tokens & cookies
 */
import { authApi } from './authApi';

function getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const token = localStorage.getItem('my_money_session_token');
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...customHeaders,
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }
  return headers;
}

async function adminRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const headers = getHeaders((options.headers as Record<string, string>) || {});
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
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }
  return data;
}

export const adminClient = {
  // 1. Dashboard
  async getDashboardStats() {
    return adminRequest('/api/admin/dashboard-stats', { method: 'GET' });
  },

  // 2. Users & Profile
  async getUsers(query?: string, status?: string) {
    const params = new URLSearchParams();
    if (query) params.append('q', query);
    if (status && status !== 'all') params.append('status', status);
    return adminRequest(`/api/admin/users?${params.toString()}`, { method: 'GET' });
  },

  async getUserActivity(userId: string) {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/activity`, { method: 'GET' });
  },

  async getUserSessions(userId: string) {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/sessions`, { method: 'GET' });
  },

  async updateUserStatus(userId: string, status: 'active' | 'suspended' | 'deactivated', reason?: string) {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/status`, {
      method: 'PUT',
      body: JSON.stringify({ status, reason }),
    });
  },

  async updateUserRole(userId: string, role: string, reason?: string) {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/role`, {
      method: 'PUT',
      body: JSON.stringify({ role, reason }),
    });
  },

  async sendPasswordResetEmail(userId: string) {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/send-reset-email`, {
      method: 'POST',
    });
  },

  async forcePasswordReset(userId: string) {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/force-password-reset`, {
      method: 'POST',
    });
  },

  async revokeUserSessions(userId: string) {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/revoke-sessions`, {
      method: 'POST',
    });
  },

  async deleteUser(userId: string, reason?: string) {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}`, {
      method: 'DELETE',
      body: JSON.stringify({ reason }),
    });
  },

  // 3. Security Center
  async getSecurityIncidents(status?: string, severity?: string) {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.append('status', status);
    if (severity && severity !== 'all') params.append('severity', severity);
    return adminRequest(`/api/admin/security/incidents?${params.toString()}`, { method: 'GET' });
  },

  async createSecurityIncident(data: { title: string; severity: string; description: string; userEmail?: string }) {
    return adminRequest('/api/admin/security/incidents', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateSecurityIncident(id: string, data: { status?: string; internal_notes?: string; assigned_to?: string }) {
    return adminRequest(`/api/admin/security/incidents/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async getLoginAttempts() {
    return adminRequest('/api/admin/security/login-attempts', { method: 'GET' });
  },

  async getActiveSessions() {
    return adminRequest('/api/admin/security/sessions', { method: 'GET' });
  },

  async revokeSingleSession(sessionId: string) {
    return adminRequest(`/api/admin/security/sessions/${encodeURIComponent(sessionId)}/revoke`, {
      method: 'POST',
    });
  },

  // 4. Account Lifecycle & Deletions
  async getAccountDeletions() {
    return adminRequest('/api/admin/deletions', { method: 'GET' });
  },

  async cancelAccountDeletion(id: string) {
    return adminRequest(`/api/admin/deletions/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
  },

  // 5. Email Management & Templates
  async getEmailLogs(status?: string) {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.append('status', status);
    return adminRequest(`/api/admin/emails/logs?${params.toString()}`, { method: 'GET' });
  },

  async retryEmail(id: string) {
    return adminRequest(`/api/admin/emails/retry/${encodeURIComponent(id)}`, { method: 'POST' });
  },

  async getEmailTemplates() {
    return adminRequest('/api/admin/emails/templates', { method: 'GET' });
  },

  async updateEmailTemplate(id: string, data: any) {
    return adminRequest(`/api/admin/emails/templates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async sendTestEmail(data: { recipient?: string; subject?: string; html_content?: string }) {
    return adminRequest('/api/admin/emails/test', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // 6. Support Tickets
  async getSupportTickets(category?: string, status?: string, priority?: string) {
    const params = new URLSearchParams();
    if (category && category !== 'all') params.append('category', category);
    if (status && status !== 'all') params.append('status', status);
    if (priority && priority !== 'all') params.append('priority', priority);
    return adminRequest(`/api/admin/support/tickets?${params.toString()}`, { method: 'GET' });
  },

  async getTicketDetails(id: string) {
    return adminRequest(`/api/admin/support/tickets/${encodeURIComponent(id)}`, { method: 'GET' });
  },

  async replySupportTicket(id: string, message: string, isInternal: boolean = false) {
    return adminRequest(`/api/admin/support/tickets/${encodeURIComponent(id)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message, is_internal: isInternal }),
    });
  },

  async updateSupportTicket(id: string, data: { status?: string; priority?: string; assigned_to?: string; internal_notes?: string }) {
    return adminRequest(`/api/admin/support/tickets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // 7. Legal & Compliance
  async getLegalPolicies() {
    return adminRequest('/api/admin/legal/policies', { method: 'GET' });
  },

  async getPolicyVersions(id: string) {
    return adminRequest(`/api/admin/legal/policies/${encodeURIComponent(id)}/versions`, { method: 'GET' });
  },

  async updateLegalPolicy(id: string, data: { title?: string; version?: string; content?: string; status?: string }) {
    return adminRequest(`/api/admin/legal/policies/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // 8. System Health & Backups
  async getSystemHealth() {
    return adminRequest('/api/admin/system/health', { method: 'GET' });
  },

  async getSystemBackups() {
    return adminRequest('/api/admin/system/backups', { method: 'GET' });
  },

  async triggerSystemBackup(type: string = 'manual') {
    return adminRequest('/api/admin/system/backups/trigger', {
      method: 'POST',
      body: JSON.stringify({ backup_type: type }),
    });
  },

  // 9. Administration & RBAC
  async getAuditLogs() {
    return adminRequest('/api/admin/audit-logs', { method: 'GET' });
  },

  async getAdminRoles() {
    return adminRequest('/api/admin/roles', { method: 'GET' });
  },

  async updateAdminRole(id: string, data: { permissions?: string[]; description?: string }) {
    return adminRequest(`/api/admin/roles/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async getFeatureFlags() {
    return adminRequest('/api/admin/features', { method: 'GET' });
  },

  async updateFeatureFlag(id: string, data: { is_enabled?: boolean; rollout_percentage?: number }) {
    return adminRequest(`/api/admin/features/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // 10. Global Search & Alerts
  async globalSearch(q: string) {
    return adminRequest(`/api/admin/search?q=${encodeURIComponent(q)}`, { method: 'GET' });
  },

  async getAdminAlerts() {
    return adminRequest('/api/admin/alerts', { method: 'GET' });
  },

  async acknowledgeAlert(id: string) {
    return adminRequest(`/api/admin/alerts/${encodeURIComponent(id)}/ack`, { method: 'PUT' });
  },

  async broadcastNotification(data: { title: string; message: string; type?: string; target_user_id?: string }) {
    return adminRequest('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },
};
