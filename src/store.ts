import { create } from 'zustand';
import { eventBus } from './core/event-bus';
import type { AppErrorCode } from './core/app-error';

export const MAX_EMAILS_PER_ACCOUNT_FOLDER = 500;
export const MAX_PINNED_EMAILS_PER_ACCOUNT_FOLDER = 100;

export interface Email {
  id: string;
  uid: number;
  sender: string;
  senderEmail: string;
  recipient: string;
  subject: string;
  preview: string;
  bodyHtml?: string;
  bodyText?: string;
  timestamp: string;
  read: boolean;
  starred: boolean;
  hasAttachments: boolean;
  folder: 'inbox' | 'sent' | 'trash';
  accountId: string;
}

export interface Attachment {
  id: string;
  emailId: string;
  filename: string;
  mimeType: string;
  size: number;
}

export interface Account {
  id: string;
  name: string;
  email: string;
  imapServer: string;
  imapPort: number;
  smtpServer: string;
  smtpPort: number;
  username: string;
}

export type AccountHealthStatus =
  | 'unknown'
  | 'healthy'
  | 'syncing'
  | 'degraded'
  | 'reconnecting'
  | 'auth_failed'
  | 'manual_action_required'
  | 'offline';

export interface AccountHealth {
  accountId: string;
  status: AccountHealthStatus;
  lastErrorCode?: AppErrorCode;
  lastErrorMessage?: string;
  consecutiveFailures: number;
  retryInSeconds?: number;
  updatedAt: string;
}

export interface ComposeState {
  to: string;
  subject: string;
  body: string;
  inReplyTo?: string;
  fromAccountId?: string;
}

export interface Signature {
  id: string;
  name: string;
  content: string;
  isDefault: boolean;
}

interface MailStore {
  accounts: Account[];
  accountHealthById: Record<string, AccountHealth>;
  emails: Email[];
  selectedFolder: string;
  selectedEmailId: string | null;
  activeView: 'mail' | 'settings' | 'add_account' | 'compose';
  syncLimitDays: number;
  showImages: boolean;
  theme: 'light' | 'dark';
  syncing: boolean;
  composeState: ComposeState | null;
  signatures: Signature[];
  searchQuery: string;
  setFolder: (folder: string) => void;
  selectEmail: (id: string | null) => void;
  addEmails: (emails: Email[]) => void;
  setView: (view: 'mail' | 'settings' | 'add_account' | 'compose') => void;
  setAccounts: (accounts: Account[]) => void;
  setAccountHealth: (health: AccountHealth) => void;
  clearAccountHealth: (accountId: string) => void;
  setEmails: (emails: Email[]) => void;
  setSyncLimitDays: (days: number) => void;
  setShowImages: (show: boolean) => void;
  setTheme: (theme: 'light' | 'dark') => void;
  setSyncing: (syncing: boolean) => void;
  openCompose: (state?: Partial<ComposeState>) => void;
  closeCompose: () => void;
  mergeEmails: (newEmails: Email[]) => void;
  removeEmail: (id: string) => void;
  markEmailRead: (id: string, read: boolean) => void;
  toggleStar: (id: string, starred: boolean) => void;
  setSearchQuery: (query: string) => void;
  setSignatures: (sigs: Signature[]) => void;
}

function emailMemoryKey(email: Email): string {
  return `${email.accountId}:${email.folder}:${email.uid}`;
}

function pruneEmailsForMemory(emails: Email[], selectedEmailId: string | null): Email[] {
  const keepKeys = new Set<string>();
  const groups = new Map<string, Email[]>();

  for (const email of emails) {
    const groupKey = `${email.accountId}:${email.folder}`;
    const group = groups.get(groupKey) ?? [];
    group.push(email);
    groups.set(groupKey, group);
  }

  for (const group of groups.values()) {
    if (group.length <= MAX_EMAILS_PER_ACCOUNT_FOLDER) {
      for (const email of group) keepKeys.add(emailMemoryKey(email));
      continue;
    }

    const sorted = group
      .map(email => ({ email, key: emailMemoryKey(email), timestamp: new Date(email.timestamp).getTime() }))
      .sort((a, b) => b.timestamp - a.timestamp);

    let retainedRegular = 0;
    let retainedPinned = 0;
    for (const { email, key } of sorted) {
      if (retainedRegular < MAX_EMAILS_PER_ACCOUNT_FOLDER) {
        keepKeys.add(key);
        retainedRegular += 1;
        continue;
      }
      if (email.id === selectedEmailId || (email.starred && retainedPinned < MAX_PINNED_EMAILS_PER_ACCOUNT_FOLDER)) {
        keepKeys.add(key);
        if (email.starred && email.id !== selectedEmailId) retainedPinned += 1;
      }
    }
  }

  return emails.filter(email => keepKeys.has(emailMemoryKey(email)));
}

export const useMailStore = create<MailStore>((set) => ({
  accounts: [],
  accountHealthById: {},
  emails: [],
  selectedFolder: 'inbox',
  selectedEmailId: null,
  activeView: 'mail',
  syncLimitDays: 30,
  showImages: false,
  theme: 'light',
  syncing: false,
  composeState: null,
  signatures: [],
  searchQuery: '',
  setFolder: (folder) => {
    set({ selectedFolder: folder, selectedEmailId: null, activeView: 'mail', searchQuery: '' });
    eventBus.emit('folder:changed', { folder });
  },
  selectEmail: (id) => set((state) => {
    const email = state.emails.find(e => e.id === id);
    if (email) {
      eventBus.emit('email:selected', { email: { ...email, read: true } });
    }
    return {
      selectedEmailId: id,
      emails: state.emails.map(e => e.id === id ? { ...e, read: true } : e),
    };
  }),
  addEmails: (newEmails) => set((state) => ({
    emails: pruneEmailsForMemory([...state.emails, ...newEmails], state.selectedEmailId),
  })),
  setView: (view) => set({ activeView: view }),
  setAccounts: (accounts) => {
    set((state) => {
      const validIds = new Set(accounts.map(account => account.id));
      const accountHealthById = Object.fromEntries(
        Object.entries(state.accountHealthById).filter(([accountId]) => validIds.has(accountId)),
      );
      return { accounts, accountHealthById };
    });
  },
  setAccountHealth: (health) => {
    set((state) => ({
      accountHealthById: {
        ...state.accountHealthById,
        [health.accountId]: health,
      },
    }));
  },
  clearAccountHealth: (accountId) => {
    set((state) => {
      const { [accountId]: _removed, ...accountHealthById } = state.accountHealthById;
      return { accountHealthById };
    });
  },
  setEmails: (emails) => set((state) => ({ emails: pruneEmailsForMemory(emails, state.selectedEmailId) })),
  setSyncLimitDays: (days) => set({ syncLimitDays: days }),
  setShowImages: (show) => {
    set({ showImages: show });
    eventBus.emit('settings:changed', { key: 'showImages', value: show });
  },
  setTheme: (theme) => {
    set({ theme });
    eventBus.emit('settings:changed', { key: 'theme', value: theme });
  },
  setSyncing: (syncing) => {
    set({ syncing });
  },
  openCompose: (composeInit) => {
    const draft = { to: '', subject: '', body: '', ...composeInit };
    set({ activeView: 'compose', composeState: draft });
    eventBus.emit('compose:open', { draft });
  },
  closeCompose: () => {
    set({ activeView: 'mail', composeState: null });
    eventBus.emit('compose:close', {} as Record<string, never>);
  },
  // Merge new emails without duplicating by accountId+folder+uid
  mergeEmails: (newEmails) => set((state) => {
    const existing = new Set(state.emails.map(e => `${e.accountId}:${e.folder}:${e.uid}`));
    const unique = newEmails.filter(e => !existing.has(`${e.accountId}:${e.folder}:${e.uid}`));
    return { emails: pruneEmailsForMemory([...state.emails, ...unique], state.selectedEmailId) };
  }),
  removeEmail: (id) => {
    set((state) => ({
      emails: state.emails.filter(e => e.id !== id),
      selectedEmailId: state.selectedEmailId === id ? null : state.selectedEmailId,
    }));
    eventBus.emit('email:deleted', { emailId: id });
  },
  markEmailRead: (id, read) => {
    set((state) => ({
      emails: state.emails.map(e => e.id === id ? { ...e, read } : e),
    }));
  },
  toggleStar: (id, starred) => {
    set((state) => ({
      emails: state.emails.map(e => e.id === id ? { ...e, starred } : e),
    }));
  },
  setSearchQuery: (query) => set({ searchQuery: query }),
  setSignatures: (sigs) => set({ signatures: sigs }),
}));
