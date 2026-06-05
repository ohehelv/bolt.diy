import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { MCPService, publicMCPServerTools, type MCPConfig } from '~/lib/services/mcpService';

const logger = createScopedLogger('api.mcp-update-config');

function requireMCPAdmin(request: Request) {
  const role = request.headers.get('x-bolt-auth-role');

  if (role && role !== 'admin') {
    return Response.json({ error: 'MCP configuration is available to administrators only' }, { status: 403 });
  }

  return null;
}

export async function action({ context, request }: ActionFunctionArgs) {
  try {
    const forbidden = requireMCPAdmin(request);

    if (forbidden) {
      return forbidden;
    }

    const mcpConfig = (await request.json()) as MCPConfig;

    if (!mcpConfig || typeof mcpConfig !== 'object') {
      return Response.json({ error: 'Invalid MCP servers configuration' }, { status: 400 });
    }

    const mcpService = MCPService.getInstance();
    const serverTools = await mcpService.updateConfig(mcpConfig, context.cloudflare?.env);

    return Response.json(publicMCPServerTools(serverTools));
  } catch (error) {
    logger.error('Error updating MCP config:', error);
    return Response.json({ error: 'Failed to update MCP config' }, { status: 500 });
  }
}
