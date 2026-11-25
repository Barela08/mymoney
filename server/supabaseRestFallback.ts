import fs from 'fs';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_SUPABASE_URL = 'https://frgrfajnrzqwnevhlrio.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_RHVRSE_Z4R1Qit3djpOfCA_L93zsRjg';

const FALLBACK_DATA_DIR = path.resolve(process.cwd(), '.data', 'runtime-store');

function safeStoreFile(name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const resolved = path.resolve(FALLBACK_DATA_DIR, safeName);
  if (!resolved.startsWith(FALLBACK_DATA_DIR + path.sep)) {
    throw new Error('PATH_CONFINEMENT_VIOLATION');
  }
  return resolved;
}

function readJsonStore<T>(fileName: string, defaultValue: T): T {
  try {
    const file = safeStoreFile(fileName);
    if (!fs.existsSync(file)) return defaultValue;
    const raw = fs.readFileSync(file, 'utf8');
    if (!raw.trim()) return defaultValue;
    return JSON.parse(raw) as T;
  } catch {
    return defaultValue;
  }
}

function writeJsonStore<T>(fileName: string, data: T): void {
  try {
    if (!fs.existsSync(FALLBACK_DATA_DIR)) {
      fs.mkdirSync(FALLBACK_DATA_DIR, { recursive: true });
    }
    const file = safeStoreFile(fileName);
    fs.writeFileSync(file, JSON.stringify(data, null, 2), 'utf8');
  } catch (err: any) {
    console.warn(`[RuntimeStore] Write warning (${fileName}):`, err?.message);
  }
}

function getSupabaseRestConfig() {
  const url = (process.env.SUPABASE_URL || process.env.VITE_SUPABASE_URL || DEFAULT_SUPABASE_URL).replace(/\/+$/, '');
  const key =
    process.env.SUPABASE_SECRET_KEY ||
    process.env.SUPABASE_SERVICE_ROLE_KEY ||
    process.env.SUPABASE_PUBLISHABLE_KEY ||
    process.env.VITE_SUPABASE_ANON_KEY ||
    DEFAULT_SUPABASE_KEY;
  return { url, key };
}

export async function sbRestRequest<T = any>(
  restPath: string,
  options: {
    method?: string;
    body?: any;
    prefer?: string;
  } = {}
): Promise<{ ok: boolean; status: number; data: T | null; error?: string }> {
  try {
    const { url, key } = getSupabaseRestConfig();
    const headers: Record<string, string> = {
      apikey: key,
      Authorization: `Bearer ${key}`,
      Accept: 'application/json',
    };
    if (options.body !== undefined) {
      headers['Content-Type'] = 'application/json';
    }
    if (options.prefer) {
      headers['Prefer'] = options.prefer;
    }

    const response = await fetch(`${url}/rest/v1/${restPath}`, {
      method: options.method || 'GET',
      headers,
      body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
    });

    const text = await response.text();
    let parsed: any = null;
    if (text) {
      try {
        parsed = JSON.parse(text);
      } catch {
        parsed = text;
      }
    }

    if (!response.ok) {
      const errMsg =
        (parsed && typeof parsed === 'object' && (parsed.message || parsed.error || parsed.details)) ||
        (typeof parsed === 'string' && parsed) ||
        `Supabase REST HTTP ${response.status}`;
      return { ok: false, status: response.status, data: null, error: errMsg };
    }

    return { ok: true, status: response.status, data: parsed as T };
  } catch (err: any) {
    return { ok: false, status: 0, data: null, error: err?.message || 'Network error' };
  }
}

// ============================================================================
// 1. INTEGRATIONS CONFIG PERSISTENCE (NON-SECRET AI MODEL / ENABLED TOGGLE)
// ============================================================================

export interface StoredIntegrationsConfig {
  aiModel?: string;
  aiEnabled?: boolean;
  senderName?: string;
  siteUrl?: string;
  supportEmail?: string;
  supportPhone?: string;
  updatedAt?: string;
  updatedBy?: string;
}

export function loadIntegrationsConfigFallback(): StoredIntegrationsConfig {
  return readJsonStore<StoredIntegrationsConfig>('integrations-config.json', {});
}

export function saveIntegrationsConfigFallback(cfg: StoredIntegrationsConfig): void {
  writeJsonStore('integrations-config.json', cfg);
}

// ============================================================================
// 2. FEEDBACK FALLBACK STORE (SUPABASE REST + DISK MIRROR)
// ============================================================================

interface FeedbackStoreFile {
  feedbacks: any[];
}

export async function insertFeedbackFallback(payload: {
  user_id: string | null;
  user_name: string;
  user_email: string;
  user_phone?: string | null;
  category: string;
  subject: string;
  message: string;
  rating: number | null;
  dpdp_consent: boolean;
  dpdp_consent_at: string | null;
}): Promise<any> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const record = {
    id,
    user_id: payload.user_id,
    user_name: payload.user_name,
    user_email: payload.user_email,
    user_phone: payload.user_phone || null,
    type: 'feedback',
    category: payload.category,
    subject: payload.subject,
    message: payload.message,
    rating: payload.rating,
    dpdp_consent: payload.dpdp_consent,
    dpdp_consent_at: payload.dpdp_consent_at,
    status: 'new',
    admin_notes: null,
    reviewed_by: null,
    reviewed_at: null,
    created_at: now,
    updated_at: now,
  };

  let savedRow = record;
  const sbRes = await sbRestRequest<any[]>('feedbacks', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      id: record.id,
      user_id: record.user_id,
      user_name: record.user_name,
      user_email: record.user_email,
      user_phone: record.user_phone,
      type: 'feedback',
      category: record.category,
      subject: record.subject,
      message: record.message,
      rating: record.rating,
      dpdp_consent: record.dpdp_consent,
      dpdp_consent_at: record.dpdp_consent_at,
      status: 'new',
      created_at: now,
      updated_at: now,
    },
  });

  if (sbRes.ok && Array.isArray(sbRes.data) && sbRes.data[0]) {
    savedRow = sbRes.data[0];
  } else {
    // Retry without optional columns if schema differs slightly
    const retryRes = await sbRestRequest<any[]>('feedbacks', {
      method: 'POST',
      prefer: 'return=representation',
      body: {
        user_id: record.user_id,
        user_name: record.user_name,
        user_email: record.user_email,
        type: 'feedback',
        category: record.category,
        subject: record.subject,
        message: record.message,
        rating: record.rating,
        status: 'new',
        created_at: now,
        updated_at: now,
      },
    });
    if (retryRes.ok && Array.isArray(retryRes.data) && retryRes.data[0]) {
      savedRow = retryRes.data[0];
    }
  }

  const store = readJsonStore<FeedbackStoreFile>('feedbacks.json', { feedbacks: [] });
  store.feedbacks = [savedRow, ...store.feedbacks.filter((f) => f.id !== savedRow.id)].slice(0, 500);
  writeJsonStore('feedbacks.json', store);

  return savedRow;
}

export async function listFeedbacksFallback(filters?: {
  userId?: string;
  rating?: string;
  category?: string;
  status?: string;
  search?: string;
}): Promise<{ feedbacks: any[]; metrics: any }> {
  const store = readJsonStore<FeedbackStoreFile>('feedbacks.json', { feedbacks: [] });
  const sbRes = await sbRestRequest<any[]>(
    'feedbacks?type=eq.feedback&select=*&order=created_at.desc&limit=200'
  );

  const mergedMap = new Map<string, any>();
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (row?.id) mergedMap.set(String(row.id), row);
    }
  }
  for (const row of store.feedbacks) {
    if (row?.id && !mergedMap.has(String(row.id))) {
      mergedMap.set(String(row.id), row);
    }
  }

  let allFeedbacks = Array.from(mergedMap.values()).sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );

  if (filters?.userId) {
    allFeedbacks = allFeedbacks.filter((f) => f.user_id === filters.userId);
  }

  const total = allFeedbacks.length;
  const ratedRows = allFeedbacks.filter((f) => Number(f.rating) > 0);
  const avgRating =
    ratedRows.length > 0
      ? Number((ratedRows.reduce((s, f) => s + Number(f.rating || 0), 0) / ratedRows.length).toFixed(1))
      : 0;

  const metrics = {
    total,
    avg_rating: avgRating,
    stars_5: allFeedbacks.filter((f) => Number(f.rating) === 5).length,
    stars_4: allFeedbacks.filter((f) => Number(f.rating) === 4).length,
    stars_3: allFeedbacks.filter((f) => Number(f.rating) === 3).length,
    stars_2: allFeedbacks.filter((f) => Number(f.rating) === 2).length,
    stars_1: allFeedbacks.filter((f) => Number(f.rating) === 1).length,
    new_count: allFeedbacks.filter((f) => f.status === 'new').length,
    reviewed_count: allFeedbacks.filter((f) => ['reviewed', 'responded', 'resolved'].includes(f.status)).length,
    resolved_count: allFeedbacks.filter((f) => f.status === 'resolved').length,
  };

  let filtered = allFeedbacks;
  if (filters?.rating && filters.rating !== 'all') {
    const rNum = parseInt(filters.rating, 10);
    filtered = filtered.filter((f) => Number(f.rating) === rNum);
  }
  if (filters?.category && filters.category !== 'all') {
    filtered = filtered.filter((f) => f.category === filters.category);
  }
  if (filters?.status && filters.status !== 'all') {
    filtered = filtered.filter((f) => f.status === filters.status);
  }
  if (filters?.search) {
    const q = filters.search.toLowerCase();
    filtered = filtered.filter(
      (f) =>
        String(f.user_name || '').toLowerCase().includes(q) ||
        String(f.user_email || '').toLowerCase().includes(q) ||
        String(f.message || '').toLowerCase().includes(q) ||
        String(f.subject || '').toLowerCase().includes(q)
    );
  }

  return { feedbacks: filtered.slice(0, 150), metrics };
}

export async function getFeedbackByIdFallback(id: string): Promise<any | null> {
  const sbRes = await sbRestRequest<any[]>(`feedbacks?id=eq.${encodeURIComponent(id)}&select=*&limit=1`);
  if (sbRes.ok && Array.isArray(sbRes.data) && sbRes.data[0]) {
    return sbRes.data[0];
  }
  const store = readJsonStore<FeedbackStoreFile>('feedbacks.json', { feedbacks: [] });
  return store.feedbacks.find((f) => f.id === id) || null;
}

export async function updateFeedbackFallback(
  id: string,
  updates: {
    status?: string;
    admin_notes?: string;
    reviewed_by?: string;
  }
): Promise<any | null> {
  const now = new Date().toISOString();
  const patch: Record<string, any> = {
    updated_at: now,
    reviewed_at: now,
  };
  if (updates.status !== undefined) patch.status = updates.status;
  if (updates.admin_notes !== undefined) patch.admin_notes = updates.admin_notes;
  if (updates.reviewed_by !== undefined) patch.reviewed_by = updates.reviewed_by;

  let updatedRow: any = null;
  const sbRes = await sbRestRequest<any[]>(`feedbacks?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    prefer: 'return=representation',
    body: patch,
  });
  if (sbRes.ok && Array.isArray(sbRes.data) && sbRes.data[0]) {
    updatedRow = sbRes.data[0];
  }

  const store = readJsonStore<FeedbackStoreFile>('feedbacks.json', { feedbacks: [] });
  const idx = store.feedbacks.findIndex((f) => f.id === id);
  if (idx >= 0) {
    store.feedbacks[idx] = { ...store.feedbacks[idx], ...patch, ...(updatedRow || {}) };
    updatedRow = store.feedbacks[idx];
    writeJsonStore('feedbacks.json', store);
  } else if (updatedRow) {
    store.feedbacks.unshift(updatedRow);
    writeJsonStore('feedbacks.json', store);
  }

  return updatedRow;
}

// ============================================================================
// 3. USERS & NOTIFICATIONS / BROADCAST CAMPAIGNS FALLBACK STORE
// ============================================================================

export async function listAllAppUsersFallback(): Promise<Array<{ id: string; email?: string; full_name?: string; role?: string }>> {
  const usersMap = new Map<string, { id: string; email?: string; full_name?: string; role?: string }>();

  const appUsersRes = await sbRestRequest<any[]>('app_users?select=id,email,full_name,role&limit=1000');
  if (appUsersRes.ok && Array.isArray(appUsersRes.data)) {
    for (const u of appUsersRes.data) {
      if (u?.id) usersMap.set(String(u.id), u);
    }
  }

  const profilesRes = await sbRestRequest<any[]>('profiles?select=id,email,full_name&limit=1000');
  if (profilesRes.ok && Array.isArray(profilesRes.data)) {
    for (const p of profilesRes.data) {
      if (p?.id && !usersMap.has(String(p.id))) {
        usersMap.set(String(p.id), p);
      }
    }
  }

  return Array.from(usersMap.values());
}

interface NotificationsFallbackStore {
  campaigns: any[];
  banners: any[];
  userNotifications: any[];
  /** Per-user state for broadcast banners ('all'): readIds & deletedIds */
  broadcastUserState: Record<string, { readIds: string[]; deletedIds: string[] }>;
}

function readNotifStore(): NotificationsFallbackStore {
  const raw = readJsonStore<Partial<NotificationsFallbackStore>>('notifications.json', {});
  return {
    campaigns: Array.isArray(raw.campaigns) ? raw.campaigns : [],
    banners: Array.isArray(raw.banners) ? raw.banners : [],
    userNotifications: Array.isArray(raw.userNotifications) ? raw.userNotifications : [],
    broadcastUserState: raw.broadcastUserState && typeof raw.broadcastUserState === 'object' ? raw.broadcastUserState : {},
  };
}

function writeNotifStore(store: NotificationsFallbackStore): void {
  store.campaigns = store.campaigns.slice(0, 200);
  store.banners = store.banners.slice(0, 200);
  store.userNotifications = store.userNotifications.slice(0, 2000);
  writeJsonStore('notifications.json', store);
}

export async function createCampaignFallback(payload: {
  title: string;
  message: string;
  category: string;
  type: string;
  channels: string[];
  target_type: string;
  target_user_ids: string[] | null;
  deep_link: string | null;
  status: string;
  scheduled_for: string | null;
  created_by: string | null;
}): Promise<any> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const record = {
    id,
    title: payload.title,
    message: payload.message,
    category: payload.category,
    type: payload.type,
    channels: payload.channels,
    target_type: payload.target_type,
    target_user_ids: payload.target_user_ids,
    deep_link: payload.deep_link,
    status: payload.status,
    scheduled_for: payload.scheduled_for,
    total_targets: 0,
    delivered_count: 0,
    failed_count: 0,
    sent_at: null as string | null,
    created_by: payload.created_by,
    created_at: now,
    updated_at: now,
  };

  let saved = record;
  const sbRes = await sbRestRequest<any[]>('notification_campaigns', {
    method: 'POST',
    prefer: 'return=representation',
    body: record,
  });
  if (sbRes.ok && Array.isArray(sbRes.data) && sbRes.data[0]) {
    saved = sbRes.data[0];
  }

  const store = readNotifStore();
  store.campaigns = [saved, ...store.campaigns.filter((c) => c.id !== saved.id)];
  writeNotifStore(store);

  return saved;
}

export async function updateCampaignFallback(id: string, patch: Record<string, any>): Promise<any | null> {
  const now = new Date().toISOString();
  const nextPatch = { ...patch, updated_at: now };

  await sbRestRequest(`notification_campaigns?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: nextPatch,
  });

  const store = readNotifStore();
  const idx = store.campaigns.findIndex((c) => c.id === id);
  if (idx >= 0) {
    store.campaigns[idx] = { ...store.campaigns[idx], ...nextPatch };
    writeNotifStore(store);
    return store.campaigns[idx];
  }
  return null;
}

export async function listCampaignsFallback(): Promise<any[]> {
  const store = readNotifStore();
  const sbRes = await sbRestRequest<any[]>(
    'notification_campaigns?select=*&order=created_at.desc&limit=100'
  );
  const map = new Map<string, any>();
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const c of sbRes.data) {
      if (c?.id) map.set(String(c.id), c);
    }
  }
  for (const c of store.campaigns) {
    if (c?.id && !map.has(String(c.id))) {
      map.set(String(c.id), c);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

export async function createBroadcastBannerFallback(payload: {
  title: string;
  message: string;
  type: string;
  target_user_id: string;
  created_by: string | null;
  category?: string;
  deep_link?: string | null;
}): Promise<any> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const banner = {
    id,
    title: payload.title,
    message: payload.message,
    type: payload.type || 'announcement',
    target_user_id: payload.target_user_id || 'all',
    is_active: true,
    created_by: payload.created_by,
    created_at: now,
    category: payload.category || 'announcement',
    deep_link: payload.deep_link || 'dashboard',
  };

  let saved = banner;
  const sbRes = await sbRestRequest<any[]>('notifications', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      id: banner.id,
      title: banner.title,
      message: banner.message,
      type: banner.type,
      target_user_id: banner.target_user_id,
      is_active: true,
      created_by: banner.created_by,
      created_at: now,
    },
  });
  if (sbRes.ok && Array.isArray(sbRes.data) && sbRes.data[0]) {
    saved = { ...banner, ...sbRes.data[0] };
  }

  const store = readNotifStore();
  store.banners = [saved, ...store.banners.filter((b) => b.id !== saved.id)];
  writeNotifStore(store);

  return saved;
}

export async function listBroadcastBannersFallback(): Promise<any[]> {
  const store = readNotifStore();
  const sbRes = await sbRestRequest<any[]>('notifications?select=*&order=created_at.desc&limit=100');
  const map = new Map<string, any>();
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const b of sbRes.data) {
      if (b?.id) map.set(String(b.id), b);
    }
  }
  for (const b of store.banners) {
    if (b?.id && !map.has(String(b.id))) {
      map.set(String(b.id), b);
    }
  }
  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

export async function deactivateBroadcastBannerFallback(id: string): Promise<void> {
  await sbRestRequest(`notifications?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { is_active: false },
  });
  const store = readNotifStore();
  const idx = store.banners.findIndex((b) => b.id === id);
  if (idx >= 0) {
    store.banners[idx].is_active = false;
    writeNotifStore(store);
  }
}

export async function insertUserNotificationFallback(params: {
  user_id: string;
  title: string;
  message: string;
  category: string;
  type: string;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  deep_link?: string | null;
  dedupe_key?: string | null;
  metadata?: Record<string, any>;
}): Promise<any> {
  const now = new Date().toISOString();
  const id = crypto.randomUUID();
  const record = {
    id,
    user_id: params.user_id,
    title: params.title,
    message: params.message,
    category: params.category || 'general',
    type: params.type || 'info',
    related_entity_type: params.related_entity_type || null,
    related_entity_id: params.related_entity_id || null,
    deep_link: params.deep_link || null,
    dedupe_key: params.dedupe_key || null,
    is_read: false,
    read_at: null,
    is_deleted: false,
    deleted_at: null,
    metadata: params.metadata || {},
    created_at: now,
  };

  let saved = record;
  const sbRes = await sbRestRequest<any[]>('user_notifications', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      id: record.id,
      user_id: record.user_id,
      title: record.title,
      message: record.message,
      category: record.category,
      type: record.type,
      related_entity_type: record.related_entity_type,
      related_entity_id: record.related_entity_id,
      deep_link: record.deep_link,
      metadata: record.metadata,
      is_read: false,
      is_deleted: false,
      created_at: now,
    },
  });
  if (sbRes.ok && Array.isArray(sbRes.data) && sbRes.data[0]) {
    saved = sbRes.data[0];
  }

  const store = readNotifStore();
  if (params.dedupe_key) {
    const dup = store.userNotifications.find(
      (n) => n.user_id === params.user_id && (n.dedupe_key === params.dedupe_key || n.metadata?.dedupeKey === params.dedupe_key)
    );
    if (dup) return dup;
  }
  store.userNotifications = [saved, ...store.userNotifications.filter((n) => n.id !== saved.id)];
  writeNotifStore(store);

  return saved;
}

export async function listUserNotificationsFallback(
  userId: string,
  options?: { category?: string; unreadOnly?: boolean; page?: number; limit?: number }
): Promise<{ notifications: any[]; unreadCount: number; total: number }> {
  const store = readNotifStore();
  const userState = store.broadcastUserState[userId] || { readIds: [], deletedIds: [] };

  const sbUserRes = await sbRestRequest<any[]>(
    `user_notifications?user_id=eq.${encodeURIComponent(userId)}&is_deleted=eq.false&select=*&order=created_at.desc&limit=100`
  );

  const merged = new Map<string, any>();
  if (sbUserRes.ok && Array.isArray(sbUserRes.data)) {
    for (const n of sbUserRes.data) {
      if (n?.id && !n.is_deleted) merged.set(String(n.id), n);
    }
  }
  for (const n of store.userNotifications) {
    if (n?.user_id === userId && !n.is_deleted && !merged.has(String(n.id))) {
      merged.set(String(n.id), n);
    }
  }

  // Also project active global broadcast banners ('all' or targeted to this user) that don't already have a corresponding user_notifications row
  const activeBanners = await listBroadcastBannersFallback();
  const existingBroadcastIds = new Set(
    Array.from(merged.values())
      .map((n) => n?.metadata?.broadcastId)
      .filter(Boolean)
  );
  for (const b of activeBanners) {
    if (!b?.is_active) continue;
    if (b.target_user_id !== 'all' && b.target_user_id !== userId) continue;
    const virtualId = `broadcast_${b.id}`;
    if (existingBroadcastIds.has(b.id) || userState.deletedIds.includes(virtualId) || merged.has(virtualId)) {
      continue;
    }
    merged.set(virtualId, {
      id: virtualId,
      user_id: userId,
      title: b.title,
      message: b.message,
      category: b.category || 'announcement',
      type: b.type || 'announcement',
      deep_link: b.deep_link || 'dashboard',
      is_read: userState.readIds.includes(virtualId),
      is_deleted: false,
      metadata: { broadcastId: b.id, isBroadcast: true },
      created_at: b.created_at,
    });
  }

  let allList = Array.from(merged.values()).sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );

  const unreadCount = allList.filter((n) => !n.is_read).length;

  if (options?.category && options.category !== 'all') {
    allList = allList.filter((n) => n.category === options.category);
  }
  if (options?.unreadOnly) {
    allList = allList.filter((n) => !n.is_read);
  }

  const total = allList.length;
  const page = options?.page || 1;
  const limit = options?.limit || 20;
  const offset = (page - 1) * limit;

  return {
    notifications: allList.slice(offset, offset + limit),
    unreadCount,
    total,
  };
}

export async function markUserNotificationReadFallback(userId: string, notifId: string): Promise<any | null> {
  const now = new Date().toISOString();
  const store = readNotifStore();

  if (notifId.startsWith('broadcast_')) {
    const state = store.broadcastUserState[userId] || { readIds: [], deletedIds: [] };
    if (!state.readIds.includes(notifId)) state.readIds.push(notifId);
    store.broadcastUserState[userId] = state;
    writeNotifStore(store);
    return { id: notifId, user_id: userId, is_read: true, read_at: now };
  }

  await sbRestRequest(
    `user_notifications?id=eq.${encodeURIComponent(notifId)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: { is_read: true, read_at: now } }
  );

  const target = store.userNotifications.find((n) => n.id === notifId && n.user_id === userId);
  if (target) {
    target.is_read = true;
    target.read_at = now;
    writeNotifStore(store);
    return target;
  }
  return { id: notifId, user_id: userId, is_read: true, read_at: now };
}

export async function markAllUserNotificationsReadFallback(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await sbRestRequest(
    `user_notifications?user_id=eq.${encodeURIComponent(userId)}&is_deleted=eq.false&is_read=eq.false`,
    { method: 'PATCH', body: { is_read: true, read_at: now } }
  );

  const store = readNotifStore();
  for (const n of store.userNotifications) {
    if (n.user_id === userId && !n.is_deleted) {
      n.is_read = true;
      n.read_at = now;
    }
  }
  const activeBanners = await listBroadcastBannersFallback();
  const state = store.broadcastUserState[userId] || { readIds: [], deletedIds: [] };
  for (const b of activeBanners) {
    const vid = `broadcast_${b.id}`;
    if (!state.readIds.includes(vid)) state.readIds.push(vid);
  }
  store.broadcastUserState[userId] = state;
  writeNotifStore(store);
}

export async function deleteUserNotificationFallback(userId: string, notifId: string): Promise<void> {
  const now = new Date().toISOString();
  const store = readNotifStore();

  if (notifId.startsWith('broadcast_')) {
    const state = store.broadcastUserState[userId] || { readIds: [], deletedIds: [] };
    if (!state.deletedIds.includes(notifId)) state.deletedIds.push(notifId);
    store.broadcastUserState[userId] = state;
    writeNotifStore(store);
    return;
  }

  await sbRestRequest(
    `user_notifications?id=eq.${encodeURIComponent(notifId)}&user_id=eq.${encodeURIComponent(userId)}`,
    { method: 'PATCH', body: { is_deleted: true, deleted_at: now } }
  );

  const target = store.userNotifications.find((n) => n.id === notifId && n.user_id === userId);
  if (target) {
    target.is_deleted = true;
    target.deleted_at = now;
    writeNotifStore(store);
  }
}

export async function clearAllUserNotificationsFallback(userId: string): Promise<void> {
  const now = new Date().toISOString();
  await sbRestRequest(
    `user_notifications?user_id=eq.${encodeURIComponent(userId)}&is_deleted=eq.false`,
    { method: 'PATCH', body: { is_deleted: true, deleted_at: now } }
  );

  const store = readNotifStore();
  for (const n of store.userNotifications) {
    if (n.user_id === userId && !n.is_deleted) {
      n.is_deleted = true;
      n.deleted_at = now;
    }
  }
  const activeBanners = await listBroadcastBannersFallback();
  const state = store.broadcastUserState[userId] || { readIds: [], deletedIds: [] };
  for (const b of activeBanners) {
    const vid = `broadcast_${b.id}`;
    if (!state.deletedIds.includes(vid)) state.deletedIds.push(vid);
  }
  store.broadcastUserState[userId] = state;
  writeNotifStore(store);
}
