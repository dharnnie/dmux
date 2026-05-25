# dmux — Wave 3A Design Pass

Status: drafting before implementation. Pair-mode review welcome.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-2d.md`. Parent: `wave-3.md` (outline of the six sub-waves; 3A is the first).

---

## Where Wave 2 left us

All of Wave 2 (B + C + D) is in main: parameterized skills, proposal lifecycle, NL planner, `dmux adopt`, Maestro-style onboarding (chat + recs + customize). The end-to-end flow works: a user can describe what they want and get to a running team.

What's still missing for **the user's stated daily workflow**:

> I am working on multiple projects... I go to claude desktop, discuss and brainstorm my ideas and then bring a markdown as a prd or as a feature... I need that workflow to be in a single place.

The brainstorm-to-action path exists but only via short NL prompts in the Smart sheet. Bringing a 2-page markdown spec from Claude Desktop today means pasting it into the Smart prompt — which works mechanically, but isn't designed for it. And once a run is in flight, the user juggling multiple projects has no way to know when it finishes, gets stuck on a permission prompt, or hits a scope violation — they have to keep checking the UI.

Wave 3A closes both gaps **narrowly**:

1. **PRD ingestion** — a first-class "From PRD" entry on the spawn sheet that accepts a markdown file (paste or drop), pipes it through the existing NL planner, and stores the original PRD as an artifact alongside the proposal for audit.
2. **Notifications** — extend the existing macOS / Linux `send_notification` machinery in dmux.sh to cover the four event types that matter when the user is away: proposal-ready, run-completed (already partly wired), scope-violation, agent-blocked-on-permission. Server-side events shell back to `dmux _notify` so the cross-platform logic stays in one place.
3. **Per-event notification preferences** — a small JSON config file with global + per-event toggles. Per-project preferences are deferred (see §8).

`dmux init` (greenfield), webhook channels (Slack/Telegram), tray apps, and mobile push are all out per `wave-3.md` §3A — 3B onward, or never.

---

## Section 1 — Concepts introduced in Wave 3A

Three small concepts.

### 1.1 PRD as planner input

A PRD is just a longer NL prompt. The planner endpoint (`POST /api/projects/:name/proposals`, shipped in Wave 2B PR 3) doesn't care about length — it already takes a free-form `prompt` body field. The new work is:

- **A different entry on the spawn sheet.** Today: Quick (skill) / Smart (NL textarea). 3A: a third option, "From PRD." Same Sheet primitive, same step machine; the difference is the input UX (drop / paste a markdown file, expandable textarea, file-name display).
- **PRD persistence.** Unlike a one-line Smart prompt, a 2-page PRD is worth keeping. We persist the PRD content at `.dmux/prds/<proposalId>.md` and link to it from the proposal review page so future readers (or the chat in 2D) can scroll the spec.
- **Trigger marker.** The proposal's `trigger` carries `{ type: 'nl', prompt }` from Wave 2B. For PRD-driven proposals we add `{ type: 'nl', prompt, source: 'prd', prdPath }` so the UI can render a "From PRD" badge instead of quoting a long prompt verbatim.

CLI parity: a new `dmux propose <project> --prd <file>` command for users who already have the markdown in a shell.

### 1.2 Notifications as fan-out

The existing `send_notification` function in `dmux.sh` is the single point of truth: macOS via osascript, Linux via notify-send, silent no-op elsewhere. Wave 3A doesn't change that — it expands what fires it.

New event sources:
- **Server: proposal ready** — `runPlanner`, `runAdoption`, and `regenerateProposalFromChat` all create or update proposals. Each fires a notification on success.
- **Server: scope violation detected** — the violations-summary endpoint already computes violation counts. When a previously-zero count goes non-zero, fire.
- **Bash: agent blocked on permission** — the existing `_notify` already covers agent-completion / agent-failure / agent-blocked-on-dep-failure. We add `_notify-permission` for "this agent is paused waiting for a Y/N." Detection is open (§7.1).

All four event sources shell back to `dmux _notify <title> <message>` rather than re-implementing osascript per language. That keeps the cross-platform dispatch in one place.

### 1.3 Per-event notification preferences

A small JSON file at `~/.config/dmux/notifications.json`:

```json
{
  "enabled": true,
  "events": {
    "proposal_ready": true,
    "run_completed": true,
    "run_failed": true,
    "scope_violation": true,
    "agent_blocked_on_permission": true
  }
}
```

`enabled: false` short-circuits everything. Otherwise per-event toggles win. Missing file = all defaults (everything on).

`dmux _notify <title> <message> <event-type>` looks up the preference for `event-type` before dispatching. If the event-type is unknown or the preference is missing, default-on.

Per-project preferences are explicitly deferred — they need a UX surface that isn't on the critical path yet (§8).

---

## Section 2 — End-to-end flow

### 2.1 PRD ingestion (UI)

1. User opens the Spawn sheet from the Dashboard (existing flow).
2. PathStep renders a third path card alongside Quick and Smart: **From PRD** (📄 glyph).
3. Clicking it advances to `'prd-input'` step (new). The step renders:
   - A project selector (Select).
   - A drop zone / large textarea for the markdown content.
   - A "Pick a file…" button that opens the native file picker (`<input type=file accept=".md,text/markdown">`).
   - A file-name display when one's been selected.
   - "Plan team →" button (primary).
4. Submit POSTs to the existing planner endpoint with the PRD content as `prompt`, plus a `source: 'prd'` flag in the body so the server knows to persist the PRD artifact.
5. On success, the proposal review page opens (existing flow).

### 2.2 PRD ingestion (CLI)

```
dmux propose <project> --prd /path/to/spec.md [--name <proposal-name>]
```

Reads the file, validates, POSTs to the existing planner endpoint with `source: 'prd'` and the file content. Polls for completion the same way `dmux adopt` does. Prints the proposal-review URL.

### 2.3 PRD-aware proposal review

On the proposal review page (`/projects/:name/runs/:proposalId`), when `trigger.source === 'prd'`:
- A new card above the "Your request" card: **From PRD** with the filename + a Disclosure that shows the rendered markdown (via existing `react-markdown`).
- The "Your request" card is hidden (the PRD card replaces it).

The chat tab (when adopt-driven) and the recommendations card (when adopt-driven) stay as they are for NL-from-PRD proposals — neither was tied to a specific trigger type.

### 2.4 Notifications

After the relevant state change, the originating code fires a notification. Server-side: `await notify(eventType, title, message)` (new helper in `dmux-ui/server/lib/dmux.js`) which shells `dmux _notify <title> <message> <eventType>`. Bash-side: existing `_notify` is extended with the event-type argument.

Event-to-message mapping:

| Event | Title | Message |
|---|---|---|
| `proposal_ready` | `dmux: Proposal ready` | `<proposal-name> in <project>` |
| `run_completed` | `dmux: Run completed` | `<N>/<M> agents succeeded on <project>` |
| `run_failed` | `dmux: Run failed` | `<agent-name> exited with code <N>` |
| `scope_violation` | `dmux: Scope violation` | `<agent-name> in <project> wrote outside its scope` |
| `agent_blocked_on_permission` | `dmux: Agent waiting` | `<agent-name> in <project> needs a permission Y/N` |

Click-to-deep-link is **out of scope** for v1 — notifications are read-only signals. The user manually opens the URL.

### 2.5 Preferences

Users edit `~/.config/dmux/notifications.json` directly in v1. No CLI / UI surface for it yet. The defaults file is created on first `dmux _notify` invocation if it doesn't exist.

A simple `dmux notify list` (and `dmux notify set <event> on|off`) command is **a stretch** — see §8.

---

## Section 3 — Implementation surface

### 3.1 dmux-core additions

Minimal — no schema changes.

- No new exports.
- The `trigger.source` and `trigger.prdPath` fields are opaque metadata on the trigger object; `createProposal` already stores triggers as-is.

### 3.2 Server additions

In `dmux-ui/server/lib/dmux.js`:

- **`writePrdArtifact(projectPath, proposalId, prdMarkdown)`** — writes `.dmux/prds/<proposalId>.md` (creates the dir if needed, same atomic-write pattern as chat storage from Wave 2D).
- **`readPrdArtifact(projectPath, proposalId)`** — returns the markdown string or null.
- **`runPlanner` extended** to accept an optional `{ source, prdMarkdown }` param. When `source === 'prd'`, the function:
  - Calls the existing planner the same way (no change to the LLM prompt — the PRD is the prompt).
  - On successful proposal creation, calls `writePrdArtifact` to persist the original markdown.
  - Sets `trigger.source = 'prd'` and `trigger.prdPath` on the proposal.
- **`notify(eventType, title, message)`** — shells `dmux _notify <title> <message> <eventType>` via execFile. Promise-returning, fire-and-forget pattern (errors logged, never thrown to the caller). Used by all server-side event sources.
- **Notify hooks** in `runPlanner`, `runAdoption`, `regenerateProposalFromChat`, and the violations-detection path.

In `dmux-ui/server/index.js`:

- **`POST /api/projects/:name/proposals`** accepts an optional `source` and `prdMarkdown` in the body. When `source === 'prd'`, the planner runs as before; the prompt field can be either the PRD itself or a derived summary (we use the full PRD).
- **`GET /api/projects/:name/runs/:proposalId/prd`** returns the PRD markdown or 404.

### 3.3 UI additions

In `dmux-ui/src/components/NewRunSheet.jsx`:

- PathStep gets a third card: **From PRD**.
- New step `'prd-input'`: project select, drop zone, textarea, file-name display.
- Drop zone uses `<input type=file>` + drag-drop handlers. Selecting / dropping a file reads it via `FileReader` and populates the textarea.
- Submit hits the planner endpoint with `{ prompt: <prd-content>, source: 'prd' }` in the body.

In `dmux-ui/src/pages/RunDetail.jsx`:

- `ReviewTabContent` renders a "From PRD" card above the agents table when `run.trigger?.source === 'prd'`. Fetches the markdown via `GET .../prd`, renders with `react-markdown`, defaults closed.
- The "Your request" card is suppressed when `source === 'prd'`.

### 3.4 CLI additions

In `dmux.sh`:

- **`dmux propose <project> --prd <file>`** — reads the file, POSTs to the planner endpoint with `source: 'prd'`, polls for completion, prints the proposal-review URL. Mirrors `dmux adopt`'s pattern.
- **`send_notification` extended** with an optional third argument (event type) — looks up the preference in `~/.config/dmux/notifications.json` and no-ops if disabled.
- **`_notify` subcommand extended** with optional fourth arg (event type) — passes through to `send_notification`.
- **`_notify-permission` subcommand** — fires the `agent_blocked_on_permission` event from the bash side. The trigger logic (detecting that an agent is paused on a Y/N) is §7.1's open question; for v1 we wire the subcommand and leave triggering to a follow-up.

---

## Section 4 — Wireframes

### 4.1 Spawn sheet — PathStep with three cards

```
┌─ Step 1 of N — Choose path ───────────────────────────────────────┐
│  ┌────────────┐  ┌────────────┐  ┌────────────┐                   │
│  │     ⚡     │  │     ✨     │  │     📄     │                   │
│  │   Quick    │  │   Smart    │  │  From PRD  │                   │
│  │            │  │            │  │            │                   │
│  │ Pick a     │  │ Describe   │  │ Drop a     │                   │
│  │ skill      │  │ in words   │  │ markdown   │                   │
│  │ Choose →   │  │ Describe → │  │ Upload →   │                   │
│  └────────────┘  └────────────┘  └────────────┘                   │
└───────────────────────────────────────────────────────────────────┘
```

### 4.2 PRD-input step

```
┌─ Step 2 of 2 — From PRD ──────────────────────────────────────────┐
│                                                                    │
│  Project: [project-name ▾]                                        │
│                                                                    │
│  PRD or feature spec                                              │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ ┌──────────────────────────────────────────────────────────┐ │ │
│  │ │  Drop a .md file here, or paste content below            │ │ │
│  │ └──────────────────────────────────────────────────────────┘ │ │
│  │                                                              │ │
│  │  (large textarea, ~12 rows)                                 │ │
│  │                                                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  Or [Pick a file…]   spec.md  (12 KB)                             │
│                                                                    │
├───────────────────────────────────────────────────────────────────┤
│  [← Back]                                       [Plan team →]    │
└───────────────────────────────────────────────────────────────────┘
```

### 4.3 PRD card on review page

```
┌─ From PRD ────────────────────────────────────────────────────────┐
│  📄 spec.md                                              [Show ▾] │
└───────────────────────────────────────────────────────────────────┘
```

Disclosure-expanded: renders the markdown via `react-markdown`.

### 4.4 Notification (macOS)

Standard osascript display-notification — same shape as the existing run-completion notifications fired by bash today.

---

## Section 5 — Decisions to confirm before implementation

These are the load-bearing choices. Push back on any.

1. **PRD storage: persisted artifact at `.dmux/prds/<proposalId>.md`.** Trade-off: a 50KB PRD per proposal isn't free, but it's audit-grade. Alternative: ephemeral (passed to planner, not stored). Recommended: persist — matches the chat-history-as-audit-trail pattern from Wave 2D.

2. **PRD as the planner prompt verbatim.** No summarization, no "extract goals from PRD then plan." The planner sees the whole markdown. Cheaper, simpler, and the existing planner prompt is already good at extracting actionable intent. Recommended: confirm.

3. **`trigger.source = 'prd'` on `type: 'nl'`, not a new trigger type.** Keeps the proposal lifecycle uniform — PRD-driven proposals are NL proposals with provenance. Alternative: `trigger.type = 'prd'`. Recommended: confirm — sub-type via `source` is more flexible and doesn't fragment the lifecycle.

4. **Notification dispatch via `dmux _notify` from the server.** Server shells `dmux _notify` instead of re-implementing osascript in Node. Keeps cross-platform dispatch in one place. Recommended: confirm.

5. **Per-event preferences in `~/.config/dmux/notifications.json`. Per-project preferences deferred.** Reason: per-project UX needs a settings page that doesn't exist yet. Recommended: confirm — ship the v1, add per-project in Wave 3B/3C.

6. **Defaults: everything on.** First-run UX is noisy by design — users learn what they want by getting interrupted, then turn things off. Less risky than under-notifying and looking broken. Recommended: confirm.

7. **`agent_blocked_on_permission` wired but not triggered in v1.** The detection logic (figuring out that an agent in a tmux pane is waiting for stdin) is non-trivial; queueing for a follow-up keeps Wave 3A from ballooning. The subcommand exists so the trigger can be added without UI changes. Recommended: confirm.

---

## Section 6 — Open questions (defer to implementation if not blocking)

1. **Permission-prompt detection.** How does bash know an agent is blocked? Options: tmux-pane capture + regex; presence of certain stdin prompts in the agent log; explicit signal from Claude Code via a status file. Pick when we get to triggering this event.
2. **PRD size cap.** No hard cap in v1. If users start feeding 100KB PRDs and discovery times out, revisit (cap at 50KB?).
3. **Notification rate limiting.** A run with 10 agents failing in 10 seconds shouldn't produce 10 osascript pops. Coalesce within a 5s window? Not in v1 — count-based notifications (e.g. "5 agents failed") need a separate event type. Live with the noise for now.
4. **Drag-drop fallback.** If the browser can't read the dropped file (Safari quirks?), the textarea + file picker still works. Don't over-engineer.
5. **Notification preferences via dmux subcommand.** `dmux notify set <event> on|off` is a half-day stretch. Could land in 3A or wait. Recommended: defer — editing JSON is fine for v1.
6. **`dmux propose` and existing `dmux-runs propose` from dmux-core.** Name collision: dmux-core/bin/runs.js already has a `propose` command (shipped in Wave 2B PR 2 for testing the lifecycle). The user-facing CLI `dmux propose` is at a higher level (talks to the HTTP API). Fine to have both — they're at different layers.

---

## Section 7 — What's explicitly NOT in Wave 3A

Reserved for Wave 3B or later:

- **Project-global / dmux-global chat** — Wave 3B. Wave 2D's per-proposal chat is the precedent; 3B generalizes it.
- **Webhook notifications (Slack / Telegram / Discord)** — out for v1. Local notifications cover the away-from-keyboard case for solo users; cross-channel is more pressure for self-hosted/team phases.
- **Mobile push** — needs hosted infra. Not on the solo-first roadmap.
- **Tray app** — companion macOS app for richer status. Sketched in `wave-3.md` §3A; deferred until users push back on osascript pops.
- **Click-to-open in notifications.** macOS notification click handlers require a real bundle id, not a script. Defer until tray app.
- **`dmux notify` settings command.** §6.5 — edit JSON for now.
- **Per-project notification preferences.** §5.5 — needs a UX surface.

---

## Implementation order (after this doc is approved)

Three slices, one PR:

**Slice 1 — PRD ingestion.** ~1.5 days.
- Server: `writePrdArtifact` + `readPrdArtifact` helpers, extend `runPlanner` to accept and persist a PRD, extend `POST /api/projects/:name/proposals` body, new `GET .../prd` endpoint.
- UI: new "From PRD" card on PathStep, new `'prd-input'` step in `NewRunSheet` (drop / paste / file picker / textarea), "From PRD" card on the proposal review variant.
- CLI: `dmux propose <project> --prd <file>` subcommand.

**Slice 2 — Notifications fan-out.** ~1 day.
- Bash: extend `send_notification` with optional event-type; extend `_notify` subcommand; add `_notify-permission` subcommand (wire only, no trigger detection in v1).
- Server: `notify(eventType, title, message)` helper; hooks in `runPlanner`, `runAdoption`, `regenerateProposalFromChat`, and the violations path.

**Slice 3 — Preferences.** ~0.5 days.
- Bash: load `~/.config/dmux/notifications.json` in `send_notification`; default-on if missing; per-event toggle.
- Docs: a short section in CLAUDE.md or the wave doc explaining how to edit the file.

Wave 3A is done when all three land + end-to-end verified (PRD → proposal → run-completed notification fires + scope-violation notification fires). Total ~3 days of compressed work.

---

*Ready for review. Push back on anything in Section 5 (decisions) before implementation begins.*
