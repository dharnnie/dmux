# dmux

Launch multi-pane tmux dev environments in one command.

```bash
# Open two projects, each in their own terminal window
dmux -p frontend,backend

# Open with 3 panes, Claude running in 2 of them
dmux -p myapp -n 3 -c 2
```

## Why?

When working with Claude Code across multiple projects, you often want:
- Each project in its own terminal window
- Multiple panes for code, tests, servers
- Claude Code ready to go in some panes

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
