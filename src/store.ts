import { create } from 'zustand';
import { eventBus } from './core/event-bus';

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
  folder: 'inbox' | 'sent' | 'trash';
  accountId: string;
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
  password: string;
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

export const useMailStore = create<MailStore>((set) => ({
  accounts: [],
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
  addEmails: (newEmails) => set((state) => ({ emails: [...state.emails, ...newEmails] })),
  setView: (view) => set({ activeView: view }),
  setAccounts: (accounts) => {
    set({ accounts });
  },
  setEmails: (emails) => set({ emails }),
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
    return { emails: [...state.emails, ...unique] };
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
