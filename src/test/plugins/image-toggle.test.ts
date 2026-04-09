import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

import { pluginManager } from '../../core/plugin-manager';
import { slotRegistry } from '../../core/slot-registry';
import { eventBus } from '../../core/event-bus';
import imageTogglePlugin from '../../plugins/image-toggle/index';
import imageToggleManifest from '../../plugins/image-toggle/manifest.json';
import type { PluginManifest } from '../../core/plugin-api';

describe('image-toggle plugin', () => {
  beforeEach(() => {
    pluginManager.destroyAll();
    slotRegistry.clear();
    eventBus.clear();
  });

  it('should register without errors', () => {
    pluginManager.register(imageToggleManifest as PluginManifest, imageTogglePlugin);
    const list = pluginManager.listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('image-toggle');
  });

  it('should activate and register toolbar:actions slot', () => {
    pluginManager.register(imageToggleManifest as PluginManifest, imageTogglePlugin);
    pluginManager.activate('image-toggle');
    expect(pluginManager.listPlugins()[0].enabled).toBe(true);
    expect(slotRegistry.getComponents('toolbar:actions')).toHaveLength(1);
  });

  it('should deactivate and remove slot registration', () => {
    pluginManager.register(imageToggleManifest as PluginManifest, imageTogglePlugin);
    pluginManager.activate('image-toggle');
    pluginManager.deactivate('image-toggle');
    expect(slotRegistry.getComponents('toolbar:actions')).toHaveLength(0);
  });
});
