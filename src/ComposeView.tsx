import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMailStore } from './store';
import { X, Send, Save } from 'lucide-react';
import { Slot } from './core/slot-registry';
import { useI18n } from './i18n';
import { useToast } from './components/Toast';

const DRAFT_KEY = 'mailmail:draft';

export interface Contact {
  name: string;
  email: string;
}

/**
 * Replace the last comma-separated token in `currentTo` with the selected contact.
 * Pure function — no side effects, easy to unit test.
 *
 * Example:
 *   buildToWithContact("alice@ex, bob", { name: "Bob Lee", email: "bob@ex.example.com" })
 *   => "alice@ex,  Bob Lee <bob@ex.example.com>"
 */
export function buildToWithContact(currentTo: string, contact: Contact): string {
  const tokens = currentTo.split(',');
  tokens[tokens.length - 1] = tokens.length > 1
    ? ` ${contact.name} <${contact.email}>`
    : `${contact.name} <${contact.email}>`;
  return tokens.join(',');
}

interface DraftData {
  to: string;
  subject: string;
  body: string;
  accountId: string;
}

/**
 * Schedule a send with an undo window.
 *
 * Calls `sendFn` after `delayMs` unless `cancel()` is called first.
 * Returns a handle with a `cancel()` method.
 * Pure function — no side effects beyond the timer, easy to unit test.
 */
export function scheduleSend(
  sendFn: () => Promise<void>,
  delayMs: number,
): { cancel: () => void } {
  let cancelled = false;
  const timer = setTimeout(async () => {
    if (!cancelled) {
      await sendFn();
    }
  }, delayMs);
  return {
    cancel: () => {
      cancelled = true;
      clearTimeout(timer);
    },
  };
}

export default function ComposeView() {
  const { accounts, composeState, closeCompose } = useMailStore();
  const { t } = useI18n();
  const { toast, toastWithAction } = useToast();

  // Restore draft only for fresh compose (not reply/forward which pre-fill recipients)
  const isReply = !!(composeState?.inReplyTo || (composeState?.to && composeState.to !== ''));
  const savedDraft: DraftData | null = (() => {
    if (isReply) return null;
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      return raw ? (JSON.parse(raw) as DraftData) : null;
    } catch { return null; }
  })();

  const [to, setTo] = useState(composeState?.to ?? savedDraft?.to ?? '');
  const [subject, setSubject] = useState(composeState?.subject ?? savedDraft?.subject ?? '');
  const [body, setBody] = useState(composeState?.body ?? savedDraft?.body ?? '');
  const [selectedAccountId, setSelectedAccountId] = useState(
    composeState?.fromAccountId ?? savedDraft?.accountId ?? accounts[0]?.id ?? ''
  );
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');
  const [draftSaved, setDraftSaved] = useState(false);

  // Holds the cancel handle when a send is pending the undo window.
  const undoSendRef = useRef<{ cancel: () => void } | null>(null);

  // Contact autocomplete state
  const [contactSuggestions, setContactSuggestions] = useState<Contact[]>([]);
  const [suggestionIndex, setSuggestionIndex] = useState(-1);
  const contactDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const draftTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const draftIndicatorTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Auto-save draft to localStorage after 600ms of inactivity — only for fresh composes.
  useEffect(() => {
    if (isReply) return;
    if (draftTimerRef.current) clearTimeout(draftTimerRef.current);
    draftTimerRef.current = setTimeout(() => {
      const draft: DraftData = { to, subject, body, accountId: selectedAccountId };
      localStorage.setItem(DRAFT_KEY, JSON.stringify(draft));
      setDraftSaved(true);
      if (draftIndicatorTimerRef.current) clearTimeout(draftIndicatorTimerRef.current);
      draftIndicatorTimerRef.current = setTimeout(() => setDraftSaved(false), 2000);
    }, 600);
    return () => { if (draftTimerRef.current) clearTimeout(draftTimerRef.current); };
  }, [to, subject, body, selectedAccountId, isReply]);

  const handleToChange = (value: string) => {
    setTo(value);
    setSuggestionIndex(-1);
    if (contactDebounceRef.current) clearTimeout(contactDebounceRef.current);
    // Extract the last address token (after the last comma) as the query.
    const lastToken = value.split(',').pop()?.trim() ?? '';
    if (lastToken.length < 1) {
      setContactSuggestions([]);
      return;
    }
    contactDebounceRef.current = setTimeout(async () => {
      try {
        const results = await invoke<Contact[]>('suggest_contacts', { query: lastToken });
        setContactSuggestions(results);
      } catch {
        setContactSuggestions([]);
      }
    }, 150);
  };

  const applyContactSuggestion = (contact: Contact) => {
    // Replace the last token in the comma list with "Name <email>".
    setTo(buildToWithContact(to, contact));
    setContactSuggestions([]);
    setSuggestionIndex(-1);
  };

  const handleToKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (contactSuggestions.length === 0) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setSuggestionIndex(i => Math.min(i + 1, contactSuggestions.length - 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setSuggestionIndex(i => Math.max(i - 1, -1));
    } else if (e.key === 'Enter' || e.key === 'Tab') {
      if (suggestionIndex >= 0) {
        e.preventDefault();
        applyContactSuggestion(contactSuggestions[suggestionIndex]);
      }
    } else if (e.key === 'Escape') {
      setContactSuggestions([]);
    }
  };

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    closeCompose();
  };

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) {
      setErrorMsg(t('compose.noAccount'));
      return;
    }
    // Prevent double-send if undo window is already active.
    if (undoSendRef.current) return;

    setErrorMsg('');
    setSending(true);

    // Capture compose values at click time so the user can keep editing.
    const capturedTo = to;
    const capturedSubject = subject;
    const capturedBody = body;
    const capturedAccount = selectedAccount;
    const capturedInReplyTo = composeState?.inReplyTo ?? null;

    const actualSend = async () => {
      try {
        await invoke('send_email', {
          account: capturedAccount,
          to: capturedTo,
          subject: capturedSubject,
          body: capturedBody,
          inReplyTo: capturedInReplyTo,
        });
        localStorage.removeItem(DRAFT_KEY);
        toast('success', t('compose.sendSuccess'));
        closeCompose();
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        setErrorMsg(msg);
        toast('error', t('compose.sendFailed', { error: msg }));
      } finally {
        setSending(false);
        undoSendRef.current = null;
      }
    };

    const handle = scheduleSend(actualSend, 5000);
    undoSendRef.current = handle;

    toastWithAction(
      'info',
      t('compose.undoSendToast'),
      {
        label: t('compose.undoSend'),
        onClick: () => {
          handle.cancel();
          undoSendRef.current = null;
          setSending(false);
        },
      },
      5500,
    );
  };

  // Derive title from compose context
  const composeTitle = (() => {
    if (!composeState) return t('compose.newMessage');
    const sub = composeState.subject ?? '';
    if (sub.startsWith('Fwd:')) return t('compose.forward');
    if (composeState.inReplyTo || sub.startsWith('Re:')) return t('compose.reply');
    return t('compose.newMessage');
  })();

  return (
    <div className="w-full h-full flex flex-col bg-[var(--c-bg)] text-[var(--c-text)]">
      <div className="h-14 border-b border-[var(--c-border)] flex items-center px-6 justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{composeTitle}</h2>
          {draftSaved && (
            <span className="flex items-center gap-1 text-xs text-[var(--c-text-muted)]">
              <Save size={11} />
              {t('compose.draftSaved')}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSend}
            disabled={sending || !to.trim()}
            className="flex items-center gap-2 bg-[#004f96] text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-[#003b73] transition-colors disabled:opacity-50"
          >
            <Send size={14} />
            {sending ? t('compose.sending') : t('compose.send')}
          </button>
          <button onClick={discardDraft} className="p-2 hover:bg-[var(--c-hover)] rounded-md text-[var(--c-text-muted)] transition-colors">
            <X size={18} />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-6">
        {errorMsg && (
          <div className="mb-4 p-3 bg-red-100/50 text-red-800 rounded-md text-sm border border-red-200">{errorMsg}</div>
        )}

        <div className="space-y-3 max-w-3xl">
          {/* From selector: always shown so user can choose which account to send from */}
          <div className="flex items-center gap-3">
            <label className="text-sm text-[var(--c-text-muted)] w-16 text-right">{t('compose.from')}</label>
            <select
              value={selectedAccountId}
              onChange={e => setSelectedAccountId(e.target.value)}
              className="flex-1 p-2 border border-[var(--c-border)] rounded-md text-sm outline-none focus:border-[#004f96] bg-[var(--c-panel)] text-[var(--c-text)]"
            >
              {accounts.map(acc => (
                <option key={acc.id} value={acc.id}>{acc.name} &lt;{acc.email}&gt;</option>
              ))}
            </select>
          </div>

          <div className="flex items-center gap-3 relative">
            <label className="text-sm text-[var(--c-text-muted)] w-16 text-right">{t('compose.to')}</label>
            <div className="flex-1 relative">
              <input
                type="text"
                value={to}
                onChange={e => handleToChange(e.target.value)}
                onKeyDown={handleToKeyDown}
                onBlur={() => setTimeout(() => setContactSuggestions([]), 150)}
                className="w-full p-2 border border-[var(--c-border)] rounded-md text-sm outline-none focus:border-[#004f96] bg-[var(--c-panel)] text-[var(--c-text)]"
                placeholder="recipient@example.com"
                required
                autoComplete="off"
              />
              {contactSuggestions.length > 0 && (
                <ul className="absolute left-0 right-0 top-full mt-1 z-50 bg-[var(--c-panel)] border border-[var(--c-border)] rounded-lg shadow-lg overflow-hidden">
                  {contactSuggestions.map((c, i) => (
                    <li
                      key={c.email}
                      onMouseDown={() => applyContactSuggestion(c)}
                      className={`px-3 py-2 text-sm cursor-pointer flex items-baseline gap-2 ${i === suggestionIndex ? 'bg-[var(--c-selected)] text-[var(--c-selected-text)]' : 'hover:bg-[var(--c-hover)] text-[var(--c-text)]'}`}
                    >
                      <span className="font-medium truncate">{c.name}</span>
                      {c.name !== c.email && (
                        <span className={`text-xs ${i === suggestionIndex ? 'text-[var(--c-selected-text)]/70' : 'text-[var(--c-text-muted)]'}`}>{c.email}</span>
                      )}
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm text-[var(--c-text-muted)] w-16 text-right">{t('compose.subject')}</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="flex-1 p-2 border border-[var(--c-border)] rounded-md text-sm outline-none focus:border-[#004f96] bg-[var(--c-panel)] text-[var(--c-text)]"
              placeholder={t('compose.subject')}
            />
          </div>

          <div className="pt-3">
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              className="w-full min-h-[400px] p-3 border border-[var(--c-border)] rounded-md text-sm outline-none focus:border-[#004f96] resize-none leading-relaxed bg-[var(--c-panel)] text-[var(--c-text)]"
              placeholder={t('compose.placeholder')}
            />
            {/* compose:footer slot — plugins (e.g. signature picker) render here */}
            <Slot id="compose:footer" body={body} setBody={setBody} />
          </div>
        </div>
      </div>
    </div>
  );
}
