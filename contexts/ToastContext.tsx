/**
 * ToastContext.tsx — ZAKI OS Z12 AI CFO Suite
 *
 * Système de notifications non-bloquantes (toasts) avec auto-dismiss et animations.
 * Utilisation :
 *   const { toast } = useToast();
 *   toast.success('Document indexé');
 *   toast.error('Ingestion échouée', { duration: 6000 });
 */
import React, { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';

type ToastType = 'success' | 'error' | 'warning' | 'info';

interface ToastItem {
  id: string;
  type: ToastType;
  message: string;
  duration: number;
}

interface ToastOptions {
  duration?: number;
}

interface ToastAPI {
  success: (message: string, opts?: ToastOptions) => void;
  error: (message: string, opts?: ToastOptions) => void;
  warning: (message: string, opts?: ToastOptions) => void;
  info: (message: string, opts?: ToastOptions) => void;
  dismiss: (id: string) => void;
}

const ToastContext = createContext<{ toast: ToastAPI } | null>(null);

export const ToastProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const timers = useRef<Map<string, number>>(new Map());

  const dismiss = useCallback((id: string) => {
    const tid = timers.current.get(id);
    if (tid) {
      window.clearTimeout(tid);
      timers.current.delete(id);
    }
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const push = useCallback((type: ToastType, message: string, opts?: ToastOptions) => {
    const duration = opts?.duration ?? (type === 'error' ? 6000 : 3500);
    const id = `toast-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    setToasts(prev => [...prev, { id, type, message, duration }]);
    const tid = window.setTimeout(() => dismiss(id), duration);
    timers.current.set(id, tid);
  }, [dismiss]);

  const api = useRef<ToastAPI>({
    success: (m, o) => push('success', m, o),
    error:   (m, o) => push('error', m, o),
    warning: (m, o) => push('warning', m, o),
    info:    (m, o) => push('info', m, o),
    dismiss,
  });

  useEffect(() => {
    api.current.success = (m, o) => push('success', m, o);
    api.current.error = (m, o) => push('error', m, o);
    api.current.warning = (m, o) => push('warning', m, o);
    api.current.info = (m, o) => push('info', m, o);
    api.current.dismiss = dismiss;
  }, [push, dismiss]);

  useEffect(() => {
    return () => {
      timers.current.forEach(tid => window.clearTimeout(tid));
      timers.current.clear();
    };
  }, []);

  return (
    <ToastContext.Provider value={{ toast: api.current }}>
      {children}
      <div className="toast-container" role="status" aria-live="polite">
        {toasts.map(t => (
          <div key={t.id} className={`toast toast-${t.type}`}>
            <span className="toast-icon">
              {t.type === 'success' ? '✓' : t.type === 'error' ? '✗' : t.type === 'warning' ? '⚠' : 'ⓘ'}
            </span>
            <span className="toast-message">{t.message}</span>
            <button className="toast-close" onClick={() => dismiss(t.id)} aria-label="Fermer">×</button>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
};

export function useToast(): { toast: ToastAPI } {
  const ctx = useContext(ToastContext);
  if (!ctx) {
    // Fallback silencieux si utilisé hors du Provider (au lieu de crasher)
    const noop = () => undefined;
    return {
      toast: {
        success: noop, error: noop, warning: noop, info: noop, dismiss: noop,
      },
    };
  }
  return ctx;
}
