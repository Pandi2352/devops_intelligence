import React from 'react';

interface CardProps {
  children: React.ReactNode;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
  headerClassName?: string;
  bodyClassName?: string;
  interactive?: boolean;
}

export const Card: React.FC<CardProps> = ({
  children,
  title,
  subtitle,
  action,
  className = '',
  headerClassName = '',
  bodyClassName = '',
  interactive = false,
}) => {
  return (
    <div
      className={`bg-white border border-slate-200 rounded-md p-5 ${
        interactive ? 'hover:border-sky-500 transition-colors cursor-pointer' : ''
      } ${className}`}
    >
      {(title || subtitle || action) && (
        <div className={`flex items-start justify-between pb-3.5 mb-4 border-b border-slate-100 ${headerClassName}`}>
          <div>
            {title && (
              <div className="text-sm font-semibold text-slate-900 flex items-center gap-2">
                {title}
              </div>
            )}
            {subtitle && <p className="text-xs text-slate-500 mt-0.5">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </div>
      )}
      <div className={bodyClassName}>{children}</div>
    </div>
  );
};
