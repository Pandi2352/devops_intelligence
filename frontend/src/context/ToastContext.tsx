import React, { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';
import { CheckCircle2, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'info';

interface Toast {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastApi {
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
}

const ToastContext = createContext<ToastApi | undefined>(undefined);

const STYLES: Record<ToastType, { box: string; icon: React.ReactNode }> = {
  success: {
    box: 'border-emerald-200 bg-emerald-50 text-emerald-800',
    icon: <CheckCircle2 size={16} className="text-emerald-600 shrink-0 mt-0.5" />,
  },
  error: {
    box: 'border-rose-200 bg-rose-50 text-rose-800',
    icon: <AlertTriangle size={16} className="text-rose-600 shrink-0 mt-0.5" />,
  },
  info: {
    box: 'border-sky-200 bg-sky-50 text-sky-800',
    icon: <Info size={16} className="text-sky-600 shrink-0 mt-0.5" />,
  },
};

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (type: ToastType, message: string) => {
      const id = nextId.current++;
      setToasts((prev) => [...prev.slice(-3), { id, type, message }]);
      setTimeout(() => dismiss(id), type === 'error' ? 7000 : 4000);
    },
    [dismiss]
  );

  const api = useMemo<ToastApi>(
    () => ({
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
    }),
    [push]
  );

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div
        className="fixed top-4 right-4 z-[70] flex flex-col gap-2 w-80 max-w-[calc(100vw-2rem)]"
        aria-live="polite"
        role="status"
      >
        {toasts.map((t) => (
          <div
            key={t.id}
            className={`flex items-start gap-2 p-3 rounded-md border text-xs font-medium ${STYLES[t.type].box}`}
          >
            {STYLES[t.type].icon}
            <span className="flex-1 leading-snug break-words">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              className="p-0.5 rounded opacity-70 hover:opacity-100 cursor-pointer"
              aria-label="Dismiss notification"
            >
              <X size={13} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export const useToast = (): ToastApi => {
  const context = useContext(ToastContext);
  if (!context) throw new Error('useToast must be used within a ToastProvider');
  return context;
};
