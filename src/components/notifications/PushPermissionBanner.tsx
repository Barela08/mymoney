import React, { useState, useEffect } from 'react';
import { Smartphone, X, Bell, CheckCircle } from 'lucide-react';
import { useNotifications } from '../../context/NotificationContext';
import { useToast } from '../../context/ToastContext';

export const PushPermissionBanner: React.FC = () => {
  const { isPushSupported, isPushSubscribed, pushPermission, enablePush } = useNotifications();
  const toast = useToast();
  const [isDismissed, setIsDismissed] = useState(true);
  const [isSubscribing, setIsSubscribing] = useState(false);

  useEffect(() => {
    if (typeof window === 'undefined') return;
    const dismissed = localStorage.getItem('my_money_push_prompt_dismissed');
    // Show if supported, not subscribed, not dismissed, and permission is default
    if (isPushSupported && !isPushSubscribed && pushPermission === 'default' && !dismissed) {
      setIsDismissed(false);
    } else {
      setIsDismissed(true);
    }
  }, [isPushSupported, isPushSubscribed, pushPermission]);

  if (isDismissed) return null;

  const handleEnable = async () => {
    setIsSubscribing(true);
    try {
      const res = await enablePush();
      if (res.success) {
        toast.success('Push Enabled', 'You will now receive instant transaction & Udhar alerts.');
        setIsDismissed(true);
        localStorage.setItem('my_money_push_prompt_dismissed', 'true');
      } else {
        toast.error('Permission Required', res.error || 'Push permission was not granted.');
      }
    } finally {
      setIsSubscribing(false);
    }
  };

  const handleDismiss = () => {
    setIsDismissed(true);
    localStorage.setItem('my_money_push_prompt_dismissed', 'true');
  };

  return (
    <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white px-3 sm:px-4 py-2 sm:py-2.5 shadow-md flex items-center justify-between gap-2.5 text-xs animate-fade-in relative z-20">
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
        <div className="w-6 h-6 sm:w-7 sm:h-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
          <Bell className="w-3.5 h-3.5 sm:w-4 sm:h-4 text-emerald-100" />
        </div>
        <p className="truncate text-[11px] sm:text-xs">
          <span className="font-extrabold mr-1">Turn on Notifications:</span>
          <span className="text-emerald-100 hidden sm:inline">
            Get instant transaction alerts, Udhar khata updates, and payment settlements.
          </span>
        </p>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={handleEnable}
          disabled={isSubscribing}
          className="px-2.5 sm:px-3 py-1 bg-white text-emerald-800 hover:bg-emerald-50 rounded-lg font-bold text-[11px] sm:text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap"
        >
          {isSubscribing ? 'Enabling...' : 'Enable Alerts'}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded-lg text-emerald-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Dismiss"
          aria-label="Dismiss banner"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
