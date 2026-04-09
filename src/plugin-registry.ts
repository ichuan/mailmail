import { pluginManager } from './core/plugin-manager';
import imageTogglePlugin from './plugins/image-toggle/index';
import imageToggleManifest from './plugins/image-toggle/manifest.json';
import type { PluginManifest } from './core/plugin-api';

/**
 * Register and activate all built-in plugins.
 * Called once from App.tsx on initial mount.
 * theme-switcher is intentionally excluded — theme is managed in Settings.
 */
export function initBuiltinPlugins(): void {
  pluginManager.register(imageToggleManifest as PluginManifest, imageTogglePlugin);

  pluginManager.activateAll();
}

/**
 * Deactivate and unregister all plugins.
 * Called on app shutdown.
 */
export function destroyPlugins(): void {
  pluginManager.destroyAll();
}
