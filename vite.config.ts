import path from 'path';
import react from '@vitejs/plugin-react';
import { defineConfig, type Plugin } from 'vite';

function isAdminEntryRequest(urlStr: string | undefined, hostHeader: string | undefined): boolean {
  if (!urlStr) return false;
  const pathname = urlStr.split('?')[0] || '/';
  if (
    pathname.startsWith('/api') ||
    pathname.startsWith('/src/') ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/node_modules/') ||
    pathname.startsWith('/@') ||
    pathname === '/admin-sw.js' ||
    pathname === '/admin-manifest.json' ||
    pathname === '/admin-subdomain-manifest.json' ||
    pathname === '/admin-offline.html' ||
    pathname === '/admin.html'
  ) {
    return false;
  }

  // Pass static files through directly
  const lastSegment = pathname.split('/').pop() || '';
  if (lastSegment.includes('.')) {
    return false;
  }

  const host = (hostHeader || '').toLowerCase().split(':')[0];
  if (host.startsWith('admin.')) {
    return true;
  }

  return pathname === '/admin' || pathname.startsWith('/admin/');
}

function backendApiPlugin(): Plugin {
  return {
    name: 'backend-api-plugin',
    configureServer(server) {
      server.middlewares.use(async (req, res, next) => {
        if (req.url && req.url.startsWith('/api')) {
          try {
            const apiModule = await server.ssrLoadModule('./server/api.ts');
            const handled = await apiModule.handleApiRequest(req, res);
            if (!handled) {
              next();
            }
            return;
          } catch (err) {
            return next(err);
          }
        }

        const host = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
        if (isAdminEntryRequest(req.url, host)) {
          req.url = '/admin.html';
        }
        next();
      });
    },
    configurePreviewServer(server) {
      server.middlewares.use(async (req, _res, next) => {
        try {
          const host = Array.isArray(req.headers.host) ? req.headers.host[0] : req.headers.host;
          if (isAdminEntryRequest(req.url, host)) {
            req.url = '/admin.html';
          }
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
  optimizeDeps: {
    include: ['firebase/app', 'firebase/auth'],
  },
  server: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://apis.google.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://apis.google.com https://fcm.googleapis.com https://fcmregistrations.googleapis.com https://firebaseinstallations.googleapis.com",
        "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
        "img-src 'self' data: https:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), publickey-credentials-get=*, publickey-credentials-create=*',
    },
  },
  preview: {
    host: '0.0.0.0',
    port: 3000,
    allowedHosts: true,
    headers: {
      'Content-Security-Policy': [
        "default-src 'self'",
        "script-src 'self' 'unsafe-inline' https://apis.google.com",
        "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
        "font-src 'self' https://fonts.gstatic.com",
        "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://identitytoolkit.googleapis.com https://securetoken.googleapis.com https://www.googleapis.com https://apis.google.com https://fcm.googleapis.com https://fcmregistrations.googleapis.com https://firebaseinstallations.googleapis.com",
        "frame-src 'self' https://*.firebaseapp.com https://accounts.google.com",
        "img-src 'self' data: https:",
        "object-src 'none'",
        "base-uri 'self'",
        "form-action 'self'",
      ].join('; '),
      'X-Content-Type-Options': 'nosniff',
      'Referrer-Policy': 'strict-origin-when-cross-origin',
      'Permissions-Policy': 'camera=(self), microphone=(), geolocation=(), payment=(), publickey-credentials-get=*, publickey-credentials-create=*',
    },
  },
  build: {
    chunkSizeWarningLimit: 800,
    cssCodeSplit: true,
    minify: 'esbuild',
    rollupOptions: {
      input: {
        main: path.resolve(__dirname, 'index.html'),
        admin: path.resolve(__dirname, 'admin.html'),
      },
      output: {
        manualChunks(id) {
          if (id.includes('node_modules')) {
            if (id.includes('react') || id.includes('react-dom')) {
              return 'vendor-react';
            }
            if (id.includes('recharts')) {
              return 'vendor-charts';
            }
            if (id.includes('jsqr') || id.includes('qrcode')) {
              return 'vendor-qr';
            }
            if (id.includes('lucide-react')) {
              return 'vendor-icons';
            }
            if (id.includes('@supabase')) {
              return 'vendor-supabase';
            }
            if (id.includes('firebase')) {
              return 'vendor-firebase';
            }
            return 'vendor-libs';
          }
        },
      },
    },
  },
});
