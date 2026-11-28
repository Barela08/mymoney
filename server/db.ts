import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dns from 'dns';
import { recordSlowQueryMetric } from './telemetry.js';

// Ensure IPv6-only database hosts (like Supabase direct connection) resolve properly in Node.js
try {
  dns.setDefaultResultOrder('verbatim');
} catch {}

// Parse .env if not loaded
try {
  const envPath = path.resolve(process.cwd(), '.env');
  if (fs.existsSync(envPath)) {
    const lines = fs.readFileSync(envPath, 'utf8').split('\n');
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const eqIdx = trimmed.indexOf('=');
      if (eqIdx !== -1) {
        const key = trimmed.slice(0, eqIdx).trim();
        let val = trimmed.slice(eqIdx + 1).trim();
        if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
          val = val.slice(1, -1);
        }
        if (!process.env[key]) {
          process.env[key] = val;
        }
      }
    }
  }
} catch (e) {
  console.warn('Notice loading .env in db.ts:', e);
}

function normalizeDatabaseUrl(raw?: string): string {
  if (!raw || typeof raw !== 'string') return '';
  let trimmed = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!trimmed || !/^postgres(ql)?:\/\//i.test(trimmed)) return '';

  // Safely percent-encode unencoded '@' / '#' in password (e.g. postgresql://user:Pass@123@host:5432/postgres)
  const schemeMatch = trimmed.match(/^(postgres(?:ql)?:\/\/)/i);
  if (schemeMatch) {
    const scheme = schemeMatch[1];
    const rest = trimmed.slice(scheme.length);
    const lastAtIdx = rest.lastIndexOf('@');
    if (lastAtIdx !== -1) {
      const userInfo = rest.slice(0, lastAtIdx);
      const hostAndPath = rest.slice(lastAtIdx + 1);
      const colonIdx = userInfo.indexOf(':');
      if (colonIdx !== -1) {
        const user = userInfo.slice(0, colonIdx);
        const pass = userInfo.slice(colonIdx + 1);
        if (/[@#?]/.test(pass)) {
          trimmed = `${scheme}${user}:${encodeURIComponent(pass)}@${hostAndPath}`;
        }
      }
    }
  }

  try {
    const parsed = new URL(trimmed);
    // Auto-correct common typo "/postgre" -> "/postgres"
    if (parsed.pathname === '/postgre') {
      console.warn('[DB Config] Normalized DATABASE_URL database name from "postgre" to "postgres".');
      parsed.pathname = '/postgres';
      return parsed.toString();
    }
    return trimmed;
  } catch {
    return trimmed.replace(/\/postgre(\?|$)/, '/postgres$1');
  }
}

const normalizedConnectionString = normalizeDatabaseUrl(process.env.DATABASE_URL);
export const isDatabaseConfigured = Boolean(normalizedConnectionString);

let databaseFatalError: string | null = null;
let databaseFatalPermanent = false;
let databaseRetryAfterMs = 0;
let lastSuccessfulQueryAt: string | null = null;
let lastDatabaseErrorAt: string | null = null;
let consecutiveDbErrors = 0;

function inspectConnectionUrlMetadata(urlStr: string): {
  mode: 'unconfigured' | 'transaction_pooler' | 'session_pooler' | 'direct_postgres' | 'custom';
  port: number | null;
  hostKind: string;
} {
  if (!urlStr) return { mode: 'unconfigured', port: null, hostKind: 'none' };
  try {
    const parsed = new URL(urlStr);
    const port = parsed.port ? parseInt(parsed.port, 10) : 5432;
    const host = parsed.hostname.toLowerCase();
    if (host.includes('pooler.supabase.com')) {
      return {
        mode: port === 6543 ? 'transaction_pooler' : 'session_pooler',
        port,
        hostKind: 'supabase_pooler',
      };
    }
    if (host.endsWith('.supabase.co')) {
      return { mode: 'direct_postgres', port, hostKind: 'supabase_direct' };
    }
    return { mode: 'custom', port, hostKind: 'postgres' };
  } catch {
    return { mode: 'custom', port: null, hostKind: 'unknown' };
  }
}

const connectionMeta = inspectConnectionUrlMetadata(normalizedConnectionString);

export function isDatabaseAvailable(): boolean {
  if (!isDatabaseConfigured) return false;
  if (databaseFatalPermanent) return false;
  if (databaseFatalError !== null) {
    if (Date.now() >= databaseRetryAfterMs) {
      return true; // Half-open probe window
    }
    return false;
  }
  return true;
}

export function getDbPoolDiagnostics() {
  const anyPool = pool as any;
  return {
    configured: isDatabaseConfigured,
    available: isDatabaseAvailable(),
    connectionMode: connectionMeta.mode,
    port: connectionMeta.port,
    hostKind: connectionMeta.hostKind,
    poolMax: process.env.VERCEL ? 2 : 4,
    totalCount: typeof anyPool?.totalCount === 'number' ? anyPool.totalCount : 0,
    idleCount: typeof anyPool?.idleCount === 'number' ? anyPool.idleCount : 0,
    waitingCount: typeof anyPool?.waitingCount === 'number' ? anyPool.waitingCount : 0,
    consecutiveErrors: consecutiveDbErrors,
    lastError: databaseFatalError,
    lastErrorAt: lastDatabaseErrorAt,
    lastSuccessAt: lastSuccessfulQueryAt,
    retryAfterMs: databaseRetryAfterMs > Date.now() ? databaseRetryAfterMs - Date.now() : 0,
    recommendation:
      connectionMeta.mode === 'direct_postgres'
        ? 'Direct port 5432 detected. Switch DATABASE_URL to Supabase Supavisor Transaction Pooler (port 6543) to avoid Nano 60-connection exhaustion.'
        : !isDatabaseConfigured
        ? 'DATABASE_URL not set in server environment. Using Supabase HTTPS REST / Firebase secondary fallback.'
        : 'Transaction pooling active with bounded pool size (max 2–4 connections per worker).',
  };
}

export async function probeDatabaseRecovery(): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
  if (!isDatabaseConfigured) {
    return { ok: false, latencyMs: 0, error: 'DATABASE_URL not configured' };
  }
  if (databaseFatalPermanent) {
    return { ok: false, latencyMs: 0, error: databaseFatalError || 'Fatal DB configuration error' };
  }
  const t0 = Date.now();
  try {
    await pool.query('SELECT 1');
    databaseFatalError = null;
    databaseRetryAfterMs = 0;
    consecutiveDbErrors = 0;
    lastSuccessfulQueryAt = new Date().toISOString();
    return { ok: true, latencyMs: Date.now() - t0 };
  } catch (err: any) {
    const msg = err?.message || 'PostgreSQL probe failed';
    consecutiveDbErrors += 1;
    lastDatabaseErrorAt = new Date().toISOString();
    databaseFatalError = msg;
    databaseRetryAfterMs = Date.now() + Math.min(60_000, 5_000 * Math.pow(2, Math.min(consecutiveDbErrors, 4)));
    return { ok: false, latencyMs: Date.now() - t0, error: msg };
  }
}

const emptyResult = <T extends pg.QueryResultRow = any>(): pg.QueryResult<T> => ({
  rows: [],
  rowCount: 0,
  command: '',
  oid: 0,
  fields: [],
});

const createMockPool = () =>
  ({
    query: async <T extends pg.QueryResultRow = any>() => emptyResult<T>(),
    connect: async () => ({
      query: async <T extends pg.QueryResultRow = any>() => emptyResult<T>(),
      release: () => {},
    }),
    on: () => {},
    end: async () => {},
  }) as unknown as pg.Pool;

const dnsResolver = new dns.promises.Resolver();
try {
  dnsResolver.setServers(['8.8.8.8', '1.1.1.1', '8.8.4.4']);
} catch {}

const customLookup = (
  hostname: string,
  options: any,
  cb: (err: any, address?: string, family?: number) => void
) => {
  dns.lookup(hostname, options, async (err, address, family) => {
    if (!err && address) {
      return cb(null, address, family);
    }
    try {
      if (hostname.includes('supabase.co')) {
        const ips = await dnsResolver.resolve6(hostname);
        if (ips && ips.length > 0) {
          return cb(null, ips[0], 6);
        }
      }
      const ips4 = await dnsResolver.resolve4(hostname);
      if (ips4 && ips4.length > 0) {
        return cb(null, ips4[0], 4);
      }
    } catch {}
    return cb(err, address, family);
  });
};

let poolInstance: pg.Pool;
if (!isDatabaseConfigured) {
  console.warn('[DB] DATABASE_URL not set — PostgreSQL pool inactive (using Supabase HTTPS REST / Firebase secondary where configured)');
  poolInstance = createMockPool();
} else {
  try {
    poolInstance = new pg.Pool({
      connectionString: normalizedConnectionString,
      ssl: { rejectUnauthorized: false },
      lookup: customLookup,
      max: process.env.VERCEL ? 2 : 4, // Protect Supabase Nano 60-connection pool
      idleTimeoutMillis: 10000,
      connectionTimeoutMillis: 8000,
      statement_timeout: 8000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000,
    });

    poolInstance.on('error', (err) => {
      console.warn('PostgreSQL idle client notice (will reconnect on next query):', err.message);
    });
  } catch (err: any) {
    console.warn('[DB] PostgreSQL init failed — fallback active:', err?.message);
    databaseFatalError = err?.message || 'Pool initialization failed';
    databaseFatalPermanent = true;
    poolInstance = createMockPool();
  }
}

export const pool = poolInstance;

export async function query<T extends pg.QueryResultRow = any>(
  text: string,
  params?: any[],
  retries = 2
): Promise<pg.QueryResult<T>> {
  if (!isDatabaseAvailable()) {
    return emptyResult<T>();
  }
  const start = Date.now();
  try {
    const res = await pool.query<T>(text, params);
    const duration = Date.now() - start;
    databaseFatalError = null;
    databaseRetryAfterMs = 0;
    consecutiveDbErrors = 0;
    lastSuccessfulQueryAt = new Date().toISOString();
    if (duration > 500) {
      recordSlowQueryMetric(duration, text);
    }
    if (process.env.NODE_ENV === 'development' && duration > 2000) {
      console.warn(`[DB Slow Query] ${duration}ms: ${text.slice(0, 80)}...`);
    }
    return res;
  } catch (err: any) {
    const msg = err.message || '';
    const code = err.code || '';

    // Fatal DB configuration errors (e.g., 3D000 database does not exist, 28P01 bad password)
    if (
      code === '3D000' ||
      code === '28P01' ||
      code === '28000' ||
      (msg.includes('does not exist') && msg.includes('database'))
    ) {
      databaseFatalError = msg;
      databaseFatalPermanent = true;
      lastDatabaseErrorAt = new Date().toISOString();
      console.warn(`[DB] PostgreSQL configuration error (${msg}) — direct PG disabled.`);
      return emptyResult<T>();
    }

    const isConnErr =
      msg.includes('Connection terminated') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('ENETUNREACH') ||
      msg.includes('EHOSTUNREACH') ||
      msg.includes('EAI_AGAIN') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('connection timeout') ||
      msg.includes('timeout expired') ||
      msg.includes('timeout') ||
      msg.includes('too many clients') ||
      msg.includes('remaining connection slots') ||
      msg.includes('closed');

    if (isConnErr && retries > 0) {
      console.warn(`[DB Reconnect] Query failed (${msg}), retrying (${retries} attempts left)...`);
      await new Promise((r) => setTimeout(r, 300 + Math.floor(Math.random() * 250)));
      return query<T>(text, params, retries - 1);
    }

    if (isConnErr) {
      consecutiveDbErrors += 1;
      lastDatabaseErrorAt = new Date().toISOString();
      databaseFatalError = msg;
      // Exponential cooldown (10s -> 20s -> 40s -> max 60s) so PG automatically recovers once healthy!
      databaseRetryAfterMs = Date.now() + Math.min(60_000, 10_000 * Math.pow(2, Math.min(consecutiveDbErrors - 1, 3)));
      console.warn(`[DB Circuit] PostgreSQL unreachable (${msg}) — half-open retry in ${Math.round((databaseRetryAfterMs - Date.now()) / 1000)}s.`);
      return emptyResult<T>();
    }
    throw err;
  }
}
