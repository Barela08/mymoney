import { handleApiRequest } from '../server/api';
import { query } from '../server/db';
import { createSession } from '../server/auth';

async function test() {
  const users = await query('SELECT id, email, full_name FROM public.app_users LIMIT 1');
  if (users.rows.length === 0) {
    console.log('No users found');
    process.exit(0);
  }
  const user = users.rows[0];
  console.log('Testing with user:', user);

  // Create session using createSession
  const sessionToken = await createSession(user.id, 'TestAgent', '127.0.0.1');
  console.log('Session token created:', sessionToken);

  let statusCode = 0;
  let headers: Record<string, string> = {};
  let body = '';

  const mockReq: any = {
    method: 'GET',
    url: '/api/udhar/qr/my-code',
    headers: {
      authorization: 'Bearer ' + sessionToken.sessionToken,
    },
    socket: { remoteAddress: '127.0.0.1' },
  };

  const mockRes: any = {
    writeHead: (code: number, hdrs: any) => { statusCode = code; headers = hdrs; },
    end: (data: string) => { body = data; },
    setHeader: (k: string, v: string) => { headers[k] = v; },
  };

  const handled = await handleApiRequest(mockReq, mockRes);
  console.log('Handled:', handled);
  console.log('Status:', statusCode);
  console.log('Body:', body);
  process.exit(0);
}

test().catch(e => {
  console.error('Error in test:', e);
  process.exit(1);
});
