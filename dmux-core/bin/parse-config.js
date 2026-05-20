#!/usr/bin/env node
// Usage: dmux-parse-config <project-path>
//
// Exits:
//   0 — success, JSON written to stdout
//   1 — usage error (missing argument)
//   2 — no .dmux-agents.yml found at the given path
//   3 — parse / validation error (message written to stderr)

import { loadAgentsConfig, ConfigError } from '../src/config.js';

const [, , projectPath] = process.argv;

if (!projectPath) {
  process.stderr.write('Usage: dmux-parse-config <project-path>\n');
  process.exit(1);
}

try {
  const config = loadAgentsConfig(projectPath);
  if (config == null) {
    process.stderr.write(`No .dmux-agents.yml found at ${projectPath}\n`);
    process.exit(2);
  }
  process.stdout.write(JSON.stringify(config, null, 2) + '\n');
} catch (e) {
  if (e instanceof ConfigError) {
    const where = e.agent ? ` (agent: ${e.agent})` : '';
    process.stderr.write(`Config error${where}: ${e.message}\n`);
  } else {
    process.stderr.write(`Unexpected error: ${e.message}\n`);
  }
  process.exit(3);
}
