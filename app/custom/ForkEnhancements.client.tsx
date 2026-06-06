/**
 * [FORK] Единая точка монтирования доработок форка (грузится один раз в root.tsx).
 * Сейчас: включение runtime-перевода UI + переключатель языка.
 * Сюда же позже добавим resize-границу чата и т.п.
 */
import { useEffect, useState } from 'react';
import { activateI18n } from './i18n/translator';
import { SetupWizard } from './setup/SetupWizard.client';
import { ChatResizeHandle } from './layout/ChatResizeHandle';
import { TemplateGallery } from './templates/TemplateGallery.client';

const LANG_KEY = 'bolt_lang';

function getLang(): string {
  if (typeof localStorage === 'undefined') {
    return 'ru';
  }

  return localStorage.getItem(LANG_KEY) || 'ru';
}

export function ForkEnhancements() {
  const [lang, setLang] = useState<string>('ru');
  const [setupOpen, setSetupOpen] = useState(false);
  const [templatesOpen, setTemplatesOpen] = useState(false);

  useEffect(() => {
    const current = getLang();
    setLang(current);

    // По умолчанию интерфейс на русском
    if (current === 'ru') {
      activateI18n();
    }

    // Мастер первого запуска (выбор провайдера + ключ API)
    if (!localStorage.getItem('bolt_setup_done')) {
      setSetupOpen(true);
    }
  }, []);

  const toggleLang = () => {
    const next = getLang() === 'ru' ? 'en' : 'ru';
    localStorage.setItem(LANG_KEY, next);
    location.reload();
  };

  const openSettings = () => {
    window.dispatchEvent(new CustomEvent('bolt:open-settings'));
  };

  return (
    <>
      <SetupWizard open={setupOpen} onClose={() => setSetupOpen(false)} />
      <TemplateGallery open={templatesOpen} onClose={() => setTemplatesOpen(false)} />
      <ChatResizeHandle />
      <div data-no-i18n className="fixed bottom-3 right-3 z-50 flex items-center gap-1.5">
        <button
          onClick={() => setTemplatesOpen(true)}
          title="Шаблоны и блоки"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary border border-bolt-elements-borderColor opacity-60 hover:opacity-100 transition-opacity"
        >
          <span className="i-ph:layout w-3.5 h-3.5" /> Шаблоны
        </button>
        <button
          onClick={openSettings}
          title="Настройки"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary border border-bolt-elements-borderColor opacity-60 hover:opacity-100 transition-opacity"
        >
          <span className="i-ph:gear w-3.5 h-3.5" /> Настройки
        </button>
        <button
          onClick={() => setSetupOpen(true)}
          title="Настроить провайдера и ключ API"
          className="flex items-center gap-1 px-2 py-1 rounded-md text-xs bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary border border-bolt-elements-borderColor opacity-60 hover:opacity-100 transition-opacity"
        >
          <span className="i-ph:key w-3.5 h-3.5" /> Ключ API
        </button>
        <button
          onClick={toggleLang}
          title="Сменить язык интерфейса (RU/EN)"
          className="px-2 py-1 rounded-md text-xs bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary border border-bolt-elements-borderColor opacity-60 hover:opacity-100 transition-opacity"
        >
          {lang === 'ru' ? 'RU' : 'EN'}
        </button>
      </div>
    </>
  );
}
