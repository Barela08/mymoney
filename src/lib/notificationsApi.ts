/**
 * My Money Manager — Notifications API Client
 * Secure communication with backend notification & push services
 */

export interface UserNotification {
  id: string;
  user_id: string;
  title: string;
  message: string;
  category:
    | 'general'
    | 'income'
    | 'expense'
    | 'udhar'
    | 'repay'
    | 'settlement'
    | 'feedback'
    | 'complaint'
    | 'support'
    | 'announcement'
    | 'offer'
    | 'security'
    | 'system';
  type: 'info' | 'success' | 'warning' | 'error' | 'announcement' | 'offer' | 'reminder';
  related_entity_type?: string;
  related_entity_id?: string;
  deep_link?: string;
  is_read: boolean;
  read_at?: string;
  metadata?: Record<string, any>;
  created_at: string;
}

export interface NotificationPreferences {
  in_app_enabled: boolean;
  push_enabled: boolean;
  email_enabled: boolean;
  notify_income: boolean;
  notify_expense: boolean;
  notify_udhar: boolean;
  notify_support: boolean;
  notify_announcements: boolean;
  notify_offers: boolean;
  quiet_hours_enabled: boolean;
  quiet_hours_start: string;
  quiet_hours_end: string;
  privacy_hide_amounts: boolean;
}

export interface NotificationsListResponse {
  success: boolean;
  notifications: UserNotification[];
  unreadCount: number;
  total: number;
  page: number;
  totalPages: number;
}

export const notificationsApi = {
  /**
   * Fetch paginated user notifications
   */
  async getNotifications(params?: {
    page?: number;
    limit?: number;
    category?: string;
    unread_only?: boolean;
  }): Promise<NotificationsListResponse> {
    const searchParams = new URLSearchParams();
    if (params?.page) searchParams.set('page', String(params.page));
    if (params?.limit) searchParams.set('limit', String(params.limit));
    if (params?.category && params.category !== 'all') searchParams.set('category', params.category);
    if (params?.unread_only) searchParams.set('unread_only', 'true');

    const res = await fetch(`/api/notifications?${searchParams.toString()}`, {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });

    if (!res.ok) {
      throw new Error(`Failed to fetch notifications: HTTP ${res.status}`);
    }
    return res.json();
  },

  /**
   * Mark a single notification as read
   */
  async markAsRead(id: string): Promise<UserNotification> {
    const res = await fetch(`/api/notifications/${id}/read`, {
      method: 'PATCH',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to mark notification as read');
    const data = await res.json();
    return data.notification;
  },

  /**
   * Mark all unread notifications as read
   */
  async markAllAsRead(): Promise<boolean> {
    const res = await fetch('/api/notifications/mark-all-read', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    return res.ok;
  },

  /**
   * Delete a notification (soft delete)
   */
  async deleteNotification(id: string): Promise<boolean> {
    const res = await fetch(`/api/notifications/${id}`, {
      method: 'DELETE',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    return res.ok;
  },

  /**
   * Clear all user notifications
   */
  async clearAll(): Promise<boolean> {
    const res = await fetch('/api/notifications/clear-all', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    return res.ok;
  },

  /**
   * Fetch user notification preferences
   */
  async getPreferences(): Promise<NotificationPreferences> {
    const res = await fetch('/api/notifications/preferences', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to fetch preferences');
    const data = await res.json();
    return data.preferences;
  },

  /**
   * Update user notification preferences
   */
  async updatePreferences(prefs: Partial<NotificationPreferences>): Promise<NotificationPreferences> {
    const res = await fetch('/api/notifications/preferences', {
      method: 'PUT',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(prefs),
    });
    if (!res.ok) throw new Error('Failed to update preferences');
    const data = await res.json();
    return data.preferences;
  },

  /**
   * Get server VAPID public key
   */
  async getVapidPublicKey(): Promise<string> {
    const res = await fetch('/api/notifications/push/vapid-public-key', {
      method: 'GET',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    if (!res.ok) throw new Error('Failed to fetch VAPID key');
    const data = await res.json();
    return data.publicKey;
  },

  /**
   * Register push subscription with server
   */
  async subscribePush(subscription: PushSubscription): Promise<boolean> {
    const subJson = subscription.toJSON();
    const res = await fetch('/api/notifications/push/subscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({
        endpoint: subJson.endpoint,
        keys: subJson.keys,
      }),
    });
    return res.ok;
  },

  /**
   * Unregister push subscription
   */
  async unsubscribePush(endpoint: string): Promise<boolean> {
    const res = await fetch('/api/notifications/push/unsubscribe', {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify({ endpoint }),
    });
    return res.ok;
  },

  /**
   * Dispatch a test push notification
   */
  async sendTestPush(): Promise<boolean> {
    const res = await fetch('/api/notifications/push/test', {
      method: 'POST',
      credentials: 'same-origin',
      headers: { Accept: 'application/json' },
    });
    return res.ok;
  },

  /**
   * Inform backend that a transaction was created to trigger automated in-app/push alert
   */
  async triggerTransactionNotification(tx: {
    id: string;
    title: string;
    amount: number;
    type: string;
    category?: string;
    section?: string;
  }): Promise<void> {
    try {
      await fetch('/api/notifications/events/transaction-created', {
        method: 'POST',
        credentials: 'same-origin',
        headers: {
          'Content-Type': 'application/json',
          Accept: 'application/json',
        },
        body: JSON.stringify(tx),
      });
    } catch {
      // Non-blocking
    }
  },
};
