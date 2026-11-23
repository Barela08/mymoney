import React, { createContext, useContext, useEffect, useState, useCallback } from 'react';

interface BeforeInstallPromptEvent extends Event {
  readonly platforms: string[];
  readonly userChoice: Promise<{
    outcome: 'accepted' | 'dismissed';
    platform: string;
  }>;
  prompt(): Promise<void>;
}

interface PwaInstallContextType {
  isInstallable: boolean;
  isInstalled: boolean;
  isIOS: boolean;
  isModalOpen: boolean;
  openInstallModal: () => void;
  closeInstallModal: () => void;
  triggerInstallPrompt: () => Promise<void>;
  isBannerDismissed: boolean;
  dismissBanner: () => void;
  isScannerActive: boolean;
  setScannerActive: (active: boolean) => void;
  activeModalCount: number;
  setModalsSuppressed: (suppressed: boolean) => void;
  isBannerVisible: boolean;
}

const PwaInstallContext = createContext<PwaInstallContextType | undefined>(undefined);

const DISMISSED_STORAGE_KEY = 'my_money_pwa_install_dismissed';
// 14 days dismissal cooldown period
const DISMISS_COOLDOWN_MS = 14 * 24 * 60 * 60 * 1000;

export const PwaInstallProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [isInstallable, setIsInstallable] = useState<boolean>(false);
  const [isInstalled, setIsInstalled] = useState<boolean>(false);
  const [isIOS, setIsIOS] = useState<boolean>(false);
  const [isModalOpen, setIsModalOpen] = useState<boolean>(false);
  const [isScannerActive, setIsScannerActive] = useState<boolean>(false);
  const [activeModalCount, setActiveModalCount] = useState<number>(0);

  const [isBannerDismissed, setIsBannerDismissed] = useState<boolean>(() => {
    try {
      const saved = localStorage.getItem(DISMISSED_STORAGE_KEY);
      if (saved) {
        const time = parseInt(saved, 10);
        if (!isNaN(time)) {
          // Banner dismissed within the 14-day window
          return Date.now() - time < DISMISS_COOLDOWN_MS;
        }
      }
      return false;
    } catch {
      return false;
    }
  });

  useEffect(() => {
    // Check if running in standalone mode (already installed PWA)
    const checkStandalone = () => {
      const isStandalone =
        window.matchMedia('(display-mode: standalone)').matches ||
        (window.navigator as any).standalone === true ||
        document.referrer.includes('android-app://');
      setIsInstalled(isStandalone);
    };

    checkStandalone();

    // Check iOS device
    const ua = window.navigator.userAgent.toLowerCase();
    const isIosDevice = /iphone|ipad|ipod/.test(ua);
    setIsIOS(isIosDevice);

    // Listen for beforeinstallprompt event (Chromium, Android, Edge, Desktop Chrome)
    const handleBeforeInstallPrompt = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
      setIsInstallable(true);
    };

    // Listen for appinstalled event
    const handleAppInstalled = () => {
      setIsInstalled(true);
      setIsInstallable(false);
      setDeferredPrompt(null);
      setIsModalOpen(false);
      console.log('[PWA] App successfully installed!');
    };

    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
    window.addEventListener('appinstalled', handleAppInstalled);

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt);
      window.removeEventListener('appinstalled', handleAppInstalled);
    };
  }, []);

  const openInstallModal = useCallback(() => {
    setIsModalOpen(true);
  }, []);

  const closeInstallModal = useCallback(() => {
    setIsModalOpen(false);
  }, []);

  // Dismissing only hides the banner and saves timestamp; never triggers prompt, modal or redirects
  const dismissBanner = useCallback(() => {
    setIsBannerDismissed(true);
    try {
      localStorage.setItem(DISMISSED_STORAGE_KEY, Date.now().toString());
    } catch {}
  }, []);

  const setScannerActive = useCallback((active: boolean) => {
    setIsScannerActive(active);
  }, []);

  const setModalsSuppressed = useCallback((suppressed: boolean) => {
    setActiveModalCount((prev) => (suppressed ? prev + 1 : Math.max(0, prev - 1)));
  }, []);

  const triggerInstallPrompt = useCallback(async () => {
    if (deferredPrompt) {
      try {
        await deferredPrompt.prompt();
        const choiceResult = await deferredPrompt.userChoice;
        if (choiceResult.outcome === 'accepted') {
          setIsInstalled(true);
          setIsInstallable(false);
          setIsModalOpen(false);
        }
        setDeferredPrompt(null);
      } catch (err) {
        console.warn('[PWA] Prompt trigger notice:', err);
        setIsModalOpen(true);
      }
    } else {
      // If deferred prompt is not natively available (e.g. iOS Safari or manual instruction), show guide modal
      setIsModalOpen(true);
    }
  }, [deferredPrompt]);

  // Banner is visible only if:
  // 1. Not already installed / not standalone
  // 2. Not dismissed within cooldown
  // 3. Scanner / camera is not active
  // 4. No full modals active
  const isBannerVisible = !isInstalled && !isBannerDismissed && !isScannerActive && activeModalCount === 0;

  return (
    <PwaInstallContext.Provider
      value={{
        isInstallable,
        isInstalled,
        isIOS,
        isModalOpen,
        openInstallModal,
        closeInstallModal,
        triggerInstallPrompt,
        isBannerDismissed,
        dismissBanner,
        isScannerActive,
        setScannerActive,
        activeModalCount,
        setModalsSuppressed,
        isBannerVisible,
      }}
    >
      {children}
    </PwaInstallContext.Provider>
  );
};

export const usePwaInstall = () => {
  const context = useContext(PwaInstallContext);
  if (!context) {
    throw new Error('usePwaInstall must be used within a PwaInstallProvider');
  }
  return context;
};
