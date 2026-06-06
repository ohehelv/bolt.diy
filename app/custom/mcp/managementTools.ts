/**
 * [FORK] Встроенные инструменты управления MCP для ассистента.
 * Цель: ассистент сам диагностирует сбои и ставит/убирает MCP-серверы.
 * Read-инструменты выполняются автоматически; mutating (add/remove) — через
 * подтверждение пользователя (human-in-the-loop), как и обычные MCP-вызовы.
 */
import { tool, type ToolSet } from 'ai';
import { z } from 'zod';
import type { MCPService, PublicMCPServerTools } from '~/lib/services/mcpService';
import { getRecentMcpToolErrors } from './errorRegistry';
import { getCatalogSummary, getCatalogEntry } from './catalog';

export interface ManagementToolSets {
  readTools: ToolSet;
  mutateTools: ToolSet;
}

// Компактная сводка по серверам (без громоздких JSON-схем инструментов), чтобы не раздувать ответ модели
function summarizeServers(status: PublicMCPServerTools) {
  return Object.entries(status).map(([name, server]) => ({
    name,
    status: server.status,
    type: (server.config as { type?: string }).type,
    ...(server.status === 'available'
      ? { tools: Object.keys(server.tools) }
      : { error: server.error }),
  }));
}

export function createManagementTools(service: MCPService): ManagementToolSets {
  const readTools: ToolSet = {
    bolt_mcp_diagnostics: tool({
      description:
        'Диагностика MCP: последние ошибки вызовов инструментов с подсказками о причине. Вызови, чтобы понять, почему MCP-инструмент упал, и как это починить.',
      parameters: z.object({
        limit: z.number().int().min(1).max(50).optional().describe('Сколько последних ошибок вернуть (по умолчанию 10)'),
      }),
      execute: async ({ limit }) => {
        const errors = getRecentMcpToolErrors(limit ?? 10);

        return {
          count: errors.length,
          errors,
          servers: summarizeServers(service.getServersStatus()),
        };
      },
    }),
    bolt_mcp_list: tool({
      description: 'Список настроенных MCP-серверов: статус, транспорт и доступные инструменты (секреты замаскированы).',
      parameters: z.object({}),
      execute: async () => {
        return { servers: summarizeServers(service.getServersStatus()) };
      },
    }),
    bolt_mcp_check: tool({
      description: 'Перепроверить доступность всех MCP-серверов (переподключение) и вернуть актуальный статус.',
      parameters: z.object({}),
      execute: async () => {
        await service.checkServersAvailabilities();
        return { servers: summarizeServers(service.getServersStatus()) };
      },
    }),
    bolt_mcp_catalog: tool({
      description: 'Каталог популярных MCP-серверов для установки в один шаг (используй id в bolt_mcp_add).',
      parameters: z.object({}),
      execute: async () => {
        return { catalog: getCatalogSummary() };
      },
    }),
  };

  const mutateTools: ToolSet = {
    bolt_mcp_add: tool({
      description:
        'Добавить или обновить MCP-сервер. Проще всего — через catalogId из bolt_mcp_catalog. Иначе для stdio укажи command и args; для удалённого — type ("sse"|"streamable-http") и url. Требует подтверждения пользователя.',
      parameters: z.object({
        name: z
          .string()
          .min(1)
          .optional()
          .describe('Имя сервера (ключ в mcpServers). Если не задано и есть catalogId — берётся из каталога'),
        catalogId: z.string().optional().describe('Id сервера из каталога (bolt_mcp_catalog) для установки в один шаг'),
        type: z.enum(['stdio', 'sse', 'streamable-http']).optional(),
        command: z.string().optional().describe('Команда для stdio, например npx'),
        args: z.array(z.string()).optional().describe('Аргументы команды'),
        url: z.string().optional().describe('URL для sse/streamable-http'),
        headers: z.record(z.string()).optional().describe('HTTP-заголовки для удалённого сервера'),
        env: z.record(z.string()).optional().describe('Переменные окружения для stdio (например, API-ключ)'),
      }),
      execute: async ({ name, catalogId, type, command, args, url, headers, env }) => {
        let config: Record<string, unknown> = {};
        let serverName = name;

        if (catalogId) {
          const entry = getCatalogEntry(catalogId);

          if (!entry) {
            return { ok: false, error: `Сервер "${catalogId}" не найден в каталоге. Список: bolt_mcp_catalog.` };
          }

          config = { ...entry.config };
          serverName = serverName || entry.id;

          // Подставляем переданные переменные окружения (например, ключ) в шаблон из каталога
          if (env) {
            config.env = { ...((config.env as Record<string, string>) || {}), ...env };
          }
        } else {
          if (type) {
            config.type = type;
          }

          if (command) {
            config.command = command;
          }

          if (args) {
            config.args = args;
          }

          if (url) {
            config.url = url;
          }

          if (headers) {
            config.headers = headers;
          }

          if (env) {
            config.env = env;
          }
        }

        if (!serverName) {
          return { ok: false, error: 'Нужно указать name или catalogId.' };
        }

        await service.addOrUpdateServer(serverName, config);

        const server = summarizeServers(service.getServersStatus()).find((entry) => entry.name === serverName);

        return { ok: true, name: serverName, server };
      },
    }),
    bolt_mcp_remove: tool({
      description: 'Удалить ранее добавленный MCP-сервер по имени. Требует подтверждения пользователя.',
      parameters: z.object({
        name: z.string().min(1).describe('Имя сервера для удаления'),
      }),
      execute: async ({ name }) => {
        const result = await service.removeServer(name);
        return { ok: true, ...result };
      },
    }),
  };

  return { readTools, mutateTools };
}
