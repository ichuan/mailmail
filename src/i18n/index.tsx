import { createContext, useContext, useState, useCallback, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import en from './locales/en.json';
import zhCN from './locales/zh-CN.json';

export type Locale = 'en' | 'zh-CN';

const MESSAGES: Record<Locale, Record<string, string>> = {
  'en': en,
  'zh-CN': zhCN,
};

/**
 * Detect the user's preferred locale from the browser's navigator.language.
 * Maps zh-CN, zh-TW, zh, etc. to 'zh-CN'; everything else falls back to 'en'.
 */
function detectSystemLocale(): Locale {
  const lang = navigator.language || 'en';
  if (lang.startsWith('zh')) return 'zh-CN';
  return 'en';
}

interface I18nContextValue {
  locale: Locale;
  setLocale: (locale: Locale) => void;
  t: (key: string, params?: Record<string, string | number>) => string;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'en',
  setLocale: () => {},
  t: (key) => key,
});

export function useI18n() {
  return useContext(I18nContext);
}

export function I18nProvider({ children }: { children: React.ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectSystemLocale);

  // Load persisted locale on mount
  useEffect(() => {
    invoke<string | null>('get_setting', { key: 'locale' })
      .then(saved => {
        if (saved === 'en' || saved === 'zh-CN') {
          setLocaleState(saved);
        }
      })
      .catch(() => { /* no saved locale, use system default */ });
  }, []);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    invoke('save_setting', { key: 'locale', value: next }).catch(console.error);
  }, []);

  const t = useCallback((key: string, params?: Record<string, string | number>): string => {
    let msg = MESSAGES[locale]?.[key] ?? MESSAGES['en']?.[key] ?? key;
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        msg = msg.replace(new RegExp(`\\{${k}\\}`, 'g'), String(v));
      }
    }
    return msg;
  }, [locale]);

  return (
    <I18nContext value={{ locale, setLocale, t }}>
      {children}
    </I18nContext>
  );
}
