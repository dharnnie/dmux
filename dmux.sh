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
# AGENTS YAML CONFIG PARSER
# ------------------------------------------------------------------------------

# Global arrays populated by parse_agents_config()
AGENTS_SESSION=""
AGENTS_WORKTREE_BASE=".."
AGENTS_MAIN_PANE="true"
AGENTS_NOTIFICATIONS="true"
AGENTS_NAMES=()
AGENTS_BRANCHES=()
AGENTS_TASKS=()
AGENTS_SCOPES=()     # comma-separated writable paths, or empty
AGENTS_CONTEXTS=()   # comma-separated read-only paths, or empty
AGENTS_ROLES=()      # "build" (default) or "review"
AGENTS_DEPENDS_ON=() # comma-separated agent names, or empty
AGENTS_AUTO_ACCEPT=() # "true" or "false"

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
  AGENTS_NOTIFICATIONS="true"
  AGENTS_NAMES=()
  AGENTS_BRANCHES=()
  AGENTS_TASKS=()
  AGENTS_SCOPES=()
  AGENTS_CONTEXTS=()
  AGENTS_ROLES=()
  AGENTS_DEPENDS_ON=()
  AGENTS_AUTO_ACCEPT=()

  local in_agents_list=false
  local current_name=""
  local current_branch=""
  local current_task=""
  local current_role=""
  local current_scope=""
  local current_context=""
  local in_scope_list=false
  local in_context_list=false
  local current_depends_on=""
  local in_depends_on_list=false
  local current_auto_accept=""
  local last_scalar_field=""

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
        AGENTS_ROLES+=("${current_role:-build}")
        AGENTS_SCOPES+=("$current_scope")
        AGENTS_CONTEXTS+=("$current_context")
        AGENTS_DEPENDS_ON+=("$current_depends_on")
        AGENTS_AUTO_ACCEPT+=("${current_auto_accept:-false}")
      fi
      current_name=$(strip_yaml_comment "${BASH_REMATCH[1]}")
      current_name="${current_name#"${current_name%%[![:space:]]*}"}"
      current_name="${current_name%"${current_name##*[![:space:]]}"}"
      current_branch=""
      current_task=""
      current_role=""
      current_scope=""
      current_context=""
      current_depends_on=""
      current_auto_accept=""
      in_scope_list=false
      in_context_list=false
      in_depends_on_list=false
      last_scalar_field=""
      in_agents_list=true
      continue
    fi

    # Inside an agent entry — parse branch, task, role, scope, context
    if $in_agents_list; then
      # List items under scope: or context:
      if [[ "$line" =~ ^[[:space:]]+-[[:space:]]+(.*) ]]; then
        local item
        item=$(strip_yaml_comment "${BASH_REMATCH[1]}")
        item="${item#"${item%%[![:space:]]*}"}"
        item="${item%"${item##*[![:space:]]}"}"
        if $in_scope_list; then
          if [[ -n "$current_scope" ]]; then
            current_scope+=",${item}"
          else
            current_scope="$item"
          fi
          continue
        fi
        if $in_context_list; then
          if [[ -n "$current_context" ]]; then
            current_context+=",${item}"
          else
            current_context="$item"
          fi
          continue
        fi
        if $in_depends_on_list; then
          if [[ -n "$current_depends_on" ]]; then
            current_depends_on+=",${item}"
          else
            current_depends_on="$item"
          fi
          continue
        fi
      fi

      # Any non-list-item line resets sub-list flags
      in_scope_list=false
      in_context_list=false
      in_depends_on_list=false

      if [[ "$line" =~ ^[[:space:]]+branch:[[:space:]]*(.*) ]]; then
        current_branch=$(strip_yaml_comment "${BASH_REMATCH[1]}")
        current_branch="${current_branch#"${current_branch%%[![:space:]]*}"}"
        current_branch="${current_branch%"${current_branch##*[![:space:]]}"}"
        last_scalar_field="branch"
        continue
      fi
      if [[ "$line" =~ ^[[:space:]]+task:[[:space:]]*(.*) ]]; then
        current_task=$(strip_yaml_comment "${BASH_REMATCH[1]}")
        current_task="${current_task#"${current_task%%[![:space:]]*}"}"
        current_task="${current_task%"${current_task##*[![:space:]]}"}"
        last_scalar_field="task"
        continue
      fi
      if [[ "$line" =~ ^[[:space:]]+role:[[:space:]]*(.*) ]]; then
        current_role=$(strip_yaml_comment "${BASH_REMATCH[1]}")
        current_role="${current_role#"${current_role%%[![:space:]]*}"}"
        current_role="${current_role%"${current_role##*[![:space:]]}"}"
        last_scalar_field="role"
        continue
      fi
      if [[ "$line" =~ ^[[:space:]]+auto_accept:[[:space:]]*(.*) ]]; then
        current_auto_accept=$(strip_yaml_comment "${BASH_REMATCH[1]}")
        current_auto_accept="${current_auto_accept#"${current_auto_accept%%[![:space:]]*}"}"
        current_auto_accept="${current_auto_accept%"${current_auto_accept##*[![:space:]]}"}"
        last_scalar_field="auto_accept"
        continue
      fi
      if [[ "$line" =~ ^[[:space:]]+scope:[[:space:]]*$ ]]; then
        in_scope_list=true
        last_scalar_field=""
        continue
      fi
      if [[ "$line" =~ ^[[:space:]]+context:[[:space:]]*$ ]]; then
        in_context_list=true
        last_scalar_field=""
        continue
      fi
      if [[ "$line" =~ ^[[:space:]]+depends_on:[[:space:]]*$ ]]; then
        in_depends_on_list=true
        last_scalar_field=""
        continue
      fi

      # Multi-line scalar continuation: indented line that didn't match any key
      if [[ -n "$last_scalar_field" && "$line" =~ ^[[:space:]]+(.*) ]]; then
        local cont
        cont="${BASH_REMATCH[1]}"
        cont="${cont#"${cont%%[![:space:]]*}"}"
        cont="${cont%"${cont##*[![:space:]]}"}"
        if [[ -n "$cont" ]]; then
          case "$last_scalar_field" in
            task) current_task+=" $cont" ;;
            branch) current_branch+=" $cont" ;;
            role) current_role+=" $cont" ;;
            auto_accept) current_auto_accept+=" $cont" ;;
          esac
        fi
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
    if [[ "$line" =~ ^notifications:[[:space:]]*(.*) ]]; then
      AGENTS_NOTIFICATIONS=$(strip_yaml_comment "${BASH_REMATCH[1]}")
      AGENTS_NOTIFICATIONS="${AGENTS_NOTIFICATIONS#"${AGENTS_NOTIFICATIONS%%[![:space:]]*}"}"
      AGENTS_NOTIFICATIONS="${AGENTS_NOTIFICATIONS%"${AGENTS_NOTIFICATIONS##*[![:space:]]}"}"
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
    AGENTS_ROLES+=("${current_role:-build}")
    AGENTS_SCOPES+=("$current_scope")
    AGENTS_CONTEXTS+=("$current_context")
    AGENTS_DEPENDS_ON+=("$current_depends_on")
    AGENTS_AUTO_ACCEPT+=("${current_auto_accept:-false}")
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

  # Validate depends_on references
  local count=${#AGENTS_NAMES[@]}
  for ((i=0; i<count; i++)); do
    local deps="${AGENTS_DEPENDS_ON[$i]}"
    [[ -z "$deps" ]] && continue
    IFS=',' read -ra dep_arr <<< "$deps"
    for dep in "${dep_arr[@]}"; do
      if [[ "$dep" == "${AGENTS_NAMES[$i]}" ]]; then
        echo "Error: Agent '${AGENTS_NAMES[$i]}' cannot depend on itself"
        return 1
      fi
      local found=false
      for name in "${AGENTS_NAMES[@]}"; do
        [[ "$name" == "$dep" ]] && found=true && break
      done
      if ! $found; then
        echo "Error: Agent '${AGENTS_NAMES[$i]}' depends on unknown agent '$dep'"
        return 1
      fi
    done
  done

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

    if [[ "${AGENTS_ROLES[$i]}" == "review" ]]; then
      echo "  Skipping worktree for review agent: $name"
      continue
    fi

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

  done
}

remove_worktrees() {
  local project_root="$1"
  local count=${#AGENTS_NAMES[@]}

  for ((i=0; i<count; i++)); do
    local name="${AGENTS_NAMES[$i]}"

    if [[ "${AGENTS_ROLES[$i]}" == "review" ]]; then
      echo "  Skipping worktree for review agent: $name"
      continue
    fi

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
# SIGNAL / MARKER FILE MANAGEMENT
# ------------------------------------------------------------------------------

setup_signal_dir() {
  local project_root="$1"
  local signal_dir="$project_root/.dmux/signals"
  rm -rf "$signal_dir"
  mkdir -p "$signal_dir"
  echo "$signal_dir"
}

cleanup_signal_dir() {
  local project_root="$1"
  local dmux_dir="$project_root/.dmux"
  if [[ -d "$dmux_dir" ]]; then
    rm -rf "$dmux_dir"
    echo "  Removed signal directory: $dmux_dir"
  fi
}

# Send a desktop notification (macOS via osascript, Linux via notify-send).
# Silently no-ops if neither tool is available.
send_notification() {
  local title="$1"
  local message="$2"
  if [[ "$(uname)" == "Darwin" ]]; then
    osascript -e "display notification \"$message\" with title \"$title\"" 2>/dev/null || true
  elif command -v notify-send &>/dev/null; then
    notify-send "$title" "$message" 2>/dev/null || true
  fi
}

# ------------------------------------------------------------------------------
# CHANGELOG GENERATION
# ------------------------------------------------------------------------------

generate_agent_changelog() {
  local agent_name="$1"
  local branch="$2"
  local project_root="$3"

  local base_branch="main"
  if [[ -f "$project_root/.dmux/base_branch" ]]; then
    base_branch=$(cat "$project_root/.dmux/base_branch")
  fi

  mkdir -p "$project_root/.dmux/changelogs"

  local changelog_file="$project_root/.dmux/changelogs/${agent_name}.md"

  local commits
  commits=$(git -C "$project_root" log "${base_branch}..${branch}" --oneline --no-decorate 2>/dev/null || echo "(no commits)")

  local diff_stat
  diff_stat=$(git -C "$project_root" diff --stat "${base_branch}..${branch}" 2>/dev/null || echo "(no changes)")

  local agent_summary=""
  local summary_content
  if summary_content=$(git -C "$project_root" show "${branch}:AGENT_SUMMARY.md" 2>/dev/null); then
    agent_summary="$summary_content"
  fi

  {
    echo "## ${agent_name}"
    echo "Branch: \`${branch}\`"
    echo ""
    if [[ -n "$agent_summary" ]]; then
      echo "### Summary"
      echo "$agent_summary"
      echo ""
    fi
    echo "### Commits"
    echo '```'
    echo "$commits"
    echo '```'
    echo ""
    echo "### Changed Files"
    echo '```'
    echo "$diff_stat"
    echo '```'
  } > "$changelog_file"
}

generate_combined_changelog() {
  local project_root="$1"
  local session_name="${2:-unknown}"

  local base_branch="main"
  if [[ -f "$project_root/.dmux/base_branch" ]]; then
    base_branch=$(cat "$project_root/.dmux/base_branch")
  fi

  local timestamp
  timestamp=$(date '+%Y-%m-%d %H:%M:%S')

  local combined=""
  combined+="# Agents Changelog"$'\n'
  combined+="Session: ${session_name}"$'\n'
  combined+="Generated: ${timestamp}"$'\n'
  combined+="Base branch: ${base_branch}"$'\n'

  if [[ -d "$project_root/.dmux/changelogs" ]]; then
    for cl_file in "$project_root/.dmux/changelogs"/*.md; do
      [[ -f "$cl_file" ]] || continue
      combined+=$'\n'"---"$'\n\n'
      combined+=$(cat "$cl_file")$'\n'
    done
  fi

  combined+=$'\n'"---"$'\n'

  echo "$combined"
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
  $(basename "$0") agents start -y                Skip confirmation prompt
  $(basename "$0") agents status [project]        Show agent pane statuses
  $(basename "$0") agents changelog [project]    Generate changelog from agent work
  $(basename "$0") agents cleanup [project]       Remove worktrees and kill session
  $(basename "$0") agents init                    Interactively generate .dmux-agents.yml

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
        scope:                     # optional: writable paths
          - src/auth/
          - src/middleware/auth.ts
        context:                   # optional: read-only paths
          - src/types/
      - name: catalog
        branch: feature/catalog
        task: "build product listing API"
        auto_accept: true          # skip permission prompts
      - name: reviewer
        role: review               # review agent (no worktree)
        task: "review changes for bugs and security issues"
        depends_on:                # wait for these agents to finish
          - auth
          - catalog
    main_pane: true                # include integration pane

OPTIONS:
  -y, --yes              Skip confirmation prompt before launching
  --config <file>        Use a custom config file
  -t, --terminal <term>  Terminal to use

EXAMPLES:
  # Start agents from .dmux-agents.yml in current directory
  $(basename "$0") agents start

  # Start without confirmation prompt
  $(basename "$0") agents start -y

  # Start agents for a registered project
  $(basename "$0") agents start myapp

  # Start agents with a custom config
  $(basename "$0") agents start --config ~/configs/agents.yml

  # Check agent statuses
  $(basename "$0") agents status

  # Clean up worktrees and kill session
  $(basename "$0") agents cleanup

  # Interactively create .dmux-agents.yml
  $(basename "$0") agents init

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

build_agent_prompt() {
  local task="$1"
  local scope="$2"
  local context="$3"
  local role="$4"
  local all_branches="$5"

  local prompt="$task"

  if [[ "$role" == "review" ]]; then
    if [[ -z "$prompt" ]]; then
      prompt="Review the changes on branches ${all_branches} for bugs, security issues, and adherence to project conventions. Use git diff main..<branch> to inspect changes."
    fi
    echo "$prompt"
    return
  fi

  # Build role (default)
  if [[ -n "$scope" ]]; then
    local scope_fmt="${scope//,/, }"
    prompt+=" Only modify files in: ${scope_fmt}."
  fi
  if [[ -n "$context" ]]; then
    local context_fmt="${context//,/, }"
    prompt+=" You may read but not modify: ${context_fmt}."
  fi

  prompt+=" Before committing, write a brief AGENT_SUMMARY.md in the root of your working directory summarizing what you built and any important decisions made."
  prompt+=" When you are done, commit all your changes with a descriptive commit message."

  echo "$prompt"
}

print_launch_summary() {
  local config_file="$1"
  local skip_confirm="$2"
  local count=${#AGENTS_NAMES[@]}

  echo "Config: $config_file"
  echo ""
  printf "  %-16s %s\n" "SESSION" "$AGENTS_SESSION"
  printf "  %-16s %s\n" "WORKTREE BASE" "$AGENTS_WORKTREE_BASE"
  printf "  %-16s %s\n" "MAIN PANE" "$AGENTS_MAIN_PANE"
  echo ""
  printf "  %-16s %-24s %-8s %-6s %s\n" "AGENT" "BRANCH" "ROLE" "AUTO" "DEPENDS ON"
  printf "  %-16s %-24s %-8s %-6s %s\n" "-----" "------" "----" "----" "----------"

  local worktree_count=0
  local review_count=0
  for ((i=0; i<count; i++)); do
    local name="${AGENTS_NAMES[$i]}"
    local branch="${AGENTS_BRANCHES[$i]}"
    local role="${AGENTS_ROLES[$i]}"
    local deps="${AGENTS_DEPENDS_ON[$i]}"
    local auto="${AGENTS_AUTO_ACCEPT[$i]}"

    if [[ "$role" == "review" ]]; then
      branch="—"
      review_count=$((review_count + 1))
    else
      worktree_count=$((worktree_count + 1))
    fi

    local dep_display="—"
    if [[ -n "$deps" ]]; then
      dep_display="${deps//,/, }"
    fi

    printf "  %-16s %-24s %-8s %-6s %s\n" "$name" "$branch" "$role" "$auto" "$dep_display"
  done

  echo ""
  echo "  Worktrees to create: $worktree_count"
  if [[ $review_count -gt 0 ]]; then
    echo "  Review agents: $review_count (will wait for dependencies)"
  fi
  echo ""

  if [[ "$skip_confirm" != "true" ]]; then
    read -p "Proceed? [Y/n]: " -n 1 -r
    echo ""
    if [[ "$REPLY" =~ ^[Nn]$ ]]; then
      echo "Aborted."
      exit 0
    fi
    echo ""
  fi
}

agents_start() {
  local project="${1:-}"
  local skip_confirm="${2:-false}"
  local config_file

  config_file=$(resolve_agents_config "$project") || exit 1
  parse_agents_config "$config_file" || exit 1

  local project_root
  project_root=$(resolve_project_root "$config_file" "$project")

  # Validate git repo
  if ! git -C "$project_root" rev-parse --git-dir &>/dev/null; then
    echo "Error: $project_root is not a git repository"
    exit 1
  fi

  # Print summary and confirm
  print_launch_summary "$config_file" "$skip_confirm"

  local count=${#AGENTS_NAMES[@]}

  # Create worktrees
  echo "Setting up worktrees..."
  create_worktrees "$project_root" || exit 1
  echo ""

  local abs_root
  abs_root=$(cd "$project_root" && pwd)

  # Set up signal directory for marker files (use absolute path so all agents resolve it correctly)
  local signal_dir
  signal_dir=$(setup_signal_dir "$abs_root")
  echo "Signal directory: $signal_dir"

  # Save base branch for changelog generation
  git -C "$project_root" rev-parse --abbrev-ref HEAD > "$abs_root/.dmux/base_branch"
  echo "Base branch: $(cat "$abs_root/.dmux/base_branch")"
  echo ""

  # Kill existing session
  tmux kill-session -t "$AGENTS_SESSION" 2>/dev/null || true

  # Collect all non-review branch names for review agent prompts
  local all_branches=""
  for ((i=0; i<count; i++)); do
    if [[ "${AGENTS_ROLES[$i]}" != "review" && -n "${AGENTS_BRANCHES[$i]}" ]]; then
      if [[ -n "$all_branches" ]]; then
        all_branches+=", ${AGENTS_BRANCHES[$i]}"
      else
        all_branches="${AGENTS_BRANCHES[$i]}"
      fi
    fi
  done

  # Determine working directory for each agent
  local first_cwd
  if [[ "${AGENTS_ROLES[0]}" == "review" ]]; then
    first_cwd="$abs_root"
  else
    first_cwd=$(get_worktree_path "$project_root" "$AGENTS_WORKTREE_BASE" "$AGENTS_SESSION" "${AGENTS_NAMES[0]}")
    first_cwd=$(cd "$first_cwd" && pwd)
  fi

  # Create tmux session with the first agent's directory
  tmux new-session -d -s "$AGENTS_SESSION" -c "$first_cwd"
  tmux rename-window -t "$AGENTS_SESSION:0" "${AGENTS_NAMES[0]}"

  # Create panes for remaining agents
  for ((i=1; i<count; i++)); do
    local pane_cwd
    if [[ "${AGENTS_ROLES[$i]}" == "review" ]]; then
      pane_cwd="$abs_root"
    else
      pane_cwd=$(get_worktree_path "$project_root" "$AGENTS_WORKTREE_BASE" "$AGENTS_SESSION" "${AGENTS_NAMES[$i]}")
      pane_cwd=$(cd "$pane_cwd" && pwd)
    fi
    tmux split-window -t "$AGENTS_SESSION:0" -c "$pane_cwd"
  done

  # Add main integration pane if configured
  if [[ "$AGENTS_MAIN_PANE" == "true" ]]; then
    tmux split-window -t "$AGENTS_SESSION:0" -c "$abs_root"
  fi

  # Apply tiled layout
  tmux select-layout -t "$AGENTS_SESSION:0" tiled

  # Resolve dmux script path for auto-changelog
  local dmux_bin
  dmux_bin=$(cd "$(dirname "$0")" && pwd)/$(basename "$0")

  # Build space-separated list of all agent names (for summary notification)
  local all_agent_names=""
  for ((i=0; i<count; i++)); do
    all_agent_names+="${AGENTS_NAMES[$i]} "
  done
  all_agent_names="${all_agent_names% }"

  # Build reusable notification suffix (empty string when notifications disabled)
  local summary_cmd=""
  if [[ "$AGENTS_NOTIFICATIONS" == "true" ]]; then
    summary_cmd="; '${dmux_bin}' _notify-summary '${signal_dir}' ${all_agent_names}"
  fi

  # Send claude commands to agent panes
  echo "Launching agents..."
  for ((i=0; i<count; i++)); do
    local name="${AGENTS_NAMES[$i]}"
    local branch="${AGENTS_BRANCHES[$i]}"
    local deps="${AGENTS_DEPENDS_ON[$i]}"
    local full_prompt
    full_prompt=$(build_agent_prompt "${AGENTS_TASKS[$i]}" "${AGENTS_SCOPES[$i]}" "${AGENTS_CONTEXTS[$i]}" "${AGENTS_ROLES[$i]}" "$all_branches")

    # Escape single quotes for safe shell embedding (single-quoted strings
    # prevent $, `, \, and ! expansion that double quotes would allow)
    local escaped_prompt="${full_prompt//\'/\'\\\'\'}"

    # Build claude command with optional --dangerously-skip-permissions
    local claude_cmd="claude"
    if [[ "${AGENTS_AUTO_ACCEPT[$i]}" == "true" ]]; then
      claude_cmd="claude --dangerously-skip-permissions"
    fi

    # Build per-agent notification commands (empty when notifications disabled)
    local notify_ok="" notify_fail="" notify_blocked=""
    if [[ "$AGENTS_NOTIFICATIONS" == "true" ]]; then
      notify_ok="; '${dmux_bin}' _notify 'dmux: ${name} finished' 'Agent completed successfully'"
      notify_fail="; '${dmux_bin}' _notify 'dmux: ${name} failed' 'Agent exited with code '\$_exit"
      notify_blocked="; '${dmux_bin}' _notify 'dmux: ${name} blocked' 'Skipped — dependency failed'"
    fi

    if [[ -n "$deps" ]]; then
      # Dependent agent: wait for marker files, then launch
      local dep_display="${deps//,/, }"
      echo "  $name: waiting for $dep_display, then ${claude_cmd} \"$full_prompt\""

      IFS=',' read -ra dep_arr <<< "$deps"
      local wait_cmd="echo 'Waiting for agents: ${dep_display}...'; "
      wait_cmd+="while true; do all_done=true; "
      for dep in "${dep_arr[@]}"; do
        wait_cmd+="if [ -f '${signal_dir}/${dep}.done' ]; then echo '  ${dep}: done (exit '\$(cat \"${signal_dir}/${dep}.done\")')'; else echo '  ${dep}: pending'; all_done=false; fi; "
      done
      wait_cmd+="\$all_done && break; sleep 10; done; "
      wait_cmd+="echo 'All dependencies finished.'; "
      # Check if any dependency failed before launching
      wait_cmd+="any_failed=false; "
      for dep in "${dep_arr[@]}"; do
        wait_cmd+="dep_code=\$(cat '${signal_dir}/${dep}.done'); if [ \"\$dep_code\" != '0' ]; then echo 'Dependency ${dep} failed (exit '\$dep_code')'; any_failed=true; fi; "
      done
      wait_cmd+="if \$any_failed; then echo 'Skipping agent — dependencies failed.'; echo 99 > '${signal_dir}/${name}.done'${notify_blocked}${summary_cmd}; else "
      if [[ -n "$full_prompt" ]]; then
        wait_cmd+="${claude_cmd} '${escaped_prompt}'; _exit=\$?; echo \$_exit > '${signal_dir}/${name}.done'; [ \$_exit -eq 0 ] && '${dmux_bin}' _agent-changelog '${name}' '${branch}' '${abs_root}'; if [ \$_exit -eq 0 ]; then true${notify_ok}; else true${notify_fail}; fi${summary_cmd}"
      else
        wait_cmd+="${claude_cmd}; _exit=\$?; echo \$_exit > '${signal_dir}/${name}.done'; [ \$_exit -eq 0 ] && '${dmux_bin}' _agent-changelog '${name}' '${branch}' '${abs_root}'; if [ \$_exit -eq 0 ]; then true${notify_ok}; else true${notify_fail}; fi${summary_cmd}"
      fi
      wait_cmd+="; fi"
      tmux send-keys -t "$AGENTS_SESSION:0.$i" "$wait_cmd" Enter
    else
      # Independent agent: launch immediately with marker file on exit
      echo "  $name: ${claude_cmd} \"$full_prompt\""
      if [[ -n "$full_prompt" ]]; then
        tmux send-keys -t "$AGENTS_SESSION:0.$i" "${claude_cmd} '${escaped_prompt}'; _exit=\$?; echo \$_exit > '${signal_dir}/${name}.done'; [ \$_exit -eq 0 ] && '${dmux_bin}' _agent-changelog '${name}' '${branch}' '${abs_root}'; if [ \$_exit -eq 0 ]; then true${notify_ok}; else true${notify_fail}; fi${summary_cmd}" Enter
      else
        tmux send-keys -t "$AGENTS_SESSION:0.$i" "${claude_cmd}; _exit=\$?; echo \$_exit > '${signal_dir}/${name}.done'; [ \$_exit -eq 0 ] && '${dmux_bin}' _agent-changelog '${name}' '${branch}' '${abs_root}'; if [ \$_exit -eq 0 ]; then true${notify_ok}; else true${notify_fail}; fi${summary_cmd}" Enter
      fi
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

  local project_root
  project_root=$(resolve_project_root "$config_file" "$project")
  local signal_dir="$project_root/.dmux/signals"

  # Check if session exists
  if ! tmux has-session -t "$AGENTS_SESSION" 2>/dev/null; then
    echo "Session '$AGENTS_SESSION' is not running."
    return 1
  fi

  local count=${#AGENTS_NAMES[@]}
  echo "Session: $AGENTS_SESSION"
  echo ""
  printf "  %-16s %-24s %-8s %s\n" "AGENT" "BRANCH" "ROLE" "STATUS"
  printf "  %-16s %-24s %-8s %s\n" "-----" "------" "----" "------"

  for ((i=0; i<count; i++)); do
    local name="${AGENTS_NAMES[$i]}"
    local branch="${AGENTS_BRANCHES[$i]}"
    local role="${AGENTS_ROLES[$i]}"
    local deps="${AGENTS_DEPENDS_ON[$i]}"
    local status="unknown"

    # Review agents have no dedicated branch
    if [[ "$role" == "review" ]]; then
      branch="—"
    fi

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

    # Refine idle status with signal/depends_on info
    if [[ "$status" == "idle" && -d "$signal_dir" ]]; then
      if [[ -f "${signal_dir}/${name}.done" ]]; then
        local exit_code
        exit_code=$(cat "${signal_dir}/${name}.done" 2>/dev/null)
        if [[ "$exit_code" == "0" ]]; then
          status="done"
        elif [[ "$exit_code" == "99" ]]; then
          status="blocked"
        else
          status="failed (exit ${exit_code:-?})"
        fi
      elif [[ -n "$deps" ]]; then
        local dep_display="${deps//,/, }"
        status="waiting (${dep_display})"
      fi
    fi

    printf "  %-16s %-24s %-8s %s\n" "$name" "$branch" "$role" "$status"
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

  # Generate any missing per-agent changelogs
  local count=${#AGENTS_NAMES[@]}
  for ((i=0; i<count; i++)); do
    if [[ "${AGENTS_ROLES[$i]}" == "review" ]]; then
      continue
    fi
    local name="${AGENTS_NAMES[$i]}"
    local branch="${AGENTS_BRANCHES[$i]}"
    local changelog_file="$project_root/.dmux/changelogs/${name}.md"
    if [[ ! -f "$changelog_file" ]]; then
      generate_agent_changelog "$name" "$branch" "$project_root"
      echo "Generated changelog for agent: $name"
    fi
  done

  # Combine changelogs and write to project root
  local combined
  combined=$(generate_combined_changelog "$project_root" "$AGENTS_SESSION")
  echo "$combined" > "$project_root/AGENTS_CHANGELOG.md"
  echo ""
  echo "$combined"
  echo ""
  echo "Wrote AGENTS_CHANGELOG.md"
  echo ""

  # Kill tmux session
  if tmux has-session -t "$AGENTS_SESSION" 2>/dev/null; then
    echo "Killing tmux session: $AGENTS_SESSION"
    tmux kill-session -t "$AGENTS_SESSION"
  else
    echo "Session '$AGENTS_SESSION' not running (skipping)"
  fi

  echo ""

  # Remove signal directory
  cleanup_signal_dir "$project_root"

  # Remove worktrees
  echo "Removing worktrees..."
  remove_worktrees "$project_root"

  echo ""
  echo "Cleanup complete."
}

agents_init() {
  local output_file=".dmux-agents.yml"

  if [[ -f "$output_file" ]]; then
    echo "Warning: $output_file already exists."
    read -p "Overwrite? [y/N]: " -n 1 -r
    echo ""
    if [[ ! "$REPLY" =~ ^[Yy]$ ]]; then
      echo "Aborted."
      return 0
    fi
    echo ""
  fi

  # Session name
  read -p "Session name: " -r session_name
  if [[ -z "$session_name" ]]; then
    echo "Error: Session name is required"
    return 1
  fi

  # Worktree base
  read -p "Worktree base [..]: " -r worktree_base
  worktree_base="${worktree_base:-..}"

  # Main pane
  read -p "Include main integration pane? [Y/n]: " -n 1 -r
  echo ""
  local main_pane="true"
  if [[ "$REPLY" =~ ^[Nn]$ ]]; then
    main_pane="false"
  fi

  echo ""

  # Collect agents
  local agents_yaml=""
  local agent_num=1
  local add_more="Y"

  while [[ "$add_more" =~ ^[Yy]$ || -z "$add_more" ]]; do
    echo "Agent $agent_num:"
    read -p "  Name: " -r agent_name
    if [[ -z "$agent_name" ]]; then
      echo "  Error: Agent name is required"
      continue
    fi

    # Role
    read -p "  Role (build/review) [build]: " -r agent_role
    agent_role="${agent_role:-build}"

    local agent_branch=""
    if [[ "$agent_role" != "review" ]]; then
      read -p "  Branch: " -r agent_branch
    fi

    read -p "  Task: " -r agent_task

    # Depends on (for review agents especially)
    local agent_depends=""
    read -p "  Depends on (comma-separated, or empty): " -r agent_depends

    # Build YAML for this agent
    agents_yaml+="  - name: ${agent_name}"$'\n'
    if [[ -n "$agent_branch" ]]; then
      agents_yaml+="    branch: ${agent_branch}"$'\n'
    fi
    if [[ "$agent_role" != "build" ]]; then
      agents_yaml+="    role: ${agent_role}"$'\n'
    fi
    if [[ -n "$agent_task" ]]; then
      agents_yaml+="    task: \"${agent_task}\""$'\n'
    fi
    if [[ -n "$agent_depends" ]]; then
      agents_yaml+="    depends_on:"$'\n'
      IFS=',' read -ra dep_items <<< "$agent_depends"
      for dep in "${dep_items[@]}"; do
        dep="${dep#"${dep%%[![:space:]]*}"}"
        dep="${dep%"${dep##*[![:space:]]}"}"
        agents_yaml+="      - ${dep}"$'\n'
      done
    fi

    # Auto-accept
    local agent_auto_accept="false"
    read -p "  Auto-accept? (skip permission prompts) [y/N]: " -n 1 -r
    echo ""
    if [[ "$REPLY" =~ ^[Yy]$ ]]; then
      agent_auto_accept="true"
    fi
    if [[ "$agent_auto_accept" == "true" ]]; then
      agents_yaml+="    auto_accept: true"$'\n'
    fi

    echo ""
    agent_num=$((agent_num + 1))
    read -p "Add another agent? [Y/n]: " -n 1 -r add_more
    echo ""
    echo ""
  done

  # Write YAML
  cat > "$output_file" << EOF
session: ${session_name}
worktree_base: ${worktree_base}
main_pane: ${main_pane}

agents:
${agents_yaml}
EOF

  echo "Wrote $output_file"
}

agents_changelog() {
  local project="${1:-}"
  local config_file

  config_file=$(resolve_agents_config "$project") || exit 1
  parse_agents_config "$config_file" || exit 1

  local project_root
  project_root=$(resolve_project_root "$config_file" "$project")

  local count=${#AGENTS_NAMES[@]}

  # Regenerate per-agent changelogs for all build agents
  for ((i=0; i<count; i++)); do
    if [[ "${AGENTS_ROLES[$i]}" == "review" ]]; then
      continue
    fi
    local name="${AGENTS_NAMES[$i]}"
    local branch="${AGENTS_BRANCHES[$i]}"
    generate_agent_changelog "$name" "$branch" "$project_root"
    echo "Generated changelog for agent: $name" >&2
  done

  # Print combined changelog to stdout
  generate_combined_changelog "$project_root" "$AGENTS_SESSION"
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
  local skip_confirm="false"
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
      -y|--yes)
        skip_confirm="true"
        shift
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
    start)   agents_start "$project" "$skip_confirm" ;;
    status)  agents_status "$project" ;;
    cleanup)   agents_cleanup "$project" ;;
    changelog) agents_changelog "$project" ;;
    init)      agents_init ;;
    help)      agents_usage ;;
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

dmux_update() {
  local update_url="https://github.com/dharnnie/dmux/raw/main/dmux.sh"
  local self
  self="$(realpath "$0")"

  echo "Checking for updates..."

  local tmpfile
  tmpfile=$(mktemp)
  trap 'rm -f "$tmpfile"' EXIT

  if ! curl -fsSL "$update_url" -o "$tmpfile" 2>/dev/null; then
    echo "Error: Failed to download update from $update_url"
    return 1
  fi

  local new_version
  new_version=$(grep -m1 '^VERSION=' "$tmpfile" | cut -d'"' -f2)

  if [[ -z "$new_version" ]]; then
    echo "Error: Could not determine version from downloaded script"
    return 1
  fi

  if [[ "$VERSION" == "$new_version" ]]; then
    echo "dmux is already up to date (v${VERSION})"
    return 0
  fi

  cp "$tmpfile" "$self"
  chmod +x "$self"
  echo "Updated dmux: v${VERSION} -> v${new_version}"
}

usage() {
  cat << EOF
dmux v$VERSION - Launch development environments with tmux + Claude

USAGE:
  $(basename "$0") -p project1,project2    Launch projects
  $(basename "$0") agents <action>         Multi-agent orchestration
  $(basename "$0") update                  Self-update to latest version
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
  $(basename "$0") agents start -y                Skip confirmation prompt
  $(basename "$0") agents status [project]        Show agent pane statuses
  $(basename "$0") agents changelog [project]    Generate changelog from agent work
  $(basename "$0") agents cleanup [project]       Remove worktrees and kill session
  $(basename "$0") agents init                    Interactively generate .dmux-agents.yml
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
  update) dmux_update; exit $? ;;
  _agent-changelog)
    # Internal subcommand: generate changelog for a single agent
    generate_agent_changelog "$2" "$3" "$4"
    exit $?
    ;;
  _notify)
    # Internal subcommand: send a desktop notification
    send_notification "$2" "$3"
    exit 0
    ;;
  _notify-summary)
    # Internal subcommand: if all agents are done, send a summary notification
    # Usage: _notify-summary <signal_dir> <agent1> <agent2> ...
    _sig_dir="$2"; shift 2
    _all_done=true; _ok=0; _fail=0
    for _ag in "$@"; do
      if [[ ! -f "$_sig_dir/$_ag.done" ]]; then
        _all_done=false
        break
      fi
      _code=$(cat "$_sig_dir/$_ag.done")
      if [[ "$_code" == "0" ]]; then ((_ok++)); else ((_fail++)); fi
    done
    if $_all_done; then
      send_notification "dmux: All agents finished" "$_ok succeeded, $_fail failed"
    fi
    exit 0
    ;;
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
