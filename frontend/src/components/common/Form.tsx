import React, { useState } from 'react';
import { Eye, EyeOff } from 'lucide-react';

const inputBase =
  'w-full px-3 py-2 rounded-md bg-white border text-slate-900 text-sm placeholder:text-slate-400 transition-colors focus:outline-none focus:ring-2 disabled:bg-slate-100 disabled:text-slate-500 disabled:cursor-not-allowed';
const inputState = (invalid?: boolean) =>
  invalid
    ? 'border-rose-400 focus:border-rose-500 focus:ring-rose-100'
    : 'border-slate-300 focus:border-sky-500 focus:ring-sky-100';

interface FormFieldProps {
  id: string;
  label: string;
  required?: boolean;
  hint?: React.ReactNode;
  error?: string;
  className?: string;
  children: React.ReactNode;
}

// Label + control + hint/error, with ids wired for screen readers.
export const FormField: React.FC<FormFieldProps> = ({ id, label, required, hint, error, className = '', children }) => (
  <div className={className}>
    <label htmlFor={id} className="block text-xs font-semibold text-slate-700 mb-1">
      {label}
      {required && <span className="text-rose-600 ml-0.5" aria-hidden>*</span>}
    </label>
    {children}
    {error ? (
      <p id={`${id}-error`} className="mt-1 text-[11px] font-medium text-rose-600">
        {error}
      </p>
    ) : hint ? (
      <p id={`${id}-hint`} className="mt-1 text-[11px] text-slate-500">
        {hint}
      </p>
    ) : null}
  </div>
);

type InputProps = React.InputHTMLAttributes<HTMLInputElement> & { invalid?: boolean; mono?: boolean };

export const TextInput: React.FC<InputProps> = ({ invalid, mono, className = '', id, ...props }) => (
  <input
    id={id}
    aria-invalid={invalid || undefined}
    aria-describedby={id ? (invalid ? `${id}-error` : `${id}-hint`) : undefined}
    className={`${inputBase} ${inputState(invalid)} ${mono ? 'font-mono' : ''} ${className}`}
    {...props}
  />
);

// Password-style input with a show/hide toggle; used for tokens and passwords.
export const SecretInput: React.FC<Omit<InputProps, 'type'>> = ({ className = '', ...props }) => {
  const [visible, setVisible] = useState(false);
  return (
    <div className="relative">
      <TextInput
        {...props}
        type={visible ? 'text' : 'password'}
        autoComplete="new-password"
        spellCheck={false}
        mono
        className={`pr-10 ${className}`}
      />
      <button
        type="button"
        onClick={() => setVisible((v) => !v)}
        className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1.5 rounded text-slate-500 hover:text-slate-800 hover:bg-slate-100 cursor-pointer"
        aria-label={visible ? 'Hide value' : 'Show value'}
        title={visible ? 'Hide value' : 'Show value'}
      >
        {visible ? <EyeOff size={15} /> : <Eye size={15} />}
      </button>
    </div>
  );
};

type TextAreaProps = React.TextareaHTMLAttributes<HTMLTextAreaElement> & { invalid?: boolean; mono?: boolean };

export const TextArea: React.FC<TextAreaProps> = ({ invalid, mono, className = '', ...props }) => (
  <textarea
    aria-invalid={invalid || undefined}
    spellCheck={false}
    className={`${inputBase} ${inputState(invalid)} ${mono ? 'font-mono text-xs leading-relaxed' : ''} ${className}`}
    {...props}
  />
);

interface ToggleProps {
  id: string;
  checked: boolean;
  onChange: (checked: boolean) => void;
  label: string;
  description?: string;
  disabled?: boolean;
}

export const Toggle: React.FC<ToggleProps> = ({ id, checked, onChange, label, description, disabled }) => (
  <div className="flex items-start justify-between gap-4">
    <div>
      <label htmlFor={id} className="text-xs font-semibold text-slate-700 cursor-pointer">
        {label}
      </label>
      {description && <p className="text-[11px] text-slate-500 mt-0.5">{description}</p>}
    </div>
    <button
      id={id}
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={`relative inline-flex h-5 w-9 shrink-0 items-center rounded-full transition-colors cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:ring-2 focus-visible:ring-sky-300 ${
        checked ? 'bg-sky-600' : 'bg-slate-300'
      }`}
    >
      <span
        className={`inline-block h-4 w-4 rounded-full bg-white transition-transform ${
          checked ? 'translate-x-4' : 'translate-x-0.5'
        }`}
      />
    </button>
  </div>
);

interface SegmentedOption<T extends string> {
  value: T;
  label: string;
  description?: string;
}

interface SegmentedControlProps<T extends string> {
  name: string;
  value: T;
  options: SegmentedOption<T>[];
  onChange: (value: T) => void;
}

// Radio group rendered as selectable cards; used to pick an authentication method.
export function SegmentedControl<T extends string>({ name, value, options, onChange }: SegmentedControlProps<T>) {
  return (
    <div role="radiogroup" className="grid gap-2" style={{ gridTemplateColumns: `repeat(${options.length}, minmax(0, 1fr))` }}>
      {options.map((opt) => {
        const active = opt.value === value;
        return (
          <label
            key={opt.value}
            className={`px-3 py-2 rounded-md border text-left cursor-pointer transition-colors ${
              active ? 'border-sky-600 bg-sky-50' : 'border-slate-200 bg-white hover:bg-slate-50'
            }`}
          >
            <input
              type="radio"
              name={name}
              value={opt.value}
              checked={active}
              onChange={() => onChange(opt.value)}
              className="sr-only"
            />
            <span className={`block text-xs font-semibold ${active ? 'text-sky-800' : 'text-slate-700'}`}>{opt.label}</span>
            {opt.description && <span className="block text-[11px] text-slate-500 mt-0.5 leading-snug">{opt.description}</span>}
          </label>
        );
      })}
    </div>
  );
}
