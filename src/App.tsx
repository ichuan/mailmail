import { useEffect, useRef, useCallback, useState, useMemo } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { downloadDir } from '@tauri-apps/api/path';
import { listen } from '@tauri-apps/api/event';
import { useMailStore } from './store';
import type { Account, Email, Attachment } from './store';
import { format, isToday, isThisYear } from 'date-fns';
import { getCurrentWindow } from '@tauri-apps/api/window';
import { LogicalSize } from '@tauri-apps/api/dpi';
import {
  Inbox,
  Send,
  Trash2,
  Mail,
  CircleUserRound,
  Reply,
  Forward,
  Trash,
  Settings,
  PenSquare,
  RefreshCw,
  Loader2,
  Search,
  X,
  Star,
  Paperclip,
  Download,
  ChevronRight,
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { Panel, Group as PanelGroup, Separator as PanelResizeHandle } from 'react-resizable-panels';
import { useVirtualizer } from '@tanstack/react-virtual';

import SettingsView from './SettingsView';
import AddAccountView from './AddAccountView';
import ComposeView from './ComposeView';
import { Slot } from './core/slot-registry';
import { initBuiltinPlugins, destroyPlugins } from './plugin-registry';
import { pluginManager } from './core/plugin-manager';
import { eventBus } from './core/event-bus';
import { useI18n } from './i18n';
import { useToast } from './components/Toast';
import { useConfirm } from './components/AlertDialog';
import ShortcutsPanel from './components/ShortcutsPanel';

// Special virtual folder key that aggregates all accounts' inboxes.
export const ALL_INBOXES = '__all__';

function cx(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

/**
 * Extract the bare email address from an RFC 5322 address string.
 * Handles both "Display Name <user@host>" and plain "user@host" forms.
 * Used for normalization when deduplicating Reply All recipient lists.
 */
export function extractEmailAddr(addr: string): string {
  const match = addr.match(/<([^>]+)>/);
  return (match ? match[1] : addr).trim().toLowerCase();
}

/**
 * Strip <img> tags from HTML so remote images are never loaded.
 * display:none via CSS still fires HTTP requests; DOM removal does not.
 * This is the correct approach for preventing email tracker pixels.
 */
export function sanitizeEmailHtml(html: string, allowImages: boolean): string {
  if (allowImages) return html;
  return html.replace(/<img[^>]*\/?>/gi, '');
}

/**
 * Build a complete HTML document for iframe srcdoc injection.
 * Injects minimal typography CSS so emails are readable in both themes.
 * The resulting doc is loaded into a sandboxed iframe (no scripts),
 * so we can safely include email body HTML that ammonia has already cleaned.
 */
export function buildIframeSrcDoc(html: string, isDark: boolean): string {
  const text   = isDark ? '#e8eaed' : '#1a1a1a';
  const link   = isDark ? '#7ab3ef' : '#004f96';
  const quote  = isDark ? '#888' : '#666';
  const qBdr   = isDark ? '#444' : '#ddd';
  const codeBg = isDark ? '#2a2a2a' : '#f5f5f5';
  const css = [
    'html,body{margin:0;padding:0;background:transparent;overflow-x:hidden;}',
    `body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;`,
    `font-size:15px;line-height:1.6;color:${text};word-wrap:break-word;overflow-wrap:break-word;}`,
    `a{color:${link};}`,
    'img{max-width:100%;height:auto;}',
    `blockquote{border-left:3px solid ${qBdr};margin:.5em 0;padding-left:1em;color:${quote};}`,
    `pre,code{background:${codeBg};border-radius:3px;font-family:Consolas,monospace;font-size:.9em;}`,
    'pre{padding:.75em;overflow-x:auto;}code{padding:.15em .3em;}',
    'table{border-collapse:collapse;max-width:100%;}td,th{padding:4px 8px;}',
  ].join('');
  return `<!DOCTYPE html><html><head><meta charset="utf-8"><style>${css}</style></head><body>${html}</body></html>`;
}

export function isSafeExternalMailUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'http:' || parsed.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Renders HTML email content inside a sandboxed iframe.
 *
 * Security model:
 *  - sandbox="allow-same-origin" blocks script execution, form submission, and
 *    top-level navigation while allowing the parent to read iframe DOM for height.
 *  - Link clicks are intercepted from the parent via contentDocument event listener
 *    and routed through tauri-plugin-shell so they open in the system browser.
 *  - Image stripping (tracker prevention) is applied before srcdoc injection.
 */
export function EmailHtmlViewer({ html, isDark, showImages }: { html: string; isDark: boolean; showImages: boolean }) {
  const [height, setHeight] = useState(400);
  const iframeRef = useRef<HTMLIFrameElement>(null);
  const cleanupClickListenerRef = useRef<(() => void) | null>(null);
  const srcDoc = useMemo(() => buildIframeSrcDoc(sanitizeEmailHtml(html, showImages), isDark), [html, isDark, showImages]);

  const handleLoad = useCallback(() => {
    cleanupClickListenerRef.current?.();
    cleanupClickListenerRef.current = null;
    const doc = iframeRef.current?.contentDocument;
    if (!doc) return;
    // Auto-size the iframe to its content so no internal scrollbar appears.
    const contentHeight = doc.documentElement.scrollHeight || doc.body?.scrollHeight || 400;
    setHeight(contentHeight);
    // Route all link clicks through Tauri shell to open the system browser.
    // This replaces the onClick delegation that worked on the outer div before.
    const handleClick = (e: MouseEvent) => {
      const anchor = (e.target as Element)?.closest?.('a');
      if (anchor instanceof HTMLAnchorElement && anchor.href) {
        e.preventDefault();
        if (!isSafeExternalMailUrl(anchor.href)) return;
        openExternal(anchor.href).catch(console.error);
      }
    };
    doc.addEventListener('click', handleClick);
    cleanupClickListenerRef.current = () => doc.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => () => {
    cleanupClickListenerRef.current?.();
    cleanupClickListenerRef.current = null;
  }, []);

  return (
    <iframe
      ref={iframeRef}
      sandbox="allow-same-origin"
      srcDoc={srcDoc}
      title="Email content"
      onLoad={handleLoad}
      style={{ width: '100%', border: 'none', display: 'block', height: `${height}px` }}
    />
  );
}

/**
 * Smart email timestamp: <1h -> "32m", <24h -> "3h", same year -> "Mar 24", older -> "2025/1/2"
 */
function smartFormatTime(timestamp: string): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMin = Math.floor(diffMs / 60_000);

  if (diffMin < 60) return `${Math.max(diffMin, 1)}m`;
  const diffHour = Math.floor(diffMin / 60);
  if (diffHour < 24 && isToday(date)) return `${diffHour}h`;
  if (isThisYear(date)) return format(date, 'MMM d');
  return format(date, 'yyyy/M/d');
}

async function syncAllAccounts(
  accounts: Account[],
  syncLimitDays: number,
  folder: string,
): Promise<{ emails: Email[]; allFailed: boolean }> {
  const results: Email[] = [];
  let anySucceeded = false;
  for (const acc of accounts) {
    try {
      const fetched = await invoke<Email[]>('sync_folder', {
        account: acc,
        folder,
        limitDays: syncLimitDays,
      });
      results.push(...fetched);
      anySucceeded = true;
    } catch (err) {
      console.error(`Failed to sync ${folder} for ${acc.email}:`, err);
    }
  }
  return { emails: results, allFailed: accounts.length > 0 && !anySucceeded };
}

export default function App() {
  const {
    accounts,
    emails,
    selectedFolder,
    selectedEmailId,
    activeView,
    syncLimitDays,
    showImages,
    theme,
    syncing,
    searchQuery,
    setFolder,
    selectEmail,
    setView,
    setAccounts,
    setEmails,
    setSyncLimitDays,
    setShowImages,
    setTheme,
    setSyncing,
    openCompose,
    removeEmail,
    setSearchQuery,
  } = useMailStore();

  const { t } = useI18n();
  const { toast } = useToast();
  const { confirm } = useConfirm();

  // Keyboard shortcuts overlay visibility
  const [showShortcuts, setShowShortcuts] = useState(false);

  // Restore saved panel layouts from localStorage.
  // v4 layout format: { [panelId: string]: number } (percentage 0..100)
  const outerLayout = useMemo(() => {
    try {
      const raw = localStorage.getItem('mailmail-outer-v2');
      if (raw) return JSON.parse(raw) as Record<string, number>;
    } catch { /* ignore corrupt data */ }
    return undefined;
  }, []);
  const innerLayout = useMemo(() => {
    try {
      const raw = localStorage.getItem('mailmail-inner-v2');
      if (raw) return JSON.parse(raw) as Record<string, number>;
    } catch { /* ignore corrupt data */ }
    return undefined;
  }, []);

  // Initialize plugins once on mount
  useEffect(() => {
    initBuiltinPlugins();
    return () => destroyPlugins();
  }, []);

  // Keep window title in sync with total unread count across all loaded emails.
  useEffect(() => {
    const unread = emails.filter(e => !e.read).length;
    const title = unread > 0 ? `MailMail (${unread})` : 'MailMail';
    getCurrentWindow().setTitle(title).catch(console.warn);
  }, [emails]);

  // Load persisted settings + accounts on startup
  useEffect(() => {
    async function loadData() {
      try {
        // Load persisted sync limit
        const savedLimit = await invoke<string | null>('get_setting', { key: 'syncLimitDays' });
        if (savedLimit) {
          setSyncLimitDays(Number(savedLimit));
        }

        // Load persisted showImages preference
        const savedShowImages = await invoke<string | null>('get_setting', { key: 'showImages' });
        if (savedShowImages !== null) {
          setShowImages(savedShowImages === 'true');
        }
        // Load persisted theme preference
        const savedTheme = await invoke<string | null>('get_setting', { key: 'theme' });
        if (savedTheme === 'dark' || savedTheme === 'light') {
          setTheme(savedTheme);
        }

        const loadedAccounts = await invoke<Account[]>('get_accounts_public');
        setAccounts(loadedAccounts);

        if (loadedAccounts.length > 0) {
          // Step 1: show cached emails immediately (zero-wait)
          const cachedAll: Email[] = [];
          for (const acc of loadedAccounts) {
            try {
              const cached = await invoke<Email[]>('get_cached_emails', {
                accountId: acc.id,
                folder: 'inbox',
              });
              cachedAll.push(...cached);
            } catch (_) { /* no cache yet, skip */ }
          }
          if (cachedAll.length > 0) setEmails(cachedAll);

          // Step 2: sync from IMAP in background to refresh
          setSyncing(true);
          const limit = savedLimit ? Number(savedLimit) : syncLimitDays;
          const { emails: freshEmails, allFailed } = await syncAllAccounts(loadedAccounts, limit, 'inbox');
          // Only update when at least one account synced successfully.
          // If allFailed (e.g. keychain miss, network error), keep the cached emails.
          if (!allFailed) {
            const { emails: memEmails } = useMailStore.getState();
            const readIds = new Set(memEmails.filter(e => e.read).map(e => e.id));
            const merged = freshEmails.map(e => readIds.has(e.id) ? { ...e, read: true } : e);
            setEmails([...memEmails.filter(e => e.folder !== 'inbox'), ...merged]);
          } else {
            toast('error', t('mail.syncFailed'));
          }
          setSyncing(false);
        }
      } catch (err) {
        console.error("Failed to load data:", err);
        setSyncing(false);
      }
    }
    loadData();

    // Listen for IMAP IDLE push notifications from the Rust backend.
    // When new mail is detected server-side, trigger an inbox re-sync so the
    // user sees fresh messages without manually pressing Refresh.
    // Read store state directly inside the callback to avoid stale closure capture.
    let disposed = false;
    let unlistenMailNew: (() => void) | undefined;
    listen<void>('mail:new', () => {
      const store = useMailStore.getState();
      if (store.syncing || store.accounts.length === 0) return;
      const effectiveFolder = store.selectedFolder === ALL_INBOXES ? 'inbox' : store.selectedFolder;
      store.setSyncing(true);
      syncAllAccounts(store.accounts, store.syncLimitDays, effectiveFolder)
        .then(({ emails: newEmails, allFailed }) => {
          if (allFailed) return;
          const { emails: cur } = useMailStore.getState();
          const readIds = new Set(cur.filter(e => e.read).map(e => e.id));
          const merged = newEmails.map(e => readIds.has(e.id) ? { ...e, read: true } : e);
          useMailStore.getState().setEmails([...cur.filter(e => e.folder !== effectiveFolder), ...merged]);
        })
        .catch(err => {
          console.error('IDLE-triggered sync failed:', err);
          toast('error', t('mail.bgSyncFailed'));
        })
        .finally(() => useMailStore.getState().setSyncing(false));
    }).then(fn => {
      if (disposed) {
        fn();
        return;
      }
      unlistenMailNew = fn;
    }).catch(console.warn);

    return () => {
      disposed = true;
      unlistenMailNew?.();
    };
  }, []);

  // Sync when folder changes
  useEffect(() => {
    if (activeView !== 'mail' || accounts.length === 0) return;

    // For the unified inbox, the effective IMAP folder is always 'inbox'.
    const effectiveFolder = selectedFolder === ALL_INBOXES ? 'inbox' : selectedFolder;

    let cancelled = false;
    async function syncFolder() {
      // Show cached emails for this folder immediately
      const cachedAll: Email[] = [];
      for (const acc of accounts) {
        try {
          const cached = await invoke<Email[]>('get_cached_emails', {
            accountId: acc.id,
            folder: effectiveFolder,
          });
          cachedAll.push(...cached);
        } catch (_) { /* skip */ }
      }
      if (!cancelled && cachedAll.length > 0) {
        const { emails: cur } = useMailStore.getState();
        // For unified inbox, keep emails from all folders except the inbox ones being replaced.
        const otherEmails = cur.filter(e => e.folder !== effectiveFolder);
        setEmails([...otherEmails, ...cachedAll]);
      }

      // Then refresh from IMAP
      setSyncing(true);
      try {
        const { emails: folderEmails, allFailed: syncFailed } = await syncAllAccounts(accounts, syncLimitDays, effectiveFolder);
        if (!cancelled && !syncFailed) {
          const { emails: cur } = useMailStore.getState();
          const readIds = new Set(cur.filter(e => e.read).map(e => e.id));
          const existingIds = new Set(cur.map(e => e.id));
          const merged = folderEmails.map(e => readIds.has(e.id) ? { ...e, read: true } : e);
          setEmails([...cur.filter(e => e.folder !== effectiveFolder), ...merged]);
          // Notify plugins about genuinely new emails (not seen in previous cache)
          const newEmails = merged.filter(e => !existingIds.has(e.id) && !e.read);
          if (newEmails.length > 0) {
            eventBus.emit('email:received', { emails: newEmails });
          }
        }
      } catch (err) {
        console.error("Folder sync error:", err);
      } finally {
        if (!cancelled) setSyncing(false);
      }
    }
    syncFolder();
    return () => { cancelled = true; };
  }, [selectedFolder]);

  // Show the window after first render.
  // The window starts with visible:false in tauri.conf.json so Vite's
  // dep-optimizer reload never produces a visible white screen.
  useEffect(() => {
    getCurrentWindow().show().catch(console.warn);
  }, []);

  // Window resizing
  useEffect(() => {
    const adjustWindowSize = async () => {
      try {
        const win = getCurrentWindow();
        if (activeView === 'settings' || activeView === 'add_account') {
          await win.setSize(new LogicalSize(850, 750));
        } else {
          await win.setSize(new LogicalSize(1100, 800));
        }
      } catch (e) {
        console.warn("Failed to resize window:", e);
      }
    };
    adjustWindowSize();
  }, [activeView]);

  const handleManualSync = async () => {
    if (syncing || accounts.length === 0) return;
    const effectiveFolder = selectedFolder === ALL_INBOXES ? 'inbox' : selectedFolder;
    setSyncing(true);
    try {
      const { emails: folderEmails, allFailed } = await syncAllAccounts(accounts, syncLimitDays, effectiveFolder);
      if (!allFailed) {
        const { emails: cur } = useMailStore.getState();
        const readIds = new Set(cur.filter(e => e.read).map(e => e.id));
        const merged = folderEmails.map(e => readIds.has(e.id) ? { ...e, read: true } : e);
        setEmails([...cur.filter(e => e.folder !== effectiveFolder), ...merged]);
      } else {
        toast('error', t('mail.syncFailed'));
      }
    } catch (err) {
      console.error("Manual sync error:", err);
      toast('error', t('mail.syncError'));
    } finally {
      setSyncing(false);
    }
  };

  // Sync error banner replaced by toast notifications

  const handleReply = useCallback((email: Email) => {
    const replyTo = email.senderEmail || email.sender;
    const dateStr = format(new Date(email.timestamp), "EEE, MMM d, yyyy 'at' h:mm a");
    const originalLines = (email.bodyText || '').split('\n');
    // RFC-style quoting: prefix each line with '>'
    const quoted = originalLines.map(l => `> ${l}`).join('\n');
    openCompose({
      to: replyTo,
      subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      body: `\n\nOn ${dateStr}, ${email.sender} <${email.senderEmail}> wrote:\n${quoted}`,
      fromAccountId: accounts.find(a => a.id === email.accountId)?.id,
    });
  }, [openCompose, accounts]);

  const handleForward = useCallback((email: Email) => {
    openCompose({
      to: '',
      subject: email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`,
      body: `\n\n--- Forwarded Message ---\nFrom: ${email.sender}\nDate: ${email.timestamp}\nSubject: ${email.subject}\n\n${email.bodyText || ''}`,
      fromAccountId: accounts.find(a => a.id === email.accountId)?.id,
    });
  }, [openCompose, accounts]);

  const handleReplyAll = useCallback((email: Email) => {
    const dateStr = format(new Date(email.timestamp), "EEE, MMM d, yyyy 'at' h:mm a");
    const originalLines = (email.bodyText || '').split('\n');
    const quoted = originalLines.map(l => `> ${l}`).join('\n');
    // Collect all recipient addresses, deduplicate, exclude the sending account's own address.
    // Addresses may arrive as "Display Name <user@host>" — normalize to bare email for comparison
    // but preserve the original string so display names are kept in the composed To: field.
    const fromAccount = accounts.find(a => a.id === email.accountId);
    const ownEmail = fromAccount?.email.toLowerCase() ?? '';
    const replyTo = email.senderEmail || email.sender;
    const rawAddrs = [replyTo, ...(email.recipient ? email.recipient.split(',').map(s => s.trim()) : [])];
    const seen = new Set<string>();
    const toList = rawAddrs
      .filter(addr => {
        if (!addr) return false;
        const normalized = extractEmailAddr(addr);
        if (normalized === ownEmail || seen.has(normalized)) return false;
        seen.add(normalized);
        return true;
      })
      .join(', ');
    openCompose({
      to: toList,
      subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      body: `\n\nOn ${dateStr}, ${email.sender} <${email.senderEmail}> wrote:\n${quoted}`,
      fromAccountId: fromAccount?.id,
    });
  }, [openCompose, accounts]);

  const handleDeleteEmail = useCallback(async (email: Email) => {
    if (!await confirm(t('mail.deleteConfirm', { subject: email.subject }))) return;

    const account = accounts.find(a => a.id === email.accountId);
    if (!account) {
      toast('error', t('mail.accountNotFound'));
      return;
    }
    // Optimistically remove from UI so the interaction feels immediate.
    removeEmail(email.id);
    try {
      await invoke('delete_email', {
        account,
        folder: email.folder,
        uid: email.uid,
        emailId: email.id,
      });
      toast('success', t('toast.emailDeleted'));
    } catch (err) {
      // Restore the email on failure so nothing is lost.
      useMailStore.getState().addEmails([email]);
      toast('error', t('mail.deleteFailed', { error: String(err) }));
      console.error('Failed to delete email:', err);
    }
  }, [accounts, removeEmail, t, toast, confirm]);

  // Persist read state to DB so it survives folder switches and app restarts.
  // selectEmail() only updates in-memory; this call syncs the DB.
  const handleSelectEmail = useCallback((id: string) => {
    selectEmail(id);
    invoke('mark_email_read', { id, read: true }).catch(err =>
      console.warn('Failed to persist read state:', err)
    );
  }, [selectEmail]);

  // Debounced search: update query after 300ms of no input
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchInput = useCallback((value: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearchQuery(value), 300);
  }, [setSearchQuery]);

  const selectedEmail = emails.find(e => e.id === selectedEmailId);

  // Attachments for the currently selected email
  const [attachments, setAttachments] = useState<Attachment[]>([]);
  const [savingAttId, setSavingAttId] = useState<string | null>(null);

  // Load attachments when a the selected email changes
  useEffect(() => {
    if (!selectedEmail?.hasAttachments) {
      setAttachments([]);
      return;
    }
    invoke<Attachment[]>('get_attachments', { emailId: selectedEmail.id })
      .then(setAttachments)
      .catch(err => console.warn('Failed to load attachments:', err));
  }, [selectedEmailId, selectedEmail?.hasAttachments]);

  const handleSaveAttachment = useCallback(async (att: Attachment) => {
    setSavingAttId(att.id);
    try {
      const dir = await downloadDir();
      // Join with forward-slash; Rust will handle platform path normalization.
      const destPath = `${dir}/${att.filename}`;
      await invoke('save_attachment', { id: att.id, destPath });
      // Open the saved file using the shell plugin.
      openExternal(destPath).catch(console.error);
    } catch (err) {
      console.error('Failed to save attachment:', err);
    } finally {
      setSavingAttId(null);
    }
  }, []);

  // Right-click context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    type: 'email' | 'account';
    emailTarget?: Email;
    accountTarget?: Account;
  } | null>(null);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // Per-account folder tree expansion in sidebar
  const [expandedAccountIds, setExpandedAccountIds] = useState<Set<string>>(new Set());
  // When set, restricts the email list to a specific account (used by the per-account folder tree)
  const [filterAccountId, setFilterAccountId] = useState<string | null>(null);

  const toggleAccountExpand = useCallback((id: string) => {
    setExpandedAccountIds(prev => {
      const next = new Set(prev);
      if (next.has(id)) { next.delete(id); } else { next.add(id); }
      return next;
    });
  }, []);

  const displayEmails = emails.filter(e => {
    // For the unified inbox, show all inbox-folder emails regardless of account.
    // For starred, show all starred emails across folders.
    // For a normal folder, restrict to the exact selectedFolder value.
    if (selectedFolder === ALL_INBOXES) {
      if (e.folder !== 'inbox') return false;
    } else if (selectedFolder === 'starred') {
      if (!e.starred) return false;
    } else {
      if (e.folder !== selectedFolder) return false;
    }
    // When a specific account is selected in the sidebar tree, filter to that account only.
    if (filterAccountId && e.accountId !== filterAccountId) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      e.subject.toLowerCase().includes(q) ||
      e.sender.toLowerCase().includes(q) ||
      (e.bodyText ?? '').toLowerCase().includes(q)
    );
  }).sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
  // Reset scroll position when folder or search changes
  const listScrollRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listScrollRef.current?.scrollTo(0, 0);
  }, [selectedFolder, searchQuery]);

  // Virtual scrolling — only render visible email rows
  const emailListVirtualizer = useVirtualizer({
    count: displayEmails.length,
    getScrollElement: () => listScrollRef.current,
    estimateSize: () => 72,
    overscan: 5,
  });

  // Global keyboard shortcuts — skip when focus is in an input/textarea/contenteditable.
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      const editable = (e.target as HTMLElement).isContentEditable;
      if (tag === 'INPUT' || tag === 'TEXTAREA' || editable) return;

      const currentIdx = selectedEmailId
        ? displayEmails.findIndex(em => em.id === selectedEmailId)
        : -1;

      switch (e.key) {
        case 'j':
        case 'ArrowDown': {
          e.preventDefault();
          const next = displayEmails[currentIdx + 1];
          if (next) handleSelectEmail(next.id);
          break;
        }
        case 'k':
        case 'ArrowUp': {
          e.preventDefault();
          const prev = displayEmails[currentIdx - 1];
          if (prev) handleSelectEmail(prev.id);
          break;
        }
        case 'r':
          if (selectedEmail) { e.preventDefault(); handleReply(selectedEmail); }
          break;
        case 'a':
          if (selectedEmail) { e.preventDefault(); handleReplyAll(selectedEmail); }
          break;
        case 'f':
          if (selectedEmail) { e.preventDefault(); handleForward(selectedEmail); }
          break;
        case 'd':
        case 'Delete':
          if (selectedEmail) { e.preventDefault(); handleDeleteEmail(selectedEmail); }
          break;
        case 'n':
          e.preventDefault();
          openCompose();
          break;
        case 'u':
          if (selectedEmail) {
            e.preventDefault();
            const nextRead = !selectedEmail.read;
            invoke('mark_email_read', { id: selectedEmail.id, read: nextRead }).catch(console.error);
            useMailStore.getState().markEmailRead(selectedEmail.id, nextRead);
          }
          break;
        case 'Escape':
          selectEmail('');
          break;
        case '?':
          e.preventDefault();
          setShowShortcuts(prev => !prev);
          break;
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [displayEmails, selectedEmailId, selectedEmail, handleSelectEmail, handleReply, handleReplyAll, handleForward, handleDeleteEmail, openCompose, selectEmail]);

  return (
    <div
      className={cx("flex h-screen w-screen bg-[var(--c-bg)] text-[var(--c-text)] font-sans overflow-hidden", theme === 'dark' && 'dark')}
      onClick={closeCtxMenu}
    >
      {/* Keyboard shortcuts overlay */}
      <ShortcutsPanel open={showShortcuts} onClose={() => setShowShortcuts(false)} />
      {/* Context menu overlay — rendered outside PanelGroup so it floats above everything */}
      {ctxMenu && (
        <div
          style={{ position: 'fixed', top: ctxMenu.y, left: ctxMenu.x, zIndex: 9999 }}
          className="bg-[var(--c-panel)] border border-[var(--c-border)] rounded-lg shadow-xl py-1 min-w-[180px]"
          onClick={e => e.stopPropagation()}
        >
          {ctxMenu.type === 'email' && ctxMenu.emailTarget && (() => {
            const e = ctxMenu.emailTarget!;
            return (
              <>
                <CtxItem label={e.read ? t('mail.markUnread') : t('mail.markRead')} onClick={() => {
                  const nextRead = !e.read;
                  invoke('mark_email_read', { id: e.id, read: nextRead }).catch(console.error);
                  useMailStore.getState().markEmailRead(e.id, nextRead);
                  closeCtxMenu();
                }} />
                <CtxItem label={e.starred ? t('mail.unstar') : t('mail.star')} onClick={() => {
                  const nextStarred = !e.starred;
                  invoke('toggle_star', { id: e.id, starred: nextStarred }).catch(console.error);
                  useMailStore.getState().toggleStar(e.id, nextStarred);
                  closeCtxMenu();
                }} />
                <CtxItem label={t('mail.reply')} onClick={() => { handleReply(e); closeCtxMenu(); }} />
                <CtxItem label={t('mail.replyAll')} onClick={() => { handleReplyAll(e); closeCtxMenu(); }} />
                <CtxItem label={t('mail.forward')} onClick={() => { handleForward(e); closeCtxMenu(); }} />
                <div className="my-1 border-t border-[var(--c-border-subtle)]" />
                <CtxItem label={t('mail.delete')} danger onClick={() => { handleDeleteEmail(e); closeCtxMenu(); }} />
                {pluginManager.getContextMenuItems('context-menu:email').length > 0 && (
                  <>
                    <div className="my-1 border-t border-[var(--c-border-subtle)]" />
                    {pluginManager.getContextMenuItems('context-menu:email').map((item, i) => (
                      <CtxItem
                        key={`plugin-${item.pluginId}-${i}`}
                        label={item.label}
                        danger={item.danger}
                        onClick={() => { pluginManager.executeCommand(`${item.pluginId}.${item.command}`, e); closeCtxMenu(); }}
                      />
                    ))}
                  </>
                )}
              </>
            );
          })()}
          {ctxMenu.type === 'account' && ctxMenu.accountTarget && (() => {
            const acc = ctxMenu.accountTarget!;
            return (
              <>
                <CtxItem label={t('account.refresh')} onClick={() => { handleManualSync(); closeCtxMenu(); }} />
                <div className="my-1 border-t border-[var(--c-border-subtle)]" />
                <CtxItem label={t('settings.removeAccount')} danger onClick={async () => {
                  if (await confirm(t('account.removeConfirm', { name: acc.name }))) {
                    invoke('delete_account', { id: acc.id }).then(() => {
                      const s = useMailStore.getState();
                      s.setAccounts(s.accounts.filter(a => a.id !== acc.id));
                      s.setEmails(s.emails.filter(em => em.accountId !== acc.id));
                    }).catch(console.error);
                  }
                  closeCtxMenu();
                }} />
                {pluginManager.getContextMenuItems('context-menu:account').length > 0 && (
                  <>
                    <div className="my-1 border-t border-[var(--c-border-subtle)]" />
                    {pluginManager.getContextMenuItems('context-menu:account').map((item, i) => (
                      <CtxItem
                        key={`plugin-${item.pluginId}-${i}`}
                        label={item.label}
                        danger={item.danger}
                        onClick={() => { pluginManager.executeCommand(`${item.pluginId}.${item.command}`, acc); closeCtxMenu(); }}
                      />
                    ))}
                  </>
                )}
              </>
            );
          })()}
        </div>
      )}

      <PanelGroup orientation="horizontal"
        defaultLayout={outerLayout}
        onLayoutChanged={(layout) => { try { localStorage.setItem('mailmail-outer-v2', JSON.stringify(layout)); } catch {} }}
      >
      {/* LEFT PANE: SIDEBAR */}
      <Panel id="sidebar" defaultSize="18%" minSize="12%" maxSize="30%">
      <div
        className="h-full flex flex-col justify-between border-r border-[var(--c-border)] backdrop-blur-xl bg-[var(--c-sidebar-bg)]"
      >
        <div className="flex-1 overflow-y-auto">
          <Slot id="sidebar:top" />
          {/* Top action buttons: New Mail + Refresh */}
          <div className="flex items-center gap-2 p-3 pt-6">
            <button
              onClick={() => openCompose()}
              className="flex-1 flex items-center justify-center gap-1.5 bg-[#004f96] text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#003b73] transition-colors"
            >
              <PenSquare size={14} />
              {t('sidebar.newMail')}
            </button>
            <button
              onClick={handleManualSync}
              disabled={syncing}
              title={t('account.refresh')}
              className="p-2 rounded-lg bg-[var(--c-bg)] border border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)] transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
          <div className="px-4 mt-2">
            <h2 className="text-xs font-semibold tracking-wider text-[var(--c-text-mid)] uppercase mb-2 ml-2">{t('sidebar.favorites')}</h2>
            <nav className="space-y-0.5">
              <SidebarItem
                icon={<Inbox size={16} />}
                label={t('sidebar.inbox')}
                active={(selectedFolder === ALL_INBOXES || selectedFolder === 'inbox') && activeView === 'mail' && !filterAccountId}
                onClick={() => { setFilterAccountId(null); setFolder(ALL_INBOXES); }}
                count={emails.filter(e => e.folder === 'inbox' && !e.read).length}
              />
              <SidebarItem
                icon={<Star size={16} />}
                label={t('sidebar.starred')}
                active={selectedFolder === 'starred' && activeView === 'mail' && !filterAccountId}
                onClick={() => { setFilterAccountId(null); setFolder('starred'); }}
                count={emails.filter(e => e.starred).length}
              />
              <SidebarItem
                icon={<Send size={16} />}
                label={t('sidebar.sent')}
                active={selectedFolder === 'sent' && activeView === 'mail' && !filterAccountId}
                onClick={() => { setFilterAccountId(null); setFolder('sent'); }}
              />
              <SidebarItem
                icon={<Trash2 size={16} />}
                label={t('sidebar.trash')}
                active={selectedFolder === 'trash' && activeView === 'mail' && !filterAccountId}
                onClick={() => { setFilterAccountId(null); setFolder('trash'); }}
              />
            </nav>
          </div>

          <div className="p-4">
            <h2 className="text-xs font-semibold tracking-wider text-[var(--c-text-mid)] uppercase mb-2 ml-2">{t('sidebar.accounts')}</h2>
            <div className="flex-1 overflow-y-auto">
              {accounts.map(acc => {
                const isExpanded = expandedAccountIds.has(acc.id);
                const accUnread = emails.filter(em => em.accountId === acc.id && em.folder === 'inbox' && !em.read).length;
                return (
                  <div key={acc.id}>
                    <button
                      style={{ width: 'calc(100% - 16px)' }}
                      className={cx(
                        "w-full flex items-center px-2 py-2 mx-2 rounded-md text-sm transition-colors text-left",
                        filterAccountId === acc.id && activeView === 'mail'
                          ? "bg-[var(--c-selected)] text-[var(--c-selected-text)] font-medium"
                          : "text-[var(--c-text-mid)] hover:bg-[var(--c-hover)] hover:text-[var(--c-text)]"
                      )}
                      onClick={() => toggleAccountExpand(acc.id)}
                      onContextMenu={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setCtxMenu({ x: e.clientX, y: e.clientY, type: 'account', accountTarget: acc });
                      }}
                    >
                      <ChevronRight
                        size={12}
                        className={cx("mr-1 flex-shrink-0 transition-transform duration-150", isExpanded && "rotate-90")}
                      />
                      <span className="mr-2 flex-shrink-0 opacity-80"><Mail size={15} /></span>
                      <span className="truncate flex-1 text-xs">{acc.email}</span>
                      {accUnread > 0 && (
                        <span className="ml-2 text-xs bg-[#004f96] text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center">
                          {accUnread}
                        </span>
                      )}
                    </button>
                    {isExpanded && (
                      <div className="ml-6 mt-0.5 mb-1 space-y-0.5">
                        <SidebarSubItem
                          icon={<Inbox size={13} />}
                          label={t('sidebar.inbox')}
                          active={selectedFolder === 'inbox' && filterAccountId === acc.id && activeView === 'mail'}
                          count={accUnread}
                          onClick={() => { setFilterAccountId(acc.id); setFolder('inbox'); }}
                        />
                        <SidebarSubItem
                          icon={<Send size={13} />}
                          label={t('sidebar.sent')}
                          active={selectedFolder === 'sent' && filterAccountId === acc.id && activeView === 'mail'}
                          onClick={() => { setFilterAccountId(acc.id); setFolder('sent'); }}
                        />
                        <SidebarSubItem
                          icon={<Trash2 size={13} />}
                          label={t('sidebar.trash')}
                          active={selectedFolder === 'trash' && filterAccountId === acc.id && activeView === 'mail'}
                          onClick={() => { setFilterAccountId(acc.id); setFolder('trash'); }}
                        />
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        </div>
        {/* Settings pinned at sidebar bottom */}
        <div className="border-t border-[var(--c-border)] p-3">
          <SidebarItem
            icon={<Settings size={16} />}
            label={t('sidebar.settings')}
            active={activeView === 'settings'}
            onClick={() => setView('settings')}
          />
          <Slot id="sidebar:bottom" />
        </div>
      </div>
      </Panel>

      <PanelResizeHandle className="w-1 bg-transparent hover:bg-[#004f96]/30 transition-colors cursor-col-resize" />

      {/* MAIN CONTENT AREA */}
      <Panel id="main" defaultSize="82%">
      {activeView === 'settings' ? (
        <div className="h-full bg-[var(--c-panel)] overflow-y-auto w-full">
           <SettingsView />
        </div>
      ) : activeView === 'add_account' ? (
        <div className="h-full bg-[var(--c-panel)] overflow-y-auto w-full">
           <AddAccountView />
        </div>
      ) : activeView === 'compose' ? (
        <div className="h-full bg-[var(--c-panel)] overflow-y-auto w-full">
           <ComposeView />
        </div>
      ) : (
        <PanelGroup orientation="horizontal"
          defaultLayout={innerLayout}
          onLayoutChanged={(layout) => { try { localStorage.setItem('mailmail-inner-v2', JSON.stringify(layout)); } catch {} }}
        >
          {/* MIDDLE PANE: MESSAGE LIST */}
          <Panel id="list" defaultSize="30%" minSize="25%" maxSize="55%">
          <div className="h-full flex flex-col bg-[var(--c-panel)] border-r border-[var(--c-border)]">
            {/* Search bar only — folder name + refresh moved to sidebar */}
            <div className="border-b border-[var(--c-border)] px-4 py-2.5 z-10">
              <div className="flex items-center gap-2 bg-[var(--c-bg)] rounded-lg px-3 py-1.5">
                <Search size={13} className="text-[var(--c-text-muted)] flex-shrink-0" />
                <input
                  type="text"
                  placeholder={t('mail.search')}
                  defaultValue={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  className="bg-transparent text-sm flex-1 outline-none placeholder-[#a5a9b0]"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="text-[var(--c-text-muted)] hover:text-[var(--c-text)]"><X size={13} /></button>
                )}
              </div>
            </div>
            <div ref={listScrollRef} className="flex-1 overflow-y-auto">
              {displayEmails.length > 0 ? (
                <div
                  style={{ height: emailListVirtualizer.getTotalSize(), position: 'relative' }}
                >
                  {emailListVirtualizer.getVirtualItems().map(virtualRow => {
                    const email = displayEmails[virtualRow.index];
                    return (
                      <div
                        key={email.id}
                        data-index={virtualRow.index}
                        ref={emailListVirtualizer.measureElement}
                        style={{ position: 'absolute', top: 0, left: 0, width: '100%', transform: `translateY(${virtualRow.start}px)` }}
                        onClick={() => handleSelectEmail(email.id)}
                        onContextMenu={(e) => {
                          e.preventDefault();
                          e.stopPropagation();
                          setCtxMenu({ x: e.clientX, y: e.clientY, type: 'email', emailTarget: email });
                        }}
                        className={cx(
                          "p-4 border-b border-[var(--c-border-subtle)] cursor-pointer hover:bg-[var(--c-hover)] transition-colors relative",
                          selectedEmailId === email.id ? "bg-[var(--c-selected)] hover:bg-[var(--c-selected)]" : ""
                        )}
                      >
                        {selectedEmailId === email.id && (
                          <div className="absolute left-0 top-3 bottom-3 w-1 bg-[#004f96] rounded-r-md"></div>
                        )}
                        <div className="flex justify-between items-baseline mb-1">
                          <div className="flex items-baseline gap-1 min-w-0 flex-1 pr-2">
                            {email.starred && (
                              <Star size={11} className="flex-shrink-0 text-yellow-400 fill-yellow-400 mt-0.5" />
                            )}
                            {email.hasAttachments && (
                              <Paperclip size={11} className="flex-shrink-0 text-[var(--c-text-muted)] mt-0.5" />
                            )}
                            <span className={cx(
                              "truncate",
                              !email.read ? "font-semibold text-[var(--c-text)]" : "font-normal text-[var(--c-text)]"
                            )}>
                              {email.subject || t('mail.noSubject')}
                            </span>
                          </div>
                          <span className="text-xs text-[var(--c-text-muted)] whitespace-nowrap flex-shrink-0">
                            {smartFormatTime(email.timestamp)}
                          </span>
                        </div>
                        <div className="text-sm text-[var(--c-text-mid)] truncate opacity-75">{email.preview}</div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="p-8 text-center text-[var(--c-text-muted)] text-sm mt-10">
                  {syncing ? t('mail.syncing') : searchQuery ? t('mail.noResults') : t('mail.noEmails', { folder: selectedFolder === ALL_INBOXES ? t('sidebar.allInboxes') : selectedFolder })}
                </div>
              )}
            </div>
          </div>
          </Panel>

          <PanelResizeHandle className="w-1 bg-transparent hover:bg-[#004f96]/30 transition-colors cursor-col-resize" />

          {/* RIGHT PANE: READING VIEW */}
          <Panel id="reading" defaultSize="70%" minSize="40%">
          <div className="h-full flex flex-col bg-[var(--c-panel)]">
            {selectedEmail ? (
              <>
                <div className="h-14 border-b border-[var(--c-border)] flex items-center px-6 justify-between flex-shrink-0">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleReply(selectedEmail)}
                      className="p-2 hover:bg-[var(--c-hover)] rounded-md transition-colors text-[var(--c-text-mid)]"
                      title={`${t('mail.reply')} (r)`}
                    >
                      <Reply size={18} />
                    </button>
                    <button
                      onClick={() => handleReplyAll(selectedEmail)}
                      className="p-2 hover:bg-[var(--c-hover)] rounded-md transition-colors text-[var(--c-text-mid)] flex items-center gap-0.5"
                      title={`${t('mail.replyAll')} (a)`}
                    >
                      <Reply size={18} />
                      <span className="text-[10px] font-semibold leading-none">All</span>
                    </button>
                    <button
                      onClick={() => handleForward(selectedEmail)}
                      className="p-2 hover:bg-[var(--c-hover)] rounded-md transition-colors text-[var(--c-text-mid)]"
                      title={t('mail.forward')}
                    >
                      <Forward size={18} />
                    </button>
                    <button
                      onClick={() => handleDeleteEmail(selectedEmail)}
                      className="p-2 hover:bg-[#fff0f0] rounded-md transition-colors text-[var(--c-text-mid)] hover:text-red-600"
                      title={t('mail.delete')}
                    >
                      <Trash size={18} />
                    </button>
                    <Slot id="toolbar:actions" email={selectedEmail} />
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8">
                  <h1 className="text-2xl font-bold mb-6">{selectedEmail.subject}</h1>
                  <div className="flex items-center mb-8 pb-6 border-b border-[var(--c-border)]">
                    <div className="h-10 w-10 bg-[var(--c-bg)] rounded-full flex items-center justify-center text-[var(--c-text-mid)] mr-4">
                      <CircleUserRound size={24} />
                    </div>
                    <div className="flex-1 min-w-0">
                      <div className="font-semibold">{selectedEmail.sender}</div>
                      <div className="text-sm text-[var(--c-text-muted)] truncate">
                        {selectedEmail.senderEmail && selectedEmail.senderEmail !== selectedEmail.sender
                          ? `<${selectedEmail.senderEmail}>`
                          : ''}
                      </div>
                      <div className="text-sm text-[var(--c-text-muted)]">{t('mail.to')} {selectedEmail.recipient || 'me'}</div>
                    </div>
                    <div className="text-xs text-[var(--c-text-muted)] whitespace-nowrap flex-shrink-0 self-start mt-1">
                      {format(new Date(selectedEmail.timestamp), 'MMM d, yyyy, h:mm a')}
                    </div>
                  </div>
                  <Slot id="email-detail:header" email={selectedEmail} />
                  {/* Body: rendered in a sandboxed iframe (blocks scripts/forms) for
                      XSS isolation. Link clicks are intercepted → system browser. */}
                  {selectedEmail.bodyHtml ? (
                    <EmailHtmlViewer html={selectedEmail.bodyHtml} isDark={theme === 'dark'} showImages={showImages} />
                  ) : (
                    <div className="text-[15px] leading-relaxed text-[var(--c-text)] whitespace-pre-wrap">
                      {selectedEmail.bodyText}
                    </div>
                  )}
                  <Slot id="email-detail:footer" email={selectedEmail} />
                  {/* Attachment panel — shown only when this email has attachments */}
                  {attachments.length > 0 && (
                    <div className="mt-8 pt-6 border-t border-[var(--c-border)]">
                      <div className="flex items-center gap-2 mb-3 text-sm font-semibold text-[var(--c-text-mid)]">
                        <Paperclip size={14} />
                        <span>{attachments.length} Attachment{attachments.length > 1 ? 's' : ''}</span>
                      </div>
                      <div className="flex flex-wrap gap-3">
                        {attachments.map(att => (
                          <div
                            key={att.id}
                            className="flex items-center gap-3 px-4 py-3 rounded-xl bg-[var(--c-bg)] border border-[var(--c-border)] max-w-xs"
                          >
                            <Paperclip size={16} className="flex-shrink-0 text-[var(--c-text-muted)]" />
                            <div className="min-w-0 flex-1">
                              <div className="text-sm font-medium truncate" title={att.filename}>{att.filename}</div>
                              <div className="text-xs text-[var(--c-text-muted)]">{formatFileSize(att.size)}</div>
                            </div>
                            <button
                              onClick={() => handleSaveAttachment(att)}
                              disabled={savingAttId === att.id}
                              title="Save attachment"
                              className="p-1.5 rounded-md hover:bg-[var(--c-hover)] text-[var(--c-text-mid)] hover:text-[var(--c-text)] transition-colors disabled:opacity-40"
                            >
                              {savingAttId === att.id
                                ? <Loader2 size={14} className="animate-spin" />
                                : <Download size={14} />}
                            </button>
                          </div>
                        ))}
                      </div>
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[var(--c-text-muted)]">
                <div className="text-center">
                  <Mail size={48} className="mx-auto mb-4 opacity-20" />
                  <p>{t('mail.selectItem')}</p>
                </div>
              </div>
            )}
          </div>
          </Panel>
        </PanelGroup>
      )}
      </Panel>
      </PanelGroup>
    </div>
  );
}

// Context menu item helper
function CtxItem({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        'w-full text-left px-4 py-1.5 text-sm hover:bg-[var(--c-hover)] transition-colors',
        danger ? 'text-red-500' : 'text-[var(--c-text)]'
      )}
    >
      {label}
    </button>
  );
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function SidebarSubItem({ icon, label, active, onClick, count }: {
  icon: React.ReactNode;
  label: string;
  active: boolean;
  onClick: () => void;
  count?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-xs transition-colors text-left",
        active
          ? "bg-[var(--c-selected)] text-[var(--c-selected-text)] font-medium"
          : "text-[var(--c-text-mid)] hover:bg-[var(--c-hover)] hover:text-[var(--c-text)]"
      )}
    >
      <span className={cx("flex-shrink-0", active ? "text-[#004f96]" : "opacity-70")}>{icon}</span>
      <span className="truncate flex-1">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="text-xs bg-[#004f96] text-white px-1.5 py-0.5 rounded-full min-w-[18px] text-center">{count}</span>
      )}
    </button>
  );
}

function SidebarItem({ icon, label, active, onClick, count }: { icon: React.ReactNode; label: string; active: boolean; onClick?: () => void; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "w-full flex items-center px-3 py-2 mx-2 rounded-md text-sm transition-colors text-left",
        active
          ? "bg-[var(--c-selected)] text-[var(--c-selected-text)] font-medium"
          : "text-[var(--c-text-mid)] hover:bg-[var(--c-hover)] hover:text-[var(--c-text)]"
      )}
      style={{ width: 'calc(100% - 16px)' }}
    >
      <span className={cx("mr-3 flex-shrink-0", active ? "text-[#004f96]" : "opacity-80")}>
        {icon}
      </span>
      <span className="truncate flex-1">{label}</span>
      {count !== undefined && count > 0 && (
        <span className="ml-2 text-xs bg-[#004f96] text-white px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
          {count}
        </span>
      )}
    </button>
  );
}
