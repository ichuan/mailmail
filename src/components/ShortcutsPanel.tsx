import { useEffect } from 'react';
import { X } from 'lucide-react';
import { useMailStore } from '../store';
import { useI18n } from '../i18n';

interface ShortcutRow {
  key: string;
  descriptionKey: string;
}

// All global keyboard shortcuts registered in App.tsx, listed here for the overlay.
export const SHORTCUTS: ShortcutRow[] = [
  { key: 'n',          descriptionKey: 'shortcuts.new' },
  { key: 'j / ↓',     descriptionKey: 'shortcuts.next' },
  { key: 'k / ↑',     descriptionKey: 'shortcuts.prev' },
  { key: 'r',          descriptionKey: 'shortcuts.reply' },
  { key: 'a',          descriptionKey: 'shortcuts.replyAll' },
  { key: 'f',          descriptionKey: 'shortcuts.forward' },
  { key: 'd / Del',   descriptionKey: 'shortcuts.delete' },
  { key: 'u',          descriptionKey: 'shortcuts.toggleRead' },
  { key: 'Esc',        descriptionKey: 'shortcuts.deselect' },
  { key: '?',          descriptionKey: 'shortcuts.showHelp' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

/**
 * Modal overlay listing all global keyboard shortcuts.
 * Rendered at the root of the App so it floats above everything.
 */
export default function ShortcutsPanel({ open, onClose }: Props) {
  const theme = useMailStore(s => s.theme);
  const { t } = useI18n();

  // Close on Escape key.
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') onClose();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    // Overlay root — receives the theme class so CSS variables resolve correctly.
    <div className={theme === 'dark' ? 'dark' : ''}>
      {/* Backdrop */}
      <div
        className="fixed inset-0 z-[200] bg-black/40 backdrop-blur-sm flex items-center justify-center"
        onClick={onClose}
        role="dialog"
        aria-modal="true"
        aria-label={t('shortcuts.title')}
      >
        {/* Panel — stopPropagation prevents backdrop click from leaking */}
        <div
          className="bg-[var(--c-panel)] border border-[var(--c-border)] rounded-xl shadow-2xl w-[480px] max-h-[80vh] overflow-y-auto p-6"
          onClick={e => e.stopPropagation()}
        >
          {/* Header */}
          <div className="flex items-center justify-between mb-5">
            <h2 className="text-base font-semibold text-[var(--c-text)]">{t('shortcuts.title')}</h2>
            <button
              onClick={onClose}
              className="p-1.5 rounded-md text-[var(--c-text-muted)] hover:bg-[var(--c-hover)] transition-colors"
              aria-label={t('shortcuts.close')}
            >
              <X size={16} />
            </button>
          </div>

          {/* Shortcut rows */}
          <table className="w-full text-sm" role="table">
            <tbody>
              {SHORTCUTS.map(({ key, descriptionKey }) => (
                <tr
                  key={key}
                  className="border-b border-[var(--c-border)] last:border-0"
                >
                  <td className="py-2.5 pr-4 w-24">
                    <kbd className="inline-flex items-center justify-center px-2 py-0.5 text-xs font-mono rounded bg-[var(--c-hover)] border border-[var(--c-border)] text-[var(--c-text)] min-w-[2.5rem]">
                      {key}
                    </kbd>
                  </td>
                  <td className="py-2.5 text-[var(--c-text)]">{t(descriptionKey)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
