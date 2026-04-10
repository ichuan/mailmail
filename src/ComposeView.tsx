import React, { useEffect, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMailStore } from './store';
import { X, Send, Save } from 'lucide-react';
import { Slot } from './core/slot-registry';

const DRAFT_KEY = 'mailmail:draft';

interface DraftData {
  to: string;
  subject: string;
  body: string;
  accountId: string;
}

export default function ComposeView() {
  const { accounts, composeState, closeCompose } = useMailStore();

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

  const discardDraft = () => {
    localStorage.removeItem(DRAFT_KEY);
    closeCompose();
  };

  const selectedAccount = accounts.find(a => a.id === selectedAccountId);

  const handleSend = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedAccount) {
      setErrorMsg('No account selected');
      return;
    }
    setSending(true);
    setErrorMsg('');
    try {
      await invoke('send_email', {
        account: selectedAccount,
        to,
        subject,
        body,
        inReplyTo: composeState?.inReplyTo ?? null,
      });
      // Clear draft on successful send
      localStorage.removeItem(DRAFT_KEY);
      closeCompose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  // Derive title from compose context
  const composeTitle = (() => {
    if (!composeState) return 'New Message';
    const sub = composeState.subject ?? '';
    if (sub.startsWith('Fwd:')) return 'Forward';
    if (composeState.inReplyTo || sub.startsWith('Re:')) return 'Reply';
    return 'New Message';
  })();

  return (
    <div className="w-full h-full flex flex-col bg-[var(--c-bg)] text-[var(--c-text)]">
      <div className="h-14 border-b border-[var(--c-border)] flex items-center px-6 justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <h2 className="text-lg font-semibold">{composeTitle}</h2>
          {draftSaved && (
            <span className="flex items-center gap-1 text-xs text-[var(--c-text-muted)]">
              <Save size={11} />
              Draft saved
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
            {sending ? 'Sending...' : 'Send'}
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
            <label className="text-sm text-[var(--c-text-muted)] w-16 text-right">From</label>
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

          <div className="flex items-center gap-3">
            <label className="text-sm text-[var(--c-text-muted)] w-16 text-right">To</label>
            <input
              type="email"
              value={to}
              onChange={e => setTo(e.target.value)}
              className="flex-1 p-2 border border-[var(--c-border)] rounded-md text-sm outline-none focus:border-[#004f96] bg-[var(--c-panel)] text-[var(--c-text)]"
              placeholder="recipient@example.com"
              required
            />
          </div>

          <div className="flex items-center gap-3">
            <label className="text-sm text-[var(--c-text-muted)] w-16 text-right">Subject</label>
            <input
              type="text"
              value={subject}
              onChange={e => setSubject(e.target.value)}
              className="flex-1 p-2 border border-[var(--c-border)] rounded-md text-sm outline-none focus:border-[#004f96] bg-[var(--c-panel)] text-[var(--c-text)]"
              placeholder="Subject"
            />
          </div>

          <div className="pt-3">
            <textarea
              value={body}
              onChange={e => setBody(e.target.value)}
              className="w-full min-h-[400px] p-3 border border-[var(--c-border)] rounded-md text-sm outline-none focus:border-[#004f96] resize-none leading-relaxed bg-[var(--c-panel)] text-[var(--c-text)]"
              placeholder="Write your message..."
            />
            {/* compose:footer slot — plugins (e.g. signature picker) render here */}
            <Slot id="compose:footer" body={body} setBody={setBody} />
          </div>
        </div>
      </div>
    </div>
  );
}
