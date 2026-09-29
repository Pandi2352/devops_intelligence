import React from 'react';

export type BadgeVariant =
  | 'healthy'
  | 'degraded'
  | 'offline'
  | 'progressing'
  | 'synced'
  | 'outofsync'
  | 'purple'
  | 'cyan'
  | 'default';

interface BadgeProps {
  label: string;
  variant?: BadgeVariant;
  withPulse?: boolean;
  className?: string;
}

const variantStyles: Record<BadgeVariant, { bg: string; text: string; border: string; dot: string }> = {
  healthy: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-600',
  },
  synced: {
    bg: 'bg-emerald-50',
    text: 'text-emerald-700',
    border: 'border-emerald-200',
    dot: 'bg-emerald-600',
  },
  degraded: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    dot: 'bg-amber-600',
  },
  outofsync: {
    bg: 'bg-amber-50',
    text: 'text-amber-800',
    border: 'border-amber-200',
    dot: 'bg-amber-600',
  },
  offline: {
    bg: 'bg-rose-50',
    text: 'text-rose-700',
    border: 'border-rose-200',
    dot: 'bg-rose-600',
  },
  progressing: {
    bg: 'bg-sky-50',
    text: 'text-sky-700',
    border: 'border-sky-200',
    dot: 'bg-sky-600',
  },
  purple: {
    bg: 'bg-purple-50',
    text: 'text-purple-700',
    border: 'border-purple-200',
    dot: 'bg-purple-600',
  },
  cyan: {
    bg: 'bg-cyan-50',
    text: 'text-cyan-800',
    border: 'border-cyan-200',
    dot: 'bg-cyan-600',
  },
  default: {
    bg: 'bg-slate-100',
    text: 'text-slate-700',
    border: 'border-slate-200',
    dot: 'bg-slate-500',
  },
};

export const Badge: React.FC<BadgeProps> = ({
  label,
  variant = 'default',
  withPulse = false,
  className = '',
}) => {
  const normalizedVariant = (variant.toLowerCase() in variantStyles
    ? variant.toLowerCase()
    : 'default') as BadgeVariant;
  const style = variantStyles[normalizedVariant];

  return (
    <span
      className={`inline-flex items-center gap-1.5 px-2 py-0.5 rounded-md text-xs font-semibold uppercase tracking-wider border ${style.bg} ${style.text} ${style.border} ${className}`}
    >
      {withPulse && <span className={`w-1.5 h-1.5 rounded-full ${style.dot} animate-pulse-dot`} />}
      <span>{label}</span>
    </span>
  );
};
