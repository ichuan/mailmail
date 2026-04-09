/**
 * Disposable — a handle returned by event subscriptions and registrations.
 * Calling dispose() removes the subscription/registration.
 */
export interface Disposable {
  dispose(): void;
}

/**
 * Map of core events to their payload types.
 * Plugins subscribe via EventBus.on<K>() and get type-safe payloads.
 */
export interface EventMap {
  'email:received':       { emails: import('../store').Email[] };
  'email:before-display': { email: import('../store').Email; html: string };
  'email:selected':       { email: import('../store').Email };
  'email:before-send':    { draft: import('../store').ComposeState; cancel: () => void };
  'email:sent':           { email: import('../store').Email };
  'email:deleted':        { emailId: string };
  'email:moved':          { emailId: string; fromFolder: string; toFolder: string };
  'folder:changed':       { folder: string };
  'account:added':        { account: import('../store').Account };
  'account:removed':      { accountId: string };
  'sync:start':           { accountId: string };
  'sync:complete':        { accountId: string; count: number };
  'compose:open':         { draft?: Partial<import('../store').ComposeState> };
  'compose:close':        Record<string, never>;
  'app:ready':            Record<string, never>;
  'app:before-quit':      Record<string, never>;
  'settings:changed':     { key: string; value: unknown };
}

export type EventName = keyof EventMap;

type Handler<T> = (payload: T) => void;

/**
 * Type-safe publish/subscribe event bus.
 *
 * Core emits events on state changes; plugins subscribe via PluginAPI.on().
 * Handlers are invoked synchronously in registration order.
 * Supports wildcard '*' subscriptions that receive all events.
 */
export class EventBus {
  private listeners = new Map<string, Set<Handler<any>>>();
  private wildcardListeners = new Set<Handler<{ event: string; payload: any }>>();

  /**
   * Subscribe to a typed event. Returns a Disposable to unsubscribe.
   */
  on<K extends EventName>(event: K, handler: Handler<EventMap[K]>): Disposable {
    if (!this.listeners.has(event)) {
      this.listeners.set(event, new Set());
    }
    this.listeners.get(event)!.add(handler);
    return {
      dispose: () => {
        this.listeners.get(event)?.delete(handler);
      },
    };
  }

  /**
   * Subscribe to ALL events (wildcard). Useful for logging/debugging plugins.
   */
  onAny(handler: Handler<{ event: string; payload: any }>): Disposable {
    this.wildcardListeners.add(handler);
    return {
      dispose: () => {
        this.wildcardListeners.delete(handler);
      },
    };
  }

  /**
   * Emit an event. All registered handlers are called synchronously.
   */
  emit<K extends EventName>(event: K, payload: EventMap[K]): void {
    const handlers = this.listeners.get(event);
    if (handlers) {
      for (const handler of handlers) {
        handler(payload);
      }
    }
    for (const handler of this.wildcardListeners) {
      handler({ event, payload });
    }
  }

  /**
   * Remove all listeners. Used during app shutdown or testing.
   */
  clear(): void {
    this.listeners.clear();
    this.wildcardListeners.clear();
  }

  /**
   * Get the count of listeners for a specific event (for testing).
   */
  listenerCount(event: EventName): number {
    return this.listeners.get(event)?.size ?? 0;
  }
}

/** Singleton instance shared across the entire application. */
export const eventBus = new EventBus();
