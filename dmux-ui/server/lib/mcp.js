/**
 * MCP config read/write helpers — Wave 3D Slice 1.
 *
 * Stores per-project config at `<projectPath>/.dmux/mcp.json`. Atomic write
 * via tmpfile + rename, same pattern as Wave 2D's chat storage.
 *
 * Read/write only in this slice — the catalogue + UI add/remove endpoints
 * come in Slice 2; keychain integration comes in Slice 3. parseMcpConfig
 * from dmux-core enforces the no-plaintext policy on the way in.
 */

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync, unlinkSync } from 'fs';
import { join } from 'path';
import {
  parseMcpConfig,
  extractSecretRefs,
  McpConfigError,
  MCP_SECRET_PREFIX_ENV,
} from '../../../dmux-core/src/mcp.js';
import { getCatalogueEntry } from './mcp-catalogue.js';

const MCP_CONFIG_REL = '.dmux/mcp.json';

function mcpConfigPath(projectPath) {
  return join(projectPath, MCP_CONFIG_REL);
}

/**
 * Read + validate the project's MCP config. Returns the parsed config or
 * null if no file exists. Throws McpConfigError if the file exists but is
 * invalid.
 */
export function readMcpConfig(projectPath) {
  const path = mcpConfigPath(projectPath);
  if (!existsSync(path)) return null;
  const text = readFileSync(path, 'utf-8');
  return parseMcpConfig(text);
}

/**
 * Atomically write a (validated) config to disk. Caller is responsible for
 * passing a config that already passes parseMcpConfig — we re-parse here
 * as a backstop so a malformed config never lands on disk.
 */
export function writeMcpConfig(projectPath, config) {
  // Re-validate by round-tripping through parseMcpConfig.
  const json = JSON.stringify(config, null, 2);
  parseMcpConfig(json);  // throws on error

  const dir = join(projectPath, '.dmux');
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const path = mcpConfigPath(projectPath);
  const tmp = path + '.tmp';
  writeFileSync(tmp, json);
  renameSync(tmp, path);
}

/**
 * Return a UI-safe view of the configured servers. For each server: name +
 * command + args + a flag per env key indicating whether the sentinel value
 * is keychain-backed or env-var-referenced (NEVER the secret itself).
 *
 * Returns `{ servers: [...] }`. Empty array when no config is present.
 */
export function listMcpServers(projectPath) {
  let config;
  try {
    config = readMcpConfig(projectPath);
  } catch (e) {
    if (e instanceof McpConfigError) {
      // Surface the schema error to the caller without crashing the request.
      return { servers: [], error: e.message };
    }
    throw e;
  }
  if (!config) return { servers: [] };

  const refs = extractSecretRefs(config);
  const servers = Object.entries(config.mcpServers).map(([name, server]) => {
    const credentials = (refs
      .filter((r) => r.serverName === name)
      .map((r) => ({ envKey: r.envKey, kind: r.kind, spec: r.spec })));
    return {
      name,
      command: server.command,
      args: server.args,
      credentials,  // never includes resolved secret values
    };
  });
  return { servers };
}

/**
 * Add a server from the catalogue. Body shape:
 *   catalogueName — slug
 *   envValues     — { ENV_KEY: env_var_name }   (Slice 2: env-var indirection)
 *   argValues     — { paramName: stringValue }  (positional installArgs)
 *
 * Validates everything up front, builds the server block, merges into the
 * existing config (or starts a fresh one), validates the merged config via
 * parseMcpConfig, persists. Throws .status on validation failures.
 */
export function addMcpServer(projectPath, { catalogueName, envValues = {}, argValues = {} } = {}) {
  if (typeof catalogueName !== 'string' || !catalogueName) {
    throw badRequest('catalogueName is required');
  }
  const entry = getCatalogueEntry(catalogueName);
  if (!entry) {
    throw badRequest(`Unknown catalogue entry: ${catalogueName}`);
  }

  // Validate required credentials are present + non-empty.
  for (const cred of entry.requiredCredentials) {
    const v = envValues[cred.envKey];
    if (typeof v !== 'string' || v.trim() === '') {
      throw badRequest(`Missing env var name for ${cred.envKey}`);
    }
    // Refuse anything that doesn't look like a conventional ALL_CAPS env
    // var name. Catches "pasted my token by mistake" — lowercase letters
    // in the value would normally be valid identifiers but break the
    // shell-env-name convention (and GitHub/OpenAI tokens are mixed case).
    if (!/^[A-Z_][A-Z0-9_]*$/.test(v.trim())) {
      throw badRequest(
        `'${v}' isn't a valid env-var name for ${cred.envKey}. Paste the NAME of an env var you'll set in your shell (ALL_CAPS, e.g. GITHUB_TOKEN), not the token itself.`,
      );
    }
  }

  // Validate required arg params.
  const filledArgs = [];
  for (const param of entry.argParams) {
    const v = argValues[param.name];
    if (typeof v !== 'string' || v.trim() === '') {
      throw badRequest(`Missing value for ${param.label || param.name}`);
    }
    filledArgs.push(v.trim());
  }

  // Build the server config block.
  const env = {};
  for (const cred of entry.requiredCredentials) {
    env[cred.envKey] = `${MCP_SECRET_PREFIX_ENV}${envValues[cred.envKey].trim()}`;
  }
  const serverBlock = {
    command: entry.installCommand,
    args: [...entry.installArgs, ...filledArgs],
  };
  if (Object.keys(env).length > 0) {
    serverBlock.env = env;
  }

  // Merge into the existing config.
  let config;
  try {
    config = readMcpConfig(projectPath);
  } catch (e) {
    if (e instanceof McpConfigError) {
      throw badRequest(
        `Existing .dmux/mcp.json is invalid: ${e.message}. Fix or remove it before adding a server.`,
      );
    }
    throw e;
  }
  const next = config ?? { mcpServers: {} };
  next.mcpServers = { ...next.mcpServers, [catalogueName]: serverBlock };

  writeMcpConfig(projectPath, next);  // re-validates as a backstop
  return listMcpServers(projectPath);
}

/**
 * Remove a server by name. Slice 3 also cleans up keychain entries for any
 * keychain: sentinels — v1's env: sentinels don't need cleanup since the
 * value lives only in the user's shell env.
 */
export function removeMcpServer(projectPath, serverName) {
  let config;
  try {
    config = readMcpConfig(projectPath);
  } catch (e) {
    if (e instanceof McpConfigError) {
      throw badRequest(`Existing .dmux/mcp.json is invalid: ${e.message}`);
    }
    throw e;
  }
  if (!config || !config.mcpServers || !(serverName in config.mcpServers)) {
    throw notFound(`Server '${serverName}' is not configured`);
  }

  const remaining = { ...config.mcpServers };
  delete remaining[serverName];
  config.mcpServers = remaining;

  // If no servers remain, delete the file entirely so dmux.sh's
  // file-exists check stops adding --mcp-config to launches.
  const path = join(projectPath, '.dmux/mcp.json');
  if (Object.keys(remaining).length === 0) {
    if (existsSync(path)) unlinkSync(path);
    return { servers: [] };
  }
  writeMcpConfig(projectPath, config);
  return listMcpServers(projectPath);
}

function badRequest(msg) {
  const e = new Error(msg);
  e.status = 400;
  return e;
}
function notFound(msg) {
  const e = new Error(msg);
  e.status = 404;
  return e;
}

export { McpConfigError };
