/**
 * Admin Control Center Frontend API Client
 * Securely communicates with /api/admin/* endpoints using session tokens & cookies
 */
import { authApi, getStoredSessionToken } from './authApi';

function getHeaders(customHeaders: Record<string, string> = {}): Record<string, string> {
  const token = getStoredSessionToken() || localStorage.getItem('my_money_auth_token') || localStorage.getItem('my_money_session_token');
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
    const isHtml = text.trim().startsWith('<');
    data = {
      success: false,
      message: isHtml ? `Server offline (${res.status}). Using direct database fallback.` : (text || `HTTP error ${res.status}`),
    };
  }

  if (!res.ok) {
    throw new Error(data.message || `Request failed with status ${res.status}`);
  }
  return data;
}

export const adminClient = {
  // 1. Dashboard
  async getDashboardStats() {
    try {
      return await adminRequest('/api/admin/dashboard-stats', { method: 'GET' });
    } catch (err: any) {
      console.warn('Backend admin stats API unreachable, returning default stats:', err.message);
      return {
        success: true,
        stats: {
          totalUsers: 1,
          activeUsers: 1,
          newUsersToday: 0,
          pendingDeletions: 0,
          openTickets: 0,
          pendingFeedbacks: 0,
          securityIncidents: 0,
          systemStatus: 'healthy',
        },
      };
    }
  },

  // 2. Users & Profile
  async getUsers(query?: string, status?: string) {
    try {
      const params = new URLSearchParams();
      if (query) params.append('q', query);
      if (status && status !== 'all') params.append('status', status);
      return await adminRequest(`/api/admin/users?${params.toString()}`, { method: 'GET' });
    } catch (err: any) {
      console.warn('Backend admin users API unreachable, fetching directly via Supabase:', err.message);
      const res = await authApi.adminGetUsers();
      return { success: true, users: (res.users || []).map((u: any) => ({ ...u, status: u.status || 'active' })) };
    }
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

  async createEmailTemplate(data: {
    name: string;
    slug?: string;
    category?: string;
    subject: string;
    html_content: string;
    text_content?: string;
    variables?: string[];
    is_active?: boolean;
  }) {
    return adminRequest('/api/admin/emails/templates', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async updateEmailTemplate(id: string, data: any) {
    return adminRequest(`/api/admin/emails/templates/${encodeURIComponent(id)}`, {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async resetEmailTemplate(id: string) {
    return adminRequest(`/api/admin/emails/templates/${encodeURIComponent(id)}/reset`, {
      method: 'POST',
    });
  },

  async deleteEmailTemplate(id: string) {
    return adminRequest(`/api/admin/emails/templates/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async previewEmailTemplate(
    id: string,
    data?: { subject?: string; html_content?: string; text_content?: string; variables?: Record<string, string> }
  ) {
    return adminRequest(`/api/admin/emails/templates/${encodeURIComponent(id)}/preview`, {
      method: 'POST',
      body: JSON.stringify(data || {}),
    });
  },

  async sendEmailTemplate(
    id: string,
    data: {
      targetMode: 'custom_email' | 'selected_users' | 'all_active_users';
      emails?: string;
      userIds?: string[];
      variables?: Record<string, string>;
      alsoNotifyInAppAndPush?: boolean;
    }
  ) {
    return adminRequest(`/api/admin/emails/templates/${encodeURIComponent(id)}/send`, {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async sendTestEmail(data: { recipient?: string; subject?: string; html_content?: string; text_content?: string }) {
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
  async getAuditLogs(params?: { q?: string; event_type?: string; role?: string; limit?: number; offset?: number }) {
    const searchParams = new URLSearchParams();
    if (params?.q) searchParams.append('q', params.q);
    if (params?.event_type && params.event_type !== 'all') searchParams.append('event_type', params.event_type);
    if (params?.role && params.role !== 'all') searchParams.append('role', params.role);
    if (params?.limit) searchParams.append('limit', params.limit.toString());
    if (params?.offset) searchParams.append('offset', params.offset.toString());
    const qs = searchParams.toString();
    return adminRequest(`/api/admin/audit-logs${qs ? '?' + qs : ''}`, { method: 'GET' });
  },

  async getAnalytics(range: string = '30d') {
    return adminRequest(`/api/admin/analytics?range=${encodeURIComponent(range)}`, { method: 'GET' });
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

  async getNotifications() {
    return adminRequest('/api/admin/notifications', { method: 'GET' });
  },

  async deleteNotification(id: string) {
    return adminRequest(`/api/admin/notifications/${encodeURIComponent(id)}`, { method: 'DELETE' });
  },

  async broadcastNotification(data: { title: string; message: string; type?: string; target_user_id?: string }) {
    return adminRequest('/api/admin/notifications', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getCampaigns() {
    return adminRequest('/api/admin/notifications/campaigns', { method: 'GET' });
  },

  async createCampaign(data: {
    title: string;
    message: string;
    category?: string;
    type?: string;
    channels?: string[];
    target_type?: string;
    target_user_ids?: string[];
    deep_link?: string;
    scheduled_for?: string | null;
  }) {
    return adminRequest('/api/admin/notifications/campaigns', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async cancelCampaign(id: string) {
    return adminRequest(`/api/admin/notifications/campaigns/${encodeURIComponent(id)}/cancel`, {
      method: 'POST',
    });
  },

  async retryCampaign(id: string) {
    return adminRequest(`/api/admin/notifications/campaigns/${encodeURIComponent(id)}/retry`, {
      method: 'POST',
    });
  },

  async getNotificationAnalytics() {
    return adminRequest('/api/admin/notifications/analytics', { method: 'GET' });
  },

  // 10b. Installed Devices & PWA Installation Management
  async getInstalledDevices(params?: {
    q?: string;
    installed_only?: boolean;
    device_type?: string;
    push_permission?: string;
  }) {
    const qs = new URLSearchParams();
    if (params?.q) qs.append('q', params.q);
    if (params?.installed_only) qs.append('installed_only', 'true');
    if (params?.device_type) qs.append('device_type', params.device_type);
    if (params?.push_permission) qs.append('push_permission', params.push_permission);
    return adminRequest(`/api/admin/installed-devices?${qs.toString()}`, { method: 'GET' });
  },

  async sendTestNotification(data: { title: string; message: string; deep_link?: string }) {
    return adminRequest('/api/admin/notifications/test', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // 10c. Two-Way Admin Notifications & Preferences
  async getAdminNotificationPreferences() {
    return adminRequest('/api/admin/settings/notification-preferences', { method: 'GET' });
  },

  async saveAdminNotificationPreferences(data: any) {
    return adminRequest('/api/admin/settings/notification-preferences', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async getAdminNotifications(params?: {
    category?: string;
    priority?: string;
    unreadOnly?: boolean;
    q?: string;
    limit?: number;
  }) {
    const qs = new URLSearchParams();
    if (params?.category && params.category !== 'all') qs.append('category', params.category);
    if (params?.priority && params.priority !== 'all') qs.append('priority', params.priority);
    if (params?.unreadOnly) qs.append('unreadOnly', 'true');
    if (params?.q) qs.append('q', params.q);
    if (params?.limit) qs.append('limit', String(params.limit));
    const queryStr = qs.toString();
    const res = await adminRequest(`/api/admin/system/notifications${queryStr ? `?${queryStr}` : ''}`, {
      method: 'GET',
    });
    const all: any[] = Array.isArray(res?.notifications) ? res.notifications : [];
    let filtered = all;
    if (params?.category && params.category !== 'all') {
      filtered = filtered.filter((n) => (n.category || '').toLowerCase() === params.category?.toLowerCase());
    }
    if (params?.priority && params.priority !== 'all') {
      filtered = filtered.filter((n) => (n.priority || 'normal').toLowerCase() === params.priority?.toLowerCase());
    }
    if (params?.unreadOnly) {
      filtered = filtered.filter((n) => !n.is_read);
    }
    if (params?.q) {
      const ql = params.q.toLowerCase();
      filtered = filtered.filter((n) =>
        `${n.title || ''} ${n.message || ''} ${n.user_email || ''} ${n.user_name || ''} ${n.event_type || ''}`
          .toLowerCase()
          .includes(ql)
      );
    }
    const countsByCategory: Record<string, number> = res?.countsByCategory || {};
    if (!res?.countsByCategory) {
      for (const n of all) {
        if (!n.is_read) {
          const cat = n.category || 'general';
          countsByCategory[cat] = (countsByCategory[cat] || 0) + 1;
        }
      }
    }
    return {
      ...res,
      notifications: filtered,
      unreadCount: res?.unreadCount ?? all.filter((n) => !n.is_read).length,
      countsByCategory,
    };
  },

  async getPushSubscriptions() {
    return adminRequest('/api/notifications/push/subscriptions', { method: 'GET' });
  },

  async deletePushSubscription(id: string) {
    return adminRequest(`/api/notifications/push/subscriptions/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  async markAdminNotificationRead(id: string) {
    return adminRequest(`/api/admin/system/notifications/${encodeURIComponent(id)}/read`, { method: 'POST' });
  },

  async markAllAdminNotificationsRead() {
    return adminRequest('/api/admin/system/notifications/mark-all-read', { method: 'POST' });
  },

  // 11. Sensitive Financial Data Access Workflow (PART F)
  async getFinancialAccessRequests(status?: string, targetUserId?: string) {
    const params = new URLSearchParams();
    if (status && status !== 'all') params.append('status', status);
    if (targetUserId) params.append('targetUserId', targetUserId);
    return adminRequest(`/api/admin/financial-access/requests?${params.toString()}`, { method: 'GET' });
  },

  async requestFinancialAccess(data: {
    targetUserId: string;
    reason: string;
    purpose?: string;
    dataScopes?: string[];
    durationMinutes?: number;
  }) {
    return adminRequest('/api/admin/financial-access/requests', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async approveFinancialAccess(id: string) {
    return adminRequest(`/api/admin/financial-access/requests/${encodeURIComponent(id)}/approve`, {
      method: 'POST',
    });
  },

  async rejectFinancialAccess(id: string, reason?: string) {
    return adminRequest(`/api/admin/financial-access/requests/${encodeURIComponent(id)}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async revokeFinancialAccess(id: string, reason?: string) {
    return adminRequest(`/api/admin/financial-access/requests/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async getUserFinancialData(userId: string) {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/financial-data`, {
      method: 'GET',
    });
  },

  async exportUserFinancialData(userId: string) {
    return adminRequest(`/api/admin/users/${encodeURIComponent(userId)}/financial-data/export`, {
      method: 'POST',
    });
  },

  async getFinancialAccessLogs() {
    return adminRequest('/api/admin/financial-access/logs', { method: 'GET' });
  },

  // 12. Multi-Admin Accounts (PART C & E)
  async getAdmins() {
    return adminRequest('/api/admin/admins', { method: 'GET' });
  },

  async assignAdmin(data: { email: string; role: string; customPermissions?: string[] }) {
    return adminRequest('/api/admin/admins', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async revokeAdmin(id: string) {
    return adminRequest(`/api/admin/admins/${encodeURIComponent(id)}/revoke`, {
      method: 'POST',
    });
  },

  // 13. Custom Roles (PART C)
  async createAdminRole(data: { name: string; slug: string; description: string; permissions: string[] }) {
    return adminRequest('/api/admin/roles', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  async deleteAdminRole(id: string) {
    return adminRequest(`/api/admin/roles/${encodeURIComponent(id)}`, {
      method: 'DELETE',
    });
  },

  // 14. Transaction Monitoring (PART H)
  async getTransactionMonitoring() {
    return adminRequest('/api/admin/transactions/monitoring', { method: 'GET' });
  },

  // 15. AI Management (PART J)
  async getAiStatus() {
    return adminRequest('/api/admin/ai/status', { method: 'GET' });
  },

  // 16. App Settings (PART P)
  async getAppSettings() {
    return adminRequest('/api/admin/settings', { method: 'GET' });
  },

  async updateAppSettings(data: any) {
    return adminRequest('/api/admin/settings', {
      method: 'POST',
      body: JSON.stringify(data),
    });
  },

  // 16b. Server-Side API & Service Integrations Configuration (Non-Secret)
  async getIntegrationsConfig() {
    return adminRequest('/api/admin/integrations-config', { method: 'GET' });
  },

  async updateIntegrationsConfig(data: {
    aiModel?: string;
    aiEnabled?: boolean;
    senderName?: string;
    siteUrl?: string;
    supportEmail?: string;
    supportPhone?: string;
  }) {
    return adminRequest('/api/admin/integrations-config', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  // 16c. Dedicated Maintenance, App Download Popup & Encrypted API Key Settings
  async getMaintenanceSettings() {
    return adminRequest('/api/admin/maintenance', { method: 'GET' });
  },

  async saveMaintenanceSettings(data: {
    isEnabled: boolean;
    title: string;
    message: string;
    expectedRestoration?: string;
  }) {
    return adminRequest('/api/admin/maintenance', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async getAppPopupSettings() {
    return adminRequest('/api/admin/app-popup', { method: 'GET' });
  },

  async saveAppPopupSettings(data: {
    enabled: boolean;
    downloadUrl: string;
    title: string;
    description: string;
    buttonLabel?: string;
  }) {
    return adminRequest('/api/admin/app-popup', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async getApiSettings(): Promise<{ success: boolean; apiSettings: AdminApiSettings }> {
    return adminRequest('/api/admin/api-settings', { method: 'GET' });
  },

  async saveApiSettings(data: {
    apiKey?: string;
    verifyKey?: boolean;
    aiModel?: string;
    aiEnabled?: boolean;
  }): Promise<{
    success: boolean;
    message?: string;
    validation?: { valid: boolean; message: string; checkedAt: string } | null;
    apiSettings?: AdminApiSettings;
  }> {
    return adminRequest('/api/admin/api-settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async testApiKey(apiKey?: string): Promise<{
    success: boolean;
    validation?: { valid: boolean; message: string; checkedAt: string };
    apiSettings?: AdminApiSettings;
  }> {
    return adminRequest('/api/admin/api-settings/test', {
      method: 'POST',
      body: JSON.stringify(apiKey ? { apiKey } : {}),
    });
  },

  async deleteApiKey(): Promise<{
    success: boolean;
    message?: string;
    apiSettings?: AdminApiSettings;
  }> {
    return adminRequest('/api/admin/api-settings/key', { method: 'DELETE' });
  },

  async getSmtpSettings(): Promise<{ success: boolean; smtpSettings: AdminSmtpSettings }> {
    return adminRequest('/api/admin/smtp-settings', { method: 'GET' });
  },

  async saveSmtpSettings(data: {
    host?: string;
    port?: number;
    secure?: boolean;
    user?: string;
    pass?: string;
    fromEmail?: string;
    fromName?: string;
    enabled?: boolean;
    verifyAndSendTest?: boolean;
    testRecipient?: string;
  }): Promise<{
    success: boolean;
    message?: string;
    smtpSettings?: AdminSmtpSettings;
    testResult?: { success: boolean; error?: string; messageId?: string } | null;
  }> {
    return adminRequest('/api/admin/smtp-settings', {
      method: 'PUT',
      body: JSON.stringify(data),
    });
  },

  async testSmtpSettings(to?: string): Promise<{
    success: boolean;
    message?: string;
    result?: { success: boolean; error?: string; messageId?: string };
  }> {
    return adminRequest('/api/admin/smtp-settings/test', {
      method: 'POST',
      body: JSON.stringify(to ? { to } : {}),
    });
  },

  async deleteSmtpPassword(): Promise<{
    success: boolean;
    message?: string;
    smtpSettings?: AdminSmtpSettings;
  }> {
    return adminRequest('/api/admin/smtp-settings/password', { method: 'DELETE' });
  },

  // 17. Database Diagnostics (PART N)
  async getDatabaseDiagnostics() {
    return adminRequest('/api/admin/system/database', { method: 'GET' });
  },
};

export interface AdminApiSettings {
  configured: boolean;
  hasSavedKey: boolean;
  maskedApiKey: string;
  source: 'admin_settings' | 'env' | 'none';
  updatedAt: string | null;
  updatedBy: string | null;
  lastValidation: {
    valid: boolean;
    message: string;
    checkedAt: string;
  } | null;
  aiModel?: string;
  aiEnabled?: boolean;
  allowedAiModels?: string[];
}

export interface AdminSmtpSettings {
  configured: boolean;
  enabled: boolean;
  hasSavedPassword: boolean;
  maskedPassword: string;
  host: string;
  port: number;
  secure: boolean;
  user: string;
  fromEmail: string;
  fromName: string;
  source: 'admin_settings' | 'env' | 'none';
  updatedAt: string | null;
  updatedBy: string | null;
}
