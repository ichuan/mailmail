import { describe, it, expect, beforeEach } from 'vitest';
import { EventBus } from '../../core/event-bus';
import type { Email } from '../../store';

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: 'e1', uid: 0, sender: 'Alice', senderEmail: 'alice@test.com',
    recipient: 'me@test.com', subject: 'Hello', preview: 'Hi',
    timestamp: '2026-01-01T00:00:00Z', read: false, folder: 'inbox',
    accountId: 'acc-1', ...overrides,
  };
}

describe('EventBus', () => {
  let bus: EventBus;

  beforeEach(() => {
    bus = new EventBus();
  });

  it('should deliver typed events to handlers', () => {
    const received: string[] = [];
    bus.on('folder:changed', ({ folder }) => received.push(folder));
    bus.emit('folder:changed', { folder: 'sent' });
    expect(received).toEqual(['sent']);
  });

  it('should support multiple handlers for the same event', () => {
    let count = 0;
    bus.on('app:ready', () => count++);
    bus.on('app:ready', () => count++);
    bus.emit('app:ready', {} as Record<string, never>);
    expect(count).toBe(2);
  });

  it('should not deliver events after dispose()', () => {
    let count = 0;
    const sub = bus.on('folder:changed', () => count++);
    bus.emit('folder:changed', { folder: 'a' });
    expect(count).toBe(1);

    sub.dispose();
    bus.emit('folder:changed', { folder: 'b' });
    expect(count).toBe(1);
  });

  it('should deliver all events to onAny() wildcard subscribers', () => {
    const events: string[] = [];
    bus.onAny(({ event }) => events.push(event));
    bus.emit('folder:changed', { folder: 'inbox' });
    bus.emit('app:ready', {} as Record<string, never>);
    expect(events).toEqual(['folder:changed', 'app:ready']);
  });

  it('should stop delivering to wildcard after dispose()', () => {
    let count = 0;
    const sub = bus.onAny(() => count++);
    bus.emit('app:ready', {} as Record<string, never>);
    expect(count).toBe(1);
    sub.dispose();
    bus.emit('app:ready', {} as Record<string, never>);
    expect(count).toBe(1);
  });

  it('should report correct listenerCount', () => {
    expect(bus.listenerCount('folder:changed')).toBe(0);
    const s1 = bus.on('folder:changed', () => {});
    const s2 = bus.on('folder:changed', () => {});
    expect(bus.listenerCount('folder:changed')).toBe(2);
    s1.dispose();
    expect(bus.listenerCount('folder:changed')).toBe(1);
    s2.dispose();
    expect(bus.listenerCount('folder:changed')).toBe(0);
  });

  it('should clear all listeners', () => {
    bus.on('folder:changed', () => {});
    bus.on('app:ready', () => {});
    bus.onAny(() => {});
    bus.clear();
    expect(bus.listenerCount('folder:changed')).toBe(0);
    expect(bus.listenerCount('app:ready')).toBe(0);
  });

  it('should pass correct payload for email events', () => {
    const email = makeEmail();
    let captured: any = null;
    bus.on('email:selected', (p) => { captured = p; });
    bus.emit('email:selected', { email });
    expect(captured.email.id).toBe('e1');
  });

  it('should handle emit with no listeners without error', () => {
    expect(() => bus.emit('folder:changed', { folder: 'x' })).not.toThrow();
  });
});
