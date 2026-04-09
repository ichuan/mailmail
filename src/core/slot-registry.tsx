import React, { useSyncExternalStore, useCallback } from 'react';
import type { Disposable } from './event-bus';

type SlotComponent = React.ComponentType<any>;

interface SlotEntry {
  pluginId: string;
  component: SlotComponent;
  order: number;
}

/**
 * Registry that maps slot IDs to arrays of plugin-contributed React components.
 * Plugins register via PluginAPI.ui.registerSlot(); the <Slot> component
 * renders all components registered to that slot ID.
 */
class SlotRegistryImpl {
  private slots = new Map<string, SlotEntry[]>();
  private version = 0;
  private subscribers = new Set<() => void>();

  /**
   * Register a component into a named slot.
   * Returns a Disposable that removes it.
   */
  register(slotId: string, pluginId: string, component: SlotComponent, order = 0): Disposable {
    if (!this.slots.has(slotId)) {
      this.slots.set(slotId, []);
    }
    const entry: SlotEntry = { pluginId, component, order };
    this.slots.get(slotId)!.push(entry);
    this.slots.get(slotId)!.sort((a, b) => a.order - b.order);
    this.notify();
    return {
      dispose: () => {
        const entries = this.slots.get(slotId);
        if (entries) {
          const idx = entries.indexOf(entry);
          if (idx !== -1) entries.splice(idx, 1);
          this.notify();
        }
      },
    };
  }

  /**
   * Remove all components registered by a specific plugin (used on deactivate).
   */
  removeByPlugin(pluginId: string): void {
    for (const [, entries] of this.slots) {
      for (let i = entries.length - 1; i >= 0; i--) {
        if (entries[i].pluginId === pluginId) entries.splice(i, 1);
      }
    }
    this.notify();
  }

  /**
   * Get all components for a slot. Used by the <Slot> component.
   */
  getComponents(slotId: string): SlotComponent[] {
    return (this.slots.get(slotId) ?? []).map(e => e.component);
  }

  /** useSyncExternalStore subscription helper */
  subscribe(cb: () => void): () => void {
    this.subscribers.add(cb);
    return () => this.subscribers.delete(cb);
  }

  /** useSyncExternalStore snapshot — version number forces re-render. */
  getSnapshot(): number {
    return this.version;
  }

  /** Clear everything (testing). */
  clear(): void {
    this.slots.clear();
    this.notify();
  }

  private notify(): void {
    this.version++;
    for (const cb of this.subscribers) cb();
  }
}

/** Singleton instance. */
export const slotRegistry = new SlotRegistryImpl();

/**
 * <Slot id="sidebar:top" /> — renders all plugin components registered to that slot.
 * Accepts optional `props` that are forwarded to each component.
 */
export function Slot({ id, ...props }: { id: string; [key: string]: any }) {
  const subscribe = useCallback(
    (cb: () => void) => slotRegistry.subscribe(cb),
    [],
  );
  const snapshot = useCallback(() => slotRegistry.getSnapshot(), []);
  useSyncExternalStore(subscribe, snapshot);

  const components = slotRegistry.getComponents(id);
  if (components.length === 0) return null;

  return (
    <>
      {components.map((Component, i) => (
        <Component key={`${id}-${i}`} {...props} />
      ))}
    </>
  );
}
