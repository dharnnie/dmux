# dmux-core

Shared orchestration primitives for dmux. Consumed by both `dmux.sh` (CLI) and `dmux-ui/server/` (web UI server).

This package replaces the duplicate YAML parsers that existed in Wave 1 — one hand-written in bash inside `dmux.sh`, one hand-written in JS inside the React app. Both produced the same shape from the same file; both diverged silently.

## What's in here today

- **`src/config.js`** — `parseAgentsConfig(yamlText)` and `loadAgentsConfig(projectPath)`. Returns a normalized JS object with snake_case keys matching the YAML schema. Validates required fields, role enums, provider enums, `on_complete` shorthands, and the dependency graph (no cycles, no missing references).
- **`bin/parse-config.js`** — CLI entry point. `dmux-parse-config <path>` outputs JSON to stdout for downstream shell consumers.
- **`test/config.test.js`** — vitest suite covering the example config, defaults, validation errors, and edge cases (inline lists, inherited `on_complete`, etc.).

## Normalized shape

```js
{
  session: string,
  worktree_base: string,        // default ".."
  main_pane: boolean,           // default true
  namespace_branches: boolean,  // default false
  notifications: boolean,       // default true
  provider: 'claude' | 'gemini', // default 'claude'
  on_complete: string[],        // global default, may be []
  agents: [
    {
      name: string,
      role: 'build' | 'review' | 'plan',  // default 'build'
      branch: string,                       // empty string if unset
      task: string,
      provider: 'claude' | 'gemini' | null, // null = inherit global
      auto_accept: boolean,                 // default false
      scope: string[],
      context: string[],
      depends_on: string[],
      on_complete: string[] | null,         // null = inherit global
    },
    ...
  ]
}
```

Keys are snake_case throughout to match the YAML and the bash side. No JS-flavored camelCase translation layer.

## Usage

From Node:

```js
import { loadAgentsConfig, parseAgentsConfig } from 'dmux-core/config';

const config = loadAgentsConfig('/path/to/project');
// or
const config = parseAgentsConfig(yamlString);
```

From bash (planned for PR 2):

```bash
config_json=$(node "$DMUX_CORE/bin/parse-config.js" "$project_path")
# parse with jq into existing AGENTS_* shell arrays
```

## Errors

Validation failures throw `ConfigError`, with `field` and (for agent-scoped errors) `agent` properties:

```js
try {
  parseAgentsConfig(text);
} catch (e) {
  if (e instanceof ConfigError) {
    console.error(`At ${e.agent ?? 'top-level'}.${e.field}: ${e.message}`);
  }
}
```

The CLI exits with code 3 on validation failures and writes the error to stderr.

## Tests

```bash
cd dmux-core
npm install
npm test
```

## Status

- Wave 2A extraction PR — slice 1a (this package). The UI server and bash CLI still use their own parsers as of this commit; subsequent slices switch them over.
