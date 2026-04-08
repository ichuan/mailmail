
import { useMailStore } from './store';
import { HelpCircle, Bell, Mail, Monitor, Shield, Trash2, KeyRound, Plus, Image } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

export default function SettingsView() {
  const { accounts, setAccounts, emails, setEmails, setView, syncLimitDays, setSyncLimitDays, showImages, setShowImages } = useMailStore();

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

  return (
    <div className="w-full h-full flex flex-col pt-8 px-12 text-[#1a1c1c]">
      <div className="flex justify-between items-center mb-10 w-full max-w-4xl mx-auto">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">Settings</h2>
          <p className="text-[#717783] text-sm">Manage your mail accounts and environment preferences.</p>
        </div>
        <div className="flex gap-4">
          <button className="p-2 hover:bg-[#f3f3f3] rounded-full text-[#717783] transition-colors"><HelpCircle size={20} /></button>
          <button className="p-2 hover:bg-[#f3f3f3] rounded-full text-[#717783] transition-colors"><Bell size={20} /></button>
        </div>
      </div>

      <div className="flex-1 w-full max-w-4xl mx-auto space-y-12">
        {/* Account Management section */}
        <section>
          <div className="flex justify-between items-center mb-4">
            <h3 className="text-xs font-bold tracking-wider text-[#717783] uppercase">Account Management</h3>
            <button
              onClick={() => setView('add_account')}
              className="flex items-center gap-1 text-xs font-semibold text-[#004f96] hover:bg-[#d5e3ff] px-3 py-1.5 rounded-full transition-colors"
            >
              <Plus size={14} /> Add Account
            </button>
          </div>
          <div className="bg-[#fcfcfc] border border-[#f1f1f1] rounded-xl overflow-hidden shadow-sm">
            {accounts.length === 0 ? (
              <div className="p-8 text-center text-[#717783] text-sm">No accounts configured.</div>
            ) : (
              accounts.map((acc, i) => (
                <div key={acc.id} className={`flex items-center justify-between p-4 ${i !== accounts.length - 1 ? 'border-b border-[#f1f1f1]' : ''}`}>
                  <div className="flex items-center gap-4">
                    <div className="w-10 h-10 rounded-full bg-[#d5e3ff] flex items-center justify-center text-[#004f96]">
                      <Mail size={18} />
                    </div>
                    <div className="flex flex-col">
                      <span className="font-semibold">{acc.name}</span>
                      <span className="text-xs text-[#717783]">{acc.email}</span>
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
           <h3 className="text-xs font-bold tracking-wider text-[#717783] uppercase mb-4">Preferences</h3>
           <div className="bg-[#fcfcfc] border border-[#f1f1f1] rounded-xl overflow-hidden shadow-sm">
             <div className="flex items-center justify-between p-4 border-b border-[#f1f1f1]">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[#f3f3f3] flex items-center justify-center text-[#414752]"><Monitor size={18} /></div>
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">IMAP Sync Limit</span>
                    <span className="text-xs text-[#717783]">Retain local emails up to the selected timeframe.</span>
                  </div>
                </div>
                <select
                  className="bg-white border border-[#e2e2e2] rounded focus:border-[#004f96] flex items-center justify-center px-3 py-1.5 text-sm outline-none cursor-pointer"
                  value={syncLimitDays}
                  onChange={(e) => handleSyncLimitChange(Number(e.target.value))}
                >
                  <option value={30}>Last 30 Days</option>
                  <option value={60}>Last 60 Days</option>
                  <option value={90}>Last 90 Days</option>
                </select>
             </div>
             <div className="flex items-center justify-between p-4">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[#f3f3f3] flex items-center justify-center text-[#414752]"><Image size={18} /></div>
                  <div className="flex flex-col">
                    <span className="font-medium text-sm">Show Images in Emails</span>
                    <span className="text-xs text-[#717783]">Display remote images embedded in HTML emails.</span>
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
           </div>
        </section>

        {/* Security Section (Placeholder) */}
        <section>
           <h3 className="text-xs font-bold tracking-wider text-[#717783] uppercase mb-4">Security & Storage</h3>
           <div className="bg-[#fcfcfc] border border-[#f1f1f1] rounded-xl overflow-hidden shadow-sm">
              <div className="flex items-center justify-between p-4 border-b border-[#f1f1f1] cursor-pointer hover:bg-[#f3f3f3] transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[#f3f3f3] flex items-center justify-center text-[#414752]"><Shield size={18} /></div>
                  <span className="font-medium text-sm">Privacy Options</span>
                </div>
              </div>
              <div className="flex items-center justify-between p-4 cursor-pointer hover:bg-[#f3f3f3] transition-colors">
                <div className="flex items-center gap-4">
                  <div className="w-10 h-10 rounded-full bg-[#f3f3f3] flex items-center justify-center text-[#414752]"><KeyRound size={18} /></div>
                  <span className="font-medium text-sm">Data Encryption</span>
                </div>
              </div>
           </div>
        </section>
      </div>
    </div>
  );
}
