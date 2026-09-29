import React from 'react';

interface StatCardProps {
  label: string;
  value: string | number;
  subtext?: string;
  icon: React.ReactNode;
  iconColor?: string;
  badge?: React.ReactNode;
}

export const StatCard: React.FC<StatCardProps> = ({
  label,
  value,
  subtext,
  icon,
  iconColor = 'text-sky-600 bg-sky-50 border-sky-200',
  badge,
}) => {
  return (
    <div className="bg-white border border-slate-200 rounded-md p-5">
      <div className="flex items-center justify-between">
        <span className="text-xs font-semibold text-slate-500 uppercase tracking-wider">{label}</span>
        <div className={`p-2 rounded-md border ${iconColor}`}>{icon}</div>
      </div>
      <div className="mt-3 flex items-baseline justify-between">
        <div className="text-2xl font-bold text-slate-900 tracking-tight">{value}</div>
        {badge && <div>{badge}</div>}
      </div>
      {subtext && <p className="mt-1 text-xs text-slate-500">{subtext}</p>}
    </div>
  );
};
