import { describe, it, expect, beforeEach, vi } from 'vitest';

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue([]),
}));

import { pluginManager } from '../../core/plugin-manager';
import { slotRegistry } from '../../core/slot-registry';
import { eventBus } from '../../core/event-bus';
import signaturePlugin from '../../plugins/signature/index';
import signatureManifest from '../../plugins/signature/manifest.json';
import type { PluginManifest } from '../../core/plugin-api';

describe('signature plugin', () => {
  beforeEach(() => {
    pluginManager.destroyAll();
    slotRegistry.clear();
    eventBus.clear();
  });

  it('should register without errors', () => {
    pluginManager.register(signatureManifest as PluginManifest, signaturePlugin);
    const list = pluginManager.listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('signature');
  });

  it('should activate and register compose:footer and settings:sections slots', () => {
    pluginManager.register(signatureManifest as PluginManifest, signaturePlugin);
    pluginManager.activate('signature');
    expect(pluginManager.listPlugins()[0].enabled).toBe(true);
    expect(slotRegistry.getComponents('compose:footer')).toHaveLength(1);
    expect(slotRegistry.getComponents('settings:sections')).toHaveLength(1);
  });

  it('should deactivate and remove all slot registrations', () => {
    pluginManager.register(signatureManifest as PluginManifest, signaturePlugin);
    pluginManager.activate('signature');
    pluginManager.deactivate('signature');
    expect(slotRegistry.getComponents('compose:footer')).toHaveLength(0);
    expect(slotRegistry.getComponents('settings:sections')).toHaveLength(0);
  });
});
