import { describe, it, expect, beforeEach, vi } from 'vitest';
import { useMailStore } from '../../store';
import { eventBus } from '../../core/event-bus';
import type { Email } from '../../store';

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: 'e1', uid: 0, sender: 'Alice', senderEmail: 'alice@test.example.com',
    recipient: 'me@test.example.com', subject: 'Hello', preview: 'Hi',
    timestamp: '2026-01-01T00:00:00Z', read: false, folder: 'inbox',
    accountId: 'acc-1', ...overrides,
  };
}

describe('Store EventBus Integration', () => {
  beforeEach(() => {
    eventBus.clear();
    const store = useMailStore.getState();
    store.setEmails([]);
    store.setAccounts([]);
    store.closeCompose();
    store.setSearchQuery('');
  });

  it('should emit folder:changed on setFolder', () => {
    const handler = vi.fn();
    eventBus.on('folder:changed', handler);
    useMailStore.getState().setFolder('sent');
    expect(handler).toHaveBeenCalledWith({ folder: 'sent' });
  });

  it('should emit email:selected on selectEmail', () => {
    useMailStore.getState().setEmails([makeEmail({ id: 'e1', read: false })]);
    const handler = vi.fn();
    eventBus.on('email:selected', handler);
    useMailStore.getState().selectEmail('e1');
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].email.id).toBe('e1');
    expect(handler.mock.calls[0][0].email.read).toBe(true);
  });

  it('should emit compose:open on openCompose', () => {
    const handler = vi.fn();
    eventBus.on('compose:open', handler);
    useMailStore.getState().openCompose({ to: 'bob@test.example.com', subject: 'Hi' });
    expect(handler).toHaveBeenCalledTimes(1);
    expect(handler.mock.calls[0][0].draft.to).toBe('bob@test.example.com');
  });

  it('should emit compose:close on closeCompose', () => {
    const handler = vi.fn();
    eventBus.on('compose:close', handler);
    useMailStore.getState().closeCompose();
    expect(handler).toHaveBeenCalledTimes(1);
  });

  it('should emit email:deleted on removeEmail', () => {
    useMailStore.getState().setEmails([makeEmail({ id: 'e1' })]);
    const handler = vi.fn();
    eventBus.on('email:deleted', handler);
    useMailStore.getState().removeEmail('e1');
    expect(handler).toHaveBeenCalledWith({ emailId: 'e1' });
  });

  it('should emit settings:changed on setTheme', () => {
    const handler = vi.fn();
    eventBus.on('settings:changed', handler);
    useMailStore.getState().setTheme('dark');
    expect(handler).toHaveBeenCalledWith({ key: 'theme', value: 'dark' });
  });

  it('should emit settings:changed on setShowImages', () => {
    const handler = vi.fn();
    eventBus.on('settings:changed', handler);
    useMailStore.getState().setShowImages(true);
    expect(handler).toHaveBeenCalledWith({ key: 'showImages', value: true });
  });
});
