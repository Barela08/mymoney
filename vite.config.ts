import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function backendApiPlugin(): Plugin {
  return {
    name: 'backend-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        try {
          const apiModule = await server.ssrLoadModule('./server/api.ts');
          const handled = await apiModule.handleApiRequest(req, res);
          if (!handled) {
            next();
          }
        } catch (err) {
          next(err);
        }
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (_req, _res, next) => {
        try {
          // Preview server fallback
          next();
        } catch (err) {
          next(err);
        }
      });
    },
  };
}

// https://vite.dev/config/
export default defineConfig({
  plugins: [react(), backendApiPlugin()],
  server: {
    port: 5173,
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
        "img-src 'self' data: https:",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    },
  },
  preview: {
    port: 4173,
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline'",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co",
        "img-src 'self' data: https:",
        "frame-ancestors 'none'",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
      'X-Frame-Options': 'DENY',
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=()',
      'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
});
