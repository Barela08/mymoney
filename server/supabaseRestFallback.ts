import fs from 'fs';
import os from 'os';
import path from 'path';
import crypto from 'crypto';

const DEFAULT_SUPABASE_URL = 'https://frgrfajnrzqwnevhlrio.supabase.co';
const DEFAULT_SUPABASE_KEY = 'sb_publishable_RHVRSE_Z4R1Qit3djpOfCA_L93zsRjg';

const PRIMARY_DATA_DIR = path.resolve(process.cwd(), '.data', 'runtime-store');
const TMP_DATA_DIR = path.resolve(os.tmpdir(), 'mymoney-runtime-store');
const memoryFallbackStore = new Map<string, any>();

function resolveWritableStoreDir(): string {
  try {
    if (!fs.existsSync(PRIMARY_DATA_DIR)) {
      fs.mkdirSync(PRIMARY_DATA_DIR, { recursive: true });
    }
    fs.accessSync(PRIMARY_DATA_DIR, fs.constants.W_OK);
    return PRIMARY_DATA_DIR;
  } catch {
    try {
      if (!fs.existsSync(TMP_DATA_DIR)) {
        fs.mkdirSync(TMP_DATA_DIR, { recursive: true });
      }
      return TMP_DATA_DIR;
    } catch {
      return PRIMARY_DATA_DIR;
    }
  }
}

function safeStoreFile(baseDir: string, name: string): string {
  const safeName = name.replace(/[^a-zA-Z0-9._-]/g, '_');
  const resolved = path.resolve(baseDir, safeName);
  if (!resolved.startsWith(baseDir + path.sep)) {
    throw new Error('PATH_CONFINEMENT_VIOLATION');
  }
  return resolved;
}

function readJsonStore<T>(fileName: string, defaultValue: T): T {
  const dirsToTry = [PRIMARY_DATA_DIR, TMP_DATA_DIR];
  for (const dir of dirsToTry) {
    try {
      const file = safeStoreFile(dir, fileName);
      if (fs.existsSync(file)) {
        const raw = fs.readFileSync(file, 'utf8');
        if (raw.trim()) {
          const parsed = JSON.parse(raw) as T;
          memoryFallbackStore.set(fileName, parsed);
          return parsed;
        }
      }
    } catch {
      // Try next dir or memory fallback
    }
  }
  if (memoryFallbackStore.has(fileName)) {
    return memoryFallbackStore.get(fileName) as T;
  }
  return defaultValue;
}

function writeJsonStore<T>(fileName: string, data: T): void {
  memoryFallbackStore.set(fileName, data);
  try {
    const baseDir = resolveWritableStoreDir();
    const file = safeStoreFile(baseDir, fileName);
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

// ============================================================================
// 4. EMAIL LOGS & TEMPLATES FALLBACK
// ============================================================================

const DEFAULT_EMAIL_TEMPLATES = [
  {
    id: 'tmpl_welcome_email',
    slug: 'welcome-email',
    name: 'Welcome & Account Verification',
    category: 'authentication',
    subject: 'Welcome to {{app_name}}! Your Account is Active',
    variables: ['user_name', 'app_name', 'support_email', 'date'],
    text_content:
      'Hi {{user_name}},\n\nWelcome to {{app_name}}! Your account has been created successfully on {{date}}.\n\nNeed assistance? Contact {{support_email}}.\n\nBest regards,\n{{app_name}} Team',
    html_content:
      '<div style="font-family: sans-serif; padding: 20px;"><h2>Welcome, {{user_name}}!</h2><p>Your account on <strong>{{app_name}}</strong> is now active.</p><p>Registration Date: {{date}}</p><p>If you have any questions, reach out at <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></div>',
    is_active: true,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_password_reset',
    slug: 'password-reset',
    name: 'Password Reset Request',
    category: 'security',
    subject: 'Reset Your My Money Manager Password',
    variables: ['user_name', 'app_name', 'reset_link', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\nA password reset request was received for your {{app_name}} account.\n\nReset Link: {{reset_link}}\n\nThis link expires in 15 minutes.\n\nIf you did not request this, please contact {{support_email}} immediately.',
    html_content:
      '<div style="font-family: sans-serif; padding: 20px;"><h2>Password Reset Request</h2><p>Hi {{user_name}}, click the button below to reset your password:</p><p><a href="{{reset_link}}" style="background: #059669; color: #fff; padding: 10px 20px; text-decoration: none; border-radius: 6px;">Reset Password</a></p><p>Link expires in 15 minutes.</p></div>',
    is_active: true,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_password_changed',
    slug: 'password-changed',
    name: 'Security Alert: Password Changed',
    category: 'security',
    subject: '[Security Alert] Your Password Was Successfully Changed — {{app_name}}',
    variables: ['user_name', 'app_name', 'date', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\nYour password for {{app_name}} was successfully updated on {{date}}.\nAll other device sessions have been revoked.\n\nIf you did not make this change, please contact {{support_email}} immediately.',
    html_content:
      '<div style="font-family: sans-serif; padding: 20px;"><h2>Security Alert: Password Changed</h2><p>Hi {{user_name}}, your password was updated on {{date}}.</p><p>All other device sessions were revoked for your safety.</p></div>',
    is_active: true,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_feedback_confirmation',
    slug: 'feedback-confirmation',
    name: 'User Feedback Confirmation & Admin Alert',
    category: 'support',
    subject: 'Thank You for Your Feedback — {{app_name}}',
    variables: ['user_name', 'app_name', 'rating', 'category', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\nThank you for sharing your {{rating}}-star feedback with {{app_name}} by HackifyPro. Our team reviews every submission carefully.',
    html_content:
      '<div style="font-family: sans-serif; padding: 20px;"><h2>Thank You for Your Feedback</h2><p>Hi {{user_name}}, we appreciate your {{rating}}-star feedback for <strong>{{app_name}}</strong>.</p></div>',
    is_active: true,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_deletion_scheduled',
    slug: 'deletion-scheduled',
    name: 'Account Deletion Scheduled Notice',
    category: 'lifecycle',
    subject: '[Notice] Account Deletion Scheduled (24-Hour Grace Period) — {{app_name}}',
    variables: ['user_name', 'app_name', 'scheduled_date', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\nYou requested deletion of your account. It is scheduled for permanent purge on {{scheduled_date}} (24-hour statutory grace period).\n\nYou can cancel this deletion at any time before the scheduled date by logging in.',
    html_content:
      '<div style="font-family: sans-serif; padding: 20px;"><h2>Account Deletion Scheduled</h2><p>Hi {{user_name}}, your account is scheduled for deletion on {{scheduled_date}}.</p><p>You may cancel by logging into your account anytime before this window ends.</p></div>',
    is_active: true,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
];

export async function listEmailTemplatesFallback(): Promise<any[]> {
  const sbRes = await sbRestRequest<any[]>('email_templates?select=*&order=category.asc,name.asc');
  const stored = readJsonStore<{ templates: any[] }>('email-templates.json', { templates: [] });
  const map = new Map<string, any>();

  for (const t of DEFAULT_EMAIL_TEMPLATES) {
    map.set(t.id, { ...t });
  }
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (row?.id) map.set(String(row.id), row);
    }
  }
  for (const row of stored.templates) {
    if (row?.id) map.set(String(row.id), row);
  }
  return Array.from(map.values()).sort((a, b) =>
    `${a.category || ''}:${a.name || ''}`.localeCompare(`${b.category || ''}:${b.name || ''}`)
  );
}

export async function updateEmailTemplateFallback(
  id: string,
  updates: { subject?: string; html_content?: string; text_content?: string; is_active?: boolean }
): Promise<any | null> {
  const all = await listEmailTemplatesFallback();
  const existing = all.find((t) => t.id === id);
  if (!existing) return null;

  const updated = {
    ...existing,
    subject: updates.subject !== undefined ? updates.subject : existing.subject,
    html_content: updates.html_content !== undefined ? updates.html_content : existing.html_content,
    text_content: updates.text_content !== undefined ? updates.text_content : existing.text_content,
    is_active: updates.is_active !== undefined ? updates.is_active : existing.is_active,
    version: Number(existing.version || 1) + 1,
    updated_at: new Date().toISOString(),
  };

  await sbRestRequest(`email_templates?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: {
      subject: updated.subject,
      html_content: updated.html_content,
      text_content: updated.text_content,
      is_active: updated.is_active,
      version: updated.version,
      updated_at: updated.updated_at,
    },
  });

  const stored = readJsonStore<{ templates: any[] }>('email-templates.json', { templates: [] });
  stored.templates = [updated, ...stored.templates.filter((t) => t.id !== id)];
  writeJsonStore('email-templates.json', stored);
  return updated;
}

export async function recordEmailLogFallback(entry: {
  id?: string;
  user_id?: string | null;
  email: string;
  email_type: string;
  recipient_name?: string;
  subject: string;
  status: 'sent' | 'failed' | 'pending' | 'retrying' | string;
  attempts?: number;
  last_error?: string | null;
  trigger_event?: string;
}): Promise<any> {
  const now = new Date().toISOString();
  const row = {
    id: entry.id || crypto.randomUUID(),
    user_id: entry.user_id || null,
    email: entry.email,
    email_type: entry.email_type,
    recipient_name: entry.recipient_name || '',
    subject: entry.subject,
    status: entry.status,
    attempts: entry.attempts ?? 1,
    max_attempts: 3,
    last_error: entry.last_error || null,
    trigger_event: entry.trigger_event || entry.email_type,
    sent_at: entry.status === 'sent' ? now : null,
    created_at: now,
    updated_at: now,
  };

  const store = readJsonStore<{ logs: any[] }>('email-logs.json', { logs: [] });
  store.logs = [row, ...store.logs.filter((l) => l.id !== row.id)].slice(0, 200);
  writeJsonStore('email-logs.json', store);
  return row;
}

export async function listEmailLogsFallback(status?: string): Promise<any[]> {
  const sbRes = await sbRestRequest<any[]>('email_dispatch_logs?select=*&order=created_at.desc&limit=100');
  const store = readJsonStore<{ logs: any[] }>('email-logs.json', { logs: [] });

  const map = new Map<string, any>();
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (row?.id) map.set(String(row.id), row);
    }
  }
  for (const row of store.logs) {
    if (row?.id && !map.has(String(row.id))) {
      map.set(String(row.id), row);
    }
  }

  let logs = Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
  if (status && status !== 'all') {
    logs = logs.filter((l) => l.status === status);
  }
  return logs.slice(0, 100);
}

export async function getEmailLogByIdFallback(id: string): Promise<any | null> {
  const logs = await listEmailLogsFallback();
  return logs.find((l) => l.id === id) || null;
}

export async function updateEmailLogFallback(id: string, patch: Record<string, any>): Promise<void> {
  const store = readJsonStore<{ logs: any[] }>('email-logs.json', { logs: [] });
  const idx = store.logs.findIndex((l) => l.id === id);
  if (idx >= 0) {
    store.logs[idx] = { ...store.logs[idx], ...patch, updated_at: new Date().toISOString() };
    writeJsonStore('email-logs.json', store);
  }
  await sbRestRequest(`email_dispatch_logs?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { ...patch, updated_at: new Date().toISOString() },
  });
}

// ============================================================================
// 5. FEATURE FLAGS FALLBACK
// ============================================================================

const DEFAULT_FEATURE_FLAGS = [
  { id: 'feat_ai_money_assistant', key: 'ai_money_assistant', name: 'AI Money Assistant', description: 'Intelligent conversational & Voice Agent assistant for spending insights and guidance', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_smart_categorization', key: 'smart_categorization', name: 'Smart Transaction Categorization', description: 'Auto-detecting category & subcategory from merchant and description', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_expense_calendar', key: 'expense_calendar', name: 'Expense Calendar View', description: 'Day-by-day interactive financial timeline and spending heatmap', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_smart_financial_alerts', key: 'smart_financial_alerts', name: 'Smart Financial Alerts', description: 'Proactive budget threshold warning and anomaly detection', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_receipt_scanner_ocr', key: 'receipt_scanner_ocr', name: 'Receipt Scanner OCR', description: 'Optical character recognition to parse paper bills and receipts', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_net_worth_tracker', key: 'net_worth_tracker', name: 'Net Worth Tracker', description: 'Consolidated asset, savings, and liability calculation', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_safe_to_spend', key: 'safe_to_spend', name: 'Safe-to-Spend Calculator', description: 'Real-time liquidity buffer calculation after committed bills', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_udhar_ledger', key: 'udhar_ledger', name: 'Udhar / Debt Tracking Ledger', description: 'Lending, borrowing, reminder dispatch, and settlement ledger', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_qr_linking', key: 'qr_linking', name: 'QR Code Device Pairing', description: 'Quick scan peer connection and ledger reconciliation', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_calculator', key: 'calculator', name: 'Smart Financial Calculator', description: 'Interactive standard, GST, offer, and group split calculation tools', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_push_notifications', key: 'push_notifications', name: 'Web Push & In-App Broadcasts', description: 'PWA Web Push notifications and broadcast announcements', is_enabled: true, rollout_percentage: 100 },
  { id: 'feat_reports_export', key: 'reports_export', name: 'Financial Reports & PDF Export', description: 'Downloadable summary statements and monthly analytics', is_enabled: true, rollout_percentage: 100 },
];

export async function listFeatureFlagsFallback(): Promise<any[]> {
  const sbRes = await sbRestRequest<any[]>('feature_flags?select=*&order=name.asc');
  const stored = readJsonStore<{ features: any[] }>('feature-flags.json', { features: [] });
  const mapByKey = new Map<string, any>();

  for (const f of DEFAULT_FEATURE_FLAGS) {
    mapByKey.set(f.key, { ...f });
  }
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (row?.key) mapByKey.set(String(row.key), row);
    }
  }
  for (const row of stored.features) {
    if (row?.key) mapByKey.set(String(row.key), row);
  }
  return Array.from(mapByKey.values()).sort((a, b) => String(a.name || '').localeCompare(String(b.name || '')));
}

export async function updateFeatureFlagFallback(
  id: string,
  updates: { is_enabled?: boolean; rollout_percentage?: number; updated_by?: string }
): Promise<any | null> {
  const all = await listFeatureFlagsFallback();
  const existing = all.find((f) => f.id === id || f.key === id);
  if (!existing) return null;

  const updated = {
    ...existing,
    is_enabled: updates.is_enabled !== undefined ? updates.is_enabled : existing.is_enabled,
    rollout_percentage: updates.rollout_percentage !== undefined ? updates.rollout_percentage : existing.rollout_percentage,
    updated_by: updates.updated_by || 'admin',
    updated_at: new Date().toISOString(),
  };

  await sbRestRequest(`feature_flags?id=eq.${encodeURIComponent(existing.id)}`, {
    method: 'PATCH',
    body: {
      is_enabled: updated.is_enabled,
      rollout_percentage: updated.rollout_percentage,
      updated_by: updated.updated_by,
      updated_at: updated.updated_at,
    },
  });

  const stored = readJsonStore<{ features: any[] }>('feature-flags.json', { features: [] });
  stored.features = [updated, ...stored.features.filter((f) => f.id !== existing.id && f.key !== existing.key)];
  writeJsonStore('feature-flags.json', stored);
  return updated;
}

// ============================================================================
// 6. LEGAL POLICIES & VERSION HISTORY FALLBACK
// ============================================================================

const DEFAULT_LEGAL_POLICIES = [
  {
    id: 'legal_privacy_policy',
    slug: 'privacy-policy',
    title: 'Privacy Policy',
    version: '2.1',
    status: 'published',
    content: `# Privacy Policy — My Money Manager by HackifyPro\nLast Updated: November 2026\n\nAt My Money Manager by HackifyPro, we respect your privacy and safeguard your personal financial records.\nAll transaction entries, budgets, and Udhar balances are strictly user-scoped.\nAdministrators cannot view your private financial transactions without an explicit, time-limited user consent grant.\nWe comply with India's Digital Personal Data Protection (DPDP) Act 2023.`,
    updated_at: '2026-11-25T00:00:00.000Z',
    published_at: '2026-11-25T00:00:00.000Z',
    created_by: 'HackifyPro Legal',
  },
  {
    id: 'legal_terms_conditions',
    slug: 'terms-and-conditions',
    title: 'Terms & Conditions',
    version: '2.0',
    status: 'published',
    content: `# Terms and Conditions — My Money Manager by HackifyPro\nLast Updated: November 2026\n\nBy accessing My Money Manager, you agree to these terms:\n1. Account Responsibility: Keep your password and devices secure.\n2. Acceptable Use: Do not attempt unauthorized access to APIs or other user records.\n3. Financial Insights: AI insights and calculators are informational aids, not regulated financial advice.`,
    updated_at: '2026-11-25T00:00:00.000Z',
    published_at: '2026-11-25T00:00:00.000Z',
    created_by: 'HackifyPro Legal',
  },
  {
    id: 'legal_data_retention',
    slug: 'data-retention-policy',
    title: 'Data Retention & Deletion Policy',
    version: '1.5',
    status: 'published',
    content: `# Data Retention & Deletion Policy\nLast Updated: November 2026\n\n1. Account Deletion: Initiating deletion starts a mandatory 24-hour grace window during which you may cancel.\n2. Permanent Purge: Once finalized, personal transactions, sessions, and profile records are permanently purged.\n3. Security Audit Logs: Minimal anonymized audit trails may be retained for fraud prevention and statutory compliance.`,
    updated_at: '2026-11-25T00:00:00.000Z',
    published_at: '2026-11-25T00:00:00.000Z',
    created_by: 'HackifyPro Legal',
  },
  {
    id: 'legal_cookie_policy',
    slug: 'cookie-policy',
    title: 'Cookie & Session Policy',
    version: '1.2',
    status: 'published',
    content: `# Cookie & Session Policy\nLast Updated: November 2026\n\nMy Money Manager uses strictly necessary session storage and HttpOnly cookies for authentication security.\nNo third-party advertising or cross-site tracking cookies are used.`,
    updated_at: '2026-11-25T00:00:00.000Z',
    published_at: '2026-11-25T00:00:00.000Z',
    created_by: 'HackifyPro Legal',
  },
];

export async function listLegalPoliciesFallback(): Promise<any[]> {
  const sbRes = await sbRestRequest<any[]>('legal_policies?select=*&order=title.asc');
  const stored = readJsonStore<{ policies: any[]; versions: any[] }>('legal-policies.json', { policies: [], versions: [] });
  const map = new Map<string, any>();

  for (const p of DEFAULT_LEGAL_POLICIES) {
    map.set(p.slug, { ...p });
  }
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (row?.slug) map.set(String(row.slug), row);
    }
  }
  for (const row of stored.policies) {
    if (row?.slug) map.set(String(row.slug), row);
  }
  return Array.from(map.values()).sort((a, b) => String(a.title || '').localeCompare(String(b.title || '')));
}

export async function getLegalPolicyVersionsFallback(policyId: string): Promise<any[]> {
  const sbRes = await sbRestRequest<any[]>(
    `legal_policy_versions?policy_id=eq.${encodeURIComponent(policyId)}&select=*&order=created_at.desc`
  );
  const stored = readJsonStore<{ policies: any[]; versions: any[] }>('legal-policies.json', { policies: [], versions: [] });
  const versions: any[] = [];
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    versions.push(...sbRes.data);
  }
  for (const v of stored.versions) {
    if (v.policy_id === policyId && !versions.some((x) => x.id === v.id)) {
      versions.push(v);
    }
  }
  if (versions.length === 0) {
    const policies = await listLegalPoliciesFallback();
    const match = policies.find((p) => p.id === policyId);
    if (match) {
      versions.push({
        id: `ver_${match.id}_${match.version}`,
        policy_id: match.id,
        slug: match.slug,
        version: match.version,
        content: match.content,
        status: match.status || 'published',
        created_by: match.created_by || 'System Admin',
        published_at: match.published_at || match.updated_at,
        created_at: match.updated_at,
      });
    }
  }
  return versions;
}

export async function updateLegalPolicyFallback(
  policyId: string,
  updates: { title?: string; version?: string; content?: string; status?: string; created_by?: string }
): Promise<any | null> {
  const all = await listLegalPoliciesFallback();
  const existing = all.find((p) => p.id === policyId);
  if (!existing) return null;

  const now = new Date().toISOString();
  const updated = {
    ...existing,
    title: updates.title || existing.title,
    version: updates.version || existing.version,
    content: updates.content || existing.content,
    status: updates.status || 'published',
    created_by: updates.created_by || 'Admin',
    published_at: now,
    updated_at: now,
  };

  await sbRestRequest(`legal_policies?id=eq.${encodeURIComponent(policyId)}`, {
    method: 'PATCH',
    body: {
      title: updated.title,
      version: updated.version,
      content: updated.content,
      status: updated.status,
      created_by: updated.created_by,
      published_at: now,
      updated_at: now,
    },
  });

  const stored = readJsonStore<{ policies: any[]; versions: any[] }>('legal-policies.json', { policies: [], versions: [] });
  stored.policies = [updated, ...stored.policies.filter((p) => p.id !== policyId)];
  stored.versions.unshift({
    id: crypto.randomUUID(),
    policy_id: policyId,
    slug: updated.slug,
    version: updated.version,
    content: updated.content,
    status: updated.status,
    created_by: updated.created_by,
    published_at: now,
    created_at: now,
  });
  stored.versions = stored.versions.slice(0, 100);
  writeJsonStore('legal-policies.json', stored);
  return updated;
}

// ============================================================================
// 7. USER ACTIVITY, SESSIONS, ROLES & ADMIN FALLBACKS
// ============================================================================

export async function listUserActivityFallback(userId: string, userEmail?: string): Promise<any[]> {
  const email = userEmail || '';
  const sbRes = await sbRestRequest<any[]>(
    `security_audit_logs?select=id,event_type,user_email,actor_role,ip_address,details,created_at&order=created_at.desc&limit=50`
  );
  if (!sbRes.ok || !Array.isArray(sbRes.data)) return [];
  return sbRes.data.filter(
    (row) => row.user_id === userId || (email && String(row.user_email || '').toLowerCase() === email.toLowerCase())
  );
}

export async function listUserSessionsFallback(userId: string): Promise<any[]> {
  const sbRes = await sbRestRequest<any[]>(
    `user_sessions?user_id=eq.${encodeURIComponent(userId)}&select=id,user_agent,ip_address,expires_at,is_revoked,created_at,last_active_at&order=created_at.desc&limit=20`
  );
  return sbRes.ok && Array.isArray(sbRes.data) ? sbRes.data : [];
}

const DEFAULT_ADMIN_ROLES = [
  {
    id: 'role_superadmin',
    name: 'Super Administrator',
    slug: 'superadmin',
    description: 'Full unrestricted control across My Money Manager Control Center.',
    permissions: ['*'],
    is_system: true,
  },
  {
    id: 'role_admin',
    name: 'Administrator',
    slug: 'admin',
    description: 'Platform management across users, support, notifications, AI, and settings.',
    permissions: [
      'dashboard.view', 'users.view', 'users.update', 'users.suspend', 'users.financial_data.request',
      'analytics.view', 'notifications.view', 'notifications.send', 'notifications.manage',
      'features.manage', 'settings.manage', 'security.view', 'audit_logs.view', 'support.manage', 'ai.manage',
    ],
    is_system: true,
  },
  {
    id: 'role_support',
    name: 'Support Specialist',
    slug: 'support',
    description: 'Handles user tickets, feedback replies, and read-only user assistance.',
    permissions: ['dashboard.view', 'users.view', 'support.manage', 'notifications.view', 'audit_logs.view'],
    is_system: true,
  },
  {
    id: 'role_analyst',
    name: 'Operations Analyst',
    slug: 'analyst',
    description: 'Read-only access to metrics, analytics, and audit logs.',
    permissions: ['dashboard.view', 'users.view', 'analytics.view', 'audit_logs.view'],
    is_system: true,
  },
];

export async function listAdminRolesFallback(): Promise<any[]> {
  const sbRes = await sbRestRequest<any[]>('admin_roles?select=*&order=is_system.desc,name.asc');
  const stored = readJsonStore<{ roles: any[] }>('admin-roles.json', { roles: [] });
  const map = new Map<string, any>();
  for (const r of DEFAULT_ADMIN_ROLES) map.set(r.slug, { ...r });
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (row?.slug) map.set(String(row.slug), row);
    }
  }
  for (const row of stored.roles) {
    if (row?.slug) map.set(String(row.slug), row);
  }
  return Array.from(map.values());
}

export async function updateAdminRoleFallback(
  id: string,
  updates: { permissions?: string[]; description?: string }
): Promise<any | null> {
  const all = await listAdminRolesFallback();
  const existing = all.find((r) => r.id === id || r.slug === id);
  if (!existing) return null;
  const updated = {
    ...existing,
    permissions: updates.permissions ?? existing.permissions,
    description: updates.description ?? existing.description,
    updated_at: new Date().toISOString(),
  };
  const stored = readJsonStore<{ roles: any[] }>('admin-roles.json', { roles: [] });
  stored.roles = [updated, ...stored.roles.filter((r) => r.id !== existing.id)];
  writeJsonStore('admin-roles.json', stored);
  return updated;
}

export async function listSecurityIncidentsFallback(status?: string, severity?: string): Promise<any[]> {
  const sbRes = await sbRestRequest<any[]>('security_incidents?select=*&order=created_at.desc&limit=100');
  const stored = readJsonStore<{ incidents: any[] }>('security-incidents.json', { incidents: [] });
  const map = new Map<string, any>();
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) if (row?.id) map.set(String(row.id), row);
  }
  for (const row of stored.incidents) if (row?.id) map.set(String(row.id), row);
  let rows = Array.from(map.values());
  if (status && status !== 'all') rows = rows.filter((r) => r.status === status);
  if (severity && severity !== 'all') rows = rows.filter((r) => r.severity === severity);
  return rows;
}

export async function createSecurityIncidentFallback(payload: {
  title: string;
  severity: string;
  description: string;
  user_email?: string | null;
}): Promise<any> {
  const now = new Date().toISOString();
  const row = {
    id: crypto.randomUUID(),
    title: payload.title,
    severity: payload.severity || 'medium',
    description: payload.description || '',
    user_email: payload.user_email || null,
    status: 'new',
    created_at: now,
    updated_at: now,
  };
  const stored = readJsonStore<{ incidents: any[] }>('security-incidents.json', { incidents: [] });
  stored.incidents = [row, ...stored.incidents].slice(0, 100);
  writeJsonStore('security-incidents.json', stored);
  return row;
}

export async function getAdminDashboardStatsFallback(): Promise<{
  stats: Record<string, any>;
  charts: { registrations: any[]; logins: any[] };
  recentActivity: any[];
}> {
  const users = await listAllAppUsersFallback();
  const activeUsers = users.filter((u: any) => !u.status || u.status === 'active').length;
  const suspendedUsers = users.filter((u: any) => u.status === 'suspended').length;
  const inactiveUsers = users.filter((u: any) => u.status === 'deactivated').length;
  const logsRes = await sbRestRequest<any[]>('security_audit_logs?select=id,event_type,user_email,actor_role,created_at,details&order=created_at.desc&limit=10');
  const recentActivity = logsRes.ok && Array.isArray(logsRes.data) ? logsRes.data : [];

  return {
    stats: {
      totalUsers: users.length,
      newToday: 0,
      newWeek: 0,
      newMonth: users.length,
      activeUsers,
      suspendedUsers,
      inactiveUsers,
      pendingDeletions: 0,
      failedLogins24h: 0,
      lockedAccounts: 0,
      activeSessions: activeUsers,
      openIncidents: 0,
      dbHealth: 'Operational (Supabase REST Fallback)',
      emailServiceStatus: process.env.SMTP_PASS ? 'Operational (SMTP Configured)' : 'SMTP_PASS Required',
    },
    charts: { registrations: [], logins: [] },
    recentActivity,
  };
}

