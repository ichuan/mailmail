import { describe, it, expect } from 'vitest';
import { hasPermission, requirePermission, validatePermissions } from '../../core/permissions';
import type { PluginManifest } from '../../core/plugin-api';

function makeManifest(permissions: PluginManifest['permissions'] = []): PluginManifest {
  return {
    id: 'test-plugin',
    name: 'Test Plugin',
    version: '1.0.0',
    main: 'index.ts',
    permissions,
  };
}

describe('Permissions', () => {
  it('hasPermission returns true when granted', () => {
    const m = makeManifest(['email:read', 'ui:slot']);
    expect(hasPermission(m, 'email:read')).toBe(true);
    expect(hasPermission(m, 'ui:slot')).toBe(true);
  });

  it('hasPermission returns false when not granted', () => {
    const m = makeManifest(['email:read']);
    expect(hasPermission(m, 'email:write')).toBe(false);
    expect(hasPermission(m, 'settings:write')).toBe(false);
  });

  it('requirePermission throws on missing permission', () => {
    const m = makeManifest([]);
    expect(() => requirePermission(m, 'email:read')).toThrow('lacks permission');
  });

  it('requirePermission does not throw when permission is granted', () => {
    const m = makeManifest(['email:read']);
    expect(() => requirePermission(m, 'email:read')).not.toThrow();
  });

  it('validatePermissions returns empty for valid permissions', () => {
    const m = makeManifest(['email:read', 'ui:slot', 'storage:read-write']);
    expect(validatePermissions(m)).toEqual([]);
  });

  it('validatePermissions returns invalid permissions', () => {
    const m = {
      ...makeManifest(),
      permissions: ['email:read', 'nonexistent:perm' as any, 'bad:perm' as any],
    };
    expect(validatePermissions(m)).toEqual(['nonexistent:perm', 'bad:perm']);
  });
});
