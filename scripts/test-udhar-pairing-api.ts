import { handleApiRequest } from '../server/api';
import { EventEmitter } from 'events';

/**
 * Local smoke test: the new pairing routes must always answer with JSON,
 * even when unauthenticated or when the database is unavailable.
 */
async function call(method: string, url: string, body?: any) {
  const req: any = new EventEmitter();
  req.method = method;
  req.url = url;
  req.headers = { host: 'localhost:3000' };
  req.socket = { remoteAddress: '127.0.0.1' };
  req.body = body;

  let status = 0;
  let payload: any = null;
  const res: any = {
    writableEnded: false,
    headersSent: false,
    status(code: number) {
      status = code;
      return this;
    },
    json(data: any) {
      payload = data;
      this.writableEnded = true;
      this.headersSent = true;
      return this;
    },
    setHeader() {},
    writeHead(code: number) {
      status = code;
      return this;
    },
    end(raw: string) {
      if (!payload) payload = JSON.parse(raw);
      this.writableEnded = true;
      this.headersSent = true;
    },
  };

  const handled = await handleApiRequest(req, res);
  return { handled, status, payload };
}

async function main() {
  const cases: Array<[string, string, any]> = [
    ['GET', '/api/udhar/connection-requests', undefined],
    ['POST', '/api/udhar/connection-requests', { targetUserId: 'x', consentConfirmed: true }],
    ['POST', '/api/udhar/qr/resolve', { pairingCode: 'MM-BOFE65' }],
    ['POST', '/api/udhar/qr/connect', { pairingCode: 'MM-BOFE65' }],
    ['POST', '/api/udhar/connections/disconnect', { targetUserId: 'x' }],
  ];

  let failed = 0;
  for (const [method, url, body] of cases) {
    const out = await call(method, url, body);
    const isJson = out.payload !== null && typeof out.payload === 'object';
    const ok = out.handled === true && isJson && out.status === 401;
    if (!ok) failed++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${method} ${url} -> ${out.status} ${isJson ? 'json' : 'non-json'} ${JSON.stringify(
        out.payload
      )?.slice(0, 120)}`
    );
  }

  if (failed > 0) {
    console.error(`${failed} handler smoke test(s) failed`);
    process.exit(1);
  }
  console.log('All handler smoke tests passed');
}

main().catch((e) => {
  console.error('Probe crashed:', e);
  process.exit(1);
});
