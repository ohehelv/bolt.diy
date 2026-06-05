import {
  experimental_createMCPClient,
  type ToolSet,
  type Message,
  type DataStreamWriter,
  convertToCoreMessages,
  formatDataStreamPart,
} from 'ai';
import { Experimental_StdioMCPTransport } from 'ai/mcp-stdio';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { z } from 'zod';
import type { ToolCallAnnotation } from '~/types/context';
import {
  TOOL_EXECUTION_APPROVAL,
  TOOL_EXECUTION_DENIED,
  TOOL_EXECUTION_ERROR,
  TOOL_NO_EXECUTE_FUNCTION,
} from '~/utils/constants';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('mcp-service');

type EnvRecord = object;

export const stdioServerConfigSchema = z
  .object({
    type: z.enum(['stdio']).optional(),
    command: z.string().min(1, 'Command cannot be empty'),
    args: z.array(z.string()).optional(),
    cwd: z.string().optional(),
    env: z.record(z.string()).optional(),
  })
  .transform((data) => ({
    ...data,
    type: 'stdio' as const,
  }));
export type STDIOServerConfig = z.infer<typeof stdioServerConfigSchema>;

export const sseServerConfigSchema = z
  .object({
    type: z.enum(['sse']).optional(),
    url: z.string().url('URL must be a valid URL format'),
    headers: z.record(z.string()).optional(),
  })
  .transform((data) => ({
    ...data,
    type: 'sse' as const,
  }));
export type SSEServerConfig = z.infer<typeof sseServerConfigSchema>;

export const streamableHTTPServerConfigSchema = z
  .object({
    type: z.enum(['streamable-http']).optional(),
    url: z.string().url('URL must be a valid URL format'),
    headers: z.record(z.string()).optional(),
  })
  .transform((data) => ({
    ...data,
    type: 'streamable-http' as const,
  }));

export type StreamableHTTPServerConfig = z.infer<typeof streamableHTTPServerConfigSchema>;

export const mcpServerConfigSchema = z.union([
  stdioServerConfigSchema,
  sseServerConfigSchema,
  streamableHTTPServerConfigSchema,
]);
export type MCPServerConfig = z.infer<typeof mcpServerConfigSchema>;

export const mcpConfigSchema = z.object({
  mcpServers: z.record(z.string(), mcpServerConfigSchema),
});
export type MCPConfig = z.infer<typeof mcpConfigSchema>;

export type MCPClient = {
  tools: () => Promise<ToolSet>;
  close: () => Promise<void>;
} & {
  serverName: string;
};

export type ToolCall = {
  type: 'tool-call';
  toolCallId: string;
  toolName: string;
  args: Record<string, unknown>;
};

export type MCPServerTools = Record<string, MCPServer>;

export type PublicMCPServerTools = Record<
  string,
  | {
      status: 'available';
      tools: ToolSet;
      config: MCPServerConfig;
    }
  | {
      status: 'unavailable';
      error: string;
      config: MCPServerConfig;
    }
>;

export type MCPServerAvailable = {
  status: 'available';
  tools: ToolSet;
  client: MCPClient;
  config: MCPServerConfig;
};
export type MCPServerUnavailable = {
  status: 'unavailable';
  error: string;
  client: MCPClient | null;
  config: MCPServerConfig;
};
export type MCPServer = MCPServerAvailable | MCPServerUnavailable;

function readEnv(env: EnvRecord | undefined, key: string): string {
  const processEnv = typeof process !== 'undefined' ? process.env : undefined;
  const runtimeEnv = env as Record<string, unknown> | undefined;

  return String(runtimeEnv?.[key] || processEnv?.[key] || '').trim();
}

function isEnabled(value: string, defaultValue = true) {
  if (!value) {
    return defaultValue;
  }

  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function trimTrailingSlash(value: string) {
  return value.replace(/\/+$/, '');
}

function shouldUseLocalBridge(env?: EnvRecord) {
  const bridgeEnabled = readEnv(env, 'MCP_BRIDGE_ENABLED');

  if (bridgeEnabled) {
    return isEnabled(bridgeEnabled, true);
  }

  return Boolean(readEnv(env, 'MCP_BRIDGE_BASE_URL') || readEnv(env, 'RUNNING_IN_DOCKER'));
}

function bridgeServerConfig(env: EnvRecord | undefined, serverName: string): StreamableHTTPServerConfig {
  const baseUrl = trimTrailingSlash(readEnv(env, 'MCP_BRIDGE_BASE_URL') || 'http://127.0.0.1:3000/__bolt-mcp');

  return {
    type: 'streamable-http',
    url: `${baseUrl}/${serverName}`,
  };
}

export function buildServerMCPConfig(env?: EnvRecord): MCPConfig {
  const mcpServers: MCPConfig['mcpServers'] = {};
  const useLocalBridge = shouldUseLocalBridge(env);

  if (isEnabled(readEnv(env, 'MCP_CONTEXT7_ENABLED'), true)) {
    const context7Args = ['-y', readEnv(env, 'MCP_CONTEXT7_PACKAGE') || '@upstash/context7-mcp@latest'];
    const context7ApiKey = readEnv(env, 'CONTEXT7_API_KEY');

    mcpServers.context7 = useLocalBridge
      ? bridgeServerConfig(env, 'context7')
      : {
          type: 'stdio',
          command: readEnv(env, 'MCP_NPX_COMMAND') || 'npx',
          args: context7Args,
          env: context7ApiKey
            ? {
                CONTEXT7_API_KEY: context7ApiKey,
              }
            : undefined,
        };
  }

  if (isEnabled(readEnv(env, 'MCP_COOLIFY_ENABLED'), true)) {
    const baseUrl = readEnv(env, 'MCP_COOLIFY_BASE_URL') || readEnv(env, 'COOLIFY_BASE_URL');
    const token =
      readEnv(env, 'MCP_COOLIFY_TOKEN') ||
      readEnv(env, 'COOLIFY_TOKEN') ||
      readEnv(env, 'COOLIFY_API_TOKEN') ||
      readEnv(env, 'COOLIFY_ACCESS_TOKEN');

    if (baseUrl && token) {
      mcpServers.coolify = useLocalBridge
        ? bridgeServerConfig(env, 'coolify')
        : {
            type: 'stdio',
            command: readEnv(env, 'MCP_NPX_COMMAND') || 'npx',
            args: ['-y', readEnv(env, 'MCP_COOLIFY_PACKAGE') || 'coolify-mcp-server@latest'],
            env: {
              COOLIFY_BASE_URL: baseUrl,
              COOLIFY_TOKEN: token,
            },
          };
    }
  }

  return { mcpServers };
}

function mergeMCPConfigs(serverConfig: MCPConfig, userConfig: MCPConfig): MCPConfig {
  return {
    mcpServers: {
      ...(userConfig?.mcpServers || {}),
      ...serverConfig.mcpServers,
    },
  };
}

function maskSensitiveRecord(record: Record<string, string> | undefined): Record<string, string> | undefined {
  if (!record) {
    return undefined;
  }

  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => {
      const lowerKey = key.toLowerCase();
      const isSensitive =
        lowerKey.includes('token') ||
        lowerKey.includes('secret') ||
        lowerKey.includes('password') ||
        lowerKey.includes('api_key') ||
        lowerKey.includes('apikey') ||
        lowerKey === 'authorization';

      return [key, isSensitive && value ? '***' : value];
    }),
  );
}

function publicServerConfig(config: MCPServerConfig): MCPServerConfig {
  if (config.type === 'stdio' || 'command' in config) {
    const stdioConfig = config as STDIOServerConfig;

    return {
      ...stdioConfig,
      type: 'stdio',
      env: maskSensitiveRecord(stdioConfig.env),
    };
  }

  const remoteConfig = config as SSEServerConfig | StreamableHTTPServerConfig;

  return {
    ...remoteConfig,
    headers: maskSensitiveRecord(remoteConfig.headers),
  };
}

export function publicMCPServerTools(serverTools: MCPServerTools): PublicMCPServerTools {
  return Object.fromEntries(
    Object.entries(serverTools).map(([serverName, server]) => {
      const base = {
        config: publicServerConfig(server.config),
      };

      if (server.status === 'available') {
        return [
          serverName,
          {
            ...base,
            status: 'available',
            tools: server.tools,
          },
        ];
      }

      return [
        serverName,
        {
          ...base,
          status: 'unavailable',
          error: server.error,
        },
      ];
    }),
  ) as PublicMCPServerTools;
}

function publicMCPConfig(config: MCPConfig): MCPConfig {
  return {
    mcpServers: Object.fromEntries(
      Object.entries(config.mcpServers).map(([serverName, serverConfig]) => [serverName, publicServerConfig(serverConfig)]),
    ),
  };
}

export class MCPService {
  private static _instance: MCPService;
  private _tools: ToolSet = {};
  private _toolsWithoutExecute: ToolSet = {};
  private _mcpToolsPerServer: MCPServerTools = {};
  private _toolNamesToServerNames = new Map<string, string>();
  private _config: MCPConfig = {
    mcpServers: {},
  };

  static getInstance(): MCPService {
    if (!MCPService._instance) {
      MCPService._instance = new MCPService();
    }

    return MCPService._instance;
  }

  private _validateServerConfig(serverName: string, config: any): MCPServerConfig {
    const hasStdioField = config.command !== undefined;
    const hasUrlField = config.url !== undefined;

    if (hasStdioField && hasUrlField) {
      throw new Error(`cannot have "command" and "url" defined for the same server.`);
    }

    if (!config.type && hasStdioField) {
      config.type = 'stdio';
    }

    if (hasUrlField && !config.type) {
      throw new Error(`missing "type" field, only "sse" and "streamable-http" are valid options.`);
    }

    if (!['stdio', 'sse', 'streamable-http'].includes(config.type)) {
      throw new Error(`provided "type" is invalid, only "stdio", "sse" or "streamable-http" are valid options.`);
    }

    // Check for type/field mismatch
    if (config.type === 'stdio' && !hasStdioField) {
      throw new Error(`missing "command" field.`);
    }

    if (['sse', 'streamable-http'].includes(config.type) && !hasUrlField) {
      throw new Error(`missing "url" field.`);
    }

    try {
      return mcpServerConfigSchema.parse(config);
    } catch (validationError) {
      if (validationError instanceof z.ZodError) {
        const errorMessages = validationError.errors.map((err) => `${err.path.join('.')}: ${err.message}`).join('; ');
        throw new Error(`Invalid configuration for server "${serverName}": ${errorMessages}`);
      }

      throw validationError;
    }
  }

  async updateConfig(config: MCPConfig, env?: EnvRecord) {
    const mergedConfig = mergeMCPConfigs(buildServerMCPConfig(env), config);

    logger.debug('updating config', JSON.stringify(publicMCPConfig(mergedConfig)));
    this._config = mergedConfig;
    await this._createClients();

    return this._mcpToolsPerServer;
  }

  async ensureConfigured(env?: EnvRecord) {
    if (Object.keys(this._config.mcpServers).length > 0) {
      return this._mcpToolsPerServer;
    }

    return this.updateConfig({ mcpServers: {} }, env);
  }

  private async _createStreamableHTTPClient(
    serverName: string,
    config: StreamableHTTPServerConfig,
  ): Promise<MCPClient> {
    logger.debug(`Creating Streamable-HTTP client for ${serverName} with URL: ${config.url}`);

    const client = await experimental_createMCPClient({
      transport: new StreamableHTTPClientTransport(new URL(config.url), {
        requestInit: {
          headers: config.headers,
        },
      }),
    });

    return Object.assign(client, { serverName });
  }

  private async _createSSEClient(serverName: string, config: SSEServerConfig): Promise<MCPClient> {
    logger.debug(`Creating SSE client for ${serverName} with URL: ${config.url}`);

    const client = await experimental_createMCPClient({
      transport: config,
    });

    return Object.assign(client, { serverName });
  }

  private async _createStdioClient(serverName: string, config: STDIOServerConfig): Promise<MCPClient> {
    logger.debug(
      `Creating STDIO client for '${serverName}' with command: '${config.command}' ${config.args?.join(' ') || ''}`,
    );

    const client = await experimental_createMCPClient({ transport: new Experimental_StdioMCPTransport(config) });

    return Object.assign(client, { serverName });
  }

  private _registerTools(serverName: string, tools: ToolSet) {
    for (const [toolName, tool] of Object.entries(tools)) {
      if (this._tools[toolName]) {
        const existingServerName = this._toolNamesToServerNames.get(toolName);

        if (existingServerName && existingServerName !== serverName) {
          logger.warn(`Tool conflict: "${toolName}" from "${serverName}" overrides tool from "${existingServerName}"`);
        }
      }

      this._tools[toolName] = tool;
      this._toolsWithoutExecute[toolName] = { ...tool, execute: undefined };
      this._toolNamesToServerNames.set(toolName, serverName);
    }
  }

  private async _createMCPClient(serverName: string, serverConfig: MCPServerConfig): Promise<MCPClient> {
    const validatedConfig = this._validateServerConfig(serverName, serverConfig);

    if (validatedConfig.type === 'stdio') {
      return await this._createStdioClient(serverName, serverConfig as STDIOServerConfig);
    } else if (validatedConfig.type === 'sse') {
      return await this._createSSEClient(serverName, serverConfig as SSEServerConfig);
    } else {
      return await this._createStreamableHTTPClient(serverName, serverConfig as StreamableHTTPServerConfig);
    }
  }

  private async _createClients() {
    await this._closeClients();

    const createClientPromises = Object.entries(this._config?.mcpServers || []).map(async ([serverName, config]) => {
      let client: MCPClient | null = null;

      try {
        client = await this._createMCPClient(serverName, config);

        try {
          const tools = await client.tools();

          this._registerTools(serverName, tools);

          this._mcpToolsPerServer[serverName] = {
            status: 'available',
            client,
            tools,
            config,
          };
        } catch (error) {
          logger.error(`Failed to get tools from server ${serverName}:`, error);
          this._mcpToolsPerServer[serverName] = {
            status: 'unavailable',
            error: 'could not retrieve tools from server',
            client,
            config,
          };
        }
      } catch (error) {
        logger.error(`Failed to initialize MCP client for server: ${serverName}`, error);
        this._mcpToolsPerServer[serverName] = {
          status: 'unavailable',
          error: (error as Error).message,
          client,
          config,
        };
      }
    });

    await Promise.allSettled(createClientPromises);
  }

  async checkServersAvailabilities() {
    this._tools = {};
    this._toolsWithoutExecute = {};
    this._toolNamesToServerNames.clear();

    const checkPromises = Object.entries(this._mcpToolsPerServer).map(async ([serverName, server]) => {
      let client = server.client;

      try {
        logger.debug(`Checking MCP server "${serverName}" availability: start`);

        if (!client) {
          client = await this._createMCPClient(serverName, this._config?.mcpServers[serverName]);
        }

        try {
          const tools = await client.tools();

          this._registerTools(serverName, tools);

          this._mcpToolsPerServer[serverName] = {
            status: 'available',
            client,
            tools,
            config: server.config,
          };
        } catch (error) {
          logger.error(`Failed to get tools from server ${serverName}:`, error);
          this._mcpToolsPerServer[serverName] = {
            status: 'unavailable',
            error: 'could not retrieve tools from server',
            client,
            config: server.config,
          };
        }

        logger.debug(`Checking MCP server "${serverName}" availability: end`);
      } catch (error) {
        logger.error(`Failed to connect to server ${serverName}:`, error);
        this._mcpToolsPerServer[serverName] = {
          status: 'unavailable',
          error: 'could not connect to server',
          client,
          config: server.config,
        };
      }
    });

    await Promise.allSettled(checkPromises);

    return this._mcpToolsPerServer;
  }

  private async _closeClients(): Promise<void> {
    const closePromises = Object.entries(this._mcpToolsPerServer).map(async ([serverName, server]) => {
      if (!server.client) {
        return;
      }

      logger.debug(`Closing client for server "${serverName}"`);

      try {
        await server.client.close();
      } catch (error) {
        logger.error(`Error closing client for ${serverName}:`, error);
      }
    });

    await Promise.allSettled(closePromises);
    this._tools = {};
    this._toolsWithoutExecute = {};
    this._mcpToolsPerServer = {};
    this._toolNamesToServerNames.clear();
  }

  isValidToolName(toolName: string): boolean {
    return toolName in this._tools;
  }

  processToolCall(toolCall: ToolCall, dataStream: DataStreamWriter): void {
    const { toolCallId, toolName } = toolCall;

    if (this.isValidToolName(toolName)) {
      const { description = 'No description available' } = this.toolsWithoutExecute[toolName];
      const serverName = this._toolNamesToServerNames.get(toolName);

      if (serverName) {
        dataStream.writeMessageAnnotation({
          type: 'toolCall',
          toolCallId,
          serverName,
          toolName,
          toolDescription: description,
        } satisfies ToolCallAnnotation);
      }
    }
  }

  async processToolInvocations(messages: Message[], dataStream: DataStreamWriter): Promise<Message[]> {
    const lastMessage = messages[messages.length - 1];
    const parts = lastMessage.parts;

    if (!parts) {
      return messages;
    }

    const processedParts = await Promise.all(
      parts.map(async (part) => {
        // Only process tool invocations parts
        if (part.type !== 'tool-invocation') {
          return part;
        }

        const { toolInvocation } = part;
        const { toolName, toolCallId } = toolInvocation;

        // return part as-is if tool does not exist, or if it's not a tool call result
        if (!this.isValidToolName(toolName) || toolInvocation.state !== 'result') {
          return part;
        }

        let result;

        if (toolInvocation.result === TOOL_EXECUTION_APPROVAL.APPROVE) {
          const toolInstance = this._tools[toolName];

          if (toolInstance && typeof toolInstance.execute === 'function') {
            logger.debug(`calling tool "${toolName}" with args: ${JSON.stringify(toolInvocation.args)}`);

            try {
              result = await toolInstance.execute(toolInvocation.args, {
                messages: convertToCoreMessages(messages),
                toolCallId,
              });
            } catch (error) {
              logger.error(`error while calling tool "${toolName}":`, error);
              result = TOOL_EXECUTION_ERROR;
            }
          } else {
            result = TOOL_NO_EXECUTE_FUNCTION;
          }
        } else if (toolInvocation.result === TOOL_EXECUTION_APPROVAL.REJECT) {
          result = TOOL_EXECUTION_DENIED;
        } else {
          // For any unhandled responses, return the original part.
          return part;
        }

        // Forward updated tool result to the client.
        dataStream.write(
          formatDataStreamPart('tool_result', {
            toolCallId,
            result,
          }),
        );

        // Return updated toolInvocation with the actual result.
        return {
          ...part,
          toolInvocation: {
            ...toolInvocation,
            result,
          },
        };
      }),
    );

    // Finally return the processed messages
    return [...messages.slice(0, -1), { ...lastMessage, parts: processedParts }];
  }

  get tools() {
    return this._tools;
  }

  get toolsWithoutExecute() {
    return this._toolsWithoutExecute;
  }
}
