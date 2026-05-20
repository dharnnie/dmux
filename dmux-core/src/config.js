import { readFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import yaml from 'js-yaml';

const CONFIG_FILENAME = '.dmux-agents.yml';

const VALID_ROLES = new Set(['build', 'review', 'plan']);
const VALID_PROVIDERS = new Set(['claude', 'gemini']);
const VALID_ON_COMPLETE = new Set(['test', 'push', 'pr']);

// Provider → valid model aliases. The bash side threads the chosen value
// straight to `claude --model` / `gemini --model`. We keep these as short
// aliases (opus/sonnet/haiku rather than claude-opus-4-7) because the CLIs
// accept aliases and it matches how users describe models conversationally.
// To support a new model, extend the set here and the bash side reads it
// without any further change.
const VALID_MODELS_BY_PROVIDER = {
  claude: new Set(['opus', 'sonnet', 'haiku']),
  gemini: new Set(['pro', 'flash']),
};

// Exported as plain arrays so the UI can render selects without duplicating
// the list and so the bash side can introspect via JSON if needed later.
export const MODELS_BY_PROVIDER = Object.fromEntries(
  Object.entries(VALID_MODELS_BY_PROVIDER).map(([p, set]) => [p, [...set]]),
);

export class ConfigError extends Error {
  constructor(message, { field, agent } = {}) {
    super(message);
    this.name = 'ConfigError';
    this.field = field;
    this.agent = agent;
  }
}

export function hasAgentsConfig(projectPath) {
  return existsSync(join(projectPath, CONFIG_FILENAME));
}

export function loadAgentsConfig(projectPath) {
  const configPath = join(projectPath, CONFIG_FILENAME);
  if (!existsSync(configPath)) return null;
  const text = readFileSync(configPath, 'utf-8');
  return parseAgentsConfig(text);
}

export function parseAgentsConfig(yamlText) {
  let raw;
  try {
    raw = yaml.load(yamlText);
  } catch (e) {
    throw new ConfigError(`Invalid YAML: ${e.message}`);
  }

  if (raw == null || typeof raw !== 'object') {
    throw new ConfigError('Config must be a YAML mapping');
  }

  const config = {
    session: requireString(raw, 'session'),
    worktree_base: optionalString(raw, 'worktree_base', '..'),
    main_pane: optionalBool(raw, 'main_pane', true),
    namespace_branches: optionalBool(raw, 'namespace_branches', false),
    notifications: optionalBool(raw, 'notifications', true),
    provider: optionalEnum(raw, 'provider', VALID_PROVIDERS, 'claude'),
    on_complete: normalizeOnComplete(raw.on_complete, 'on_complete'),
    agents: [],
  };

  const rawAgents = raw.agents;
  if (!Array.isArray(rawAgents) || rawAgents.length === 0) {
    throw new ConfigError('`agents` must be a non-empty list', { field: 'agents' });
  }

  const seenNames = new Set();
  for (let i = 0; i < rawAgents.length; i++) {
    const a = rawAgents[i];
    if (a == null || typeof a !== 'object') {
      throw new ConfigError(`agents[${i}] must be a mapping`, { field: `agents[${i}]` });
    }

    const name = requireString(a, 'name', { agent: `agents[${i}]` });
    if (seenNames.has(name)) {
      throw new ConfigError(`Duplicate agent name: ${name}`, { agent: name, field: 'name' });
    }
    seenNames.add(name);

    const role = optionalEnum(a, 'role', VALID_ROLES, 'build', { agent: name });
    const provider = a.provider == null
      ? null
      : optionalEnum(a, 'provider', VALID_PROVIDERS, null, { agent: name });

    // Model validation is provider-aware. If the agent doesn't set a provider,
    // we validate against the resolved provider (top-level default).
    const resolvedProvider = provider ?? config.provider;
    const model = optionalModel(a, 'model', resolvedProvider, { agent: name });

    config.agents.push({
      name,
      role,
      branch: optionalString(a, 'branch', ''),
      task: optionalString(a, 'task', ''),
      provider,
      model,
      auto_accept: optionalBool(a, 'auto_accept', false),
      scope: normalizeStringList(a.scope, 'scope', { agent: name }),
      context: normalizeStringList(a.context, 'context', { agent: name }),
      depends_on: normalizeStringList(a.depends_on, 'depends_on', { agent: name }),
      on_complete: a.on_complete === undefined
        ? null
        : normalizeOnComplete(a.on_complete, 'on_complete', { agent: name }),
    });
  }

  validateDependencies(config);
  validateRoleConstraints(config);

  return config;
}

// --- helpers ---

function requireString(obj, key, ctx = {}) {
  const v = obj[key];
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ConfigError(`'${key}' is required and must be a non-empty string`, {
      field: key,
      ...ctx,
    });
  }
  return v.trim();
}

function optionalString(obj, key, defaultValue) {
  const v = obj[key];
  if (v == null) return defaultValue;
  if (typeof v !== 'string') {
    throw new ConfigError(`'${key}' must be a string`, { field: key });
  }
  return v.trim();
}

function optionalBool(obj, key, defaultValue) {
  const v = obj[key];
  if (v == null) return defaultValue;
  if (typeof v === 'boolean') return v;
  if (v === 'true') return true;
  if (v === 'false') return false;
  throw new ConfigError(`'${key}' must be a boolean`, { field: key });
}

function optionalEnum(obj, key, validSet, defaultValue, ctx = {}) {
  const v = obj[key];
  if (v == null) return defaultValue;
  if (typeof v !== 'string' || !validSet.has(v)) {
    throw new ConfigError(
      `'${key}' must be one of: ${[...validSet].join(', ')} (got: ${JSON.stringify(v)})`,
      { field: key, ...ctx },
    );
  }
  return v;
}

// Validate `model` per the resolved provider. Returns null if unset (the
// provider's default is used at runtime).
function optionalModel(obj, key, resolvedProvider, ctx = {}) {
  const v = obj[key];
  if (v == null) return null;
  if (typeof v !== 'string' || v.trim() === '') {
    throw new ConfigError(`'${key}' must be a non-empty string`, { field: key, ...ctx });
  }
  const trimmed = v.trim();
  const validSet = VALID_MODELS_BY_PROVIDER[resolvedProvider];
  if (validSet && !validSet.has(trimmed)) {
    throw new ConfigError(
      `'${key}' must be one of (${resolvedProvider}): ${[...validSet].join(', ')} (got: ${JSON.stringify(trimmed)})`,
      { field: key, ...ctx },
    );
  }
  return trimmed;
}

function normalizeStringList(value, field, ctx = {}) {
  if (value == null) return [];
  if (typeof value === 'string') {
    // Allow inline comma-separated form for convenience
    return value
      .split(',')
      .map((s) => s.trim())
      .filter((s) => s.length > 0);
  }
  if (!Array.isArray(value)) {
    throw new ConfigError(`'${field}' must be a list of strings`, { field, ...ctx });
  }
  return value.map((item, i) => {
    if (typeof item !== 'string' || item.trim() === '') {
      throw new ConfigError(`'${field}[${i}]' must be a non-empty string`, { field, ...ctx });
    }
    return item.trim();
  });
}

function normalizeOnComplete(value, field, ctx = {}) {
  if (value == null) return [];
  const list = normalizeStringList(value, field, ctx);
  for (const item of list) {
    if (!VALID_ON_COMPLETE.has(item)) {
      throw new ConfigError(
        `'${field}' values must be in: ${[...VALID_ON_COMPLETE].join(', ')} (got: ${item})`,
        { field, ...ctx },
      );
    }
  }
  return list;
}

function validateDependencies(config) {
  const names = new Set(config.agents.map((a) => a.name));
  for (const agent of config.agents) {
    for (const dep of agent.depends_on) {
      if (!names.has(dep)) {
        throw new ConfigError(
          `Agent '${agent.name}' depends on unknown agent '${dep}'`,
          { agent: agent.name, field: 'depends_on' },
        );
      }
      if (dep === agent.name) {
        throw new ConfigError(
          `Agent '${agent.name}' cannot depend on itself`,
          { agent: agent.name, field: 'depends_on' },
        );
      }
    }
  }
  // Cycle detection
  const cycle = findCycle(config.agents);
  if (cycle) {
    throw new ConfigError(
      `Dependency cycle detected: ${cycle.join(' → ')}`,
      { field: 'depends_on' },
    );
  }
}

function findCycle(agents) {
  const adjacency = new Map(agents.map((a) => [a.name, a.depends_on]));
  const WHITE = 0, GRAY = 1, BLACK = 2;
  const color = new Map([...adjacency.keys()].map((n) => [n, WHITE]));
  const stack = [];

  function visit(node) {
    color.set(node, GRAY);
    stack.push(node);
    for (const next of adjacency.get(node) || []) {
      const c = color.get(next);
      if (c === GRAY) {
        const start = stack.indexOf(next);
        return [...stack.slice(start), next];
      }
      if (c === WHITE) {
        const found = visit(next);
        if (found) return found;
      }
    }
    stack.pop();
    color.set(node, BLACK);
    return null;
  }

  for (const node of adjacency.keys()) {
    if (color.get(node) === WHITE) {
      const found = visit(node);
      if (found) return found;
    }
  }
  return null;
}

function validateRoleConstraints(config) {
  for (const agent of config.agents) {
    if (agent.role === 'review' || agent.role === 'plan') {
      // Branch is meaningless for review/plan agents (no worktree)
      if (agent.branch) {
        // Not fatal — bash currently tolerates this. Surface as a warning later.
      }
    }
  }
}
