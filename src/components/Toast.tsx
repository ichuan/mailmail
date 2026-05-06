import { useState, useCallback, createContext, useContext, useEffect, useRef } from 'react';
import { X, CheckCircle, AlertTriangle, Info } from 'lucide-react';
import { useMailStore } from '../store';

export type ToastType = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  type: ToastType;
  message: string;
  // Optional inline action button (e.g. "Undo" for undo-send).
  action?: { label: string; onClick: () => void };
}

interface ToastContextValue {
  toast: (type: ToastType, message: string, durationMs?: number) => void;
  /** Show a toast with an inline action button.  The button auto-dismisses the toast. */
  toastWithAction: (
    type: ToastType,
    message: string,
    action: { label: string; onClick: () => void },
    durationMs?: number,
  ) => void;
}

const ToastContext = createContext<ToastContextValue>({
  toast: () => {},
  toastWithAction: () => {},
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
  // Use CSS-var-based panel background so the same classes work in both
  // light and dark mode without needing a .dark ancestor element
  // (the toast container is outside the App's dark-class div).
  success: 'bg-[var(--c-panel)] border-[var(--c-border)]',
  error:   'bg-[var(--c-panel)] border-[var(--c-border)]',
  info:    'bg-[var(--c-panel)] border-[var(--c-border)]',
};

const MAX_TOASTS = 5;

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const idCounter = useRef(0);
  const timeoutIdsRef = useRef<Map<number, ReturnType<typeof setTimeout>>>(new Map());
  // Read theme from the global Zustand store so we can apply the dark class
  // to the toast container, which is rendered outside the App's dark-class div.
  const theme = useMailStore((s) => s.theme);

  const dismiss = useCallback((id: number) => {
    const timeoutId = timeoutIdsRef.current.get(id);
    if (timeoutId) clearTimeout(timeoutId);
    timeoutIdsRef.current.delete(id);
    setToasts(prev => prev.filter(t => t.id !== id));
  }, []);

  const enqueueToast = useCallback((item: ToastItem, durationMs: number) => {
    setToasts(prev => {
      const next = [...prev, item];
      const overflow = next.slice(0, Math.max(0, next.length - MAX_TOASTS));
      for (const oldToast of overflow) {
        const timeoutId = timeoutIdsRef.current.get(oldToast.id);
        if (timeoutId) clearTimeout(timeoutId);
        timeoutIdsRef.current.delete(oldToast.id);
      }
      return next.slice(-MAX_TOASTS);
    });
    const timeoutId = setTimeout(() => dismiss(item.id), durationMs);
    timeoutIdsRef.current.set(item.id, timeoutId);
  }, [dismiss]);

  useEffect(() => () => {
    for (const timeoutId of timeoutIdsRef.current.values()) clearTimeout(timeoutId);
    timeoutIdsRef.current.clear();
  }, []);

  const toast = useCallback((type: ToastType, message: string, durationMs = 4000) => {
    const id = ++idCounter.current;
    enqueueToast({ id, type, message }, durationMs);
  }, [enqueueToast]);

  const toastWithAction = useCallback((
    type: ToastType,
    message: string,
    action: { label: string; onClick: () => void },
    durationMs = 5500,
  ) => {
    const id = ++idCounter.current;
    // Wrap the action so it also dismisses the toast when clicked.
    const wrappedAction = {
      label: action.label,
      onClick: () => { action.onClick(); dismiss(id); },
    };
    enqueueToast({ id, type, message, action: wrappedAction }, durationMs);
  }, [dismiss, enqueueToast]);

  return (
    <ToastContext value={{ toast, toastWithAction }}>
      {children}
      {/* Toast container — fixed bottom-right; dark class ensures CSS vars resolve correctly */}
      {toasts.length > 0 && (
        <div className={`fixed bottom-4 right-4 z-[99999] flex flex-col gap-2 max-w-sm pointer-events-none${theme === 'dark' ? ' dark' : ''}`}>
          {toasts.map(t => {
            const Icon = ICONS[t.type];
            return (
              <div
                key={t.id}
                className={`pointer-events-auto flex items-start gap-3 px-4 py-3 rounded-xl border shadow-lg backdrop-blur-sm animate-slide-in-right ${BG_COLORS[t.type]}`}
              >
                <Icon size={18} className={`flex-shrink-0 mt-0.5 ${COLORS[t.type]}`} />
                <span className="flex-1 text-sm text-[var(--c-text)] leading-relaxed">{t.message}</span>
                {t.action && (
                  <button
                    onClick={t.action.onClick}
                    className="flex-shrink-0 text-xs font-semibold text-[#004f96] hover:text-[#003b73] transition-colors px-1"
                  >
                    {t.action.label}
                  </button>
                )}
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
