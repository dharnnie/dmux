#!/bin/bash

# ==============================================================================
# dmux - Launch terminal windows with tmux panes for your projects
# ==============================================================================
#
# A CLI tool to quickly spin up development environments with multiple
# terminal panes, optionally pre-launching Claude Code in each.
#
# https://github.com/anthropics/dmux
#
# ==============================================================================

set -euo pipefail

VERSION="1.0.0"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/dmux"
PROJECTS_FILE="$CONFIG_DIR/projects"

# Terminal to use (alacritty, kitty, wezterm, iterm)
TERMINAL="${DMUX_TERMINAL:-alacritty}"

# ------------------------------------------------------------------------------
# CONFIGURATION
# ------------------------------------------------------------------------------

ensure_config() {
  if [[ ! -d "$CONFIG_DIR" ]]; then
    mkdir -p "$CONFIG_DIR"
  fi
  if [[ ! -f "$PROJECTS_FILE" ]]; then
    touch "$PROJECTS_FILE"
  fi
}

get_project_path() {
  local project="$1"
  ensure_config

  # Read from config file
  while IFS='=' read -r name path || [[ -n "$name" ]]; do
    # Skip empty lines and comments
    [[ -z "$name" || "$name" =~ ^[[:space:]]*# ]] && continue
    # Trim whitespace
    name="${name//[[:space:]]/}"
    path="${path//[[:space:]]/}"
    # Expand $HOME
    path="${path//\$HOME/$HOME}"
    path="${path/#\~/$HOME}"

    if [[ "$name" == "$project" ]]; then
      echo "$path"
      return 0
    fi
  done < "$PROJECTS_FILE"

  echo ""
}

get_project_names() {
  ensure_config
  local names=""

  while IFS='=' read -r name path || [[ -n "$name" ]]; do
    [[ -z "$name" || "$name" =~ ^[[:space:]]*# ]] && continue
    name="${name//[[:space:]]/}"
    if [[ -n "$names" ]]; then
      names="$names $name"
    else
      names="$name"
    fi
  done < "$PROJECTS_FILE"

  echo "$names"
}

# ------------------------------------------------------------------------------
# AGENTS YAML CONFIG PARSER
# ------------------------------------------------------------------------------

# Global arrays populated by parse_agents_config()
AGENTS_SESSION=""
AGENTS_WORKTREE_BASE=".."
AGENTS_MAIN_PANE="true"
AGENTS_NAMES=()
AGENTS_BRANCHES=()
AGENTS_TASKS=()

# Strip inline YAML comments (# ...) from a value, preserving # inside quotes
strip_yaml_comment() {
  local val="$1"
  # If value is quoted, strip quotes and return
  if [[ "$val" =~ ^\"(.*)\"[[:space:]]*(#.*)?$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi
  if [[ "$val" =~ ^\'(.*)\'[[:space:]]*(#.*)?$ ]]; then
    echo "${BASH_REMATCH[1]}"
    return
  fi
  # Unquoted: strip trailing # comment
  val="${val%%[[:space:]]#*}"
  # Trim trailing whitespace
  val="${val%"${val##*[![:space:]]}"}"
  echo "$val"
}

parse_agents_config() {
  local config_file="$1"

  if [[ ! -f "$config_file" ]]; then
    echo "Error: Config file not found: $config_file"
    return 1
  fi

  # Reset globals
  AGENTS_SESSION=""
  AGENTS_WORKTREE_BASE=".."
  AGENTS_MAIN_PANE="true"
  AGENTS_NAMES=()
  AGENTS_BRANCHES=()
  AGENTS_TASKS=()

  local in_agents_list=false
  local current_name=""
  local current_branch=""
  local current_task=""

  while IFS= read -r line || [[ -n "$line" ]]; do
    # Skip comments and empty lines
    [[ "$line" =~ ^[[:space:]]*# ]] && continue
    [[ -z "${line// /}" ]] && continue

    # Detect agent list item start (- name:)
    if [[ "$line" =~ ^[[:space:]]*-[[:space:]]*name:[[:space:]]*(.*) ]]; then
      # Save previous agent if any
      if [[ -n "$current_name" ]]; then
        AGENTS_NAMES+=("$current_name")
        AGENTS_BRANCHES+=("$current_branch")
        AGENTS_TASKS+=("$current_task")
      fi
      current_name=$(strip_yaml_comment "${BASH_REMATCH[1]}")
      current_name="${current_name#"${current_name%%[![:space:]]*}"}"
      current_name="${current_name%"${current_name##*[![:space:]]}"}"
      current_branch=""
      current_task=""
      in_agents_list=true
      continue
    fi

    # Inside an agent entry — parse branch and task
    if $in_agents_list; then
      if [[ "$line" =~ ^[[:space:]]+branch:[[:space:]]*(.*) ]]; then
        current_branch=$(strip_yaml_comment "${BASH_REMATCH[1]}")
        current_branch="${current_branch#"${current_branch%%[![:space:]]*}"}"
        current_branch="${current_branch%"${current_branch##*[![:space:]]}"}"
        continue
      fi
      if [[ "$line" =~ ^[[:space:]]+task:[[:space:]]*(.*) ]]; then
        current_task=$(strip_yaml_comment "${BASH_REMATCH[1]}")
        current_task="${current_task#"${current_task%%[![:space:]]*}"}"
        current_task="${current_task%"${current_task##*[![:space:]]}"}"
        continue
      fi
    fi

    # Top-level keys
    if [[ "$line" =~ ^session:[[:space:]]*(.*) ]]; then
      AGENTS_SESSION=$(strip_yaml_comment "${BASH_REMATCH[1]}")
      AGENTS_SESSION="${AGENTS_SESSION#"${AGENTS_SESSION%%[![:space:]]*}"}"
      AGENTS_SESSION="${AGENTS_SESSION%"${AGENTS_SESSION##*[![:space:]]}"}"
      in_agents_list=false
      continue
    fi
    if [[ "$line" =~ ^worktree_base:[[:space:]]*(.*) ]]; then
      AGENTS_WORKTREE_BASE=$(strip_yaml_comment "${BASH_REMATCH[1]}")
      AGENTS_WORKTREE_BASE="${AGENTS_WORKTREE_BASE#"${AGENTS_WORKTREE_BASE%%[![:space:]]*}"}"
      AGENTS_WORKTREE_BASE="${AGENTS_WORKTREE_BASE%"${AGENTS_WORKTREE_BASE##*[![:space:]]}"}"
      in_agents_list=false
      continue
    fi
    if [[ "$line" =~ ^main_pane:[[:space:]]*(.*) ]]; then
      AGENTS_MAIN_PANE=$(strip_yaml_comment "${BASH_REMATCH[1]}")
      AGENTS_MAIN_PANE="${AGENTS_MAIN_PANE#"${AGENTS_MAIN_PANE%%[![:space:]]*}"}"
      AGENTS_MAIN_PANE="${AGENTS_MAIN_PANE%"${AGENTS_MAIN_PANE##*[![:space:]]}"}"
      in_agents_list=false
      continue
    fi
    if [[ "$line" =~ ^agents:[[:space:]]*$ ]]; then
      in_agents_list=false
      continue
    fi
  done < "$config_file"

  # Save last agent
  if [[ -n "$current_name" ]]; then
    AGENTS_NAMES+=("$current_name")
    AGENTS_BRANCHES+=("$current_branch")
    AGENTS_TASKS+=("$current_task")
  fi

  # Validate
  if [[ -z "$AGENTS_SESSION" ]]; then
    echo "Error: 'session' is required in config file"
    return 1
  fi
  if [[ ${#AGENTS_NAMES[@]} -eq 0 ]]; then
    echo "Error: No agents defined in config file"
    return 1
  fi

  return 0
}

# ------------------------------------------------------------------------------
# TERMINAL LAUNCHERS
# ------------------------------------------------------------------------------

launch_alacritty() {
  local project="$1"
  local dir="$2"
  local setup_commands="$3"

  alacritty --title "$project" --working-directory "$dir" -e bash -c "$setup_commands" &
}

launch_kitty() {
  local project="$1"
  local dir="$2"
  local setup_commands="$3"

  kitty --title "$project" --directory "$dir" bash -c "$setup_commands" &
}

launch_wezterm() {
  local project="$1"
  local dir="$2"
  local setup_commands="$3"

  wezterm start --cwd "$dir" -- bash -c "$setup_commands" &
}

launch_iterm() {
  local project="$1"
  local dir="$2"
  local setup_commands="$3"

  osascript <<EOF
tell application "iTerm"
  create window with default profile
  tell current session of current window
    write text "cd '$dir' && $setup_commands"
  end tell
end tell
EOF
}

# ------------------------------------------------------------------------------
# WORKTREE MANAGEMENT
# ------------------------------------------------------------------------------

get_worktree_path() {
  local project_root="$1"
  local worktree_base="$2"
  local session="$3"
  local agent_name="$4"

  local base_dir
  if [[ "$worktree_base" == /* ]]; then
    base_dir="$worktree_base"
  else
    base_dir="$project_root/$worktree_base"
  fi

  echo "$base_dir/${session}-${agent_name}"
}

create_worktrees() {
  local project_root="$1"
  local count=${#AGENTS_NAMES[@]}

  for ((i=0; i<count; i++)); do
    local name="${AGENTS_NAMES[$i]}"
    local branch="${AGENTS_BRANCHES[$i]}"
    local wt_path
    wt_path=$(get_worktree_path "$project_root" "$AGENTS_WORKTREE_BASE" "$AGENTS_SESSION" "$name")

    if [[ -d "$wt_path" ]]; then
      echo "  Worktree already exists: $wt_path (skipping)"
      continue
    fi

    echo "  Creating worktree: $wt_path (branch: $branch)"
    if ! git -C "$project_root" worktree add "$wt_path" -b "$branch" 2>/dev/null; then
      # Branch may already exist, try without -b
      if ! git -C "$project_root" worktree add "$wt_path" "$branch" 2>/dev/null; then
        echo "  Error: Failed to create worktree for agent '$name' (branch: $branch)"
        return 1
      fi
    fi

    # Initialize submodules in the worktree
    if [[ -f "$wt_path/.gitmodules" ]]; then
      echo "  Initializing submodules in $wt_path"
      git -C "$wt_path" submodule update --init 2>/dev/null || true
    fi
  done
}

remove_worktrees() {
  local project_root="$1"
  local count=${#AGENTS_NAMES[@]}

  for ((i=0; i<count; i++)); do
    local name="${AGENTS_NAMES[$i]}"
    local wt_path
    wt_path=$(get_worktree_path "$project_root" "$AGENTS_WORKTREE_BASE" "$AGENTS_SESSION" "$name")

    if [[ -d "$wt_path" ]]; then
      echo "  Removing worktree: $wt_path"
      git -C "$project_root" worktree remove "$wt_path" --force 2>/dev/null || {
        echo "  Warning: Could not remove worktree $wt_path (may need manual cleanup)"
      }
    else
      echo "  Worktree not found: $wt_path (skipping)"
    fi
  done

  # Prune stale worktree references
  git -C "$project_root" worktree prune 2>/dev/null || true
}

# ------------------------------------------------------------------------------
# AGENTS COMMANDS
# ------------------------------------------------------------------------------

agents_usage() {
  cat << EOF
dmux agents - Multi-agent orchestration with git worktrees + Claude

USAGE:
  $(basename "$0") agents start [project]         Start agents from config
  $(basename "$0") agents start --config <file>   Use a custom config file
  $(basename "$0") agents status [project]        Show agent pane statuses
  $(basename "$0") agents cleanup [project]       Remove worktrees and kill session

CONFIG FILE:
  By default, reads .dmux-agents.yml from the current directory or the
  registered project's directory.

  Format:
    session: my-api-agents
    worktree_base: ..              # relative to project root
    agents:
      - name: auth
        branch: feature/auth
        task: "implement JWT authentication"
      - name: catalog
        branch: feature/catalog
        task: "build product listing API"
    main_pane: true                # include integration pane

EXAMPLES:
  # Start agents from .dmux-agents.yml in current directory
  $(basename "$0") agents start

  # Start agents for a registered project
  $(basename "$0") agents start myapp

  # Start agents with a custom config
  $(basename "$0") agents start --config ~/configs/agents.yml

  # Check agent statuses
  $(basename "$0") agents status

  # Clean up worktrees and kill session
  $(basename "$0") agents cleanup

EOF
}

resolve_agents_config() {
  local config_file="${AGENTS_CONFIG_FILE:-}"
  local project="${1:-}"

  # Explicit --config takes priority
  if [[ -n "$config_file" ]]; then
    echo "$config_file"
    return 0
  fi

  # If project name given, look in project directory
  if [[ -n "$project" ]]; then
    local project_path
    project_path=$(get_project_path "$project")
    if [[ -n "$project_path" && -f "$project_path/.dmux-agents.yml" ]]; then
      echo "$project_path/.dmux-agents.yml"
      return 0
    fi
  fi

  # Default: current directory
  if [[ -f ".dmux-agents.yml" ]]; then
    echo ".dmux-agents.yml"
    return 0
  fi

  echo "Error: No .dmux-agents.yml found"
  echo "  Looked in: ${project:+$(get_project_path "$project"), }$(pwd)"
  echo ""
  echo "Create a .dmux-agents.yml or use --config <file>"
  return 1
}

resolve_project_root() {
  local config_file="$1"
  local project="${2:-}"

  # If project name given, use its registered path
  if [[ -n "$project" ]]; then
    local project_path
    project_path=$(get_project_path "$project")
    if [[ -n "$project_path" ]]; then
      echo "$project_path"
      return 0
    fi
  fi

  # Otherwise use the directory containing the config file
  local config_dir
  config_dir=$(cd "$(dirname "$config_file")" && pwd)
  echo "$config_dir"
}

agents_start() {
  local project="${1:-}"
  local config_file

  config_file=$(resolve_agents_config "$project") || exit 1

  echo "Reading config: $config_file"
  parse_agents_config "$config_file" || exit 1

  local project_root
  project_root=$(resolve_project_root "$config_file" "$project")

  # Validate git repo
  if ! git -C "$project_root" rev-parse --git-dir &>/dev/null; then
    echo "Error: $project_root is not a git repository"
    exit 1
  fi

  local count=${#AGENTS_NAMES[@]}
  echo "Session: $AGENTS_SESSION"
  echo "Agents: $count"
  echo "Project root: $project_root"
  echo ""

  # Create worktrees
  echo "Setting up worktrees..."
  create_worktrees "$project_root" || exit 1
  echo ""

  # Kill existing session
  tmux kill-session -t "$AGENTS_SESSION" 2>/dev/null || true

  # Create tmux session with the first agent's worktree
  local first_wt
  first_wt=$(get_worktree_path "$project_root" "$AGENTS_WORKTREE_BASE" "$AGENTS_SESSION" "${AGENTS_NAMES[0]}")
  first_wt=$(cd "$first_wt" && pwd)

  tmux new-session -d -s "$AGENTS_SESSION" -c "$first_wt"
  tmux rename-window -t "$AGENTS_SESSION:0" "${AGENTS_NAMES[0]}"

  # Create panes for remaining agents
  for ((i=1; i<count; i++)); do
    local wt_path
    wt_path=$(get_worktree_path "$project_root" "$AGENTS_WORKTREE_BASE" "$AGENTS_SESSION" "${AGENTS_NAMES[$i]}")
    wt_path=$(cd "$wt_path" && pwd)
    tmux split-window -t "$AGENTS_SESSION:0" -c "$wt_path"
  done

  # Add main integration pane if configured
  if [[ "$AGENTS_MAIN_PANE" == "true" ]]; then
    local abs_root
    abs_root=$(cd "$project_root" && pwd)
    tmux split-window -t "$AGENTS_SESSION:0" -c "$abs_root"
  fi

  # Apply tiled layout
  tmux select-layout -t "$AGENTS_SESSION:0" tiled

  # Send claude commands to agent panes
  echo "Launching agents..."
  for ((i=0; i<count; i++)); do
    local task="${AGENTS_TASKS[$i]}"
    local name="${AGENTS_NAMES[$i]}"
    echo "  $name: claude \"$task\""
    if [[ -n "$task" ]]; then
      tmux send-keys -t "$AGENTS_SESSION:0.$i" "claude \"$task\"" Enter
    else
      tmux send-keys -t "$AGENTS_SESSION:0.$i" "claude" Enter
    fi
  done

  # Label the main pane
  if [[ "$AGENTS_MAIN_PANE" == "true" ]]; then
    local main_pane_idx=$count
    tmux send-keys -t "$AGENTS_SESSION:0.$main_pane_idx" "# Main integration pane — project root" Enter
  fi

  echo ""

  # Select first pane
  tmux select-pane -t "$AGENTS_SESSION:0.0"

  # Attach or launch in terminal
  echo "Attaching to session '$AGENTS_SESSION'..."
  case "$TERMINAL" in
    alacritty) launch_alacritty "$AGENTS_SESSION" "$project_root" "tmux attach-session -t '$AGENTS_SESSION'" ;;
    kitty)     launch_kitty "$AGENTS_SESSION" "$project_root" "tmux attach-session -t '$AGENTS_SESSION'" ;;
    wezterm)   launch_wezterm "$AGENTS_SESSION" "$project_root" "tmux attach-session -t '$AGENTS_SESSION'" ;;
    iterm)     launch_iterm "$AGENTS_SESSION" "$project_root" "tmux attach-session -t '$AGENTS_SESSION'" ;;
    *)
      echo "Error: Unsupported terminal '$TERMINAL'"
      exit 1
      ;;
  esac
}

agents_status() {
  local project="${1:-}"
  local config_file

  config_file=$(resolve_agents_config "$project") || exit 1
  parse_agents_config "$config_file" || exit 1

  # Check if session exists
  if ! tmux has-session -t "$AGENTS_SESSION" 2>/dev/null; then
    echo "Session '$AGENTS_SESSION' is not running."
    return 1
  fi

  local count=${#AGENTS_NAMES[@]}
  echo "Session: $AGENTS_SESSION"
  echo ""
  printf "  %-16s %-24s %s\n" "AGENT" "BRANCH" "STATUS"
  printf "  %-16s %-24s %s\n" "-----" "------" "------"

  for ((i=0; i<count; i++)); do
    local name="${AGENTS_NAMES[$i]}"
    local branch="${AGENTS_BRANCHES[$i]}"
    local status="unknown"

    # Check if pane exists and capture last line
    if tmux list-panes -t "$AGENTS_SESSION:0" -F '#{pane_index}' 2>/dev/null | grep -q "^${i}$"; then
      local pane_pid
      pane_pid=$(tmux list-panes -t "$AGENTS_SESSION:0.$i" -F '#{pane_pid}' 2>/dev/null)
      if [[ -n "$pane_pid" ]]; then
        # Check if claude is running in this pane
        if ps -o comm= -g "$pane_pid" 2>/dev/null | grep -q "claude"; then
          status="running"
        else
          status="idle"
        fi
      fi
    else
      status="no pane"
    fi

    printf "  %-16s %-24s %s\n" "$name" "$branch" "$status"
  done

  if [[ "$AGENTS_MAIN_PANE" == "true" ]]; then
    echo ""
    echo "  Main integration pane: active"
  fi
}

agents_cleanup() {
  local project="${1:-}"
  local config_file

  config_file=$(resolve_agents_config "$project") || exit 1
  parse_agents_config "$config_file" || exit 1

  local project_root
  project_root=$(resolve_project_root "$config_file" "$project")

  echo "Cleaning up agents for session: $AGENTS_SESSION"
  echo ""

  # Kill tmux session
  if tmux has-session -t "$AGENTS_SESSION" 2>/dev/null; then
    echo "Killing tmux session: $AGENTS_SESSION"
    tmux kill-session -t "$AGENTS_SESSION"
  else
    echo "Session '$AGENTS_SESSION' not running (skipping)"
  fi

  echo ""

  # Remove worktrees
  echo "Removing worktrees..."
  remove_worktrees "$project_root"

  echo ""
  echo "Cleanup complete."
}

handle_agents_command() {
  AGENTS_CONFIG_FILE=""

  if [[ $# -eq 0 ]]; then
    agents_usage
    return 0
  fi

  local action="$1"
  shift

  # Parse agents subcommand options
  local project=""
  while [[ $# -gt 0 ]]; do
    case "$1" in
      --config)
        [[ -z "${2:-}" ]] && { echo "Error: --config requires a file path"; return 1; }
        AGENTS_CONFIG_FILE="$2"
        shift 2
        ;;
      -t|--terminal)
        [[ -z "${2:-}" ]] && { echo "Error: -t requires terminal name"; return 1; }
        TERMINAL="$2"
        shift 2
        ;;
      -h|--help)
        agents_usage
        return 0
        ;;
      -*)
        echo "Error: Unknown option '$1'"
        agents_usage
        return 1
        ;;
      *)
        project="$1"
        shift
        ;;
    esac
  done

  case "$action" in
    start)   agents_start "$project" ;;
    status)  agents_status "$project" ;;
    cleanup) agents_cleanup "$project" ;;
    help)    agents_usage ;;
    *)
      echo "Error: Unknown agents action '$action'"
      echo "Run '$(basename "$0") agents help' for usage"
      return 1
      ;;
  esac
}

# ------------------------------------------------------------------------------
# FUNCTIONS
# ------------------------------------------------------------------------------

usage() {
  cat << EOF
dmux v$VERSION - Launch development environments with tmux + Claude

USAGE:
  $(basename "$0") -p project1,project2    Launch projects
  $(basename "$0") agents <action>         Multi-agent orchestration
  $(basename "$0") -l                      List configured projects
  $(basename "$0") -a NAME PATH            Add a project
  $(basename "$0") -r NAME                 Remove a project

OPTIONS:
  -p, --projects NAMES   Comma-separated list of projects to open
  -n, --panes NUM        Number of panes per window (default: 1)
  -c, --claude NUM       Number of panes to run 'claude' in (default: 0)
  -t, --terminal TERM    Terminal to use: alacritty, kitty, wezterm, iterm
                         (default: alacritty, or \$DMUX_TERMINAL)
  -l, --list             List all configured projects
  -a, --add NAME PATH    Add a new project
  -r, --remove NAME      Remove a project
  -h, --help             Show this help
  -v, --version          Show version

AGENTS (multi-agent orchestration):
  $(basename "$0") agents start [project]         Read .dmux-agents.yml, create worktrees, launch agents
  $(basename "$0") agents start --config <file>   Use a custom config file
  $(basename "$0") agents status [project]        Show agent pane statuses
  $(basename "$0") agents cleanup [project]       Remove worktrees and kill session
  $(basename "$0") agents help                    Show agents help

EXAMPLES:
  # Launch two projects, each in their own terminal window
  $(basename "$0") -p myapp,backend

  # Launch with 3 panes, Claude running in 2 of them
  $(basename "$0") -p myapp -n 3 -c 2

  # Add a new project
  $(basename "$0") -a myapp ~/code/myapp

  # Use a different terminal
  $(basename "$0") -p myapp -t kitty

  # Start multi-agent session from .dmux-agents.yml
  $(basename "$0") agents start

CONFIG:
  Projects are stored in: $PROJECTS_FILE

  Format (one per line):
    project_name=\$HOME/path/to/project

  Agent config (.dmux-agents.yml) — see 'dmux agents help'

EOF
}

list_projects() {
  ensure_config

  local names
  names=$(get_project_names)

  if [[ -z "$names" ]]; then
    echo "No projects configured."
    echo ""
    echo "Add your first project:"
    echo "  $(basename "$0") -a myproject ~/code/myproject"
    echo ""
    echo "Config file: $PROJECTS_FILE"
    return 0
  fi

  echo "Configured projects:"
  echo ""

  for project in $names; do
    local path
    path=$(get_project_path "$project")
    if [[ -d "$path" ]]; then
      printf "  %-16s %s\n" "$project" "$path"
    else
      printf "  %-16s %s [NOT FOUND]\n" "$project" "$path"
    fi
  done

  echo ""
  echo "Config: $PROJECTS_FILE"
}

add_project() {
  local name="$1"
  local path="$2"

  ensure_config

  # Validate name
  if [[ ! "$name" =~ ^[a-zA-Z][a-zA-Z0-9_-]*$ ]]; then
    echo "Error: Project name must start with a letter and contain only letters, numbers, hyphens, or underscores"
    exit 1
  fi

  # Check if exists
  if [[ -n "$(get_project_path "$name")" ]]; then
    echo "Error: Project '$name' already exists"
    echo "  Path: $(get_project_path "$name")"
    echo ""
    echo "To update, remove it first: $(basename "$0") -r $name"
    exit 1
  fi

  # Expand and validate path
  path="${path/#\~/$HOME}"
  if [[ ! -d "$path" ]]; then
    echo "Warning: Directory does not exist: $path"
    echo ""
    read -p "Create it? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      mkdir -p "$path"
      echo "Created: $path"
    else
      echo "Aborted. Add the project after creating the directory."
      exit 1
    fi
  fi

  # Store with $HOME for portability
  local stored_path="${path/#$HOME/\$HOME}"

  # Append to config
  echo "$name=$stored_path" >> "$PROJECTS_FILE"

  echo "Added project '$name'"
  echo "  Path: $path"
  echo ""
  echo "Launch it: $(basename "$0") -p $name"
}

remove_project() {
  local name="$1"

  ensure_config

  if [[ -z "$(get_project_path "$name")" ]]; then
    echo "Error: Project '$name' not found"
    echo ""
    echo "Available projects:"
    local names
    names=$(get_project_names)
    if [[ -n "$names" ]]; then
      for p in $names; do
        echo "  $p"
      done
    else
      echo "  (none)"
    fi
    exit 1
  fi

  echo "Remove project '$name'?"
  echo "  Path: $(get_project_path "$name")"
  echo ""
  read -p "Confirm? [y/N] " -n 1 -r
  echo ""

  if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    echo "Cancelled."
    exit 0
  fi

  # Remove line from config (works on both macOS and Linux)
  local temp_file
  temp_file=$(mktemp)
  grep -v "^$name=" "$PROJECTS_FILE" > "$temp_file" || true
  mv "$temp_file" "$PROJECTS_FILE"

  echo "Removed '$name'"
}

validate_project() {
  local project="$1"
  local dir
  dir=$(get_project_path "$project")

  if [[ -z "$dir" ]]; then
    echo "Error: Unknown project '$project'"
    echo ""
    echo "Available projects:"
    local names
    names=$(get_project_names)
    if [[ -n "$names" ]]; then
      for p in $names; do
        echo "  $p"
      done
    else
      echo "  (none) - add one with: $(basename "$0") -a name /path"
    fi
    return 1
  fi

  if [[ ! -d "$dir" ]]; then
    echo "Error: Directory not found for '$project'"
    echo "  Expected: $dir"
    return 1
  fi

  return 0
}

launch_project_window() {
  local project="$1"
  local panes="$2"
  local claude_panes="$3"
  local dir
  dir=$(get_project_path "$project")
  local session_name="dmux-$project"

  # Kill existing session
  tmux kill-session -t "$session_name" 2>/dev/null || true

  # Build tmux commands
  local setup_commands=""
  setup_commands+="tmux new-session -d -s '$session_name' -c '$dir'; "
  setup_commands+="tmux rename-window -t '$session_name:0' '$project'; "

  # Additional panes
  for ((i=1; i<panes; i++)); do
    setup_commands+="tmux split-window -v -t '$session_name:0' -c '$dir'; "
  done

  # Layout
  setup_commands+="tmux select-layout -t '$session_name:0' tiled; "

  # Launch claude
  for ((i=0; i<claude_panes && i<panes; i++)); do
    setup_commands+="tmux send-keys -t '$session_name:0.$i' 'claude' Enter; "
  done

  # Select first pane and attach
  setup_commands+="tmux select-pane -t '$session_name:0.0'; "
  setup_commands+="tmux attach-session -t '$session_name'"

  # Launch in configured terminal
  case "$TERMINAL" in
    alacritty) launch_alacritty "$project" "$dir" "$setup_commands" ;;
    kitty)     launch_kitty "$project" "$dir" "$setup_commands" ;;
    wezterm)   launch_wezterm "$project" "$dir" "$setup_commands" ;;
    iterm)     launch_iterm "$project" "$dir" "$setup_commands" ;;
    *)
      echo "Error: Unsupported terminal '$TERMINAL'"
      echo "Supported: alacritty, kitty, wezterm, iterm"
      exit 1
      ;;
  esac
}

# ------------------------------------------------------------------------------
# MAIN
# ------------------------------------------------------------------------------

PANES=1
CLAUDE_PANES=0
SELECTED_PROJECTS=()

if [[ $# -eq 0 ]]; then
  usage
  exit 0
fi

# Route subcommands before flag parsing
case "${1:-}" in
  agents) shift; handle_agents_command "$@"; exit $? ;;
esac

while [[ $# -gt 0 ]]; do
  case $1 in
    -p|--projects)
      [[ -z "${2:-}" || "$2" == -* ]] && { echo "Error: -p requires project names"; exit 1; }
      IFS=',' read -ra SELECTED_PROJECTS <<< "$2"
      shift 2
      ;;
    -n|--panes)
      [[ -z "${2:-}" || "$2" == -* ]] && { echo "Error: -n requires a number"; exit 1; }
      PANES="$2"
      shift 2
      ;;
    -c|--claude)
      [[ -z "${2:-}" || "$2" == -* ]] && { echo "Error: -c requires a number"; exit 1; }
      CLAUDE_PANES="$2"
      shift 2
      ;;
    -t|--terminal)
      [[ -z "${2:-}" || "$2" == -* ]] && { echo "Error: -t requires terminal name"; exit 1; }
      TERMINAL="$2"
      shift 2
      ;;
    -l|--list)
      list_projects
      exit 0
      ;;
    -a|--add)
      [[ -z "${2:-}" || -z "${3:-}" ]] && { echo "Error: -a requires NAME and PATH"; exit 1; }
      add_project "$2" "$3"
      exit 0
      ;;
    -r|--remove)
      [[ -z "${2:-}" || "$2" == -* ]] && { echo "Error: -r requires project name"; exit 1; }
      remove_project "$2"
      exit 0
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    -v|--version)
      echo "dmux v$VERSION"
      exit 0
      ;;
    *)
      echo "Error: Unknown option '$1'"
      echo "Run '$(basename "$0") -h' for help"
      exit 1
      ;;
  esac
done

# Validation
if [[ ${#SELECTED_PROJECTS[@]} -eq 0 ]]; then
  echo "Error: No projects specified. Use -p project1,project2"
  exit 1
fi

if ! [[ "$PANES" =~ ^[0-9]+$ ]] || [[ "$PANES" -lt 1 ]]; then
  echo "Error: Panes must be a positive number"
  exit 1
fi

if ! [[ "$CLAUDE_PANES" =~ ^[0-9]+$ ]]; then
  echo "Error: Claude panes must be a number"
  exit 1
fi

if [[ "$PANES" -gt 6 ]]; then
  echo "Warning: >6 panes may be cramped. Proceeding..."
fi

# Validate all projects
errors=0
for project in "${SELECTED_PROJECTS[@]}"; do
  if ! validate_project "$project"; then
    errors=$((errors + 1))
  fi
done

[[ $errors -gt 0 ]] && exit 1

# Cap claude panes
[[ "$CLAUDE_PANES" -gt "$PANES" ]] && CLAUDE_PANES="$PANES"

# Launch
if [[ "$CLAUDE_PANES" -gt 0 ]]; then
  echo "Launching ${#SELECTED_PROJECTS[@]} project(s) with $PANES pane(s) (claude in $CLAUDE_PANES)..."
else
  echo "Launching ${#SELECTED_PROJECTS[@]} project(s) with $PANES pane(s)..."
fi

for project in "${SELECTED_PROJECTS[@]}"; do
  echo "  $project"
  launch_project_window "$project" "$PANES" "$CLAUDE_PANES"
  sleep 0.3
done

echo ""
echo "Done! Use 'tmux ls' to see sessions."
