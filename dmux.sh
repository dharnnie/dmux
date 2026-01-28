#!/bin/bash

# ==============================================================================
# dmux - Launch terminal windows with tmux panes for your projects
# ==============================================================================
#
# A CLI tool to quickly spin up development environments with multiple
# terminal panes, optionally pre-launching Claude Code in each.
#
# https://github.com/dharnnie/dmux
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
# FUNCTIONS
# ------------------------------------------------------------------------------

usage() {
  cat << EOF
dmux v$VERSION - Launch development environments with tmux + Claude

USAGE:
  $(basename "$0") -p project1,project2    Launch projects
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

EXAMPLES:
  # Launch two projects, each in their own terminal window
  $(basename "$0") -p myapp,backend

  # Launch with 3 panes, Claude running in 2 of them
  $(basename "$0") -p myapp -n 3 -c 2

  # Add a new project
  $(basename "$0") -a myapp ~/code/myapp

  # Use a different terminal
  $(basename "$0") -p myapp -t kitty

CONFIG:
  Projects are stored in: $PROJECTS_FILE

  Format (one per line):
    project_name=\$HOME/path/to/project

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
