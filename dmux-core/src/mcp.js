/**
 * MCP config parsing + validation — Wave 3D Slice 1.
 *
 * The on-disk format matches Claude Code's expected .mcp.json shape:
 *
 *   {
 *     "mcpServers": {
 *       "<name>": {
 *         "command": "npx",
 *         "args": ["-y", "@modelcontextprotocol/server-github"],
 *         "env": {
 *           "GITHUB_PERSONAL_ACCESS_TOKEN": "keychain:dmux-mcp/<project>:github"
 *         }
 *       }
 *     }
 *   }
 *
 * dmux-specific extension: env values must be SENTINELS, never plaintext.
 * Two sentinel forms are supported:
 *
 *   keychain:<service>/<account>:<key>   — read from macOS Keychain at launch
 *   env:VAR_NAME                          — read from process env at launch
 *
 * The launch wrapper (dmux.sh _resolve-mcp-env) resolves both forms to real
 * values just before invoking the agent. Plaintext secrets in env values are
 * rejected by parseMcpConfig — explicit policy per wave-3d.md §1.3.
 */

export const MCP_SECRET_PREFIX_KEYCHAIN = 'keychain:';
export const MCP_SECRET_PREFIX_ENV = 'env:';

export class McpConfigError extends Error {
  constructor(message, { field, server } = {}) {
    super(message);
    this.name = 'McpConfigError';
    this.field = field;
    this.server = server;
  }
}

/**
 * Parse + validate the MCP config JSON string. Returns a normalized object
 * shaped like the input. Throws McpConfigError on any schema violation,
 * including plaintext env values.
 */
export function parseMcpConfig(jsonText) {
  let raw;
  try {
    raw = JSON.parse(jsonText);
  } catch (e) {
    throw new McpConfigError(`Invalid JSON: ${e.message}`);
  }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new McpConfigError('Top-level must be a JSON object');
  }

  const servers = raw.mcpServers;
  if (servers != null && (typeof servers !== 'object' || Array.isArray(servers))) {
    throw new McpConfigError("'mcpServers' must be an object", { field: 'mcpServers' });
  }
  const normalizedServers = {};
  for (const [name, server] of Object.entries(servers ?? {})) {
    normalizedServers[name] = validateServer(name, server);
  }

  return { mcpServers: normalizedServers };
}

function validateServer(name, server) {
  if (!server || typeof server !== 'object' || Array.isArray(server)) {
    throw new McpConfigError(`Server '${name}' must be an object`, { server: name });
  }
  if (typeof server.command !== 'string' || server.command.trim() === '') {
    throw new McpConfigError(
      `Server '${name}' needs a non-empty 'command'`,
      { server: name, field: 'command' },
    );
  }
  const args = server.args ?? [];
  if (!Array.isArray(args) || args.some((a) => typeof a !== 'string')) {
    throw new McpConfigError(
      `Server '${name}': 'args' must be an array of strings`,
      { server: name, field: 'args' },
    );
  }
  const env = server.env ?? {};
  if (typeof env !== 'object' || env == null || Array.isArray(env)) {
    throw new McpConfigError(
      `Server '${name}': 'env' must be an object`,
      { server: name, field: 'env' },
    );
  }
  for (const [key, value] of Object.entries(env)) {
    if (typeof value !== 'string') {
      throw new McpConfigError(
        `Server '${name}': env value for '${key}' must be a string`,
        { server: name, field: `env.${key}` },
      );
    }
    if (!isSecretSentinel(value)) {
      throw new McpConfigError(
        `Server '${name}': env value for '${key}' must be a sentinel ` +
          `(${MCP_SECRET_PREFIX_KEYCHAIN}... or ${MCP_SECRET_PREFIX_ENV}...) — ` +
          'plaintext secrets are not allowed in .dmux/mcp.json',
        { server: name, field: `env.${key}` },
      );
    }
  }
  return { command: server.command, args, env };
}

function isSecretSentinel(value) {
  return value.startsWith(MCP_SECRET_PREFIX_KEYCHAIN) || value.startsWith(MCP_SECRET_PREFIX_ENV);
}

/**
 * Walk a parsed config and return the flat list of secret references that
 * need resolving at launch time. Used by both the resolver (to know what to
 * look up) and the pre-flight check (to know what could fail).
 */
export function extractSecretRefs(config) {
  const refs = [];
  for (const [serverName, server] of Object.entries(config.mcpServers ?? {})) {
    for (const [envKey, value] of Object.entries(server.env ?? {})) {
      if (value.startsWith(MCP_SECRET_PREFIX_KEYCHAIN)) {
        refs.push({ serverName, envKey, kind: 'keychain', spec: value.slice(MCP_SECRET_PREFIX_KEYCHAIN.length) });
      } else if (value.startsWith(MCP_SECRET_PREFIX_ENV)) {
        refs.push({ serverName, envKey, kind: 'env', spec: value.slice(MCP_SECRET_PREFIX_ENV.length) });
      }
    }
  }
  return refs;
}
