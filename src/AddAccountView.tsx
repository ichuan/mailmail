import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMailStore } from './store';
import { X, Lock, PlusCircle } from 'lucide-react';

export default function AddAccountView() {
  const { setView, accounts, setAccounts, setEmails } = useMailStore();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [smtpServer, setSmtpServer] = useState('');
  const [smtpPort, setSmtpPort] = useState(465);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const newAccount = {
        id: crypto.randomUUID(),
        name,
        email,
        imapServer,
        imapPort,
        smtpServer,
        smtpPort,
        username,
        password
      };

      await invoke('add_account', { account: newAccount });

      // Update accounts in store
      setAccounts([...accounts, newAccount]);

      // Fetch initial emails immediately
      const syncedEmails = await invoke<any[]>('sync_inbox', { account: newAccount });
      // Need to import useMailStore setEmails logic. Actually I destructured setAccounts, I should also destructure setEmails
      setEmails(syncedEmails);

      // Go back to inbox
      setView('mail');
    } catch(err: any) {
      setErrorMsg(err.toString());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col pt-8 px-12 text-[#1a1c1c]">
      <div className="flex justify-between items-center mb-10 w-full max-w-4xl mx-auto">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">Add Account</h2>
          <p className="text-[#717783] text-sm">Connect a new IMAP/SMTP mail account to your workspace.</p>
        </div>
        <button onClick={() => setView('mail')} className="p-2 hover:bg-[#f3f3f3] rounded-full text-[#717783] transition-colors"><X size={20} /></button>
      </div>

      <div className="flex-1 w-full max-w-4xl mx-auto">
        <div className="bg-[#fcfcfc] border border-[#f1f1f1] rounded-xl overflow-hidden shadow-sm flex flex-col md:flex-row">
          <div className="w-full md:w-5/12 bg-[#f3f3f3]/50 p-10 flex flex-col justify-between items-start border-r border-[#f1f1f1]">
            <div>
              <PlusCircle className="text-[#004f96] mb-4" size={32} />
              <h2 className="text-2xl font-bold tracking-tight text-[#1a1c1c] leading-tight mb-4">Connect your world.</h2>
              <p className="text-sm text-[#717783] leading-relaxed">
                  Essentialist Mail centralizes your communication into a single, serene environment. Choose your provider to begin.
              </p>
            </div>
          </div>

          <div className="w-full md:w-7/12 p-8 overflow-y-auto">
            <form onSubmit={handleSubmit} className="space-y-4">
              <h3 className="uppercase tracking-widest text-[#717783] font-bold mb-4 text-xs">Configuration</h3>
              {errorMsg && <div className="p-3 bg-red-100/50 text-red-800 rounded-md text-sm border border-red-200">{errorMsg}</div>}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Display Name</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="John Doe" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">Email Address</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="john@example.com" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-2">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">IMAP Server</label>
                  <input type="text" value={imapServer} onChange={e => setImapServer(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="imap.example.com" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">IMAP Port</label>
                  <input type="number" value={imapPort} onChange={e => setImapPort(parseInt(e.target.value))} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="993" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-2">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">SMTP Server</label>
                  <input type="text" value={smtpServer} onChange={e => setSmtpServer(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="smtp.example.com" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">SMTP Port</label>
                  <input type="number" value={smtpPort} onChange={e => setSmtpPort(parseInt(e.target.value))} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="465" />
                </div>
              </div>

              <div className="mt-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">Username</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="john@example.com" />
              </div>

              <div className="mt-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">App Password</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="••••••••••••" />
              </div>

              <button disabled={loading} type="submit" className="w-full mt-6 bg-[#004f96] text-white p-3 rounded-md font-medium text-sm hover:bg-[#003b73] transition-colors disabled:opacity-50">
                {loading ? 'Adding Account...' : 'Connect Account'}
              </button>

            </form>
            <div className="mt-6 flex items-center justify-center gap-2">
              <Lock size={12} className="text-[#717783]" />
              <p className="text-[10px] text-[#717783] uppercase tracking-tighter">Locally Encrypted via App Password</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
