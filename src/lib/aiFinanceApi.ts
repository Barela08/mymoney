import { getStoredAuthToken } from './authApi';
import type {
  AiFinancialContextSnapshot,
  CategorizationSuggestion,
  NetWorthAsset,
  NetWorthLiability,
  NetWorthSettings,
  NetWorthSnapshot,
  ReceiptOcrExtraction,
  SafeToSpendPreferences,
  SmartAlertEventState,
  SmartAlertPreferences,
  UserCategorizationRule,
} from './financialIntelligenceEngine';
import type { TransactionCategory, TransactionSubcategory, TransactionType } from '../types';

export interface AiStatusResponse {
  configured: boolean;
  provider: 'gemini';
  model: string;
  ocrSupported: boolean;
}

export interface AiConversation {
  id: string;
  title: string;
  created_at: string;
  updated_at: string;
  messages: Array<{
    id: string;
    role: 'user' | 'assistant';
    content: string;
    created_at: string;
  }>;
}

export interface ReceiptRecord {
  id: string;
  transaction_id?: string | null;
  file_hash: string;
  merchant: string;
  amount: number;
  receipt_date: string;
  receipt_number?: string;
  payment_method?: string;
  confidence?: number;
  created_at: string;
}

export class ApiClientError extends Error {
  public readonly status: number;
  public readonly code?: string;
  public readonly payload?: any;

  constructor(message: string, status: number, code?: string, payload?: any) {
    super(message);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = code;
    this.payload = payload;
  }
}

async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredAuthToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...(options.headers as Record<string, string>),
  };
  if (token) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(endpoint, { ...options, headers });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new ApiClientError(
      data.message || `Request failed with status ${res.status}`,
      res.status,
      data.code,
      data
    );
  }
  return data;
}

export const aiFinanceApi = {
  async getAiStatus(): Promise<AiStatusResponse> {
    const res = await apiRequest<{ success: boolean; status: AiStatusResponse }>('/api/ai/status');
    return res.status;
  },

  // Feature 1: AI Money Assistant
  async getConversations(): Promise<{ conversations: AiConversation[]; status: AiStatusResponse }> {
    return apiRequest('/api/ai/conversations');
  },

  async createConversation(title?: string): Promise<AiConversation> {
    const res = await apiRequest<{ success: boolean; conversation: AiConversation }>('/api/ai/conversations', {
      method: 'POST',
      body: JSON.stringify({ title }),
    });
    return res.conversation;
  },

  async renameConversation(id: string, title: string): Promise<void> {
    await apiRequest(`/api/ai/conversations/${id}`, {
      method: 'PATCH',
      body: JSON.stringify({ title }),
    });
  },

  async deleteConversation(id: string): Promise<void> {
    await apiRequest(`/api/ai/conversations/${id}`, { method: 'DELETE' });
  },

  async clearAllConversations(): Promise<void> {
    await apiRequest('/api/ai/conversations', { method: 'DELETE' });
  },

  async sendAssistantMessage(params: {
    conversationId?: string;
    question: string;
    financialContext: AiFinancialContextSnapshot;
  }): Promise<{
    conversationId: string;
    conversationTitle: string;
    userMessage: { id: string; role: 'user'; content: string; created_at: string };
    assistantMessage: { id: string; role: 'assistant'; content: string; created_at: string };
    model: string;
  }> {
    return apiRequest('/api/ai/assistant/chat', {
      method: 'POST',
      body: JSON.stringify(params),
    });
  },

  // Feature 2: Smart Categorization
  async getCategorizationRules(): Promise<UserCategorizationRule[]> {
    const res = await apiRequest<{ success: boolean; rules: UserCategorizationRule[] }>('/api/ai/categorization/rules');
    return res.rules || [];
  },

  async saveCategorizationRule(payload: {
    merchant_pattern: string;
    category: TransactionCategory;
    subcategory: TransactionSubcategory;
    transaction_type: TransactionType;
  }): Promise<UserCategorizationRule[]> {
    const res = await apiRequest<{ success: boolean; rules: UserCategorizationRule[] }>('/api/ai/categorization/rules', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.rules || [];
  },

  async deleteCategorizationRule(id: string): Promise<UserCategorizationRule[]> {
    const res = await apiRequest<{ success: boolean; rules: UserCategorizationRule[] }>(`/api/ai/categorization/rules/${id}`, {
      method: 'DELETE',
    });
    return res.rules || [];
  },

  async predictCategory(payload: {
    title?: string;
    description?: string;
    merchant?: string;
    notes?: string;
    amount?: number;
  }): Promise<{ suggestion: CategorizationSuggestion | null }> {
    return apiRequest('/api/ai/categorization/predict', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // Feature 5: Receipt Scanner OCR
  async scanReceiptOcr(imageDataUrl: string): Promise<{
    fileHash: string;
    extraction: ReceiptOcrExtraction;
    categorization: CategorizationSuggestion | null;
  }> {
    return apiRequest('/api/ai/receipt-ocr', {
      method: 'POST',
      body: JSON.stringify({ imageDataUrl }),
    });
  },

  async getReceiptRecords(): Promise<ReceiptRecord[]> {
    const res = await apiRequest<{ success: boolean; receipts: ReceiptRecord[] }>('/api/finance/receipts');
    return res.receipts || [];
  },

  async saveReceiptRecord(payload: {
    transaction_id?: string | null;
    file_hash: string;
    merchant: string;
    amount: number;
    receipt_date: string;
    receipt_number?: string;
    payment_method?: string;
    confidence?: number;
  }): Promise<ReceiptRecord> {
    const res = await apiRequest<{ success: boolean; receipt: ReceiptRecord }>('/api/finance/receipts', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.receipt;
  },

  // Feature 6: Net Worth Tracker
  async getNetWorthData(): Promise<{
    assets: NetWorthAsset[];
    liabilities: NetWorthLiability[];
    snapshots: NetWorthSnapshot[];
    settings: NetWorthSettings;
  }> {
    return apiRequest('/api/finance/net-worth');
  },

  async saveNetWorthAsset(payload: Partial<NetWorthAsset> & { name: string; current_value: number }): Promise<NetWorthAsset[]> {
    const res = await apiRequest<{ success: boolean; assets: NetWorthAsset[] }>('/api/finance/net-worth/assets', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    return res.assets || [];
  },

  async deleteNetWorthAsset(id: string): Promise<NetWorthAsset[]> {
    const res = await apiRequest<{ success: boolean; assets: NetWorthAsset[] }>(`/api/finance/net-worth/assets/${id}`, {
      method: 'DELETE',
    });
    return res.assets || [];
  },

  async saveNetWorthLiability(
    payload: Partial<NetWorthLiability> & { name: string; current_balance: number }
  ): Promise<NetWorthLiability[]> {
    const res = await apiRequest<{ success: boolean; liabilities: NetWorthLiability[] }>(
      '/api/finance/net-worth/liabilities',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return res.liabilities || [];
  },

  async deleteNetWorthLiability(id: string): Promise<NetWorthLiability[]> {
    const res = await apiRequest<{ success: boolean; liabilities: NetWorthLiability[] }>(
      `/api/finance/net-worth/liabilities/${id}`,
      {
        method: 'DELETE',
      }
    );
    return res.liabilities || [];
  },

  async saveNetWorthSnapshot(payload: Omit<NetWorthSnapshot, 'id'>): Promise<NetWorthSnapshot[]> {
    const res = await apiRequest<{ success: boolean; snapshots: NetWorthSnapshot[] }>(
      '/api/finance/net-worth/snapshots',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return res.snapshots || [];
  },

  async saveNetWorthSettings(settings: NetWorthSettings): Promise<NetWorthSettings> {
    const res = await apiRequest<{ success: boolean; settings: NetWorthSettings }>('/api/finance/net-worth/settings', {
      method: 'PUT',
      body: JSON.stringify(settings),
    });
    return res.settings;
  },

  // Feature 7: Safe-to-Spend
  async getSafeToSpendPreferences(): Promise<SafeToSpendPreferences> {
    const res = await apiRequest<{ success: boolean; preferences: SafeToSpendPreferences }>(
      '/api/finance/safe-to-spend/preferences'
    );
    return res.preferences;
  },

  async saveSafeToSpendPreferences(preferences: SafeToSpendPreferences): Promise<SafeToSpendPreferences> {
    const res = await apiRequest<{ success: boolean; preferences: SafeToSpendPreferences }>(
      '/api/finance/safe-to-spend/preferences',
      {
        method: 'PUT',
        body: JSON.stringify(preferences),
      }
    );
    return res.preferences;
  },

  // Feature 4: Smart Alerts
  async getSmartAlertsState(): Promise<{
    preferences: SmartAlertPreferences;
    eventState: SmartAlertEventState;
  }> {
    return apiRequest('/api/finance/smart-alerts/state');
  },

  async saveSmartAlertPreferences(preferences: SmartAlertPreferences): Promise<SmartAlertPreferences> {
    const res = await apiRequest<{ success: boolean; preferences: SmartAlertPreferences }>(
      '/api/finance/smart-alerts/preferences',
      {
        method: 'PUT',
        body: JSON.stringify(preferences),
      }
    );
    return res.preferences;
  },

  async updateSmartAlertEvents(payload: {
    action: 'mark_read' | 'mark_all_read' | 'dismiss' | 'reset_dismissed';
    keys?: string[];
    key?: string;
  }): Promise<SmartAlertEventState> {
    const res = await apiRequest<{ success: boolean; eventState: SmartAlertEventState }>(
      '/api/finance/smart-alerts/events',
      {
        method: 'POST',
        body: JSON.stringify(payload),
      }
    );
    return res.eventState;
  },
};
