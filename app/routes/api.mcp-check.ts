import { type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { createScopedLogger } from '~/utils/logger';
import { MCPService, publicMCPServerTools } from '~/lib/services/mcpService';

const logger = createScopedLogger('api.mcp-check');

function requireMCPAdmin(request: Request) {
  const role = request.headers.get('x-bolt-auth-role');

  if (role && role !== 'admin') {
    return Response.json({ error: 'MCP configuration is available to administrators only' }, { status: 403 });
  }

  return null;
}

export async function loader({ context, request }: LoaderFunctionArgs) {
  try {
    const forbidden = requireMCPAdmin(request);

    if (forbidden) {
      return forbidden;
    }

    const mcpService = MCPService.getInstance();
    await mcpService.ensureConfigured(context.cloudflare?.env);

    const serverTools = await mcpService.checkServersAvailabilities();

    return Response.json(publicMCPServerTools(serverTools));
  } catch (error) {
    logger.error('Error checking MCP servers:', error);
    return Response.json({ error: 'Failed to check MCP servers' }, { status: 500 });
  }
}
