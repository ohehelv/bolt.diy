/**
 * [FORK] Галерея шаблонов сайтов и вставляемых блоков.
 * Клик по карточке отправляет в чат готовый промпт (через событие bolt:send-prompt),
 * который слушает Chat.client.tsx. Update-safe: ядро почти не трогаем.
 */
import { useState } from 'react';

interface GalleryItem {
  id: string;
  title: string;
  description: string;
  icon: string;
  prompt: string;
}

const BASE =
  'Используй современный адаптивный стек: React + Vite + Tailwind CSS. Сделай аккуратный продуманный дизайн, светлую и тёмную темы, плавные анимации, доступность (WCAG), семантическую разметку. Запусти dev-сервер для предпросмотра.';

const TEMPLATES: GalleryItem[] = [
  {
    id: 'landing',
    title: 'Лендинг',
    description: 'Одностраничник с hero, преимуществами, ценами, FAQ и формой',
    icon: 'i-ph:rocket-launch',
    prompt: `Создай современный одностраничный лендинг. Секции: навбар, hero с крупным заголовком, подзаголовком и кнопкой призыва к действию, блок преимуществ (3–4 карточки с иконками), отзывы, тарифы, FAQ-аккордеон, форма обратной связи и футер. ${BASE}`,
  },
  {
    id: 'portfolio',
    title: 'Портфолио',
    description: 'Личный сайт-портфолио с проектами и контактами',
    icon: 'i-ph:user-circle',
    prompt: `Создай сайт-портфолио: hero с фото/аватаром и кратким описанием, секция «Обо мне», сетка проектов с карточками и тегами, навыки, отзывы и контакты с формой. ${BASE}`,
  },
  {
    id: 'blog',
    title: 'Блог',
    description: 'Блог со списком статей, тегами и страницей поста',
    icon: 'i-ph:article',
    prompt: `Создай блог: главная со списком статей (карточки с обложкой, заголовком, датой и тегами), страница отдельного поста, фильтр по тегам, поиск и адаптивная типографика. Наполни демо-контентом. ${BASE}`,
  },
  {
    id: 'shop',
    title: 'Магазин',
    description: 'Витрина интернет-магазина с товарами и корзиной',
    icon: 'i-ph:shopping-cart',
    prompt: `Создай витрину интернет-магазина: каталог товаров (карточки с фото, ценой, рейтингом), фильтры и поиск, страница товара, корзина и оформление заказа (без реальной оплаты). Состояние корзины в localStorage. Наполни демо-товарами. ${BASE}`,
  },
  {
    id: 'dashboard',
    title: 'Дашборд / админка',
    description: 'Панель с метриками, графиками и таблицей',
    icon: 'i-ph:chart-line',
    prompt: `Создай админ-дашборд: боковое меню, верхняя панель, карточки метрик, графики (chart.js), таблица данных с сортировкой и пагинацией, демо-данные. ${BASE}`,
  },
  {
    id: 'saas',
    title: 'SaaS-лендинг',
    description: 'Продающая страница SaaS с тарифами и интеграциями',
    icon: 'i-ph:cloud',
    prompt: `Создай продающий лендинг SaaS-продукта: hero со скриншотом, секции возможностей, как это работает, логотипы клиентов, тарифы с переключателем месяц/год, отзывы, FAQ, CTA и футер. ${BASE}`,
  },
  {
    id: 'corporate',
    title: 'Корпоративный сайт',
    description: 'Многосекционный сайт компании с услугами',
    icon: 'i-ph:buildings',
    prompt: `Создай корпоративный сайт: hero, услуги, преимущества, кейсы, команда, отзывы, форма заявки и футер с контактами и картой. Деловой стиль. ${BASE}`,
  },
  {
    id: 'docs',
    title: 'Документация',
    description: 'Сайт документации с боковым меню и поиском',
    icon: 'i-ph:book-open',
    prompt: `Создай сайт документации: боковая навигация по разделам, контент с заголовками и блоками кода, поиск, оглавление справа, тёмная/светлая темы. Наполни демо-разделами. ${BASE}`,
  },
];

const BLOCKS: GalleryItem[] = [
  { id: 'navbar', title: 'Навбар', description: 'Адаптивная шапка с меню и бургером', icon: 'i-ph:list', prompt: 'Добавь в текущий проект адаптивную шапку (навбар) с логотипом, пунктами меню, бургер-меню на мобильных и кнопкой CTA. В едином стиле проекта.' },
  { id: 'hero', title: 'Hero', description: 'Главный экран с заголовком и CTA', icon: 'i-ph:magic-wand', prompt: 'Добавь в текущий проект секцию hero: крупный заголовок, подзаголовок, две кнопки (основная и второстепенная) и фоновое изображение/градиент. Адаптивно, в стиле проекта.' },
  { id: 'features', title: 'Преимущества', description: 'Сетка карточек с иконками', icon: 'i-ph:squares-four', prompt: 'Добавь в текущий проект секцию преимуществ: сетка из 3–6 карточек с иконкой, заголовком и описанием. Адаптивно, в стиле проекта.' },
  { id: 'pricing', title: 'Тарифы', description: 'Блок цен с тремя планами', icon: 'i-ph:tag', prompt: 'Добавь в текущий проект секцию тарифов: три плана с ценой, списком возможностей и кнопкой, выделенный «популярный» план, переключатель месяц/год. В стиле проекта.' },
  { id: 'testimonials', title: 'Отзывы', description: 'Карусель/сетка отзывов', icon: 'i-ph:chat-circle', prompt: 'Добавь в текущий проект секцию отзывов: карточки с аватаром, именем, должностью и текстом. Адаптивно, в стиле проекта.' },
  { id: 'faq', title: 'FAQ', description: 'Аккордеон с вопросами', icon: 'i-ph:question', prompt: 'Добавь в текущий проект секцию FAQ в виде аккордеона с раскрывающимися вопросами и ответами. В стиле проекта.' },
  { id: 'contact', title: 'Форма контактов', description: 'Форма с валидацией', icon: 'i-ph:envelope', prompt: 'Добавь в текущий проект секцию контактов с формой (имя, email, сообщение), клиентской валидацией и сообщением об успешной отправке. В стиле проекта.' },
  { id: 'footer', title: 'Футер', description: 'Подвал со ссылками и соцсетями', icon: 'i-ph:layout', prompt: 'Добавь в текущий проект футер: колонки ссылок, соцсети, копирайт и форму подписки. Адаптивно, в стиле проекта.' },
];

interface TemplateGalleryProps {
  open: boolean;
  onClose: () => void;
}

export function TemplateGallery({ open, onClose }: TemplateGalleryProps) {
  const [tab, setTab] = useState<'sites' | 'blocks'>('sites');

  if (!open) {
    return null;
  }

  const run = (prompt: string) => {
    window.dispatchEvent(new CustomEvent('bolt:send-prompt', { detail: prompt }));
    onClose();
  };

  const items = tab === 'sites' ? TEMPLATES : BLOCKS;

  return (
    <div
      data-no-i18n
      className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4"
      onClick={onClose}
    >
      <div
        className="flex max-h-[85vh] w-full max-w-3xl flex-col overflow-hidden rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-bolt-elements-borderColor px-5 py-3">
          <h2 className="text-lg font-bold text-bolt-elements-textPrimary">Шаблоны и блоки</h2>
          <button
            onClick={onClose}
            className="text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
            title="Закрыть"
          >
            <span className="i-ph:x w-5 h-5 block" />
          </button>
        </div>

        <div className="flex gap-2 px-5 pt-3">
          <button
            onClick={() => setTab('sites')}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === 'sites'
                ? 'bg-accent-500 text-white'
                : 'bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary'
            }`}
          >
            Шаблоны сайтов
          </button>
          <button
            onClick={() => setTab('blocks')}
            className={`rounded-md px-3 py-1.5 text-sm ${
              tab === 'blocks'
                ? 'bg-accent-500 text-white'
                : 'bg-bolt-elements-background-depth-2 text-bolt-elements-textSecondary'
            }`}
          >
            Блоки
          </button>
        </div>

        {tab === 'blocks' && (
          <p className="px-5 pt-2 text-xs text-bolt-elements-textTertiary">
            Блоки добавляются в текущий открытый проект.
          </p>
        )}

        <div className="grid grid-cols-1 gap-3 overflow-y-auto p-5 sm:grid-cols-2 modern-scrollbar">
          {items.map((item) => (
            <button
              key={item.id}
              onClick={() => run(item.prompt)}
              className="flex items-start gap-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4 text-left transition-colors hover:border-accent-500 hover:bg-bolt-elements-background-depth-3"
            >
              <span className={`${item.icon} mt-0.5 h-6 w-6 shrink-0 text-accent-500`} />
              <span>
                <span className="block text-sm font-semibold text-bolt-elements-textPrimary">{item.title}</span>
                <span className="block text-xs text-bolt-elements-textSecondary">{item.description}</span>
              </span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
