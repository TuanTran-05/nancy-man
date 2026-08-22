import { createContext, useContext, useState, useEffect, createElement, ReactNode } from 'react';
import { translations } from './translations';
import { createLocalizer, type Language, type Localizer } from './localize';

interface LanguageContextType {
  language: Language;
  setLanguage: (lang: Language) => void;
  tr: Localizer;
  t: (typeof translations)['vi'];
}

const LanguageContext = createContext<LanguageContextType | null>(null);

export function LanguageProvider({ children }: { children: ReactNode }) {
  const [language, setLanguageState] = useState<Language>(
    (localStorage.getItem('language') as Language) || 'vi'
  );

  useEffect(() => {
    const handleLanguageChange = () => {
      setLanguageState((localStorage.getItem('language') as Language) || 'vi');
    };
    window.addEventListener('language-change', handleLanguageChange);
    return () => window.removeEventListener('language-change', handleLanguageChange);
  }, []);

  const setLanguage = (lang: Language) => {
    localStorage.setItem('language', lang);
    setLanguageState(lang);
    window.dispatchEvent(new Event('language-change'));
  };

  const t = translations[language];
  const tr = createLocalizer(language);

  return createElement(
    LanguageContext.Provider,
    { value: { language, setLanguage, tr, t } },
    children
  );
}

export function useLanguage() {
  const context = useContext(LanguageContext);
  if (!context) {
    const lang = (localStorage.getItem('language') as Language) || 'vi';
    return {
      language: lang,
      setLanguage: (l: Language) => {
        localStorage.setItem('language', l);
        window.dispatchEvent(new Event('language-change'));
      },
      tr: createLocalizer(lang),
      t: translations[lang],
    };
  }
  return context;
}
