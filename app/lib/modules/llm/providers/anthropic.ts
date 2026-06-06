import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { LanguageModelV1 } from 'ai';
import type { IProviderSetting } from '~/types/model';
import { createAnthropic } from '@ai-sdk/anthropic';

export default class AnthropicProvider extends BaseProvider {
  name = 'Anthropic';
  getApiKeyLink = 'https://console.anthropic.com/settings/keys';

  config = {
    apiTokenKey: 'ANTHROPIC_API_KEY',
  };

  staticModels: ModelInfo[] = [
    /*
     * Essential fallback models - only the most stable/reliable ones
     * Claude 3.5 Sonnet: 200k context, excellent for complex reasoning and coding
     */
    {
      name: 'claude-3-5-sonnet-20241022',
      label: 'Claude 3.5 Sonnet',
      provider: 'Anthropic',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 128000,
    },

    // Claude 3 Haiku: 200k context, fastest and most cost-effective
    {
      name: 'claude-3-haiku-20240307',
      label: 'Claude 3 Haiku',
      provider: 'Anthropic',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 128000,
    },

    // Claude Opus 4: 200k context, 32k output limit (latest flagship model)
    {
      name: 'claude-opus-4-20250514',
      label: 'Claude 4 Opus',
      provider: 'Anthropic',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 32000,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'ANTHROPIC_API_KEY',
    });

    if (!apiKey) {
      throw `Missing Api Key configuration for ${this.name} provider`;
    }

    const response = await fetch(`https://api.anthropic.com/v1/models`, {
      headers: {
        'x-api-key': `${apiKey}`,
        'anthropic-version': '2023-06-01',
      },
    });

    const res = (await response.json()) as any;
    const staticModelIds = this.staticModels.map((m) => m.name);

    const data = res.data.filter((model: any) => model.type === 'model' && !staticModelIds.includes(model.id));

    return data.map((m: any) => {
      /*
       * Determine the context window by model family.
       * NOTE: m.max_tokens from Anthropic's API is the OUTPUT limit, NOT the context window,
       * so we must not use it as the context size for known model families.
       */
      let contextWindow = 32000; // default fallback

      if (m.id?.includes('claude-opus-4') || m.id?.includes('claude-sonnet-4')) {
        contextWindow = 1000000; // Claude 4.x flagships: 1M context (requires the context-1m beta)
      } else if (m.id?.includes('claude-haiku-4') || m.id?.includes('claude-4')) {
        contextWindow = 200000; // Other Claude 4.x models: 200k context
      } else if (m.id?.includes('claude-3')) {
        contextWindow = 200000; // Claude 3.x models: 200k context
      } else if (m.max_tokens) {
        contextWindow = m.max_tokens; // unknown model: fall back to whatever the API reports
      }

      // Determine completion (output) token limits based on specific model
      let maxCompletionTokens = 128000; // default for older Claude 3 models

      if (m.id?.includes('claude-opus-4')) {
        maxCompletionTokens = 32000; // Claude 4 Opus: 32K output limit
      } else if (m.id?.includes('claude-sonnet-4')) {
        maxCompletionTokens = 64000; // Claude 4 Sonnet: 64K output limit
      } else if (m.id?.includes('claude-4')) {
        maxCompletionTokens = 32000; // Other Claude 4 models: conservative 32K limit
      }

      const contextLabel =
        contextWindow >= 1000000 ? `${contextWindow / 1000000}M` : `${Math.floor(contextWindow / 1000)}k`;

      return {
        name: m.id,
        label: `${m.display_name} (${contextLabel} context)`,
        provider: this.name,
        maxTokenAllowed: contextWindow,
        maxCompletionTokens,
      };
    });
  }

  getModelInstance: (options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }) => LanguageModelV1 = (options) => {
    const { apiKeys, providerSettings, serverEnv, model } = options;
    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'ANTHROPIC_API_KEY',
    });
    const betas = ['output-128k-2025-02-19'];

    // Enable the 1M-token context window beta for the model families that support it
    if (model.includes('claude-opus-4') || model.includes('claude-sonnet-4')) {
      betas.push('context-1m-2025-08-07');
    }

    /*
     * Claude 4.x reject the `temperature` parameter ("`temperature` is deprecated for this model").
     * The AI SDK v4 always injects a temperature, so strip it from the outgoing request body here.
     */
    const stripTemperatureFetch: typeof fetch = async (input, init) => {
      if (init?.body && typeof init.body === 'string' && /claude-(opus|sonnet|haiku)-4/i.test(model)) {
        try {
          const payload = JSON.parse(init.body);
          delete payload.temperature;
          init = { ...init, body: JSON.stringify(payload) };
        } catch {
          // body is not JSON we can rewrite — forward it unchanged
        }
      }

      return fetch(input, init);
    };

    const anthropic = createAnthropic({
      apiKey,
      headers: { 'anthropic-beta': betas.join(',') },
      fetch: stripTemperatureFetch,
    });

    return anthropic(model);
  };
}
