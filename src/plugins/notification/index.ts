import type { PluginAPI, PluginContext, PluginModule } from '../../core/plugin-api';

/**
 * NotificationPlugin — requests permission to show desktop notifications
 * and listens on the `email:received` EventBus event, emitted by App.tsx
 * whenever a background sync detects genuinely new (unread) emails.
 *
 * Uses the standard Web Notifications API (available in WebView2 / WebKit),
 * which requires no additional Tauri plugins or Cargo dependencies.
 */

function requestPermissionIfNeeded(): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission === 'default') {
    // Non-blocking — result is picked up automatically on next notification attempt.
    Notification.requestPermission().catch(() => {});
  }
}

function showNotification(count: number, sender: string, subject: string): void {
  if (typeof Notification === 'undefined') return;
  if (Notification.permission !== 'granted') return;

  const title = count === 1 ? 'New email' : `${count} new emails`;
  const body = count === 1 ? `${sender}: ${subject}` : `Latest: ${sender}: ${subject}`;

  try {
    new Notification(title, { body, silent: false });
  } catch (e) {
    // Some environments (e.g. sandboxed webviews) throw on Notification construction.
    console.warn('[notification plugin] Could not show notification:', e);
  }
}

const notificationPlugin: PluginModule = {
  activate(api: PluginAPI, ctx: PluginContext) {
    requestPermissionIfNeeded();

    ctx.subscriptions.push(
      api.on('email:received', ({ emails }) => {
        if (!emails || emails.length === 0) return;
        const latest = emails[0];
        showNotification(emails.length, latest.sender, latest.subject);
      })
    );
  },

  deactivate() {},
};

export default notificationPlugin;
