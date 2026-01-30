# dmux

Launch multi-pane tmux dev environments in one command — or orchestrate multiple Claude Code agents across git worktrees.

```bash
# Open two projects, each in their own terminal window
dmux -p frontend,backend

# Open with 3 panes, Claude running in 2 of them
dmux -p myapp -n 3 -c 2

# Launch multiple Claude agents with isolated worktrees
dmux agents start
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
curl -fsSL https://raw.githubusercontent.com/anthropics/dmux/main/install.sh | bash
```

**Or clone:**
```bash
git clone https://github.com/anthropics/dmux.git
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
```

2. Run it:

```bash
dmux agents start
```

This will:
- Create a git worktree per agent (e.g. `../my-api-agents-auth`)
- Launch a tmux session with one pane per agent + a main integration pane
- Run `claude "task..."` in each agent pane automatically
- Initialize git submodules in each worktree (so [claude-cortex](https://github.com/dharnnie/claude-cortex) rules apply)

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
| `dmux agents status` | Show agent pane statuses (running/idle) |
| `dmux agents cleanup` | Remove worktrees and kill the session |
| `dmux agents help` | Show agents help |

### Config Reference

| Field | Required | Default | Description |
|-------|----------|---------|-------------|
| `session` | yes | — | tmux session name |
| `worktree_base` | no | `..` | Directory for worktrees (relative to project root) |
| `main_pane` | no | `true` | Add a bottom pane at the project root |
| `agents[].name` | yes | — | Agent identifier (used in worktree path) |
| `agents[].branch` | yes | — | Git branch for the worktree |
| `agents[].task` | no | — | Task string passed to `claude` |

Worktree paths follow the pattern: `{worktree_base}/{session}-{agent_name}`

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
  - name: catalog
    branch: feature/catalog
    task: "build product listing API with search and filters"
  - name: admin
    branch: feature/admin
    task: "create admin dashboard CRUD endpoints"
```

Each agent gets its own git branch and worktree directory. The `task` field is passed directly to `claude` as an inline prompt.

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

Killing tmux session: my-api-agents

Removing worktrees...
  Removing worktree: ../my-api-agents-auth
  Removing worktree: ../my-api-agents-catalog
  Removing worktree: ../my-api-agents-admin

Cleanup complete.
```

This kills the tmux session and removes all worktree directories. The branches remain in your git history.

### How claude-cortex Fits In

Each worktree is a full copy of your repo, so `CLAUDE.md` and any [claude-cortex](https://github.com/dharnnie/claude-cortex) submodule rules are automatically available to every agent. Submodules are initialized in each worktree during setup.

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
```

## License

MIT
