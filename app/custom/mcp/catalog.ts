/**
 * [FORK] Каталог популярных MCP-серверов для установки в один шаг.
 * Ассистент ставит сервер по ключу каталога (безопаснее произвольных команд);
 * этот же список можно показать в UI настроек.
 */
export interface McpCatalogEntry {
  id: string;
  title: string;
  description: string;
  // Какие переменные окружения нужны серверу (ключи/токены) — заполняет пользователь
  requiresEnv?: string[];
  // Совместимо с форматом mcpServers[name]
  config: Record<string, unknown>;
}

export const MCP_CATALOG: McpCatalogEntry[] = [
  {
    id: 'context7',
    title: 'Context7 — документация',
    description: 'Актуальная документация и примеры кода для библиотек и фреймворков.',
    config: { type: 'stdio', command: 'npx', args: ['-y', '@upstash/context7-mcp@latest'] },
  },
  {
    id: 'perplexity',
    title: 'Perplexity — веб-поиск',
    description: 'Поиск и исследования через Perplexity. Требует ключ PERPLEXITY_API_KEY.',
    requiresEnv: ['PERPLEXITY_API_KEY'],
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@perplexity-ai/mcp-server'],
      env: { PERPLEXITY_API_KEY: '' },
    },
  },
  {
    id: 'sequential-thinking',
    title: 'Sequential Thinking',
    description: 'Пошаговое структурированное рассуждение для сложных задач.',
    config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-sequential-thinking'] },
  },
  {
    id: 'memory',
    title: 'Memory — долговременная память',
    description: 'Граф знаний как долговременная память ассистента.',
    config: { type: 'stdio', command: 'npx', args: ['-y', '@modelcontextprotocol/server-memory'] },
  },
  {
    id: 'filesystem',
    title: 'Filesystem',
    description: 'Доступ к файлам в указанной директории (укажите путь в args).',
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-filesystem', '/path/to/dir'],
    },
  },
  {
    id: 'github',
    title: 'GitHub',
    description: 'Работа с репозиториями GitHub. Требует GITHUB_PERSONAL_ACCESS_TOKEN.',
    requiresEnv: ['GITHUB_PERSONAL_ACCESS_TOKEN'],
    config: {
      type: 'stdio',
      command: 'npx',
      args: ['-y', '@modelcontextprotocol/server-github'],
      env: { GITHUB_PERSONAL_ACCESS_TOKEN: '' },
    },
  },
  {
    id: 'deepwiki',
    title: 'DeepWiki (remote)',
    description: 'Документация публичных репозиториев GitHub через DeepWiki (HTTP, без ключа).',
    config: { type: 'streamable-http', url: 'https://mcp.deepwiki.com/mcp' },
  },
];

export function getCatalogEntry(id: string): McpCatalogEntry | undefined {
  return MCP_CATALOG.find((entry) => entry.id === id);
}

// Краткая сводка для модели/UI (без громоздких полей)
export function getCatalogSummary() {
  return MCP_CATALOG.map(({ id, title, description, requiresEnv }) => ({ id, title, description, requiresEnv }));
}
