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
  reciprocallyLinked?: boolean;
  total_given?: number;
  total_taken?: number;
  net_balance?: number;
  outstanding_receivable?: number;
  outstanding_payable?: number;
  last_transaction_date?: string | null;
  pending_transactions_count?: number;
  total_transactions_count?: number;
  photo_url?: string | null;
  is_registered?: boolean;
}

export interface SearchUserResult {
  id: string;
  displayName: string;
  fullName: string;
  username?: string | null;
  email?: string;
  emailMasked?: string | null;
  phoneMasked?: string | null;
  avatarUrl?: string | null;
  matchedBy?: 'name' | 'email' | 'phone';
  isSelf?: boolean;
  isVerified?: boolean;
  connectionStatus?: 'self' | 'connected' | 'pending' | 'incoming_pending' | 'none';
  requestId?: string | null;
  isAlreadyConnected?: boolean;
  isSavedContact?: boolean;
}

export interface MyQrCodeResponse {
  success: boolean;
  pairingToken: string;
  pairingCode: string;
  publicName: string;
  avatarUrl?: string | null;
  qrData: string;
  expiresAt: string;
  message?: string;
}

export interface ResolveQrResponse {
  success: boolean;
  code?: string;
  message?: string;
  owner?: {
    id: string;
    displayName: string;
    fullName: string;
    email?: string;
    emailMasked: string;
    phoneMasked?: string | null;
    avatarUrl?: string | null;
    isVerified?: boolean;
  };
  pairingToken?: string;
  pairingCode?: string;
  isAlreadyConnected?: boolean;
}

export interface ConnectionRequestItem {
  id: string;
  direction: 'incoming' | 'outgoing';
  status: 'pending' | string;
  relationshipType?: string;
  source?: 'qr' | 'search' | 'manual' | string;
  createdAt?: string;
  expiresAt?: string;
  displayName: string;
  emailMasked?: string;
  phoneMasked?: string | null;
  avatarUrl?: string | null;
}

export interface ConnectionRequestListResponse {
  success: boolean;
  incoming: ConnectionRequestItem[];
  outgoing: ConnectionRequestItem[];
  connected?: Array<{
    id: string;
    userId: string;
    displayName: string;
    avatarUrl?: string | null;
    isVerified?: boolean;
    status: string;
    createdAt: string;
  }>;
}

export interface ConnectionRequestResult {
  success: boolean;
  status: 'pending' | 'connected' | 'rejected' | string;
  message: string;
  requestId?: string;
  deduplicated?: boolean;
  alreadyConnected?: boolean;
  connection?: ConnectedPersonPayload;
  target?: { id: string; displayName: string; avatarUrl?: string | null };
  code?: string;
}

export interface ConnectedPersonPayload {
  id: string;
  name: string;
  displayName: string;
  fullName?: string;
  emailMasked?: string;
  phoneMasked?: string | null;
  avatarUrl?: string | null;
}

export interface UdharRepayment {
  id: string;
  link_id: string;
  udhar_id: string;
  recorded_by_user_id: string;
  recorded_by_name?: string;
  amount: number | string;
  repayment_date: string;
  repayment_time?: string | null;
  payment_method?: 'UPI' | 'Cash' | 'Bank Transfer' | 'Card' | 'Wallet' | 'Other' | string;
  transaction_ref?: string | null;
  attachment_url?: string | null;
  notes?: string | null;
  status: 'pending_confirmation' | 'confirmed' | 'rejected' | string;
  rejection_reason?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
  deleted_at?: string | null;
  created_at: string;
}

export interface UdharEditHistoryItem {
  id: string;
  udhar_id: string;
  link_id: string;
  edited_by_user_id: string;
  edited_by_name?: string;
  previous_amount?: number | null;
  new_amount?: number | null;
  previous_notes?: string | null;
  new_notes?: string | null;
  previous_date?: string | null;
  new_date?: string | null;
  previous_due_date?: string | null;
  new_due_date?: string | null;
  reason_for_edit?: string | null;
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
  counterpart_avatar?: string | null;
  direction: 'gave' | 'took';
  original_amount: number | string;
  current_balance: number | string;
  paid_amount?: number | string;
  category?: string;
  payment_method?: string;
  description?: string | null;
  clean_notes?: string | null;
  transaction_date: string;
  due_date?: string | null;
  notes?: string | null;
  attachment_url?: string | null;
  status: 'pending_confirmation' | 'confirmed' | 'disputed' | 'settled' | 'cancelled';
  confirmation_status: 'pending' | 'confirmed' | 'disputed';
  is_initiator: boolean;
  last_edited_at?: string | null;
  last_edited_by?: string | null;
  edit_reason?: string | null;
  dispute_reason?: string | null;
  disputed_at?: string | null;
  settled_at?: string | null;
  deleted_at?: string | null;
  created_at: string;
  updated_at: string;
  repayments?: UdharRepayment[];
  edit_history?: UdharEditHistoryItem[];
}

export interface UdharSummaryData {
  totalLent: number;
  totalBorrowed: number;
  outstandingReceivable: number;
  outstandingPayable: number;
  netBalance: number;
  settledAmount: number;
  overdueAmount: number;
  totalConnectedPeople?: number;
  totalManualPeople?: number;
  peopleWithActiveUdhar?: number;
  pendingConfirmationsCount?: number;
}

async function apiRequest<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
  const token = getStoredSessionToken();
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token && !headers['Authorization']) {
    headers['Authorization'] = `Bearer ${token}`;
  }

  const res = await fetch(endpoint, {
    ...options,
    headers,
    credentials: 'include',
  });

  const contentType = res.headers.get('content-type') || '';
  let data: any = {};

  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch {
      data = { success: false, message: 'Invalid JSON response from server.' };
    }
  } else {
    // HTML error pages / empty responses must never reach the user as raw output.
    const err = new Error(
      res.status >= 500
        ? 'The server is temporarily unavailable. Your data has not been changed. Please retry in a moment.'
        : `Unexpected server response (${res.status}). Please retry.`
    );
    (err as any).status = res.status;
    (err as any).isNonJson = true;
    throw err;
  }

  if (!res.ok) {
    const errorMsg = data?.message || data?.error || `Request failed with status ${res.status}.`;
    const err = new Error(errorMsg);
    (err as any).status = res.status;
    (err as any).code = data?.code;
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
  // Saved Contacts & Explicit User Connections (Real Server Data Only)
  // -------------------------------------------------------------
  async getContacts(): Promise<{ success: boolean; contacts: UdharContact[] }> {
    return apiRequest('/api/udhar/contacts', { method: 'GET' });
  },

  async getContactsWithBalances(): Promise<{ success: boolean; contacts: UdharContact[] }> {
    return apiRequest('/api/udhar/contacts/with-balances', { method: 'GET' });
  },

  async inviteContact(contactId: string): Promise<{
    success: boolean;
    message: string;
    inviteLink?: string;
    emailSent?: boolean;
    alreadyRegistered?: boolean;
    linkedUserId?: string;
  }> {
    return apiRequest(`/api/udhar/contacts/${contactId}/invite`, { method: 'POST' });
  },

  async saveContact(contact: {
    name: string;
    email?: string;
    phone?: string;
    photo_url?: string | null;
    relationship_type?: string;
    notes?: string;
    linked_user_id?: string | null;
  }): Promise<{ success: boolean; contact: UdharContact; reciprocallyLinked?: boolean }> {
    const res = await apiRequest('/api/udhar/contacts', {
      method: 'POST',
      body: JSON.stringify(contact),
    });
    dispatchUdharUpdated();
    return res;
  },

  async updateContact(
    id: string,
    contact: Partial<{
      name: string;
      email?: string;
      phone?: string;
      photo_url?: string | null;
      relationship_type?: string;
      notes?: string;
      linked_user_id?: string | null;
    }>
  ): Promise<{ success: boolean; contact: UdharContact; reciprocallyLinked?: boolean }> {
    const res = await apiRequest(`/api/udhar/contacts/${id}`, {
      method: 'PUT',
      body: JSON.stringify(contact),
    });
    dispatchUdharUpdated();
    return res;
  },

  async deleteContact(id: string): Promise<{ success: boolean; message: string }> {
    const res = await apiRequest(`/api/udhar/contacts/${id}`, { method: 'DELETE' });
    dispatchUdharUpdated();
    return res;
  },

  async linkContactToRegistered(
    contactId: string,
    registeredUserId: string
  ): Promise<{ success: boolean; message: string }> {
    const res = await apiRequest(`/api/udhar/contacts/${contactId}/link-registered`, {
      method: 'POST',
      body: JSON.stringify({ registeredUserId }),
    });
    dispatchUdharUpdated();
    return res;
  },

  /**
   * Sends a consent-based connection request. The connection is only activated
   * after the target user accepts it.
   */
  async connectUser(payload: {
    targetUserId: string;
    relationshipType?: string;
    requestedVia?: string;
  }): Promise<ConnectionRequestResult> {
    const res = await apiRequest('/api/udhar/connections/connect', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        requestedVia: payload.requestedVia || 'search',
        source: 'search',
        consentConfirmed: true,
      }),
    });
    dispatchUdharUpdated();
    return res;
  },

  async listConnectionRequests(): Promise<ConnectionRequestListResponse> {
    return apiRequest('/api/udhar/connections/requests', { method: 'GET' });
  },

  async sendConnectionRequest(payload: {
    targetUserId: string;
    relationshipType?: string;
    source?: 'qr' | 'search' | 'manual';
  }): Promise<ConnectionRequestResult> {
    const res = await apiRequest('/api/udhar/connections/request', {
      method: 'POST',
      body: JSON.stringify({
        ...payload,
        requestedVia: payload.source || 'search',
        consentConfirmed: true,
      }),
    });
    dispatchUdharUpdated();
    return res;
  },

  async respondToConnectionRequest(
    requestId: string,
    action: 'accept' | 'reject'
  ): Promise<ConnectionRequestResult> {
    const res = await apiRequest(`/api/udhar/connections/${encodeURIComponent(requestId)}/${action}`, {
      method: 'POST',
    });
    dispatchUdharUpdated();
    return res;
  },

  async disconnectConnection(targetUserId: string): Promise<{ success: boolean; message: string }> {
    const res = await apiRequest('/api/udhar/connections/disconnect', {
      method: 'POST',
      body: JSON.stringify({ targetUserId }),
    });
    dispatchUdharUpdated();
    return res;
  },

  // -------------------------------------------------------------
  // Live Registered User Search (Abortable, Zero Fake Data)
  // -------------------------------------------------------------
  async searchUsers(
    queryStr: string,
    signal?: AbortSignal
  ): Promise<{ success: boolean; users: SearchUserResult[] }> {
    return apiRequest(`/api/udhar/users/search?q=${encodeURIComponent(queryStr)}`, {
      method: 'GET',
      signal,
    });
  },

  // -------------------------------------------------------------
  // Unique Server-Backed QR Identity & Pairing (Zero Fake Fallbacks)
  // -------------------------------------------------------------
  async getMyQrCode(): Promise<MyQrCodeResponse> {
    return apiRequest('/api/udhar/qr/my-code', { method: 'GET' });
  },

  async regenerateQrCode(): Promise<MyQrCodeResponse> {
    return apiRequest('/api/udhar/qr/regenerate', { method: 'POST' });
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
  }): Promise<ConnectionRequestResult> {
    const res = await apiRequest('/api/udhar/qr/connect', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    dispatchUdharUpdated();
    return res;
  },

  // -------------------------------------------------------------
  // Shared Canonical Udhar Transactions & Repayments
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
    category?: string;
    payment_method?: string;
    description?: string;
    transaction_date?: string;
    due_date?: string | null;
    notes?: string;
    attachment_url?: string | null;
    idempotency_key?: string;
  }): Promise<{
    success: boolean;
    deduplicated?: boolean;
    message: string;
    transaction: UdharTransactionItem;
    isLinked: boolean;
  }> {
    const res = await apiRequest('/api/udhar/transactions', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    dispatchUdharUpdated();
    return res;
  },

  async confirmUdharTransaction(id: string): Promise<{ success: boolean; message: string }> {
    const res = await apiRequest(`/api/udhar/transactions/${id}/confirm`, { method: 'POST' });
    dispatchUdharUpdated();
    return res;
  },

  async disputeUdharTransaction(id: string, reason: string): Promise<{ success: boolean; message: string }> {
    const res = await apiRequest(`/api/udhar/transactions/${id}/dispute`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    dispatchUdharUpdated();
    return res;
  },

  async repayUdharTransaction(
    id: string,
    payload: {
      amount: number;
      repayment_date?: string;
      repayment_time?: string;
      payment_method?: string;
      transaction_ref?: string;
      notes?: string;
      attachment_url?: string | null;
      idempotency_key?: string;
    }
  ): Promise<{
    success: boolean;
    deduplicated?: boolean;
    message: string;
    remainingBalance: number;
    isSettled: boolean;
    isPendingConfirmation?: boolean;
    repayment?: UdharRepayment;
  }> {
    const res = await apiRequest(`/api/udhar/transactions/${id}/repay`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
    dispatchUdharUpdated();
    return res;
  },

  async confirmRepayment(repaymentId: string): Promise<{
    success: boolean;
    message: string;
    remainingBalance?: number;
    isSettled?: boolean;
  }> {
    const res = await apiRequest(`/api/udhar/repayments/${repaymentId}/confirm`, { method: 'POST' });
    dispatchUdharUpdated();
    return res;
  },

  async rejectRepayment(repaymentId: string, reason: string): Promise<{
    success: boolean;
    message: string;
    rejectionReason?: string;
  }> {
    const res = await apiRequest(`/api/udhar/repayments/${repaymentId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
    dispatchUdharUpdated();
    return res;
  },

  async editUdharTransaction(
    id: string,
    payload: {
      amount?: number;
      category?: string;
      payment_method?: string;
      description?: string;
      notes?: string;
      transaction_date?: string;
      due_date?: string | null;
      reason_for_edit: string;
    }
  ): Promise<{
    success: boolean;
    message: string;
    remainingBalance?: number;
    isSettled?: boolean;
  }> {
    const res = await apiRequest(`/api/udhar/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
    dispatchUdharUpdated();
    return res;
  },

  async getUdharTransactionHistory(id: string): Promise<{
    success: boolean;
    transaction: UdharTransactionItem;
    editHistory: UdharEditHistoryItem[];
    repayments: UdharRepayment[];
  }> {
    return apiRequest(`/api/udhar/transactions/${id}/history`, { method: 'GET' });
  },

  async settleUdharTransaction(
    id: string,
    payload?: { notes?: string; settlement_date?: string; payment_method?: string }
  ): Promise<{ success: boolean; message: string; isSettled: boolean }> {
    const res = await apiRequest(`/api/udhar/transactions/${id}/settle`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
    dispatchUdharUpdated();
    return res;
  },

  async cancelUdharTransaction(
    id: string,
    reason?: string
  ): Promise<{ success: boolean; deletedTransactionId?: string; linkId?: string; message: string }> {
    const res = await apiRequest(`/api/udhar/transactions/${id}`, {
      method: 'DELETE',
      body: reason ? JSON.stringify({ reason }) : undefined,
    });
    dispatchUdharUpdated();
    return res;
  },

  async deleteRepayment(
    repaymentId: string,
    reason?: string
  ): Promise<{
    success: boolean;
    deletedRepaymentId: string;
    transactionId: string;
    linkId: string;
    paidAmount: number;
    remainingBalance: number;
    udharStatus: string;
    isSettled: boolean;
    message: string;
  }> {
    const res = await apiRequest(`/api/udhar/repayments/${repaymentId}`, {
      method: 'DELETE',
      body: reason ? JSON.stringify({ reason }) : undefined,
    });
    dispatchUdharUpdated();
    return res;
  },
};

function dispatchUdharUpdated() {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('mymoney:udhar-updated'));
  }
}
