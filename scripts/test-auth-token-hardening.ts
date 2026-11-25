import { readFile } from 'node:fs/promises';
import { authenticateRequest } from '../server/auth.js';
import type { IncomingMessage } from 'node:http';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function requestWithBearer(token?: string): IncomingMessage {
  return {
    headers: token ? { authorization: `Bearer ${token}` } : {},
  } as IncomingMessage;
}

async function main() {
  assert(await authenticateRequest(requestWithBearer()) === null, 'Missing token must be rejected.');
  assert(await authenticateRequest(requestWithBearer('direct_user_1730000000000')) === null, 'Legacy direct_* token must be rejected.');
  const forgedPayload = Buffer.from(JSON.stringify({ sub: '00000000-0000-0000-0000-000000000001', role: 'authenticated' })).toString('base64url');
  const forgedJwt = `eyJhbGciOiJub25lIn0.${forgedPayload}.`;
  assert(await authenticateRequest(requestWithBearer(forgedJwt)) === null, 'Unverified JWT-shaped token must be rejected.');

  const authApiSource = await readFile(new URL('../src/lib/authApi.ts', import.meta.url), 'utf8');
  assert(!authApiSource.includes('directSupabase'), 'Client-side direct Supabase auth fallback must not exist.');
  assert(!authApiSource.includes('password_hash'), 'Browser auth client must never read password hashes.');
  assert(!authApiSource.includes('/rest/v1/app_users'), 'Browser auth client must not query app_users directly.');

  console.log('PASS: missing, legacy direct, and forged JWT tokens are rejected.');
  console.log('PASS: browser authentication no longer reads app_users or password hashes.');
}

main().catch((error) => {
  console.error('FAIL: auth token hardening tests:', error);
  process.exitCode = 1;
});
