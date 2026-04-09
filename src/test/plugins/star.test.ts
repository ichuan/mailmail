import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

import { pluginManager } from '../../core/plugin-manager';
import { slotRegistry } from '../../core/slot-registry';
import { eventBus } from '../../core/event-bus';
import starPlugin from '../../plugins/star/index';
import starManifest from '../../plugins/star/manifest.json';
import type { PluginManifest } from '../../core/plugin-api';

describe('star plugin', () => {
  beforeEach(() => {
    pluginManager.destroyAll();
    slotRegistry.clear();
    eventBus.clear();
  });

  it('should register without errors', () => {
    pluginManager.register(starManifest as PluginManifest, starPlugin);
    const list = pluginManager.listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('star');
  });

  it('should activate and register toolbar:actions slot', () => {
    pluginManager.register(starManifest as PluginManifest, starPlugin);
    pluginManager.activate('star');
    expect(pluginManager.listPlugins()[0].enabled).toBe(true);
    expect(slotRegistry.getComponents('toolbar:actions')).toHaveLength(1);
  });

  it('should deactivate and remove slot registration', () => {
    pluginManager.register(starManifest as PluginManifest, starPlugin);
    pluginManager.activate('star');
    pluginManager.deactivate('star');
    expect(slotRegistry.getComponents('toolbar:actions')).toHaveLength(0);
  });
});
