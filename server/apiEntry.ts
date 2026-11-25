import { handleApiRequest } from './api.js';

function sendSafeJson(res: any, statusCode: number, payload: Record<string, any>) {
  if (res.writableEnded || res.headersSent) return;
  if (typeof res.setHeader === 'function') {
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('X-Content-Type-Options', 'nosniff');
  }
  if (typeof res.status === 'function' && typeof res.json === 'function') {
    res.status(statusCode).json(payload);
  } else {
    res.writeHead(statusCode, {
      'Content-Type': 'application/json; charset=utf-8',
      'X-Content-Type-Options': 'nosniff',
    });
    res.end(JSON.stringify(payload));
  }
}

export default async function handler(req: any, res: any) {
  try {
    // 1. Reconstruct real URL path if rewritten by Vercel catch-all
    if (req.query?.all) {
      const sub = Array.isArray(req.query.all) ? req.query.all.join('/') : String(req.query.all);
      const qIdx = (req.url || '').indexOf('?');
      const rawSearch = qIdx !== -1 ? (req.url || '').slice(qIdx + 1) : '';
      const params = new URLSearchParams(rawSearch);
      params.delete('all');
      const cleanedSearch = params.toString();
      req.url = `/api/${sub}${cleanedSearch ? `?${cleanedSearch}` : ''}`;
    } else if (req.headers['x-forwarded-uri']) {
      req.url = req.headers['x-forwarded-uri'];
    }

    // 2. Normalize body if stringified
    if (typeof req.body === 'string' && req.body.trim()) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        // Keep raw body so downstream parser can return a clean 400 JSON error
      }
    }

    // 3. Delegate to API router
    const handled = await handleApiRequest(req, res);
    if (!handled) {
      sendSafeJson(res, 404, {
        success: false,
        code: 'NOT_FOUND',
        message: 'API route not found.',
      });
    }
  } catch (error: any) {
    console.error('[API Serverless Error]:', error?.message || error);
    sendSafeJson(res, 500, {
      success: false,
      code: 'INTERNAL_SERVER_ERROR',
      message: 'Service temporarily unavailable. Please try again.',
    });
  }
}
