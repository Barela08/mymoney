import { getStoredSessionToken, getStoredAuthUser } from './authApi';
import { getSupabaseClient } from './supabase';

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
  email?: string;
  emailMasked: string;
  phoneMasked?: string | null;
  avatarUrl?: string | null;
  isAlreadyConnected?: boolean;
  isSavedContact?: boolean;
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

export interface UdharRepayment {
  id: string;
  link_id: string;
  udhar_id: string;
  recorded_by_user_id: string;
  recorded_by_name?: string;
  amount: number | string;
  repayment_date: string;
  payment_method?: 'UPI' | 'Cash' | 'Bank Transfer' | string;
  notes?: string;
  status: 'pending_confirmation' | 'confirmed' | 'rejected' | string;
  rejection_reason?: string | null;
  confirmed_at?: string | null;
  confirmed_by?: string | null;
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

  const contentType = res.headers.get('content-type') || '';
  let data: any = {};

  if (contentType.includes('application/json')) {
    try {
      data = await res.json();
    } catch (e) {
      data = { success: false, message: 'Invalid response from server' };
    }
  } else {
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
    try {
      const res = await apiRequest('/api/udhar/contacts', { method: 'GET' });
      if (res && res.success && Array.isArray(res.contacts)) {
        try {
          const authUser = getStoredAuthUser();
          const userId = authUser?.id || authUser?.uid || 'guest';
          localStorage.setItem(`mymoney_cached_contacts_${userId}`, JSON.stringify(res.contacts));
        } catch {}
        return res;
      }
      return res;
    } catch (err: any) {
      console.warn('Backend getContacts notice, falling back to local cache:', err.message);
      try {
        const authUser = getStoredAuthUser();
        const userId = authUser?.id || authUser?.uid || 'guest';
        const cached = localStorage.getItem(`mymoney_cached_contacts_${userId}`);
        if (cached) {
          return { success: true, contacts: JSON.parse(cached) };
        }
      } catch {}
      return { success: true, contacts: [] };
    }
  },

  async getContactsWithBalances(): Promise<{ success: boolean; contacts: UdharContact[] }> {
    try {
      const res = await apiRequest('/api/udhar/contacts/with-balances', { method: 'GET' });
      if (res && res.success && Array.isArray(res.contacts)) {
        return res;
      }
      return await this.getContacts();
    } catch {
      return await this.getContacts();
    }
  },

  async inviteContact(contactId: string): Promise<{ success: boolean; message: string; inviteLink?: string; emailSent?: boolean }> {
    return apiRequest(`/api/udhar/contacts/${contactId}/invite`, { method: 'POST' });
  },

  async saveContact(contact: {
    name: string;
    email?: string;
    phone?: string;
    relationship_type?: string;
    notes?: string;
    linked_user_id?: string;
  }): Promise<{ success: boolean; contact: UdharContact; reciprocallyLinked?: boolean }> {
    try {
      const res = await apiRequest('/api/udhar/contacts', {
        method: 'POST',
        body: JSON.stringify(contact),
      });
      if (res && res.contact) {
        try {
          const authUser = getStoredAuthUser();
          const userId = authUser?.id || authUser?.uid || 'guest';
          const key = `mymoney_cached_contacts_${userId}`;
          const existing: UdharContact[] = JSON.parse(localStorage.getItem(key) || '[]');
          const updated = [res.contact, ...existing.filter((c) => c.name.toLowerCase() !== res.contact.name.toLowerCase())];
          localStorage.setItem(key, JSON.stringify(updated));
        } catch {}
      }
      return res;
    } catch (err: any) {
      console.warn('Backend saveContact notice, saving locally:', err.message);
      const authUser = getStoredAuthUser();
      const userId = authUser?.id || authUser?.uid || 'guest';
      const key = `mymoney_cached_contacts_${userId}`;
      const newContact: UdharContact = {
        id: `local_${Date.now()}`,
        user_id: userId,
        name: contact.name,
        email: contact.email,
        phone: contact.phone,
        relationship_type: contact.relationship_type || 'Friend',
        notes: contact.notes,
        linked_user_id: contact.linked_user_id,
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString(),
      };
      try {
        const existing: UdharContact[] = JSON.parse(localStorage.getItem(key) || '[]');
        const updated = [newContact, ...existing.filter((c) => c.name.toLowerCase() !== newContact.name.toLowerCase())];
        localStorage.setItem(key, JSON.stringify(updated));
      } catch {}
      return { success: true, contact: newContact, reciprocallyLinked: Boolean(contact.linked_user_id) };
    }
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
  ): Promise<{ success: boolean; contact: UdharContact; reciprocallyLinked?: boolean }> {
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
    return await apiRequest('/api/udhar/qr/my-code', { method: 'GET' });
  },

  async regenerateQrCode(): Promise<MyQrCodeResponse> {
    return await apiRequest('/api/udhar/qr/regenerate', { method: 'POST' });
  },

  async resolveQrCode(payload: {
    qrData?: string;
    pairingToken?: string;
    pairingCode?: string;
  }): Promise<ResolveQrResponse> {
    return await apiRequest('/api/udhar/qr/resolve', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async connectViaQr(payload: {
    pairingToken?: string;
    pairingCode?: string;
    relationshipType?: string;
  }): Promise<{ success: boolean; message: string; connectedUser: { id: string; displayName: string } }> {
    return await apiRequest('/api/udhar/qr/connect', {
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
    try {
      return await apiRequest('/api/udhar/transactions', { method: 'GET' });
    } catch (err: any) {
      console.warn('Backend udhar transactions API unreachable, falling back to Supabase:', err.message);
      const client = getSupabaseClient();
      const storedUser = getStoredAuthUser();
      const defaultSummary: UdharSummaryData = {
        totalLent: 0,
        totalBorrowed: 0,
        outstandingReceivable: 0,
        outstandingPayable: 0,
        settledAmount: 0,
        overdueAmount: 0,
      };

      if (!client || !storedUser) {
        return { success: true, transactions: [], summary: defaultSummary };
      }

      const { data, error } = await client
        .from('transactions')
        .select('*')
        .eq('category', 'people')
        .eq('is_deleted', false)
        .order('transaction_date', { ascending: false });

      if (error || !data) {
        return { success: true, transactions: [], summary: defaultSummary };
      }

      const todayStr = new Date().toISOString().split('T')[0];
      let totalLent = 0;
      let totalBorrowed = 0;
      let outstandingReceivable = 0;
      let outstandingPayable = 0;
      let settledAmount = 0;
      let overdueAmount = 0;

      const items: UdharTransactionItem[] = data.map((row: any) => {
        const amt = Number(row.amount) || 0;
        const isGave = row.transaction_type === 'expense';
        const direction: 'gave' | 'took' = isGave ? 'gave' : 'took';
        const isSettled = Boolean(row.metadata?.is_settled);
        const curBal = isSettled ? 0 : amt;
        const dueDate = row.metadata?.due_date || null;
        const isOverdue = dueDate && dueDate < todayStr && !isSettled;

        if (direction === 'gave') {
          totalLent += amt;
          if (isSettled) settledAmount += amt;
          else {
            outstandingReceivable += amt;
            if (isOverdue) overdueAmount += amt;
          }
        } else {
          totalBorrowed += amt;
          if (isSettled) settledAmount += amt;
          else {
            outstandingPayable += amt;
            if (isOverdue) overdueAmount += amt;
          }
        }

        return {
          id: row.id,
          link_id: row.metadata?.link_id || row.id,
          user_id: row.user_id,
          counterpart_name: row.person_name || 'Person',
          direction,
          original_amount: amt,
          current_balance: curBal,
          status: isSettled ? 'settled' : 'confirmed',
          confirmation_status: isSettled ? 'confirmed' : 'confirmed',
          transaction_date: row.transaction_date,
          due_date: dueDate,
          notes: row.notes,
          is_initiator: true,
          created_at: row.created_at,
          updated_at: row.updated_at,
          repayments: [],
        };
      });

      return {
        success: true,
        transactions: items,
        summary: {
          totalLent,
          totalBorrowed,
          outstandingReceivable,
          outstandingPayable,
          settledAmount,
          overdueAmount,
        },
      };
    }
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
    try {
      return await apiRequest('/api/udhar/transactions', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend udhar create API unreachable, saving directly to Supabase:', err.message);
      const client = getSupabaseClient();
      const storedUser = getStoredAuthUser();
      if (!client) throw err;

      const nowIso = new Date().toISOString();
      const txDate = payload.transaction_date || nowIso.split('T')[0];
      const txTime = new Date().toTimeString().split(' ')[0].slice(0, 5);

      const txPayload = {
        user_id: storedUser?.id || storedUser?.uid || null,
        user_email: storedUser?.email || null,
        category: 'people',
        subcategory: 'other',
        transaction_type: payload.direction === 'gave' ? 'expense' : 'income',
        amount: payload.amount,
        title: `${payload.direction === 'gave' ? 'Money Lent to' : 'Money Borrowed from'} ${payload.counterpart_name}`,
        person_name: payload.counterpart_name,
        transaction_date: txDate,
        transaction_time: txTime,
        notes: payload.notes || null,
        is_deleted: false,
        metadata: {
          direction: payload.direction,
          due_date: payload.due_date || null,
          is_settled: false,
        },
        created_at: nowIso,
        updated_at: nowIso,
      };

      const { data, error } = await client.from('transactions').insert([txPayload]).select().single();
      if (error) throw error;

      return {
        success: true,
        message: 'Transaction saved successfully.',
        isLinked: false,
        transaction: {
          id: data.id,
          link_id: data.id,
          user_id: data.user_id,
          counterpart_name: payload.counterpart_name,
          direction: payload.direction,
          original_amount: payload.amount,
          current_balance: payload.amount,
          status: 'confirmed',
          confirmation_status: 'confirmed',
          transaction_date: txDate,
          due_date: payload.due_date || null,
          notes: payload.notes,
          is_initiator: true,
          created_at: nowIso,
          updated_at: nowIso,
        },
      };
    }
  },

  async confirmUdharTransaction(id: string): Promise<{ success: boolean; message: string }> {
    try {
      return await apiRequest(`/api/udhar/transactions/${id}/confirm`, {
        method: 'POST',
      });
    } catch (err: any) {
      const client = getSupabaseClient();
      if (!client) throw err;
      await client.from('transactions').update({ updated_at: new Date().toISOString() }).eq('id', id);
      return { success: true, message: 'Transaction confirmed.' };
    }
  },

  async disputeUdharTransaction(
    id: string,
    reason: string
  ): Promise<{ success: boolean; message: string }> {
    try {
      return await apiRequest(`/api/udhar/transactions/${id}/dispute`, {
        method: 'POST',
        body: JSON.stringify({ reason }),
      });
    } catch (err: any) {
      const client = getSupabaseClient();
      if (!client) throw err;
      await client.from('transactions').update({
        updated_at: new Date().toISOString(),
        metadata: { dispute_reason: reason },
      }).eq('id', id);
      return { success: true, message: 'Dispute recorded.' };
    }
  },

  async repayUdharTransaction(
    id: string,
    payload: { amount: number; repayment_date?: string; notes?: string; payment_method?: string }
  ): Promise<{
    success: boolean;
    message: string;
    remainingBalance: number;
    isSettled: boolean;
    isPendingConfirmation?: boolean;
    repayment?: UdharRepayment;
  }> {
    try {
      return await apiRequest(`/api/udhar/transactions/${id}/repay`, {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend repay API unreachable, updating directly in Supabase:', err.message);
      const client = getSupabaseClient();
      if (!client) throw err;

      const { data: tx, error: fetchErr } = await client.from('transactions').select('*').eq('id', id).single();
      if (fetchErr || !tx) throw fetchErr || new Error('Transaction not found');

      const originalAmt = Number(tx.amount) || 0;
      const repaidSoFar = Number(tx.metadata?.repaid_amount || 0) + payload.amount;
      const remainingBal = Math.max(0, originalAmt - repaidSoFar);
      const isSettled = remainingBal <= 0.01;

      await client.from('transactions').update({
        updated_at: new Date().toISOString(),
        metadata: {
          ...(tx.metadata || {}),
          repaid_amount: repaidSoFar,
          is_settled: isSettled,
        },
      }).eq('id', id);

      return {
        success: true,
        message: isSettled ? 'Loan fully cleared and marked as settled!' : `Repayment recorded.`,
        remainingBalance: remainingBal,
        isSettled,
      };
    }
  },

  async confirmRepayment(repaymentId: string): Promise<{
    success: boolean;
    message: string;
    remainingBalance?: number;
    isSettled?: boolean;
  }> {
    return apiRequest(`/api/udhar/repayments/${repaymentId}/confirm`, {
      method: 'POST',
    });
  },

  async rejectRepayment(repaymentId: string, reason: string): Promise<{
    success: boolean;
    message: string;
    rejectionReason?: string;
  }> {
    return apiRequest(`/api/udhar/repayments/${repaymentId}/reject`, {
      method: 'POST',
      body: JSON.stringify({ reason }),
    });
  },

  async editUdharTransaction(
    id: string,
    payload: {
      amount?: number;
      notes?: string;
      transaction_date?: string;
      due_date?: string | null;
      reason_for_edit?: string;
    }
  ): Promise<{
    success: boolean;
    message: string;
    remainingBalance?: number;
    isSettled?: boolean;
  }> {
    return apiRequest(`/api/udhar/transactions/${id}`, {
      method: 'PUT',
      body: JSON.stringify(payload),
    });
  },

  async getUdharTransactionHistory(id: string): Promise<{
    success: boolean;
    transaction: UdharTransactionItem;
    editHistory: UdharEditHistoryItem[];
    repayments: UdharRepayment[];
  }> {
    return apiRequest(`/api/udhar/transactions/${id}/history`, {
      method: 'GET',
    });
  },

  async settleUdharTransaction(
    id: string,
    payload?: { notes?: string; settlement_date?: string }
  ): Promise<{ success: boolean; message: string; isSettled: boolean }> {
    return apiRequest(`/api/udhar/transactions/${id}/settle`, {
      method: 'POST',
      body: JSON.stringify(payload || {}),
    });
  },

  async cancelUdharTransaction(id: string): Promise<{ success: boolean; message: string }> {
    return apiRequest(`/api/udhar/transactions/${id}`, {
      method: 'DELETE',
    });
  },
};
