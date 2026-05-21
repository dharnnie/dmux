# dmux

[![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)
[![Platform: macOS | Linux](https://img.shields.io/badge/Platform-macOS%20%7C%20Linux-brightgreen.svg)]()
[![Shell: Bash](https://img.shields.io/badge/Shell-Bash-yellow.svg)]()

Run Claude and Gemini agents on your codebase, in parallel, from a CLI or the web.

```bash
# Launch a multi-agent run on a configured project
dmux agents start

# Open the web UI — Dashboard, Run history, scope checks
dmux ui

# Spin up a tmux dev environment without agents
dmux -p myapp -n 3 -c 2

# Paste a screenshot into a tmux pane
dmux screenshot
```

dmux orchestrates parallel AI agents across isolated git worktrees, gives each one a scope, tracks every run as a first-class record, and surfaces the results in a local web UI. Open-source, locally-run, no telemetry.

---

## What's in it

- **Multi-agent orchestration.** Run multiple Claude or Gemini agents in parallel, each on its own git worktree and branch. Roles: `plan` (writes a plan markdown file), `build` (writes code in a worktree), and `review` (no worktree, runs on the project root).
- **Per-agent model selection.** Mix `opus`, `sonnet`, `haiku` for Claude; `pro`, `flash` for Gemini. A planner on Sonnet feeding two builders on Opus is one config away.
- **Run history.** Every spawn creates a Run record under `.dmux/runs/{id}/` with the frozen config, per-agent signals, and plan files. Cleanup removes worktrees but preserves the record so you can review past work.
- **Scope checks.** Declare which files each agent may modify, and dmux surfaces files touched outside scope after the run.
- **Local web UI.** Browser-based dashboard with live run status, an agent config editor, a scope-violation viewer, and a spawn sheet that builds a run from a skill in three clicks.
- **CLI and UI parity.** Anything you can do from the web UI you can do from `dmux agents …` and vice versa. Both read the same `.dmux-agents.yml` and write the same `.dmux/runs/`.
- **Terminal agnostic.** Alacritty, Kitty, WezTerm, iTerm2.
- **Best-effort accessibility.** Keyboard navigation, screen-reader friendly markup, contrast-aware palette. No WCAG compliance claims.

---

## Install

**Quick install:**
```bash
curl -fsSL https://raw.githubusercontent.com/dharnnie/dmux/main/install.sh | bash
```

**With the web UI:**
```bash
curl -fsSL https://raw.githubusercontent.com/dharnnie/dmux/main/install.sh | bash -s -- --with-ui
```

**Or clone:**
```bash
git clone https://github.com/dharnnie/dmux.git
cd dmux && ./install.sh --with-ui
```

**Requirements:**

- **tmux** and one of Alacritty, Kitty, WezTerm, or iTerm2.
- **node** + **jq** — required for the multi-agent orchestrator and the web UI. The installer prompts to install `jq` for you via your system package manager; node you install yourself.
- The Claude CLI (`claude`) and/or the Gemini CLI (`gemini`) on `$PATH`.

```bash
# macOS
brew install tmux jq alacritty

# Ubuntu / Debian
sudo apt install tmux jq alacritty
```

---

## Multi-agent orchestration

Building a feature often means touching multiple parts of the codebase at once. `dmux agents start` spawns a parallel team of agents — each in its own git worktree, each with its own task, optionally chained by `depends_on` so a planner runs before its builders.

### Quick start

1. Drop a `.dmux-agents.yml` into your project root:

```yaml
session: my-api-agents
worktree_base: ..
main_pane: true

agents:
  - name: planner
    role: plan
    task: "Plan the OAuth implementation — provider config, token storage, session middleware."
    model: sonnet

  - name: engineer
    branch: feature/oauth
    task: "Implement OAuth following the upstream plan."
    model: opus
    scope:
      - src/auth/
      - src/middleware/auth.ts
    depends_on:
      - planner

  - name: reviewer
    role: review
    task: "Review the OAuth changes for security and style."
    depends_on:
      - engineer
```

2. Start the run:

```bash
dmux agents start
```

3. Or launch from the UI:

```bash
dmux ui          # opens http://localhost:3100
# Dashboard → + New Run → pick the skill or use the existing config
```

The run record lives at `.dmux/runs/{id}/` — the frozen YAML, per-agent signal files, the plan written by the planner agent, and (once scope checking runs) any violation data. Add `.dmux/` to your `.gitignore` — the installer's template `.gitignore` already does this.

### How agents see each other

- A **`plan` agent** receives a prompt instruction to write its plan markdown to `.dmux/runs/{id}/plans/{name}.md`.
- **Downstream agents** (build, review) that list a plan agent in their `depends_on` are told the absolute path of that plan and asked to read it first.
- This convention is purely prompt-injected — no agent is forced to comply, but Claude / Gemini reliably do.

### Roles

| Role | Worktree | Scope check | Use for |
|---|---|---|---|
| `plan` | no | n/a | Producing a plan markdown that downstream agents consume |
| `build` (default) | yes | yes | Implementing the change on a branch |
| `review` | no | n/a | Reading the build agents' work and surfacing findings |

### Commands

| Command | What it does |
|---|---|
| `dmux agents init` | Interactively scaffolds a `.dmux-agents.yml` |
| `dmux agents start [project]` | Reads the config, creates a Run record, spawns the tmux session, launches agents |
| `dmux agents status [project]` | Shows the live status of each agent's pane |
| `dmux agents cleanup [project]` | Marks the run cleaned, removes worktrees, kills the tmux session |
| `dmux agents changelog [project]` | Builds a combined changelog from the agents' per-agent summaries |
| `dmux agents help` | Lists agents subcommands |

### Config reference

| Field | Required | Default | Description |
|---|---|---|---|
| `session` | yes | — | tmux session name |
| `worktree_base` | no | `..` | Directory for worktrees (relative to project root) |
| `main_pane` | no | `true` | Add a bottom pane at the project root |
| `namespace_branches` | no | `false` | Prefix branches with your git username slug |
| `provider` | no | `claude` | Default provider for agents: `claude` or `gemini` |
| `on_complete` | no | — | Default post-task instructions: `test`, `push`, `pr` |
| `agents[].name` | yes | — | Agent identifier (used in worktree path) |
| `agents[].role` | no | `build` | `plan`, `build`, or `review` |
| `agents[].branch` | yes for `build` | — | Git branch for the worktree |
| `agents[].task` | recommended | — | The task string injected into the agent's prompt |
| `agents[].provider` | no | inherits | Per-agent provider override |
| `agents[].model` | no | provider default | `opus` / `sonnet` / `haiku` (claude) or `pro` / `flash` (gemini) |
| `agents[].scope` | no | — | Files this agent may modify; surfaces violations in the UI |
| `agents[].context` | no | — | Files this agent may read but not modify |
| `agents[].depends_on` | no | — | List of agent names this agent waits for |
| `agents[].auto_accept` | no | `false` | Run with `--dangerously-skip-permissions` (Claude) / `--yolo` (Gemini) |
| `agents[].on_complete` | no | inherits | Per-agent override of the top-level `on_complete` |

---

## Web UI

`dmux ui` starts a local server on `http://localhost:3100`. No accounts, no auth, no network — the server only talks to your local filesystem, tmux, and the agent CLIs.

### Surfaces

- **Dashboard** — what's happening right now across all your projects. Running runs at the top with live status, recent runs below.
- **Projects** — your registered codebases. Add or remove from the browser.
- **Project Detail** — current run, run history, git context, settings.
- **Run Detail** — agent table with live status, plan files, diff, scope-violation banner. Stop run / cleanup live here.
- **Agent Detail** — drill into one agent in one run. Four tabs:
  - **Terminal** — live xterm against the agent's tmux pane (when running)
  - **Plan** — rendered markdown of the agent's plan output (or the upstream plan it consumed)
  - **Diff** — `git diff base...HEAD` in the agent's worktree
  - **Violations** — files modified outside the declared `scope`
- **Skills** — browse the built-in skill library (`code-review`, `docs-gen`, `refactor`, `security-audit`, `test-coverage`).
- **New Run sheet** — `+ New Run` from anywhere opens a three-step wizard: pick a skill, pick a project, review, launch.

### Install

The UI requires Node.js and npm. Install with `--with-ui` (above) and dmux copies it to `~/.local/share/dmux/ui/`, installs dependencies, and builds the production bundle. If you skip `--with-ui` initially, re-run the installer with the flag later.

### Launch

```bash
dmux ui

# Or with a custom port
DMUX_UI_PORT=8080 dmux ui
```

---

## CLI reference

### Launch

| Flag | Description |
|---|---|
| `-p, --projects` | Comma-separated project names to launch |
| `-n, --panes` | Number of panes per window (default: 1) |
| `-c, --claude` | Number of panes to run `claude` in |
| `-g, --gemini` | Number of panes to run `gemini` in |
| `-t, --terminal` | Terminal to use: `alacritty`, `kitty`, `wezterm`, `iterm` |

### Project management

| Flag | Description |
|---|---|
| `-a, --add` | Add a project: `-a name /path` |
| `-r, --remove` | Remove a project: `-r name` |
| `-l, --list` | List configured projects |

### Subcommands

| Subcommand | Description |
|---|---|
| `agents <action>` | Multi-agent orchestration (see above) |
| `skills <action>` | Browse, install, or run a skill |
| `screenshot` | Paste clipboard image into a tmux pane |
| `ui` | Launch the local web UI |
| `update` | Self-update from the latest release |

Default terminal: `export DMUX_TERMINAL=kitty` in your shell config.
Project storage: `~/.config/dmux/projects` (`name=$HOME/path/to/project` format).

---

## Screenshot paste

tmux is text-only, so you can't paste images directly into panes. `dmux screenshot` captures your clipboard image, saves it to disk, and types the file path into a tmux pane so a coding agent can read it as input.

```bash
# Copy a screenshot to clipboard (e.g. Cmd+Shift+4 on macOS), then:
dmux screenshot

# Save without sending to a pane
dmux screenshot --save-only

# Target a specific session and pane
dmux screenshot --session my-api-agents --pane 2
```

Requirements: built-in `osascript` on macOS; `xclip` on Linux (`sudo apt install xclip`).

---

## Tips

```bash
tmux ls                            # list running sessions
tmux kill-session -t dmux-myapp    # kill a specific session
tmux kill-server                   # kill all sessions
tmux attach -t dmux-myapp          # attach to a running session
```

Pane navigation (tmux defaults):
- `Ctrl-b` then arrow keys to move between panes
- `Ctrl-b` then `z` to zoom/unzoom a pane
- `Ctrl-b` then `d` to detach (leave running)

---

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/dharnnie/dmux/main/uninstall.sh | bash
```

Or, if you cloned the repo:

```bash
./uninstall.sh
```

---

<p align="center">
  <strong>dmux</strong> is released under the <a href="LICENSE">MIT License</a>.
</p>
