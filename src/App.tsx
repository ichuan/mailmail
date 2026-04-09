import { useEffect, useRef, useCallback, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { open as openExternal } from '@tauri-apps/plugin-shell';
import { useMailStore } from './store';
import type { Account, Email } from './store';
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
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import SettingsView from './SettingsView';
import AddAccountView from './AddAccountView';
import ComposeView from './ComposeView';
import { Slot } from './core/slot-registry';
import { initBuiltinPlugins, destroyPlugins } from './plugin-registry';
import { pluginManager } from './core/plugin-manager';

// Special virtual folder key that aggregates all accounts' inboxes.
export const ALL_INBOXES = '__all__';

function cx(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
}

/**
 * Strip <img> tags from HTML so remote images are never loaded.
 * display:none via CSS still fires HTTP requests; DOM removal does not.
 * This is the correct approach for preventing email tracker pixels.
 */
function sanitizeEmailHtml(html: string, allowImages: boolean): string {
  if (allowImages) return html;
  return html.replace(/<img[^>]*\/?>/gi, '');
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

async function syncAllAccounts(accounts: Account[], syncLimitDays: number, folder: string): Promise<Email[]> {
  const results: Email[] = [];
  for (const acc of accounts) {
    try {
      const emails = await invoke<Email[]>('sync_folder', {
        account: acc,
        folder,
        limitDays: syncLimitDays,
      });
      results.push(...emails);
    } catch (err) {
      console.error(`Failed to sync ${folder} for ${acc.email}:`, err);
    }
  }
  return results;
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

  // Initialize plugins once on mount
  useEffect(() => {
    initBuiltinPlugins();
    return () => destroyPlugins();
  }, []);

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

        const loadedAccounts = await invoke<Account[]>('get_accounts');
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
          const freshEmails = await syncAllAccounts(loadedAccounts, limit, 'inbox');
          // IMAP always returns read=false; preserve what the cache already marked as read
          const { emails: memEmails } = useMailStore.getState();
          const readIds = new Set(memEmails.filter(e => e.read).map(e => e.id));
          setEmails(freshEmails.map(e => readIds.has(e.id) ? { ...e, read: true } : e));
          setSyncing(false);
        }
      } catch (err) {
        console.error("Failed to load data:", err);
        setSyncing(false);
      }
    }
    loadData();
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
        const folderEmails = await syncAllAccounts(accounts, syncLimitDays, effectiveFolder);
        if (!cancelled) {
          const { emails: cur } = useMailStore.getState();
          const readIds = new Set(cur.filter(e => e.read).map(e => e.id));
          const merged = folderEmails.map(e => readIds.has(e.id) ? { ...e, read: true } : e);
          setEmails([...cur.filter(e => e.folder !== effectiveFolder), ...merged]);
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
      const folderEmails = await syncAllAccounts(accounts, syncLimitDays, effectiveFolder);
      const { emails: cur } = useMailStore.getState();
      const readIds = new Set(cur.filter(e => e.read).map(e => e.id));
      const merged = folderEmails.map(e => readIds.has(e.id) ? { ...e, read: true } : e);
      setEmails([...cur.filter(e => e.folder !== effectiveFolder), ...merged]);
    } catch (err) {
      console.error("Manual sync error:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleReply = (email: Email) => {
    const replyTo = email.senderEmail || email.sender;
    const dateStr = format(new Date(email.timestamp), 'EEE, MMM d, yyyy \u2019at\u2019 h:mm a');
    const originalLines = (email.bodyText || '').split('\n');
    // RFC-style quoting: prefix each line with '>'
    const quoted = originalLines.map(l => `> ${l}`).join('\n');
    openCompose({
      to: replyTo,
      subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      body: `\n\nOn ${dateStr}, ${email.sender} <${email.senderEmail}> wrote:\n${quoted}`,
      fromAccountId: accounts.find(a => a.id === email.accountId)?.id,
    });
  };

  const handleForward = (email: Email) => {
    openCompose({
      to: '',
      subject: email.subject.startsWith('Fwd:') ? email.subject : `Fwd: ${email.subject}`,
      body: `\n\n--- Forwarded Message ---\nFrom: ${email.sender}\nDate: ${email.timestamp}\nSubject: ${email.subject}\n\n${email.bodyText || ''}`,
      fromAccountId: accounts.find(a => a.id === email.accountId)?.id,
    });
  };

  const handleDeleteEmail = async (email: Email) => {
    const account = accounts.find(a => a.id === email.accountId);
    if (!account) return;
    try {
      await invoke('delete_email', {
        account,
        folder: email.folder,
        uid: email.uid,
        emailId: email.id,
      });
      removeEmail(email.id);
    } catch (err) {
      console.error("Failed to delete email:", err);
    }
  };

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

  // Right-click context menu state
  const [ctxMenu, setCtxMenu] = useState<{
    x: number;
    y: number;
    type: 'email' | 'account';
    emailTarget?: Email;
    accountTarget?: Account;
  } | null>(null);

  const closeCtxMenu = useCallback(() => setCtxMenu(null), []);

  // Load more pagination
  const [displayLimit, setDisplayLimit] = useState(50);

  const displayEmails = emails.filter(e => {
    // For the unified inbox, show all inbox-folder emails regardless of account.
    // For a normal folder, restrict to the exact selectedFolder value.
    if (selectedFolder === ALL_INBOXES) {
      if (e.folder !== 'inbox') return false;
    } else {
      if (e.folder !== selectedFolder) return false;
    }
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      e.subject.toLowerCase().includes(q) ||
      e.sender.toLowerCase().includes(q) ||
      (e.bodyText ?? '').toLowerCase().includes(q)
    );
  });
  // Reset pagination when folder or search changes
  useEffect(() => { setDisplayLimit(50); }, [selectedFolder, searchQuery]);
  const visibleEmails = displayEmails.slice(0, displayLimit);
  const selectedEmail = emails.find(e => e.id === selectedEmailId);

  return (
    // onClick on root dismisses the context menu on any outside click
    <div
      className={cx("flex h-screen w-screen bg-[var(--c-bg)] text-[var(--c-text)] font-sans overflow-hidden", theme === 'dark' && 'dark')}
      onClick={closeCtxMenu}
    >
      {/* Context menu overlay */}
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
                <CtxItem label={e.read ? 'Mark as Unread' : 'Mark as Read'} onClick={() => {
                  const nextRead = !e.read;
                  invoke('mark_email_read', { id: e.id, read: nextRead }).catch(console.error);
                  useMailStore.getState().markEmailRead(e.id, nextRead);
                  closeCtxMenu();
                }} />
                <CtxItem label={e.starred ? 'Unstar' : 'Star'} onClick={() => {
                  const nextStarred = !e.starred;
                  invoke('toggle_star', { id: e.id, starred: nextStarred }).catch(console.error);
                  useMailStore.getState().toggleStar(e.id, nextStarred);
                  closeCtxMenu();
                }} />
                <CtxItem label="Reply" onClick={() => { handleReply(e); closeCtxMenu(); }} />
                <CtxItem label="Forward" onClick={() => { handleForward(e); closeCtxMenu(); }} />
                <div className="my-1 border-t border-[var(--c-border-subtle)]" />
                <CtxItem label="Delete" danger onClick={() => { handleDeleteEmail(e); closeCtxMenu(); }} />
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
                <CtxItem label="Refresh" onClick={() => { handleManualSync(); closeCtxMenu(); }} />
                <div className="my-1 border-t border-[var(--c-border-subtle)]" />
                <CtxItem label="Remove Account" danger onClick={() => {
                  if (window.confirm(`Remove account '${acc.name}'?`)) {
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

      {/* LEFT PANE: SIDEBAR */}
      <div
        className="w-60 flex-shrink-0 flex flex-col justify-between border-r border-[var(--c-border)] backdrop-blur-xl bg-[var(--c-sidebar-bg)]"
      >
        <div>
          <Slot id="sidebar:top" />
          {/* Top action buttons: New Mail + Refresh */}
          <div className="flex items-center gap-2 p-3 pt-6">
            <button
              onClick={() => openCompose()}
              className="flex-1 flex items-center justify-center gap-1.5 bg-[#004f96] text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-[#003b73] transition-colors"
            >
              <PenSquare size={14} />
              New Mail
            </button>
            <button
              onClick={handleManualSync}
              disabled={syncing}
              title="Refresh all"
              className="p-2 rounded-lg bg-[var(--c-bg)] border border-[var(--c-border)] text-[var(--c-text-muted)] hover:text-[var(--c-text)] transition-colors disabled:opacity-50"
            >
              {syncing ? <Loader2 size={14} className="animate-spin" /> : <RefreshCw size={14} />}
            </button>
          </div>
          <div className="px-4 mt-2">
            <h2 className="text-xs font-semibold tracking-wider text-[var(--c-text-mid)] uppercase mb-2 ml-2">Favorites</h2>
            <nav className="space-y-0.5">
              {accounts.length > 1 && (
                <SidebarItem
                  icon={<Inbox size={16} />}
                  label="All Inboxes"
                  active={selectedFolder === ALL_INBOXES && activeView === 'mail'}
                  onClick={() => setFolder(ALL_INBOXES)}
                  count={emails.filter(e => e.folder === 'inbox' && !e.read).length}
                />
              )}
              <SidebarItem
                icon={<Inbox size={16} />}
                label="Inbox"
                active={selectedFolder === 'inbox' && activeView === 'mail'}
                onClick={() => setFolder('inbox')}
                count={emails.filter(e => e.folder === 'inbox' && !e.read).length}
              />
              <SidebarItem
                icon={<Send size={16} />}
                label="Sent"
                active={selectedFolder === 'sent' && activeView === 'mail'}
                onClick={() => setFolder('sent')}
              />
              <SidebarItem
                icon={<Trash2 size={16} />}
                label="Trash"
                active={selectedFolder === 'trash' && activeView === 'mail'}
                onClick={() => setFolder('trash')}
              />
            </nav>
          </div>

          <div className="p-4">
            <h2 className="text-xs font-semibold tracking-wider text-[var(--c-text-mid)] uppercase mb-2 ml-2">Accounts</h2>
            <div className="flex-1 overflow-y-auto">
              {accounts.map(acc => (
                <button
                  key={acc.id}
                  style={{ width: 'calc(100% - 16px)' }}
                  className="w-full flex items-center px-3 py-2 mx-2 rounded-md text-sm text-[var(--c-text-mid)] hover:bg-[var(--c-hover)] hover:text-[var(--c-text)] transition-colors text-left"
                  onContextMenu={(e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    setCtxMenu({ x: e.clientX, y: e.clientY, type: 'account', accountTarget: acc });
                  }}
                >
                  <span className="mr-3 flex-shrink-0 opacity-80"><Mail size={16} /></span>
                  <span className="truncate flex-1">{acc.email}</span>
                  {emails.filter(em => em.accountId === acc.id && !em.read).length > 0 && (
                    <span className="ml-2 text-xs bg-[#004f96] text-white px-1.5 py-0.5 rounded-full min-w-[20px] text-center">
                      {emails.filter(em => em.accountId === acc.id && !em.read).length}
                    </span>
                  )}
                </button>
              ))}
              <div className="mt-8 mb-4 border-t border-[var(--c-border)] pt-4"></div>
              <SidebarItem
                icon={<Settings size={16} />}
                label="Settings"
                active={activeView === 'settings'}
                onClick={() => setView('settings')}
              />
              <Slot id="sidebar:bottom" />
            </div>
          </div>
        </div>
      </div>

      {activeView === 'settings' ? (
        <div className="flex-1 bg-[var(--c-panel)] h-full overflow-y-auto w-full relative z-50">
           <SettingsView />
        </div>
      ) : activeView === 'add_account' ? (
        <div className="flex-1 bg-[var(--c-panel)] h-full overflow-y-auto w-full relative z-50">
           <AddAccountView />
        </div>
      ) : activeView === 'compose' ? (
        <div className="flex-1 bg-[var(--c-panel)] h-full overflow-y-auto w-full relative z-50">
           <ComposeView />
        </div>
      ) : (
        <>
          {/* MIDDLE PANE: MESSAGE LIST */}
          <div className="w-[320px] flex-shrink-0 flex flex-col bg-[var(--c-panel)] border-r border-[var(--c-border)]">
            {/* Search bar only — folder name + refresh moved to sidebar */}
            <div className="border-b border-[var(--c-border)] px-4 py-2.5 z-10">
              <div className="flex items-center gap-2 bg-[var(--c-bg)] rounded-lg px-3 py-1.5">
                <Search size={13} className="text-[var(--c-text-muted)] flex-shrink-0" />
                <input
                  type="text"
                  placeholder="Search"
                  defaultValue={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  className="bg-transparent text-sm flex-1 outline-none placeholder-[#a5a9b0]"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="text-[var(--c-text-muted)] hover:text-[var(--c-text)]"><X size={13} /></button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {visibleEmails.map(email => (
                <div
                  key={email.id}
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
                    <span className={cx(
                      "truncate pr-2",
                      !email.read ? "font-semibold text-[#004f96]" : "font-normal text-[var(--c-text)]"
                    )}>
                      {email.sender}
                    </span>
                    <span className="text-xs text-[var(--c-text-muted)] whitespace-nowrap flex-shrink-0">
                      {smartFormatTime(email.timestamp)}
                    </span>
                  </div>
                  <div className="flex items-baseline gap-1">
                    {email.starred && (
                      <Star size={11} className="flex-shrink-0 text-yellow-400 fill-yellow-400 mt-0.5" />
                    )}
                    <div className={cx("text-sm mb-1 truncate", !email.read ? "font-medium" : "font-normal")}>{email.subject}</div>
                  </div>
                  <div className="text-sm text-[var(--c-text-mid)] truncate opacity-90">{email.preview}</div>
                </div>
              ))}
              {displayEmails.length > displayLimit && (
                <button
                  onClick={() => setDisplayLimit(n => n + 50)}
                  className="w-full py-3 text-sm text-[var(--c-text-muted)] hover:text-[var(--c-text)] hover:bg-[var(--c-hover)] transition-colors"
                >
                  Load {Math.min(50, displayEmails.length - displayLimit)} more
                </button>
              )}
              {displayEmails.length === 0 && (
                <div className="p-8 text-center text-[var(--c-text-muted)] text-sm mt-10">
                  {syncing ? 'Syncing...' : searchQuery ? 'No results' : `No emails in ${selectedFolder === ALL_INBOXES ? 'All Inboxes' : selectedFolder}`}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANE: READING VIEW */}
          <div className="flex-1 flex flex-col bg-[var(--c-panel)]">
            {selectedEmail ? (
              <>
                <div className="h-14 border-b border-[var(--c-border)] flex items-center px-6 justify-between flex-shrink-0">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleReply(selectedEmail)}
                      className="p-2 hover:bg-[var(--c-hover)] rounded-md transition-colors text-[var(--c-text-mid)]"
                      title="Reply"
                    >
                      <Reply size={18} />
                    </button>
                    <button
                      onClick={() => handleForward(selectedEmail)}
                      className="p-2 hover:bg-[var(--c-hover)] rounded-md transition-colors text-[var(--c-text-mid)]"
                      title="Forward"
                    >
                      <Forward size={18} />
                    </button>
                    <button
                      onClick={() => handleDeleteEmail(selectedEmail)}
                      className="p-2 hover:bg-[#fff0f0] rounded-md transition-colors text-[var(--c-text-mid)] hover:text-red-600"
                      title="Delete"
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
                    <div>
                      <div className="font-semibold">{selectedEmail.sender}</div>
                      <div className="text-sm text-[var(--c-text-muted)]">to {selectedEmail.recipient || 'me'} • {format(new Date(selectedEmail.timestamp), 'MMM d, yyyy, h:mm a')}</div>
                    </div>
                  </div>
                  <Slot id="email-detail:header" email={selectedEmail} />
                  {/* Body: strip img tags (not CSS) when showImages is off
                      so tracker pixel HTTP requests are never fired. */}
                  <div
                    className="text-[15px] leading-relaxed text-[var(--c-text)]"
                    onClick={(e) => {
                      const target = (e.target as HTMLElement).closest('a');
                      if (target?.href) {
                        e.preventDefault();
                        e.stopPropagation();
                        openExternal(target.href).catch(console.error);
                      }
                    }}
                  >
                    {selectedEmail.bodyHtml ? (
                      <div dangerouslySetInnerHTML={{ __html: sanitizeEmailHtml(selectedEmail.bodyHtml, showImages) }} />
                    ) : (
                      <div className="whitespace-pre-wrap">{selectedEmail.bodyText}</div>
                    )}
                  </div>
                  <Slot id="email-detail:footer" email={selectedEmail} />
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[var(--c-text-muted)]">
                <div className="text-center">
                  <Mail size={48} className="mx-auto mb-4 opacity-20" />
                  <p>Select an item to read</p>
                </div>
              </div>
            )}
          </div>
        </>
      )}
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

