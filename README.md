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

## Why?

When working with Claude Code across multiple projects, you often want:
- Each project in its own terminal window
- Multiple panes for code, tests, servers
- Claude Code ready to go in some panes
- Multiple agents working in parallel on separate features

This tool does that in one command.

## Install

**Quick install:**
```bash
curl -fsSL https://raw.githubusercontent.com/dharnnie/dmux/main/install.sh | bash
```

**Or clone:**
```bash
git clone https://github.com/dharnnie/dmux.git
cd dmux
./install.sh
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
# Add a project
dmux -a myapp ~/code/myapp
dmux -a backend ~/work/backend-api
dmux -a dotfiles ~/.dotfiles

# List projects
dmux -l

# Remove a project
dmux -r oldproject
```

### Launch

```bash
# Launch one project
dmux -p myapp

# Launch multiple projects (separate windows)
dmux -p myapp,backend

# Launch with multiple panes
dmux -p myapp -n 3

# Launch with Claude in some panes
dmux -p myapp -n 3 -c 2    # 3 panes, claude in first 2
dmux -p myapp -n 2 -c 2    # 2 panes, claude in both
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

## Configuration

Projects are stored in `~/.config/dmux/projects`:

```
myapp=$HOME/code/myapp
backend=$HOME/work/backend
dotfiles=$HOME/.dotfiles
```

### Set default terminal

```bash
# In your .bashrc or .zshrc
export DMUX_TERMINAL=kitty
```

Or use `-t` flag:
```bash
dmux -p myapp -t kitty
```

## Multi-Agent Orchestration

The `agents` subcommand lets you run multiple Claude Code agents in parallel, each in its own git worktree with an assigned task.

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

> **Note:** Review agents are supported but not recommended. A review agent uses the same model as the build agents, adding cost and latency with limited independent value. Prefer reviewing branches yourself in the main pane or running automated checks (linting, tests) as part of the build agent command.

A `review` agent runs at the project root (no worktree or branch) and is designed to review the work of other agents. Use `depends_on` to make it wait until build agents finish:

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

- **scope** restricts the agent to only modify the listed paths (added to the prompt).
- **context** tells the agent it may read but not modify the listed paths.
- **role: review** skips worktree creation; the pane opens at the project root. If no `task` is provided, a default review prompt referencing all build agent branches is generated.
- **depends_on** lists agent names that must finish before this agent launches. The dependent agent's pane will show "Waiting for agents: ..." until all dependencies complete. Dependency completion is tracked via marker files in `.dmux/signals/`.
- **auto_accept** when set to `true`, launches `claude --dangerously-skip-permissions` so the agent runs fully autonomously without permission prompts.

### Scaffolding with `agents init`

Generate a `.dmux-agents.yml` interactively:

```bash
dmux agents init
```

This walks you through session name, worktree base, main pane, and each agent's name, branch, task, role, dependencies, and auto-accept setting. It writes the result to `.dmux-agents.yml` in the current directory.

### Pre-Launch Summary

When you run `agents start`, a summary table is printed before any worktrees are created:

```
Config: .dmux-agents.yml

  SESSION          my-api-agents
  WORKTREE BASE    ..
  MAIN PANE        true

  AGENT            BRANCH                   ROLE     AUTO   DEPENDS ON
  -----            ------                   ----     ----   ----------
  auth             feature/auth             build    false  —
  catalog          feature/catalog          build    false  —
  reviewer         —                        review   false  auth, catalog

  Worktrees to create: 2
  Review agents: 1 (will wait for dependencies)

Proceed? [Y/n]:
```

Use `--yes` / `-y` to skip the confirmation prompt.

### Signal Directory

`agents start` creates `.dmux/signals/` in the project root to track agent completion via marker files. Each agent writes its exit code to `.dmux/signals/<name>.done` when it finishes.

You can manually unblock a waiting agent:
```bash
touch .dmux/signals/auth.done
```

Add `.dmux/` to your `.gitignore`:
```
.dmux/
```

`agents cleanup` removes the `.dmux/` directory automatically.

### Agent Changelogs

When each agent finishes successfully, a per-agent changelog is automatically generated in `.dmux/changelogs/<agent>.md`. The changelog includes:

- **Agent summary** — read from `AGENT_SUMMARY.md` if the agent wrote one (build agents are prompted to create this)
- **Commits** — `git log` of commits on the agent's branch since the base branch
- **Changed files** — `git diff --stat` against the base branch

You can regenerate and view all changelogs at any time:

```bash
dmux agents changelog
```

This prints a combined changelog to stdout with all agent summaries, commits, and file changes.

When you run `agents cleanup`, the combined changelog is automatically written to `AGENTS_CHANGELOG.md` in the project root before worktrees and the `.dmux/` directory are removed.

### Example: Building an API with 3 Agents

This walks through the full lifecycle of using `dmux agents` to parallelize feature work on a project.

**Step 1 — Navigate to your git repo:**

```bash
cd ~/code/my-api
```

**Step 2 — Create `.dmux-agents.yml` in the project root:**

```yaml
session: my-api-agents
worktree_base: ..
main_pane: true

agents:
  - name: auth
    branch: feature/auth
    task: "implement JWT authentication with refresh tokens"
    scope:
      - src/auth/
      - src/middleware/auth.ts
    context:
      - src/types/
  - name: catalog
    branch: feature/catalog
    task: "build product listing API with search and filters"
  - name: admin
    branch: feature/admin
    task: "create admin dashboard CRUD endpoints"
```

Each agent gets its own git branch and worktree directory. The `task` field is passed directly to `claude` as an inline prompt. Optional `scope` and `context` fields add file-path restrictions to the prompt.

**Step 3 — Start the agents:**

```bash
dmux agents start
```

Output:
```
Reading config: .dmux-agents.yml
Session: my-api-agents
Agents: 3
Project root: /Users/you/code/my-api

Setting up worktrees...
  Creating worktree: ../my-api-agents-auth (branch: feature/auth)
  Creating worktree: ../my-api-agents-catalog (branch: feature/catalog)
  Creating worktree: ../my-api-agents-admin (branch: feature/admin)

Launching agents...
  auth: claude "implement JWT authentication with refresh tokens"
  catalog: claude "build product listing API with search and filters"
  admin: claude "create admin dashboard CRUD endpoints"

Attaching to session 'my-api-agents'...
```

A terminal window opens with a tmux session. The top row has one pane per agent (each running `claude` with its task), and the bottom pane is at the project root for integration work.

**Step 4 — Monitor progress:**

```bash
dmux agents status
```

Output:
```
Session: my-api-agents

  AGENT            BRANCH                   STATUS
  -----            ------                   ------
  auth             feature/auth             running
  catalog          feature/catalog          running
  admin            feature/admin            idle

  Main integration pane: active
```

You can also navigate between panes in tmux with `Ctrl-b` + arrow keys, or zoom into a pane with `Ctrl-b z`.

**Step 5 — Integrate work in the main pane:**

Use the bottom main pane to review and merge agent work:

```bash
# From the main pane (project root)
git merge feature/auth
git merge feature/catalog
git merge feature/admin
```

**Step 6 — Clean up when done:**

```bash
dmux agents cleanup
```

Output:
```
Cleaning up agents for session: my-api-agents

Wrote AGENTS_CHANGELOG.md

Killing tmux session: my-api-agents

Removing worktrees...
  Removing worktree: ../my-api-agents-auth
  Removing worktree: ../my-api-agents-catalog
  Removing worktree: ../my-api-agents-admin

Cleanup complete.
```

This generates `AGENTS_CHANGELOG.md` in the project root, kills the tmux session, and removes all worktree directories. The branches and changelog remain in your git history.

### How claude-cortex Fits In

Each worktree is a full copy of your repo, so `CLAUDE.md` and any [claude-cortex](https://github.com/dharnnie/claude-cortex) rules are automatically available to every agent. Install cortex rules into your project before running agents:

```bash
curl -fsSL https://raw.githubusercontent.com/dharnnie/claude-cortex/main/install.sh | bash
```

> **Note:** claude-cortex no longer uses git submodules. If you previously added it as a submodule, see the [cortex README](https://github.com/dharnnie/claude-cortex) for the new install-script approach.

## Web UI

dmux includes an optional local web interface for managing projects and agents visually.

### Install

```bash
# From a cloned repo
cd dmux-ui && npm install

# Or via the installer
./install.sh --with-ui
```

### Launch

```bash
# From the repo (dev mode)
dmux ui

# Or with a custom port
DMUX_UI_PORT=8080 dmux ui
```

This starts a local server and opens `http://localhost:3100` in your browser.

### What You Can Do

- **Projects Grid** — See all registered projects at a glance with status badges (agents config present, session running)
- **Add/Remove Projects** — Manage your project list from the browser
- **Quick Launch** — Pick pane count and Claude pane count, hit Launch
- **Agent Config Editor** — Visual form to build `.dmux-agents.yml` with live YAML preview that updates as you type
- **Start/Cleanup Agents** — One-click agent orchestration
- **Live Status** — Agent status table that auto-refreshes every 5 seconds

### Stack

- **Server:** Node + Express — thin API layer that shells out to `dmux` CLI and reads config files directly
- **Frontend:** React 19 + Vite + React Router with CSS modules
- **No database** — stateless, reads `~/.config/dmux/projects` and per-project `.dmux-agents.yml`

### Development

```bash
cd dmux-ui
npm install
npm run dev    # Express on :3100, Vite on :3101 (with hot reload)
```

For production:

```bash
cd dmux-ui
npm run build
npm start      # Serves built assets on :3100
```

## How it works

1. Opens a new terminal window (Alacritty/Kitty/WezTerm/iTerm)
2. Creates a tmux session named `dmux-{project}`
3. Splits into requested number of panes
4. Optionally runs `claude` in specified panes
5. Attaches to the session

Each project gets its own terminal window and tmux session, so you can work on multiple projects simultaneously.

## Tips

**Closing sessions:**
```bash
# List running sessions
tmux ls

# Kill a specific session
tmux kill-session -t dmux-myapp

# Clean up an agents session (kills session + removes worktrees)
dmux agents cleanup

# Kill all sessions
tmux kill-server
```

**Attaching to existing sessions:**
```bash
# If you close the terminal but tmux is still running
tmux attach -t dmux-myapp
```

**Pane navigation (tmux defaults):**
- `Ctrl-b` then arrow keys to move between panes
- `Ctrl-b` then `z` to zoom/unzoom a pane
- `Ctrl-b` then `d` to detach (leave running)

## Uninstall

```bash
rm ~/.local/bin/dmux
rm -rf ~/.config/dmux
rm -rf ~/.local/share/dmux    # removes UI if installed
```

## License

MIT
