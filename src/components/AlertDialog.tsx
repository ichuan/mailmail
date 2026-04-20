import { useState, useCallback, createContext, useContext } from 'react';
import { useMailStore } from '../store';
import { useI18n } from '../i18n';

interface DialogState {
  message: string;
  resolve: (result: boolean) => void;
}

interface AlertDialogContextValue {
  confirm: (message: string) => Promise<boolean>;
}

const AlertDialogContext = createContext<AlertDialogContextValue>({
  confirm: () => Promise.resolve(false),
});

export function useConfirm() {
  return useContext(AlertDialogContext);
}

export function AlertDialogProvider({ children }: { children: React.ReactNode }) {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const theme = useMailStore((s) => s.theme);
  const { t } = useI18n();

  const confirm = useCallback((message: string): Promise<boolean> => {
    return new Promise<boolean>((resolve) => {
      setDialog({ message, resolve });
    });
  }, []);

  const handleResult = useCallback(
    (result: boolean) => {
      dialog?.resolve(result);
      setDialog(null);
    },
    [dialog],
  );

  return (
    <AlertDialogContext value={{ confirm }}>
      {children}
      {dialog && (
        // Apply the current theme class so CSS vars and dark: Tailwind variants resolve correctly,
        // even though this overlay is rendered outside the main App dark-class div.
        <div
          className={`fixed inset-0 z-[99998] flex items-center justify-center bg-black/40 backdrop-blur-[2px]${theme === 'dark' ? ' dark' : ''}`}
          onClick={() => handleResult(false)}
        >
          <div
            className="bg-[var(--c-panel)] border border-[var(--c-border)] rounded-xl shadow-2xl px-6 py-5 max-w-sm w-full mx-4"
            onClick={(e) => e.stopPropagation()}
          >
            <p className="text-sm text-[var(--c-text)] leading-relaxed mb-5">{dialog.message}</p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => handleResult(false)}
                className="px-4 py-2 text-sm rounded-lg border border-[var(--c-border)] text-[var(--c-text-muted)] hover:bg-[var(--c-hover)] transition-colors"
              >
                {t('dialog.cancel')}
              </button>
              <button
                autoFocus
                onClick={() => handleResult(true)}
                className="px-4 py-2 text-sm rounded-lg bg-[#004f96] text-white hover:bg-[#003b73] transition-colors"
              >
                {t('dialog.confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </AlertDialogContext>
  );
}
