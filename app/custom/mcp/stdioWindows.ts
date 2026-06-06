/**
 * [FORK] Кроссплатформенный запуск stdio-MCP серверов.
 * На Windows прямой spawn('npx'/'npm', ...) падает с "spawn npx ENOENT"
 * (нет бинарника без .cmd, плюс ограничение Node 24 на запуск .cmd напрямую).
 * Канонический способ (как в Claude Desktop) — запускать через `cmd /c`.
 * На Linux/macOS/Docker возвращаем конфиг без изменений → поведение одинаковое.
 */
import type { STDIOServerConfig } from '~/lib/services/mcpService';

export function toWindowsSafeStdioConfig(config: STDIOServerConfig): STDIOServerConfig {
  const isWindows = typeof process !== 'undefined' && process.platform === 'win32';

  // Не трогаем не-Windows и уже обёрнутые в cmd команды
  if (!isWindows || config.command === 'cmd') {
    return config;
  }

  return {
    ...config,
    command: 'cmd',
    args: ['/c', config.command, ...(config.args ?? [])],
  };
}
