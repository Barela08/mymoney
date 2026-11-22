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
    <div className="bg-gradient-to-r from-emerald-600 to-teal-700 text-white px-4 py-2.5 shadow-md flex items-center justify-between gap-3 text-xs animate-fade-in relative z-20">
      <div className="flex items-center gap-2.5 min-w-0">
        <div className="w-7 h-7 rounded-lg bg-white/20 flex items-center justify-center shrink-0">
          <Bell className="w-4 h-4 text-emerald-100" />
        </div>
        <p className="truncate">
          <span className="font-extrabold mr-1">Turn on Notifications:</span>
          <span className="text-emerald-100 hidden sm:inline">
            Get instant transaction alerts, Udhar khata updates, and payment settlements.
          </span>
        </p>
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <button
          type="button"
          onClick={handleEnable}
          disabled={isSubscribing}
          className="px-3 py-1 bg-white text-emerald-800 hover:bg-emerald-50 rounded-lg font-bold text-xs shadow-xs transition-colors cursor-pointer disabled:opacity-50"
        >
          {isSubscribing ? 'Enabling...' : 'Enable Alerts'}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded-lg text-emerald-200 hover:text-white hover:bg-white/10 transition-colors cursor-pointer"
          title="Dismiss"
        >
          <X className="w-4 h-4" />
        </button>
      </div>
    </div>
  );
};
