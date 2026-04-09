import { invoke } from '@tauri-apps/api/core';
import { useMailStore } from '../../store';
import type { PluginAPI, PluginContext, PluginModule } from '../../core/plugin-api';
import { Sun, Moon } from 'lucide-react';

/**
 * Sidebar theme toggle button rendered in the sidebar:bottom slot.
 */
function ThemeToggleButton() {
  const theme = useMailStore((s) => s.theme);
  const setTheme = useMailStore((s) => s.setTheme);

  const handleToggle = async () => {
    const next = theme === 'dark' ? 'light' : 'dark';
    setTheme(next);
    try {
      await invoke('save_setting', { key: 'theme', value: next });
    } catch (e) {
      console.error('Failed to persist theme:', e);
    }
  };

  return (
    <button
      onClick={handleToggle}
      className="w-full flex items-center px-3 py-2 mx-2 rounded-md text-sm text-[var(--c-text-mid)] hover:bg-[var(--c-hover)] hover:text-[var(--c-text)] transition-colors"
      style={{ width: 'calc(100% - 16px)' }}
      title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}
    >
      <span className="mr-3 flex-shrink-0 opacity-80">
        {theme === 'dark' ? <Sun size={16} /> : <Moon size={16} />}
      </span>
      <span className="truncate flex-1">
        {theme === 'dark' ? 'Light Mode' : 'Dark Mode'}
      </span>
    </button>
  );
}

const themeSwitcherPlugin: PluginModule = {
  activate(api: PluginAPI, ctx: PluginContext) {
    const disposable = api.ui.registerSlot('sidebar:bottom', ThemeToggleButton);
    ctx.subscriptions.push(disposable);
  },

  deactivate() {
    // Cleanup handled by ctx.subscriptions disposal
  },
};

export default themeSwitcherPlugin;
