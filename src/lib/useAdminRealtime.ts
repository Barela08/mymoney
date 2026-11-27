import { useEffect } from 'react';
import { getSupabaseClient } from './supabase';

export interface AdminRealtimeEventDetail {
  table: string;
  eventType: string;
  payload?: any;
}

const ADMIN_REALTIME_EVENT = 'mymoney:admin-realtime';

export function dispatchAdminRealtimeEvent(detail: AdminRealtimeEventDetail): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent<AdminRealtimeEventDetail>(ADMIN_REALTIME_EVENT, { detail }));
}

export function subscribeAdminRealtimeEvent(
  handler: (detail: AdminRealtimeEventDetail) => void
): () => void {
  if (typeof window === 'undefined') return () => {};
  const listener = (ev: Event) => {
    const custom = ev as CustomEvent<AdminRealtimeEventDetail>;
    handler(custom.detail || { table: 'all', eventType: 'UPDATE' });
  };
  window.addEventListener(ADMIN_REALTIME_EVENT, listener);
  return () => window.removeEventListener(ADMIN_REALTIME_EVENT, listener);
}

/**
 * Subscribes to Supabase Realtime inserts/updates across Admin tables
 * and fans them out via window 'mymoney:admin-realtime' events.
 */
export function useAdminRealtime(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;

    const supabase = getSupabaseClient();
    if (!supabase) return;

    const tables = [
      'admin_notifications',
      'app_users',
      'feedbacks',
      'support_tickets',
      'support_ticket_replies',
      'security_incidents',
    ];

    const channel = supabase.channel('mm-admin-live-events');
    for (const table of tables) {
      channel.on(
        'postgres_changes',
        { event: '*', schema: 'public', table },
        (payload) => {
          dispatchAdminRealtimeEvent({
            table,
            eventType: payload.eventType,
            payload,
          });
        }
      );
    }

    channel.subscribe();

    return () => {
      try {
        supabase.removeChannel(channel);
      } catch {
        // Ignore cleanup errors
      }
    };
  }, [enabled]);
}
