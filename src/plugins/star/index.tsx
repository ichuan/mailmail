import { invoke } from '@tauri-apps/api/core';
import { useMailStore } from '../../store';
import type { PluginAPI, PluginContext, PluginModule } from '../../core/plugin-api';
import type { Email } from '../../store';
import { Star } from 'lucide-react';

/**
 * Toolbar star button for the currently selected email.
 * Rendered in the toolbar:actions slot inside the reading pane.
 */
function StarButton({ email }: { email?: Email }) {
  const toggleStar = useMailStore((s) => s.toggleStar);

  if (!email) return null;

  const handleClick = async () => {
    const next = !email.starred;
    toggleStar(email.id, next);
    try {
      await invoke('toggle_star', { id: email.id, starred: next });
    } catch (e) {
      // Roll back optimistic update on failure
      toggleStar(email.id, email.starred);
      console.error('Failed to toggle star:', e);
    }
  };

  return (
    <button
      onClick={handleClick}
      className="p-2 hover:bg-[var(--c-hover)] rounded-md transition-colors"
      title={email.starred ? 'Remove star' : 'Star this email'}
    >
      <Star
        size={18}
        className={email.starred ? 'text-yellow-400 fill-yellow-400' : 'text-[var(--c-text-mid)]'}
      />
    </button>
  );
}

const starPlugin: PluginModule = {
  activate(api: PluginAPI, ctx: PluginContext) {
    ctx.subscriptions.push(api.ui.registerSlot('toolbar:actions', StarButton));
  },

  deactivate() {},
};

export default starPlugin;
