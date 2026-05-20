#!/usr/bin/env node
// Usage:
//   dmux-runs create <project-path>           — creates a new run, prints JSON
//                                                {id, dir, signalsDir}. Reads
//                                                .dmux-agents.yml for the
//                                                frozen config + agents summary.
//   dmux-runs mark-cleaned <project> <run-id> — marks a run cleaned.
//   dmux-runs mark-completed <project> <run-id>
//
// Env (create only):
//   DMUX_RUN_TRIGGER     — "manual" (default), "skill", or "nl"
//   DMUX_RUN_SKILL_NAME  — when DMUX_RUN_TRIGGER=skill
//
// Exits:
//   0 — success, JSON on stdout (create) or empty (mark-*)
//   1 — usage error
//   2 — file not found / project has no .dmux-agents.yml
//   3 — parse error or other failure

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createRun,
  markRunCleaned,
  markRunCompleted,
} from '../src/runs.js';
import { parseAgentsConfig, ConfigError } from '../src/config.js';

function usage() {
  process.stderr.write(
    'Usage:\n' +
      '  dmux-runs create <project-path>\n' +
      '  dmux-runs mark-cleaned <project-path> <run-id>\n' +
      '  dmux-runs mark-completed <project-path> <run-id>\n',
  );
}

const [, , cmd, ...args] = process.argv;

if (!cmd) {
  usage();
  process.exit(1);
}

try {
  if (cmd === 'create') {
    const [projectPath] = args;
    if (!projectPath) {
      usage();
      process.exit(1);
    }
    const configPath = join(projectPath, '.dmux-agents.yml');
    if (!existsSync(configPath)) {
      process.stderr.write(`No .dmux-agents.yml found at ${projectPath}\n`);
      process.exit(2);
    }
    const yamlText = readFileSync(configPath, 'utf-8');
    const parsed = parseAgentsConfig(yamlText);
    const agentsSummary = parsed.agents.map((a) => ({
      name: a.name,
      role: a.role,
      branch: a.branch || '',
      model: a.model || null,
      provider: a.provider || parsed.provider || 'claude',
      depends_on: a.depends_on || [],
    }));

    const trigger = { type: process.env.DMUX_RUN_TRIGGER || 'manual' };
    if (trigger.type === 'skill' && process.env.DMUX_RUN_SKILL_NAME) {
      trigger.skill_name = process.env.DMUX_RUN_SKILL_NAME;
    }

    const { id, dir, signalsDir } = createRun(projectPath, {
      configYaml: yamlText,
      agentsSummary,
      trigger,
    });
    process.stdout.write(JSON.stringify({ id, dir, signalsDir }) + '\n');
    process.exit(0);
  }

  if (cmd === 'mark-cleaned') {
    const [projectPath, runId] = args;
    if (!projectPath || !runId) {
      usage();
      process.exit(1);
    }
    markRunCleaned(projectPath, runId);
    process.exit(0);
  }

  if (cmd === 'mark-completed') {
    const [projectPath, runId] = args;
    if (!projectPath || !runId) {
      usage();
      process.exit(1);
    }
    markRunCompleted(projectPath, runId);
    process.exit(0);
  }

  process.stderr.write(`Unknown command: ${cmd}\n`);
  usage();
  process.exit(1);
} catch (e) {
  if (e instanceof ConfigError) {
    const where = e.agent ? ` (agent: ${e.agent})` : '';
    process.stderr.write(`Config error${where}: ${e.message}\n`);
  } else {
    process.stderr.write(`Error: ${e.message}\n`);
  }
  process.exit(3);
}
