# dmux — Wave 4A Design Pass

Status: drafting before implementation. Pair-mode review welcome.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-4.md`. First sub-wave of Wave 4 — focus on cross-project visibility.

---

## Where Wave 3 left us

After Wave 3F, dmux is a Maestro-shaped surface end-to-end. The user can juggle multiple projects, propose teams via NL/PRD/chat, run them with MCP-enabled agents, see plan/review handoffs after the fact.

What's missing in the "juggling multiple projects" loop the user named as foundational:

- **You can't see what dmux is doing across all projects without clicking into each one.** Dashboard lists in-flight runs but you don't see *what* the agents are doing — what stage they're at, what they just produced, what they just failed on. To check on agent-X you open project-A → Run Detail → Agent Detail.
- **Within one run, there's no chronological story.** The agents table shows current status; handoff artifacts surface plan + review; scope violations get a banner. But "what happened in this run, in order" requires reading the tmux scrollback.
- **Notifications fire-and-forget but leave no trail.** If you missed the pop, the event is gone.

Wave 4A introduces a **timeline** as the canonical event log for a run, plus a **god-view** that mosaics active agent state across all projects on a single page. The timeline is the underlying data structure both surfaces share; the god-view is a cross-project read over it.

Tracking what tools each MCP-enabled agent calls in real time (which would round out the "what is the agent actually doing" picture) is **explicitly deferred to Wave 4A.next** — that requires intercepting agent stdout or reading Claude Code's logs and is a larger ask. v1 covers the events dmux already has hooks for.

---

## Section 1 — Concepts introduced in Wave 4A

Three small concepts.

### 1.1 The timeline event log

A new JSON Lines file at `<runDir>/timeline.jsonl`. Each line is a single event:

```json
{ "ts": "2026-06-02T18:14:22.103Z", "type": "agent_started",  "agent": "planner",      "summary": "Agent planner started",       "data": {} }
{ "ts": "2026-06-02T18:14:48.890Z", "type": "plan_written",   "agent": "planner",      "summary": "Plan written: 3 tasks",       "data": { "tasks": 3 } }
{ "ts": "2026-06-02T18:14:49.001Z", "type": "agent_finished", "agent": "planner",      "summary": "Agent planner finished",      "data": { "exitCode": 0 } }
{ "ts": "2026-06-02T18:14:50.412Z", "type": "agent_started",  "agent": "auth-builder", "summary": "Agent auth-builder started",  "data": {} }
{ "ts": "2026-06-02T18:16:30.220Z", "type": "scope_violation","agent": "auth-builder", "summary": "Wrote outside scope (2 files)","data": { "count": 2 } }
{ "ts": "2026-06-02T18:18:11.557Z", "type": "agent_failed",   "agent": "auth-builder", "summary": "Agent failed (exit 1)",       "data": { "exitCode": 1 } }
{ "ts": "2026-06-02T18:18:11.700Z", "type": "run_completed",  "agent": null,           "summary": "Run completed: 1/2 succeeded","data": { "ok": 1, "failed": 1 } }
```

Append-only. Bad lines tolerated (skipped + counted) per permissive parsing principle.

**v1 event types (per the four sources dmux already has hooks for):**

| Type | Source | Trigger |
|---|---|---|
| `run_started` | bash agents_start | After worktrees + signal dir created |
| `agent_started` | bash per-agent launch | tmux send-keys for the agent's pane fires |
| `plan_written` | server-side watcher OR bash post-step | When `handoffs/plan.md` appears |
| `review_written` | server-side watcher OR bash post-step | When `handoffs/review.md` appears |
| `agent_succeeded` | bash `_notify agent_succeeded` | Existing notification |
| `agent_failed` | bash `_notify run_failed` | Existing notification (per-agent) |
| `agent_blocked` | bash dependency-cascade-fail | Existing notification |
| `scope_violation` | server-side, in `readRunViolationsSummaryWithNotify` | When count transitions 0→non-zero |
| `proposal_ready` | server-side, in runPlanner / runAdoption | Existing notification — also logged to the run that holds the proposal |
| `run_completed` | bash `_notify run_completed` | Existing notification (summary) |

Most events piggyback on the existing `dmux _notify` flow — we just teach the bash side to ALSO append to `timeline.jsonl` when firing a notification. New responsibilities (plan_written, review_written) need new write points but are small.

### 1.2 The god-view

A new top-level page at `/activity` (linked from the Navbar between "Dashboard" and "Projects"). Renders a mosaic of currently-active agents across all projects:

```
┌─ Activity ─────────────────────────────────────────────────────────────┐
│  3 active runs · 7 agents working · last event 4s ago                  │
│                                                                         │
│  ┌── linkroller / auth-builder ─────┐  ┌── md-parser / renderer ─┐    │
│  │ ● running                         │  │ ◌ waiting on planner    │    │
│  │ feat/auth-implementation          │  │ feat/renderer-tests     │    │
│  │ Last: scope violation detected    │  │ Last: agent started     │    │
│  │       2 files outside scope       │  │       1m ago            │    │
│  │       18s ago                     │  └──────────────────────────┘    │
│  └───────────────────────────────────┘                                  │
│                                                                         │
│  ┌── todo-api / reviewer ───────────┐  ...                              │
│  │ ✓ completed (review_changes)      │                                  │
│  │ review/auth-security              │                                  │
│  │ Last: review written              │                                  │
│  │       2 findings, 1 critical      │                                  │
│  │       12s ago                     │                                  │
│  └───────────────────────────────────┘                                  │
└────────────────────────────────────────────────────────────────────────┘
```

Each card:
- Project name / agent name in the header
- Status indicator (● running, ◌ waiting, ✓ completed, ✗ failed)
- Branch
- Most recent event from this agent's timeline + how long ago
- Hot link to the agent's Agent Detail page

Polling: 3-second interval, same shape as the Dashboard's existing in-flight run polling.

Empty state when no active agents: surface the 5 most-recently-completed-or-failed agents with timestamps. Keeps the page useful when nothing's in flight.

### 1.3 Per-run timeline panel

On Run Detail, a new "Timeline" disclosure between the Agents table and the Handoffs card. Renders the run's timeline.jsonl as a vertical event log with:
- Timestamp (relative + absolute on hover)
- Event-type chip with tone (running=cyan, succeeded=green, failed=red, blocked/violation=orange)
- Agent name (when scoped to one)
- Summary line

Auto-refreshes every 3s while the run is in `running` status; stops once it terminates.

---

## Section 2 — End-to-end flow

### 2.1 A run with the timeline (Wave 4A)

```
User approves a proposal
  ↓
bash agents_start writes timeline.jsonl: {"type":"run_started", ...}
  ↓ creates worktrees + spawns agents
  ↓
Each agent's launch wrapper appends {"type":"agent_started","agent":"X"}
  ↓
Planner finishes, writes handoffs/plan.md
  ↓ a small filesystem watcher (or post-step bash hook) appends {"type":"plan_written"}
  ↓
Per-agent exit handler appends {"type":"agent_succeeded" | "agent_failed"}
  ↓
Reviewer finishes, writes handoffs/review.md → {"type":"review_written"}
  ↓
Summary handler appends {"type":"run_completed","data":{"ok":N,"failed":M}}
```

The UI reads timeline.jsonl on Run Detail mount + polls every 3s while running. The god-view reads timelines across ALL active runs + polls every 3s.

### 2.2 God-view request flow

1. UI mounts `/activity`.
2. UI fetches `GET /api/activity` — server returns an aggregated view: for each active run across all projects, the latest event + agent statuses.
3. UI renders the mosaic.
4. UI polls every 3s.

The server endpoint walks `parseProjectsFile()` → for each project, lists active runs → for each, reads the last N lines of timeline.jsonl + the run.json. Cheap enough at the user's scale (32 projects × ~1 active run × ~50 timeline lines = bounded).

---

## Section 3 — Implementation surface

### 3.1 dmux-core additions

- New module `dmux-core/src/timeline.js`.
- `parseTimelineEvent(jsonLine)` — strict JSON parse + light shape validation: `ts`, `type`, `summary` required strings; `agent` optional string; `data` optional object. Returns `{event} | {error}`.
- `readTimeline(jsonlText)` — splits by line, parses each, returns `{ events, malformedCount }`. Permissive — bad lines counted + dropped.
- `TIMELINE_EVENT_TYPES` const — frozen set of known types so the UI can render unknown types as `(unknown event)` with a fallback chip.
- 6–8 tests.

### 3.2 Server additions

In `dmux-ui/server/lib/timeline.js` (new):

- `readRunTimeline(projectPath, runId)` — reads `<runDir>/timeline.jsonl` if it exists, returns `{ events, malformedCount }` via dmux-core's `readTimeline`.
- `appendTimelineEvent(projectPath, runId, event)` — appends a single JSON line (atomic per line — append-only file). Used by:
  - The proposal-ready notification path (logs to the proposal's run dir).
  - The scope-violation transition detector in `readRunViolationsSummaryWithNotify`.
  - Server-side handoff-write detection (a small filesystem watcher; see §3.4).
- `getActivitySummary()` — for the god-view. Walks projects, finds active runs (status in {running, pending}), reads the last N timeline events + the run.json agent states. Returns the aggregate.

New endpoints:
- `GET /api/projects/:name/runs/:runId/timeline` — returns the parsed timeline.
- `GET /api/activity` — the god-view aggregate.

### 3.3 Bash additions

In `dmux.sh`:

- New helper `_log_timeline_event` (internal subcommand `dmux _log <run-dir> <type> <agent> <summary> [data-json]`). Builds a JSON event and appends to `<run-dir>/timeline.jsonl`. Same fail-open posture as `_notify`.
- `agents_start` calls `_log_timeline_event run_started ...` after creating worktrees + signal dir.
- Each agent's wait_cmd / send-keys command is extended to fire `_log_timeline_event agent_started ...` before the agent_cmd, and `_log_timeline_event agent_succeeded/failed ...` after the exit code is captured.
- The existing `_notify` calls are PAIRED with `_log_timeline_event` calls — both fire the OS notification and write to the timeline. The simplest implementation: `_notify` itself optionally takes a run-dir + type and writes the timeline event when present.

Actually a cleaner shape: `send_notification` doesn't change; the agents_start launch wrappers fire BOTH `_notify` AND `_log_timeline_event` independently. Keeps the bash side composable.

### 3.4 Handoff-write detection

For `plan_written` and `review_written` events, the cleanest hook is server-side: a small per-run watcher that polls `<runDir>/handoffs/{plan,review}.md`'s mtime on a short interval (1s) and emits the event the first time the file appears. Lives in `dmux-ui/server/lib/handoff-watcher.js` (new).

Alternative: have the bash launch script `inotifywait` / `fswatch` on the dir. macOS lacks inotify; fswatch is an extra dep. Server-side polling is simpler and good enough.

The watcher starts when `agents_start` runs and stops when the run reaches a terminal state. State lives in an in-memory `Map<runId, watcherHandle>` on the server, recreated on server restart (no persistence — terminal runs aren't watched).

### 3.5 UI additions

- `dmux-ui/src/components/TimelinePanel.jsx` — renders one run's timeline. Disclosure on Run Detail, between Agents and Handoffs.
- `dmux-ui/src/components/TimelineEventRow.jsx` — one row with event-type chip + agent + summary + timestamp.
- `dmux-ui/src/pages/Activity.jsx` — the god-view page.
- `dmux-ui/src/hooks/useActivity.js` — fetches `/api/activity`, polls every 3s.
- `dmux-ui/src/hooks/useRunTimeline.js` — fetches one run's timeline, polls every 3s while running.
- Navbar: new "Activity" link between Dashboard and Projects.
- Route `/activity` → `<Activity />`.

### 3.6 Per-project recent activity

**v1 punts on this.** Project Detail already shows runs with their statuses; the run-level timeline is one click away. Adding a "Recent activity" card on Project Detail would be a third surface for the same data. Revisit if the lack is felt during use.

### 3.7 CLI

**None.** The timeline is a UI surface. A future `dmux activity` command could mirror the god-view in the terminal but the immediate value is the visual mosaic.

---

## Section 4 — Wireframes

### 4.1 Timeline panel on Run Detail

```
┌─ Timeline ────────────────────────────────────────────────────  [Show ▾] │
│                                                                          │
│  18:14:22  ● run started                                                 │
│  18:14:22  ● agent started · planner                                     │
│  18:14:48  ✓ plan written · planner · 3 tasks                            │
│  18:14:49  ✓ agent succeeded · planner                                   │
│  18:14:50  ● agent started · auth-builder                                │
│  18:16:30  ⚠ scope violation · auth-builder · 2 files outside scope      │
│  18:18:11  ✗ agent failed · auth-builder · exit 1                        │
│  18:18:11  ● run completed · 1/2 succeeded                               │
│                                                                          │
└──────────────────────────────────────────────────────────────────────────┘
```

Times in absolute HH:MM:SS for v1; tooltip shows full timestamp. Auto-refreshes while running.

### 4.2 Activity (god-view) page

See §1.2.

---

## Section 5 — Decisions to confirm before implementation

These are the load-bearing choices.

1. **Timeline lives at `<runDir>/timeline.jsonl` as JSON Lines.** Append-only, line-per-event, machine-readable. Matches the existing `<runDir>/...` artifact pattern. Recommended: confirm.

2. **Events piggyback on existing `_notify` and signal-file hooks.** No parallel event bus. New responsibilities (plan_written, review_written) get a small server-side filesystem watcher. Recommended: confirm — keeps the per-event-source story honest.

3. **Permissive parsing — malformed lines counted, not fatal.** Same posture as Wave 3E handoff artifacts. Recommended: confirm.

4. **God-view at `/activity` with 3-second polling.** No SSE. Consistent with Wave 3B chat (also polling) and Wave 2C adopt-progress. Recommended: confirm.

5. **God-view cards show last event + status + branch + hot link to agent detail.** No live terminal preview in v1. Terminal previews are Wave 4A.next or beyond. Recommended: confirm.

6. **MCP tool-call events deferred to Wave 4A.next.** Hooking those requires intercepting agent stdout or reading Claude Code's logs. Not in v1. Recommended: confirm.

7. **No per-project recent-activity card in v1.** Project Detail already shows runs; per-run timeline is one click away. Adding a third surface is premature. Recommended: confirm.

8. **No CLI surface for the timeline / god-view in v1.** The visual mosaic is the immediate value. Recommended: confirm.

9. **Server-side handoff-write watcher polls every 1s.** Cross-platform via fs.statSync polling, no fswatch / inotify dep. Watcher started by `agents_start` (or the server discovers active runs on startup and watches them). State lives in-memory; terminal runs aren't watched. Recommended: confirm.

10. **Two slices, one PR.** Slice 1: timeline infrastructure (writers + reader + per-run UI). Slice 2: god-view + Activity route. Recommended: confirm.

---

## Section 6 — Open questions (defer to implementation if not blocking)

1. **Event-type set is open or closed?** I lean OPEN — agents could conceivably write their own events (e.g. "implementation milestone X reached"). For v1, the UI renders unknown types with a generic chip. dmux-core's `TIMELINE_EVENT_TYPES` const is informational, not enforced.

2. **Where does the bash `_log_timeline_event` get the run-dir from?** `agents_start` already has `$abs_root` + `$run_id`. Pass `<run-dir>` as the first arg to `_log` and let callers compute it. Pin in Slice 1.

3. **How does the god-view handle 50+ projects?** v1 doesn't worry — most users have <20 projects and <5 active. Pagination or filtering is a Wave 4A.next problem.

4. **What about events from FAILED runs?** They're in the timeline file; god-view's "active runs" filter excludes them by default but the recently-completed empty-state pulls them in.

5. **The handoff watcher's startup story.** When the server restarts mid-run, watchers are gone. Options: (a) reconstruct on startup by scanning `.dmux/runs/*/run.json` for active states (b) accept the gap — events from before the restart are missed, downstream ones aren't. v1 picks (b) for simplicity; (a) is a hardening follow-up.

6. **Do scope-violation events overwrite each other?** `readRunViolationsSummaryWithNotify` fires on transitions; if count goes 0→2→3, we get TWO events ("2 files" then "3 files"). Probably correct behavior. Pin in implementation.

7. **Per-event payload size.** A `proposal_ready` event might want to include the proposal id; a `plan_written` event the task count. Keep `data: {}` flexible per type rather than a fixed schema. Document each type's expected `data` keys in `docs/timeline.md`.

---

## Section 7 — What's explicitly NOT in Wave 4A

Reserved for later or never:

- **MCP tool-call events** — requires intercepting agent stdout. Wave 4A.next.
- **Live terminal previews in god-view cards** — the small mosaic showing what the agent is typing right now. Wave 4A.next.
- **Cross-run event correlation** ("this run was triggered by that run") — Wave 5 if ever.
- **Event search / filter / export** — read-only UI panel in v1.
- **Event retention policy** — events live with the run; the existing cleanup machinery wipes them with the rest of the run dir.
- **Long-term analytics** — "how often do reviews block? what's the average run duration?" Future product feature, not 4A.
- **Per-project recent-activity card** — see §5.7.
- **CLI surface** — see §5.8.
- **Mobile / responsive god-view** — solo-first desktop.

Anything pulled forward needs explicit justification.

---

## Implementation order (after this doc is approved)

Two slices, one PR:

**Slice 1 — Timeline infrastructure + per-run panel.** ~1.5 days.
- `dmux-core/src/timeline.js` + tests (parser, malformed handling).
- `dmux-ui/server/lib/timeline.js` with `readRunTimeline`, `appendTimelineEvent`.
- `dmux.sh`: `_log` internal subcommand + agent-launch wrappers paired with notify calls + `run_started` / `run_completed` hooks.
- Server-side filesystem watcher for plan.md / review.md writes (`dmux-ui/server/lib/handoff-watcher.js`).
- `GET /api/projects/:name/runs/:runId/timeline` endpoint.
- `useRunTimeline` hook.
- `TimelinePanel` + `TimelineEventRow` components, mounted on Run Detail.
- `docs/timeline.md` contract doc (event types + data schemas).
- Verify end-to-end by running a small fixture team and watching events accumulate.

**Slice 2 — God-view.** ~1 day.
- `getActivitySummary()` server fn aggregating across projects.
- `GET /api/activity` endpoint.
- `useActivity` hook.
- `Activity.jsx` page with the mosaic layout.
- Navbar "Activity" link + `/activity` route.
- Empty state (no active agents) shows recently-completed ones.

Total ~2.5 days. Wave 4A v1 is done when a real multi-agent run produces a readable timeline + the god-view renders correctly with at least one active agent in flight.

---

*Ready for review. Push back on anything in Section 5 (decisions) before implementation begins. The biggest scope call is §5.6 — deferring MCP tool-call events — which keeps the wave shippable in 2.5 days. The biggest open question is §6.5 (handoff watcher restart story); v1 lives with the gap.*
