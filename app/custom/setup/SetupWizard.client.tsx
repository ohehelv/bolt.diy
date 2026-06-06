/**
 * [FORK] Мастер первого запуска: выбор провайдера ИИ + ввод ключа API.
 * Update-safe: пишет те же cookie, что читает приложение
 * (selectedProvider / selectedModel / apiKeys), ядро не трогаем.
 */
import { useEffect, useMemo, useState } from 'react';
import Cookies from 'js-cookie';
import { PROVIDER_LIST } from '~/utils/constants';
import type { ProviderInfo } from '~/types/model';

// Рекомендуемые ключ-based провайдеры (в порядке удобства для веб-разработки)
const RECOMMENDED = [
  'OpenRouter',
  'Anthropic',
  'OpenAI',
  'Google',
  'Groq',
  'Deepseek',
  'Mistral',
  'xAI',
  'Perplexity',
  'Together',
  'Cohere',
  'HuggingFace',
];

interface SetupWizardProps {
  open: boolean;
  onClose: () => void;
}

function getApiKeysCookie(): Record<string, string> {
  try {
    return JSON.parse(Cookies.get('apiKeys') || '{}');
  } catch {
    return {};
  }
}

export function SetupWizard({ open, onClose }: SetupWizardProps) {
  const providers = useMemo(() => {
    const list = PROVIDER_LIST as ProviderInfo[];
    const recommended = RECOMMENDED.map((name) => list.find((p) => p.name === name)).filter(Boolean) as ProviderInfo[];
    const rest = list.filter((p) => p.getApiKeyLink && !recommended.includes(p));

    return [...recommended, ...rest];
  }, []);

  const [providerName, setProviderName] = useState<string>(providers[0]?.name || 'OpenRouter');
  const [apiKey, setApiKey] = useState('');
  const [envStatus, setEnvStatus] = useState<Record<string, boolean>>({});

  const selected = providers.find((p) => p.name === providerName);
  const envReady = !!envStatus[providerName];

  useEffect(() => {
    if (!open) {
      return undefined;
    }

    let cancelled = false;

    (async () => {
      const entries = await Promise.all(
        providers.map(async (p) => {
          try {
            const response = await fetch(`/api/check-env-key?provider=${encodeURIComponent(p.name)}`);
            const data = (await response.json()) as { isSet: boolean };

            return [p.name, !!data.isSet] as const;
          } catch {
            return [p.name, false] as const;
          }
        }),
      );

      if (cancelled) {
        return;
      }

      const map = Object.fromEntries(entries);
      setEnvStatus(map);

      // Если у какого-то провайдера ключ уже есть в окружении — выберем его
      const ready = providers.find((p) => map[p.name]);

      if (ready) {
        setProviderName((current) => (map[current] ? current : ready.name));
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [open, providers]);

  if (!open) {
    return null;
  }

  const finish = () => {
    if (apiKey.trim()) {
      const keys = getApiKeysCookie();
      keys[providerName] = apiKey.trim();
      Cookies.set('apiKeys', JSON.stringify(keys), { expires: 30 });
    }

    Cookies.set('selectedProvider', providerName, { expires: 30 });

    const model = selected?.staticModels?.[0]?.name;

    if (model) {
      Cookies.set('selectedModel', model, { expires: 30 });
    }

    localStorage.setItem('bolt_setup_done', '1');
    location.reload();
  };

  const skip = () => {
    localStorage.setItem('bolt_setup_done', '1');
    onClose();
  };

  return (
    <div data-no-i18n className="fixed inset-0 z-[100] flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-md rounded-xl border border-bolt-elements-borderColor bg-bolt-elements-background-depth-1 p-6 shadow-xl">
        <h2 className="mb-1 text-xl font-bold text-bolt-elements-textPrimary">Быстрый старт</h2>
        <p className="mb-4 text-sm text-bolt-elements-textSecondary">
          Выберите провайдера ИИ и укажите ключ API — и можно создавать сайты.
        </p>

        <label className="mb-1 block text-xs text-bolt-elements-textSecondary">Провайдер</label>
        <select
          value={providerName}
          onChange={(event) => {
            setProviderName(event.target.value);
            setApiKey('');
          }}
          className="mb-3 w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-prompt-background px-3 py-2 text-sm text-bolt-elements-textPrimary"
        >
          {providers.map((p) => (
            <option key={p.name} value={p.name}>
              {p.name}
              {envStatus[p.name] ? ' — ключ найден' : ''}
            </option>
          ))}
        </select>

        {envReady ? (
          <div className="mb-3 rounded-md bg-green-500/10 px-3 py-2 text-xs text-green-500">
            Ключ для «{providerName}» найден в окружении — можно начать без ввода.
          </div>
        ) : (
          <>
            <label className="mb-1 block text-xs text-bolt-elements-textSecondary">Ключ API</label>
            <input
              type="password"
              value={apiKey}
              onChange={(event) => setApiKey(event.target.value)}
              placeholder="Вставьте ключ API"
              className="mb-2 w-full rounded-md border border-bolt-elements-borderColor bg-bolt-elements-prompt-background px-3 py-2 text-sm text-bolt-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-bolt-elements-focus"
            />
            {selected?.getApiKeyLink && (
              <a
                href={selected.getApiKeyLink}
                target="_blank"
                rel="noreferrer"
                className="mb-1 inline-block text-xs text-accent-500 hover:underline"
              >
                Где взять ключ для {providerName}?
              </a>
            )}
          </>
        )}

        <div className="mt-5 flex items-center justify-between gap-2">
          <button
            onClick={skip}
            className="text-xs text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary"
          >
            Пропустить
          </button>
          <button
            onClick={finish}
            disabled={!envReady && !apiKey.trim()}
            className="rounded-md bg-accent-500 px-4 py-2 text-sm text-white transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Сохранить и начать
          </button>
        </div>
      </div>
    </div>
  );
}
