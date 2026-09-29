import React from 'react';
import type { ObservabilityKind } from '../../api/observabilityApi';

interface LogoProps {
  kind: ObservabilityKind;
  size?: number;
  className?: string;
}

// Simple brand-coloured marks; decorative, always shown next to a visible name.
export const ObservabilityLogo: React.FC<LogoProps> = ({ kind, size = 18, className = '' }) => {
  const common = { width: size, height: size, viewBox: '0 0 24 24', 'aria-hidden': true, className: `shrink-0 ${className}` };
  if (kind === 'prometheus') {
    return (
      <svg {...common}>
        <circle cx="12" cy="12" r="11" fill="#E6522C" />
        <path d="M12 4.5c1.2 2.2-.4 3.4.8 5 .9-1.2.6-2.3.6-2.3 2 1.7 2.6 4 1.6 6.1H9c-1-2 0-4.3 1.2-5.3-.1 1 .3 1.8.9 2.2-.3-2 0-3.9.9-5.7z" fill="#fff" />
        <rect x="8" y="15" width="8" height="1.6" rx=".8" fill="#fff" />
        <rect x="9.5" y="17.6" width="5" height="1.6" rx=".8" fill="#fff" />
      </svg>
    );
  }
  if (kind === 'grafana') {
    const id = `grafana-grad-${size}`;
    return (
      <svg {...common}>
        <defs>
          <linearGradient id={id} x1="0" y1="1" x2="0" y2="0">
            <stop offset="0" stopColor="#FCEE1F" />
            <stop offset="1" stopColor="#F15B2A" />
          </linearGradient>
        </defs>
        <circle cx="12" cy="12" r="8.5" fill="none" stroke={`url(#${id})`} strokeWidth="4" />
        <circle cx="12" cy="12" r="3" fill={`url(#${id})`} />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <rect x="3" y="4" width="10" height="3.2" rx="1" fill="#F4B400" />
      <rect x="3" y="9.2" width="14" height="3.2" rx="1" fill="#F79009" />
      <rect x="3" y="14.4" width="18" height="3.2" rx="1" fill="#E8590C" />
      <rect x="3" y="19.6" width="7" height="1.6" rx=".8" fill="#E8590C" opacity=".6" />
    </svg>
  );
};

const tileStyles: Record<ObservabilityKind, string> = {
  prometheus: 'bg-orange-50 border-orange-200',
  grafana: 'bg-amber-50 border-amber-200',
  loki: 'bg-yellow-50 border-yellow-200',
};

export const ObservabilityLogoTile: React.FC<{ kind: ObservabilityKind; size?: 'sm' | 'md' | 'lg' }> = ({ kind, size = 'md' }) => {
  const box = size === 'sm' ? 'w-7 h-7' : size === 'lg' ? 'w-11 h-11' : 'w-9 h-9';
  const icon = size === 'sm' ? 16 : size === 'lg' ? 26 : 21;
  return (
    <div className={`${box} rounded-md border flex items-center justify-center shrink-0 ${tileStyles[kind]}`}>
      <ObservabilityLogo kind={kind} size={icon} />
    </div>
  );
};
