/**
 * Cross-Platform Native Bridge for Automatic UPI Payment Detection
 * Product: My Money Manager by HackifyPro
 *
 * Platform Behavior:
 * - Android Native Shell (window.HackifyProUpiBridge): Connects directly to
 *   UpiDetectionBridge.kt / UpiNotificationListenerService.kt for real OS
 *   Notification Access status, opening Android Notification Access Settings,
 *   and receiving live notification payloads.
 * - Android Mobile Browser (PWA): Reports 'not_supported' for OS-level
 *   cross-app notification listening and guides user cleanly without faking.
 * - iOS (Safari / WebView): Honestly reports 'not_supported' because Apple iOS
 *   does not allow third-party apps to read notifications from other apps.
 * - Desktop Web: Reports 'not_supported' for live OS capture while allowing
 *   configuration review and explicit sanitized parser tests.
 */

import type {
  DetectionRuntimePlatform,
  NotificationAccessStatus,
  RawNotificationInput,
} from './upiDetectionEngine';

export interface HackifyProAndroidUpiBridge {
  getNotificationAccessStatus: () => string;
  openNotificationAccessSettings: () => boolean;
  setDetectionEnabled: (enabled: boolean) => boolean;
  setAutoPopupEnabled: (enabled: boolean) => boolean;
  setSupportedAppsCsv: (csv: string) => boolean;
  getPendingQueueJson: () => string;
  clearPendingQueueItem: (detectedId: string) => boolean;
  isServiceComponentEnabled?: () => boolean;
}

declare global {
  interface Window {
    HackifyProUpiBridge?: HackifyProAndroidUpiBridge;
  }
}

export function getNativeAndroidBridge(): HackifyProAndroidUpiBridge | null {
  if (typeof window === 'undefined') return null;
  const bridge = window.HackifyProUpiBridge;
  if (bridge && typeof bridge.getNotificationAccessStatus === 'function') {
    return bridge;
  }
  return null;
}

export function detectRuntimePlatform(): DetectionRuntimePlatform {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') {
    return 'desktop_web';
  }
  if (getNativeAndroidBridge()) {
    return 'android_native_bridge';
  }
  const ua = navigator.userAgent || '';
  if (/android/i.test(ua)) {
    return 'android_web';
  }
  if (/iPad|iPhone|iPod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)) {
    return 'ios';
  }
  return 'desktop_web';
}

export function getPlatformCapabilitySummary(platform: DetectionRuntimePlatform): {
  title: string;
  description: string;
  supportsLiveNotificationAccess: boolean;
} {
  switch (platform) {
    case 'android_native_bridge':
      return {
        title: 'Android Native Notification Access Supported',
        description:
          'This Android device can listen to outgoing UPI payment notifications from Google Pay, PhonePe, Paytm, and BHIM once you grant Notification Access in Android Settings.',
        supportsLiveNotificationAccess: true,
      };
    case 'android_web':
      return {
        title: 'Android Browser Session (Native App Required for Live Capture)',
        description:
          'Web browsers cannot read notifications from other apps. Install the Android app build with the Notification Listener module for live automatic detection, or use manual tracking here.',
        supportsLiveNotificationAccess: false,
      };
    case 'ios':
      return {
        title: 'iOS Platform Limitation',
        description:
          'Apple iOS does not allow third-party apps to read notifications from Google Pay, PhonePe, Paytm, or BHIM. Manual expense entry and receipt scanning remain fully available.',
        supportsLiveNotificationAccess: false,
      };
    default:
      return {
        title: 'Desktop Web Session',
        description:
          'Automatic UPI notification reading requires Android Notification Access on an Android device. You can manage preferences, review pending UPI detections synced from Android, or run a parser test here.',
        supportsLiveNotificationAccess: false,
      };
  }
}

const VALID_STATUSES: NotificationAccessStatus[] = [
  'granted',
  'not_granted',
  'disabled',
  'restricted',
  'not_supported',
];

/**
 * Verifies real Notification Access permission status.
 * NEVER assumes granted simply because Settings was opened.
 */
export function verifyNotificationAccessStatus(userDetectionEnabled: boolean): NotificationAccessStatus {
  const bridge = getNativeAndroidBridge();
  if (!bridge) {
    return 'not_supported';
  }
  try {
    const raw = String(bridge.getNotificationAccessStatus() || '').trim().toLowerCase() as NotificationAccessStatus;
    if (!VALID_STATUSES.includes(raw)) {
      return 'not_granted';
    }
    if (raw === 'granted' && !userDetectionEnabled) {
      return 'disabled';
    }
    return raw;
  } catch {
    return 'restricted';
  }
}

export function openAndroidNotificationSettings(): {
  opened: boolean;
  reason?: string;
} {
  const bridge = getNativeAndroidBridge();
  if (!bridge) {
    return {
      opened: false,
      reason: 'Android Notification Access Settings can only be opened inside the Android app wrapper.',
    };
  }
  try {
    const ok = Boolean(bridge.openNotificationAccessSettings());
    return ok
      ? { opened: true }
      : { opened: false, reason: 'Android Settings could not be opened on this device.' };
  } catch {
    return {
      opened: false,
      reason: 'Notification Access Settings are restricted on this device.',
    };
  }
}

export function syncConfigToNativeBridge(params: {
  enabled: boolean;
  autoPopupEnabled: boolean;
  supportedApps: Record<string, boolean>;
}): void {
  const bridge = getNativeAndroidBridge();
  if (!bridge) return;
  try {
    bridge.setDetectionEnabled(params.enabled);
    bridge.setAutoPopupEnabled(params.autoPopupEnabled);
    const enabledCsv = Object.entries(params.supportedApps)
      .filter(([, on]) => Boolean(on))
      .map(([id]) => id)
      .join(',');
    bridge.setSupportedAppsCsv(enabledCsv);
  } catch {
    // Fail safely if WebView bridge is temporarily detached
  }
}

export function drainNativePendingQueue(): Array<RawNotificationInput & { id?: string }> {
  const bridge = getNativeAndroidBridge();
  if (!bridge) return [];
  try {
    const raw = bridge.getPendingQueueJson();
    const parsed = JSON.parse(raw || '[]');
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((item) => item && typeof item === 'object')
      .map((item: any) => ({
        id: item.id,
        packageName: String(item.sourcePackage || item.packageName || ''),
        title: String(item.title || `Paid ₹${item.amountRupees || (Number(item.amountPaise || 0) / 100)}`),
        text: String(
          item.text ||
            [
              `Paid ₹${item.amountRupees || (Number(item.amountPaise || 0) / 100)}`,
              item.merchantName ? `to ${item.merchantName}` : '',
              item.utrNumber ? `UTR: ${item.utrNumber}` : '',
              item.upiTransactionId ? `Txn ID: ${item.upiTransactionId}` : '',
              item.rrn ? `RRN: ${item.rrn}` : '',
            ]
              .filter(Boolean)
              .join(' ')
        ),
        notificationTimestamp: item.notificationTimestamp || item.notificationTimestampMs,
      }));
  } catch {
    return [];
  }
}

export function acknowledgeNativeQueueItem(detectedId: string): void {
  const bridge = getNativeAndroidBridge();
  if (!bridge || !detectedId) return;
  try {
    bridge.clearPendingQueueItem(detectedId);
  } catch {
    // ignore
  }
}

/**
 * Subscribes to app resume events (visibilitychange, focus, pageshow) so permission
 * grants or revocations made in Android Settings are automatically reflected.
 */
export function subscribeToAppResume(callback: () => void): () => void {
  if (typeof window === 'undefined' || typeof document === 'undefined') {
    return () => {};
  }
  const handleVisibility = () => {
    if (document.visibilityState === 'visible') {
      callback();
    }
  };
  const handleFocus = () => callback();
  const handlePageShow = () => callback();

  document.addEventListener('visibilitychange', handleVisibility);
  window.addEventListener('focus', handleFocus);
  window.addEventListener('pageshow', handlePageShow);

  return () => {
    document.removeEventListener('visibilitychange', handleVisibility);
    window.removeEventListener('focus', handleFocus);
    window.removeEventListener('pageshow', handlePageShow);
  };
}
