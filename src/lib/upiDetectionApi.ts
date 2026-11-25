/**
 * Client API & Offline Retry Queue for Automatic UPI Payment Detection
 * Product: My Money Manager by HackifyPro
 */

import type {
  DetectedTransaction,
  ExpenseDetectionSettings,
  RawNotificationInput,
  UpiExpenseCategoryId,
} from './upiDetectionEngine';

const SESSION_TOKEN_KEY = 'mmm_session_token';
const OFFLINE_QUEUE_PREFIX = 'mmm_upi_offline_queue_v1_';

function getAuthHeaders(): Record<string, string> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
  };
  if (typeof window !== 'undefined') {
    const token = localStorage.getItem(SESSION_TOKEN_KEY);
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }
  }
  return headers;
}

async function requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(url, {
    ...init,
    credentials: 'include',
    headers: {
      ...getAuthHeaders(),
      ...(init.headers || {}),
    },
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.message || `Request failed (${res.status})`);
  }
  return data as T;
}

export interface IngestNotificationResponse {
  success: boolean;
  accepted: boolean;
  deduplicated?: boolean;
  matchReason?: string | null;
  shouldShowPopup: boolean;
  rejectionReason?: string | null;
  reason?: string;
  transaction?: DetectedTransaction | null;
}

export interface PendingDetectionsResponse {
  success: boolean;
  pending: DetectedTransaction[];
  categorized: DetectedTransaction[];
  dismissed: DetectedTransaction[];
  counts: {
    pending: number;
    categorized: number;
    dismissed: number;
    total: number;
  };
}

export const upiDetectionApi = {
  async getSettings(): Promise<ExpenseDetectionSettings> {
    const res = await requestJson<{ success: boolean; settings: ExpenseDetectionSettings }>(
      '/api/upi-detection/settings',
      { method: 'GET' }
    );
    return res.settings;
  },

  async updateSettings(
    patch: Partial<ExpenseDetectionSettings>
  ): Promise<ExpenseDetectionSettings> {
    const res = await requestJson<{ success: boolean; settings: ExpenseDetectionSettings }>(
      '/api/upi-detection/settings',
      {
        method: 'PUT',
        body: JSON.stringify(patch),
      }
    );
    return res.settings;
  },

  async ingestNotification(input: RawNotificationInput): Promise<IngestNotificationResponse> {
    return requestJson<IngestNotificationResponse>('/api/upi-detection/ingest', {
      method: 'POST',
      body: JSON.stringify(input),
    });
  },

  async listPending(): Promise<PendingDetectionsResponse> {
    return requestJson<PendingDetectionsResponse>('/api/upi-detection/pending', {
      method: 'GET',
    });
  },

  async categorize(
    id: string,
    payload: {
      category: UpiExpenseCategoryId;
      description?: string;
      linkedExpenseId?: string;
    }
  ): Promise<{ success: boolean; alreadyCategorized: boolean; transaction: DetectedTransaction }> {
    return requestJson(`/api/upi-detection/${encodeURIComponent(id)}/categorize`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async dismiss(id: string): Promise<{ success: boolean; transaction: DetectedTransaction }> {
    return requestJson(`/api/upi-detection/${encodeURIComponent(id)}/dismiss`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async remindLater(id: string): Promise<{ success: boolean; transaction: DetectedTransaction }> {
    return requestJson(`/api/upi-detection/${encodeURIComponent(id)}/remind-later`, {
      method: 'POST',
      body: JSON.stringify({}),
    });
  },

  async editDetected(
    id: string,
    payload: { category?: UpiExpenseCategoryId; description?: string }
  ): Promise<{ success: boolean; transaction: DetectedTransaction }> {
    return requestJson(`/api/upi-detection/${encodeURIComponent(id)}/edit`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async resetConfiguration(clearHistory = true): Promise<{
    success: boolean;
    settings: ExpenseDetectionSettings;
    historyCleared: boolean;
  }> {
    return requestJson('/api/upi-detection/reset', {
      method: 'DELETE',
      body: JSON.stringify({ clearHistory }),
    });
  },
};

// ============================================================================
// OFFLINE RETRY QUEUE HELPERS (Per-User Scoped)
// ============================================================================

export interface OfflineQueuedNotification {
  queueId: string;
  input: RawNotificationInput;
  queuedAt: string;
  attempts: number;
}

export function loadOfflineNotificationQueue(userId: string): OfflineQueuedNotification[] {
  if (typeof window === 'undefined' || !userId) return [];
  try {
    const raw = localStorage.getItem(`${OFFLINE_QUEUE_PREFIX}${userId}`);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export function saveOfflineNotificationQueue(
  userId: string,
  queue: OfflineQueuedNotification[]
): void {
  if (typeof window === 'undefined' || !userId) return;
  try {
    localStorage.setItem(`${OFFLINE_QUEUE_PREFIX}${userId}`, JSON.stringify(queue.slice(0, 100)));
  } catch {
    // storage quota fallback
  }
}

export function enqueueOfflineNotification(
  userId: string,
  input: RawNotificationInput
): OfflineQueuedNotification[] {
  const existing = loadOfflineNotificationQueue(userId);
  const next: OfflineQueuedNotification[] = [
    ...existing,
    {
      queueId: `q_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 7)}`,
      input,
      queuedAt: new Date().toISOString(),
      attempts: 0,
    },
  ];
  saveOfflineNotificationQueue(userId, next);
  return next;
}
