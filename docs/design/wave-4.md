# dmux — Wave 4 Outline

Status: **outline only**, not a spec. Wave 3 closed 2026-06-02 (#41–46). This doc proposes what Wave 4 should be and in what order; each sub-wave will get its own per-wave design pass before any code, same as Wave 3.

Predecessor: `wave-3.md`. Per-sub-wave docs land as `wave-4a.md`, `wave-4b.md`, etc.

---

## Why Wave 4 exists

After Wave 3, dmux has a Maestro-shaped surface (adopt → chat → propose → customize → approve → run → handoff artifacts → MCP-enabled agents) that works end-to-end for the solo flow. The shape of "managing multiple projects from one place" is real.

What's still rough:

- **The "team" is N parallel agents in isolated worktrees.** Wave 3E made plan/build/review roles produce structured artifacts, but the artifacts are display-only. A reviewer that says "request_changes" doesn't trigger anything. There's no agent → user channel for mid-run questions. There's no automatic handoff loop between roles. Coordination by *isolation* still wins over coordination by *communication*.
- **The user juggles multiple projects but dmux's visibility into "what's happening across them" is limited.** Dashboard shows in-flight runs, but you can't *see* what an agent is doing without opening that project's session view. There's no timeline of "this MCP tool was called at this time" or "this handoff artifact landed when." Cross-project signal is shallow.
- **There's no automation layer beyond skills.** Skills generate config; that's it. There's no "do X every time" or "after Y happens, run Z" — no workflows in the original Wave 3F sense.
- **Several end-to-end paths were never exercised in a real run.** Wave 3C provider switching, 3D MCP integration with claude, 3E live plan→build→review with real role-aware prompts, 3F's seed catalogue repo. The plumbing's right; the confirmation isn't there.

Wave 4 addresses these four threads. The user's original vision still steers: solo-first, public-ready, multi-project juggling, agents-as-teammates-not-tools.

What Wave 4 is **not** about:

- Teams / multi-user / self-hosted. That's Phase 3 of the original CLAUDE.md product pipeline — explicitly later than Wave 4.
- Anthropic SDK migration. Cost pressure hasn't materialized; Wave 3B's `claude --print` shape is fine.
- Cloud SaaS / paid skills. Phase 4 territory.

---

## Sequencing principle

Order by **user leverage on the daily juggling-multiple-projects workflow**, not technical interest. The same principle that ordered Wave 3 (3A unblocking PRD ingestion as the highest-impact thing).

Proposed order:

1. **4A — Run timeline + god-view** (immediate visibility win across many projects)
2. **4B — Iteration & escalation** (closes the Wave 3E loop; the deepest deferred problem)
3. **4C — Workflows** (the new automation abstraction; pairs with Wave 3F's marketplace once it lands)
4. **4D — Loose-ends polish** (verify and clean up everything deferred from Waves 3C/3D/3E/3F + the smaller debts accumulated)

Wave 4 is **4 sub-waves vs Wave 3's 6** — narrower on purpose. Workflows and iteration are both genuinely large; cramming more in dilutes both.

---

## 4A — Run timeline + god-view

**Why first:** the user named "managing multiple projects at the same time" as the foundational pain. Today's Dashboard lists in-flight runs but you can't *see* what they're doing without opening each project. Cross-project visibility is the most direct unlock.

In scope:
- **Run timeline.** A per-run event stream surfaced on Run Detail: agent started, plan written, build started, MCP tool called (server X, method Y), handoff artifact landed, scope violation detected, agent completed. Events emit from existing hooks (`_notify`, agent signal files, MCP wrapper); the new piece is a structured event log at `<runDir>/timeline.jsonl` + a UI that renders it.
- **God-view.** A new top-level page that renders a grid (or tmux-style mosaic) of active agent panes across all projects with current status, last-event-at, and a hot link into each. Single-screen "what is dmux doing right now."
- **Per-project event subset on Project Detail.** A "Recent activity" card showing the last 10–20 events scoped to the project.

Explicitly out:
- Long-term event retention / search. Timeline is per-run, lives with the run; cleanup follows the run's lifecycle.
- Cross-project event correlation ("this run depended on the output of that run") — Wave 5 if ever.
- Mobile / responsive god-view. Solo-first, desktop only.

Open questions:
- Do we hook MCP tool calls? Requires intercepting agent stdout or reading Claude Code's logs. May be deferred to a Wave 4A.next.
- God-view as a separate route vs. modal vs. always-on sidebar. Probably a route at `/activity` or similar; pinpoint during design pass.

---

## 4B — Iteration & escalation

**Why second:** the hardest deferred problem. Wave 3E shipped handoff artifacts but explicitly punted on auto-iteration (the §5.7 / §7 deferrals). 4B is the sequel that closes that loop — turning "the reviewer flagged X" into "dmux did something about it."

In scope:
- **Review-driven re-iteration.** When a reviewer writes a `request_changes` verdict, dmux offers to re-run the build agent with the review attached as additional context. Optional (UI button on Run Detail) in v1; full automation in v2.
- **Iteration cap + termination conditions.** Don't loop forever. Hard cap at 3 iterations per build agent per run; surface the count + verdict trend.
- **Escalation channel.** Agent writes a structured "I need a decision from the user" message to `<runDir>/escalations/<agent>.json`; server polls, fires notification; user answers via UI; answer goes back to the agent's worktree as `<runDir>/answers/<agent>-<n>.json`. The agent's prompt is taught to check for answers periodically.
- **Status badges on agent rows** showing "iterated 1×" / "blocked on permission" / "wrote review" so the user can see coordination state at a glance.

Explicitly out:
- Auto-delegation ("the build agent decided it needs a security reviewer, spawn one") — needs its own design pass.
- Agent ↔ agent free-form messaging beyond the handoff artifacts + escalations.
- Iteration on plan-role agents (only build → review iteration in v1; replanning is a different shape).
- Cross-run iteration (re-running a previous run with new review context).

Open questions:
- Detection of "the agent is paused waiting for permission" (the Wave 3A `agent_blocked_on_permission` event was wired but never triggered automatically). 4B is the right wave to finally implement detection — tmux pane capture + regex, or Claude Code status file.
- Auto vs. manual re-iteration default: I lean manual-by-default (user clicks "Re-iterate with this review") in v1, opt-in auto in v2 once we've seen what loops look like in practice.

---

## 4C — Workflows

**Why third:** the missing automation abstraction. Wave 3F's marketplace introduced the *catalogue* for skills but the *workflows* concept (multi-step recipes over skills + git + MCP) was explicitly deferred from that wave. 4C revisits and ships it.

In scope:
- **Workflow file format.** YAML at `~/.config/dmux/workflows/<name>/workflow.yml`. Defines a sequence of steps over skills, git operations, MCP calls, and proposal lifecycle actions. Strict schema validated by dmux-core.
- **Workflow runner.** A new `dmux workflow run <name>` command (and UI surface) that executes the steps. Errors surface inline, the run is observable via 4A's timeline.
- **Two example built-in workflows** for v1: `new-feature` (branch + planner + builder + open PR via GitHub MCP) and `audit-and-fix` (security-audit skill + auto-iterate on findings).
- **Workflows catalogue, layered on Wave 3F's marketplace.** Catalogue manifest extended to list `workflows:` alongside `skills:`. Same install flow.

Explicitly out:
- Generalized scripting (arbitrary code in workflow steps). Workflows are declarative recipes; code goes in skills.
- Per-step conditional logic ("if step 2 failed, do X else Y"). v1 is straight-line; branching is a Wave 5 design problem.
- Workflow composition (workflows calling other workflows). Same.
- Scheduled workflows (cron-style triggers). Different shape — closer to Phase 3 territory.

Open questions:
- What does the actual file schema look like? Pin during the per-wave design pass. The runner shape determines the schema, not the other way around.
- Do workflows handle errors gracefully or fail-loud? Lean fail-loud in v1 (steps are atomic; on error, the workflow halts + surfaces the failure).
- Where do workflow runs live in the existing run-lifecycle? A workflow run might create multiple proposals (e.g. `audit-and-fix` runs the auditor, then a follow-up). Probably workflow run = top-level container, with N child runs.

---

## 4D — Loose-ends polish

**Why last:** the lowest-impact-per-line work, but the *quality* of the dmux experience improves a lot once Wave 3's deferred items are actually verified end-to-end.

In scope:
- **Set up the `dharnnie/dmux-skills` seed repo** (the Wave 3F follow-up). 2–3 example skills, real `catalogue.yml`. Pure ops + a couple skill.yml files.
- **Codex provider end-to-end** (Wave 3C deferred). Install the CLI, add the provider registry entries per `docs/providers.md`, run a real codex agent. Same for Gemini if not done already.
- **Live `claude --mcp-config` verification** (Wave 3D deferred). Spawn a real claude agent against a real MCP server (github), confirm it uses the tools.
- **Live plan → build → review run** (Wave 3E deferred). Real planner writes plan.md, real builder reads it, real reviewer writes review.md. Confirms the role-aware prompt insertion actually works.
- **The smaller persistent debts:**
  - Multiple project names → same path (registry collision).
  - "New chat" UI affordance (clearing chats currently needs hand-deleting a file).
  - `agent_blocked_on_permission` event was wired but never triggered (may end up in 4B instead).
  - CLI parity for the things that ended up UI-only (chat, customize, handoff viewer).

Explicitly out:
- New features. 4D is solidification, not expansion. Anything that smells like a new capability goes in a different sub-wave.

Open questions:
- Should 4D be one big PR or several small ones? Lean several small ones because the items are mostly independent.

---

## Cross-cutting principles (apply to every sub-wave)

These come from Wave 2/3 lessons + user-stated preferences. Keep them front of mind during per-sub-wave design passes:

1. **`claude --print` only.** No Anthropic SDK / API key requirement anywhere. Wave 3B's SDK rejection still stands. Provider choice (Wave 3C) is for agents in runs, not infrastructure.
2. **LLM output validated by dmux-core, not the prompt.** Wave 2B model-id normalization, Wave 2D skill-name validation, Wave 3C custom-rewrite validation, Wave 3D plaintext-secret rejection, Wave 3E permissive-on-malformed-appendix. Same posture for any future LLM output.
3. **Solo-first.** Phase 3 (teams / self-hosted) is later. Anything Wave 4 adds must serve the single user juggling multiple projects.
4. **Public-ready.** Docs, error messages, install story are first-class — not "polish at the end."
5. **UI-first** with CLI parity tracked but not gating. Per Wave 2 memory.
6. **Don't reimplement Claude Code.** Wrap, surface, recommend. Wave 4A's timeline should leverage `_notify` and existing signal files rather than inventing a parallel event bus.
7. **Permissive parsing of agent-produced artifacts.** Markdown body preserved verbatim, structured-view goes null on parse failure (Wave 3E pattern). Same for any workflow output or escalation message.
8. **Sentinel-only secrets.** `.dmux/...` files never contain plaintext credentials. Wave 3D pattern.
9. **Artifacts under `<runDir>/...`** as the canonical pattern. Wave 4A's `timeline.jsonl`, Wave 4B's `escalations/`, Wave 4C's workflow-run state all follow.
10. **Each user-facing system gets a `docs/<system>.md` contract** matching `docs/notifications.md`, `docs/providers.md`, `docs/skills-catalogue.md`. Same template.

---

## What this outline is NOT

- **Not a commitment to ship all four sub-waves.** After 4A re-evaluate; reorder if 4B or 4C reveals it's smaller/larger than expected. Same posture as Wave 3.
- **Not a spec.** Each sub-wave gets its own design pass document (`wave-4a.md`, etc.) before any code.
- **Not scope creep for current waves.** Anything in 4A–4D that's pulled forward into a Wave 3 hotfix needs explicit justification.

---

## Decisions to confirm before starting 4A

These are the load-bearing choices about Wave 4's shape. The per-sub-wave design passes have their own §5 decisions; these are about the wave itself.

1. **Wave 4 is the four sub-waves above, in that order.** Sequencing rationale per "Sequencing principle." Recommended: confirm or reorder.

2. **Phase 3 (multi-user / self-hosted) is NOT in Wave 4.** It's the next phase after Wave 4. Confirms solo-first stance. Recommended: confirm.

3. **The Anthropic SDK migration is NOT in Wave 4.** Wave 3B rejected it; no cost pressure has materialized since. Recommended: confirm.

4. **Auto-iteration in 4B defaults to manual ("user clicks Re-iterate")**, not automatic. Auto comes in 4B.next or a refinement once we've seen what loops actually look like. Recommended: confirm.

5. **Workflows in 4C are declarative, not scripted.** YAML recipes over existing primitives, not arbitrary code. Recommended: confirm.

6. **4D is solidification, not expansion.** No new capability lands there. Recommended: confirm.

7. **Wave 4 sub-waves get their own per-wave design pass before any code** (`wave-4a.md` etc.) — same flow as Wave 3. Recommended: confirm.

---

*Outline ready for review. Push back on sequencing, on what's in vs. out, or on whether something else should be in Wave 4 entirely. When approved, the next step is `wave-4a.md` (run timeline + god-view design pass) before any implementation.*
