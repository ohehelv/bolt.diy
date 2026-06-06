/**
 * [FORK] Словарь перевода UI EN→RU (точное соответствие строк).
 * Используется runtime-слоем перевода (translator.ts). Сюда добавляются
 * только строки «обвязки» приложения — не контент сообщений и не код.
 * Ключ — исходная строка как в коде (с учётом регистра и пунктуации).
 */
export const RU: Record<string, string> = {
  // --- Главный экран чата ---
  'Where ideas begin': 'Где рождаются идеи',
  'Bring ideas to life in seconds or get help on existing projects.':
    'Воплощайте идеи за секунды или получайте помощь по существующим проектам.',
  'How can Bolt help you today?': 'Чем Bolt может помочь сегодня?',
  'What would you like to discuss?': 'Что бы вы хотели обсудить?',
  'Import Chat': 'Импорт чата',
  'Import Folder': 'Импорт папки',
  'Clone a repo': 'Клонировать репозиторий',

  // --- Сайдбар / история чатов ---
  'Start new chat': 'Новый чат',
  'Search chats...': 'Поиск чатов...',
  'Your Chats': 'Ваши чаты',
  'Select all': 'Выбрать все',
  'Deselect all': 'Снять выбор',
  'Delete selected': 'Удалить выбранные',
  'No previous conversations': 'Нет предыдущих бесед',
  'No matches found': 'Совпадений не найдено',
  Today: 'Сегодня',
  Yesterday: 'Вчера',
  'Past 30 Days': 'Последние 30 дней',
  'This month': 'В этом месяце',
  Older: 'Ранее',

  // --- Workbench: переключатель и тулбар ---
  Code: 'Код',
  Diff: 'Различия',
  Preview: 'Превью',
  'Toggle Terminal': 'Терминал',
  Sync: 'Синхр.',
  'Syncing...': 'Синхронизация...',
  'Sync Files': 'Синхронизировать файлы',
  'File Changes': 'Изменения файлов',
  'Copy File List': 'Копировать список файлов',
  Search: 'Поиск',
  Terminal: 'Терминал',

  // --- Общие кнопки/слова ---
  Settings: 'Настройки',
  Save: 'Сохранить',
  Cancel: 'Отмена',
  Delete: 'Удалить',
  Close: 'Закрыть',
  Export: 'Экспорт',
  Import: 'Импорт',
  Edit: 'Редактировать',
  Copy: 'Копировать',
  Copied: 'Скопировано',
  Download: 'Скачать',
  Upload: 'Загрузить',
  Connect: 'Подключить',
  Disconnect: 'Отключить',
  Connected: 'Подключено',
  Deploy: 'Развернуть',
  Refresh: 'Обновить',
  Retry: 'Повторить',
  Apply: 'Применить',
  Reset: 'Сбросить',
  Enabled: 'Включено',
  Disabled: 'Выключено',
  Loading: 'Загрузка',
  'Loading...': 'Загрузка...',
  Yes: 'Да',
  No: 'Нет',
  Back: 'Назад',
  Next: 'Далее',
  Done: 'Готово',
  Open: 'Открыть',
  Add: 'Добавить',
  Remove: 'Удалить',
  Rename: 'Переименовать',
  New: 'Создать',
  Send: 'Отправить',
  Stop: 'Стоп',

  // --- Настройки: вкладки (TAB_LABELS) ---
  Profile: 'Профиль',
  Notifications: 'Уведомления',
  Features: 'Возможности',
  'Data Management': 'Управление данными',
  'Cloud Providers': 'Облачные провайдеры',
  'Local Providers': 'Локальные провайдеры',
  'Event Logs': 'Журнал событий',
  'MCP Servers': 'MCP-серверы',
  'Task Manager': 'Диспетчер задач',
  Connection: 'Подключение',
  Debug: 'Отладка',
  Update: 'Обновление',

  // --- Настройки: описания вкладок (TAB_DESCRIPTIONS) ---
  'Manage your profile and account settings': 'Управление профилем и настройками аккаунта',
  'Configure application preferences': 'Настройка параметров приложения',
  'Configure MCP (Model Context Protocol) servers': 'Настройка серверов MCP (Model Context Protocol)',
  'Customize your Bolt experience': 'Настройте Bolt под себя',
  'Manage notifications and alerts': 'Управление уведомлениями и оповещениями',
  'Manage your data and storage': 'Управление данными и хранилищем',

  // --- Алерты чата ---
  'Preview Error': 'Ошибка превью',
  'Terminal Error': 'Ошибка терминала',
  'We encountered an error while running the preview. Would you like Bolt to analyze and help resolve this issue?':
    'Возникла ошибка при запуске превью. Хотите, чтобы Bolt проанализировал и помог её устранить?',
  'We encountered an error while running terminal commands. Would you like Bolt to analyze and help resolve this issue?':
    'Возникла ошибка при выполнении команд терминала. Хотите, чтобы Bolt проанализировал и помог её устранить?',

  // --- Поле ввода / режимы ---
  Build: 'Сборка',
  Discuss: 'Обсуждение',
  'Enhance prompt': 'Улучшить промпт',
  'Send message': 'Отправить сообщение',

  // --- MCP (настройки/каталог) ---
  'MCP Configuration': 'Конфигурация MCP',
  'Check availability': 'Проверить доступность',
  'Load Example': 'Загрузить пример',
  Available: 'Доступен',
  Unavailable: 'Недоступен',

  // --- API-ключи / выбор модели (главный экран) ---
  'Edit API Key': 'Изменить ключ API',
  'Get API Key': 'Получить ключ API',
  'Save API Key': 'Сохранить ключ API',
  'Enter API Key': 'Введите ключ API',
  'Set via UI': 'Задан через интерфейс',
  'Set via environment variable': 'Задан через переменную окружения',
  'Not Set (Please set via UI or ENV_VAR)': 'Не задан (укажите через интерфейс или ENV_VAR)',
  'Model Settings': 'Настройки модели',
  'Select model': 'Выберите модель',
  'Select provider': 'Выберите провайдера',
  'Design Palette': 'Палитра дизайна',
  'Upload file': 'Загрузить файл',
  'Fetch URL content': 'Загрузить содержимое URL',
  'Start speech recognition': 'Голосовой ввод',
  'MCP Tools Available': 'Доступны инструменты MCP',
  Help: 'Помощь',

  // --- Примеры промптов (стартовый экран) ---
  'Create a mobile app about bolt.diy': 'Создать мобильное приложение о bolt.diy',
  'Build a todo app in React using Tailwind': 'Сделать todo-приложение на React + Tailwind',
  'Build a simple blog using Astro': 'Сделать простой блог на Astro',
  'Create a cookie consent form using Material UI': 'Создать форму согласия на cookie на Material UI',
  'Make a space invaders game': 'Сделать игру Space Invaders',
  'Make a Tic Tac Toe game in html, css and js only': 'Сделать крестики-нолики на чистых HTML, CSS и JS',

  // --- Панель настроек (заголовок и описания вкладок) ---
  'Control Panel': 'Панель управления',
  'Explore new and upcoming features': 'Новые и будущие возможности',
  'Configure cloud AI providers and models': 'Настройка облачных ИИ-провайдеров и моделей',
  'Configure local AI providers and models': 'Настройка локальных ИИ-провайдеров и моделей',
  'Connect and manage GitHub integration': 'Подключение и управление интеграцией GitHub',
  'Connect and manage GitLab integration': 'Подключение и управление интеграцией GitLab',
  'Configure Netlify deployment settings': 'Настройка деплоя в Netlify',
  'Manage Vercel projects and deployments': 'Управление проектами и деплоями Vercel',
  'Setup Supabase database connection': 'Настройка подключения к базе Supabase',
  'View and manage your notifications': 'Просмотр и управление уведомлениями',
  'View system events and logs': 'Системные события и журналы',
};
