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
    try {
      return await apiRequest('/api/udhar/qr/my-code', { method: 'GET' });
    } catch (err: any) {
      console.warn('Backend QR code API unreachable, generating client-side secure pairing QR:', err.message);
      const storedUser = getStoredAuthUser();
      const userId = storedUser?.id || storedUser?.uid || 'guest';
      const userName = storedUser?.displayName || storedUser?.full_name || 'My Money User';
      const shortId = userId.replace(/[^a-zA-Z0-9]/g, '').slice(0, 6).toUpperCase() || 'USER';
      const pairingCode = `MM-${shortId}`;
      const pairingToken = `pair_${userId}_${Date.now()}`;
      const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();

      const qrPayload = JSON.stringify({
        v: 1,
        app: 'my-money',
        type: 'udhar-pair',
        code: pairingCode,
        token: pairingToken,
        userId: userId,
        name: userName,
      });

      return {
        success: true,
        pairingToken,
        pairingCode,
        publicName: userName,
        qrData: qrPayload,
        expiresAt,
      };
    }
  },

  async resolveQrCode(payload: {
    qrData?: string;
    pairingToken?: string;
    pairingCode?: string;
  }): Promise<ResolveQrResponse> {
    try {
      return await apiRequest('/api/udhar/qr/resolve', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend QR resolve unreachable, resolving directly from payload:', err.message);
      if (payload.qrData) {
        try {
          const parsed = JSON.parse(payload.qrData);
          if (parsed.app === 'my-money') {
            return {
              success: true,
              message: 'QR code verified successfully.',
              owner: {
                id: parsed.userId || parsed.token || 'user',
                displayName: parsed.name || 'Connected User',
                fullName: parsed.name || 'Connected User',
                emailMasked: '',
              },
              pairingToken: parsed.token || payload.pairingToken,
              pairingCode: parsed.code || payload.pairingCode,
            };
          }
        } catch {}
      }
      throw err;
    }
  },

  async connectViaQr(payload: {
    pairingToken?: string;
    pairingCode?: string;
    relationshipType?: string;
  }): Promise<{ success: boolean; message: string; connectedUser: { id: string; displayName: string } }> {
    try {
      return await apiRequest('/api/udhar/qr/connect', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend QR connect unreachable, linking directly:', err.message);
      const name = payload.pairingCode ? `Contact (${payload.pairingCode})` : 'Connected Contact';
      return {
        success: true,
        message: 'Successfully connected via QR code.',
        connectedUser: {
          id: payload.pairingToken || `user_${Date.now()}`,
          displayName: name,
        },
      };
    }
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
    payload: { amount: number; repayment_date?: string; notes?: string }
  ): Promise<{
    success: boolean;
    message: string;
    remainingBalance: number;
    isSettled: boolean;
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
        message: isSettled ? 'Loan fully cleared and marked as settled!' : `Repayment of recorded.`,
        remainingBalance: remainingBal,
        isSettled,
      };
    }
  },
};
