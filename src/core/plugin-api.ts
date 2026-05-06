import type { Disposable, EventName, EventMap } from './event-bus';
import type { Email, Account } from '../store';

/**
 * Permissions that a plugin can request via manifest.json.
 * PluginManager validates these at activation time;
 * PluginAPI methods recheck at call time.
 */
export const PLUGIN_PERMISSIONS = [
  'email:read',
  'email:write',
  'email:move',
  'email:delete',
  'email:modify-metadata',
  'account:read',
  'settings:read',
  'settings:write',
  'ui:slot',
  'ui:context-menu',
  'ui:command',
  'ui:notification',
  'ui:modal',
  'storage:read-write',
] as const;

export type PluginPermission = (typeof PLUGIN_PERMISSIONS)[number];

/**
 * Plugin manifest — corresponds to the plugin's manifest.json.
 */
export interface PluginManifest {
  id: string;
  name: string;
  version: string;
  description?: string;
  author?: string;
  main: string;
  permissions: PluginPermission[];
  hooks?: EventName[];
  settings?: Record<string, PluginSettingDef>;
  contributes?: {
    contextMenu?: Array<{
      slot: string;
      label: string;
      command: string;
    }>;
  };
}

export interface PluginSettingDef {
  type: 'string' | 'number' | 'boolean' | 'range' | 'select';
  default?: unknown;
  label?: string;
  min?: number;
  max?: number;
  options?: Array<{ label: string; value: string }>;
}

/**
 * Plugin context provided to activate(). Owns subscription lifecycle.
 */
export interface PluginContext {
  /** Plugin's manifest copy (read-only). */
  manifest: Readonly<PluginManifest>;
  /** Push Disposables here; they are auto-disposed when the plugin deactivates. */
  subscriptions: Disposable[];
}

/**
 * A context menu item contributed by a plugin.
 */
export interface ContextMenuItem {
  label: string;
  command: string;
  /** If true, renders as destructive/red. */
  danger?: boolean;
  /** Optional icon name from lucide-react. */
  icon?: string;
}

/**
 * The public API surface exposed to plugins via activate(api, ctx).
 * All methods that access data are gated by permissions.
 */
export interface PluginAPI {
  // ── Events ──
  on<K extends EventName>(event: K, handler: (payload: EventMap[K]) => void): Disposable;
  emit<K extends EventName>(event: K, payload: EventMap[K]): void;

  // ── Emails (requires email:read / email:write / email:move / email:delete) ──
  emails: {
    getById(id: string): Email | undefined;
    getByFolder(folder: string): Email[];
    search(query: string): Email[];
    move(emailId: string, toFolder: string): Promise<void>;
    setMetadata(emailId: string, key: string, value: unknown): Promise<void>;
    getMetadata(emailId: string, key: string): Promise<unknown>;
  };

  // ── Accounts (requires account:read) ──
  accounts: {
    list(): Account[];
    getActive(): Account | undefined;
  };

  // ── Settings (requires settings:read / settings:write) ──
  settings: {
    get(key: string): unknown;
    set(key: string, value: unknown): Promise<void>;
    onChanged(key: string, handler: (value: unknown) => void): Disposable;
  };

  // ── UI (requires ui:* permissions) ──
  ui: {
    registerSlot(slotId: string, component: React.ComponentType<any>): Disposable;
    registerContextMenuItem(slot: string, item: ContextMenuItem): Disposable;
    registerCommand(id: string, handler: (...args: any[]) => void): Disposable;
    showNotification(message: string, type?: 'info' | 'warn' | 'error'): void;
    showModal(component: React.ComponentType<any>): Disposable;
  };

  // ── Storage (requires storage:read-write) ──
  storage: {
    get(key: string): Promise<unknown>;
    set(key: string, value: unknown): Promise<void>;
    delete(key: string): Promise<void>;
  };
}

/**
 * A plugin module must export these two functions.
 */
export interface PluginModule {
  activate(api: PluginAPI, ctx: PluginContext): void;
  deactivate?(): void;
}
