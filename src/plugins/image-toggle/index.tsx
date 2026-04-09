import { invoke } from '@tauri-apps/api/core';
import { useMailStore } from '../../store';
import type { PluginAPI, PluginContext, PluginModule } from '../../core/plugin-api';
import { ImageOff, Image } from 'lucide-react';

/**
 * Toolbar toggle button for showing/hiding images in emails.
 * Placed in the toolbar:actions slot next to Reply/Forward/Delete.
 */
function ImageToggleButton() {
  const showImages = useMailStore((s) => s.showImages);
  const setShowImages = useMailStore((s) => s.setShowImages);

  const handleToggle = async () => {
    const next = !showImages;
    setShowImages(next);
    try {
      await invoke('save_setting', { key: 'showImages', value: String(next) });
    } catch (e) {
      console.error('Failed to persist showImages:', e);
    }
  };

  return (
    <button
      onClick={handleToggle}
      className="p-2 hover:bg-[var(--c-hover)] rounded-md transition-colors text-[var(--c-text-mid)]"
      title={showImages ? 'Hide images' : 'Show images'}
    >
      {showImages ? <Image size={18} /> : <ImageOff size={18} />}
    </button>
  );
}

const imageTogglePlugin: PluginModule = {
  activate(api: PluginAPI, ctx: PluginContext) {
    const disposable = api.ui.registerSlot('toolbar:actions', ImageToggleButton);
    ctx.subscriptions.push(disposable);
  },

  deactivate() {
    // Cleanup handled by ctx.subscriptions disposal
  },
};

export default imageTogglePlugin;
