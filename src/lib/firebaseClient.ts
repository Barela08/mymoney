/**
 * Firebase Web SDK Google Sign-In Client Helper
 * My Money Manager by HackifyPro
 *
 * Lazily initializes Firebase Auth using environment variables (`VITE_FIREBASE_*`).
 * Never hardcodes secrets; always sends the Firebase ID Token to `/api/auth/google`
 * for server-side cryptographic verification and canonical `app_users.id` resolution.
 */

import { initializeApp, getApps, type FirebaseApp } from 'firebase/app';
import { getAuth, GoogleAuthProvider, signInWithPopup, signOut } from 'firebase/auth';

function getFirebaseWebConfig() {
  const apiKey = (import.meta.env.VITE_FIREBASE_API_KEY || '').trim();
  const authDomain = (import.meta.env.VITE_FIREBASE_AUTH_DOMAIN || '').trim();
  const projectId = (import.meta.env.VITE_FIREBASE_PROJECT_ID || '').trim();
  const appId = (import.meta.env.VITE_FIREBASE_APP_ID || '').trim();

  if (!apiKey || !authDomain || !projectId) {
    return null;
  }
  return { apiKey, authDomain, projectId, appId: appId || undefined };
}

export function isFirebaseGoogleConfigured(): boolean {
  return Boolean(getFirebaseWebConfig());
}

let cachedApp: FirebaseApp | null = null;

function ensureFirebaseApp(): FirebaseApp {
  if (cachedApp) return cachedApp;
  const config = getFirebaseWebConfig();
  if (!config) {
    throw new Error(
      'Google Sign-In requires Firebase web configuration (VITE_FIREBASE_API_KEY, VITE_FIREBASE_AUTH_DOMAIN, VITE_FIREBASE_PROJECT_ID). Please configure these environment variables in your deployment settings.'
    );
  }
  const existing = getApps();
  cachedApp = existing.length > 0 ? existing[0] : initializeApp(config);
  return cachedApp;
}

function normalizeFirebaseAuthError(err: any): Error {
  const code = String(err?.code || '');
  const msg = String(err?.message || '');
  const host = typeof window !== 'undefined' ? window.location.hostname : '';

  if (code === 'auth/unauthorized-domain' || msg.includes('auth/unauthorized-domain')) {
    return new Error(
      host
        ? `Google Sign-In is not authorized for "${host}". Add "${host}" under Firebase Console → Authentication → Settings → Authorized domains, or sign in with Email & Password.`
        : 'Google Sign-In is not authorized for this domain in Firebase Console → Authentication → Settings → Authorized domains.'
    );
  }
  if (code === 'auth/popup-blocked' || msg.includes('auth/popup-blocked')) {
    return new Error('Google Sign-In popup was blocked by your browser. Please allow popups for this site and try again.');
  }
  if (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    msg.includes('popup-closed-by-user') ||
    msg.includes('cancelled-popup-request')
  ) {
    return new Error('Google Sign-In was cancelled before completion.');
  }
  if (code === 'auth/operation-not-allowed' || msg.includes('auth/operation-not-allowed')) {
    return new Error('Google Sign-In is disabled in Firebase Authentication settings.');
  }
  if (code === 'auth/network-request-failed' || msg.includes('auth/network-request-failed')) {
    return new Error('Network error while connecting to Google Sign-In. Please check your internet connection.');
  }
  return err instanceof Error ? err : new Error(msg || 'Google sign-in failed.');
}

export async function signInWithFirebaseGoogle(): Promise<{
  idToken: string;
  email: string | null;
  displayName: string | null;
}> {
  const app = ensureFirebaseApp();
  const auth = getAuth(app);
  const provider = new GoogleAuthProvider();
  provider.setCustomParameters({ prompt: 'select_account' });

  let result;
  try {
    result = await signInWithPopup(auth, provider);
  } catch (err: any) {
    throw normalizeFirebaseAuthError(err);
  }

  const idToken = await result.user.getIdToken(true);

  // Immediately clear client Firebase session so canonical backend session remains the single source of truth
  await signOut(auth).catch(() => {});

  return {
    idToken,
    email: result.user.email,
    displayName: result.user.displayName,
  };
}
