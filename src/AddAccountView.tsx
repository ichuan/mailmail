import React, { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { useMailStore } from './store';
import type { Email } from './store';
import { X, Lock, PlusCircle, CheckCircle } from 'lucide-react';
import { useI18n } from './i18n';
import { useToast } from './components/Toast';

export default function AddAccountView() {
  const { setView, accounts, setAccounts, mergeEmails } = useMailStore();
  const { t } = useI18n();
  const { toast } = useToast();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [imapServer, setImapServer] = useState('');
  const [imapPort, setImapPort] = useState(993);
  const [smtpServer, setSmtpServer] = useState('');
  const [smtpPort, setSmtpPort] = useState(465);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testOk, setTestOk] = useState<boolean | null>(null);
  const [errorMsg, setErrorMsg] = useState('');

  const buildAccount = () => ({
    id: crypto.randomUUID(),
    name,
    email,
    imapServer,
    imapPort,
    smtpServer,
    smtpPort,
    username,
    password,
  });

  const handleTest = async () => {
    setTesting(true);
    setErrorMsg('');
    setTestOk(null);
    try {
      await invoke('test_connection', { account: buildAccount() });
      setTestOk(true);
    } catch (err: any) {
      setTestOk(false);
      setErrorMsg(err.toString());
    } finally {
      setTesting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setErrorMsg('');
    try {
      const newAccount = buildAccount();

      await invoke('add_account', { account: newAccount });

      // Update accounts in store
      setAccounts([...accounts, newAccount]);

      // Fetch initial emails and merge with existing emails from other accounts
      const syncedEmails = await invoke<Email[]>('sync_inbox', { account: newAccount, limitDays: 30 });
      mergeEmails(syncedEmails);

      toast('success', t('toast.accountAdded'));
      // Go back to inbox
      setView('mail');
    } catch(err: any) {
      setErrorMsg(err.toString());
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="w-full h-full flex flex-col pt-8 px-12 text-[var(--c-text)]">
      <div className="flex justify-between items-center mb-10 w-full max-w-4xl mx-auto">
        <div>
          <h2 className="text-3xl font-bold tracking-tight mb-2">{t('addAccount.title')}</h2>
          <p className="text-[var(--c-text-muted)] text-sm">{t('addAccount.subtitle')}</p>
        </div>
        <button onClick={() => setView('mail')} className="p-2 hover:bg-[var(--c-hover)] rounded-full text-[var(--c-text-muted)] transition-colors"><X size={20} /></button>
      </div>

      <div className="flex-1 w-full max-w-4xl mx-auto">
        <div className="bg-[var(--c-panel)] border border-[var(--c-border)] rounded-xl overflow-hidden shadow-sm flex flex-col md:flex-row">
          <div className="w-full md:w-5/12 bg-[var(--c-bg)] p-10 flex flex-col justify-between items-start border-r border-[var(--c-border)]">
            <div>
              <PlusCircle className="text-[#004f96] mb-4" size={32} />
              <h2 className="text-2xl font-bold tracking-tight text-[var(--c-text)] leading-tight mb-4">{t('addAccount.hero')}</h2>
              <p className="text-sm text-[var(--c-text-muted)] leading-relaxed">
                  {t('addAccount.heroDesc')}
              </p>
            </div>
          </div>

          <div className="w-full md:w-7/12 p-8 overflow-y-auto">
            <form onSubmit={handleSubmit} className="space-y-4">
              <h3 className="uppercase tracking-widest text-[var(--c-text-muted)] font-bold mb-4 text-xs">{t('addAccount.config')}</h3>
              {errorMsg && <div className="p-3 bg-red-100/50 text-red-800 rounded-md text-sm border border-red-200">{errorMsg}</div>}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{t('addAccount.displayName')}</label>
                  <input type="text" value={name} onChange={e => setName(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="John Doe" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{t('addAccount.email')}</label>
                  <input type="email" value={email} onChange={e => setEmail(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="john@example.com" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-2">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{t('addAccount.imapServer')}</label>
                  <input type="text" value={imapServer} onChange={e => setImapServer(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="imap.example.com" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{t('addAccount.imapPort')}</label>
                  <input type="number" value={imapPort} onChange={e => setImapPort(parseInt(e.target.value))} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="993" />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-4 mt-2">
                <div className="col-span-2">
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{t('addAccount.smtpServer')}</label>
                  <input type="text" value={smtpServer} onChange={e => setSmtpServer(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="smtp.example.com" />
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-700 mb-1">{t('addAccount.smtpPort')}</label>
                  <input type="number" value={smtpPort} onChange={e => setSmtpPort(parseInt(e.target.value))} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="465" />
                </div>
              </div>

              <div className="mt-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">{t('addAccount.username')}</label>
                <input type="text" value={username} onChange={e => setUsername(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="john@example.com" />
              </div>

              <div className="mt-2">
                <label className="block text-xs font-semibold text-slate-700 mb-1">{t('addAccount.password')}</label>
                <input type="password" value={password} onChange={e => setPassword(e.target.value)} required className="w-full p-2 border border-slate-300 rounded-md text-sm outline-none focus:border-[#004f96]" placeholder="••••••••••••" />
              </div>

              <button disabled={loading} type="submit" className="w-full mt-2 bg-[#004f96] text-white p-3 rounded-md font-medium text-sm hover:bg-[#003b73] transition-colors disabled:opacity-50">
                {loading ? t('addAccount.adding') : t('addAccount.connect')}
              </button>
              <button
                type="button"
                disabled={testing || !imapServer || !username || !password}
                onClick={handleTest}
                className="w-full mt-2 border border-[#004f96] text-[#004f96] p-2.5 rounded-md font-medium text-sm hover:bg-[#004f96]/5 transition-colors disabled:opacity-40 flex items-center justify-center gap-2"
              >
                {testing ? t('addAccount.testing') : testOk === true ? <><CheckCircle size={14} className="text-green-600" /> {t('addAccount.connectionOk')}</> : t('addAccount.testConnection')}
              </button>

            </form>
            <div className="mt-6 flex items-center justify-center gap-2">
              <Lock size={12} className="text-[#717783]" />
              <p className="text-[10px] text-[#717783] uppercase tracking-tighter">{t('addAccount.localEncrypted')}</p>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
