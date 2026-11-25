import React, { useState, useEffect } from 'react';
import { X, Bell } from 'lucide-react';
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
    <div className="bg-slate-900 text-slate-100 border-b border-slate-800 px-3 sm:px-4 py-2 flex items-center justify-between gap-2.5 text-xs animate-fade-in relative z-20">
      <div className="flex items-center gap-2 sm:gap-2.5 min-w-0">
        <div className="w-6 h-6 rounded-md bg-white/10 flex items-center justify-center shrink-0 text-emerald-400">
          <Bell className="w-3.5 h-3.5 stroke-[1.75]" />
        </div>
        <p className="truncate text-[11px] sm:text-xs text-slate-300">
          <span className="font-medium text-white mr-1.5">Notifications:</span>
          <span>Receive instant transaction alerts and mutual Udhar updates.</span>
        </p>
      </div>

      <div className="flex items-center gap-1.5 sm:gap-2 shrink-0">
        <button
          type="button"
          onClick={handleEnable}
          disabled={isSubscribing}
          className="px-2.5 py-1 bg-emerald-500 hover:bg-emerald-400 text-slate-950 rounded-lg font-medium text-[11px] sm:text-xs transition-colors cursor-pointer disabled:opacity-50 whitespace-nowrap active:scale-[0.99]"
        >
          {isSubscribing ? 'Enabling...' : 'Enable alerts'}
        </button>
        <button
          type="button"
          onClick={handleDismiss}
          className="p-1 rounded-md text-slate-400 hover:text-slate-200 hover:bg-white/10 transition-colors cursor-pointer"
          title="Dismiss"
          aria-label="Dismiss banner"
        >
          <X className="w-3.5 h-3.5 stroke-[1.75]" />
        </button>
      </div>
    </div>
  );
};
