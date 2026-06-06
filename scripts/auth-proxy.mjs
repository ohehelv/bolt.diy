import { createHmac, randomBytes, randomUUID, scryptSync, timingSafeEqual } from 'node:crypto';
import { createServer } from 'node:http';
import { mkdirSync, readFileSync, renameSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { Readable } from 'node:stream';
import { Client as MCPClient } from '@modelcontextprotocol/sdk/client/index.js';
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js';
import { Server as MCPProtocolServer } from '@modelcontextprotocol/sdk/server/index.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import { CallToolRequestSchema, isInitializeRequest, ListToolsRequestSchema } from '@modelcontextprotocol/sdk/types.js';

const upstream = process.env.BOLT_UPSTREAM || 'http://127.0.0.1:5173';
const port = Number(process.env.AUTH_PROXY_PORT || process.env.PORT || 3000);
const dataDir = process.env.AUTH_DATA_DIR || '/data/auth';
const usersPath = join(dataDir, 'users.json');
const secretPath = join(dataDir, 'session-secret');
const cookieName = process.env.AUTH_COOKIE_NAME || 'bolt_session';
const sessionTtlSeconds = Number(process.env.AUTH_SESSION_TTL_SECONDS || 7 * 24 * 60 * 60);
const maxBodyBytes = 32 * 1024;
const mcpBridgeMaxBodyBytes = Number(process.env.MCP_BRIDGE_MAX_BODY_BYTES || 4 * 1024 * 1024);

mkdirSync(dataDir, { recursive: true });

function base64url(input) {
  return Buffer.from(input).toString('base64url');
}

function fromBase64url(input) {
  return Buffer.from(input, 'base64url').toString('utf8');
}

function readSecret() {
  const envSecret = process.env.AUTH_SESSION_SECRET;

  if (envSecret && envSecret.length >= 32) {
    return envSecret;
  }

  if (existsSync(secretPath)) {
    return readFileSync(secretPath, 'utf8').trim();
  }

  const secret = randomBytes(48).toString('base64url');
  writeFileSync(secretPath, `${secret}\n`, { mode: 0o600 });

  return secret;
}

const sessionSecret = readSecret();
const mcpBridgeUpstreams = new Map();
const mcpBridgeSessions = new Map();

function envValue(key) {
  return String(process.env[key] || '').trim();
}

function envEnabled(key, defaultValue = true) {
  const value = envValue(key);

  if (!value) {
    return defaultValue;
  }

  return !['0', 'false', 'no', 'off'].includes(value.toLowerCase());
}

function mcpBridgeServerConfig(serverName) {
  const npxCommand = envValue('MCP_NPX_COMMAND') || 'npx';

  if (serverName === 'context7' && envEnabled('MCP_CONTEXT7_ENABLED', true)) {
    const context7ApiKey = envValue('CONTEXT7_API_KEY');

    return {
      command: npxCommand,
      args: ['-y', envValue('MCP_CONTEXT7_PACKAGE') || '@upstash/context7-mcp@latest'],
      env: context7ApiKey
        ? {
            CONTEXT7_API_KEY: context7ApiKey,
          }
        : undefined,
    };
  }

  if (serverName === 'coolify' && envEnabled('MCP_COOLIFY_ENABLED', true)) {
    const baseUrl = envValue('MCP_COOLIFY_BASE_URL') || envValue('COOLIFY_BASE_URL');
    const token =
      envValue('MCP_COOLIFY_TOKEN') ||
      envValue('COOLIFY_TOKEN') ||
      envValue('COOLIFY_API_TOKEN') ||
      envValue('COOLIFY_ACCESS_TOKEN');

    if (baseUrl && token) {
      return {
        command: npxCommand,
        args: ['-y', envValue('MCP_COOLIFY_PACKAGE') || 'coolify-mcp-server@latest'],
        env: {
          COOLIFY_BASE_URL: baseUrl,
          COOLIFY_TOKEN: token,
        },
      };
    }
  }

  if (serverName === 'perplexity' && envEnabled('MCP_PERPLEXITY_ENABLED', true)) {
    const apiKey = envValue('MCP_PERPLEXITY_API_KEY') || envValue('PERPLEXITY_API_KEY');

    if (apiKey) {
      return {
        command: npxCommand,
        args: ['-y', envValue('MCP_PERPLEXITY_PACKAGE') || '@perplexity-ai/mcp-server'],
        env: {
          PERPLEXITY_API_KEY: apiKey,
        },
      };
    }
  }

  return null;
}

function sanitizeMCPBridgeLog(value) {
  let text = String(value || '');

  for (const key of [
    'MCP_COOLIFY_TOKEN',
    'COOLIFY_TOKEN',
    'COOLIFY_API_TOKEN',
    'COOLIFY_ACCESS_TOKEN',
    'CONTEXT7_API_KEY',
    'MCP_PERPLEXITY_API_KEY',
    'PERPLEXITY_API_KEY',
  ]) {
    const secret = envValue(key);

    if (secret) {
      text = text.split(secret).join('***');
    }
  }

  return text.trim().slice(0, 2000);
}

async function createMCPBridgeUpstream(serverName) {
  const config = mcpBridgeServerConfig(serverName);

  if (!config) {
    throw new Error(`MCP bridge server "${serverName}" is not configured`);
  }

  console.log(`Starting MCP bridge upstream "${serverName}" with command "${config.command}"`);

  const transport = new StdioClientTransport({
    command: config.command,
    args: config.args,
    cwd: config.cwd,
    env: {
      ...process.env,
      ...(config.env || {}),
    },
    stderr: 'pipe',
  });

  const stderr = transport.stderr;

  if (stderr) {
    stderr.on('data', (chunk) => {
      const sanitized = sanitizeMCPBridgeLog(chunk);

      if (sanitized) {
        console.error(`[mcp-bridge:${serverName}] ${sanitized}`);
      }
    });
  }

  const client = new MCPClient({
    name: `bolt-mcp-bridge-${serverName}`,
    version: '1.0.0',
  });

  transport.onclose = () => {
    mcpBridgeUpstreams.delete(serverName);
    console.log(`MCP bridge upstream "${serverName}" closed`);
  };
  transport.onerror = (error) => {
    console.error(`MCP bridge upstream "${serverName}" error:`, error);
  };

  await client.connect(transport);

  return { client, transport };
}

async function getMCPBridgeUpstream(serverName) {
  const existing = mcpBridgeUpstreams.get(serverName);

  if (existing) {
    return existing;
  }

  const pending = createMCPBridgeUpstream(serverName).catch((error) => {
    mcpBridgeUpstreams.delete(serverName);
    throw error;
  });

  mcpBridgeUpstreams.set(serverName, pending);

  return pending;
}

function requestHeader(request, name) {
  const value = request.headers[name.toLowerCase()];

  return Array.isArray(value) ? value[0] : value;
}

function isLoopbackAddress(value) {
  return ['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(String(value || ''));
}

function isLocalMCPBridgeRequest(request) {
  return isLoopbackAddress(request.socket?.remoteAddress);
}

function requestContainsInitialize(body) {
  const messages = Array.isArray(body) ? body : [body];

  return messages.some((message) => {
    try {
      return isInitializeRequest(message);
    } catch {
      return false;
    }
  });
}

async function createMCPBridgeSession(serverName) {
  let sessionId = '';
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: () => randomUUID(),
    enableJsonResponse: true,
    onsessioninitialized: (id) => {
      sessionId = id;
      mcpBridgeSessions.set(id, session);
    },
    onsessionclosed: (id) => {
      mcpBridgeSessions.delete(id);
    },
  });

  const protocolServer = new MCPProtocolServer(
    {
      name: `bolt-mcp-bridge-${serverName}`,
      version: '1.0.0',
    },
    {
      capabilities: {
        tools: {},
      },
    },
  );

  protocolServer.setRequestHandler(ListToolsRequestSchema, async (request) => {
    const upstream = await getMCPBridgeUpstream(serverName);

    return upstream.client.listTools(request.params);
  });

  protocolServer.setRequestHandler(CallToolRequestSchema, async (request) => {
    const upstream = await getMCPBridgeUpstream(serverName);

    return upstream.client.callTool(request.params);
  });

  const session = {
    serverName,
    transport,
    protocolServer,
  };

  transport.onclose = () => {
    if (sessionId) {
      mcpBridgeSessions.delete(sessionId);
    }

    protocolServer.close().catch((error) => {
      console.error(`Failed to close MCP bridge session "${serverName}":`, error);
    });
  };
  transport.onerror = (error) => {
    console.error(`MCP bridge transport "${serverName}" error:`, error);
  };

  await protocolServer.connect(transport);

  return session;
}

function readUsers() {
  if (!existsSync(usersPath)) {
    return { version: 1, users: [] };
  }

  try {
    const data = JSON.parse(readFileSync(usersPath, 'utf8'));

    if (!Array.isArray(data.users)) {
      throw new Error('Invalid users file');
    }

    return data;
  } catch (error) {
    console.error('Failed to read auth users:', error);
    return { version: 1, users: [] };
  }
}

function writeUsers(data) {
  mkdirSync(dirname(usersPath), { recursive: true });

  const tmpPath = `${usersPath}.${process.pid}.tmp`;
  writeFileSync(tmpPath, JSON.stringify(data, null, 2), { mode: 0o600 });
  renameSync(tmpPath, usersPath);
}

function usersConfigured() {
  return readUsers().users.length > 0;
}

function normalizeLogin(value) {
  return String(value || '').trim().toLowerCase();
}

function hashPassword(password) {
  const salt = randomBytes(16).toString('base64url');
  const n = 16384;
  const r = 8;
  const p = 1;
  const hash = scryptSync(password, salt, 64, { N: n, r, p, maxmem: 64 * 1024 * 1024 }).toString('base64url');

  return `scrypt$${n}$${r}$${p}$${salt}$${hash}`;
}

function verifyPassword(password, storedHash) {
  const [scheme, n, r, p, salt, expected] = String(storedHash || '').split('$');

  if (scheme !== 'scrypt' || !n || !r || !p || !salt || !expected) {
    return false;
  }

  const actual = scryptSync(password, salt, 64, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
    maxmem: 64 * 1024 * 1024,
  });
  const expectedBuffer = Buffer.from(expected, 'base64url');

  return expectedBuffer.length === actual.length && timingSafeEqual(expectedBuffer, actual);
}

function bootstrapPasswordHash() {
  const encodedHash = String(
    process.env.AUTH_ADMIN_PASSWORD_HASH_B64 || process.env.AUTH_BOOTSTRAP_PASSWORD_HASH_B64 || '',
  ).trim();

  if (encodedHash) {
    return Buffer.from(encodedHash, 'base64url').toString('utf8');
  }

  const configuredHash = String(process.env.AUTH_ADMIN_PASSWORD_HASH || process.env.AUTH_BOOTSTRAP_PASSWORD_HASH || '').trim();

  if (configuredHash) {
    return configuredHash;
  }

  const configuredPassword = String(process.env.AUTH_ADMIN_PASSWORD || process.env.AUTH_BOOTSTRAP_PASSWORD || '');

  if (configuredPassword) {
    return hashPassword(configuredPassword);
  }

  return '';
}

function ensureBootstrapAdmin() {
  const passwordHash = bootstrapPasswordHash();

  if (!passwordHash) {
    return;
  }

  const login = normalizeLogin(process.env.AUTH_ADMIN_LOGIN || process.env.AUTH_BOOTSTRAP_LOGIN || 'admin');

  if (login.length < 3) {
    throw new Error('AUTH_ADMIN_LOGIN must be at least 3 characters');
  }

  const syncExisting = process.env.AUTH_ADMIN_SYNC === 'true' || process.env.AUTH_BOOTSTRAP_SYNC === 'true';
  const store = readUsers();
  const existingIndex = store.users.findIndex((item) => item.login === login);
  const now = new Date().toISOString();

  if (existingIndex >= 0) {
    if (!syncExisting) {
      return;
    }

    store.users[existingIndex] = {
      ...store.users[existingIndex],
      role: 'admin',
      passwordHash,
      updatedAt: now,
    };
    writeUsers(store);
    console.log(`Synced bootstrap admin ${login}`);

    return;
  }

  if (store.users.length > 0 && process.env.AUTH_ADMIN_CREATE_IF_MISSING === 'false') {
    return;
  }

  store.users.push({
    id: randomBytes(16).toString('base64url'),
    login,
    role: 'admin',
    passwordHash,
    createdAt: now,
  });
  writeUsers(store);
  console.log(`Created bootstrap admin ${login}`);
}

ensureBootstrapAdmin();

function signPayload(payload) {
  return createHmac('sha256', sessionSecret).update(payload).digest('base64url');
}

function createSessionCookie(user, request) {
  const now = Math.floor(Date.now() / 1000);
  const payload = base64url(
    JSON.stringify({
      sub: user.id,
      login: user.login,
      role: user.role,
      iat: now,
      exp: now + sessionTtlSeconds,
    }),
  );
  const signature = signPayload(payload);
  const secure = isSecureRequest(request) ? '; Secure' : '';

  return `${cookieName}=${payload}.${signature}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${sessionTtlSeconds}${secure}`;
}

function clearSessionCookie(request) {
  const secure = isSecureRequest(request) ? '; Secure' : '';

  return `${cookieName}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

function parseCookies(cookieHeader = '') {
  const cookies = new Map();

  for (const item of cookieHeader.split(';')) {
    const index = item.indexOf('=');

    if (index === -1) {
      continue;
    }

    const key = decodeURIComponent(item.slice(0, index).trim());
    const value = decodeURIComponent(item.slice(index + 1).trim());
    cookies.set(key, value);
  }

  return cookies;
}

function getSessionUser(request) {
  const cookie = parseCookies(request.headers.cookie || '').get(cookieName);

  if (!cookie) {
    return null;
  }

  const [payload, signature] = cookie.split('.');

  if (!payload || !signature || signPayload(payload) !== signature) {
    return null;
  }

  try {
    const session = JSON.parse(fromBase64url(payload));

    if (!session.exp || session.exp < Math.floor(Date.now() / 1000)) {
      return null;
    }

    const user = readUsers().users.find((item) => item.id === session.sub);

    if (!user) {
      return null;
    }

    return {
      id: user.id,
      login: user.login,
      role: user.role,
    };
  } catch {
    return null;
  }
}

function isSecureRequest(request) {
  return (
    request.socket.encrypted ||
    request.headers['x-forwarded-proto'] === 'https' ||
    process.env.AUTH_COOKIE_SECURE === 'true'
  );
}

function isAllowedOrigin(request) {
  const origin = request.headers.origin;

  if (!origin) {
    return true;
  }

  try {
    return new URL(origin).host === request.headers.host;
  } catch {
    return false;
  }
}

function send(res, status, body, headers = {}) {
  const responseHeaders = {
    'Cache-Control': 'no-store',
    ...headers,
  };

  if (typeof body === 'string') {
    responseHeaders['Content-Length'] = Buffer.byteLength(body);
  }

  res.writeHead(status, responseHeaders);
  res.end(body);
}

function redirect(res, location, cookies = []) {
  const headers = {
    Location: location,
    'Cache-Control': 'no-store',
  };

  if (cookies.length > 0) {
    headers['Set-Cookie'] = cookies;
  }

  res.writeHead(302, headers);
  res.end();
}

function wantsHtml(request) {
  return (request.headers.accept || '').includes('text/html');
}

function publicAsset(pathname) {
  return (
    pathname === '/favicon.ico' ||
    pathname === '/favicon.svg' ||
    pathname === '/apple-touch-icon.png' ||
    pathname === '/apple-touch-icon-precomposed.png' ||
    pathname.startsWith('/assets/') ||
    pathname.startsWith('/icons/') ||
    pathname.startsWith('/logo')
  );
}

function page(title, content) {
  return `<!doctype html>
<html lang="ru">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>${escapeHtml(title)}</title>
  <style>
    :root { color-scheme: dark; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
    body { min-height: 100vh; margin: 0; display: grid; place-items: center; background: #0e1117; color: #f7f8fa; }
    main { width: min(420px, calc(100vw - 32px)); border: 1px solid #2b313b; border-radius: 8px; background: #151922; padding: 28px; box-shadow: 0 18px 60px rgba(0,0,0,.36); }
    h1 { margin: 0 0 8px; font-size: 24px; line-height: 1.2; }
    p { margin: 0 0 22px; color: #aab2c0; line-height: 1.5; }
    label { display: grid; gap: 7px; margin-bottom: 14px; color: #d5d9e2; font-size: 14px; }
    input { height: 42px; border: 1px solid #384151; border-radius: 6px; background: #0f131a; color: #f7f8fa; padding: 0 12px; font: inherit; }
    input:focus { outline: 2px solid #4c8dff; outline-offset: 1px; border-color: #4c8dff; }
    button { width: 100%; height: 42px; border: 0; border-radius: 6px; background: #4c8dff; color: white; font: inherit; font-weight: 700; cursor: pointer; }
    button:hover { background: #397cf2; }
    a { color: #8ab4ff; }
    .error { margin: 0 0 16px; color: #ff9a9a; }
    .hint { margin-top: 16px; font-size: 14px; }
  </style>
</head>
<body>
  <main>${content}</main>
</body>
</html>`;
}

function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function authFormSafe({ mode, error = '' }) {
  const isRegister = mode === 'register';
  const title = isRegister ? 'Создать администратора' : 'Вход в Bolt';
  const description = isRegister
    ? 'Это первая регистрация. Созданный пользователь станет администратором.'
    : 'Войди под администратором, чтобы продолжить.';
  const action = isRegister ? '/auth/register' : '/auth/login';

  return page(
    title,
    `
      <h1>${title}</h1>
      <p>${description}</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <form method="post" action="${action}">
        <label>
          Логин или email
          <input name="login" autocomplete="username" required autofocus />
        </label>
        <label>
          Пароль
          <input name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" minlength="8" required />
        </label>
        <button type="submit">${isRegister ? 'Создать админа' : 'Войти'}</button>
      </form>
      ${
        isRegister
          ? ''
          : '<p class="hint">Админа ещё нет? Открой <a href="/auth/register">первую регистрацию</a>.</p>'
      }
    `,
  );
}

function injectLogoutSafe(html, user) {
  const widget = `
<form method="post" action="/auth/logout" style="position:fixed;right:14px;top:14px;z-index:2147483647;margin:0">
  <button title="Sign out" style="border:1px solid rgba(255,255,255,.18);border-radius:6px;background:rgba(18,22,30,.88);color:#f7f8fa;height:34px;padding:0 12px;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.24);cursor:pointer">${escapeHtml(user.login)} | Logout</button>
</form>`;

  if (html.includes('</body>')) {
    return html.replace('</body>', `${widget}</body>`);
  }

  return `${html}${widget}`;
}

function authForm({ mode, error = '' }) {
  const isRegister = mode === 'register';
  const title = isRegister ? 'Create administrator' : 'Sign in to Bolt';
  const description = isRegister
    ? 'This is the first registration. The created user will become the administrator.'
    : 'Sign in with the administrator account to continue.';
  const action = isRegister ? '/auth/register' : '/auth/login';

  return page(
    title,
    `
      <h1>${title}</h1>
      <p>${description}</p>
      ${error ? `<div class="error">${escapeHtml(error)}</div>` : ''}
      <form method="post" action="${action}">
        <label>
          Login or email
          <input name="login" autocomplete="username" required autofocus />
        </label>
        <label>
          Password
          <input name="password" type="password" autocomplete="${isRegister ? 'new-password' : 'current-password'}" minlength="8" required />
        </label>
        <button type="submit">${isRegister ? 'Create admin' : 'Sign in'}</button>
      </form>
      ${
        isRegister
          ? ''
          : '<p class="hint">No admin yet? Open <a href="/auth/register">first registration</a>.</p>'
      }
    `,
  );
}

function injectLogout(html, user) {
  const cookieSanitizer = `
<script>
(() => {
  for (const name of ['apiKeys', 'providers']) {
    const row = document.cookie.split(';').map((item) => item.trim()).find((item) => item.startsWith(name + '='));

    if (!row) {
      continue;
    }

    try {
      JSON.parse(decodeURIComponent(row.slice(name.length + 1)));
    } catch {
      document.cookie = name + '=; Path=/; Max-Age=0; SameSite=Lax';
    }
  }
})();
</script>`;
  const widget = `
<form method="post" action="/auth/logout" style="position:fixed;right:14px;top:14px;z-index:2147483647;margin:0">
  <button title="Sign out" style="border:1px solid rgba(255,255,255,.18);border-radius:6px;background:rgba(18,22,30,.88);color:#f7f8fa;height:34px;padding:0 12px;font:600 13px Inter,system-ui,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.24);cursor:pointer">${escapeHtml(user.login)} | Logout</button>
</form>`;
  let nextHtml = html;

  if (nextHtml.includes('</head>')) {
    nextHtml = nextHtml.replace('</head>', `${cookieSanitizer}</head>`);
  } else {
    nextHtml = `${cookieSanitizer}${nextHtml}`;
  }

  if (nextHtml.includes('</body>')) {
    return nextHtml.replace('</body>', `${widget}</body>`);
  }

  return `${nextHtml}${widget}`;
}

function readBody(request, limit = maxBodyBytes) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let total = 0;

    request.on('data', (chunk) => {
      total += chunk.length;

      if (total > limit) {
        reject(new Error('Request body too large'));
        request.destroy();
        return;
      }

      chunks.push(chunk);
    });
    request.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    request.on('error', reject);
  });
}

async function readForm(request) {
  const body = await readBody(request);

  return new URLSearchParams(body);
}

async function handleAuth(request, res, pathname) {
  if (pathname === '/auth/health') {
    send(
      res,
      200,
      JSON.stringify({
        ok: true,
        usersConfigured: usersConfigured(),
      }),
      { 'Content-Type': 'application/json' },
    );
    return;
  }

  if (pathname === '/auth/status') {
    const user = getSessionUser(request);

    send(
      res,
      user ? 200 : 401,
      JSON.stringify({
        authenticated: Boolean(user),
        user,
        usersConfigured: usersConfigured(),
      }),
      { 'Content-Type': 'application/json' },
    );
    return;
  }

  if (pathname === '/auth/logout') {
    if (request.method !== 'POST' && request.method !== 'GET') {
      send(res, 405, 'Method not allowed');
      return;
    }

    redirect(res, '/auth/login', [clearSessionCookie(request)]);
    return;
  }

  if (pathname === '/auth/register') {
    if (usersConfigured()) {
      redirect(res, '/auth/login');
      return;
    }

    if (request.method === 'GET') {
      send(res, 200, authFormSafe({ mode: 'register' }), { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }

    if (request.method !== 'POST') {
      send(res, 405, 'Method not allowed');
      return;
    }

    if (!isAllowedOrigin(request)) {
      send(res, 403, 'Invalid origin');
      return;
    }

    const form = await readForm(request);
    const login = normalizeLogin(form.get('login'));
    const password = String(form.get('password') || '');

    if (login.length < 3 || password.length < 8) {
      send(res, 400, authFormSafe({ mode: 'register', error: 'Login must be at least 3 characters and password at least 8.' }), {
        'Content-Type': 'text/html; charset=utf-8',
      });
      return;
    }

    const store = readUsers();

    if (store.users.length > 0) {
      redirect(res, '/auth/login');
      return;
    }

    const user = {
      id: randomBytes(16).toString('base64url'),
      login,
      role: 'admin',
      passwordHash: hashPassword(password),
      createdAt: new Date().toISOString(),
    };

    writeUsers({ version: 1, users: [user] });
    redirect(res, '/', [createSessionCookie(user, request)]);
    return;
  }

  if (pathname === '/auth/login') {
    if (!usersConfigured()) {
      redirect(res, '/auth/register');
      return;
    }

    const existingUser = getSessionUser(request);

    if (request.method === 'GET' && existingUser) {
      redirect(res, '/');
      return;
    }

    if (request.method === 'GET') {
      send(res, 200, authFormSafe({ mode: 'login' }), { 'Content-Type': 'text/html; charset=utf-8' });
      return;
    }

    if (request.method !== 'POST') {
      send(res, 405, 'Method not allowed');
      return;
    }

    if (!isAllowedOrigin(request)) {
      send(res, 403, 'Invalid origin');
      return;
    }

    const form = await readForm(request);
    const login = normalizeLogin(form.get('login'));
    const password = String(form.get('password') || '');
    const user = readUsers().users.find((item) => item.login === login);

    if (!user || !verifyPassword(password, user.passwordHash)) {
      send(res, 401, authFormSafe({ mode: 'login', error: 'Invalid login or password.' }), {
        'Content-Type': 'text/html; charset=utf-8',
      });
      return;
    }

    redirect(res, '/', [createSessionCookie(user, request)]);
    return;
  }

  send(res, 404, 'Not found');
}

function unauthorized(request, res) {
  const location = usersConfigured() ? '/auth/login' : '/auth/register';

  if (wantsHtml(request)) {
    redirect(res, location);
    return;
  }

  send(
    res,
    401,
    JSON.stringify({
      error: 'Authentication required',
      loginUrl: location,
    }),
    { 'Content-Type': 'application/json' },
  );
}

function safeDecodeCookieValue(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

function isValidJsonCookieValue(value) {
  try {
    const parsed = JSON.parse(safeDecodeCookieValue(value));
    return parsed !== null && typeof parsed === 'object';
  } catch {
    return false;
  }
}

function sanitizeClientJsonCookies(cookieHeader = '') {
  const protectedNames = new Set(['apiKeys', 'providers']);
  const kept = [];

  for (const rawItem of String(cookieHeader).split(';')) {
    const item = rawItem.trim();

    if (!item) {
      continue;
    }

    const index = item.indexOf('=');

    if (index < 0) {
      kept.push(item);
      continue;
    }

    const name = safeDecodeCookieValue(item.slice(0, index).trim());
    const value = item.slice(index + 1).trim();

    if (protectedNames.has(name) && value && !isValidJsonCookieValue(value)) {
      continue;
    }

    kept.push(item);
  }

  return kept.join('; ');
}

async function handleMCPBridge(request, res, url) {
  if (!isLocalMCPBridgeRequest(request)) {
    send(res, 404, 'Not found');
    return;
  }

  const serverName = decodeURIComponent(url.pathname.slice('/__bolt-mcp/'.length).split('/')[0] || '');

  if (!serverName || !mcpBridgeServerConfig(serverName)) {
    send(res, 404, 'MCP bridge server not configured');
    return;
  }

  const sessionId = requestHeader(request, 'mcp-session-id');
  const existingSession = sessionId ? mcpBridgeSessions.get(sessionId) : null;

  if (request.method === 'GET' || request.method === 'DELETE') {
    if (!existingSession || existingSession.serverName !== serverName) {
      send(res, 405, 'Method not allowed');
      return;
    }

    await existingSession.transport.handleRequest(request, res);
    return;
  }

  if (request.method !== 'POST') {
    send(res, 405, 'Method not allowed');
    return;
  }

  let parsedBody;

  try {
    parsedBody = JSON.parse(await readBody(request, mcpBridgeMaxBodyBytes));
  } catch (error) {
    send(
      res,
      400,
      JSON.stringify({
        jsonrpc: '2.0',
        error: {
          code: -32700,
          message: 'Parse error',
          data: String(error),
        },
        id: null,
      }),
      { 'Content-Type': 'application/json' },
    );
    return;
  }

  let session = existingSession;

  if (session && session.serverName !== serverName) {
    send(res, 404, 'MCP bridge session not found');
    return;
  }

  if (!session) {
    if (!requestContainsInitialize(parsedBody)) {
      send(
        res,
        400,
        JSON.stringify({
          jsonrpc: '2.0',
          error: {
            code: -32000,
            message: 'Bad Request: No valid MCP session',
          },
          id: null,
        }),
        { 'Content-Type': 'application/json' },
      );
      return;
    }

    session = await createMCPBridgeSession(serverName);
  }

  await session.transport.handleRequest(request, res, parsedBody);
}

function copyRequestHeaders(request) {
  const headers = new Headers();
  const skip = new Set([
    'accept-encoding',
    'connection',
    'host',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
    'upgrade',
  ]);

  for (const [key, value] of Object.entries(request.headers)) {
    const lowerKey = key.toLowerCase();

    if (!value || skip.has(lowerKey) || lowerKey.startsWith('x-bolt-auth-')) {
      continue;
    }

    if (lowerKey === 'cookie') {
      const sanitizedCookie = sanitizeClientJsonCookies(Array.isArray(value) ? value.join('; ') : value);

      if (sanitizedCookie) {
        headers.set(key, sanitizedCookie);
      }

      continue;
    }

    if (Array.isArray(value)) {
      for (const item of value) {
        headers.append(key, item);
      }
    } else {
      headers.set(key, value);
    }
  }

  headers.set('x-forwarded-host', request.headers.host || '');
  headers.set('x-forwarded-proto', request.headers['x-forwarded-proto'] || (request.socket.encrypted ? 'https' : 'http'));

  return headers;
}

async function proxyToBolt(request, res, user) {
  const requestUrl = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);
  const target = new URL(`${requestUrl.pathname}${requestUrl.search}`, upstream);
  const method = request.method || 'GET';
  const init = {
    method,
    headers: copyRequestHeaders(request),
    redirect: 'manual',
  };

  if (user?.login) {
    init.headers.set('x-bolt-auth-login', user.login);
    init.headers.set('x-bolt-auth-role', user.role || '');
  }

  if (method !== 'GET' && method !== 'HEAD') {
    init.body = request;
    init.duplex = 'half';
  }

  let upstreamResponse;

  try {
    upstreamResponse = await fetch(target, init);
  } catch (error) {
    console.error('Bolt upstream request failed:', error);
    send(res, 502, 'Bolt is starting. Try again in a few seconds.');
    return;
  }

  const contentType = upstreamResponse.headers.get('content-type') || '';
  const shouldInjectLogout = contentType.includes('text/html') && upstreamResponse.status < 400;

  if (shouldInjectLogout) {
    const html = await upstreamResponse.text();
    const injected = injectLogoutSafe(html, user);
    const headers = copyResponseHeaders(upstreamResponse, { skipContentLength: true });
    headers['Content-Length'] = Buffer.byteLength(injected);
    res.writeHead(upstreamResponse.status, headers);
    res.end(injected);
    return;
  }

  const headers = copyResponseHeaders(upstreamResponse);
  res.writeHead(upstreamResponse.status, headers);

  if (!upstreamResponse.body) {
    res.end();
    return;
  }

  Readable.fromWeb(upstreamResponse.body).pipe(res);
}

function copyResponseHeaders(response, options = {}) {
  const headers = {};
  const skip = new Set([
    'connection',
    'content-encoding',
    'content-length',
    'keep-alive',
    'proxy-authenticate',
    'proxy-authorization',
    'te',
    'trailer',
    'transfer-encoding',
  ]);

  if (options.skipContentLength) {
    skip.add('content-length');
  }

  for (const [key, value] of response.headers.entries()) {
    if (skip.has(key.toLowerCase())) {
      continue;
    }

    headers[key] = value;
  }

  headers['Cache-Control'] = 'no-store';

  if (typeof response.headers.getSetCookie === 'function') {
    const cookies = response.headers.getSetCookie();

    if (cookies.length > 0) {
      headers['set-cookie'] = cookies;
    }
  }

  return headers;
}

const server = createServer(async (request, res) => {
  const url = new URL(request.url || '/', `http://${request.headers.host || 'localhost'}`);

  try {
    if (url.pathname.startsWith('/__bolt-mcp/')) {
      await handleMCPBridge(request, res, url);
      return;
    }

    if (url.pathname.startsWith('/auth/')) {
      await handleAuth(request, res, url.pathname);
      return;
    }

    if (publicAsset(url.pathname)) {
      await proxyToBolt(request, res, { login: '' });
      return;
    }

    const user = getSessionUser(request);

    if (!user) {
      unauthorized(request, res);
      return;
    }

    await proxyToBolt(request, res, user);
  } catch (error) {
    console.error('Auth proxy error:', error);
    send(res, 500, 'Internal authentication error');
  }
});

server.listen(port, '0.0.0.0', () => {
  console.log(`Bolt auth proxy listening on 0.0.0.0:${port}, upstream ${upstream}`);
});
