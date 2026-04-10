import { invoke } from '@tauri-apps/api/core';
import type { PluginModule } from '../../core/plugin-api';
import { Printer } from 'lucide-react';
import React from 'react';
import { format } from 'date-fns';

/**
 * Print button component rendered in the toolbar:actions slot.
 * When clicked, calls the Rust `print_email` command which opens a
 * dedicated WebView window with print-ready HTML and triggers the
 * native OS print dialog.
 */
function PrintButton({ email }: { email?: { subject: string; sender: string; senderEmail: string; recipient: string; timestamp: string; bodyHtml: string; bodyText: string } }) {
  if (!email) return null;

  const handlePrint = () => {
    const dateStr = format(new Date(email.timestamp), 'EEE, MMM d, yyyy h:mm a');
    invoke('print_email', {
      subject: email.subject,
      sender: email.sender,
      senderEmail: email.senderEmail || '',
      recipient: email.recipient || '',
      date: dateStr,
      bodyHtml: email.bodyHtml || `<pre style="white-space:pre-wrap">${email.bodyText || ''}</pre>`,
    }).catch(console.error);
  };

  return React.createElement(
    'button',
    {
      onClick: handlePrint,
      className: 'p-1.5 hover:bg-[var(--c-hover)] rounded transition-colors',
      title: 'Print',
    },
    React.createElement(Printer, { size: 16, className: 'text-[var(--c-text-muted)]' }),
  );
}

const printPlugin: PluginModule = {
  id: 'print',
  activate(api) {
    return api.ui.registerSlot('toolbar:actions', PrintButton as React.ComponentType);
  },
  deactivate() {},
};

export default printPlugin;
