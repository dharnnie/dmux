# dmux

A CLI tool that launches multi-pane tmux dev environments and orchestrates multiple Claude Code agents across git worktrees.

## Product Pipeline

### Phase 1: Local CLI (current)
Pure bash CLI. Solo developers manage projects and spin up parallel agents from the terminal.

### Phase 2: Local Web UI (`dmux ui`)
A local web app (Node/Express + React) served on localhost. Provides a visual form-based alternative to writing YAML and running CLI commands. Stateless — reads project config from `~/.config/dmux/projects` and `.dmux-agents.yml` files. Installed optionally via `--with-ui` flag during install.

### Phase 3: Self-hosted (needs brainstorming)
Teams run their own dmux server. Shared project configs, branch coordination, team visibility into agent sessions.

### Phase 4: SaaS
Hosted control plane with accounts, team management, and cloud-managed agent orchestration.

## Architecture Notes

- `dmux.sh` is the single-file CLI (~2000 lines of bash)
- `install.sh` handles installation to `~/.local/bin/dmux`
- Projects stored in `~/.config/dmux/projects` (name=path format)
- Agent configs are per-project `.dmux-agents.yml` files
- The UI (Phase 2) should be a thin layer that calls dmux commands via shell exec — dmux CLI remains the source of truth
