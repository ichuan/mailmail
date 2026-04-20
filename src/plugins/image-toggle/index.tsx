import { invoke } from '@tauri-apps/api/core';
import { useMailStore } from '../../store';
import type { PluginAPI, PluginContext, PluginModule } from '../../core/plugin-api';
import { ImageOff, Image } from 'lucide-react';
import { useI18n } from '../../i18n';
import { useConfirm } from '../../components/AlertDialog';

/**
 * Toolbar toggle button for showing/hiding images in emails.
 * Placed in the toolbar:actions slot next to Reply/Forward/Delete.
 * Shows a privacy warning when enabling remote images.
 */
function ImageToggleButton() {
  const showImages = useMailStore((s) => s.showImages);
  const setShowImages = useMailStore((s) => s.setShowImages);
  const { t } = useI18n();
  const { confirm } = useConfirm();

  const handleToggle = async () => {
    const next = !showImages;
    // Warn user about privacy implications before enabling remote images
    if (next && !await confirm(t('mail.showImagesWarning'))) return;
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
      title={showImages ? t('mail.hideImages') : t('mail.showImages')}
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
