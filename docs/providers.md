# Agent runners (providers)

dmux runs each agent in a tmux pane by shelling a CLI binary. Today it supports two providers — **Claude Code** (`claude`) and **Gemini CLI** (`gemini`). Adding a third (Codex is the planned next entry, see Wave 3C) means touching a handful of small registries; this doc is the contract.

## What "provider" means in dmux

A provider is identified by a short name (`claude`, `gemini`, ...) and selected per-agent in `.dmux-agents.yml`:

```yaml
agents:
  - name: planner
    role: plan
    provider: claude        # optional; inherits the top-level default
    model: sonnet
    branch: plan/feature-x
    task: ...
```

The provider determines:

- Which binary dmux invokes to launch the agent.
- Which flag suppresses the CLI's permission prompts (`--dangerously-skip-permissions` for Claude, `--yolo` for Gemini, etc.).
- Which model aliases are valid for that provider.

Things the provider does NOT affect:

- **dmux's own LLM calls** (planner, discovery, chat) — those always use `claude --print` against the Max subscription. See `wave-3b.md` for the auth rationale.
- **Scope enforcement** — post-hoc, git-diff-driven. Works for any CLI that produces commits.
- **Signal files, changelog generation, completion notifications** — provider-agnostic.

## Adding a new provider

Four files. The CLI must already exist and be installable independently of dmux — dmux doesn't ship runners.

### 1. `dmux-core/src/config.js`

Three additions:

```js
const VALID_PROVIDERS = new Set(['claude', 'gemini', 'newone']);

const VALID_MODELS_BY_PROVIDER = {
  claude: new Set(['opus', 'sonnet', 'haiku']),
  gemini: new Set(['pro', 'flash']),
  newone: new Set(['<alias-1>', '<alias-2>']),  // short aliases users will write
};

const MODEL_ALIAS_PATTERNS = [
  // ... existing entries ...
  { match: /^newone-\d+/i, alias: 'alias-1' },  // normalize FQN ids → aliases
];
```

The alias pattern matters: LLM-generated configs frequently emit fully-qualified ids like `claude-sonnet-4-5-20250929` instead of `sonnet`. The validator normalizes them at parse time so the team config stays readable.

Add 2–3 tests in `dmux-core/test/config.test.js` covering parsing + alias normalization for the new provider.

### 2. `dmux.sh` — provider registry

Three cases per provider, near line 114:

```bash
provider_binary() {
  case "$1" in
    claude) echo "claude" ;;
    gemini) echo "gemini" ;;
    newone) echo "newone-cli" ;;        # whatever the binary is called
    *) echo "Error: Unknown provider '$1'" >&2; return 1 ;;
  esac
}

provider_auto_accept_flag() {
  case "$1" in
    claude) echo "--dangerously-skip-permissions" ;;
    gemini) echo "--yolo" ;;
    newone) echo "<the-flag>" ;;          # confirm with the CLI's --help
    *) echo "Error: Unknown provider '$1'" >&2; return 1 ;;
  esac
}

provider_process_name() {
  case "$1" in
    claude) echo "claude" ;;
    gemini) echo "gemini" ;;
    newone) echo "newone-cli" ;;          # for `ps` matching in status checks
    *) echo "Error: Unknown provider '$1'" >&2; return 1 ;;
  esac
}
```

If the CLI doesn't have an auto-accept flag, document the gap and decide whether to ship without it (users will hit prompts mid-run) or block on the upstream adding one.

### 3. `dmux-ui/server/lib/providers.js` — capability matrix

Add an entry to the `PROVIDERS` array:

```js
{
  name: 'newone',
  label: 'New One (Vendor)',
  binary: 'newone-cli',
  models: ['alias-1', 'alias-2'],
  defaultModel: 'alias-1',
  capabilities: {
    autoAccept: true,         // false if the CLI lacks a yolo-style flag
    perAgentModel: true,
    mcp: 'native' | 'preview' | false,
  },
  notes: 'One-line caveat or install hint.',
},
```

This entry is what `GET /api/providers` returns and what the Customize panel reads to populate its provider picker. The "TBD" rows in `wave-3c.md` §1.1 get pinned by this entry once empirical work is done.

### 4. Verification — end-to-end run

**This is the load-bearing step.** Don't ship a new provider without:

- A real multi-agent run that includes at least one agent on the new provider.
- Confirmation that the agent produced a git commit (so scope enforcement runs).
- Confirmation that the auto-accept flag actually suppresses prompts (no human input required mid-run).
- Confirmation that the completion / failure / scope-violation notifications fire correctly.
- Confirmation that the run shows up in History with the right provider badge.

The bash-side `case` statements happily accept any string you put in them; only an actual run catches "the CLI's `--model` flag works differently from `claude`'s" or "the auto-accept flag printed a deprecation warning instead of suppressing."

## Why not auto-discover providers?

A registry-driven static list is what we have today and it's deliberate. Auto-discovery (probe `command -v <binary>` for every plausible name) would make the matrix dynamic but trade clarity for magic — users would see different providers in different shells, and we'd lose the ability to flag known capability gaps. The four-step explicit add is short and the source of truth.
