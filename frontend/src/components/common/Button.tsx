import React from 'react';
import { Loader2 } from 'lucide-react';

export type ButtonVariant = 'primary' | 'secondary' | 'accent' | 'danger' | 'dangerSolid' | 'outline' | 'ghost';
export type ButtonSize = 'sm' | 'md' | 'lg';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  isLoading?: boolean;
  leftIcon?: React.ReactNode;
  rightIcon?: React.ReactNode;
}

const variantClasses: Record<ButtonVariant, string> = {
  primary:
    'bg-sky-600 hover:bg-sky-700 text-white border-transparent',
  accent:
    'bg-indigo-600 hover:bg-indigo-700 text-white border-transparent',
  secondary:
    'bg-white hover:bg-slate-100 text-slate-700 border-slate-300',
  outline:
    'bg-transparent hover:bg-slate-100 text-slate-700 border-slate-300',
  danger:
    'bg-rose-50 hover:bg-rose-100 text-rose-700 border-rose-200',
  dangerSolid:
    'bg-rose-600 hover:bg-rose-700 text-white border-transparent',
  ghost:
    'bg-transparent hover:bg-slate-100 text-slate-600 hover:text-slate-900 border-transparent',
};

const sizeClasses: Record<ButtonSize, string> = {
  sm: 'px-2.5 py-1 text-xs gap-1.5 rounded-md',
  md: 'px-3.5 py-2 text-sm gap-2 rounded-md',
  lg: 'px-4 py-2.5 text-base gap-2.5 rounded-md',
};

export const Button: React.FC<ButtonProps> = ({
  children,
  variant = 'primary',
  size = 'md',
  isLoading = false,
  leftIcon,
  rightIcon,
  className = '',
  disabled,
  ...props
}) => {
  return (
    <button
      disabled={disabled || isLoading}
      className={`inline-flex items-center justify-center font-medium border transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed select-none rounded-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 focus-visible:ring-offset-1 ${
        variantClasses[variant]
      } ${sizeClasses[size]} ${className}`}
      {...props}
    >
      {isLoading ? (
        <Loader2 className="w-4 h-4 animate-spin text-current" />
      ) : (
        leftIcon && <span className="inline-flex shrink-0">{leftIcon}</span>
      )}
      {children}
      {!isLoading && rightIcon && <span className="inline-flex shrink-0">{rightIcon}</span>}
    </button>
  );
};
