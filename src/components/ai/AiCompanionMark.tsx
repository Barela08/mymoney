import React from 'react';

export type AiCompanionState = 'idle' | 'listening' | 'processing' | 'speaking' | 'error';

interface AiCompanionMarkProps {
  size?: number;
  className?: string;
  state?: AiCompanionState;
}

/**
 * AiCompanionMark — the My Money Manager assistant identity.
 *
 * A hexagonal keystone (trust, structure) holding two ascending, uneven bars in
 * negative space: guidance that moves forward, not a chart, not a robot. The
 * asymmetry is deliberate and stays readable at 24px. No sparkles, brains,
 * circuits, gradients or literal people.
 */
export const AiCompanionMark: React.FC<AiCompanionMarkProps> = ({
  size = 24,
  className = '',
  state = 'idle',
}) => {
  const reactId = React.useId();
  const maskId = `ai-mark-${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      role="img"
      aria-label="My Money Assistant"
      focusable="false"
      shapeRendering="geometricPrecision"
    >
      <defs>
        <mask id={maskId} maskUnits="userSpaceOnUse" x="0" y="0" width="24" height="24">
          <rect width="24" height="24" fill="#fff" />
          {/* Two ascending strokes carved out of the keystone */}
          <rect x="8.3" y="12" width="2.7" height="4.8" rx="1.35" fill="#000" />
          <rect x="13" y="7.6" width="2.7" height="9.2" rx="1.35" fill="#000" />
        </mask>
      </defs>

      <g mask={`url(#${maskId})`}>
        <polygon
          points="12,2.35 20.35,7.15 20.35,16.85 12,21.65 3.65,16.85 3.65,7.15"
          fill="currentColor"
          stroke="currentColor"
          strokeWidth="1.9"
          strokeLinejoin="round"
        />
      </g>

      {state === 'error' && (
        <circle cx="20.1" cy="4.2" r="2.15" fill="#f43f5e" stroke="#fff" strokeWidth="1.1" />
      )}
      {state === 'listening' && (
        <circle cx="20.1" cy="4.2" r="1.65" fill="none" stroke="currentColor" strokeWidth="1.3" />
      )}
    </svg>
  );
};
