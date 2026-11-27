import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

if (typeof window !== 'undefined') {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const isAdminSubdomain = window.location.hostname.toLowerCase().startsWith('admin.');
  if (path === '/admin') {
    window.history.replaceState(null, '', `/myadmin${window.location.search}${window.location.hash}`);
  } else if (
    path !== '/myadmin' &&
    !path.startsWith('/myadmin/') &&
    !isAdminSubdomain &&
    !window.location.hash.startsWith('#myadmin') &&
    !window.location.hash.startsWith('#admin')
  ) {
    window.location.hash = '#myadmin';
  }

  // Register dedicated Admin App Service Worker under /myadmin scope
  if ('serviceWorker' in navigator) {
    const isSecureContext =
      window.isSecureContext ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (isSecureContext) {
      const targetScope = isAdminSubdomain ? '/' : '/myadmin';
      window.addEventListener('load', async () => {
        try {
          const existing = await navigator.serviceWorker.getRegistration(targetScope);
          if (existing && existing.active?.scriptURL?.endsWith('/myadmin-sw.js')) {
            existing.update().catch(() => {});
          } else {
            await navigator.serviceWorker.register('/myadmin-sw.js', {
              scope: targetScope,
              updateViaCache: 'none',
            });
          }
        } catch (error) {
          console.warn('[Admin PWA] Service Worker registration notice:', error);
        }
      });
    }
  }
}

createRoot(document.getElementById('admin-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
