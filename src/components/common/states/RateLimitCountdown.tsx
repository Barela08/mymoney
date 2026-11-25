import React, { useState, useEffect } from 'react';
import { Hourglass } from 'lucide-react';

export interface RateLimitCountdownProps {
  initialSeconds?: number;
  onExpire?: () => void;
  actionName?: string;
}

export const RateLimitCountdown: React.FC<RateLimitCountdownProps> = ({
  initialSeconds = 30,
  onExpire,
  actionName = 'This action',
}) => {
  const [secondsLeft, setSecondsLeft] = useState(initialSeconds);

  useEffect(() => {
    if (secondsLeft <= 0) {
      if (onExpire) onExpire();
      return;
    }

    const timer = setInterval(() => {
      setSecondsLeft((prev) => {
        if (prev <= 1) {
          clearInterval(timer);
          if (onExpire) onExpire();
          return 0;
        }
        return prev - 1;
      });
    }, 1000);

    return () => clearInterval(timer);
  }, [secondsLeft, onExpire]);

  return (
    <div
      role="alert"
      className="p-4 sm:p-5 rounded-2xl border border-amber-300 dark:border-amber-800 bg-amber-50 dark:bg-amber-950/40 text-center max-w-sm mx-auto my-3"
    >
      <div className="flex items-center justify-center gap-2 text-amber-700 dark:text-amber-300 font-bold text-sm mb-1">
        <Hourglass className="w-4 h-4 animate-spin" />
        <span>Rate Limit Reached</span>
      </div>

      <p className="text-xs text-slate-600 dark:text-slate-400 mb-3">
        {actionName} is temporarily locked to protect system security.
      </p>

      <div className="text-2xl font-black font-mono text-amber-600 dark:text-amber-400 tracking-wider">
        00:{String(secondsLeft).padStart(2, '0')}
      </div>

      <p className="text-[11px] text-slate-400 mt-2">
        {secondsLeft > 0 ? 'Action will auto-unlock when timer ends' : 'Ready! You may try again now.'}
      </p>
    </div>
  );
};
