/**
 * Smart Application Caching, In-Flight Request Deduplication & Concurrency Control
 *
 * Rules:
 * - Public cache keys (`public:*`) are ONLY for non-sensitive public data (site config, branding, SEO).
 * - Private user data MUST NEVER be placed in shared/public cache; if cached, it MUST be keyed by
 *   `user:${userId}:...` and explicitly invalidated on every write.
 * - Includes bounded LRU eviction, TTL, in-flight request coalescing, bounded concurrency, and
 *   timeout protection for external services.
 */

interface CacheEntry<T> {
  value: T;
  expiresAt: number;
  staleUntil: number;
  version: number;
}

class BoundedLruCache {
  private readonly store = new Map<string, CacheEntry<any>>();
  private readonly maxEntries: number;
  private versionCounter = 1;
  private hits = 0;
  private misses = 0;
  private evictions = 0;

  constructor(maxEntries: number = 500) {
    this.maxEntries = maxEntries;
  }

  get<T>(key: string): { value: T; isStale: boolean } | null {
    const entry = this.store.get(key);
    if (!entry) {
      this.misses += 1;
      return null;
    }
    const now = Date.now();
    if (now > entry.staleUntil) {
      this.store.delete(key);
      this.misses += 1;
      return null;
    }
    // Refresh LRU order
    this.store.delete(key);
    this.store.set(key, entry);
    this.hits += 1;
    return {
      value: entry.value as T,
      isStale: now > entry.expiresAt,
    };
  }

  set<T>(key: string, value: T, ttlMs: number, staleWhileRevalidateMs: number = 0): void {
    if (this.store.has(key)) {
      this.store.delete(key);
    } else if (this.store.size >= this.maxEntries) {
      const oldestKey = this.store.keys().next().value;
      if (oldestKey !== undefined) {
        this.store.delete(oldestKey);
        this.evictions += 1;
      }
    }
    const now = Date.now();
    this.store.set(key, {
      value,
      expiresAt: now + Math.max(100, ttlMs),
      staleUntil: now + Math.max(100, ttlMs) + Math.max(0, staleWhileRevalidateMs),
      version: ++this.versionCounter,
    });
  }

  invalidate(key: string): boolean {
    return this.store.delete(key);
  }

  invalidatePrefix(prefix: string): number {
    let removed = 0;
    for (const k of this.store.keys()) {
      if (k.startsWith(prefix)) {
        this.store.delete(k);
        removed += 1;
      }
    }
    return removed;
  }

  invalidateUser(userId: string): number {
    if (!userId) return 0;
    return this.invalidatePrefix(`user:${userId}:`);
  }

  clear(): void {
    this.store.clear();
  }

  getStats() {
    const total = this.hits + this.misses;
    return {
      entries: this.store.size,
      maxEntries: this.maxEntries,
      hits: this.hits,
      misses: this.misses,
      evictions: this.evictions,
      hitRatio: total > 0 ? Number((this.hits / total).toFixed(4)) : 0,
      version: this.versionCounter,
    };
  }
}

export const appCache = new BoundedLruCache(600);

// In-flight request deduplication (coalesces concurrent identical reads)
const inFlightMap = new Map<string, Promise<any>>();

export async function dedupeInFlight<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const existing = inFlightMap.get(key);
  if (existing) {
    return existing as Promise<T>;
  }
  const promise = (async () => {
    try {
      return await fn();
    } finally {
      inFlightMap.delete(key);
    }
  })();
  inFlightMap.set(key, promise);
  return promise;
}

/**
 * Cached read with in-flight deduplication and optional stale-while-revalidate.
 */
export async function cachedRead<T>(
  key: string,
  ttlMs: number,
  loader: () => Promise<T>,
  staleWhileRevalidateMs: number = 0
): Promise<{ value: T; cacheStatus: 'HIT' | 'STALE' | 'MISS' }> {
  const cached = appCache.get<T>(key);
  if (cached && !cached.isStale) {
    return { value: cached.value, cacheStatus: 'HIT' };
  }
  if (cached && cached.isStale) {
    // Trigger background refresh without blocking caller
    void dedupeInFlight(`revalidate:${key}`, async () => {
      const fresh = await loader();
      appCache.set(key, fresh, ttlMs, staleWhileRevalidateMs);
      return fresh;
    }).catch(() => {});
    return { value: cached.value, cacheStatus: 'STALE' };
  }

  const fresh = await dedupeInFlight(key, async () => {
    const val = await loader();
    appCache.set(key, val, ttlMs, staleWhileRevalidateMs);
    return val;
  });
  return { value: fresh, cacheStatus: 'MISS' };
}

/**
 * Bounded concurrency helper (avoids unbounded Promise.all spikes).
 */
export async function mapWithConcurrency<T, R>(
  items: T[],
  concurrency: number,
  worker: (item: T, index: number) => Promise<R>
): Promise<R[]> {
  if (items.length === 0) return [];
  const limit = Math.max(1, Math.min(concurrency, items.length));
  const results = new Array<R>(items.length);
  let nextIndex = 0;

  const runWorker = async () => {
    while (true) {
      const idx = nextIndex++;
      if (idx >= items.length) break;
      results[idx] = await worker(items[idx], idx);
    }
  };

  await Promise.all(Array.from({ length: limit }, () => runWorker()));
  return results;
}

/**
 * Timeout wrapper for external HTTP/DB calls so slow upstreams cannot exhaust serverless workers.
 */
export async function withTimeout<T>(promise: Promise<T>, timeoutMs: number, label: string = 'operation'): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<T>((_, reject) => {
        timer = setTimeout(() => {
          reject(new Error(`Timeout after ${timeoutMs}ms during ${label}`));
        }, timeoutMs);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Backpressure / Concurrency Protection
// ---------------------------------------------------------------------------
const MAX_CONCURRENT_REQUESTS = 160;
const SOFT_DEGRADE_THRESHOLD = 120;
let activeConcurrentRequests = 0;
let peakConcurrentRequests = 0;
let sheddedRequests = 0;

export function tryAcquireConcurrencySlot(isPriority: boolean): {
  allowed: boolean;
  active: number;
  retryAfterSec?: number;
} {
  if (!isPriority && activeConcurrentRequests >= SOFT_DEGRADE_THRESHOLD) {
    sheddedRequests += 1;
    return { allowed: false, active: activeConcurrentRequests, retryAfterSec: 3 };
  }
  if (activeConcurrentRequests >= MAX_CONCURRENT_REQUESTS) {
    sheddedRequests += 1;
    return { allowed: false, active: activeConcurrentRequests, retryAfterSec: 5 };
  }
  activeConcurrentRequests += 1;
  if (activeConcurrentRequests > peakConcurrentRequests) {
    peakConcurrentRequests = activeConcurrentRequests;
  }
  return { allowed: true, active: activeConcurrentRequests };
}

export function releaseConcurrencySlot(): void {
  if (activeConcurrentRequests > 0) {
    activeConcurrentRequests -= 1;
  }
}

export function getConcurrencyMetrics() {
  return {
    activeRequests: activeConcurrentRequests,
    peakRequests: peakConcurrentRequests,
    softThreshold: SOFT_DEGRADE_THRESHOLD,
    maxConcurrent: MAX_CONCURRENT_REQUESTS,
    sheddedRequests,
    inFlightDeduplications: inFlightMap.size,
  };
}
