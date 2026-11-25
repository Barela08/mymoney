/**
 * Vercel catch-all API entry point.
 *
 * The router is imported lazily so a failure while loading an optional
 * dependency can never surface as Vercel's HTML/text "server error" page.
 * Every path through this function answers with JSON.
 */
export default async function handler(req: any, res: any) {
  const sendJson = (status: number, payload: Record<string, any>) => {
    if (!res.writableEnded && !res.headersSent) {
      if (typeof res.status === 'function' && typeof res.json === 'function') {
        res.status(status).json(payload);
      } else {
        res.writeHead(status, {
          'Content-Type': 'application/json',
          'Cache-Control': 'no-store',
          'X-Content-Type-Options': 'nosniff',
        });
        res.end(JSON.stringify(payload));
      }
    }
  };

  try {
    // 1. Reconstruct the real URL path if rewritten by the Vercel catch-all
    if (req.query?.all) {
      const sub = Array.isArray(req.query.all) ? req.query.all.join('/') : req.query.all;
      const qIdx = (req.url || '').indexOf('?');
      const search = qIdx !== -1 ? (req.url || '').slice(qIdx) : '';
      req.url = `/api/${sub}${search}`;
    } else if (req.headers?.['x-forwarded-uri']) {
      req.url = req.headers['x-forwarded-uri'];
    }

    // 2. Normalize stringified bodies
    if (typeof req.body === 'string' && req.body.trim()) {
      try {
        req.body = JSON.parse(req.body);
      } catch {
        /* invalid JSON is handled by the router's body parser */
      }
    }

    // 3. Delegate to the API router (loaded lazily, see note above)
    const { handleApiRequest } = await import('../server/api');
    const handled = await handleApiRequest(req, res);

    if (!handled) {
      sendJson(404, { success: false, code: 'NOT_FOUND', message: 'API route not found.' });
    }
  } catch (error: any) {
    console.error('API Serverless Error:', error);
    sendJson(503, {
      success: false,
      code: 'API_UNAVAILABLE',
      message:
        'The service is temporarily unavailable. No changes were made to your data. Please try again in a moment.',
    });
  }
}
