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

import { readFileSync, writeFileSync, existsSync, mkdirSync, renameSync } from 'fs';
import { join } from 'path';
import {
  parseMcpConfig,
  extractSecretRefs,
  McpConfigError,
} from '../../../dmux-core/src/mcp.js';

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

export { McpConfigError };
