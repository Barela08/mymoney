import { getStoredSessionToken } from './authApi';

export interface DeletionStatusResponse {
  success: boolean;
  isPending: boolean;
  status: 'none' | 'pending_deletion' | 'executing' | 'cancelled';
  requestId?: string;
  scheduledFor?: string;
  createdAt?: string;
  remainingSeconds?: number;
  reason?: string;
}

export interface UdharContact {
  id: string;
  user_id: string;
  name: string;
  email?: string | null;
  phone?: string | null;
  relationship_type?: string;
  notes?: string | null;
  linked_user_id?: string | null;
  created_at: string;
  updated_at: string;
  linked_user_name?: string | null;
  linked_user_email?: string | null;
  linked_user_avatar?: string | null;
}

export interface SearchUserResult {
  id: string;
  displayName: string;
  fullName: string;
  emailMasked: string;
  phoneMasked?: string | null;
  avatarUrl?: string | null;
}

export interface MyQrCodeResponse {
  success: boolean;
  pairingToken: string;
  pairingCode: string;
  publicName: string;
  qrData: string;
  expiresAt: string;
}

export interface ResolveQrResponse {
  success: boolean;
  message?: string;
  owner?: {
    id: string;
    displayName: string;
    fullName: string;
    emailMasked: string;
    phoneMasked?: string | null;
    avatarUrl?: string | null;
  };
  pairingToken?: string;
  pairingCode?: string;
  isAlreadyConnected?: boolean;
}

export interface UdharRepayment {
  id: string;
  link_id: string;
  udhar_id: string;
  recorded_by_user_id: string;
  recorded_by_name?: string;
  amount: number | string;
  repayment_date: string;
  notes?: string;
  status: string;
  created_at: string;
}

export interface UdharTransactionItem {
  id: string;
  link_id: string;
  user_id: string;
  counterpart_user_id?: string | null;
  counterpart_name: string;
  counterpart_registered_name?: string | null;
  counterpart_email?: string | null;
  direction: 'gave' | 'took';
  original_amount: number | string;
  current_balance: number | string;
  transaction_date: string;
  due_date?: string | null;
  notes?: string | null;
  attachment_url?: string | null;
  status: 'pending_confirmation' | 'confirmed' | 'disputed' | 'settled' | 'cancelled';
  confirmation_status: 'pending' | 'confirmed' | 'disputed';
  is_initiator: boolean;
  dispute_reason?: string | null;
  disputed_at?: string | null;
  settled_at?: string | null;
  created_at: string;
  updated_at: string;
  repayments?: UdharRepayment[];
}

export interface UdharSummaryData {
  totalLent: number;
  totalBorrowed: number;
  outstandingReceivable: number;
  outstandingPayable: number;
  settledAmount: number;
  overdueAmount: number;
}

async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
    credentials: 'include',
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

export const udharDeletionApi = {
  // -------------------------------------------------------------
  // Account Deletion
  // -------------------------------------------------------------
  async requestAccountDeletion(password: string, reason?: string): Promise<{
    success: boolean;
    message: string;
    scheduledFor: string;
    remainingSeconds: number;
    cancelLink?: string;
  }> {
    return apiRequest('/api/account/deletion/request', {
      method: 'POST',
      body: JSON.stringify({ password, reason }),
    });
  },

  async getAccountDeletionStatus(): Promise<DeletionStatusResponse> {
    return apiRequest('/api/account/deletion/status', { method: 'GET' });
  },

  async cancelAccountDeletion(): Promise<{ success: boolean; message: string }> {
    return apiRequest('/api/account/deletion/cancel', { method: 'POST' });
  },

  async cancelAccountDeletionByToken(token: string): Promise<{ success: boolean; message: string }> {
    return apiRequest('/api/account/deletion/cancel-by-token', {
      method: 'POST',
      body: JSON.stringify({ token }),
    });
  },

  // -------------------------------------------------------------
  // Saved Contacts (People)
  // -------------------------------------------------------------
  async getContacts(): Promise<{ success: boolean; contacts: UdharContact[] }> {
    return apiRequest('/api/udhar/contacts', { method: 'GET' });
  },

  async saveContact(contact: {
    name: string;
    email?: string;
    phone?: string;
    relationship_type?: string;
    notes?: string;
    linked_user_id?: string;
  }): Promise<{ success: boolean; contact: UdharContact }> {
    return apiRequest('/api/udhar/contacts', {
      method: 'POST',
      body: JSON.stringify(contact),
    });
  },

  async updateContact(
    id: string,
    contact: Partial<{
      name: string;
      email?: string;
      phone?: string;
      relationship_type?: string;
      notes?: string;
      linked_user_id?: string;
    }>
  ): Promise<{ success: boolean; contact: UdharContact }> {
    return apiRequest(`/api/udhar/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(contact),
    });
  },

  async deleteContact(id: string): Promise<{ success: boolean; message: string }> {
    return apiRequest(`/api/udhar/contacts/${id}`, { method: 'DELETE' });
  },

  async linkContactToRegistered(
    contactId: string,
    registeredUserId: string
  ): Promise<{ success: boolean; message: string }> {
    return apiRequest(`/api/udhar/contacts/${contactId}/link-registered`, {
      method: 'POST',
      body: JSON.stringify({ registeredUserId }),
    });
  },

  // -------------------------------------------------------------
  // User Search
  // -------------------------------------------------------------
  async searchUsers(queryStr: string): Promise<{ success: boolean; users: SearchUserResult[] }> {
    return apiRequest(`/api/udhar/users/search?q=${encodeURIComponent(queryStr)}`, {
      method: 'GET',
    });
  },

  // -------------------------------------------------------------
  // QR Pairing
  // -------------------------------------------------------------
  async getMyQrCode(): Promise<MyQrCodeResponse> {
    return apiRequest('/api/udhar/qr/my-code', { method: 'GET' });
  },

  async resolveQrCode(payload: {
    qrData?: string;
    pairingToken?: string;
    pairingCode?: string;
  }): Promise<ResolveQrResponse> {
    return apiRequest('/api/udhar/qr/resolve', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async connectViaQr(payload: {
    pairingToken?: string;
    pairingCode?: string;
    relationshipType?: string;
  }): Promise<{ success: boolean; message: string; connectedUser: { id: string; displayName: string } }> {
    return apiRequest('/api/udhar/qr/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  // -------------------------------------------------------------
  // Udhar Transactions
  // -------------------------------------------------------------
  async getUdharTransactions(): Promise<{
    success: boolean;
    transactions: UdharTransactionItem[];
    summary: UdharSummaryData;
  }> {
    return apiRequest('/api/udhar/transactions', { method: 'GET' });
  },

  async createUdharTransaction(payload: {
    counterpart_name: string;
    counterpart_user_id?: string | null;
    direction: 'gave' | 'took';
    amount: number;
    transaction_date?: string;
    due_date?: string | null;
    notes?: string;
    attachment_url?: string | null;
  }): Promise<{
    success: boolean;
    message: string;
    transaction: UdharTransactionItem;
    isLinked: boolean;
  }> {
    return apiRequest('/api/udhar/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async confirmUdharTransaction(id: string): Promise<{ success: boolean; message: string }> {
    return apiRequest(`/api/udhar/transactions/${id}/confirm`, {
      method: 'POST',
    });
  },

  async disputeUdharTransaction(
    id: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    return apiRequest(`/api/udhar/transactions/${id}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async repayUdharTransaction(
    id: string,
    payload: { amount: number; repayment_date?: string; notes?: string }
  ): Promise<{
    success: boolean;
    message: string;
    remainingBalance: number;
    isSettled: boolean;
  }> {
    return apiRequest(`/api/udhar/transactions/${id}/repay`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },
};
