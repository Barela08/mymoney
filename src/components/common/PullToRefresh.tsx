import React, { useState, useEffect, useRef } from 'react';
import { RefreshCw, CheckCircle2 } from 'lucide-react';

interface PullToRefreshProps {
  onRefresh: () => Promise<void> | void;
  children: React.ReactNode;
  className?: string;
}

export const PullToRefresh: React.FC<PullToRefreshProps> = ({
  onRefresh,
  children,
  className = '',
}) => {
  const [pullDistance, setPullDistance] = useState(0);
  const [isRefreshing, setIsRefreshing] = useState(false);
  const [isSuccess, setIsSuccess] = useState(false);

  const startYRef = useRef(0);
  const startXRef = useRef(0);
  const isPullingRef = useRef(false);
  const threshold = 65; // Pull distance in px to trigger refresh

  useEffect(() => {
    const handleTouchStart = (e: TouchEvent) => {
      // Only initiate pull-to-refresh if user is at the top of the page
      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      if (scrollTop <= 0 && !isRefreshing) {
        startYRef.current = e.touches[0].clientY;
        startXRef.current = e.touches[0].clientX;
        isPullingRef.current = true;
      }
    };

    const handleTouchMove = (e: TouchEvent) => {
      if (!isPullingRef.current || isRefreshing) return;

      const scrollTop = window.scrollY || document.documentElement.scrollTop;
      if (scrollTop > 0) {
        // Scrolled down, cancel pull
        isPullingRef.current = false;
        setPullDistance(0);
        return;
      }

      const currentY = e.touches[0].clientY;
      const currentX = e.touches[0].clientX;
      const deltaY = currentY - startYRef.current;
      const deltaX = Math.abs(currentX - startXRef.current);

      // Must be a vertical downward pull
      if (deltaY > 0 && deltaY > deltaX) {
        // Apply resistance curve
        const distance = Math.min(Math.pow(deltaY, 0.82) * 1.5, 95);
        setPullDistance(distance);

        // Prevent native rubber band / browser reload if cancelable
        if (deltaY > 8 && e.cancelable) {
          e.preventDefault();
        }
      } else if (deltaY < 0) {
        setPullDistance(0);
      }
    };

    const handleTouchEnd = async () => {
      if (!isPullingRef.current || isRefreshing) return;
      isPullingRef.current = false;

      if (pullDistance >= threshold) {
        setIsRefreshing(true);
        setPullDistance(55); // Hold at refresh position

        // Trigger subtle haptic feedback if supported on mobile
        if (typeof window !== 'undefined' && 'vibrate' in navigator) {
          try {
            navigator.vibrate(15);
          } catch {}
        }

        try {
          await onRefresh();
          setIsSuccess(true);
          await new Promise((resolve) => setTimeout(resolve, 600));
        } catch (err) {
          console.warn('Pull-to-refresh error:', err);
        } finally {
          setIsSuccess(false);
          setIsRefreshing(false);
          setPullDistance(0);
        }
      } else {
        setPullDistance(0);
      }
    };

    // Attach touch listeners to window with passive: false for touchmove to allow preventDefault
    window.addEventListener('touchstart', handleTouchStart, { passive: true });
    window.addEventListener('touchmove', handleTouchMove, { passive: false });
    window.addEventListener('touchend', handleTouchEnd, { passive: true });
    window.addEventListener('touchcancel', handleTouchEnd, { passive: true });

    return () => {
      window.removeEventListener('touchstart', handleTouchStart);
      window.removeEventListener('touchmove', handleTouchMove);
      window.removeEventListener('touchend', handleTouchEnd);
      window.removeEventListener('touchcancel', handleTouchEnd);
    };
  }, [isRefreshing, pullDistance, onRefresh]);

  // Rotation degree for the icon as you pull
  const rotation = Math.min(pullDistance * 4.5, 360);
  const isTriggerReady = pullDistance >= threshold;

  return (
    <div className={`relative ${className}`}>
      {/* Floating Pull-to-Refresh Banner/Pill */}
      <div
        className="fixed top-2 inset-x-0 z-50 flex justify-center pointer-events-none transition-all duration-200"
        style={{
          transform: `translateY(${
            pullDistance > 0 ? pullDistance - 15 : isRefreshing ? 45 : -70
          }px)`,
          opacity: pullDistance > 10 || isRefreshing ? 1 : 0,
        }}
      >
        <div
          className={`flex items-center gap-2.5 px-4 py-2 rounded-full border shadow-2xl backdrop-blur-md transition-colors ${
            isSuccess
              ? 'bg-emerald-500 text-slate-950 border-emerald-400 font-extrabold'
              : isTriggerReady || isRefreshing
              ? 'bg-slate-900/95 dark:bg-slate-950/95 text-emerald-400 border-emerald-500/50'
              : 'bg-white/95 dark:bg-slate-900/95 text-slate-700 dark:text-slate-200 border-slate-200 dark:border-slate-700'
          }`}
        >
          {isSuccess ? (
            <>
              <CheckCircle2 className="w-4 h-4 stroke-[3]" />
              <span className="text-xs">Updated! / डेटा रिफ्रेश हो गया</span>
            </>
          ) : isRefreshing ? (
            <>
              <RefreshCw className="w-4 h-4 text-emerald-500 animate-spin" />
              <span className="text-xs font-bold text-slate-900 dark:text-slate-100">
                Syncing with Cloud... / रिफ्रेश हो रहा है
              </span>
            </>
          ) : (
            <>
              <RefreshCw
                className={`w-4 h-4 transition-transform ${
                  isTriggerReady ? 'text-emerald-500' : 'text-slate-400'
                }`}
                style={{ transform: `rotate(${rotation}deg)` }}
              />
              <span className="text-xs font-semibold">
                {isTriggerReady
                  ? 'Release to refresh / छोड़ें रिफ्रेश करने के लिए'
                  : 'Pull down to refresh / नीचे खींचें'}
              </span>
            </>
          )}
        </div>
      </div>

      {/* Main Content Area */}
      {children}
    </div>
  );
};
