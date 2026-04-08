import { useEffect, useRef, useCallback } from 'react';
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
} from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';

import SettingsView from './SettingsView';
import AddAccountView from './AddAccountView';
import ComposeView from './ComposeView';

function cx(...inputs: (string | undefined | null | false)[]) {
  return twMerge(clsx(inputs));
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
    syncing,
    searchQuery,
    setFolder,
    selectEmail,
    setView,
    setAccounts,
    setEmails,
    setSyncLimitDays,
    setShowImages,
    setSyncing,
    openCompose,
    removeEmail,
    setSearchQuery,
  } = useMailStore();

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
          setEmails(freshEmails);
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

    let cancelled = false;
    async function syncFolder() {
      // Show cached emails for this folder immediately
      const cachedAll: Email[] = [];
      for (const acc of accounts) {
        try {
          const cached = await invoke<Email[]>('get_cached_emails', {
            accountId: acc.id,
            folder: selectedFolder,
          });
          cachedAll.push(...cached);
        } catch (_) { /* skip */ }
      }
      if (!cancelled && cachedAll.length > 0) {
        const otherEmails = emails.filter(e => e.folder !== selectedFolder);
        setEmails([...otherEmails, ...cachedAll]);
      }

      // Then refresh from IMAP
      setSyncing(true);
      try {
        const folderEmails = await syncAllAccounts(accounts, syncLimitDays, selectedFolder);
        if (!cancelled) {
          const otherEmails = emails.filter(e => e.folder !== selectedFolder);
          setEmails([...otherEmails, ...folderEmails]);
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
    setSyncing(true);
    try {
      const folderEmails = await syncAllAccounts(accounts, syncLimitDays, selectedFolder);
      const otherEmails = emails.filter(e => e.folder !== selectedFolder);
      setEmails([...otherEmails, ...folderEmails]);
    } catch (err) {
      console.error("Manual sync error:", err);
    } finally {
      setSyncing(false);
    }
  };

  const handleReply = (email: Email) => {
    const replyTo = email.senderEmail || email.sender;
    openCompose({
      to: replyTo,
      subject: email.subject.startsWith('Re:') ? email.subject : `Re: ${email.subject}`,
      body: `\n\n--- Original Message ---\nFrom: ${email.sender}\nDate: ${email.timestamp}\n\n${email.bodyText || ''}`,
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

  // Debounced search: update query after 300ms of no input
  const searchDebounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const handleSearchInput = useCallback((value: string) => {
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    searchDebounceRef.current = setTimeout(() => setSearchQuery(value), 300);
  }, [setSearchQuery]);

  const displayEmails = emails.filter(e => {
    if (e.folder !== selectedFolder) return false;
    if (!searchQuery.trim()) return true;
    const q = searchQuery.toLowerCase();
    return (
      e.subject.toLowerCase().includes(q) ||
      e.sender.toLowerCase().includes(q) ||
      (e.bodyText ?? '').toLowerCase().includes(q)
    );
  });
  const selectedEmail = emails.find(e => e.id === selectedEmailId);

  return (
    <div className="flex h-screen w-screen bg-[#f3f3f3] text-[#1a1c1c] font-sans overflow-hidden">

      {/* LEFT PANE: SIDEBAR */}
      <div
        className="w-60 flex-shrink-0 flex flex-col justify-between border-r border-[#e2e2e2] backdrop-blur-xl bg-white/50"
      >
        <div>
          <div className="p-4 pt-8">
            <button
              onClick={() => openCompose()}
              className="w-full flex items-center justify-center gap-2 bg-[#004f96] text-white px-4 py-2.5 rounded-lg text-sm font-medium hover:bg-[#003b73] transition-colors mb-4"
            >
              <PenSquare size={14} />
              Compose
            </button>
          </div>
          <div className="px-4">
            <h2 className="text-xs font-semibold tracking-wider text-[#414752] uppercase mb-2 ml-2">Favorites</h2>
            <nav className="space-y-0.5">
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
            <h2 className="text-xs font-semibold tracking-wider text-[#414752] uppercase mb-2 ml-2">Accounts</h2>
            <div className="flex-1 overflow-y-auto">
              {accounts.map(acc => (
                <SidebarItem
                  key={acc.id}
                  icon={<Mail size={16} />}
                  label={acc.email}
                  active={false}
                  count={emails.filter(e => e.accountId === acc.id && !e.read).length}
                />
              ))}
              <div className="mt-8 mb-4 border-t border-[#e2e2e2] pt-4"></div>
              <SidebarItem
                icon={<Settings size={16} />}
                label="Settings"
                active={activeView === 'settings'}
                onClick={() => setView('settings')}
              />
            </div>
          </div>
        </div>
      </div>

      {activeView === 'settings' ? (
        <div className="flex-1 bg-[#ffffff] h-full overflow-y-auto w-full relative z-50">
           <SettingsView />
        </div>
      ) : activeView === 'add_account' ? (
        <div className="flex-1 bg-[#ffffff] h-full overflow-y-auto w-full relative z-50">
           <AddAccountView />
        </div>
      ) : activeView === 'compose' ? (
        <div className="flex-1 bg-[#ffffff] h-full overflow-y-auto w-full relative z-50">
           <ComposeView />
        </div>
      ) : (
        <>
          {/* MIDDLE PANE: MESSAGE LIST */}
          <div className="w-[320px] flex-shrink-0 flex flex-col bg-white border-r border-[#e2e2e2]">
            <div className="border-b border-[#e2e2e2] px-4 py-2 shadow-sm z-10">
              <div className="flex items-center justify-between mb-2">
                <h1 className="text-lg font-semibold capitalize">{selectedFolder}</h1>
                <button
                  onClick={handleManualSync}
                  disabled={syncing}
                  className="p-1.5 hover:bg-[#f3f3f3] rounded-md text-[#717783] transition-colors disabled:opacity-50"
                  title="Refresh"
                >
                  {syncing ? <Loader2 size={16} className="animate-spin" /> : <RefreshCw size={16} />}
                </button>
              </div>
              {/* Search bar */}
              <div className="flex items-center gap-2 bg-[#f3f3f3] rounded-lg px-3 py-1.5">
                <Search size={13} className="text-[#717783] flex-shrink-0" />
                <input
                  type="text"
                  placeholder="Search"
                  defaultValue={searchQuery}
                  onChange={(e) => handleSearchInput(e.target.value)}
                  className="bg-transparent text-sm flex-1 outline-none placeholder-[#a5a9b0]"
                />
                {searchQuery && (
                  <button onClick={() => setSearchQuery('')} className="text-[#717783] hover:text-[#1a1c1c]">
                    <X size={13} />
                  </button>
                )}
              </div>
            </div>
            <div className="flex-1 overflow-y-auto">
              {displayEmails.map(email => (
                <div
                  key={email.id}
                  onClick={() => selectEmail(email.id)}
                  className={cx(
                    "p-4 border-b border-[#f1f1f1] cursor-pointer hover:bg-[#f3f3f3] transition-colors relative",
                    selectedEmailId === email.id ? "bg-[#d5e3ff] hover:bg-[#d5e3ff]" : ""
                  )}
                >
                  {selectedEmailId === email.id && (
                    <div className="absolute left-0 top-3 bottom-3 w-1 bg-[#004f96] rounded-r-md"></div>
                  )}
                  <div className="flex justify-between items-baseline mb-1">
                    <span className={cx(
                      "font-semibold truncate pr-2",
                      !email.read ? "text-[#004f96]" : "text-[#1a1c1c]"
                    )}>
                      {email.sender}
                    </span>
                    <span className="text-xs text-[#717783] whitespace-nowrap">
                      {smartFormatTime(email.timestamp)}
                    </span>
                  </div>
                  <div className="text-sm font-medium mb-1 truncate">{email.subject}</div>
                  <div className="text-sm text-[#414752] truncate opacity-90">{email.preview}</div>
                </div>
              ))}
              {displayEmails.length === 0 && (
                <div className="p-8 text-center text-[#717783] text-sm mt-10">
                  {syncing ? 'Syncing...' : searchQuery ? 'No results' : `No emails in ${selectedFolder}`}
                </div>
              )}
            </div>
          </div>

          {/* RIGHT PANE: READING VIEW */}
          <div className="flex-1 flex flex-col bg-white">
            {selectedEmail ? (
              <>
                <div className="h-14 border-b border-[#e2e2e2] flex items-center px-6 justify-between flex-shrink-0">
                  <div className="flex items-center space-x-2">
                    <button
                      onClick={() => handleReply(selectedEmail)}
                      className="p-2 hover:bg-[#f3f3f3] rounded-md transition-colors text-[#414752]"
                      title="Reply"
                    >
                      <Reply size={18} />
                    </button>
                    <button
                      onClick={() => handleForward(selectedEmail)}
                      className="p-2 hover:bg-[#f3f3f3] rounded-md transition-colors text-[#414752]"
                      title="Forward"
                    >
                      <Forward size={18} />
                    </button>
                    <button
                      onClick={() => handleDeleteEmail(selectedEmail)}
                      className="p-2 hover:bg-[#fff0f0] rounded-md transition-colors text-[#414752] hover:text-red-600"
                      title="Delete"
                    >
                      <Trash size={18} />
                    </button>
                  </div>
                </div>

                <div className="flex-1 overflow-y-auto p-8">
                  <h1 className="text-2xl font-bold mb-6">{selectedEmail.subject}</h1>
                  <div className="flex items-center mb-8 pb-6 border-b border-[#e2e2e2]">
                    <div className="h-10 w-10 bg-[#f3f3f3] rounded-full flex items-center justify-center text-[#414752] mr-4">
                      <CircleUserRound size={24} />
                    </div>
                    <div>
                      <div className="font-semibold">{selectedEmail.sender}</div>
                      <div className="text-sm text-[#717783]">to {selectedEmail.recipient || 'me'} • {format(new Date(selectedEmail.timestamp), 'MMM d, yyyy, h:mm a')}</div>
                    </div>
                  </div>
                  {/* Body: intercept link clicks so they open in the system browser instead
                      of navigating the Tauri WebView. Also suppress images when showImages
                      is off via the .hide-images CSS class. */}
                  <div
                    className={cx('text-[15px] leading-relaxed text-[#1a1c1c]', !showImages && 'hide-images')}
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
                      <div dangerouslySetInnerHTML={{ __html: selectedEmail.bodyHtml }} />
                    ) : (
                      <div className="whitespace-pre-wrap">{selectedEmail.bodyText}</div>
                    )}
                  </div>
                </div>
              </>
            ) : (
              <div className="flex-1 flex items-center justify-center text-[#717783]">
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

function SidebarItem({ icon, label, active, onClick, count }: { icon: React.ReactNode; label: string; active: boolean; onClick?: () => void; count?: number }) {
  return (
    <button
      onClick={onClick}
      className={cx(
        "w-full flex items-center px-3 py-2 mx-2 rounded-md text-sm transition-colors text-left",
        active
          ? "bg-[#d5e3ff] text-[#001c3b] font-medium"
          : "text-[#414752] hover:bg-[#e8e8e8]/50 hover:text-[#1a1c1c]"
      )}
      style={{ width: 'calc(100% - 16px)' }}
    >
      <span className={cx("mr-3", active ? "text-[#004f96]" : "opacity-80")}>
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

