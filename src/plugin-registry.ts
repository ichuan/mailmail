import { pluginManager } from './core/plugin-manager';
import imageTogglePlugin from './plugins/image-toggle/index';
import imageToggleManifest from './plugins/image-toggle/manifest.json';
import starPlugin from './plugins/star/index';
import starManifest from './plugins/star/manifest.json';
import signaturePlugin from './plugins/signature/index';
import signatureManifest from './plugins/signature/manifest.json';
import notificationPlugin from './plugins/notification/index';
import notificationManifest from './plugins/notification/manifest.json';
import printPlugin from './plugins/print/index';
import printManifest from './plugins/print/manifest.json';
import type { PluginManifest } from './core/plugin-api';

/**
 * Register and activate all built-in plugins.
 * Called once from App.tsx on initial mount.
 * theme-switcher is intentionally excluded — theme is managed in Settings.
 */
export function initBuiltinPlugins(): void {
  pluginManager.register(imageToggleManifest as PluginManifest, imageTogglePlugin);
  pluginManager.register(starManifest as PluginManifest, starPlugin);
  pluginManager.register(signatureManifest as PluginManifest, signaturePlugin);
  pluginManager.register(notificationManifest as PluginManifest, notificationPlugin);
  pluginManager.register(printManifest as PluginManifest, printPlugin);

  pluginManager.activateAll();
}

/**
 * Deactivate and unregister all plugins.
 * Called on app shutdown.
 */
export function destroyPlugins(): void {
  pluginManager.destroyAll();
}
