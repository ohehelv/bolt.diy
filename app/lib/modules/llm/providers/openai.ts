import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { ModelInfo } from '~/lib/modules/llm/types';
import type { IProviderSetting } from '~/types/model';
import type { LanguageModelV1 } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';

const openAIModel = (
  name: string,
  label: string,
  maxTokenAllowed: number,
  maxCompletionTokens: number,
): ModelInfo => ({
  name,
  label,
  provider: 'OpenAI',
  maxTokenAllowed,
  maxCompletionTokens,
});

export default class OpenAIProvider extends BaseProvider {
  name = 'OpenAI';
  getApiKeyLink = 'https://platform.openai.com/api-keys';

  config = {
    apiTokenKey: 'OPENAI_API_KEY',
  };

  staticModels: ModelInfo[] = [
    /*
     * Essential fallback models. Dynamic model discovery still runs against
     * /v1/models, but these keep current OpenAI models visible immediately.
     */
    openAIModel('gpt-5.5', 'GPT-5.5', 1050000, 128000),
    openAIModel('gpt-5.4', 'GPT-5.4', 1050000, 128000),
    openAIModel('gpt-5.4-mini', 'GPT-5.4 Mini', 400000, 128000),
    openAIModel('gpt-5.4-nano', 'GPT-5.4 Nano', 400000, 128000),
    openAIModel('gpt-5', 'GPT-5', 400000, 128000),
    openAIModel('gpt-5-mini', 'GPT-5 Mini', 400000, 128000),
    openAIModel('gpt-5-nano', 'GPT-5 Nano', 400000, 128000),
    openAIModel('chat-latest', 'Chat Latest', 400000, 128000),

    // Legacy fallback models that may still be available on older accounts.
    openAIModel('gpt-4o', 'GPT-4o', 128000, 4096),
    openAIModel('gpt-4o-mini', 'GPT-4o Mini', 128000, 4096),
    openAIModel('o1-preview', 'o1-preview', 128000, 32000),
    openAIModel('o1-mini', 'o1-mini', 128000, 65000),
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
      defaultApiTokenKey: 'OPENAI_API_KEY',
    });

    if (!apiKey) {
      throw `Missing Api Key configuration for ${this.name} provider`;
    }

    const response = await fetch(`https://api.openai.com/v1/models`, {
      headers: {
        Authorization: `Bearer ${apiKey}`,
      },
    });

    const res = (await response.json()) as any;
    const staticModelIds = this.staticModels.map((m) => m.name);

    const data = res.data.filter(
      (model: any) =>
        model.object === 'model' &&
        (model.id.startsWith('gpt-') ||
          model.id.startsWith('o') ||
          model.id.startsWith('chatgpt-') ||
          model.id.startsWith('chat-')) &&
        !staticModelIds.includes(model.id),
    );

    return data.map((m: any) => {
      const modelId = m.id?.toLowerCase() || '';

      // Get accurate context window from OpenAI API
      let contextWindow = 32000; // default fallback

      // OpenAI provides context_length in their API response
      if (m.context_length) {
        contextWindow = m.context_length;
      } else if (modelId.includes('gpt-5.4-mini') || modelId.includes('gpt-5.4-nano')) {
        contextWindow = 400000;
      } else if (modelId.startsWith('gpt-5.5') || modelId.startsWith('gpt-5.4')) {
        contextWindow = 1050000;
      } else if (modelId.startsWith('gpt-5') || modelId === 'chat-latest') {
        contextWindow = 400000;
      } else if (m.id?.includes('gpt-4o')) {
        contextWindow = 128000; // GPT-4o has 128k context
      } else if (m.id?.includes('gpt-4-turbo') || m.id?.includes('gpt-4-1106')) {
        contextWindow = 128000; // GPT-4 Turbo has 128k context
      } else if (m.id?.includes('gpt-4')) {
        contextWindow = 8192; // Standard GPT-4 has 8k context
      } else if (m.id?.includes('gpt-3.5-turbo')) {
        contextWindow = 16385; // GPT-3.5-turbo has 16k context
      }

      // Determine completion token limits based on model type (accurate 2025 limits)
      let maxCompletionTokens = 4096; // default for most models

      if (modelId.startsWith('gpt-5') || modelId === 'chat-latest') {
        maxCompletionTokens = 128000;
      } else if (m.id?.startsWith('o1-preview')) {
        maxCompletionTokens = 32000; // o1-preview: 32K output limit
      } else if (m.id?.startsWith('o1-mini')) {
        maxCompletionTokens = 65000; // o1-mini: 65K output limit
      } else if (m.id?.startsWith('o1')) {
        maxCompletionTokens = 32000; // Other o1 models: 32K limit
      } else if (m.id?.includes('o3') || m.id?.includes('o4')) {
        maxCompletionTokens = 100000; // o3/o4 models: 100K output limit
      } else if (m.id?.includes('gpt-4o')) {
        maxCompletionTokens = 4096; // GPT-4o standard: 4K (64K with long output mode)
      } else if (m.id?.includes('gpt-4')) {
        maxCompletionTokens = 8192; // Standard GPT-4: 8K output limit
      } else if (m.id?.includes('gpt-3.5-turbo')) {
        maxCompletionTokens = 4096; // GPT-3.5-turbo: 4K output limit
      }

      return {
        name: m.id,
        label: `${m.id} (${Math.floor(contextWindow / 1000)}k context)`,
        provider: this.name,
        maxTokenAllowed: contextWindow,
        maxCompletionTokens,
      };
    });
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): LanguageModelV1 {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: '',
      defaultApiTokenKey: 'OPENAI_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    const openai = createOpenAI({
      apiKey,
    });

    return openai(model);
  }
}
