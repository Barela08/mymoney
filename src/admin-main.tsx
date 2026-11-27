import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import AdminApp from './components/admin/AdminApp.tsx';

if (typeof window !== 'undefined') {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  const isSubdomain = (window.location.hostname || '').toLowerCase().startsWith('admin.');
  if (!isSubdomain && path !== '/admin' && !path.startsWith('/admin/')) {
    window.history.replaceState(null, '', '/admin' + window.location.search + window.location.hash);
  }
}

createRoot(document.getElementById('admin-root')!).render(
  <StrictMode>
    <AdminApp />
  </StrictMode>
);
