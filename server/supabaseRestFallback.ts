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

export async function purgeUdharNotificationsFallback(linkId: string, txId?: string): Promise<void> {
  if (!linkId && !txId) return;
  const now = new Date().toISOString();
  const store = readNotifStore();
  let changed = false;

  for (const b of store.banners) {
    if (
      b &&
      b.is_active !== false &&
      ((linkId && b.related_entity_id === linkId) || (txId && b.related_entity_id === txId))
    ) {
      b.is_active = false;
      changed = true;
    }
  }

  for (const n of store.userNotifications) {
    if (!n || n.is_deleted) continue;
    const meta = n.metadata || {};
    const matchesLink =
      Boolean(linkId) &&
      (n.related_entity_id === linkId ||
        meta.relatedEntityId === linkId ||
        meta.linkId === linkId);
    const matchesTx =
      Boolean(txId) &&
      (n.related_entity_id === txId || meta.udharId === txId || meta.transactionId === txId);
    if (matchesLink || matchesTx) {
      n.is_deleted = true;
      n.deleted_at = now;
      changed = true;
    }
  }

  if (changed) {
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

export const DEFAULT_EMAIL_TEMPLATES = [
  {
    id: 'tmpl_welcome_email',
    slug: 'welcome-email',
    name: 'Welcome & Account Verification',
    category: 'authentication',
    subject: 'Welcome to {{app_name}}! Your Account is Active',
    variables: ['user_name', 'user_email', 'app_name', 'company_name', 'login_url', 'support_email', 'support_phone', 'date'],
    text_content:
      'Hi {{user_name}},\n\nWelcome to {{app_name}} by {{company_name}}! Your account ({{user_email}}) has been created successfully on {{date}}.\n\nLogin here: {{login_url}}\nNeed assistance? Contact {{support_email}}.\n\nBest regards,\n{{app_name}} Team',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;"><div style="background: #065f46; padding: 24px; text-align: center; color: #ffffff;"><h2 style="margin: 0;">Welcome to {{app_name}}!</h2><p style="margin: 6px 0 0; font-size: 12px; color: #a7f3d0;">by {{company_name}}</p></div><div style="padding: 24px; color: #1e293b; font-size: 14px; line-height: 1.6;"><p>Hi <strong>{{user_name}}</strong>,</p><p>Your account (<strong>{{user_email}}</strong>) is now active as of {{date}}.</p><p style="text-align: center; margin: 24px 0;"><a href="{{login_url}}" style="background: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 10px; font-weight: 700;">Open {{app_name}}</a></p><p style="font-size: 12px; color: #64748b;">Need help? Reach out at <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></div></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_password_reset',
    slug: 'password-reset',
    name: 'Password Reset Request',
    category: 'security',
    subject: 'Reset Your {{app_name}} Password',
    variables: ['user_name', 'user_email', 'app_name', 'company_name', 'reset_link', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\nA password reset request was received for your {{app_name}} account ({{user_email}}).\n\nReset Link: {{reset_link}}\n\nThis link expires in 15 minutes. If you did not request this, contact {{support_email}}.',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #065f46; margin-top: 0;">Password Reset Request</h2><p>Hi <strong>{{user_name}}</strong>, click below to reset the password for {{user_email}}:</p><p style="text-align: center; margin: 22px 0;"><a href="{{reset_link}}" style="background: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 10px; font-weight: 700;">Reset Password</a></p><p style="font-size: 12px; color: #64748b;">Link expires in 15 minutes. Support: {{support_email}}</p></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_password_changed',
    slug: 'password-changed',
    name: 'Security Alert: Password Changed',
    category: 'security',
    subject: '[Security Alert] Your Password Was Changed — {{app_name}}',
    variables: ['user_name', 'user_email', 'app_name', 'company_name', 'date', 'ip_address', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\nYour password for {{app_name}} ({{user_email}}) was updated on {{date}} (IP: {{ip_address}}).\nAll previous sessions were revoked.\n\nIf you did not make this change, contact {{support_email}} immediately.',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #065f46; margin-top: 0;">Security Alert: Password Changed</h2><p>Hi <strong>{{user_name}}</strong>, your password for {{user_email}} was updated on <strong>{{date}}</strong> (IP: {{ip_address}}).</p><p>All previous device sessions have been revoked for your protection.</p><p style="color: #b91c1c; font-weight: 600;">Not you? Contact {{support_email}} immediately.</p></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_feedback_confirmation',
    slug: 'feedback-confirmation',
    name: 'Feedback Received (User Confirmation)',
    category: 'support',
    subject: 'Thank You for Your Feedback (#{{feedback_id}}) — {{app_name}}',
    variables: ['user_name', 'user_email', 'feedback_id', 'rating', 'category', 'message', 'app_name', 'company_name', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\nThank you for sharing your {{rating}}-star feedback (#{{feedback_id}}) with {{app_name}} by {{company_name}}.\n\nCategory: {{category}}\nMessage: {{message}}\n\nOur product team reviews every submission carefully.',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;"><div style="background: #065f46; padding: 20px; text-align: center; color: #ffffff;"><h2 style="margin: 0;">Thank You for Your Feedback!</h2><p style="margin: 4px 0 0; font-size: 12px; color: #a7f3d0;">{{app_name}} by {{company_name}}</p></div><div style="padding: 24px; color: #1e293b; font-size: 14px; line-height: 1.6;"><p>Hi <strong>{{user_name}}</strong>,</p><p>We received your <strong>{{rating}}/5</strong> rating (Ref: <code>#{{feedback_id}}</code>, Category: {{category}}):</p><blockquote style="background: #f8fafc; border-left: 4px solid #059669; margin: 14px 0; padding: 12px 16px;">{{message}}</blockquote><p style="font-size: 12px; color: #64748b;">Support: {{support_email}}</p></div></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_feedback_admin',
    slug: 'feedback-admin-alert',
    name: 'New User Feedback Alert (To Admin)',
    category: 'support',
    subject: '[Admin Alert] New {{rating}}★ Feedback (#{{feedback_id}}) from {{user_name}}',
    variables: ['user_name', 'user_email', 'user_id', 'feedback_id', 'rating', 'message', 'submitted_at', 'app_name', 'company_name'],
    text_content:
      'New User Feedback Received — {{app_name}} ({{company_name}})\n\nRef: #{{feedback_id}}\nFrom: {{user_name}} ({{user_email}})\nRating: {{rating}}/5\nSubmitted At: {{submitted_at}}\n\nMessage:\n{{message}}',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #065f46; margin-top: 0;">New User Feedback (#{{feedback_id}})</h2><p><strong>User:</strong> {{user_name}} ({{user_email}})</p><p><strong>Rating:</strong> {{rating}}/5 · <strong>Submitted:</strong> {{submitted_at}}</p><div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px; margin-top: 12px;">{{message}}</div></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_complaint_confirmation',
    slug: 'complaint-confirmation',
    name: 'Complaint Registered (User Confirmation)',
    category: 'support',
    subject: 'Complaint Registered (#{{ticket_number}}) — {{app_name}}',
    variables: ['user_name', 'user_email', 'ticket_number', 'category', 'subject', 'description', 'app_name', 'company_name', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\nYour complaint #{{ticket_number}} has been registered with {{app_name}} by {{company_name}}.\n\nCategory: {{category}}\nSubject: {{subject}}\nDetails: {{description}}\n\nOur support team will respond shortly.',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #065f46; margin-top: 0;">Complaint Registered (#{{ticket_number}})</h2><p>Hi <strong>{{user_name}}</strong>, we have logged your complaint under <strong>{{category}}</strong>.</p><p><strong>Subject:</strong> {{subject}}</p><div style="background: #fef2f2; border: 1px solid #fecaca; border-radius: 10px; padding: 12px;">{{description}}</div><p style="font-size: 12px; color: #64748b; margin-top: 16px;">Need urgent help? Contact {{support_email}}.</p></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_complaint_admin',
    slug: 'complaint-admin-alert',
    name: 'New User Complaint Alert (To Admin)',
    category: 'support',
    subject: '[Complaint Alert] #{{ticket_number}}: {{subject}}',
    variables: ['user_name', 'user_email', 'user_phone', 'ticket_number', 'category', 'subject', 'description', 'submitted_at', 'app_name'],
    text_content:
      'New Complaint Alert — {{app_name}}\n\nTicket: #{{ticket_number}}\nUser: {{user_name}} ({{user_email}}, Phone: {{user_phone}})\nCategory: {{category}}\nSubject: {{subject}}\nSubmitted: {{submitted_at}}\n\nDescription:\n{{description}}',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #fecaca; border-radius: 16px; padding: 24px;"><h2 style="color: #b91c1c; margin-top: 0;">New Complaint Alert (#{{ticket_number}})</h2><p><strong>From:</strong> {{user_name}} ({{user_email}} · {{user_phone}})</p><p><strong>Category:</strong> {{category}} · <strong>Subject:</strong> {{subject}}</p><div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px;">{{description}}</div></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_support_confirmation',
    slug: 'support-confirmation',
    name: 'Support Ticket Received (User Confirmation)',
    category: 'support',
    subject: 'Support Ticket Created (#{{ticket_number}}) — {{app_name}}',
    variables: ['user_name', 'user_email', 'ticket_number', 'category', 'subject', 'description', 'app_name', 'company_name', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\nYour support request #{{ticket_number}} has been received by {{app_name}} ({{company_name}}).\n\nSubject: {{subject}}\nCategory: {{category}}\nMessage: {{description}}\n\nWe will notify you by email and push alert when our team replies.',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #065f46; margin-top: 0;">Support Ticket Created (#{{ticket_number}})</h2><p>Hi <strong>{{user_name}}</strong>, thank you for contacting {{app_name}} Support.</p><p><strong>Subject:</strong> {{subject}} ({{category}})</p><div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 12px;">{{description}}</div><p style="font-size: 12px; color: #64748b; margin-top: 14px;">Support: {{support_email}}</p></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_support_admin',
    slug: 'support-admin-alert',
    name: 'New Support Request Alert (To Admin)',
    category: 'support',
    subject: '[Support Request] #{{ticket_number}}: {{subject}}',
    variables: ['user_name', 'user_email', 'ticket_number', 'category', 'subject', 'description', 'submitted_at', 'app_name'],
    text_content:
      'New Support Ticket — {{app_name}}\n\nTicket: #{{ticket_number}}\nUser: {{user_name}} ({{user_email}})\nCategory: {{category}}\nSubject: {{subject}}\nSubmitted: {{submitted_at}}\n\nDescription:\n{{description}}',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #0f766e; margin-top: 0;">New Support Request (#{{ticket_number}})</h2><p><strong>From:</strong> {{user_name}} ({{user_email}})</p><p><strong>Category:</strong> {{category}} · <strong>Subject:</strong> {{subject}}</p><div style="background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 10px; padding: 14px;">{{description}}</div></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_admin_ticket_reply',
    slug: 'admin-ticket-reply',
    name: 'Admin Reply to User Support Ticket',
    category: 'support',
    subject: 'Re: [Ticket #{{ticket_number}}] {{original_subject}} — {{app_name}}',
    variables: ['user_name', 'ticket_number', 'ticket_type', 'original_subject', 'admin_reply', 'admin_name', 'status', 'app_name', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\n{{admin_name}} replied to your ticket #{{ticket_number}} ({{original_subject}}) [Status: {{status}}]:\n\n{{admin_reply}}\n\nBest regards,\n{{app_name}} Support',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #065f46; margin-top: 0;">Update on Ticket #{{ticket_number}}</h2><p>Hi <strong>{{user_name}}</strong>,</p><p><strong>{{admin_name}}</strong> posted a reply (Status: <strong>{{status}}</strong>):</p><div style="background: #f0fdf4; border-left: 4px solid #059669; padding: 14px; border-radius: 8px; margin: 14px 0;">{{admin_reply}}</div><p style="font-size: 12px; color: #64748b;">Subject: {{original_subject}} · Support: {{support_email}}</p></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_udhar_created',
    slug: 'udhar-created',
    name: 'Udhar Transaction Recorded',
    category: 'udhar',
    subject: 'Udhar Recorded: ₹{{amount}} with {{other_person_name}} — {{app_name}}',
    variables: ['user_name', 'other_person_name', 'transaction_id', 'amount', 'direction_label', 'description', 'transaction_date', 'status', 'app_name'],
    text_content:
      'Hi {{user_name}},\n\nA new Udhar entry (#{{transaction_id}}) of ₹{{amount}} ({{direction_label}}) with {{other_person_name}} was recorded on {{transaction_date}}.\n\nNotes: {{description}}\nStatus: {{status}}',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #065f46; margin-top: 0;">Udhar Transaction Recorded</h2><p>Hi <strong>{{user_name}}</strong>,</p><p><strong>Amount:</strong> ₹{{amount}} ({{direction_label}})<br/><strong>With:</strong> {{other_person_name}}<br/><strong>Date:</strong> {{transaction_date}}<br/><strong>Status:</strong> {{status}}</p><p>{{description}}</p></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_udhar_updated',
    slug: 'udhar-updated',
    name: 'Udhar Transaction Updated',
    category: 'udhar',
    subject: 'Udhar Updated: ₹{{amount}} with {{other_person_name}} — {{app_name}}',
    variables: ['user_name', 'other_person_name', 'transaction_id', 'amount', 'direction_label', 'description', 'transaction_date', 'status', 'app_name'],
    text_content:
      'Hi {{user_name}},\n\nUdhar entry #{{transaction_id}} with {{other_person_name}} was updated to ₹{{amount}} ({{direction_label}}) · Status: {{status}}.',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #065f46; margin-top: 0;">Udhar Record Updated</h2><p>Hi <strong>{{user_name}}</strong>,</p><p>Record #{{transaction_id}} with <strong>{{other_person_name}}</strong> is now <strong>₹{{amount}}</strong> ({{direction_label}} · {{status}}).</p><p>{{description}}</p></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_udhar_settled',
    slug: 'udhar-settled',
    name: 'Udhar Repayment / Settlement Notice',
    category: 'udhar',
    subject: 'Udhar Settlement: ₹{{amount_settled}} with {{other_person_name}} — {{app_name}}',
    variables: ['user_name', 'other_person_name', 'transaction_id', 'amount_settled', 'updated_balance', 'settlement_date', 'app_name'],
    text_content:
      'Hi {{user_name}},\n\nA settlement of ₹{{amount_settled}} with {{other_person_name}} (Ref #{{transaction_id}}) was recorded on {{settlement_date}}.\nRemaining Balance: ₹{{updated_balance}}.',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #065f46; margin-top: 0;">Udhar Settlement Recorded</h2><p>Hi <strong>{{user_name}}</strong>,</p><p><strong>Settled Amount:</strong> ₹{{amount_settled}}<br/><strong>Party:</strong> {{other_person_name}}<br/><strong>Date:</strong> {{settlement_date}}<br/><strong>Remaining Balance:</strong> ₹{{updated_balance}}</p></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_contact_invitation',
    slug: 'contact-invitation',
    name: 'Contact Invitation to Join App',
    category: 'udhar',
    subject: '{{inviter_name}} invited you to {{app_name}}',
    variables: ['user_name', 'inviter_name', 'invite_link', 'app_name', 'company_name'],
    text_content:
      'Hi {{user_name}},\n\n{{inviter_name}} invited you to track shared Udhar and finances on {{app_name}} by {{company_name}}.\nJoin here: {{invite_link}}',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 560px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; padding: 24px;"><h2 style="color: #065f46; margin-top: 0;">You are Invited to {{app_name}}!</h2><p>Hi <strong>{{user_name}}</strong>, <strong>{{inviter_name}}</strong> added you as a contact to track lending & repayments digitally.</p><p style="text-align: center; margin: 22px 0;"><a href="{{invite_link}}" style="background: #059669; color: #ffffff; padding: 12px 24px; text-decoration: none; border-radius: 10px; font-weight: 700;">Accept Invitation</a></p></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_notification_alert',
    slug: 'notification-alert',
    name: 'Transaction, Budget & Security Alert Email',
    category: 'notifications',
    subject: '{{title}} — {{app_name}}',
    variables: ['user_name', 'user_email', 'title', 'message', 'category', 'action_url', 'action_text', 'app_name', 'company_name'],
    text_content:
      'Hi {{user_name}},\n\n[{{category}}] {{title}}\n\n{{message}}\n\nOpen: {{action_url}}\n\n{{app_name}} by {{company_name}}',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;"><div style="background: #065f46; padding: 20px; text-align: center; color: #ffffff;"><h2 style="margin: 0;">{{title}}</h2><p style="margin: 4px 0 0; font-size: 11px; color: #a7f3d0; text-transform: uppercase;">{{category}} · {{app_name}}</p></div><div style="padding: 24px; color: #1e293b; font-size: 14px; line-height: 1.6;"><p>Hi <strong>{{user_name}}</strong>,</p><p>{{message}}</p><p style="text-align: center; margin: 22px 0;"><a href="{{action_url}}" style="background: #059669; color: #ffffff; padding: 11px 24px; text-decoration: none; border-radius: 10px; font-weight: 700;">{{action_text}}</a></p></div></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_campaign_announcement',
    slug: 'campaign-announcement',
    name: 'Admin Broadcast & Campaign Announcement',
    category: 'broadcast',
    subject: '{{title}} — {{app_name}} by {{company_name}}',
    variables: ['user_name', 'user_email', 'title', 'message', 'category', 'action_url', 'action_text', 'app_name', 'company_name', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\n{{title}}\n\n{{message}}\n\nOpen in App: {{action_url}}\n\nRegards,\n{{app_name}} ({{company_name}})',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 600px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 18px; overflow: hidden;"><div style="background: linear-gradient(135deg, #065f46, #047857); padding: 24px; text-align: center; color: #ffffff;"><h2 style="margin: 0;">{{title}}</h2><p style="margin: 6px 0 0; font-size: 12px; color: #d1fae5;">Official Announcement · {{company_name}}</p></div><div style="padding: 26px; color: #1e293b; font-size: 14px; line-height: 1.65;"><p>Hi <strong>{{user_name}}</strong>,</p><p>{{message}}</p><p style="text-align: center; margin: 24px 0;"><a href="{{action_url}}" style="background: #059669; color: #ffffff; padding: 12px 26px; text-decoration: none; border-radius: 10px; font-weight: 700;">{{action_text}}</a></p><p style="font-size: 12px; color: #64748b;">Questions? Contact {{support_email}}</p></div></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
  {
    id: 'tmpl_deletion_scheduled',
    slug: 'deletion-scheduled',
    name: 'Account Deletion Scheduled Notice',
    category: 'lifecycle',
    subject: '[Notice] Account Deletion Scheduled (24-Hour Grace Period) — {{app_name}}',
    variables: ['user_name', 'app_name', 'company_name', 'scheduled_date', 'support_email'],
    text_content:
      'Hi {{user_name}},\n\nYou requested deletion of your {{app_name}} account. It is scheduled for permanent purge on {{scheduled_date}} (24-hour statutory grace period).\n\nYou can cancel this deletion at any time before the scheduled date by logging in.\n\nSupport: {{support_email}}',
    html_content:
      '<div style="font-family: -apple-system, BlinkMacSystemFont, \'Segoe UI\', Roboto, sans-serif; max-width: 580px; margin: 0 auto; background: #ffffff; border: 1px solid #e2e8f0; border-radius: 16px; overflow: hidden;"><div style="background: #991b1b; padding: 20px; text-align: center; color: #ffffff;"><h2 style="margin: 0;">Account Deletion Scheduled</h2><p style="margin: 4px 0 0; font-size: 12px; color: #fecaca;">{{app_name}} by {{company_name}}</p></div><div style="padding: 24px; color: #1e293b; font-size: 14px; line-height: 1.6;"><p>Hi <strong>{{user_name}}</strong>,</p><p>Your account deletion request has been scheduled for permanent purge on <strong>{{scheduled_date}}</strong> (24-hour statutory grace period).</p><p>If you changed your mind, log back into <strong>{{app_name}}</strong> anytime before that window ends to cancel deletion immediately.</p><p style="font-size: 12px; color: #64748b; margin-top: 16px;">Need help? Contact <a href="mailto:{{support_email}}">{{support_email}}</a>.</p></div></div>',
    is_active: true,
    is_custom: false,
    is_customized: false,
    version: 1,
    updated_at: '2026-11-25T00:00:00.000Z',
  },
];

function mergeTemplateRow(def: any | undefined, row: any, defaultSlugs: Set<string>): any {
  const slug = String(row.slug || def?.slug || '').trim();
  const version = Number(row.version || 1);
  const isCustom = !defaultSlugs.has(slug);
  const isCustomized = isCustom ? true : Boolean(row.is_customized ?? version > 1);

  if (def && !isCustomized && version <= 1) {
    return {
      ...def,
      id: def.id,
      slug: def.slug,
      is_active: row.is_active !== undefined ? Boolean(row.is_active) : def.is_active,
      is_custom: false,
      is_customized: false,
      version: 1,
      updated_at: def.updated_at || row.updated_at,
    };
  }

  return {
    ...def,
    ...row,
    id: def?.id || String(row.id),
    slug,
    variables: Array.isArray(row.variables) ? row.variables : (def?.variables || []),
    is_custom: isCustom,
    is_customized: isCustomized,
    version,
  };
}

export async function listEmailTemplatesFallback(): Promise<any[]> {
  const sbRes = await sbRestRequest<any[]>('email_templates?select=*&order=category.asc,name.asc');
  const stored = readJsonStore<{ templates: any[] }>('email-templates.json', { templates: [] });
  const defaultSlugs = new Set(DEFAULT_EMAIL_TEMPLATES.map((t) => t.slug));
  const map = new Map<string, any>();

  for (const t of DEFAULT_EMAIL_TEMPLATES) {
    map.set(t.slug, { ...t });
  }
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      const slug = String(row?.slug || '').trim();
      if (!slug) continue;
      const def = map.get(slug);
      map.set(slug, mergeTemplateRow(def, row, defaultSlugs));
    }
  }
  for (const row of stored.templates) {
    const slug = String(row?.slug || '').trim();
    if (!slug) continue;
    const def = map.get(slug);
    map.set(slug, mergeTemplateRow(def, row, defaultSlugs));
  }
  return Array.from(map.values()).sort((a, b) =>
    `${a.category || ''}:${a.name || ''}`.localeCompare(`${b.category || ''}:${b.name || ''}`)
  );
}

export async function updateEmailTemplateFallback(
  id: string,
  updates: {
    name?: string;
    category?: string;
    subject?: string;
    html_content?: string;
    text_content?: string;
    variables?: string[];
    is_active?: boolean;
  }
): Promise<any | null> {
  const all = await listEmailTemplatesFallback();
  const existing = all.find((t) => t.id === id || t.slug === id);
  if (!existing) return null;

  const updated = {
    ...existing,
    name: updates.name !== undefined ? updates.name : existing.name,
    category: updates.category !== undefined ? updates.category : existing.category,
    subject: updates.subject !== undefined ? updates.subject : existing.subject,
    html_content: updates.html_content !== undefined ? updates.html_content : existing.html_content,
    text_content: updates.text_content !== undefined ? updates.text_content : existing.text_content,
    variables: Array.isArray(updates.variables) ? updates.variables : existing.variables,
    is_active: updates.is_active !== undefined ? updates.is_active : existing.is_active,
    is_customized: true,
    version: Math.max(2, Number(existing.version || 1) + 1),
    updated_at: new Date().toISOString(),
  };

  await sbRestRequest(`email_templates?slug=eq.${encodeURIComponent(existing.slug)}`, {
    method: 'PATCH',
    body: {
      name: updated.name,
      category: updated.category,
      subject: updated.subject,
      html_content: updated.html_content,
      text_content: updated.text_content,
      variables: updated.variables,
      is_active: updated.is_active,
      version: updated.version,
      updated_at: updated.updated_at,
    },
  });

  const stored = readJsonStore<{ templates: any[] }>('email-templates.json', { templates: [] });
  stored.templates = [
    updated,
    ...stored.templates.filter((t) => t.id !== existing.id && t.slug !== existing.slug),
  ];
  writeJsonStore('email-templates.json', stored);
  return updated;
}

export async function createEmailTemplateFallback(input: {
  id?: string;
  slug: string;
  name: string;
  category: string;
  subject: string;
  html_content: string;
  text_content: string;
  variables?: string[];
  is_active?: boolean;
}): Promise<any> {
  const now = new Date().toISOString();
  const record = {
    id: input.id || `custom_${crypto.randomUUID().slice(0, 12)}`,
    slug: input.slug,
    name: input.name,
    category: input.category || 'custom',
    subject: input.subject,
    html_content: input.html_content,
    text_content: input.text_content,
    variables: Array.isArray(input.variables) ? input.variables : [],
    is_active: input.is_active !== false,
    is_custom: true,
    is_customized: true,
    version: 1,
    created_at: now,
    updated_at: now,
  };

  await sbRestRequest('email_templates', {
    method: 'POST',
    prefer: 'return=representation',
    body: {
      slug: record.slug,
      name: record.name,
      category: record.category,
      subject: record.subject,
      html_content: record.html_content,
      text_content: record.text_content,
      variables: record.variables,
      is_active: record.is_active,
      version: 1,
      created_at: now,
      updated_at: now,
    },
  });

  const stored = readJsonStore<{ templates: any[] }>('email-templates.json', { templates: [] });
  stored.templates = [record, ...stored.templates.filter((t) => t.id !== record.id && t.slug !== record.slug)];
  writeJsonStore('email-templates.json', stored);
  return record;
}

export async function resetEmailTemplateFallback(id: string): Promise<any | null> {
  const def = DEFAULT_EMAIL_TEMPLATES.find((t) => t.id === id || t.slug === id);
  if (!def) return null;

  const restored = {
    ...def,
    is_customized: false,
    updated_at: new Date().toISOString(),
  };

  await sbRestRequest(`email_templates?slug=eq.${encodeURIComponent(def.slug)}`, {
    method: 'PATCH',
    body: {
      name: restored.name,
      category: restored.category,
      subject: restored.subject,
      html_content: restored.html_content,
      text_content: restored.text_content,
      variables: restored.variables,
      is_active: true,
      version: 1,
      updated_at: restored.updated_at,
    },
  });

  const stored = readJsonStore<{ templates: any[] }>('email-templates.json', { templates: [] });
  stored.templates = stored.templates.filter((t) => t.id !== def.id && t.slug !== def.slug);
  writeJsonStore('email-templates.json', stored);
  return restored;
}

export async function deleteEmailTemplateFallback(id: string): Promise<boolean> {
  if (DEFAULT_EMAIL_TEMPLATES.some((t) => t.id === id || t.slug === id)) {
    return false;
  }
  await sbRestRequest(`email_templates?or=(id.eq.${encodeURIComponent(id)},slug.eq.${encodeURIComponent(id)})`, { method: 'DELETE' });
  const stored = readJsonStore<{ templates: any[] }>('email-templates.json', { templates: [] });
  const before = stored.templates.length;
  stored.templates = stored.templates.filter((t) => t.id !== id && t.slug !== id);
  writeJsonStore('email-templates.json', stored);
  return stored.templates.length < before;
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

// ============================================================================
// 8. SUPPORT TICKETS & REPLIES FALLBACK
// ============================================================================

export async function insertSupportTicketFallback(entry: {
  ticket_number: string;
  user_id: string;
  user_name: string;
  user_email: string;
  ticket_type: 'complaint' | 'support';
  category: string;
  subject: string;
  description: string;
  priority?: string;
  status?: string;
  attachment_url?: string | null;
}): Promise<any> {
  const now = new Date().toISOString();
  const payload = {
    ticket_number: entry.ticket_number,
    user_id: entry.user_id,
    user_name: entry.user_name,
    user_email: entry.user_email,
    ticket_type: entry.ticket_type,
    category: entry.category || 'General',
    subject: entry.subject,
    description: entry.description,
    priority: entry.priority || 'normal',
    status: entry.status || 'open',
    attachment_url: entry.attachment_url || null,
    created_at: now,
    updated_at: now,
  };

  const sbRes = await sbRestRequest<any[]>('support_tickets', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: payload,
  });

  const savedRow =
    sbRes.ok && Array.isArray(sbRes.data) && sbRes.data[0]
      ? sbRes.data[0]
      : { id: crypto.randomUUID(), ...payload };

  const store = readJsonStore<{ tickets: any[]; replies: any[] }>('support-tickets.json', { tickets: [], replies: [] });
  store.tickets = [savedRow, ...store.tickets.filter((t) => t.id !== savedRow.id)].slice(0, 200);
  writeJsonStore('support-tickets.json', store);

  return savedRow;
}

export async function listSupportTicketsFallback(userId?: string): Promise<any[]> {
  const pathSuffix = userId
    ? `support_tickets?user_id=eq.${encodeURIComponent(userId)}&select=*&order=created_at.desc&limit=100`
    : 'support_tickets?select=*&order=created_at.desc&limit=150';
  const sbRes = await sbRestRequest<any[]>(pathSuffix);
  const store = readJsonStore<{ tickets: any[]; replies: any[] }>('support-tickets.json', { tickets: [], replies: [] });

  const map = new Map<string, any>();
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (row?.id) map.set(String(row.id), row);
    }
  }
  for (const row of store.tickets) {
    if (row?.id && !map.has(String(row.id))) {
      if (!userId || row.user_id === userId) {
        map.set(String(row.id), row);
      }
    }
  }

  return Array.from(map.values()).sort(
    (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
  );
}

export async function getSupportTicketByIdFallback(ticketId: string, userId?: string): Promise<any | null> {
  const all = await listSupportTicketsFallback(userId);
  return all.find((t) => t.id === ticketId && (!userId || t.user_id === userId)) || null;
}

export async function insertSupportTicketReplyFallback(entry: {
  ticket_id: string;
  sender_id?: string | null;
  sender_name: string;
  sender_role: string;
  sender_type: 'user' | 'admin';
  message: string;
  message_type?: string;
  is_internal?: boolean;
  email_status?: string;
  delivery_error?: string | null;
}): Promise<any> {
  const now = new Date().toISOString();
  const payload = {
    ticket_id: entry.ticket_id,
    sender_id: entry.sender_id || null,
    sender_name: entry.sender_name,
    sender_role: entry.sender_role,
    sender_type: entry.sender_type,
    message: entry.message,
    message_type: entry.message_type || (entry.sender_type === 'user' ? 'user_message' : 'admin_reply'),
    is_internal: Boolean(entry.is_internal),
    email_status: entry.email_status || 'none',
    delivery_error: entry.delivery_error || null,
    created_at: now,
  };

  const sbRes = await sbRestRequest<any[]>('support_ticket_replies', {
    method: 'POST',
    headers: { Prefer: 'return=representation' },
    body: payload,
  });

  const savedRow =
    sbRes.ok && Array.isArray(sbRes.data) && sbRes.data[0]
      ? sbRes.data[0]
      : { id: crypto.randomUUID(), ...payload };

  const store = readJsonStore<{ tickets: any[]; replies: any[] }>('support-tickets.json', { tickets: [], replies: [] });
  store.replies = [...store.replies.filter((r) => r.id !== savedRow.id), savedRow].slice(-500);
  writeJsonStore('support-tickets.json', store);

  return savedRow;
}

export async function getSupportTicketRepliesFallback(ticketId: string, includeInternal: boolean = false): Promise<any[]> {
  const sbRes = await sbRestRequest<any[]>(
    `support_ticket_replies?ticket_id=eq.${encodeURIComponent(ticketId)}&select=*&order=created_at.asc`
  );
  const store = readJsonStore<{ tickets: any[]; replies: any[] }>('support-tickets.json', { tickets: [], replies: [] });

  const map = new Map<string, any>();
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (row?.id) map.set(String(row.id), row);
    }
  }
  for (const row of store.replies) {
    if (row?.id && row.ticket_id === ticketId && !map.has(String(row.id))) {
      map.set(String(row.id), row);
    }
  }

  return Array.from(map.values())
    .filter((r) => includeInternal || !r.is_internal)
    .sort((a, b) => new Date(a.created_at || 0).getTime() - new Date(b.created_at || 0).getTime());
}

export async function updateSupportTicketStatusFallback(ticketId: string, status: string): Promise<void> {
  const now = new Date().toISOString();
  const patch: Record<string, any> = {
    status,
    updated_at: now,
  };
  if (status === 'resolved' || status === 'closed') {
    patch.resolved_at = now;
  }

  await sbRestRequest(`support_tickets?id=eq.${encodeURIComponent(ticketId)}`, {
    method: 'PATCH',
    body: patch,
  });

  const store = readJsonStore<{ tickets: any[]; replies: any[] }>('support-tickets.json', { tickets: [], replies: [] });
  const idx = store.tickets.findIndex((t) => t.id === ticketId);
  if (idx >= 0) {
    store.tickets[idx] = { ...store.tickets[idx], ...patch };
    writeJsonStore('support-tickets.json', store);
  }
}

// ============================================================================
// 9. ADMIN NOTIFICATIONS & USER STATS FALLBACK
// ============================================================================

export interface AdminNotificationFallbackRecord {
  id: string;
  event_id?: string | null;
  event_type: string;
  title: string;
  message: string;
  priority?: 'normal' | 'high' | 'urgent';
  user_id?: string | null;
  user_email?: string | null;
  deep_link?: string | null;
  related_entity_type?: string | null;
  related_entity_id?: string | null;
  metadata?: Record<string, any>;
  is_read: boolean;
  read_at?: string | null;
  created_at: string;
}

export async function hasAdminNotificationEventFallback(eventId: string): Promise<boolean> {
  if (!eventId) return false;
  const store = readJsonStore<{ notifications: AdminNotificationFallbackRecord[] }>(
    'admin-notifications.json',
    { notifications: [] }
  );
  if (
    store.notifications.some(
      (n) => n.event_id === eventId || n.metadata?.eventId === eventId
    )
  ) {
    return true;
  }
  const sbRes = await sbRestRequest<any[]>(
    `admin_notifications?metadata->>eventId=eq.${encodeURIComponent(eventId)}&select=id&limit=1`
  );
  return Boolean(sbRes.ok && Array.isArray(sbRes.data) && sbRes.data.length > 0);
}

export async function recordAdminNotificationFallback(
  entry: Omit<AdminNotificationFallbackRecord, 'id' | 'is_read' | 'created_at'> & {
    id?: string;
    is_read?: boolean;
    created_at?: string;
  }
): Promise<AdminNotificationFallbackRecord> {
  const now = entry.created_at || new Date().toISOString();
  const metadata = {
    ...(entry.metadata || {}),
    ...(entry.event_id ? { eventId: entry.event_id } : {}),
    ...(entry.priority ? { priority: entry.priority } : {}),
    ...(entry.deep_link ? { deepLink: entry.deep_link } : {}),
    ...(entry.related_entity_type ? { relatedEntityType: entry.related_entity_type } : {}),
    ...(entry.related_entity_id ? { relatedEntityId: entry.related_entity_id } : {}),
  };

  const payload = {
    event_type: entry.event_type,
    title: entry.title,
    message: entry.message,
    user_id: entry.user_id || null,
    user_email: entry.user_email || null,
    metadata,
    is_read: Boolean(entry.is_read),
    created_at: now,
  };

  const sbRes = await sbRestRequest<any[]>('admin_notifications', {
    method: 'POST',
    prefer: 'return=representation',
    body: payload,
  });

  const savedRow: AdminNotificationFallbackRecord =
    sbRes.ok && Array.isArray(sbRes.data) && sbRes.data[0]
      ? {
          ...sbRes.data[0],
          event_id: entry.event_id || sbRes.data[0]?.metadata?.eventId || null,
          priority: entry.priority || sbRes.data[0]?.metadata?.priority || 'normal',
          deep_link: entry.deep_link || sbRes.data[0]?.metadata?.deepLink || null,
          related_entity_type: entry.related_entity_type || sbRes.data[0]?.metadata?.relatedEntityType || null,
          related_entity_id: entry.related_entity_id || sbRes.data[0]?.metadata?.relatedEntityId || null,
        }
      : {
          id: entry.id || `anot_${crypto.randomBytes(6).toString('hex')}`,
          event_id: entry.event_id || null,
          priority: entry.priority || 'normal',
          deep_link: entry.deep_link || null,
          related_entity_type: entry.related_entity_type || null,
          related_entity_id: entry.related_entity_id || null,
          ...payload,
        };

  const store = readJsonStore<{ notifications: AdminNotificationFallbackRecord[] }>(
    'admin-notifications.json',
    { notifications: [] }
  );
  store.notifications = [
    savedRow,
    ...store.notifications.filter((n) => n.id !== savedRow.id),
  ].slice(0, 300);
  writeJsonStore('admin-notifications.json', store);

  return savedRow;
}

export async function listAdminNotificationsFallback(
  limit = 150
): Promise<AdminNotificationFallbackRecord[]> {
  const sbRes = await sbRestRequest<any[]>(
    `admin_notifications?select=*&order=created_at.desc&limit=${Math.min(300, Math.max(10, limit))}`
  );
  const store = readJsonStore<{ notifications: AdminNotificationFallbackRecord[] }>(
    'admin-notifications.json',
    { notifications: [] }
  );

  const map = new Map<string, AdminNotificationFallbackRecord>();
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (row?.id) {
        map.set(String(row.id), {
          ...row,
          event_id: row.metadata?.eventId || null,
          priority: row.metadata?.priority || 'normal',
          deep_link: row.metadata?.deepLink || null,
          related_entity_type: row.metadata?.relatedEntityType || null,
          related_entity_id: row.metadata?.relatedEntityId || null,
        });
      }
    }
  }
  for (const row of store.notifications) {
    if (row?.id && !map.has(String(row.id))) {
      map.set(String(row.id), row);
    }
  }

  return Array.from(map.values())
    .sort((a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime())
    .slice(0, limit);
}

export async function markAdminNotificationReadFallback(id: string): Promise<boolean> {
  const now = new Date().toISOString();
  await sbRestRequest(`admin_notifications?id=eq.${encodeURIComponent(id)}`, {
    method: 'PATCH',
    body: { is_read: true, read_at: now },
  }).catch(() => {});

  const store = readJsonStore<{ notifications: AdminNotificationFallbackRecord[] }>(
    'admin-notifications.json',
    { notifications: [] }
  );
  let changed = false;
  store.notifications = store.notifications.map((n) => {
    if (n.id === id) {
      changed = true;
      return { ...n, is_read: true, read_at: now };
    }
    return n;
  });
  if (changed) writeJsonStore('admin-notifications.json', store);
  return true;
}

export async function markAllAdminNotificationsReadFallback(): Promise<boolean> {
  const now = new Date().toISOString();
  await sbRestRequest('admin_notifications?is_read=eq.false', {
    method: 'PATCH',
    body: { is_read: true, read_at: now },
  }).catch(() => {});

  const store = readJsonStore<{ notifications: AdminNotificationFallbackRecord[] }>(
    'admin-notifications.json',
    { notifications: [] }
  );
  store.notifications = store.notifications.map((n) =>
    n.is_read ? n : { ...n, is_read: true, read_at: now }
  );
  writeJsonStore('admin-notifications.json', store);
  return true;
}

export async function countTransactionsByUserFallback(): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};
  const sbRes = await sbRestRequest<Array<{ user_id: string }>>(
    'transactions?select=user_id&is_deleted=eq.false&limit=3000'
  );
  if (sbRes.ok && Array.isArray(sbRes.data)) {
    for (const row of sbRes.data) {
      if (row?.user_id) {
        counts[row.user_id] = (counts[row.user_id] || 0) + 1;
      }
    }
  }
  return counts;
}

