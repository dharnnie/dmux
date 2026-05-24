#!/usr/bin/env node
// Usage:
//   dmux-runs create <project-path>           — creates a new run, prints JSON
//                                                {id, dir, signalsDir, plansDir}.
//                                                Reads .dmux-agents.yml for the
//                                                frozen config + agents summary.
//   dmux-runs mark-cleaned <project> <run-id> — marks a run cleaned.
//   dmux-runs mark-completed <project> <run-id>
//
//   dmux-runs propose <project-path> <yaml-file>
//                                                Creates a proposal record from
//                                                an explicit YAML file (not the
//                                                project's .dmux-agents.yml). Used
//                                                by the NL planner and for manual
//                                                testing.
//   dmux-runs approve <project> <run-id>       — Approve a proposal: writes its
//                                                YAML to .dmux-agents.yml and
//                                                sets started_at.
//   dmux-runs discard <project> <run-id>       — Discard a proposal: sets
//                                                abandoned_at.
//
// Env (create / propose):
//   DMUX_RUN_TRIGGER     — "manual" (default for create), "skill", or "nl"
//   DMUX_RUN_SKILL_NAME  — when DMUX_RUN_TRIGGER=skill
//   DMUX_RUN_PROMPT      — when DMUX_RUN_TRIGGER=nl (the user's prompt text)
//
// Exits:
//   0 — success, JSON on stdout (create/propose) or empty (mark-*/approve/discard)
//   1 — usage error
//   2 — file not found / project has no .dmux-agents.yml
//   3 — parse error or other failure

import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import {
  createRun,
  markRunCleaned,
  markRunCompleted,
  createProposal,
  approveProposal,
  discardProposal,
} from '../src/runs.js';
import { parseAgentsConfig, ConfigError } from '../src/config.js';

function usage() {
  process.stderr.write(
    'Usage:\n' +
      '  dmux-runs create <project-path>\n' +
      '  dmux-runs mark-cleaned <project-path> <run-id>\n' +
      '  dmux-runs mark-completed <project-path> <run-id>\n' +
      '  dmux-runs propose <project-path> <yaml-file>\n' +
      '  dmux-runs approve <project-path> <run-id>\n' +
      '  dmux-runs discard <project-path> <run-id>\n',
  );
}

function buildAgentsSummary(parsed) {
  return parsed.agents.map((a) => ({
    name: a.name,
    role: a.role,
    branch: a.branch || '',
    model: a.model || null,
    provider: a.provider || parsed.provider || 'claude',
    depends_on: a.depends_on || [],
  }));
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

    const trigger = { type: process.env.DMUX_RUN_TRIGGER || 'manual' };
    if (trigger.type === 'skill' && process.env.DMUX_RUN_SKILL_NAME) {
      trigger.skill_name = process.env.DMUX_RUN_SKILL_NAME;
    }

    const { id, dir, signalsDir, plansDir } = createRun(projectPath, {
      configYaml: yamlText,
      agentsSummary: buildAgentsSummary(parsed),
      trigger,
    });
    process.stdout.write(JSON.stringify({ id, dir, signalsDir, plansDir }) + '\n');
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

  if (cmd === 'propose') {
    const [projectPath, yamlPath] = args;
    if (!projectPath || !yamlPath) {
      usage();
      process.exit(1);
    }
    if (!existsSync(yamlPath)) {
      process.stderr.write(`No YAML file at ${yamlPath}\n`);
      process.exit(2);
    }
    const yamlText = readFileSync(yamlPath, 'utf-8');
    const parsed = parseAgentsConfig(yamlText);

    const trigger = { type: process.env.DMUX_RUN_TRIGGER || 'nl' };
    if (trigger.type === 'nl' && process.env.DMUX_RUN_PROMPT) {
      trigger.prompt = process.env.DMUX_RUN_PROMPT;
    }
    if (trigger.type === 'skill' && process.env.DMUX_RUN_SKILL_NAME) {
      trigger.skill_name = process.env.DMUX_RUN_SKILL_NAME;
    }

    const { id, dir } = createProposal(projectPath, {
      configYaml: yamlText,
      agentsSummary: buildAgentsSummary(parsed),
      trigger,
    });
    process.stdout.write(JSON.stringify({ id, dir }) + '\n');
    process.exit(0);
  }

  if (cmd === 'approve') {
    const [projectPath, runId] = args;
    if (!projectPath || !runId) {
      usage();
      process.exit(1);
    }
    const result = approveProposal(projectPath, runId);
    process.stdout.write(JSON.stringify(result) + '\n');
    process.exit(0);
  }

  if (cmd === 'discard') {
    const [projectPath, runId] = args;
    if (!projectPath || !runId) {
      usage();
      process.exit(1);
    }
    const result = discardProposal(projectPath, runId);
    process.stdout.write(JSON.stringify(result) + '\n');
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
