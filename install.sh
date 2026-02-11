#!/bin/bash

# ==============================================================================
# dmux installer
# ==============================================================================
#
# Install:
#   curl -fsSL https://raw.githubusercontent.com/dharnnie/dmux/main/install.sh | bash
#
# Or clone and run:
#   git clone https://github.com/dharnnie/dmux.git
#   cd dmux && ./install.sh
#
# ==============================================================================

set -euo pipefail

REPO_URL="https://github.com/dharnnie/dmux"
INSTALL_DIR="${HOME}/.local/bin"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/dmux"
UI_DIR="${HOME}/.local/share/dmux/ui"
INSTALL_UI=false

# Colors
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[0;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

info() { echo -e "${BLUE}==>${NC} $1"; }
success() { echo -e "${GREEN}==>${NC} $1"; }
warn() { echo -e "${YELLOW}Warning:${NC} $1"; }
error() { echo -e "${RED}Error:${NC} $1"; exit 1; }

# ------------------------------------------------------------------------------
# Checks
# ------------------------------------------------------------------------------

check_dependencies() {
  info "Checking dependencies..."

  local missing=()

  # Required
  command -v tmux >/dev/null 2>&1 || missing+=("tmux")
  command -v bash >/dev/null 2>&1 || missing+=("bash")

  # At least one terminal
  local has_terminal=false
  for term in alacritty kitty wezterm; do
    if command -v "$term" >/dev/null 2>&1; then
      has_terminal=true
      break
    fi
  done

  # Check for iTerm on macOS
  if [[ "$OSTYPE" == "darwin"* ]] && [[ -d "/Applications/iTerm.app" ]]; then
    has_terminal=true
  fi

  if [[ ${#missing[@]} -gt 0 ]]; then
    error "Missing required dependencies: ${missing[*]}

Install them first:
  macOS:   brew install ${missing[*]}
  Ubuntu:  sudo apt install ${missing[*]}
  Arch:    sudo pacman -S ${missing[*]}"
  fi

  if [[ "$has_terminal" == false ]]; then
    warn "No supported terminal found (alacritty, kitty, wezterm, iTerm)"
    echo "    Install one of them, or dmux won't be able to launch windows."
    echo ""
    read -p "Continue anyway? [y/N] " -n 1 -r
    echo ""
    [[ ! $REPLY =~ ^[Yy]$ ]] && exit 1
  fi

  success "Dependencies OK"
}

# ------------------------------------------------------------------------------
# Install
# ------------------------------------------------------------------------------

install_script() {
  info "Installing to $INSTALL_DIR..."

  mkdir -p "$INSTALL_DIR"

  # Determine source
  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  local is_update=false
  local old_version=""
  if [[ -f "$INSTALL_DIR/dmux" ]]; then
    is_update=true
    old_version=$(grep -m1 '^VERSION=' "$INSTALL_DIR/dmux" 2>/dev/null | cut -d'"' -f2 || true)
  fi

  if [[ -f "$script_dir/dmux.sh" ]]; then
    # Local install from cloned repo
    cp "$script_dir/dmux.sh" "$INSTALL_DIR/dmux"
  else
    # Remote install - download from GitHub
    info "Downloading from $REPO_URL..."
    curl -fsSL "$REPO_URL/raw/main/dmux.sh" -o "$INSTALL_DIR/dmux"
  fi

  chmod +x "$INSTALL_DIR/dmux"

  local new_version
  new_version=$(grep -m1 '^VERSION=' "$INSTALL_DIR/dmux" 2>/dev/null | cut -d'"' -f2 || true)

  if $is_update; then
    if [[ -n "$old_version" && -n "$new_version" && "$old_version" != "$new_version" ]]; then
      success "Updated dmux: v${old_version} -> v${new_version}"
      echo "    Run 'dmux -h' to see what's new."
    elif [[ -n "$new_version" && "$old_version" == "$new_version" ]]; then
      success "dmux is already up to date (v${new_version})"
    else
      success "Updated: $INSTALL_DIR/dmux"
    fi
  else
    success "Installed: $INSTALL_DIR/dmux (v${new_version:-unknown})"
  fi
}

setup_config() {
  info "Setting up config directory..."

  mkdir -p "$CONFIG_DIR"

  if [[ ! -f "$CONFIG_DIR/projects" ]]; then
    touch "$CONFIG_DIR/projects"
    cat > "$CONFIG_DIR/projects" << 'EOF'
# dmux project configuration
# Format: name=$HOME/path/to/project
#
# Examples:
# myapp=$HOME/code/myapp
# backend=$HOME/work/backend
# dotfiles=$HOME/.dotfiles
EOF
    success "Created: $CONFIG_DIR/projects"
  else
    success "Config exists: $CONFIG_DIR/projects"
  fi
}

install_ui() {
  if [[ "$INSTALL_UI" != true ]]; then
    return
  fi

  info "Installing dmux UI..."

  if ! command -v node >/dev/null 2>&1; then
    error "Node.js is required for dmux UI but not installed.
    Install it first: https://nodejs.org"
  fi

  if ! command -v npm >/dev/null 2>&1; then
    error "npm is required for dmux UI but not installed."
  fi

  mkdir -p "$UI_DIR"

  local script_dir
  script_dir="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

  if [[ -d "$script_dir/dmux-ui" ]]; then
    # Local install from cloned repo
    cp -r "$script_dir/dmux-ui/package.json" "$UI_DIR/"
    cp -r "$script_dir/dmux-ui/vite.config.js" "$UI_DIR/"
    cp -r "$script_dir/dmux-ui/index.html" "$UI_DIR/"
    cp -r "$script_dir/dmux-ui/server" "$UI_DIR/"
    cp -r "$script_dir/dmux-ui/src" "$UI_DIR/"
  else
    info "Downloading UI from $REPO_URL..."
    local tmpdir
    tmpdir=$(mktemp -d)
    git clone --depth 1 "$REPO_URL" "$tmpdir" 2>/dev/null
    cp -r "$tmpdir/dmux-ui/"* "$UI_DIR/"
    rm -rf "$tmpdir"
  fi

  info "Installing UI dependencies..."
  (cd "$UI_DIR" && npm install --production=false 2>/dev/null) || {
    error "Failed to install UI dependencies"
  }

  info "Building UI..."
  (cd "$UI_DIR" && npx vite build 2>/dev/null) || {
    warn "UI build failed, dev mode will still work"
  }

  success "Installed dmux UI to $UI_DIR"
  echo "    Run 'dmux ui' to start the web interface"
}

check_path() {
  if [[ ":$PATH:" != *":$INSTALL_DIR:"* ]]; then
    warn "$INSTALL_DIR is not in your PATH"
    echo ""
    echo "Add it to your shell config:"
    echo ""

    if [[ -f "$HOME/.zshrc" ]]; then
      echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.zshrc"
      echo "  source ~/.zshrc"
    elif [[ -f "$HOME/.bashrc" ]]; then
      echo "  echo 'export PATH=\"\$HOME/.local/bin:\$PATH\"' >> ~/.bashrc"
      echo "  source ~/.bashrc"
    else
      echo "  export PATH=\"\$HOME/.local/bin:\$PATH\""
    fi
    echo ""
  fi
}

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------

main() {
  # Parse flags
  for arg in "$@"; do
    case "$arg" in
      --with-ui) INSTALL_UI=true ;;
    esac
  done

  echo ""
  echo "  dmux installer"
  echo "  =============="
  echo ""

  check_dependencies
  install_script
  setup_config
  install_ui
  check_path

  echo ""
  success "Installation complete!"
  echo ""
  echo "  Get started:"
  echo "    dmux -a myproject ~/code/myproject   # Add a project"
  echo "    dmux -p myproject                    # Launch it"
  echo "    dmux -p myproject -n 2 -c 1          # 2 panes, claude in 1"
  echo "    dmux agents start                    # Multi-agent orchestration"
  echo ""
  echo "  Config: $CONFIG_DIR/projects"
  echo "  Help:   dmux -h"
  echo "  Agents: dmux agents help"
  echo ""
}

main "$@"
