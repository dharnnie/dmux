# Build Log: dmux multi-agent orchestration

This log documents the iterative design and implementation process of adding agent coordination features to dmux — built entirely through conversation with Claude Code.

---

## Session 1: scope, context, and role

**Goal:** Add three optional per-agent fields to reduce merge conflicts and enable a review agent pattern.

### What we built

- `scope` — list of paths an agent is allowed to modify (appended to its claude prompt)
- `context` — list of paths an agent may read but not modify (appended to its prompt)
- `role` — `build` (default) or `review`; review agents skip worktree creation and run at project root

### Implementation

All changes in a single pass across three files:

1. **dmux.sh** — Extended the YAML parser to handle `scope:`, `context:`, and `role:` fields using the same list-item pattern. Added `build_agent_prompt()` to construct enriched prompts. Updated `create_worktrees()`, `remove_worktrees()`, `agents_start()`, and `agents_status()` to handle the review role (skip worktree, use project root as cwd, show ROLE column in status).

2. **README.md** — Added config reference rows, a "Review Agent" section, and updated the walkthrough example.

3. **dmux-agents.example.yml** — Added commented scope/context/role examples.

### Design decision: review agent in same config

We chose to keep the review agent in the same `.dmux-agents.yml` as the build agents rather than a separate file. This keeps the full orchestration visible in one place.

### Problem discovered

After implementation, we realized the review agent launches simultaneously with build agents — meaning it has nothing to review. The reviewer gets `claude "review the changes..."` at the same time the build agents start writing code. This led to Session 2.

---

## Session 2: depends_on with PID polling (designed, rejected)

**Goal:** Let agents wait for other agents to finish before starting.

### Initial design

Add `depends_on` list per agent. Instead of `claude "task"`, send a shell script to the tmux pane that:
1. Polls dependency panes' PIDs every 10 seconds
2. Checks if `claude` is still running via `ps -o comm= -g $pid | grep claude`
3. Launches `claude` once all deps show no claude process

### Why we rejected it

After critical analysis, we identified several problems:

1. **"Done" signal is unreliable** — `claude` exiting doesn't mean the task succeeded. Could be a crash, Ctrl-C, or partial work.
2. **No commit guarantee** — the reviewer runs `git diff` but the build agent may not have committed yet.
3. **One-liner fragility** — sending a compound bash script through `tmux send-keys` with proper quote escaping is brittle.
4. **Status heuristic breaks down** — "idle + has depends_on = waiting" is wrong after the review finishes.
5. **No partial readiness** — all-or-nothing wait, can't start reviewing auth while catalog is still building.

---

## Session 3: Marker files + init command + pre-launch summary (current plan)

**Goal:** Replace PID polling with explicit marker files, add config scaffolding, add launch confirmation.

### Key insight

The user proposed marker files as the coordination mechanism. This solved the core reliability problem: instead of inferring state from process trees, agents write an explicit signal file when they exit.

### Design

**Marker files:**
- `agents start` creates `.dmux/signals/` in project root
- Build agents run: `claude "task"; echo $? > .dmux/signals/auth.done`
- Dependent agents poll for marker files: `[ -f .dmux/signals/auth.done ]`
- Marker contains exit code — enables future "skip review if build failed" logic
- Manually overridable: `touch .dmux/signals/auth.done` to unblock

**`dmux agents init`:**
- Interactive scaffolding that generates `.dmux-agents.yml`
- Prompts for session name, agents, roles, dependencies
- Lowers the barrier to writing the config by hand

**Pre-launch summary:**
- Before creating worktrees, print a table showing all agents, roles, and dependencies
- Prompt for confirmation (skippable with `--yes`)
- Catches config mistakes before any side effects

### Why marker files over PID polling

| | PID polling | Marker files |
|---|---|---|
| Signal source | Process tree heuristic | Explicit file write |
| Metadata | None | Exit code |
| Persistence | Ephemeral (process must be running) | Survives indefinitely |
| Debugging | `ps` output | `ls .dmux/signals/` |
| Manual override | Kill process and hope | `touch file.done` |
| Cross-session | No | Yes (files persist across restarts) |

### Remaining known limitation

Marker files still mean "claude exited" not "task complete." This is acceptable because:
- Exit code 0 indicates normal exit (user or claude chose to stop)
- The reviewer's job is to review whatever state the code is in
- Manual override (`touch`) provides an escape hatch

---

## Session 4: Implementing the Session 3 plan (lost session)

**Goal:** Implement all planned features from Session 3 — `depends_on`, marker files, `agents init`, pre-launch summary, and `--yes` flag.

*Note: This session was lost abruptly before the build log could be updated. The implementation was reconstructed from the code.*

### What we built

- **`depends_on` parsing** — YAML parser extended to handle `depends_on:` lists (both inline comma-separated and multi-line). Includes validation: agents cannot depend on themselves, and all referenced dependencies must exist in the config.

- **Marker file signals** — `setup_signal_dir()` creates `.dmux/signals/` at launch and clears old signals. Independent agents run `claude "task"; echo $? > .dmux/signals/<name>.done`. Dependent agents poll for their dependencies' `.done` files before launching claude. `agents_status()` reads marker files to show completion state.

- **`agents init` scaffolding** — Interactive command that prompts for session name, worktree base, main pane toggle, and per-agent details (name, role, branch, task, dependencies). Generates and writes `.dmux-agents.yml`.

- **Pre-launch summary** — `print_launch_summary()` displays a table of all agents with their branch, role, and dependencies before creating any worktrees. Shows worktree and review agent counts.

- **`--yes` flag** — `-y|--yes` option on `agents start` skips the confirmation prompt.

- **README + example updates** — Documentation and `dmux-agents.example.yml` updated to cover all new features.

---

## Session 5: Failure-aware agent dependencies

**Goal:** When a dependency fails, dependent agents should detect it, skip launching, and report the failure clearly.

### Problem

Dependent agents blindly launched after their dependencies finished, regardless of whether the dependency exited successfully or with an error. `agents status` showed raw exit codes (`done (exit 1)`) with no semantic distinction between success, failure, and blocked agents.

### What we built

- **Exit code checking before launch** — After the dependency wait loop finishes, the dependent agent now reads each dependency's `.done` file and checks for non-zero exit codes. If any dependency failed, the agent writes `99` to its own `.done` file and skips launching claude entirely.

- **Sentinel exit code 99** — Used as a "blocked by failed dependency" marker, distinguishable from claude's own exit codes. This propagates through dependency chains: if A fails, B gets blocked (99), and C which depends on B also gets blocked (99).

- **Improved `agents status` display** — Status now shows semantic labels:
  - Exit 0 → `done`
  - Exit 99 → `blocked` (dependency failed)
  - Any other non-zero → `failed (exit N)`

### Design decision: sentinel code vs. separate file

We chose a sentinel exit code (99) over a separate `.failed` marker file because it keeps the coordination mechanism simple — one file per agent, one value to check. The exit code is already being written; we just interpret it more carefully.

---

## Implementation status

| Feature | Status |
|---------|--------|
| scope/context/role fields | Done |
| YAML parser extensions | Done |
| Review agent (no worktree) | Done |
| Status table with ROLE column | Done |
| `depends_on` parsing | Done |
| Marker file signals | Done |
| `agents init` scaffolding | Done |
| Pre-launch summary + confirmation | Done |
| `--yes` flag | Done |
| README + example updates | Done |
| Failure-aware dependencies | Done |
