import { describe, it, expect, beforeEach, vi } from 'vitest';

// Mock the Notification API (not available in test environment)
const NotificationMock = vi.fn();
Object.defineProperty(globalThis, 'Notification', {
  value: Object.assign(NotificationMock, { permission: 'granted', requestPermission: vi.fn().mockResolvedValue('granted') }),
  writable: true,
  configurable: true,
});

vi.mock('@tauri-apps/api/core', () => ({
  invoke: vi.fn().mockResolvedValue(null),
}));

import { pluginManager } from '../../core/plugin-manager';
import { slotRegistry } from '../../core/slot-registry';
import { eventBus } from '../../core/event-bus';
import notificationPlugin from '../../plugins/notification/index';
import notificationManifest from '../../plugins/notification/manifest.json';
import type { PluginManifest } from '../../core/plugin-api';
import type { Email } from '../../store';

function makeEmail(overrides: Partial<Email> = {}): Email {
  return {
    id: 'test_inbox_1',
    uid: 1,
    sender: 'Alice',
    senderEmail: 'alice@example.com',
    recipient: 'me@example.com',
    subject: 'Hello',
    preview: 'Hi there',
    timestamp: new Date().toISOString(),
    read: false,
    starred: false,
    folder: 'inbox',
    accountId: 'acc1',
    ...overrides,
  };
}

describe('notification plugin', () => {
  beforeEach(() => {
    pluginManager.destroyAll();
    slotRegistry.clear();
    eventBus.clear();
    NotificationMock.mockClear();
  });

  it('should register without errors', () => {
    pluginManager.register(notificationManifest as PluginManifest, notificationPlugin);
    const list = pluginManager.listPlugins();
    expect(list).toHaveLength(1);
    expect(list[0].id).toBe('notification');
  });

  it('should activate and listen for email:received events', () => {
    pluginManager.register(notificationManifest as PluginManifest, notificationPlugin);
    pluginManager.activate('notification');
    expect(pluginManager.listPlugins()[0].enabled).toBe(true);

    // Emit a new email event
    eventBus.emit('email:received', { emails: [makeEmail()] });
    expect(NotificationMock).toHaveBeenCalledTimes(1);
    expect(NotificationMock).toHaveBeenCalledWith('New email', expect.objectContaining({ body: 'Alice: Hello' }));
  });

  it('should deactivate and stop showing notifications', () => {
    pluginManager.register(notificationManifest as PluginManifest, notificationPlugin);
    pluginManager.activate('notification');
    pluginManager.deactivate('notification');

    eventBus.emit('email:received', { emails: [makeEmail()] });
    expect(NotificationMock).not.toHaveBeenCalled();
  });
});
