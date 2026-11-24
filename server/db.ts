import pg from 'pg';
import fs from 'fs';
import path from 'path';
import dns from 'dns';

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
  const trimmed = raw.trim().replace(/^['"]+|['"]+$/g, '').trim();
  if (!trimmed || !/^postgres(ql)?:\/\//i.test(trimmed)) return '';
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
export function isDatabaseAvailable(): boolean {
  return isDatabaseConfigured && databaseFatalError === null;
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
  console.warn('[AI Studio] DATABASE_URL not set — PostgreSQL mock active (using Supabase HTTPS fallback where supported)');
  poolInstance = createMockPool();
} else {
  try {
    poolInstance = new pg.Pool({
      connectionString: normalizedConnectionString,
      ssl: { rejectUnauthorized: false },
      lookup: customLookup,
      max: 10,
      idleTimeoutMillis: 30000,
      connectionTimeoutMillis: 10000,
      keepAlive: true,
      keepAliveInitialDelayMillis: 5000,
    });

    poolInstance.on('error', (err) => {
      console.warn('PostgreSQL idle client notice (will reconnect on next query):', err.message);
    });
  } catch (err: any) {
    console.warn('[AI Studio] PostgreSQL init failed — mock active:', err?.message);
    databaseFatalError = err?.message || 'Pool initialization failed';
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
    if (process.env.NODE_ENV === 'development' && duration > 2000) {
      console.warn(`[DB Slow Query] ${duration}ms: ${text.slice(0, 80)}...`);
    }
    return res;
  } catch (err: any) {
    const msg = err.message || '';
    const code = err.code || '';

    // Fatal DB configuration/availability errors (e.g., 3D000 database does not exist, 28P01 bad password)
    if (
      code === '3D000' ||
      code === '28P01' ||
      code === '28000' ||
      msg.includes('does not exist') && msg.includes('database')
    ) {
      if (!databaseFatalError) {
        databaseFatalError = msg;
        console.warn(`[AI Studio] PostgreSQL unavailable (${msg}) — switching to mock fallback.`);
      }
      return emptyResult<T>();
    }

    const isConnErr =
      msg.includes('Connection terminated') ||
      msg.includes('ECONNRESET') ||
      msg.includes('ETIMEDOUT') ||
      msg.includes('ENOTFOUND') ||
      msg.includes('EAI_AGAIN') ||
      msg.includes('ECONNREFUSED') ||
      msg.includes('connection timeout') ||
      msg.includes('timeout expired') ||
      msg.includes('timeout') ||
      msg.includes('closed');

    if (isConnErr && retries > 0) {
      console.warn(`[DB Reconnect] Query failed (${msg}), retrying (${retries} attempts left)...`);
      await new Promise((r) => setTimeout(r, 600));
      return query<T>(text, params, retries - 1);
    }
    throw err;
  }
}
