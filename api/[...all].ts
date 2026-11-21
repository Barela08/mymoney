import type { IncomingMessage, ServerResponse } from 'http';
import { handleApiRequest } from '../server/api';

export default async function handler(req: any, res: any) {
  try {
    const handled = await handleApiRequest(req, res);
    if (!handled && !res.writableEnded) {
      if (typeof res.status === 'function') {
        res.status(404).json({ success: false, message: 'API route not found' });
      } else {
        res.writeHead(404, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: 'API route not found' }));
      }
    }
  } catch (error: any) {
    console.error('API Serverless Error:', error);
    if (!res.writableEnded) {
      if (typeof res.status === 'function') {
        res.status(500).json({ success: false, message: error.message || 'Internal server error' });
      } else {
        res.writeHead(500, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ success: false, message: error.message || 'Internal server error' }));
      }
    }
  }
}
