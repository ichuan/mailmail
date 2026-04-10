import { useState, useCallback, createContext, useContext, useRef } from 'react';
import { X, CheckCircle, AlertTriangle, Info } from 'lucide-react';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, durationMs?: number) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
});

export function useToast() {
  return useContext(ToastContext);
}

const ICONS: Record<ToastType, typeof CheckCircle> = {
  success: CheckCircle,
  error: AlertTriangle,
  info: Info,
};

const COLORS: Record<ToastType, string> = {
  success: 'text-green-500',
  error: 'text-red-500',
  info: 'text-blue-500',
};

const BG_COLORS: Record<ToastType, string> = {
  success: 'border-green-200 bg-green-50 dark:bg-green-950/40 dark:border-green-800',
  error: 'border-red-200 bg-red-50 dark:bg-red-950/40 dark:border-red-800',
  info: 'border-blue-200 bg-blue-50 dark:bg-blue-950/40 dark:border-blue-800',
};

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idCounter = useRef(0);

  const toast = useCallback((type: ToastType, message: string, durationMs = 4000) => {
    const id = ++idCounter.current;
    setToasts(prev => [...prev, { id, type, message }]);
    setTimeout(() => {
      setToasts(prev => prev.filter(t => t.id !== id));
    }, durationMs);
  }, []);

  const dismiss = useCallback((id: number) => {
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  return (
    <ToastContext value={{ toast }}>
      {children}
      {/* Toast container — fixed bottom-right */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[99999] flex flex-col gap-2 max-w-sm pointer-events-none">
          {toasts.map(t => {
            const Icon = ICONS[t.type];
            return (
              <div
                key={t.id}
                className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm animate-slide-in-right ${BG_COLORS[t.type]}`}
              >
                <Icon size={18} className={`flex-shrink-0 mt-0.5 ${COLORS[t.type]}`} />
                <span className="flex-1 text-sm text-[var(--c-text)] leading-relaxed">{t.message}</span>
                <button
                  onClick={() => dismiss(t.id)}
                  className="flex-shrink-0 p-0.5 hover:bg-black/5 rounded transition-colors"
                >
                  <X size={14} className="text-[var(--c-text-muted)]" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </ToastContext>
  );
}
