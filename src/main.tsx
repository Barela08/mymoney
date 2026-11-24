import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

// Register a single deduplicated Service Worker for PWA offline & Web Push support
if (typeof window !== 'undefined' && 'serviceWorker' in navigator) {
  const isSecureContext =
    window.isSecureContext ||
    window.location.hostname === 'localhost' ||
    window.location.hostname === '127.0.0.1';

  if (isSecureContext) {
    window.addEventListener('load', async () => {
      try {
        const existing = await navigator.serviceWorker.getRegistration('/');
        if (existing && existing.active?.scriptURL?.endsWith('/sw.js')) {
          // Reuse existing registration without creating duplicates; trigger gentle update check
          existing.update().catch(() => {});
        } else {
          await navigator.serviceWorker.register('/sw.js', {
            scope: '/',
            updateViaCache: 'none',
          });
        }
      } catch (error) {
        console.warn('[PWA] Service Worker registration notice:', error);
      }
    });
  }
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
