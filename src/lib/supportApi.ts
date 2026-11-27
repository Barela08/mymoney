import { getStoredSessionToken, getStoredAuthUser } from './authApi';
import { getSupabaseClient } from './supabase';

async function request<T = any>(endpoint: string, options: RequestInit = {}): Promise<T> {
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
      data = { success: false, message: 'Invalid response from server' };
    }
  } else {
    // Non-JSON response (e.g. 404/500/SPA fallback HTML)
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

export interface FeedbackRecord {
  id: string;
  user_id?: string;
  user_name: string;
  user_email: string;
  user_phone?: string;
  type: string;
  category?: string;
  subject?: string;
  message: string;
  rating?: number;
  status: 'new' | 'reviewed' | 'responded' | 'resolved';
  admin_notes?: string;
  admin_response?: string;
  reviewed_by?: string;
  reviewed_at?: string;
  created_at: string;
  updated_at: string;
}

export interface FeedbackMetrics {
  total: number;
  avg_rating: number;
  stars_5: number;
  stars_4: number;
  stars_3: number;
  stars_2: number;
  stars_1: number;
  new_count: number;
  reviewed_count: number;
  resolved_count: number;
}

export interface SupportTicketRecord {
  id: string;
  ticket_number: string;
  user_id?: string;
  user_name: string;
  user_email: string;
  ticket_type: 'complaint' | 'support';
  category: string;
  subject: string;
  description: string;
  priority: 'low' | 'normal' | 'high' | 'urgent';
  status: 'open' | 'under_review' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed';
  assigned_to?: string;
  attachment_url?: string;
  internal_notes?: string;
  created_at: string;
  updated_at: string;
  resolved_at?: string;
}

export interface SupportTicketReplyRecord {
  id: string;
  ticket_id: string;
  sender_id?: string;
  sender_name: string;
  sender_role: string;
  sender_type: 'user' | 'admin';
  message: string;
  message_type: 'user_message' | 'admin_reply' | 'internal_note';
  is_internal: boolean;
  email_status: 'none' | 'pending' | 'sent' | 'failed';
  delivery_error?: string;
  created_at: string;
}

export interface TicketStatusHistoryRecord {
  id: string;
  ticket_id: string;
  old_status?: string;
  new_status: string;
  changed_by?: string;
  changed_by_name?: string;
  reason?: string;
  created_at: string;
}

export interface TicketMetrics {
  total: number;
  open: number;
  under_review?: number;
  in_progress: number;
  waiting_user: number;
  resolved: number;
  closed: number;
  urgent: number;
}

export interface UserConsentRecord {
  id: string;
  user_id?: string;
  user_email?: string;
  purpose: string;
  status: 'granted' | 'withdrawn' | 'not_granted';
  action: 'granted' | 'withdrawn';
  policy_version: string;
  consent_wording?: string;
  created_at: string;
}

export const supportApi = {
  // -----------------------------------------------------------
  // USER-FACING APIs
  // -----------------------------------------------------------

  async submitFeedback(payload: {
    rating?: number | null;
    message: string;
    dpdp_consent?: boolean;
    category?: string;
    subject?: string;
  }): Promise<{ success: boolean; message: string; feedback: FeedbackRecord; feedback_id?: string }> {
    try {
      return await request('/api/feedback/submit', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend feedback API unreachable, saving directly to Supabase:', err.message);
      const storedUser = getStoredAuthUser();
      const client = getSupabaseClient();
      if (!client) throw err;

      const nowIso = new Date().toISOString();
      const insertData = {
        user_id: storedUser?.id || storedUser?.uid || null,
        user_name: storedUser?.displayName || storedUser?.full_name || 'Valued User',
        user_email: storedUser?.email || 'user@mymoney.app',
        type: 'feedback',
        category: payload.category || 'General Feedback',
        subject: payload.subject || (payload.rating ? `${payload.rating}-Star Feedback` : 'User Feedback'),
        message: payload.message,
        rating: payload.rating || null,
        status: 'new',
        dpdp_consent: Boolean(payload.dpdp_consent),
        dpdp_consent_at: payload.dpdp_consent ? nowIso : null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      const { data, error } = await client.from('feedbacks').insert([insertData]).select().single();
      if (error) {
        console.error('Supabase fallback feedback insert error:', error);
        throw new Error(error.message || 'Could not submit feedback.');
      }

      const fbRecord = data as FeedbackRecord;
      const feedbackId = `FB-${fbRecord.id ? fbRecord.id.slice(0, 8).toUpperCase() : Date.now().toString(36).toUpperCase()}`;

      // If user consented, record in user_consents if possible
      if (payload.dpdp_consent) {
        try {
          await client.from('user_consents').insert([{
            user_id: storedUser?.id || storedUser?.uid || null,
            user_email: storedUser?.email || null,
            purpose: 'optional_feedback_support',
            status: 'granted',
            action: 'granted',
            policy_version: 'v1.2 - DPDP Act 2023',
            consent_wording: 'Explicit consent granted during feedback submission for service quality improvement.',
            created_at: nowIso,
          }]);
        } catch {}
      }

      return {
        success: true,
        message: 'Thank you for your feedback! Your opinion helps us improve My Money Manager.',
        feedback_id: feedbackId,
        feedback: fbRecord,
      };
    }
  },

  async raiseComplaint(payload: {
    subject: string;
    description: string;
    phone?: string;
    attachment_url?: string;
    category?: string;
  }): Promise<{ success: boolean; message: string; ticket: Partial<SupportTicketRecord>; ticket_number?: string }> {
    try {
      return await request('/api/support/complaint', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend complaint API unreachable, saving directly to Supabase:', err.message);
      const storedUser = getStoredAuthUser();
      const client = getSupabaseClient();
      if (!client) throw err;

      const nowIso = new Date().toISOString();
      const ticketNumber = `CMP-${Math.floor(1000 + Math.random() * 9000)}`;

      // Insert into feedbacks table as type = 'complaint'
      const feedbackPayload = {
        user_id: storedUser?.id || storedUser?.uid || null,
        user_name: storedUser?.displayName || storedUser?.full_name || 'User',
        user_email: storedUser?.email || 'user@mymoney.app',
        user_phone: payload.phone || null,
        type: 'complaint',
        category: payload.category || 'General Complaint',
        subject: payload.subject,
        message: payload.description,
        urgency: 'normal',
        status: 'new',
        dpdp_consent: false,
        created_at: nowIso,
        updated_at: nowIso,
      };

      await client.from('feedbacks').insert([feedbackPayload]);

      return {
        success: true,
        message: `Your complaint has been registered (${ticketNumber}). Our support team will investigate promptly.`,
        ticket_number: ticketNumber,
        ticket: {
          ticket_number: ticketNumber,
          category: payload.category || 'General Complaint',
          subject: payload.subject,
          description: payload.description,
          status: 'open',
          created_at: nowIso,
        },
      };
    }
  },

  // -----------------------------------------------------------
  // PRIVACY & DPDP CONSENT APIs
  // -----------------------------------------------------------

  async getConsentStatus(): Promise<{
    success: boolean;
    status: 'granted' | 'withdrawn' | 'not_granted';
    latest: UserConsentRecord | null;
    history: UserConsentRecord[];
    policyVersion: string;
  }> {
    try {
      return await request('/api/privacy/consent-status', { method: 'GET' });
    } catch (err: any) {
      console.warn('Backend consent API unreachable, checking Supabase/local fallback:', err.message);
      const client = getSupabaseClient();
      const storedUser = getStoredAuthUser();
      if (!client || !storedUser) {
        return {
          success: true,
          status: 'not_granted',
          latest: null,
          history: [],
          policyVersion: 'v1.2 - DPDP Act 2023',
        };
      }

      const { data, error } = await client
        .from('user_consents')
        .select('*')
        .eq('user_id', storedUser?.id || storedUser?.uid)
        .order('created_at', { ascending: false });

      if (error) {
        return {
          success: true,
          status: 'not_granted',
          latest: null,
          history: [],
          policyVersion: 'v1.2 - DPDP Act 2023',
        };
      }

      const history = (data || []) as UserConsentRecord[];
      const latest = history[0] || null;
      return {
        success: true,
        status: latest ? latest.status : 'not_granted',
        latest,
        history,
        policyVersion: 'v1.2 - DPDP Act 2023',
      };
    }
  },

  async grantConsent(
    purpose = 'optional_feedback_support',
    wording?: string
  ): Promise<{ success: boolean; message: string; status: string; consent?: UserConsentRecord }> {
    try {
      return await request('/api/privacy/consent-grant', {
        method: 'POST',
        body: JSON.stringify({ purpose, wording }),
      });
    } catch (err: any) {
      console.warn('Backend grant consent API unreachable, saving via Supabase fallback:', err.message);
      const client = getSupabaseClient();
      const storedUser = getStoredAuthUser();
      if (!client || !storedUser) throw err;

      const nowIso = new Date().toISOString();
      const record = {
        user_id: storedUser?.id || storedUser?.uid,
        user_email: storedUser?.email || null,
        purpose,
        status: 'granted',
        action: 'granted',
        policy_version: 'v1.2 - DPDP Act 2023',
        consent_wording: wording || 'User explicitly granted optional processing consent for service quality feedback and support inquiries under the DPDP Act 2023.',
        created_at: nowIso,
        updated_at: nowIso,
      };

      const { data, error } = await client.from('user_consents').insert([record]).select().single();
      if (error) throw error;

      return {
        success: true,
        message: 'Optional consent recorded successfully.',
        status: 'granted',
        consent: data as UserConsentRecord,
      };
    }
  },

  async withdrawConsent(
    purpose = 'optional_feedback_support',
    wording?: string
  ): Promise<{ success: boolean; message: string; status: string; consent?: UserConsentRecord }> {
    try {
      return await request('/api/privacy/consent-withdraw', {
        method: 'POST',
        body: JSON.stringify({ purpose, wording }),
      });
    } catch (err: any) {
      console.warn('Backend withdraw consent API unreachable, saving via Supabase fallback:', err.message);
      const client = getSupabaseClient();
      const storedUser = getStoredAuthUser();
      if (!client || !storedUser) throw err;

      const nowIso = new Date().toISOString();
      const record = {
        user_id: storedUser?.id || storedUser?.uid,
        user_email: storedUser?.email || null,
        purpose,
        status: 'withdrawn',
        action: 'withdrawn',
        policy_version: 'v1.2 - DPDP Act 2023',
        consent_wording: wording || 'User explicitly withdrew optional processing consent. All optional data processing ceased. Core app functionality and account remain active.',
        created_at: nowIso,
        updated_at: nowIso,
      };

      const { data, error } = await client.from('user_consents').insert([record]).select().single();
      if (error) throw error;

      return {
        success: true,
        message: 'Optional consent has been withdrawn. Core account and financial ledgers remain preserved.',
        status: 'withdrawn',
        consent: data as UserConsentRecord,
      };
    }
  },

  async submitSupportTicket(payload: {
    category: string;
    subject: string;
    message: string;
    attachment_url?: string;
  }): Promise<{ success: boolean; message: string; ticket: Partial<SupportTicketRecord> }> {
    try {
      return await request('/api/support/ticket', {
        method: 'POST',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend support ticket API unreachable, saving directly to Supabase:', err.message);
      const storedUser = getStoredAuthUser();
      const client = getSupabaseClient();
      if (!client) throw err;

      const nowIso = new Date().toISOString();
      const ticketNumber = `TCK-${Date.now().toString(36).toUpperCase()}`;

      const feedbackPayload = {
        user_id: storedUser?.id || storedUser?.uid || null,
        user_name: storedUser?.displayName || storedUser?.full_name || 'User',
        user_email: storedUser?.email || 'user@mymoney.app',
        type: 'complaint',
        category: payload.category,
        subject: payload.subject,
        message: payload.message,
        urgency: 'normal',
        status: 'new',
        dpdp_consent: false,
        dpdp_consent_at: null,
        created_at: nowIso,
        updated_at: nowIso,
      };

      await client.from('feedbacks').insert([feedbackPayload]);

      return {
        success: true,
        message: `Support ticket ${ticketNumber} created successfully.`,
        ticket: {
          ticket_number: ticketNumber,
          category: payload.category,
          subject: payload.subject,
          description: payload.message,
          status: 'open',
          created_at: nowIso,
        },
      };
    }
  },

  async getSupportHistory(): Promise<{
    success: boolean;
    feedbacks: FeedbackRecord[];
    tickets: SupportTicketRecord[];
  }> {
    return request('/api/user/support-history', { method: 'GET' });
  },

  async getUserTicketDetails(ticketId: string): Promise<{
    success: boolean;
    ticket: SupportTicketRecord;
    replies: SupportTicketReplyRecord[];
  }> {
    return request(`/api/user/tickets/${ticketId}`, { method: 'GET' });
  },

  async userReplyToTicket(
    ticketId: string,
    message: string
  ): Promise<{ success: boolean; message: string; reply: SupportTicketReplyRecord }> {
    return request(`/api/user/tickets/${ticketId}/reply`, {
      method: 'POST',
      body: JSON.stringify({ message }),
    });
  },

  // -----------------------------------------------------------
  // ADMIN-FACING APIs
  // -----------------------------------------------------------

  async adminGetFeedbacks(params: Record<string, string> = {}): Promise<{
    success: boolean;
    feedbacks: FeedbackRecord[];
    metrics: FeedbackMetrics;
  }> {
    try {
      const qs = new URLSearchParams(params).toString();
      return await request(`/api/admin/feedback${qs ? `?${qs}` : ''}`, { method: 'GET' });
    } catch (err: any) {
      console.warn('Backend admin feedback API unreachable, fetching directly from Supabase:', err.message);
      const client = getSupabaseClient();
      if (!client) throw err;

      let q = client.from('feedbacks').select('*').order('created_at', { ascending: false });
      if (params.rating && params.rating !== 'all') q = q.eq('rating', parseInt(params.rating, 10));
      if (params.status && params.status !== 'all') q = q.eq('status', params.status);
      if (params.category && params.category !== 'all') q = q.eq('category', params.category);

      const { data, error } = await q;
      if (error) throw error;

      const rows = data || [];
      const total = rows.length;
      const avg = total > 0 ? rows.reduce((s: number, r: any) => s + (Number(r.rating) || 0), 0) / total : 0;

      return {
        success: true,
        feedbacks: rows as FeedbackRecord[],
        metrics: {
          total,
          avg_rating: Number(avg.toFixed(1)),
          stars_5: rows.filter((r: any) => r.rating === 5).length,
          stars_4: rows.filter((r: any) => r.rating === 4).length,
          stars_3: rows.filter((r: any) => r.rating === 3).length,
          stars_2: rows.filter((r: any) => r.rating === 2).length,
          stars_1: rows.filter((r: any) => r.rating === 1).length,
          new_count: rows.filter((r: any) => r.status === 'new' || r.status === 'pending').length,
          reviewed_count: rows.filter((r: any) => r.status === 'reviewed' || r.status === 'in_progress').length,
          resolved_count: rows.filter((r: any) => r.status === 'resolved' || r.status === 'closed').length,
        },
      };
    }
  },

  async adminUpdateFeedback(
    id: string,
    payload: { status?: string; admin_notes?: string }
  ): Promise<{ success: boolean; message: string; feedback: FeedbackRecord }> {
    try {
      return await request(`/api/admin/feedback/${id}`, {
        method: 'PATCH',
        body: JSON.stringify(payload),
      });
    } catch (err: any) {
      console.warn('Backend admin update feedback API unreachable, updating directly in Supabase:', err.message);
      const client = getSupabaseClient();
      if (!client) throw err;

      const updateData: any = { updated_at: new Date().toISOString() };
      if (payload.status) updateData.status = payload.status;
      if (payload.admin_notes !== undefined) updateData.admin_notes = payload.admin_notes;

      const { data, error } = await client.from('feedbacks').update(updateData).eq('id', id).select().single();
      if (error) throw error;

      return {
        success: true,
        message: 'Feedback updated successfully.',
        feedback: data as FeedbackRecord,
      };
    }
  },

  async adminReplyToFeedback(
    id: string,
    payload: { message: string; is_internal?: boolean }
  ): Promise<{ success: boolean; message: string; feedback: FeedbackRecord; emailDispatched?: boolean; emailError?: string }> {
    return request(`/api/admin/feedback/${id}/reply`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminGetTickets(params: Record<string, string> = {}): Promise<{
    success: boolean;
    tickets: SupportTicketRecord[];
    metrics: TicketMetrics;
  }> {
    const qs = new URLSearchParams(params).toString();
    return request(`/api/admin/support/tickets${qs ? `?${qs}` : ''}`, { method: 'GET' });
  },

  async adminGetTicketDetails(ticketId: string): Promise<{
    success: boolean;
    ticket: SupportTicketRecord;
    replies: SupportTicketReplyRecord[];
    statusHistory: TicketStatusHistoryRecord[];
  }> {
    return request(`/api/admin/support/tickets/${ticketId}`, { method: 'GET' });
  },

  async adminReplyToTicket(
    ticketId: string,
    payload: { message: string; is_internal?: boolean; status?: string }
  ): Promise<{ success: boolean; message: string; reply: SupportTicketReplyRecord; emailStatus: string; emailError?: string }> {
    return request(`/api/admin/support/tickets/${ticketId}/reply`, {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async adminUpdateTicket(
    ticketId: string,
    payload: { priority?: string; status?: string; assigned_to?: string; internal_notes?: string; reason?: string }
  ): Promise<{ success: boolean; message: string; ticket: SupportTicketRecord }> {
    return request(`/api/admin/support/tickets/${ticketId}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
  },

  async adminRetryEmailReply(
    replyId: string
  ): Promise<{ success: boolean; message: string; emailStatus: string; emailError?: string }> {
    return request(`/api/admin/support/replies/${replyId}/retry-email`, {
      method: 'POST',
    });
  },
};
