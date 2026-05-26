# dmux notifications

dmux fires desktop notifications when things happen in the background that you'd want to know about while your attention is elsewhere. On macOS that's `osascript`-driven Notification Center pops; on Linux it's `notify-send`. Other platforms silently no-op.

## Event types

| Event | Fires when |
|---|---|
| `proposal_ready` | A proposal is staged by the NL planner, `dmux adopt`, the PRD ingestion flow, or a chat-driven regenerate. |
| `run_completed` | All agents in a run have finished (success or failure). One notification per run. |
| `run_failed` | An individual agent in a run exits non-zero or is blocked because a dependency failed. |
| `agent_succeeded` | An individual agent in a run exits zero. |
| `scope_violation` | A running agent's scope-violation count transitions upward (an agent wrote outside its declared scope). |
| `agent_blocked_on_permission` | Wired but not yet triggered automatically — reserved for the upcoming permission-prompt detection work. |

## Configuring preferences

Notifications default to **on** for every event. To silence one (or all of them), create or edit:

```
~/.config/dmux/notifications.json
```

Shape:

```json
{
  "enabled": true,
  "events": {
    "proposal_ready": true,
    "run_completed": true,
    "run_failed": true,
    "agent_succeeded": false,
    "scope_violation": true,
    "agent_blocked_on_permission": true
  }
}
```

Rules:

- **Missing file** — every event fires.
- **Malformed JSON or unreadable file** — every event fires (fail open; we'd rather over-notify than swallow events because of a config typo).
- **`enabled: false`** at the top level — global kill switch; nothing fires regardless of `events`.
- **Per-event key missing** — that event defaults to on.
- **Per-event key set to `false`** — that event is silenced.

Changes take effect immediately on the next event fire — no restart needed; the file is read every time a notification would be dispatched.

## A common config

If you're juggling many agents and the per-agent success notifications get noisy, this is a good starting point:

```json
{
  "enabled": true,
  "events": {
    "agent_succeeded": false
  }
}
```

That keeps the "your run is done" and "your run failed" pops but stops the per-agent success spam during long multi-agent runs.

## What's NOT in v1

These are deferred:

- A `dmux notify set <event> on|off` command — edit the JSON for now.
- Per-project preferences (only global preferences for now).
- Webhook channels (Slack, Telegram, etc.) — solo-first scope.
- Click-to-deep-link from a notification — needs a real app bundle on macOS.
- Notification rate limiting / coalescing — if 5 agents fail in a row you'll get 5 pops. Live with it.

See `docs/design/wave-3a.md` for the rationale on each.
