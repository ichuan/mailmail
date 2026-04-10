import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

vi.mock('date-fns', () => ({
  format: vi.fn().mockReturnValue('Mon, Jan 1, 2024 12:00 PM'),
}));

import { pluginManager } from '../../core/plugin-manager';
import { slotRegistry } from '../../core/slot-registry';
import { eventBus } from '../../core/event-bus';
import printPlugin from '../../plugins/print/index';
import printManifest from '../../plugins/print/manifest.json';
import type { PluginManifest } from '../../core/plugin-api';

describe('print plugin', () => {
  beforeEach(() => {
    pluginManager.destroyAll();
    slotRegistry.clear();
    eventBus.clear();
  });

  it('should register without errors', () => {
    pluginManager.register(printManifest as PluginManifest, printPlugin);
    const list = pluginManager.listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('print');
  });

  it('should activate and register toolbar:actions slot', () => {
    pluginManager.register(printManifest as PluginManifest, printPlugin);
    pluginManager.activate('print');
    expect(pluginManager.listPlugins()[0].enabled).toBe(true);
    expect(slotRegistry.getComponents('toolbar:actions')).toHaveLength(1);
  });

  it('should deactivate and remove slot registration', () => {
    pluginManager.register(printManifest as PluginManifest, printPlugin);
    pluginManager.activate('print');
    pluginManager.deactivate('print');
    expect(slotRegistry.getComponents('toolbar:actions')).toHaveLength(0);
  });
});
