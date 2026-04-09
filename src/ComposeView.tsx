import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMailStore } from './store';
import { X, Send } from 'lucide-react';

export default function ComposeView() {
  const { accounts, composeState, closeCompose } = useMailStore();
  const [to, setTo] = useState(composeState?.to ?? '');
  const [subject, setSubject] = useState(composeState?.subject ?? '');
  const [body, setBody] = useState(composeState?.body ?? '');
  const [selectedAccountId, setSelectedAccountId] = useState(
    composeState?.fromAccountId ?? accounts[0]?.id ?? ''
  );
  const [sending, setSending] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

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
      closeCompose();
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col bg-[var(--c-bg)] text-[var(--c-text)]">
      <div className="h-14 border-b border-[var(--c-border)] flex items-center px-6 justify-between flex-shrink-0">
        <h2 className="text-lg font-semibold">New Message</h2>
        <div className="flex items-center gap-2">
          <button
            onClick={handleSend}
            disabled={sending || !to.trim()}
            className="flex items-center gap-2 bg-[#004f96] text-white px-4 py-1.5 rounded-md text-sm font-medium hover:bg-[#003b73] transition-colors disabled:opacity-50"
          >
            <Send size={14} />
            {sending ? 'Sending...' : 'Send'}
          </button>
          <button onClick={closeCompose} className="p-2 hover:bg-[var(--c-hover)] rounded-md text-[var(--c-text-muted)] transition-colors">
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
          </div>
        </div>
      </div>
    </div>
  );
}
