/**
 * macOS Keychain helpers — Wave 3D Slice 3.
 *
 * Thin wrappers around the `security` CLI for storing MCP secrets without
 * ever writing plaintext to .dmux/mcp.json. Non-macOS systems fall through
 * to env-var indirection at the call site (see addMcpServer); this module
 * is only used when secretsBackend() === 'keychain'.
 *
 * Sentinel format dmux stores in .dmux/mcp.json:
 *   keychain:dmux-mcp/<projectName>:<serverName>:<envKey>
 *                ^service        ^account (composite)
 *
 * Service is always 'dmux-mcp' by convention. Account is composite so
 * collisions across projects can't overwrite each other (wave-3d.md §6.2).
 */

import { execFileSync, spawnSync } from 'child_process';

const KEYCHAIN_SERVICE = 'dmux-mcp';

/**
 * Detect which secrets backend is available:
 *   - 'keychain' — macOS + `security` CLI on PATH
 *   - 'env'      — everything else (env-var indirection)
 *
 * Memoized on first call; the platform / PATH don't change at runtime.
 */
let _cachedBackend = null;
export function secretsBackend() {
  if (_cachedBackend) return _cachedBackend;
  if (process.platform !== 'darwin') {
    _cachedBackend = 'env';
    return _cachedBackend;
  }
  const res = spawnSync('security', ['-h'], { stdio: 'ignore' });
  _cachedBackend = res.status === 0 || res.signal === null ? 'keychain' : 'env';
  // spawnSync sets res.error when the binary isn't found.
  if (res.error) _cachedBackend = 'env';
  return _cachedBackend;
}

/**
 * Build the keychain account string. Composite to disambiguate across
 * (project, server, envKey).
 */
function accountFor(projectName, serverName, envKey) {
  return `${projectName}:${serverName}:${envKey}`;
}

/**
 * Build the sentinel string that goes into .dmux/mcp.json.
 */
export function keychainSentinel(projectName, serverName, envKey) {
  return `keychain:${KEYCHAIN_SERVICE}/${accountFor(projectName, serverName, envKey)}`;
}

/**
 * Parse a sentinel produced by keychainSentinel back into { service,
 * account }. Returns null if the spec doesn't match the expected shape.
 */
export function parseKeychainSentinel(spec) {
  // spec is the part after "keychain:" — e.g. "dmux-mcp/myproj:github:GITHUB_TOKEN"
  const slash = spec.indexOf('/');
  if (slash <= 0 || slash === spec.length - 1) return null;
  return {
    service: spec.slice(0, slash),
    account: spec.slice(slash + 1),
  };
}

/**
 * Write a secret to the Keychain. Updates the existing entry if any (-U).
 * Throws if `security` exits non-zero. macOS-only — caller is responsible
 * for checking secretsBackend() before calling.
 */
export function writeKeychainSecret(projectName, serverName, envKey, secret) {
  const account = accountFor(projectName, serverName, envKey);
  try {
    execFileSync(
      'security',
      ['add-generic-password', '-U', '-s', KEYCHAIN_SERVICE, '-a', account, '-w', secret],
      { stdio: 'pipe' },
    );
  } catch (e) {
    const stderr = e.stderr ? e.stderr.toString() : '';
    throw new Error(`Keychain write failed for ${account}: ${stderr || e.message}`);
  }
}

/**
 * Delete a keychain entry by sentinel. Idempotent — silently succeeds when
 * the entry doesn't exist (security exits 44 in that case; we treat it as
 * success since the desired end state matches).
 */
export function deleteKeychainSecret(sentinelSpec) {
  const parsed = parseKeychainSentinel(sentinelSpec);
  if (!parsed) return;
  const res = spawnSync(
    'security',
    ['delete-generic-password', '-s', parsed.service, '-a', parsed.account],
    { stdio: 'pipe' },
  );
  // Exit 44 = "specified item could not be found in the keychain" — fine.
  if (res.status !== 0 && res.status !== 44) {
    // Don't throw — failing to clean up keychain shouldn't block removing
    // a server from the config. Just log to stderr.
    const stderr = res.stderr ? res.stderr.toString() : '';
    console.warn(`keychain cleanup non-fatal: ${stderr || `exit ${res.status}`}`);
  }
}
