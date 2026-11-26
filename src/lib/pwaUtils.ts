/**
 * Pure PWA installation, browser compatibility, push support & device parsing utilities.
 * Shared across frontend UI and unit tests (no side effects).
 */

export type InstallPlatform =
  | 'chrome_desktop'
  | 'chrome_android'
  | 'edge_desktop'
  | 'edge_android'
  | 'ios_safari'
  | 'macos_safari'
  | 'firefox'
  | 'other';

export interface PlatformCompatibilityInfo {
  platform: InstallPlatform;
  browserLabel: string;
  osLabel: string;
  deviceLabel: string;
  supportsNativeInstallPrompt: boolean;
  supportsManualInstall: boolean;
  requiresHomeScreenForPush: boolean;
}

export interface DismissalStateInput {
  sessionDismissed: boolean;
  persistedDismissedAt: number | null;
  nowMs?: number;
  cooldownMs?: number;
}

export const DEFAULT_DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000; // 14 days

/**
 * Detect browser + OS + PWA install capability from User-Agent.
 */
export function detectPlatformCompatibility(
  userAgent: string,
  maxTouchPoints: number = 0
): PlatformCompatibilityInfo {
  const ua = (userAgent || '').toLowerCase();

  const isIPadOSDesktopUA = ua.includes('macintosh') && maxTouchPoints > 1;
  const isIOS = /iphone|ipad|ipod/.test(ua) || isIPadOSDesktopUA;
  const isAndroid = ua.includes('android');
  const isMacOS = ua.includes('mac os x') && !isIOS;
  const isWindows = ua.includes('windows');
  const isLinux = ua.includes('linux') && !isAndroid;

  const isEdge = ua.includes('edg/') || ua.includes('edga/') || ua.includes('edgios/');
  const isFirefox = ua.includes('firefox/') || ua.includes('fxios/');
  const isOpera = ua.includes('opr/') || ua.includes('opera');
  const isSamsung = ua.includes('samsungbrowser/');
  const isChrome =
    (ua.includes('chrome/') || ua.includes('crios/')) && !isEdge && !isOpera && !isSamsung;
  const isSafari =
    ua.includes('safari/') && !isChrome && !isEdge && !isFirefox && !isOpera && !isSamsung;

  let osLabel = 'Unknown OS';
  if (isIOS) osLabel = ua.includes('ipad') || isIPadOSDesktopUA ? 'iPadOS' : 'iOS';
  else if (isAndroid) osLabel = 'Android';
  else if (isWindows) osLabel = 'Windows';
  else if (isMacOS) osLabel = 'macOS';
  else if (isLinux) osLabel = 'Linux';

  let browserLabel = 'Browser';
  if (isEdge) browserLabel = 'Edge';
  else if (isChrome) browserLabel = 'Chrome';
  else if (isSafari) browserLabel = 'Safari';
  else if (isFirefox) browserLabel = 'Firefox';
  else if (isSamsung) browserLabel = 'Samsung Internet';
  else if (isOpera) browserLabel = 'Opera';

  let platform: InstallPlatform = 'other';
  let supportsNativeInstallPrompt = false;
  let supportsManualInstall = false;
  let requiresHomeScreenForPush = false;

  if (isIOS) {
    platform = 'ios_safari';
    supportsNativeInstallPrompt = false;
    supportsManualInstall = true;
    requiresHomeScreenForPush = true;
  } else if (isMacOS && isSafari) {
    platform = 'macos_safari';
    supportsNativeInstallPrompt = false;
    supportsManualInstall = true;
    requiresHomeScreenForPush = false;
  } else if (isEdge && isAndroid) {
    platform = 'edge_android';
    supportsNativeInstallPrompt = true;
    supportsManualInstall = true;
  } else if (isEdge) {
    platform = 'edge_desktop';
    supportsNativeInstallPrompt = true;
    supportsManualInstall = true;
  } else if (isChrome && isAndroid) {
    platform = 'chrome_android';
    supportsNativeInstallPrompt = true;
    supportsManualInstall = true;
  } else if (isChrome) {
    platform = 'chrome_desktop';
    supportsNativeInstallPrompt = true;
    supportsManualInstall = true;
  } else if (isFirefox) {
    platform = 'firefox';
    supportsNativeInstallPrompt = false;
    supportsManualInstall = isAndroid;
  } else if (isAndroid) {
    platform = 'chrome_android';
    supportsNativeInstallPrompt = true;
    supportsManualInstall = true;
  }

  return {
    platform,
    browserLabel,
    osLabel,
    deviceLabel: `${browserLabel} on ${osLabel}`,
    supportsNativeInstallPrompt,
    supportsManualInstall,
    requiresHomeScreenForPush,
  };
}

/**
 * Determine if the app is currently running in installed standalone display mode.
 */
export function isRunningStandalone(): boolean {
  if (typeof window === 'undefined') return false;
  const matchStandalone =
    window.matchMedia?.('(display-mode: standalone)').matches ||
    window.matchMedia?.('(display-mode: window-controls-overlay)').matches;
  const iosStandalone = (window.navigator as Navigator & { standalone?: boolean }).standalone === true;
  const androidTwa = typeof document !== 'undefined' && Boolean(document.referrer?.includes('android-app://'));
  return Boolean(matchStandalone || iosStandalone || androidTwa);
}

/**
 * Evaluates whether promotional install prompt suggestions should stay suppressed.
 * Note: This ONLY affects automatic suggestions, never the manual top-right header entry point
 * when installation remains available and the app is not installed.
 */
export function isInstallSuggestionSuppressed(input: DismissalStateInput): boolean {
  if (input.sessionDismissed) return true;
  if (input.persistedDismissedAt === null || !Number.isFinite(input.persistedDismissedAt)) {
    return false;
  }
  const now = input.nowMs ?? Date.now();
  const cooldown = input.cooldownMs ?? DEFAULT_DISMISS_COOLDOWN_MS;
  return now - input.persistedDismissedAt < cooldown;
}

/**
 * Validate a Web Push subscription endpoint URL strictly (HTTPS only, no private/loopback SSRF targets).
 */
export function isValidPushEndpoint(endpoint: string): boolean {
  if (!endpoint || typeof endpoint !== 'string') return false;
  const trimmed = endpoint.trim();
  if (trimmed.length < 16 || trimmed.length > 2048) return false;
  try {
    const parsed = new URL(trimmed);
    if (parsed.protocol !== 'https:') return false;
    const host = parsed.hostname.toLowerCase();
    if (
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0' ||
      host.endsWith('.local') ||
      host.endsWith('.internal') ||
      /^10\./.test(host) ||
      /^192\.168\./.test(host) ||
      /^169\.254\./.test(host) ||
      /^172\.(1[6-9]|2\d|3[0-1])\./.test(host)
    ) {
      return false;
    }
    return Boolean(host.includes('.'));
  } catch {
    return false;
  }
}

/**
 * Compare two VAPID public keys (Uint8Array vs base64url string) to detect key rotation.
 */
export function uint8ArrayToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    binary += String.fromCharCode(bytes[i]);
  }
  const base64 =
    typeof btoa === 'function'
      ? btoa(binary)
      : Buffer.from(bytes).toString('base64');
  return base64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
