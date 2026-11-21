import { getStoredSessionToken } from './authApi';

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

  let data: any = {};
  try {
    data = await res.json();
  } catch {
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
  status: 'open' | 'in_progress' | 'waiting_user' | 'resolved' | 'closed';
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
  in_progress: number;
  waiting_user: number;
  resolved: number;
  closed: number;
  urgent: number;
}

export const supportApi = {
  // -----------------------------------------------------------
  // USER-FACING APIs
  // -----------------------------------------------------------

  async submitFeedback(payload: {
    rating: number;
    message: string;
    category?: string;
    subject?: string;
  }): Promise<{ success: boolean; message: string; feedback: FeedbackRecord }> {
    return request('/api/feedback/submit', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async raiseComplaint(payload: {
    category: string;
    subject: string;
    description: string;
    attachment_url?: string;
  }): Promise<{ success: boolean; message: string; ticket: Partial<SupportTicketRecord> }> {
    return request('/api/support/complaint', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
  },

  async submitSupportTicket(payload: {
    category: string;
    subject: string;
    message: string;
    attachment_url?: string;
  }): Promise<{ success: boolean; message: string; ticket: Partial<SupportTicketRecord> }> {
    return request('/api/support/ticket', {
      method: 'POST',
      body: JSON.stringify(payload),
    });
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
    const qs = new URLSearchParams(params).toString();
    return request(`/api/admin/feedback${qs ? `?${qs}` : ''}`, { method: 'GET' });
  },

  async adminUpdateFeedback(
    id: string,
    payload: { status?: string; admin_notes?: string }
  ): Promise<{ success: boolean; message: string; feedback: FeedbackRecord }> {
    return request(`/api/admin/feedback/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(payload),
    });
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
