import type { IncomingMessage, ServerResponse } from 'http';
import { parse as parseUrl } from 'url';
import { handleApiRequest } from '../server/api';

export default async function handler(req: any, res: any) {
  try {
    // 1. Reconstruct real URL path if rewritten by Vercel catch-all
    if (req.query?.all) {
      const sub = Array.isArray(req.query.all) ? req.query.all.join('/') : req.query.all;
      const qIdx = (req.url || '').indexOf('?');
      const search = qIdx !== -1 ? (req.url || '').slice(qIdx) : '';
      req.url = `/api/${sub}${search}`;
    } else if (req.headers['x-forwarded-uri']) {
      req.url = req.headers['x-forwarded-uri'];
    }

    // 2. Normalize body if stringified
    if (typeof req.body === 'string' && req.body.trim()) {
      try {
        req.body = JSON.parse(req.body);
      } catch {}
    }

    // 3. Delegate to API router
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
