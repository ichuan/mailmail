import { describe, it, expect, beforeEach } from 'vitest';
import { MAX_EMAILS_PER_ACCOUNT_FOLDER, MAX_PINNED_EMAILS_PER_ACCOUNT_FOLDER, useMailStore } from '../store';
import type { Email } from '../store';

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: 'e1',
    uid: 0,
    sender: 'Alice',
    senderEmail: 'alice@test.com',
    recipient: 'me@test.com',
    subject: 'Hello',
    preview: 'Hi there',
    timestamp: '2026-01-01T00:00:00Z',
    read: false,
    starred: false,
    hasAttachments: false,
    folder: 'inbox',
    accountId: 'acc-1',
    ...overrides,
  };
}

describe('MailStore', () => {
  beforeEach(() => {
    const store = useMailStore.getState();
    store.setEmails([]);
    store.setAccounts([]);
    store.setSyncLimitDays(30);
    store.closeCompose();
    store.setSearchQuery('');
  });

  it('should set and get accounts', () => {
    const accounts = [
      { id: 'a1', name: 'Test', email: 'test@test.com', imapServer: 'imap.test.com', imapPort: 993, smtpServer: 'smtp.test.com', smtpPort: 465, username: 'test' },
    ];
    useMailStore.getState().setAccounts(accounts);
    expect(useMailStore.getState().accounts).toHaveLength(1);
    expect(useMailStore.getState().accounts[0].email).toBe('test@test.com');
  });

  it('should set and filter emails by folder', () => {
    const emails = [
      makeEmail({ id: 'e1', folder: 'inbox' }),
      makeEmail({ id: 'e2', folder: 'sent' }),
      makeEmail({ id: 'e3', folder: 'trash' }),
    ];
    useMailStore.getState().setEmails(emails);

    const state = useMailStore.getState();
    const inboxEmails = state.emails.filter(e => e.folder === 'inbox');
    const sentEmails = state.emails.filter(e => e.folder === 'sent');
    expect(inboxEmails).toHaveLength(1);
    expect(sentEmails).toHaveLength(1);
  });

  it('should mark email as read on select', () => {
    useMailStore.getState().setEmails([makeEmail({ id: 'e1', read: false })]);
    useMailStore.getState().selectEmail('e1');

    const email = useMailStore.getState().emails.find(e => e.id === 'e1');
    expect(email?.read).toBe(true);
  });

  it('should set folder and clear selection', () => {
    useMailStore.getState().selectEmail('e1');
    useMailStore.getState().setFolder('sent');

    const state = useMailStore.getState();
    expect(state.selectedFolder).toBe('sent');
    expect(state.selectedEmailId).toBeNull();
    expect(state.activeView).toBe('mail');
  });

  it('should manage sync limit days', () => {
    useMailStore.getState().setSyncLimitDays(90);
    expect(useMailStore.getState().syncLimitDays).toBe(90);
  });

  it('should open and close compose', () => {
    useMailStore.getState().openCompose({ to: 'bob@test.com', subject: 'Re: Hello' });

    const state = useMailStore.getState();
    expect(state.activeView).toBe('compose');
    expect(state.composeState?.to).toBe('bob@test.com');
    expect(state.composeState?.subject).toBe('Re: Hello');

    useMailStore.getState().closeCompose();
    expect(useMailStore.getState().activeView).toBe('mail');
    expect(useMailStore.getState().composeState).toBeNull();
  });

  it('should merge emails without duplicates', () => {
    const emails = [
      makeEmail({ id: 'e1', uid: 1, accountId: 'acc-1', folder: 'inbox' }),
    ];
    useMailStore.getState().setEmails(emails);

    // Merge same uid -> should not duplicate
    useMailStore.getState().mergeEmails([
      makeEmail({ id: 'e1-copy', uid: 1, accountId: 'acc-1', folder: 'inbox' }),
    ]);
    expect(useMailStore.getState().emails).toHaveLength(1);

    // Merge different uid -> should add
    useMailStore.getState().mergeEmails([
      makeEmail({ id: 'e2', uid: 2, accountId: 'acc-1', folder: 'inbox' }),
    ]);
    expect(useMailStore.getState().emails).toHaveLength(2);
  });

  it('should cap retained emails per account and folder', () => {
    const emails = Array.from({ length: MAX_EMAILS_PER_ACCOUNT_FOLDER + 25 }, (_, index) => makeEmail({
      id: `e-${index}`,
      uid: index,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));

    useMailStore.getState().setEmails(emails);

    expect(useMailStore.getState().emails).toHaveLength(MAX_EMAILS_PER_ACCOUNT_FOLDER);
    expect(useMailStore.getState().emails.some(e => e.id === 'e-0')).toBe(false);
    expect(useMailStore.getState().emails.some(e => e.id === `e-${MAX_EMAILS_PER_ACCOUNT_FOLDER + 24}`)).toBe(true);
  });

  it('should preserve starred and selected emails beyond the retention cap', () => {
    const oldestStarred = makeEmail({
      id: 'old-starred',
      uid: 9001,
      starred: true,
      timestamp: '2025-01-01T00:00:00Z',
    });
    const oldestSelected = makeEmail({
      id: 'old-selected',
      uid: 9002,
      timestamp: '2025-01-02T00:00:00Z',
    });
    const recentEmails = Array.from({ length: MAX_EMAILS_PER_ACCOUNT_FOLDER }, (_, index) => makeEmail({
      id: `recent-${index}`,
      uid: index,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));

    useMailStore.getState().setEmails([oldestSelected]);
    useMailStore.getState().selectEmail('old-selected');
    useMailStore.getState().setEmails([oldestStarred, oldestSelected, ...recentEmails]);

    const ids = useMailStore.getState().emails.map(e => e.id);
    expect(ids).toContain('old-starred');
    expect(ids).toContain('old-selected');
    expect(useMailStore.getState().emails).toHaveLength(MAX_EMAILS_PER_ACCOUNT_FOLDER + 2);
  });

  it('should cap extra starred emails retained beyond the regular folder limit', () => {
    const recentEmails = Array.from({ length: MAX_EMAILS_PER_ACCOUNT_FOLDER }, (_, index) => makeEmail({
      id: `recent-${index}`,
      uid: index,
      timestamp: new Date(Date.UTC(2026, 0, 1, 0, index)).toISOString(),
    }));
    const oldStarredEmails = Array.from({ length: MAX_PINNED_EMAILS_PER_ACCOUNT_FOLDER + 10 }, (_, index) => makeEmail({
      id: `old-starred-${index}`,
      uid: 10_000 + index,
      starred: true,
      timestamp: new Date(Date.UTC(2025, 0, 1, 0, index)).toISOString(),
    }));

    useMailStore.getState().setEmails([...oldStarredEmails, ...recentEmails]);

    const retainedStarred = useMailStore.getState().emails.filter(e => e.id.startsWith('old-starred-'));
    expect(retainedStarred).toHaveLength(MAX_PINNED_EMAILS_PER_ACCOUNT_FOLDER);
    expect(useMailStore.getState().emails).toHaveLength(
      MAX_EMAILS_PER_ACCOUNT_FOLDER + MAX_PINNED_EMAILS_PER_ACCOUNT_FOLDER,
    );
  });

  it('should set view correctly', () => {
    useMailStore.getState().setView('settings');
    expect(useMailStore.getState().activeView).toBe('settings');

    useMailStore.getState().setView('add_account');
    expect(useMailStore.getState().activeView).toBe('add_account');
  });

  it('should track syncing state', () => {
    expect(useMailStore.getState().syncing).toBe(false);
    useMailStore.getState().setSyncing(true);
    expect(useMailStore.getState().syncing).toBe(true);
  });

  it('should remove an email by id', () => {
    useMailStore.getState().setEmails([
      makeEmail({ id: 'e1' }),
      makeEmail({ id: 'e2' }),
      makeEmail({ id: 'e3' }),
    ]);
    useMailStore.getState().removeEmail('e2');

    const ids = useMailStore.getState().emails.map(e => e.id);
    expect(ids).not.toContain('e2');
    expect(ids).toHaveLength(2);
  });

  it('should clear selection when removing the selected email', () => {
    useMailStore.getState().setEmails([
      makeEmail({ id: 'e1' }),
      makeEmail({ id: 'e2' }),
    ]);
    useMailStore.getState().selectEmail('e1');
    useMailStore.getState().removeEmail('e1');

    expect(useMailStore.getState().selectedEmailId).toBeNull();
    expect(useMailStore.getState().emails).toHaveLength(1);
  });

  it('should set and clear search query', () => {
    useMailStore.getState().setSearchQuery('invoice');
    expect(useMailStore.getState().searchQuery).toBe('invoice');

    // Changing folder should reset search
    useMailStore.getState().setFolder('sent');
    expect(useMailStore.getState().searchQuery).toBe('');
  });
});
