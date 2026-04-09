
import { useMailStore } from './store';
import { HelpCircle, Bell, Mail, Monitor, Shield, Trash2, KeyRound, Plus, Image, Sun, Moon } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { Slot } from './core/slot-registry';

export default function SettingsView() {
  const { accounts, setAccounts, emails, setEmails, setView, syncLimitDays, setSyncLimitDays, showImages, setShowImages, theme, setTheme } = useMailStore();

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Are you sure you want to completely remove the account '${name}' and all its emails?`)) return;
    try {
      await invoke('delete_account', { id });
      setAccounts(accounts.filter(a => a.id !== id));
      setEmails(emails.filter(e => e.accountId !== id));
    } catch (e) {
      console.error(e);
      alert("Failed to delete account");
    }
  };

  const handleSyncLimitChange = async (days: number) => {
    setSyncLimitDays(days);
    try {
      await invoke('save_setting', { key: 'syncLimitDays', value: String(days) });
    } catch (e) {
      console.error("Failed to persist sync limit:", e);
    }
  };

  const handleShowImagesToggle = async (enabled: boolean) => {
    setShowImages(enabled);
    try {
      await invoke('save_setting', { key: 'showImages', value: String(enabled) });
    } catch (e) {
      console.error('Failed to persist showImages setting:', e);
    }
  };

  const handleThemeToggle = async (newTheme: 'light' | 'dark') => {
    setTheme(newTheme);
    try {
      await invoke('save_setting', { key: 'theme', value: newTheme });
    } catch (e) {
      console.error('Failed to persist theme setting:', e);
    }
  };

  return (
    <div className="w-full h-full flex flex-col pt-8 px-12 text-[var(--c-text)] bg-[var(--c-panel)]">
      <div className="flex justify-between items-center mb-10 w-full max-w-4xl mx-auto">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">Settings</h2>
          <p className="text-[var(--c-text-muted)] text-sm">Manage your mail accounts and environment preferences.</p>
        </div>
        <div className="flex gap-4">
          <button className="p-2 hover:bg-[var(--c-hover)] rounded-full text-[var(--c-text-muted)] transition-colors"><HelpCircle size={20} /></button>
          <button className="p-2 hover:bg-[var(--c-hover)] rounded-full text-[var(--c-text-muted)] transition-colors"><Bell size={20} /></button>
        </div>
      </div>

      <div className="flex-1 w-full max-w-4xl mx-auto space-y-12">
        {/* Account Management section */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold tracking-wider text-[var(--c-text-muted)] uppercase">Account Management</h3>
            <button
              onClick={() => setView('add_account')}
              className="flex items-center gap-1 text-xs font-semibold text-[#004f96] hover:bg-[var(--c-selected)] px-3 py-1.5 rounded-full transition-colors"
            >
              <Plus size={14} /> Add Account
            </button>
          </div>
          <div className="bg-[var(--c-panel)] border border-[var(--c-border)] rounded-xl overflow-hidden shadow-sm">
            {accounts.length === 0 ? (
              <div className="p-8 text-center text-[var(--c-text-muted)] text-sm">No accounts configured.</div>
            ) : (
              accounts.map((acc, i) => (
                  <div key={acc.id} className={`flex items-center justify-between p-4 ${i !== accounts.length - 1 ? 'border-b border-[var(--c-border-subtle)]' : ''}`}>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#d5e3ff] flex items-center justify-center text-[#004f96]">
                      <Mail size={18} />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold">{acc.name}</span>
                      <span className="text-xs text-[var(--c-text-muted)]">{acc.email}</span>
                    </div>
                  </div>
                  <button onClick={() => handleDelete(acc.id, acc.name)} className="p-2 hover:bg-[#f3f3f3] rounded-md text-[#717783] hover:text-red-600 transition-colors">
                    <Trash2 size={16} />
                  </button>
                </div>
              ))
            )}
          </div>
        </section>

        {/* Preferences Section */}
        <section>
           <h3 className="text-xs font-bold tracking-wider text-[var(--c-text-muted)] uppercase mb-4">Preferences</h3>
           <div className="bg-[var(--c-panel)] border border-[var(--c-border)] rounded-xl overflow-hidden shadow-sm">
             <div className="flex items-center justify-between p-4 border-b border-[var(--c-border-subtle)]">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[var(--c-bg)] flex items-center justify-center text-[var(--c-text-mid)]"><Monitor size={18} /></div>
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">IMAP Sync Limit</span>
                    <span className="text-xs text-[var(--c-text-muted)]">Retain local emails up to the selected timeframe.</span>
                  </div>
                </div>
                <select
                  className="bg-[var(--c-panel)] border border-[var(--c-border)] rounded focus:border-[#004f96] flex items-center justify-center px-3 py-1.5 text-sm outline-none cursor-pointer text-[var(--c-text)]"
                  value={syncLimitDays}
                  onChange={(e) => handleSyncLimitChange(Number(e.target.value))}
                >
                  <option value={30}>Last 30 Days</option>
                  <option value={60}>Last 60 Days</option>
                  <option value={90}>Last 90 Days</option>
                </select>
             </div>
             <div className="flex items-center justify-between p-4 border-b border-[var(--c-border-subtle)]">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[var(--c-bg)] flex items-center justify-center text-[var(--c-text-mid)]"><Image size={18} /></div>
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Show Images in Emails</span>
                    <span className="text-xs text-[var(--c-text-muted)]">Display remote images embedded in HTML emails.</span>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={showImages}
                  onClick={() => handleShowImagesToggle(!showImages)}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    showImages ? 'bg-[#004f96]' : 'bg-[#d1d5db]'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      showImages ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
             </div>
             {/* Appearance / theme toggle */}
             <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[var(--c-bg)] flex items-center justify-center text-[var(--c-text-mid)]">
                    {theme === 'dark' ? <Moon size={18} /> : <Sun size={18} />}
                  </div>
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Appearance</span>
                    <span className="text-xs text-[var(--c-text-muted)]">Switch between light and dark theme.</span>
                  </div>
                </div>
                <button
                  role="switch"
                  aria-checked={theme === 'dark'}
                  onClick={() => handleThemeToggle(theme === 'dark' ? 'light' : 'dark')}
                  className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors focus:outline-none ${
                    theme === 'dark' ? 'bg-[#004f96]' : 'bg-[#d1d5db]'
                  }`}
                >
                  <span
                    className={`inline-block h-4 w-4 transform rounded-full bg-white shadow transition-transform ${
                      theme === 'dark' ? 'translate-x-6' : 'translate-x-1'
                    }`}
                  />
                </button>
             </div>
           </div>
        </section>

        {/* Security & Storage info card */}
        <section>
          <h3 className="text-xs font-bold tracking-wider text-[var(--c-text-muted)] uppercase mb-4">Security &amp; Storage</h3>
          <div className="bg-[var(--c-panel)] border border-[var(--c-border)] rounded-xl shadow-sm p-5 space-y-3">
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex-shrink-0 text-[var(--c-text-mid)]"><Shield size={18} /></div>
              <div>
                <p className="text-sm font-medium mb-1">Encrypted in transit</p>
                <p className="text-sm text-[var(--c-text-muted)] leading-relaxed">
                  All connections to your mail server use TLS/SSL. Credentials and email data
                  travel over an encrypted channel directly between this app and your server —
                  no proxy or intermediary involved.
                </p>
              </div>
            </div>
            <div className="border-t border-[var(--c-border-subtle)]" />
            <div className="flex items-start gap-3">
              <div className="mt-0.5 flex-shrink-0 text-[var(--c-text-mid)]"><KeyRound size={18} /></div>
              <div>
                <p className="text-sm font-medium mb-1">Stored locally only</p>
                <p className="text-sm text-[var(--c-text-muted)] leading-relaxed">
                  All email data is cached in a SQLite database on your device only. This app
                  has no backend server and sends nothing to third parties. Your account
                  credentials are stored in your OS keychain or the app data directory and
                  are never transmitted anywhere except to your own mail server.
                </p>
              </div>
            </div>
          </div>
        </section>
        {/* settings:sections slot — plugins can append sections here */}
        <Slot id="settings:sections" />
      </div>
    </div>
  );
}
