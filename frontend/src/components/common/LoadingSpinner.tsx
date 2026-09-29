import React from 'react';
import { Loader2 } from 'lucide-react';

interface LoadingSpinnerProps {
  message?: string;
  size?: 'sm' | 'md' | 'lg';
  inline?: boolean;
  className?: string;
}

export const LoadingSpinner: React.FC<LoadingSpinnerProps> = ({
  message = 'Loading...',
  size = 'md',
  inline = false,
  className = '',
}) => {
  const sizeMap = {
    sm: 'w-4 h-4',
    md: 'w-6 h-6',
    lg: 'w-8 h-8',
  };

  if (inline) {
    return (
      <span className={`inline-flex items-center gap-1.5 text-xs text-slate-500 font-medium ${className}`}>
        <Loader2 className={`${sizeMap[size]} animate-spin text-sky-600 shrink-0`} />
        {message && <span>{message}</span>}
      </span>
    );
  }

  return (
    <div className={`flex flex-col items-center justify-center py-10 gap-2.5 ${className}`}>
      <div className="relative flex items-center justify-center">
        <Loader2 className={`${sizeMap[size]} animate-spin text-sky-600`} />
      </div>
      {message && (
        <span className="text-xs text-slate-500 font-medium animate-pulse">{message}</span>
      )}
    </div>
  );
};
