import type { PluginPermission, PluginManifest } from './plugin-api';
import { PLUGIN_PERMISSIONS } from './plugin-api';

/**
 * Check whether a plugin's manifest grants a specific permission.
 * Called both at activation time (bulk check) and at API call time (per-call check).
 */
export function hasPermission(manifest: PluginManifest, permission: PluginPermission): boolean {
  return manifest.permissions.includes(permission);
}

/**
 * Throw if the plugin does not have the required permission.
 * Used inside PluginAPI method implementations.
 */
export function requirePermission(manifest: PluginManifest, permission: PluginPermission): void {
  if (!hasPermission(manifest, permission)) {
    throw new Error(
      `Plugin "${manifest.id}" lacks permission "${permission}". ` +
      `Add it to the plugin's manifest.json permissions array.`
    );
  }
}

/**
 * Validate that all permissions in a manifest are recognized.
 * Returns an array of invalid permission strings (empty = all valid).
 */
export function validatePermissions(manifest: PluginManifest): string[] {
  const validSet = new Set<string>(PLUGIN_PERMISSIONS as readonly string[]);
  return manifest.permissions.filter(p => !validSet.has(p));
}
