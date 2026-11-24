import React, { useState } from 'react';
import { Download } from 'lucide-react';
import { usePwaInstall } from '../../context/PwaInstallContext';

/**
 * Compact, responsive top-right header PWA installation button.
 * - Renders ONLY when installation is genuinely available and the app is not already installed.
 * - Automatically hides once installed (standalone mode or `appinstalled` event).
 * - Matches the standardized `h-9` height of header controls so it never overlaps adjacent controls.
 */
export const HeaderInstallButton: React.FC = () => {
  const { isInstalled, isInstallable, canOfferInstall, triggerInstallPrompt, openInstallModal } =
    usePwaInstall();
  const [isPrompting, setIsPrompting] = useState(false);

  if (isInstalled || !canOfferInstall) {
    return null;
  }

  const handleClick = async () => {
    if (isPrompting) return;
    if (isInstallable) {
      setIsPrompting(true);
      try {
        await triggerInstallPrompt();
      } finally {
        setIsPrompting(false);
      }
    } else {
      // Safari iOS / macOS: open clear platform-specific installation instructions modal
      openInstallModal();
    }
  };

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={isPrompting}
      className="inline-flex items-center justify-center gap-1.5 h-9 px-2.5 sm:px-3 rounded-xl bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white text-xs font-semibold shadow-xs transition-colors cursor-pointer shrink-0 disabled:opacity-60 whitespace-nowrap"
      title={
        isInstallable
          ? 'Install My Money Manager on this device'
          : 'View steps to install My Money Manager on this device'
      }
      aria-label="Install App"
      data-testid="header-install-app-btn"
    >
      <Download className="w-3.5 h-3.5 stroke-[2.25] shrink-0" />
      <span className="hidden md:inline">Install App</span>
      <span className="hidden sm:inline md:hidden">Install</span>
    </button>
  );
};
