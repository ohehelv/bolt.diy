/**
 * [FORK] Реестр ошибок MCP-инструментов.
 * Назначение: не глушить реальные ошибки, а сохранять их, чтобы ассистент
 * мог сам диагностировать и чинить MCP (инструмент bolt_mcp_diagnostics).
 * Лёгкий модуль без зависимостей; живёт в singleton-сервисе на сервере.
 */

export interface McpToolError {
  timestamp: number;
  serverName?: string;
  toolName: string;
  message: string;
  hint?: string;
}

// Кольцевой буфер последних ошибок (ограничен по памяти)
const MAX_ERRORS = 50;
const recentErrors: McpToolError[] = [];

export function recordMcpToolError(error: {
  serverName?: string;
  toolName: string;
  message: string;
  hint?: string;
}): void {
  recentErrors.push({ ...error, timestamp: Date.now() });

  if (recentErrors.length > MAX_ERRORS) {
    recentErrors.splice(0, recentErrors.length - MAX_ERRORS);
  }
}

export function getRecentMcpToolErrors(limit = 10): McpToolError[] {
  const safeLimit = Math.max(1, Math.min(limit, MAX_ERRORS));
  return recentErrors.slice(-safeLimit).reverse();
}

export function clearMcpToolErrors(): void {
  recentErrors.length = 0;
}

// Маскируем возможные секреты в тексте ошибки перед показом модели/пользователю
const SECRET_PATTERNS: RegExp[] = [
  /\b(?:pplx|sk|ghp|gho|ghs|github_pat|xai|or|rk)[-_][A-Za-z0-9_-]{8,}\b/gi,
  /\bBearer\s+[A-Za-z0-9._-]{8,}\b/gi,
  /\b[A-Fa-f0-9]{32,}\b/g,
];

export function sanitizeMcpErrorMessage(error: unknown): string {
  let message = '';

  if (error instanceof Error) {
    message = error.message || String(error);
  } else if (typeof error === 'string') {
    message = error;
  } else {
    try {
      message = JSON.stringify(error);
    } catch {
      message = String(error);
    }
  }

  for (const pattern of SECRET_PATTERNS) {
    message = message.replace(pattern, '***');
  }

  // Ограничиваем длину, чтобы не раздувать ответ модели
  return message.length > 600 ? `${message.slice(0, 600)}…` : message;
}

// Эвристика: по тексту ошибки даём короткую подсказку о вероятной причине и фиксе
const ERROR_HINTS: Array<{ test: RegExp; hint: string }> = [
  {
    test: /timed?\s*out|timeout|ETIMEDOUT|deadline|aborted/i,
    hint: 'Подсказка: похоже на таймаут. Для Perplexity используйте perplexity_ask вместо медленного perplexity_research, либо увеличьте MCP_TOOL_TIMEOUT_MS.',
  },
  {
    test: /401|unauthorized|invalid[_\s-]?api[_\s-]?key|invalid token|authentication failed/i,
    hint: 'Подсказка: проблема с ключом/авторизацией сервера — проверьте API-ключ в .env.local.',
  },
  {
    test: /\b403\b|forbidden|access denied|not authorized/i,
    hint: 'Подсказка: доступ запрещён (403) — возможно, нет прав или подписки на эту модель/ресурс.',
  },
  {
    test: /\b429\b|rate[_\s-]?limit|too many requests/i,
    hint: 'Подсказка: превышен лимит запросов (429) — подождите и повторите.',
  },
  {
    test: /ENOENT|command not found|is not recognized|spawn\s+\S+\s+ENOENT/i,
    hint: 'Подсказка: команда сервера не найдена — проверьте, что доступен npx и имя пакета указано верно.',
  },
  {
    test: /ECONNREFUSED|connection refused|fetch failed|network error|ENOTFOUND/i,
    hint: 'Подсказка: нет соединения. Для stdio в Docker нужен MCP-bridge (auth-proxy на 127.0.0.1:3000) — проверьте, что он запущен.',
  },
  {
    test: /\b404\b|not found|no such (package|model)/i,
    hint: 'Подсказка: ресурс не найден (404) — проверьте URL сервера или имя npm-пакета.',
  },
  {
    test: /model.*(not|unavailable|unsupported|does not exist)/i,
    hint: 'Подсказка: модель недоступна для вашего ключа/тарифа.',
  },
];

export function explainMcpError(message: string): string {
  for (const { test, hint } of ERROR_HINTS) {
    if (test.test(message)) {
      return hint;
    }
  }

  return '';
}
