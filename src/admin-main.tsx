import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import App from './App.tsx';

if (typeof window !== 'undefined') {
  const path = window.location.pathname.replace(/\/+$/, '') || '/';
  if (path !== '/admin' && !window.location.hash.startsWith('#admin')) {
    window.location.hash = '#admin';
  }
}

createRoot(document.getElementById('admin-root')!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
