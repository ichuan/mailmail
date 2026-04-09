import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

import { pluginManager } from '../../core/plugin-manager';
import { slotRegistry } from '../../core/slot-registry';
import { eventBus } from '../../core/event-bus';
import themeSwitcherPlugin from '../../plugins/theme-switcher/index';
import themeSwitcherManifest from '../../plugins/theme-switcher/manifest.json';
import type { PluginManifest } from '../../core/plugin-api';

describe('theme-switcher plugin', () => {
  beforeEach(() => {
    pluginManager.destroyAll();
    slotRegistry.clear();
    eventBus.clear();
  });

  it('should register without errors', () => {
    pluginManager.register(themeSwitcherManifest as PluginManifest, themeSwitcherPlugin);
    const list = pluginManager.listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('theme-switcher');
  });

  it('should activate and register sidebar:bottom slot', () => {
    pluginManager.register(themeSwitcherManifest as PluginManifest, themeSwitcherPlugin);
    pluginManager.activate('theme-switcher');
    expect(pluginManager.listPlugins()[0].enabled).toBe(true);
    expect(slotRegistry.getComponents('sidebar:bottom')).toHaveLength(1);
  });

  it('should deactivate and remove slot registration', () => {
    pluginManager.register(themeSwitcherManifest as PluginManifest, themeSwitcherPlugin);
    pluginManager.activate('theme-switcher');
    pluginManager.deactivate('theme-switcher');
    expect(slotRegistry.getComponents('sidebar:bottom')).toHaveLength(0);
  });
});
