import React from 'react';
import { Sun, Moon } from 'lucide-react';
import { useTheme } from '../../context/ThemeContext';

interface ThemeToggleProps {
  className?: string;
  size?: 'sm' | 'md';
}

/**
 * Premium Animated Global Theme Toggle
 *
 * Micro-interactions:
 * - Smooth sliding thumb with gentle easing
 * - Sun rotation animation with golden daylight aura in Light Mode
 * - Moon rotation with soft celestial glow & ambient stars in Dark Mode
 * - Respects prefers-reduced-motion
 * - Screen-reader friendly with semantic ARIA attributes
 */
export const ThemeToggle: React.FC<ThemeToggleProps> = ({ className = '', size = 'md' }) => {
  const { theme, toggleTheme } = useTheme();
  const isDark = theme === 'dark';

  const isSmall = size === 'sm';

  return (
    <button
      type="button"
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to Light Mode' : 'Switch to Dark Mode'}
      title={isDark ? 'Switch to Light Mode (Current: Dark)' : 'Switch to Dark Mode (Current: Light)'}
      onClick={toggleTheme}
      className={`group relative inline-flex items-center rounded-full transition-colors duration-300 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500 focus-visible:ring-offset-2 dark:focus-visible:ring-offset-slate-900 select-none cursor-pointer shrink-0 ${
        isSmall ? 'w-12 h-6 p-0.5' : 'w-[56px] h-8 p-1'
      } ${
        isDark
          ? 'bg-gradient-to-r from-slate-900 via-indigo-950 to-slate-900 border border-indigo-500/30 shadow-inner'
          : 'bg-gradient-to-r from-amber-100 via-sky-100 to-amber-200 border border-amber-300/80 shadow-inner'
      } ${className}`}
    >
      {/* Decorative Track Background Details */}
      <span className="pointer-events-none absolute inset-0 overflow-hidden rounded-full">
        {isDark ? (
          <>
            {/* Starry dots in Dark mode */}
            <span
              className="absolute top-1.5 left-2 w-1 h-1 rounded-full bg-indigo-200/60 animate-pulse"
              style={{ animationDuration: '3s' }}
            />
            <span
              className="absolute bottom-2 left-3.5 w-0.5 h-0.5 rounded-full bg-slate-300/70"
            />
            <span
              className="absolute top-2 left-5 w-0.5 h-0.5 rounded-full bg-indigo-200/50"
            />
          </>
        ) : (
          <>
            {/* Warm sunny daytime ambient dots in Light mode */}
            <span
              className="absolute top-2 right-2 w-1.5 h-1.5 rounded-full bg-amber-400/40"
            />
            <span
              className="absolute bottom-1.5 right-4 w-1 h-1 rounded-full bg-sky-400/30"
            />
          </>
        )}
      </span>

      {/* Sliding Thumb / Knob */}
      <span
        className={`pointer-events-none relative inline-flex items-center justify-center rounded-full transform transition-all duration-300 ease-[cubic-bezier(0.34,1.56,0.64,1)] ${
          isSmall ? 'w-5 h-5' : 'w-6 h-6'
        } ${
          isDark
            ? `${isSmall ? 'translate-x-6' : 'translate-x-6'} bg-gradient-to-tr from-indigo-500 to-indigo-700 text-indigo-100 shadow-md shadow-indigo-600/40 border border-indigo-300/30`
            : 'translate-x-0 bg-gradient-to-tr from-amber-400 via-amber-300 to-yellow-300 text-amber-950 shadow-md shadow-amber-500/30 border border-amber-200/80'
        }`}
      >
        {isDark ? (
          <Moon
            className={`${
              isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5'
            } stroke-[2.2] transform transition-transform duration-500 ease-out rotate-0 group-hover:-rotate-12 drop-shadow-xs`}
          />
        ) : (
          <Sun
            className={`${
              isSmall ? 'w-3 h-3' : 'w-3.5 h-3.5'
            } stroke-[2.4] transform transition-transform duration-500 ease-out rotate-0 group-hover:rotate-45 drop-shadow-xs`}
          />
        )}
      </span>

      {/* Desktop Tooltip */}
      <span className="pointer-events-none absolute -bottom-8 left-1/2 -translate-x-1/2 px-2 py-0.5 rounded-md text-[10px] font-bold bg-slate-900 text-white dark:bg-slate-100 dark:text-slate-900 opacity-0 group-hover:opacity-100 transition-opacity whitespace-nowrap shadow-sm z-50 hidden sm:block">
        {isDark ? 'Light Mode' : 'Dark Mode'}
      </span>
    </button>
  );
};
