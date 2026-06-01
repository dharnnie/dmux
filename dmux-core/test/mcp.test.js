import { describe, it, expect } from 'vitest';
import {
  parseMcpConfig,
  extractSecretRefs,
  McpConfigError,
} from '../src/mcp.js';

describe('parseMcpConfig', () => {
  it('parses a minimal valid config', () => {
    const json = '{"mcpServers":{}}';
    const result = parseMcpConfig(json);
    expect(result.mcpServers).toEqual({});
  });

  it('parses a github server with a keychain sentinel', () => {
    const json = JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-github'],
          env: {
            GITHUB_PERSONAL_ACCESS_TOKEN: 'keychain:dmux-mcp/myproj:github',
          },
        },
      },
    });
    const result = parseMcpConfig(json);
    expect(result.mcpServers.github.command).toBe('npx');
    expect(result.mcpServers.github.env.GITHUB_PERSONAL_ACCESS_TOKEN)
      .toBe('keychain:dmux-mcp/myproj:github');
  });

  it('parses an env: sentinel', () => {
    const json = JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', 'server'],
          env: { GITHUB_TOKEN: 'env:GITHUB_TOKEN' },
        },
      },
    });
    const result = parseMcpConfig(json);
    expect(result.mcpServers.github.env.GITHUB_TOKEN).toBe('env:GITHUB_TOKEN');
  });

  it('accepts a server with no env block', () => {
    const json = JSON.stringify({
      mcpServers: {
        filesystem: {
          command: 'npx',
          args: ['-y', 'server-fs', '/tmp/sandbox'],
        },
      },
    });
    const result = parseMcpConfig(json);
    expect(result.mcpServers.filesystem.env).toEqual({});
  });

  it('rejects plaintext env values', () => {
    const json = JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx',
          args: ['-y', 'server'],
          env: { GITHUB_TOKEN: 'ghp_abc123def456' },
        },
      },
    });
    expect(() => parseMcpConfig(json)).toThrow(McpConfigError);
    expect(() => parseMcpConfig(json)).toThrow(/plaintext secrets are not allowed/);
  });

  it('rejects servers missing a command', () => {
    const json = JSON.stringify({
      mcpServers: { broken: { args: [] } },
    });
    expect(() => parseMcpConfig(json)).toThrow(/needs a non-empty 'command'/);
  });

  it('rejects args that are not strings', () => {
    const json = JSON.stringify({
      mcpServers: { broken: { command: 'x', args: ['ok', 42] } },
    });
    expect(() => parseMcpConfig(json)).toThrow(/'args' must be an array of strings/);
  });

  it('rejects malformed JSON cleanly', () => {
    expect(() => parseMcpConfig('not json')).toThrow(/Invalid JSON/);
  });

  it('rejects array at top level', () => {
    expect(() => parseMcpConfig('[]')).toThrow(/Top-level must be a JSON object/);
  });

  it('accepts empty / missing mcpServers', () => {
    expect(parseMcpConfig('{}')).toEqual({ mcpServers: {} });
  });
});

describe('extractSecretRefs', () => {
  it('returns a flat list of refs across servers', () => {
    const config = parseMcpConfig(JSON.stringify({
      mcpServers: {
        github: {
          command: 'npx', args: ['-y', 'gh'],
          env: { GITHUB_TOKEN: 'keychain:dmux-mcp/p:github' },
        },
        linear: {
          command: 'npx', args: ['-y', 'linear'],
          env: { LINEAR_API_KEY: 'env:LINEAR_KEY' },
        },
      },
    }));
    const refs = extractSecretRefs(config);
    expect(refs).toHaveLength(2);
    expect(refs).toContainEqual({
      serverName: 'github', envKey: 'GITHUB_TOKEN',
      kind: 'keychain', spec: 'dmux-mcp/p:github',
    });
    expect(refs).toContainEqual({
      serverName: 'linear', envKey: 'LINEAR_API_KEY',
      kind: 'env', spec: 'LINEAR_KEY',
    });
  });

  it('returns an empty list when no env blocks exist', () => {
    const config = parseMcpConfig(JSON.stringify({
      mcpServers: { fs: { command: 'npx', args: ['-y', 'fs'] } },
    }));
    expect(extractSecretRefs(config)).toEqual([]);
  });
});
