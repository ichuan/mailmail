import { create } from 'zustand';

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
  setSearchQuery: (query: string) => void;
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
  searchQuery: '',
  setFolder: (folder) => set({ selectedFolder: folder, selectedEmailId: null, activeView: 'mail', searchQuery: '' }),
  selectEmail: (id) => set((state) => ({
    selectedEmailId: id,
    emails: state.emails.map(e => e.id === id ? { ...e, read: true } : e)
  })),
  addEmails: (newEmails) => set((state) => ({ emails: [...state.emails, ...newEmails] })),
  setView: (view) => set({ activeView: view }),
  setAccounts: (accounts) => set({ accounts }),
  setEmails: (emails) => set({ emails }),
  setSyncLimitDays: (days) => set({ syncLimitDays: days }),
  setShowImages: (show) => set({ showImages: show }),
  setTheme: (theme) => set({ theme }),
  setSyncing: (syncing) => set({ syncing }),
  openCompose: (composeInit) => set({
    activeView: 'compose',
    composeState: { to: '', subject: '', body: '', ...composeInit },
  }),
  closeCompose: () => set({ activeView: 'mail', composeState: null }),
  // Merge new emails without duplicating by accountId+folder+uid
  mergeEmails: (newEmails) => set((state) => {
    const existing = new Set(state.emails.map(e => `${e.accountId}:${e.folder}:${e.uid}`));
    const unique = newEmails.filter(e => !existing.has(`${e.accountId}:${e.folder}:${e.uid}`));
    return { emails: [...state.emails, ...unique] };
  }),
  removeEmail: (id) => set((state) => ({
    emails: state.emails.filter(e => e.id !== id),
    selectedEmailId: state.selectedEmailId === id ? null : state.selectedEmailId,
  })),
  setSearchQuery: (query) => set({ searchQuery: query }),
}));
