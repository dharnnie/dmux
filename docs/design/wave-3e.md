# dmux — Wave 3E Design Pass

Status: drafting before implementation. Pair-mode review welcome.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-3d.md`. Parent: `wave-3.md` (3E is the fifth of six sub-waves — and the one flagged in the Wave 3 outline as "most likely to slip or split").

---

## Where Wave 3D left us

After 3D, dmux has MCP integrations — agents can connect to external services through Anthropic-style MCP servers with Keychain-backed credentials. The capability shape of "what one agent can do" is meaningfully bigger.

What's still flat: **coordination across agents**. Today's "team" is N parallel agents in isolated worktrees:

- Each agent runs in its own pane, against its own branch, with its own `task:` string.
- Sequencing is via `depends_on:` — a marker file from one agent unblocks another.
- The "plan" role is convention only. A plan-role agent gets the same prompt shape as a build-role agent; the artifact it produces (some markdown file) is read only by whatever downstream task description happens to mention it.
- Scope enforcement is post-hoc. There's no "this agent flagged a problem, hand off."
- There's no agent → agent or agent → user message channel beyond "wait for marker file."

That's **coordination by isolation**, not by communication. The Wave 3 outline framed 3E as the wave that fixes this and explicitly warned it might split — generalized swarm graphs, cross-provider handoffs, escalation contracts, and Claude Code subagent integration are all genuinely hard problems.

**Wave 3E ships the smallest concrete pattern that creates the foundation**: structured handoff artifacts between roles. The plan-role and review-role finally produce typed, addressable artifacts that the next role automatically picks up. Iteration loops, escalation, and generalized swarm graphs are all explicit non-goals for v1 (see §7).

If the pattern feels right after a wave or two of use, 3E gets a sequel that adds the harder parts.

---

## Section 1 — Concepts introduced in Wave 3E

Three small concepts.

### 1.1 Handoff artifacts

Today's plan / build / review roles use the filesystem to talk to each other through convention ("the planner writes `docs/plan.md` and you should read it"). Wave 3E formalizes the artifacts:

- **Plan artifact** at `<runDir>/handoffs/plan.md`. Written by **plan-role** agents. Markdown body for human-readable context + a fenced ```json appendix with the canonical structured task list and acceptance criteria.
- **Review artifact** at `<runDir>/handoffs/review.md`. Written by **review-role** agents. Markdown body for human-readable explanation + a fenced ```json appendix with the verdict and structured findings.

These are **dmux-defined artifacts at dmux-defined paths**. The agent's task prompt is automatically extended by bash with role-specific instructions: planners are told to emit `handoffs/plan.md`; builders are told to read it; reviewers are told to write `handoffs/review.md`. The author of `.dmux-agents.yml` doesn't need to mention them.

### 1.2 Role-aware prompt extensions

dmux today injects nothing role-specific into agent prompts. Wave 3E adds short role-specific boilerplate that gets prepended to the agent's task string at launch time:

- **plan** — instructs the agent to write `handoffs/plan.md` in a specific format, with a JSON appendix matching the plan schema.
- **build** — instructs the agent to read `handoffs/plan.md` if it exists and treat the structured tasks as its source of truth; the agent's existing `task:` field becomes additional context.
- **review** — instructs the agent to read both the plan and the diff produced by upstream agents, then write `handoffs/review.md` with verdict + findings.
- **research** — no extension in v1 (research role is unchanged).

The boilerplate lives in `dmux.sh` as small heredocs (not as user-extensible skills) — these are dmux-internal protocol, not configurable behaviour.

### 1.3 Display, not action

In v1, handoff artifacts are **display-only**. The UI surfaces them on Run Detail so the user can read what the planner planned and what the reviewer thought. Reviews **do not** auto-trigger anything — if the reviewer says "request_changes," dmux doesn't re-run the builder. The user does whatever they want with the information.

This is the load-bearing constraint that keeps Wave 3E small. Adding auto-iteration ("if review verdict is request_changes, re-launch the build agent with the review attached") is a Wave 3E sequel: it's the natural next move but introduces termination-condition questions (max iterations, divergence detection) that we should answer empirically by seeing what reviews actually look like first.

---

## Section 2 — End-to-end flow

### 2.1 A run with plan → build → review (today)

```
planner (role=plan)            writes some markdown wherever its task said
   ↓
auth-builder (role=build)      reads ... what? its task string mentions
                               the plan filename, hopefully it remembered
   ↓
reviewer (role=review)         reads ... whatever its task says, probably
                               the diff
```

### 2.2 A run with plan → build → review (Wave 3E)

```
planner (role=plan)
   ↓ writes <runDir>/handoffs/plan.md with structured JSON appendix
   ↓
auth-builder (role=build)
   ↓ launches with handoffs/plan.md loaded into its prompt automatically
   ↓ implements the tasks; commits to its worktree
   ↓
reviewer (role=review)
   ↓ launches with handoffs/plan.md + the build agent's git diff
   ↓ writes <runDir>/handoffs/review.md with verdict + findings
   ↓
UI surfaces both artifacts on Run Detail.
User reads the review, decides what to do.
```

### 2.3 UI: Handoffs card on Run Detail

A new card between the existing Agents table and the Run config disclosure, visible only when at least one handoff artifact exists. Two collapsible sections:

```
┌─ Handoffs ────────────────────────────────────────────────────────┐
│                                                                    │
│  📋 Plan — by planner                                  [Show ▾]   │
│                                                                    │
│  ⚖️ Review — by reviewer  ·  request_changes  ·  2 findings  [▾]  │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

Expanding plan renders the markdown via react-markdown plus a "Tasks" structured view from the JSON appendix.
Expanding review renders markdown + a "Findings" structured table (severity / file:line / comment).

If a review's verdict is `block` or `request_changes`, the row shows the verdict as a colored chip — `request_changes` orange, `block` red, `approve` green.

---

## Section 3 — Schemas

### 3.1 Plan artifact

File: `<runDir>/handoffs/plan.md`. Author: plan-role agent.

Format: markdown body + a fenced ```json block at the end. The structured appendix is canonical; the markdown is human-readable summary.

```markdown
# Plan: <one-line summary>

## Goal
<one paragraph on what's being built>

## Tasks
<numbered list of tasks, freeform, includes rationale>

## Acceptance criteria
<bulleted list of testable outcomes>

```json
{
  "summary": "Add OAuth login flow with bcrypt + JWT",
  "tasks": [
    { "id": "1", "description": "Add User model", "files": ["src/models/user.js"] },
    { "id": "2", "description": "Add /auth/register route", "files": ["src/routes/auth.js"] }
  ],
  "acceptanceCriteria": [
    "Login returns 200 + token for valid creds",
    "Login returns 401 for bad creds"
  ]
}
```
```

dmux-core's parser:
- Extracts the fenced ```json block.
- Validates: `summary` (string), `tasks` (array of `{id, description, files?}`), `acceptanceCriteria` (array of strings).
- Permissive on the markdown body — preserved verbatim for UI rendering.
- If the JSON appendix is missing or invalid: the artifact is **still kept** (markdown still renders) but `tasks` / `acceptanceCriteria` come back as null. The UI shows a "structured view unavailable" hint.

### 3.2 Review artifact

File: `<runDir>/handoffs/review.md`. Author: review-role agent.

```markdown
# Review: <one-line summary>

## Summary
<one paragraph on overall verdict>

## Findings
<numbered list with severity + file:line + comment>

## Verdict
<one of: approve, request_changes, block>

```json
{
  "verdict": "request_changes",
  "summary": "Two findings worth addressing before merge.",
  "findings": [
    { "severity": "medium", "file": "src/routes/auth.js", "line": 42, "comment": "bcrypt rounds=10, recommend 12+" },
    { "severity": "low",    "file": "src/routes/auth.js", "line": 78, "comment": "missing rate limit on /auth/login" }
  ]
}
```
```

Parser:
- `verdict` must be one of `approve` / `request_changes` / `block` — anything else normalizes to `approve` with a warning logged.
- `findings` is an array of `{severity, file, line?, comment}`. `severity` validated against `{low, medium, high, critical}`.
- Same permissive-markdown rule as plan.

### 3.3 Where artifacts live

Per-run, under the existing dmux run directory:

```
<projectPath>/.dmux/runs/<runId>/
  handoffs/
    plan.md
    review.md
```

The `handoffs/` directory is created by bash at run-start. Artifacts are owned by the agent whose role matches. Multiple plan-role or review-role agents in the same run would clobber each other — flagged in §6.5 as an open question (probably solved by suffixing the author name, but defer until we hit it).

---

## Section 4 — Implementation surface

### 4.1 dmux-core additions

New module: `dmux-core/src/handoffs.js`.

- `parsePlanArtifact(markdownText)` → `{ markdown, structured: { summary, tasks, acceptanceCriteria } | null, parseError?: string }`
- `parseReviewArtifact(markdownText)` → `{ markdown, structured: { verdict, summary, findings } | null, parseError?: string }`
- `HandoffSchemaError` (warning-shape only — parsing returns null structured instead of throwing).
- Tests: ~10 cases each.

Why not throw on parse error? Because the markdown body is still useful even when the JSON appendix is broken — we don't want a malformed JSON appendix to wipe out the planner's work from the UI.

### 4.2 Server additions

In `dmux-ui/server/lib/handoffs.js` (new):

- `readPlanArtifact(projectPath, runId)` → `{ markdown, structured, parseError? } | null`
- `readReviewArtifact(projectPath, runId)` → same shape, or null

New endpoint:
- `GET /api/projects/:name/runs/:runId/handoffs` — returns `{ plan: ... | null, review: ... | null }`. UI fetches once when the Handoffs card mounts; no streaming.

### 4.3 UI additions

- `dmux-ui/src/components/HandoffsCard.jsx` + module CSS — renders both artifacts as collapsible disclosures with verdict chips for review.
- Plan structured view: numbered task list with file chips.
- Review structured view: findings table with severity chip per row.
- `dmux-ui/src/pages/RunDetail.jsx` — mount HandoffsCard in the "running" / "completed" / "failed" variants, between the Agents card and the Disclosure of the frozen config.

### 4.4 Bash additions

In `dmux.sh`:

- `mkdir -p <runDir>/handoffs` at run-start (next to existing `mkdir -p <signal_dir>`).
- A new helper `role_task_extension(role)` returns the boilerplate to prepend to the agent's task. Three cases (plan / build / review); empty string otherwise.
- Agent launch wires the extension: the full prompt becomes `<role-extension>\n\n<user task>` instead of just `<user task>`.

The extensions are short — each is a ~120-character paragraph telling the agent where to read/write its artifacts. Full text in `dmux.sh` as bash heredocs; not user-configurable in v1.

### 4.5 CLI additions

**None.** Handoffs are a UI surface; CLI can show artifact paths in `dmux agents status` output but that's a follow-up.

---

## Section 5 — Decisions to confirm before implementation

These are the load-bearing choices.

1. **v1 scope is artifacts + display only.** No auto-iteration, no escalation, no inter-agent messaging beyond the two predefined artifacts. Wave 3E sequel handles the harder parts once we've seen real artifacts in real runs. Recommended: confirm.

2. **Format is markdown body + fenced ```json appendix.** Same pattern as the planner and discovery agents already use. Familiar to agents from Wave 2B. Recommended: confirm.

3. **Two artifact types only: plan + review.** No `clarification`, `decision-log`, `handover-summary`, etc. Adding more is cheap; deferring keeps v1 focused. Recommended: confirm.

4. **Artifacts live in `<runDir>/handoffs/`.** Per-run, not per-agent. Multiple plan-role or review-role agents would collide — flagged as open question §6.5. Recommended: confirm.

5. **Role-aware prompt extensions live in `dmux.sh`, not in skills.** These are dmux protocol, not user-extensible behaviour. Skills can still add to a task on top. Recommended: confirm.

6. **Permissive parsing — missing/malformed JSON appendix shows markdown only.** Don't wipe out the planner's work just because the appendix is broken. Structured features (task chips, finding tables) become unavailable; the rest renders. Recommended: confirm.

7. **Review verdict is displayed, never auto-acted on.** Iteration loops are explicitly deferred. The user reads the review and decides next steps. Recommended: confirm.

8. **research / unknown roles get no role extension.** Today's behaviour. Recommended: confirm.

9. **Plan agents that fail to emit a plan don't block downstream.** Lenient policy — better to let builders proceed with whatever was written than fail the run on missing artifact. Documented in the UI when a build agent runs without a plan available. Recommended: confirm.

10. **Two slices, one PR.** Slice 1 ships the plan artifact + plan UI + role-aware prompt for plan + build. Slice 2 adds review. Recommended: confirm.

---

## Section 6 — Open questions (defer to implementation if not blocking)

1. **What does the role extension actually say?** Pin the exact text during Slice 1. Short and prescriptive — the agent needs to know the filename, the markdown structure expected, and how to format the JSON appendix.

2. **How does the build agent's task interact with the plan?** If both exist, do we merge ("here's the plan, plus this extra context") or just prepend the plan? v1: prepend plan as the source of truth, user task as additional context. Most natural reading order.

3. **What happens when the same plan-role agent runs twice (e.g. iteration)?** v1 only ships one launch, but: append a numeric suffix? Overwrite? Defer until we get to iteration in a Wave 3E sequel.

4. **What if a build agent crashes before its diff exists?** The reviewer launches anyway (per `depends_on`) and reads ... nothing. Reviewer's prompt should handle the "no diff yet" case by writing a review that says verdict=block with a single finding pointing at the build crash. Document the convention; trust the agent to follow it.

5. **Multiple plan-role agents in one run.** Out for v1 — collision risk. If we ever support it: per-author filename (`plan-<authorName>.md`).

6. **Review of multiple builders.** A reviewer might want to review work from build-agent-A AND build-agent-B. v1: the reviewer's task string can mention specific agents to review; the structured findings have the agent's name optionally in the `file` field (e.g. `auth-builder:src/routes/auth.js:42`). Pin the convention during Slice 2.

7. **What about the existing `agents` UI table — should it show "wrote plan.md" status per agent?** Lean yes — small follow-up; doesn't need to block 3E. Track as a 3E.next idea.

---

## Section 7 — What's explicitly NOT in Wave 3E

The biggest deferred items:

- **Auto-iteration.** If review verdict is `request_changes`, dmux does NOT re-launch the build agent automatically. Wave 3E sequel.
- **Escalation / Q&A.** No agent → user "I need a decision" channel. No agent → agent messaging beyond the two artifact types.
- **Auto-delegation.** No "the build agent decided it needed a security review, spawn one."
- **Generalized swarm graphs.** Plan → build → review is the only pattern. No arbitrary agent → agent edges in v1.
- **Cross-run coordination.** Each run is self-contained.
- **Claude Code subagent / Task tool integration.** Stays at per-tmux-pane level. Subagent-style coordination is a Wave 4 design problem.
- **Status badges on agent rows showing "wrote plan", "wrote review".** Nice-to-have follow-up after the artifacts ship.
- **Multiple plan-role or review-role agents in the same run.** Collision risk; defer until needed.
- **Plan / review for non-Claude providers.** Gemini agents would need the same role-aware extension; in v1 we keep it claude-only — plan / review role agents must be on claude. Mixed teams (build on gemini, review on claude) are fine.

Anything pulled forward needs explicit justification.

---

## Implementation order (after this doc is approved)

Two slices, one PR:

**Slice 1 — Plan handoff end-to-end.** ~1.5 days.
- `dmux-core/src/handoffs.js` with `parsePlanArtifact` + tests.
- `dmux-ui/server/lib/handoffs.js` with `readPlanArtifact`.
- `GET /api/projects/:name/runs/:runId/handoffs` endpoint (returns `{plan, review: null}` for now).
- bash: `mkdir handoffs/` at run-start; `role_task_extension` for plan + build; agent launch wires the extension.
- UI: `HandoffsCard.jsx` with plan section only; mount on Run Detail.
- Verify end-to-end against a fresh fixture: a 2-agent team (planner + builder) where the planner writes a real `plan.md` and the UI renders it with the structured task list.

**Slice 2 — Review handoff.** ~1 day.
- `parseReviewArtifact` + tests.
- `readReviewArtifact` + endpoint extension.
- bash: `role_task_extension` for review.
- UI: review section on HandoffsCard with verdict chip + findings table.
- Verify end-to-end against a 3-agent team (planner + builder + reviewer).

Total ~2.5 days. Wave 3E v1 is done when both artifacts render correctly in the UI from a real run.

---

*Ready for review. Push back on anything in Section 5 (decisions) before implementation begins. The biggest scope call is §5.1 — keeping v1 to display-only is what makes this wave shippable in 2.5 days instead of 2.5 weeks.*
