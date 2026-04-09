import { pluginManager } from './core/plugin-manager';
import themeSwitcherPlugin from './plugins/theme-switcher/index';
import themeSwitcherManifest from './plugins/theme-switcher/manifest.json';
import type { PluginManifest } from './core/plugin-api';

/**
 * Register and activate all built-in plugins.
 * Called once from App.tsx on initial mount.
 */
export function initBuiltinPlugins(): void {
  pluginManager.register(themeSwitcherManifest as PluginManifest, themeSwitcherPlugin);

  pluginManager.activateAll();
}

/**
 * Deactivate and unregister all plugins.
 * Called on app shutdown.
 */
export function destroyPlugins(): void {
  pluginManager.destroyAll();
}
