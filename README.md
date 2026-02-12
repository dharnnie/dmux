# dmux

Launch multi-pane tmux dev environments in one command — or orchestrate multiple Claude Code agents across git worktrees.

```bash
# Open two projects, each in their own terminal window
dmux -p frontend,backend

# Open with 3 panes, Claude running in 2 of them
dmux -p myapp -n 3 -c 2

# Launch multiple Claude agents with isolated worktrees
dmux agents start

# Open the local web UI
dmux ui
```

## Install

**Quick install:**
```bash
curl -fsSL https://raw.githubusercontent.com/dharnnie/dmux/main/install.sh | bash
```

**Or clone:**
```bash
git clone https://github.com/dharnnie/dmux.git
cd dmux && ./install.sh
```

### Requirements

- **tmux** - terminal multiplexer
- **One of:** Alacritty, Kitty, WezTerm, or iTerm2

```bash
# macOS
brew install tmux alacritty

# Ubuntu/Debian
sudo apt install tmux alacritty

# Arch
sudo pacman -S tmux alacritty
```

## Usage

### Add your projects

```bash
dmux -a myapp ~/code/myapp
dmux -a backend ~/work/backend-api

dmux -l              # list projects
dmux -r oldproject   # remove a project
```

### Launch

```bash
dmux -p myapp                  # one project
dmux -p myapp,backend          # multiple projects (separate windows)
dmux -p myapp -n 3             # 3 panes
dmux -p myapp -n 3 -c 2       # 3 panes, Claude in first 2
```

### Options

| Flag | Description |
|------|-------------|
| `-p, --projects` | Comma-separated project names to launch |
| `-n, --panes` | Number of panes per window (default: 1) |
| `-c, --claude` | Number of panes to run `claude` in (default: 0) |
| `-t, --terminal` | Terminal to use: `alacritty`, `kitty`, `wezterm`, `iterm` |
| `-l, --list` | List configured projects |
| `-a, --add` | Add a project: `-a name /path` |
| `-r, --remove` | Remove a project: `-r name` |
| `-h, --help` | Show help |
| `-v, --version` | Show version |
| `agents <action>` | Multi-agent orchestration (see below) |
| `ui` | Launch the local web UI |

Set a default terminal with `export DMUX_TERMINAL=kitty` in your shell config.

Projects are stored in `~/.config/dmux/projects` (`name=$HOME/path/to/project` format).

## Multi-Agent Orchestration

The `agents` subcommand runs multiple Claude Code agents in parallel, each in its own git worktree with an assigned task.

### Quick Start

1. Create a `.dmux-agents.yml` in your project root:

```yaml
session: my-api-agents
worktree_base: ..              # relative to project root
main_pane: true                # include an integration pane

agents:
  - name: auth
    branch: feature/auth
    task: "implement JWT authentication with refresh tokens"
  - name: catalog
    branch: feature/catalog
    task: "build product listing API with search and filters"
  - name: admin
    branch: feature/admin
    task: "create admin dashboard CRUD endpoints"
    auto_accept: true              # skip permission prompts
```

2. Run it:

```bash
dmux agents start
```

This will:
- Create a git worktree per agent (e.g. `../my-api-agents-auth`)
- Launch a tmux session with one pane per agent + a main integration pane
- Run `claude "task..."` in each agent pane automatically

Add `.dmux/` to your `.gitignore` — dmux uses `.dmux/signals/` to track agent completion and `.dmux/changelogs/` to store per-agent changelogs. Both are cleaned up by `agents cleanup`.

> **Tip:** Your `CLAUDE.md` and any [claude-cortex](https://github.com/dharnnie/claude-cortex) rules are automatically available in every worktree.

### Session Layout

```
┌───────────────────┬───────────────────┬─────────────────────┐
│ auth              │ catalog           │ admin               │
│ claude "impl..."  │ claude "build..." │ claude "create..."  │
├───────────────────┴───────────────────┴─────────────────────┤
│ main: project root (integration/review/git operations)      │
└─────────────────────────────────────────────────────────────┘
```

### Agents Commands

| Command | Description |
|---------|-------------|
| `dmux agents start` | Read `.dmux-agents.yml`, create worktrees, launch session |
| `dmux agents start myapp` | Start agents for a registered project |
| `dmux agents start --config path.yml` | Use a custom config file |
| `dmux agents start -y` | Skip the pre-launch confirmation prompt |
| `dmux agents status` | Show agent pane statuses (running/idle/waiting/done) |
| `dmux agents changelog` | Generate a combined changelog from all agent work |
| `dmux agents cleanup` | Remove worktrees, signal dir, and kill the session (writes `AGENTS_CHANGELOG.md`) |
| `dmux agents init` | Interactively generate a `.dmux-agents.yml` |
| `dmux agents help` | Show agents help |

### Config Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `session` | yes | — | tmux session name |
| `worktree_base` | no | `..` | Directory for worktrees (relative to project root) |
| `main_pane` | no | `true` | Add a bottom pane at the project root |
| `agents[].name` | yes | — | Agent identifier (used in worktree path) |
| `agents[].branch` | yes* | — | Git branch for the worktree (*not required for review agents) |
| `agents[].task` | no | — | Task string passed to `claude` |
| `agents[].scope` | no | — | List of writable file paths (appended to prompt) |
| `agents[].context` | no | — | List of read-only file paths (appended to prompt) |
| `agents[].role` | no | `build` | Agent role: `build` (default) or `review` |
| `agents[].depends_on` | no | — | List of agent names this agent waits for before launching |
| `agents[].auto_accept` | no | `false` | When `true`, runs `claude --dangerously-skip-permissions` for fully autonomous operation |

Worktree paths follow the pattern: `{worktree_base}/{session}-{agent_name}`

### Review Agent

> **Note:** Review agents are supported but not recommended. A review agent uses the same model as the build agents, adding cost and latency with limited independent value. Prefer reviewing branches yourself in the main pane or running automated checks as part of the build agent task.

A `review` agent runs at the project root (no worktree or branch) and reviews the work of other agents. Use `depends_on` to make it wait until build agents finish:

```yaml
agents:
  - name: auth
    branch: feature/auth
    task: "implement JWT authentication"
    scope:
      - src/auth/
      - src/middleware/auth.ts
    context:
      - src/types/

  - name: catalog
    branch: feature/catalog
    task: "build product listing API"

  - name: reviewer
    role: review
    task: "review changes on feature/auth and feature/catalog for bugs and security issues"
    depends_on:
      - auth
      - catalog
```

## Web UI

dmux includes an optional local web interface for managing projects and agents visually.

### Install

The UI requires **Node.js** and **npm**.

```bash
# Quick install (remote, includes UI)
curl -fsSL https://raw.githubusercontent.com/dharnnie/dmux/main/install.sh | bash -s -- --with-ui

# Or from a cloned repo
git clone https://github.com/dharnnie/dmux.git
cd dmux && ./install.sh --with-ui

# Or install the UI manually from a cloned repo
cd dmux-ui && npm install
```

The `--with-ui` flag copies the UI to `~/.local/share/dmux/ui/`, installs dependencies, and builds the production bundle. If you skip `--with-ui` during initial install, you can re-run the installer with the flag later.

### Launch

```bash
dmux ui

# Or with a custom port
DMUX_UI_PORT=8080 dmux ui
```

This starts a local server on `http://localhost:3100` and opens it in your browser.

### Features

- **Projects Grid** — All registered projects with status badges
- **Add/Remove Projects** — Manage projects from the browser
- **Quick Launch** — Pick pane count and Claude pane count, hit Launch
- **Agent Config Editor** — Visual form to build `.dmux-agents.yml` with live YAML preview
- **Start/Cleanup Agents** — One-click agent orchestration
- **Live Status** — Agent status table that auto-refreshes every 5 seconds

See [`dmux-ui/README.md`](dmux-ui/README.md) for development setup and architecture details.

## Tips

**Closing sessions:**
```bash
tmux ls                            # list running sessions
tmux kill-session -t dmux-myapp    # kill a specific session
dmux agents cleanup                # kill agents session + remove worktrees
tmux kill-server                   # kill all sessions
```

**Attaching to existing sessions:**
```bash
tmux attach -t dmux-myapp
```

**Pane navigation (tmux defaults):**
- `Ctrl-b` then arrow keys to move between panes
- `Ctrl-b` then `z` to zoom/unzoom a pane
- `Ctrl-b` then `d` to detach (leave running)

## Uninstall

```bash
curl -fsSL https://raw.githubusercontent.com/dharnnie/dmux/main/uninstall.sh | bash
```

Or if you cloned the repo:
```bash
./uninstall.sh
```

## License

MIT
