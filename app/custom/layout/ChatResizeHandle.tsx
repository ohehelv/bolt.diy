/**
 * [FORK] Перетаскиваемая граница между чатом и workbench/preview.
 * Меняет CSS-переменные --chat-min-width (ширина колонки чата → ширина workbench)
 * и --chat-max-width (ширина контента/поля ввода). Update-safe: только CSS-переменные
 * на :root, ядро не трогаем. Двойной клик — сброс к значениям по умолчанию.
 */
import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';

const WIDTH_KEY = 'bolt_chat_width';
const MIN_CHAT = 360;
const MIN_WORKBENCH = 420;

function applyWidth(px: number) {
  const root = document.documentElement;
  root.style.setProperty('--chat-min-width', `${px}px`);
  // контент (сообщения и поле ввода) заполняет колонку с небольшим отступом
  root.style.setProperty('--chat-max-width', `${Math.max(320, px - 28)}px`);
}

function resetWidth() {
  const root = document.documentElement;
  root.style.removeProperty('--chat-min-width');
  root.style.removeProperty('--chat-max-width');
  localStorage.removeItem(WIDTH_KEY);
}

export function ChatResizeHandle() {
  const showWorkbench = useStore(workbenchStore.showWorkbench);
  const [isDesktop, setIsDesktop] = useState(false);

  useEffect(() => {
    const onResize = () => setIsDesktop(window.innerWidth >= 1024);
    onResize();
    window.addEventListener('resize', onResize);

    return () => window.removeEventListener('resize', onResize);
  }, []);

  // Применяем сохранённую ширину при загрузке
  useEffect(() => {
    const saved = Number(localStorage.getItem(WIDTH_KEY) || '');

    if (saved && saved >= MIN_CHAT) {
      applyWidth(saved);
    }
  }, []);

  if (!showWorkbench || !isDesktop) {
    return null;
  }

  const clamp = (x: number) => Math.max(MIN_CHAT, Math.min(x, window.innerWidth - MIN_WORKBENCH));

  const onPointerDown = (event: React.PointerEvent) => {
    event.preventDefault();

    const move = (ev: PointerEvent) => applyWidth(clamp(ev.clientX));
    const up = (ev: PointerEvent) => {
      localStorage.setItem(WIDTH_KEY, String(clamp(ev.clientX)));
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      document.body.style.userSelect = '';
    };

    document.body.style.userSelect = 'none';
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  };

  return (
    <div
      data-no-i18n
      onPointerDown={onPointerDown}
      onDoubleClick={resetWidth}
      title="Перетащите, чтобы изменить ширину (двойной клик — сброс)"
      className="fixed top-[calc(var(--header-height)+1.2rem)] bottom-6 z-30 cursor-col-resize group"
      style={{ left: 'var(--workbench-left)', width: '10px', transform: 'translateX(-5px)' }}
    >
      <div className="mx-auto h-full w-0.5 bg-bolt-elements-borderColor group-hover:bg-accent-500 transition-colors" />
    </div>
  );
}
