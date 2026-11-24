import React, { createContext, useContext, useState, useEffect, useCallback, useMemo } from 'react';
import { pushNotifications } from '../lib/pushNotifications';
import { useToast } from './ToastContext';

export type HardwarePermissionStatus =
  | 'prompt'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'restricted'
  | 'unavailable'
  | 'unsupported';

export type NotificationPermissionStatus =
  | 'prompt'
  | 'requesting'
  | 'granted'
  | 'denied'
  | 'unsupported';

export interface PermissionDetails {
  id: 'microphone' | 'camera' | 'notifications';
  name: string;
  purpose: string;
  featuresUsedBy: string[];
  status: HardwarePermissionStatus | NotificationPermissionStatus;
  isSupported: boolean;
  instructions: {
    desktop: string[];
    android: string[];
    ios: string[];
  };
}

interface PermissionContextType {
  micStatus: HardwarePermissionStatus;
  cameraStatus: HardwarePermissionStatus;
  notifStatus: NotificationPermissionStatus;
  isChecking: boolean;
  checkAllPermissions: () => Promise<void>;
  requestMicrophone: () => Promise<{ success: boolean; status: HardwarePermissionStatus; error?: string }>;
  requestCamera: () => Promise<{ success: boolean; status: HardwarePermissionStatus; error?: string }>;
  requestNotification: () => Promise<{ success: boolean; status: NotificationPermissionStatus; error?: string }>;
  permissionsList: PermissionDetails[];
}

const PermissionContext = createContext<PermissionContextType | undefined>(undefined);

export const PermissionProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const toast = useToast();
  const [micStatus, setMicStatus] = useState<HardwarePermissionStatus>('prompt');
  const [cameraStatus, setCameraStatus] = useState<HardwarePermissionStatus>('prompt');
  const [notifStatus, setNotifStatus] = useState<NotificationPermissionStatus>('prompt');
  const [isChecking, setIsChecking] = useState<boolean>(true);

  // Check all permissions gracefully without provoking unwanted browser prompts
  const checkAllPermissions = useCallback(async () => {
    setIsChecking(true);

    // 1. Notification Permission Status
    if (typeof window !== 'undefined' && 'Notification' in window) {
      const perm = Notification.permission;
      setNotifStatus(perm === 'default' ? 'prompt' : perm);
    } else {
      setNotifStatus('unsupported');
    }

    // 2. Query Permissions API where supported by browser
    if (typeof navigator !== 'undefined' && navigator.permissions?.query) {
      try {
        const micQuery = await navigator.permissions.query({ name: 'microphone' as any });
        setMicStatus(micQuery.state as HardwarePermissionStatus);
        micQuery.onchange = () => {
          setMicStatus(micQuery.state as HardwarePermissionStatus);
        };
      } catch {
        const hasMedia = typeof navigator.mediaDevices?.getUserMedia === 'function';
        setMicStatus(hasMedia ? 'prompt' : 'unsupported');
      }

      try {
        const camQuery = await navigator.permissions.query({ name: 'camera' as any });
        setCameraStatus(camQuery.state as HardwarePermissionStatus);
        camQuery.onchange = () => {
          setCameraStatus(camQuery.state as HardwarePermissionStatus);
        };
      } catch {
        const hasMedia = typeof navigator.mediaDevices?.getUserMedia === 'function';
        setCameraStatus(hasMedia ? 'prompt' : 'unsupported');
      }
    } else {
      const hasMedia = typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function';
      setMicStatus(hasMedia ? 'prompt' : 'unsupported');
      setCameraStatus(hasMedia ? 'prompt' : 'unsupported');
    }

    setIsChecking(false);
  }, []);

  useEffect(() => {
    checkAllPermissions();
  }, [checkAllPermissions]);

  // Request Microphone on explicit user action
  const requestMicrophone = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setMicStatus('unsupported');
      return { success: false, status: 'unsupported' as const, error: 'Microphone not supported in this browser' };
    }

    setMicStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      // Immediately stop hardware track so indicator turns off
      stream.getTracks().forEach((track) => track.stop());
      setMicStatus('granted');
      toast.success('Microphone Allowed', 'Voice input is ready to use.');
      return { success: true, status: 'granted' as const };
    } catch (err: any) {
      let status: HardwarePermissionStatus = 'denied';
      let errorMsg = 'Microphone permission was denied.';

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        status = 'denied';
        errorMsg = 'Microphone permission was blocked. Please enable it in browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        status = 'unavailable';
        errorMsg = 'No microphone hardware found on this device.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        status = 'restricted';
        errorMsg = 'Microphone is currently in use by another application.';
      } else {
        status = 'denied';
        errorMsg = err.message || 'Could not access microphone.';
      }

      setMicStatus(status);
      toast.error('Microphone Access', errorMsg);
      return { success: false, status, error: errorMsg };
    }
  }, [toast]);

  // Request Camera on explicit user action (e.g. Scan QR, Scan Receipt)
  const requestCamera = useCallback(async () => {
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setCameraStatus('unsupported');
      return { success: false, status: 'unsupported' as const, error: 'Camera not supported in this browser' };
    }

    setCameraStatus('requesting');
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: 'environment' } },
      });
      // Immediately stop hardware track so camera light turns off
      stream.getTracks().forEach((track) => track.stop());
      setCameraStatus('granted');
      toast.success('Camera Allowed', 'QR Code scanner and receipt camera are ready.');
      return { success: true, status: 'granted' as const };
    } catch (err: any) {
      let status: HardwarePermissionStatus = 'denied';
      let errorMsg = 'Camera permission was denied.';

      if (err.name === 'NotAllowedError' || err.name === 'PermissionDeniedError') {
        status = 'denied';
        errorMsg = 'Camera permission was blocked. Please enable it in browser settings.';
      } else if (err.name === 'NotFoundError' || err.name === 'DevicesNotFoundError') {
        status = 'unavailable';
        errorMsg = 'No camera device found on this system.';
      } else if (err.name === 'NotReadableError' || err.name === 'TrackStartError') {
        status = 'restricted';
        errorMsg = 'Camera is currently in use by another tab or application.';
      } else {
        status = 'denied';
        errorMsg = err.message || 'Could not access camera.';
      }

      setCameraStatus(status);
      toast.error('Camera Access', errorMsg);
      return { success: false, status, error: errorMsg };
    }
  }, [toast]);

  // Request Notification permission and create push subscription on explicit user action
  const requestNotification = useCallback(async () => {
    if (!pushNotifications.isSupported()) {
      setNotifStatus('unsupported');
      toast.error('Unsupported', 'Push notifications are not supported in this browser.');
      return { success: false, status: 'unsupported' as const, error: 'Not supported' };
    }

    setNotifStatus('requesting');
    try {
      const result = await pushNotifications.subscribe();
      const currentPerm = Notification.permission;
      const finalStatus: NotificationPermissionStatus =
        currentPerm === 'granted' ? 'granted' : currentPerm === 'denied' ? 'denied' : 'prompt';

      setNotifStatus(finalStatus);

      if (result.success && finalStatus === 'granted') {
        toast.success('Alerts Activated', 'You will receive reminders for recurring bills and budget alerts.');
        return { success: true, status: 'granted' as const };
      } else {
        const errorMsg = result.error || 'Failed to complete push notification registration.';
        if (finalStatus === 'denied') {
          toast.error('Notifications Blocked', 'Please enable notifications in your browser site settings.');
        } else {
          toast.error('Notification Setup', errorMsg);
        }
        return { success: false, status: finalStatus, error: errorMsg };
      }
    } catch (err: any) {
      setNotifStatus('denied');
      toast.error('Notification Error', err?.message || 'Failed to enable notifications.');
      return { success: false, status: 'denied' as const, error: err?.message };
    }
  }, [toast]);

  const permissionsList = useMemo<PermissionDetails[]>(
    () => [
      {
        id: 'microphone',
        name: 'Microphone Access',
        purpose: 'Allows voice commands, transaction dictation, and hands-free financial search.',
        featuresUsedBy: ['AI Money Assistant', 'Voice Search Dictation', 'Voice Transaction Entry'],
        status: micStatus,
        isSupported: micStatus !== 'unsupported',
        instructions: {
          desktop: [
            'Click the 🔒 (Lock) or ⚙️ (Settings) icon on the left side of your browser address bar.',
            'Locate "Microphone" in the permissions list.',
            'Change the setting from "Block" to "Allow".',
            'Refresh the page or tap Try Again.',
          ],
          android: [
            'Tap the three dots (⋮) in the top-right corner of Chrome.',
            'Go to Settings > Site settings > Microphone.',
            'Ensure microphone is enabled and remove this site from the Blocked list.',
          ],
          ios: [
            'Open the iOS Settings app.',
            'Scroll down and tap Safari (or your preferred browser).',
            'Under "Settings for Websites", tap Microphone and choose "Allow" or "Ask".',
          ],
        },
      },
      {
        id: 'camera',
        name: 'Camera Access',
        purpose: 'Used exclusively to scan peer Udhar QR codes, verify UPI recipient VPAs, and capture receipts for OCR.',
        featuresUsedBy: ['Udhar QR Code Scanner', 'UPI Payment QR Scanner', 'Receipt Scanner (OCR)'],
        status: cameraStatus,
        isSupported: cameraStatus !== 'unsupported',
        instructions: {
          desktop: [
            'Click the 🔒 (Lock) icon on the left side of the address bar.',
            'Locate "Camera" in the permissions dropdown.',
            'Select "Allow" and reload or retry the scanner.',
          ],
          android: [
            'Tap the three dots (⋮) > Settings > Site settings > Camera.',
            'Check that Camera is turned On and not blocked for this site.',
          ],
          ios: [
            'Open the iOS Settings app > Safari > Camera.',
            'Set Camera permission to "Allow" or "Ask".',
          ],
        },
      },
      {
        id: 'notifications',
        name: 'Push Notifications',
        purpose: 'Sends timely reminders for recurring bill due dates, safe-to-spend alerts, and budget exhaustion warnings.',
        featuresUsedBy: ['Recurring Bill Due Date Alerts', 'Monthly Budget Warnings', 'Udhar Confirmation Notices'],
        status: notifStatus,
        isSupported: notifStatus !== 'unsupported',
        instructions: {
          desktop: [
            'Click the 🔒 (Lock) icon in the address bar.',
            'Locate "Notifications" and select "Allow".',
          ],
          android: [
            'Tap the three dots (⋮) > Settings > Notifications > Sites.',
            'Make sure notifications are allowed for this domain.',
          ],
          ios: [
            'Add My Money Manager to your Home Screen first (required by iOS 16.4+ for web push).',
            'Open the installed app from your Home Screen, then tap "Enable Alerts" in Settings.',
          ],
        },
      },
    ],
    [micStatus, cameraStatus, notifStatus]
  );

  return (
    <PermissionContext.Provider
      value={{
        micStatus,
        cameraStatus,
        notifStatus,
        isChecking,
        checkAllPermissions,
        requestMicrophone,
        requestCamera,
        requestNotification,
        permissionsList,
      }}
    >
      {children}
    </PermissionContext.Provider>
  );
};

export const usePermissionManager = (): PermissionContextType => {
  const context = useContext(PermissionContext);
  if (!context) {
    throw new Error('usePermissionManager must be used within a PermissionProvider');
  }
  return context;
};
