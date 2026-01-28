#!/bin/bash

# ==============================================================================
# dmux uninstaller
# ==============================================================================
#
# Uninstall:
#   curl -fsSL https://raw.githubusercontent.com/dharnnie/dmux/main/uninstall.sh | bash
#
# Or clone and run:
#   git clone https://github.com/dharnnie/dmux.git
#   cd dmux && ./uninstall.sh
#
# ==============================================================================

set -euo pipefail

INSTALL_DIR="${HOME}/.local/bin"
CONFIG_DIR="${XDG_CONFIG_HOME:-$HOME/.config}/dmux"

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
# Uninstall
# ------------------------------------------------------------------------------

remove_script() {
  if [[ -f "$INSTALL_DIR/dmux" ]]; then
    info "Removing $INSTALL_DIR/dmux..."
    rm "$INSTALL_DIR/dmux"
    success "Removed: $INSTALL_DIR/dmux"
  else
    warn "dmux not found at $INSTALL_DIR/dmux (already removed?)"
  fi
}

remove_config() {
  if [[ -d "$CONFIG_DIR" ]]; then
    echo ""
    warn "Config directory found: $CONFIG_DIR"
    echo "    This contains your project configurations."
    echo ""
    read -p "Remove config directory? [y/N] " -n 1 -r
    echo ""
    if [[ $REPLY =~ ^[Yy]$ ]]; then
      info "Removing $CONFIG_DIR..."
      rm -rf "$CONFIG_DIR"
      success "Removed: $CONFIG_DIR"
    else
      info "Keeping config directory: $CONFIG_DIR"
    fi
  else
    info "No config directory found at $CONFIG_DIR"
  fi
}

# ------------------------------------------------------------------------------
# Main
# ------------------------------------------------------------------------------

main() {
  echo ""
  echo "  dmux uninstaller"
  echo "  ================"
  echo ""

  remove_script
  remove_config

  echo ""
  success "Uninstall complete!"
  echo ""
}

main "$@"
