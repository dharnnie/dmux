# dmux run timeline

Every run dmux launches gets a chronological event log at
`<projectPath>/.dmux/runs/<runId>/timeline.jsonl`. The Run Detail page
surfaces it as a "Timeline" card; the upcoming god-view (Wave 4A Slice 2)
will mosaic the latest event from each active run across all projects.

## File format

JSON Lines — one event per line, append-only. Each event:

```json
{
  "ts": "2026-06-02T18:14:22.103Z",
  "type": "agent_started",
  "agent": "planner",
  "summary": "Agent planner started",
  "data": {}
}
```

Fields:

| Field | Required | Notes |
|---|---|---|
| `ts` | yes | ISO 8601 UTC timestamp string |
| `type` | yes | event type slug (see table below) |
| `summary` | yes | one-line human-readable description |
| `agent` | no | string or null; the agent the event scopes to |
| `data` | no | object; type-specific structured payload |

The reader is **permissive**: malformed lines are counted and skipped, never fatal. The UI's footer shows `⚠ N malformed events skipped` when the count is non-zero.

## Event types (v1)

| Type | Emitter | When | Typical `data` |
|---|---|---|---|
| `run_started` | `dmux.sh` agents_start | After worktrees + signal dir created | `{ agentCount: N }` |
| `agent_started` | per-agent launch wrapper | Just before the agent's CLI invocation | `{}` |
| `plan_written` | server handoff watcher | When `handoffs/plan.md` first appears | `{ tasks: N }` |
| `review_written` | server handoff watcher | When `handoffs/review.md` first appears | `{ verdict, findingCount }` |
| `agent_succeeded` | per-agent exit handler | exit code 0 | `{ exitCode: 0 }` |
| `agent_failed` | per-agent exit handler | non-zero exit | `{ exitCode: N }` |
| `agent_blocked` | dependency-cascade-fail handler | When a dependency failed and this agent skipped | `{}` |
| `scope_violation` | server's `readRunViolationsSummaryWithNotify` | When an agent's count transitions 0→non-zero (or grows) | `{ count, previousCount }` |
| `proposal_ready` | server-side proposal-creation paths (planner / adoption / regenerate) | After `createProposal` succeeds | `{ source, agentCount, recommendedSkillsCount? }` |
| `run_completed` | bash `_notify-summary` | When all agents have signaled done | `{ ok, failed }` |

The type set is **open**, not closed. Agents could in principle write their own events (`my_agent` writes a milestone event via `dmux _log <run-dir> milestone <name> "summary"`). The UI renders unknown types with a generic chip.

## Writers

Three paths write events:

1. **`dmux.sh`** via the internal `dmux _log <run-dir> <type> <agent> <summary> [data-json]` subcommand. Used for `run_started`, `agent_started`, `agent_succeeded`, `agent_failed`, `agent_blocked`, `run_completed`.
2. **`dmux-ui/server/lib/dmux.js`** via `appendTimelineEvent(projectPath, runId, event)`. Used for `proposal_ready` (in the planner / adoption / regenerate paths) and `scope_violation` (in the violations endpoint).
3. **`dmux-ui/server/lib/handoff-watcher.js`** — a 1s polling loop that watches `<runDir>/handoffs/{plan,review}.md`. When a file newly appears, emits `plan_written` / `review_written` once per run lifetime.

All three writers go through `appendFileSync` (one JSONL line per call, well under `PIPE_BUF` so concurrent appenders from multiple agents don't tear).

All three are **fire-and-forget**: a timeline write that fails for any reason (missing dir, broken JSON, disk full) does NOT break the calling path. Timeline events are an observability surface; their failure mode is "we miss an event," never "we break a run."

## Cleanup

Timeline files live with the run. The existing `dmux agents cleanup` flow removes the entire run directory; timeline.jsonl goes with it. No separate retention policy; no manual cleanup needed.

## What's NOT in v1 (per `wave-4a.md` §7)

- **MCP tool-call events.** Would require intercepting agent stdout. Wave 4A.next.
- **Live terminal previews on god-view cards.** Mosaic cards in Slice 2 show last event + status only; no scrollback streaming.
- **Cross-run event correlation.** Each run's timeline is self-contained.
- **Event search / filter / export.** Read-only UI panel in v1.
- **Long-term analytics.** "Average run duration," "review block rate" etc. are product features, not 4A.

If you want to add an event type, just emit it — dmux-core's `TIMELINE_EVENT_TYPES` constant is informational, not enforced. The UI renders unknown types with a generic chip.
