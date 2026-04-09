import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock @tauri-apps/api/core before all imports
vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

// Must import AFTER mock setup
import { pluginManager } from '../../core/plugin-manager';
import { eventBus } from '../../core/event-bus';
import { slotRegistry } from '../../core/slot-registry';
import type { PluginManifest, PluginModule, PluginAPI, PluginContext } from '../../core/plugin-api';

function makeManifest(overrides: Partial<PluginManifest> = {}): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    main: 'index.ts',
    permissions: ['email:read', 'ui:slot', 'settings:read'],
    ...overrides,
  };
}

function makeModule(overrides: Partial<PluginModule> = {}): PluginModule {
  return {
    activate: vi.fn(),
    deactivate: vi.fn(),
    ...overrides,
  };
}

describe('PluginManager', () => {
  beforeEach(() => {
    pluginManager.destroyAll();
    eventBus.clear();
    slotRegistry.clear();
  });

  it('should register a plugin', () => {
    pluginManager.register(makeManifest(), makeModule());
    const list = pluginManager.listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('test-plugin');
    expect(list[0].enabled).toBe(false);
  });

  it('should reject duplicate registration', () => {
    pluginManager.register(makeManifest(), makeModule());
    pluginManager.register(makeManifest(), makeModule());
    expect(pluginManager.listPlugins()).toHaveLength(1);
  });

  it('should reject plugins with invalid permissions', () => {
    const m = makeManifest({
      permissions: ['invalid:perm' as any],
    });
    pluginManager.register(m, makeModule());
    expect(pluginManager.listPlugins()).toHaveLength(0);
  });

  it('should activate a plugin and call activate()', () => {
    const module = makeModule();
    pluginManager.register(makeManifest(), module);
    pluginManager.activate('test-plugin');

    expect(module.activate).toHaveBeenCalledTimes(1);
    expect(pluginManager.listPlugins()[0].enabled).toBe(true);
  });

  it('should not activate twice', () => {
    const module = makeModule();
    pluginManager.register(makeManifest(), module);
    pluginManager.activate('test-plugin');
    pluginManager.activate('test-plugin');
    expect(module.activate).toHaveBeenCalledTimes(1);
  });

  it('should pass PluginAPI with correct methods to activate()', () => {
    let receivedApi: PluginAPI | null = null;
    const module = makeModule({
      activate: (api) => { receivedApi = api; },
    });
    pluginManager.register(makeManifest(), module);
    pluginManager.activate('test-plugin');

    expect(receivedApi).not.toBeNull();
    expect(receivedApi!.on).toBeTypeOf('function');
    expect(receivedApi!.emit).toBeTypeOf('function');
    expect(receivedApi!.emails).toBeDefined();
    expect(receivedApi!.accounts).toBeDefined();
    expect(receivedApi!.settings).toBeDefined();
    expect(receivedApi!.ui).toBeDefined();
    expect(receivedApi!.storage).toBeDefined();
  });

  it('should deactivate and call deactivate()', () => {
    const module = makeModule();
    pluginManager.register(makeManifest(), module);
    pluginManager.activate('test-plugin');
    pluginManager.deactivate('test-plugin');

    expect(module.deactivate).toHaveBeenCalledTimes(1);
    expect(pluginManager.listPlugins()[0].enabled).toBe(false);
  });

  it('should dispose subscriptions on deactivate', () => {
    const disposeSpy = vi.fn();
    const module = makeModule({
      activate: (_api, ctx) => {
        ctx.subscriptions.push({ dispose: disposeSpy });
      },
    });
    pluginManager.register(makeManifest(), module);
    pluginManager.activate('test-plugin');
    pluginManager.deactivate('test-plugin');
    expect(disposeSpy).toHaveBeenCalledTimes(1);
  });

  it('should remove slot registrations on deactivate', () => {
    const Comp = () => null;
    const module = makeModule({
      activate: (api) => {
        api.ui.registerSlot('sidebar:top', Comp);
      },
    });
    const manifest = makeManifest({ permissions: ['email:read', 'ui:slot', 'settings:read'] });
    pluginManager.register(manifest, module);
    pluginManager.activate('test-plugin');
    expect(slotRegistry.getComponents('sidebar:top')).toHaveLength(1);

    pluginManager.deactivate('test-plugin');
    expect(slotRegistry.getComponents('sidebar:top')).toHaveLength(0);
  });

  it('should enforce permission gating on API calls', async () => {
    let api: PluginAPI | null = null;
    const module = makeModule({
      activate: (receivedApi) => { api = receivedApi; },
    });
    // No 'email:write' or 'email:move' permission
    const manifest = makeManifest({ permissions: ['email:read'] });
    pluginManager.register(manifest, module);
    pluginManager.activate('test-plugin');

    // email:read is granted -> should work
    expect(() => api!.emails.getById('e1')).not.toThrow();

    // email:move is NOT granted -> should throw
    await expect(api!.emails.move('e1', 'trash')).rejects.toThrow('lacks permission');
  });

  it('should activateAll and destroyAll', () => {
    const m1 = makeModule();
    const m2 = makeModule();
    pluginManager.register(makeManifest({ id: 'p1' }), m1);
    pluginManager.register(makeManifest({ id: 'p2' }), m2);
    pluginManager.activateAll();

    expect(m1.activate).toHaveBeenCalledTimes(1);
    expect(m2.activate).toHaveBeenCalledTimes(1);

    pluginManager.destroyAll();
    expect(pluginManager.listPlugins()).toHaveLength(0);
  });

  it('should register and retrieve context menu items', () => {
    const module = makeModule({
      activate: (api) => {
        api.ui.registerContextMenuItem('email-list', {
          label: 'Do Something',
          command: 'doSomething',
        });
      },
    });
    const manifest = makeManifest({ permissions: ['ui:context-menu'] });
    pluginManager.register(manifest, module);
    pluginManager.activate('test-plugin');

    const items = pluginManager.getContextMenuItems('email-list');
    expect(items).toHaveLength(1);
    expect(items[0].label).toBe('Do Something');
  });

  it('should register and execute commands', () => {
    const handler = vi.fn();
    const module = makeModule({
      activate: (api) => {
        api.ui.registerCommand('greet', handler);
      },
    });
    const manifest = makeManifest({ permissions: ['ui:command'] });
    pluginManager.register(manifest, module);
    pluginManager.activate('test-plugin');

    pluginManager.executeCommand('test-plugin.greet', 'hello');
    expect(handler).toHaveBeenCalledWith('hello');
  });

  it('should allow plugins to subscribe to events via API', () => {
    const received: string[] = [];
    const module = makeModule({
      activate: (api, ctx) => {
        const sub = api.on('folder:changed', ({ folder }) => {
          received.push(folder);
        });
        ctx.subscriptions.push(sub);
      },
    });
    pluginManager.register(makeManifest(), module);
    pluginManager.activate('test-plugin');

    eventBus.emit('folder:changed', { folder: 'sent' });
    expect(received).toEqual(['sent']);

    pluginManager.deactivate('test-plugin');
    eventBus.emit('folder:changed', { folder: 'trash' });
    // Should NOT receive after deactivation
    expect(received).toEqual(['sent']);
  });
});
