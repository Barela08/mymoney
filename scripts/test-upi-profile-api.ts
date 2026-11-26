import { EventEmitter } from 'events';
import { handleApiRequest } from '../server/api';

/**
 * Smoke test for /api/upi/profile endpoints:
 * Ensures unauthenticated requests always receive JSON 401 and never leak any profile data.
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
    statusCode: 200,
    status(code: number) {
      status = code;
      this.statusCode = code;
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
      this.statusCode = code;
      return this;
    },
    end(raw: string) {
      status = status || this.statusCode;
      if (!payload && raw) payload = JSON.parse(raw);
      this.writableEnded = true;
      this.headersSent = true;
    },
  };

  const handled = await handleApiRequest(req, res);
  return { handled, status: status || res.statusCode, payload };
}

async function main() {
  const cases: Array<[string, string, any]> = [
    ['GET', '/api/upi/profile', undefined],
    ['POST', '/api/upi/profile', { upiId: 'user@okaxis', consentAccepted: true }],
    ['PUT', '/api/upi/profile', { upiId: 'user@okaxis' }],
    ['DELETE', '/api/upi/profile', { withdrawConsent: true }],
  ];

  let failed = 0;
  for (const [method, url, body] of cases) {
    const out = await call(method, url, body);
    const isJson = out.payload !== null && typeof out.payload === 'object';
    const hasNoProfile = !out.payload?.profile;
    const ok = out.handled === true && isJson && out.status === 401 && hasNoProfile;
    if (!ok) failed++;
    console.log(
      `${ok ? 'PASS' : 'FAIL'} ${method} ${url} -> ${out.status} ${JSON.stringify(out.payload)}`
    );
  }

  if (failed > 0) {
    console.error(`${failed} UPI profile route smoke test(s) failed`);
    process.exit(1);
  }
  console.log('All UPI profile route smoke tests passed');
}

main().catch((e) => {
  console.error('UPI profile route test crashed:', e);
  process.exit(1);
});
