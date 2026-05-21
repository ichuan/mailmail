import { invoke } from '@tauri-apps/api/core';
import { eventBus } from './event-bus';
import type { Disposable, EventName, EventMap } from './event-bus';
import { slotRegistry } from './slot-registry';
import { requirePermission, validatePermissions } from './permissions';
import type {
  PluginManifest,
  PluginModule,
  PluginAPI,
  PluginContext,
  ContextMenuItem,
} from './plugin-api';
import { useMailStore } from '../store';

interface LoadedPlugin {
  manifest: PluginManifest;
  module: PluginModule;
  context: PluginContext;
  enabled: boolean;
}

/**
 * Central plugin lifecycle manager.
 *
 * Responsibilities:
 *   1. Register built-in plugin modules (compiled into the app)
 *   2. Activate / deactivate plugins
 *   3. Build per-plugin PluginAPI with permission gating
 *   4. Manage context-menu items contributed by plugins
 */
class PluginManagerImpl {
  private plugins = new Map<string, LoadedPlugin>();
  private contextMenuItems = new Map<string, Array<ContextMenuItem & { pluginId: string }>>();
  private commands = new Map<string, (...args: any[]) => void>();

  /**
   * Register a plugin module (built-in). Does NOT activate it yet.
   */
  register(manifest: PluginManifest, module: PluginModule): void {
    if (this.plugins.has(manifest.id)) {
      console.warn(`Plugin "${manifest.id}" already registered; skipping.`);
      return;
    }
    const invalid = validatePermissions(manifest);
    if (invalid.length > 0) {
      console.error(`Plugin "${manifest.id}" has invalid permissions: ${invalid.join(', ')}`);
      return;
    }
    this.plugins.set(manifest.id, {
      manifest,
      module,
      context: { manifest, subscriptions: [] },
      enabled: false,
    });
  }

  /**
   * Activate a registered plugin.
   */
  activate(pluginId: string): void {
    const entry = this.plugins.get(pluginId);
    if (!entry) {
      console.error(`Plugin "${pluginId}" not registered.`);
      return;
    }
    if (entry.enabled) return;

    const api = this.buildAPI(entry.manifest);
    entry.module.activate(api, entry.context);
    entry.enabled = true;
  }

  /**
   * Deactivate a plugin — disposes all subscriptions, removes UI registrations.
   */
  deactivate(pluginId: string): void {
    const entry = this.plugins.get(pluginId);
    if (!entry || !entry.enabled) return;

    // Dispose all subscriptions the plugin created
    for (const d of entry.context.subscriptions) {
      d.dispose();
    }
    entry.context.subscriptions = [];

    // Remove slot registrations
    slotRegistry.removeByPlugin(pluginId);

    // Remove context-menu items
    for (const [slot, items] of this.contextMenuItems) {
      this.contextMenuItems.set(slot, items.filter(i => i.pluginId !== pluginId));
    }

    // Remove commands
    for (const [cmdId] of this.commands) {
      if (cmdId.startsWith(`${pluginId}.`)) {
        this.commands.delete(cmdId);
      }
    }

    entry.module.deactivate?.();
    entry.enabled = false;
  }

  /**
   * Activate all registered plugins.
   */
  activateAll(): void {
    for (const [id] of this.plugins) {
      this.activate(id);
    }
  }

  /**
   * Deactivate and unregister all plugins.
   */
  destroyAll(): void {
    for (const [id] of this.plugins) {
      this.deactivate(id);
    }
    this.plugins.clear();
    this.contextMenuItems.clear();
    this.commands.clear();
  }

  /**
   * Get all context-menu items for a given slot.
   */
  getContextMenuItems(slot: string): Array<ContextMenuItem & { pluginId: string }> {
    return this.contextMenuItems.get(slot) ?? [];
  }

  /**
   * Execute a registered command by ID.
   */
  executeCommand(commandId: string, ...args: any[]): void {
    const handler = this.commands.get(commandId);
    if (handler) handler(...args);
  }

  /**
   * Get list of all registered plugins with their status.
   */
  listPlugins(): Array<{ id: string; name: string; enabled: boolean }> {
    return Array.from(this.plugins.values()).map(p => ({
      id: p.manifest.id,
      name: p.manifest.name,
      enabled: p.enabled,
    }));
  }

  /**
   * Build a permission-gated PluginAPI for a specific plugin.
   */
  private buildAPI(manifest: PluginManifest): PluginAPI {
    const self = this;

    return {
      // ── Events ──
      on<K extends EventName>(event: K, handler: (payload: EventMap[K]) => void): Disposable {
        return eventBus.on(event, handler);
      },
      emit<K extends EventName>(event: K, payload: EventMap[K]): void {
        eventBus.emit(event, payload);
      },

      // ── Emails ──
      emails: {
        getById(id: string) {
          requirePermission(manifest, 'email:read');
          return useMailStore.getState().emails.find(e => e.id === id);
        },
        getByFolder(folder: string) {
          requirePermission(manifest, 'email:read');
          return useMailStore.getState().emails.filter(e => e.folder === folder);
        },
        search(query: string) {
          requirePermission(manifest, 'email:read');
          const q = query.toLowerCase();
          return useMailStore.getState().emails.filter(e =>
            e.subject.toLowerCase().includes(q) ||
            e.sender.toLowerCase().includes(q) ||
            (e.bodyText ?? '').toLowerCase().includes(q)
          );
        },
        async move(emailId: string, toFolder: string) {
          requirePermission(manifest, 'email:move');
          // Delegate to backend when move is implemented
          eventBus.emit('email:moved', { emailId, fromFolder: '', toFolder });
        },
        async setMetadata(emailId: string, key: string, value: unknown) {
          requirePermission(manifest, 'email:modify-metadata');
          await invoke('save_setting', { key: `plugin:${manifest.id}:meta:${emailId}:${key}`, value: JSON.stringify(value) });
        },
        async getMetadata(emailId: string, key: string) {
          requirePermission(manifest, 'email:read');
          const raw = await invoke<string | null>('get_setting', { key: `plugin:${manifest.id}:meta:${emailId}:${key}` });
          return raw ? JSON.parse(raw) : null;
        },
      },

      // ── Accounts ──
      accounts: {
        list() {
          requirePermission(manifest, 'account:read');
          return useMailStore.getState().accounts;
        },
        getActive() {
          requirePermission(manifest, 'account:read');
          const state = useMailStore.getState();
          const selectedEmail = state.emails.find(e => e.id === state.selectedEmailId);
          if (selectedEmail) return state.accounts.find(a => a.id === selectedEmail.accountId);
          return state.accounts[0];
        },
      },

      // ── Settings ──
      settings: {
        get(key: string) {
          requirePermission(manifest, 'settings:read');
          return (useMailStore.getState() as any)[key];
        },
        async set(key: string, value: unknown) {
          requirePermission(manifest, 'settings:write');
          await invoke('save_setting', { key: `plugin:${manifest.id}:${key}`, value: JSON.stringify(value) });
          eventBus.emit('settings:changed', { key, value });
        },
        onChanged(key: string, handler: (value: unknown) => void): Disposable {
          requirePermission(manifest, 'settings:read');
          return eventBus.on('settings:changed', (payload) => {
            if (payload.key === key) handler(payload.value);
          });
        },
      },

      // ── UI ──
      ui: {
        registerSlot(slotId: string, component: React.ComponentType<any>): Disposable {
          requirePermission(manifest, 'ui:slot');
          return slotRegistry.register(slotId, manifest.id, component);
        },
        registerContextMenuItem(slot: string, item: ContextMenuItem): Disposable {
          requirePermission(manifest, 'ui:context-menu');
          if (!self.contextMenuItems.has(slot)) {
            self.contextMenuItems.set(slot, []);
          }
          const entry = { ...item, pluginId: manifest.id };
          self.contextMenuItems.get(slot)!.push(entry);
          return {
            dispose: () => {
              const items = self.contextMenuItems.get(slot);
              if (items) {
                const idx = items.indexOf(entry);
                if (idx !== -1) items.splice(idx, 1);
              }
            },
          };
        },
        registerCommand(id: string, handler: (...args: any[]) => void): Disposable {
          requirePermission(manifest, 'ui:command');
          const fullId = id.includes('.') ? id : `${manifest.id}.${id}`;
          self.commands.set(fullId, handler);
          return {
            dispose: () => { self.commands.delete(fullId); },
          };
        },
        showNotification(message: string, type: 'info' | 'warn' | 'error' = 'info') {
          requirePermission(manifest, 'ui:notification');
          // Minimal implementation — can be enhanced with toast UI later
          console.log(`[${manifest.id}][${type}] ${message}`);
        },
        showModal(_component: React.ComponentType<any>): Disposable {
          requirePermission(manifest, 'ui:modal');
          // Placeholder — modal rendering integrated in Phase 2+
          return { dispose: () => {} };
        },
      },

      // ── Storage ──
      storage: {
        async get(key: string) {
          requirePermission(manifest, 'storage:read-write');
          const raw = await invoke<string | null>('get_setting', { key: `plugin:${manifest.id}:store:${key}` });
          return raw ? JSON.parse(raw) : null;
        },
        async set(key: string, value: unknown) {
          requirePermission(manifest, 'storage:read-write');
          await invoke('save_setting', { key: `plugin:${manifest.id}:store:${key}`, value: JSON.stringify(value) });
        },
        async delete(key: string) {
          requirePermission(manifest, 'storage:read-write');
          await invoke('save_setting', { key: `plugin:${manifest.id}:store:${key}`, value: '' });
        },
      },
    };
  }
}

/** Singleton instance. */
export const pluginManager = new PluginManagerImpl();
