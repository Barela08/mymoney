import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

if (typeof window !== 'undefined') {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/mystaff' && !path.startsWith('/mystaff/') && !window.location.hash.startsWith('#mystaff')) {
    window.location.hash = '#mystaff';
  }

  // Register dedicated Staff App Service Worker under /mystaff scope
  if ('serviceWorker' in navigator) {
    const isSecureContext =
      window.isSecureContext ||
      window.location.hostname === 'localhost' ||
      window.location.hostname === '127.0.0.1';

    if (isSecureContext) {
      window.addEventListener('load', async () => {
        try {
          const existing = await navigator.serviceWorker.getRegistration('/mystaff');
          if (existing && existing.active?.scriptURL?.endsWith('/mystaff-sw.js')) {
            existing.update().catch(() => {});
          } else {
            await navigator.serviceWorker.register('/mystaff-sw.js', {
              scope: '/mystaff',
              updateViaCache: 'none',
            });
          }
        } catch (error) {
          console.warn('[Staff PWA] Service Worker registration notice:', error);
        }
      });
    }
  }
}

createRoot(document.getElementById('staff-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
