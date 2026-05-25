# dmux — Wave 2C Design Pass

Status: drafting before implementation. Pair-mode review welcome.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-2b.md`. Successor: `wave-2d.md` (onboarding experience — not yet written).

---

## Where Wave 2B left us

After Wave 2B (PRs #36, #37, #38) merged, dmux can:

- Spawn a team from a parameterized skill (Quick path) or a free-form NL prompt that gets planned into a proposal (Smart path).
- Stage runs as `proposed` → `approved`/`discarded` before any agent touches the worktree.
- The proposal review surface is real; Dashboard and Project Detail render pending proposals.

What we still can't do: turn an **existing repo the user has never touched with dmux** into a working dmux project without manual setup. Today the user has to: register the project path manually, hand-write a `CLAUDE.md` (or rely on whatever's there), and either pick a skill blindly or type an NL prompt that the planner has no real project context for. Adoption is the missing on-ramp.

Wave 2C closes that gap **narrowly**: a single `dmux adopt` flow that registers the project, runs a discovery agent against it, lands a useful `CLAUDE.md`, and stages an initial `.dmux-agents.yml` as a proposal the user reviews + approves like any other.

The Maestro-style **onboarding experience** (agent intro chat, recommended-skills surface, "name your first agent" wizard) is explicitly **deferred to Wave 2D**. 2C is the foundation 2D builds on; shipping it first means we feel the narrow flow in real use before committing to broader UX shape.

---

## Section 1 — Concepts introduced in Wave 2C

Three new ideas land in this wave. Each is small in isolation; together they're the adopt flow.

### 1.1 The discovery agent

A sibling of the NL planner. Same invocation pattern (shells `claude --model sonnet --print` with a structured prompt; extracts fenced blocks from the response). Different goals: instead of producing a *team* for a stated request, it produces a *durable understanding* of the repo plus a starter team.

Discovery reads:
- The project's depth-limited file tree (same helper Wave 2B uses; same defaults).
- The repo's `README.md` if present.
- Any top-level `package.json` / `Cargo.toml` / `pyproject.toml` / `go.mod` / similar manifest files (best-effort, capped at first 5).
- The existing `CLAUDE.md` if present (so we preserve user content on re-adopts).
- The existing `.dmux-agents.yml` if present (so the starter team can build on what's already configured rather than overwrite blindly).

Discovery emits **two fenced blocks** in a single response:

```
```claude-md
<full content of the proposed CLAUDE.md>
```

```yaml
<starter .dmux-agents.yml>
```
```

Plus a one-paragraph plain-text summary outside the blocks for the human to read.

### 1.2 The `claude-md` artifact

Today dmux reads `CLAUDE.md` for planner context but never writes it. Wave 2C is the first feature that writes `CLAUDE.md` — which means we need a merge story.

**Rules:**

- **No existing `CLAUDE.md`:** write the discovery output verbatim.
- **Existing `CLAUDE.md` with a `<!-- dmux:discovered -->` block:** replace just that block, preserve everything outside it.
- **Existing `CLAUDE.md` without the marker:** preserve the entire existing content; append a new `<!-- dmux:discovered -->` block at the bottom. User keeps full ownership of their hand-written content.

The discovery agent is told to *always* wrap its output in the marker comments. Any content the user has authored above/around the marker block is theirs forever.

### 1.3 Adoption as a special case of proposal

The starter `.dmux-agents.yml` is not written to disk directly. It lands as a **proposal** via the existing `createProposal` API (shipped in PR #37), with `trigger: { type: 'adopt' }`. The user reviews it on the existing proposal review page (shipped in PR #38) and approves / edits / discards it like any other proposal.

Why reuse: the review-before-running guarantee from Wave 2B is exactly the right safety net for a generated team config the user has never seen.

Why a new trigger type: distinct from `nl` so the review page can render an "Adopted from this repo" banner instead of quoting an NL prompt that doesn't exist.

---

## Section 2 — End-to-end flow

### 2.1 UI happy path

1. **Dashboard** gains a secondary action next to "+ New Run": **"Adopt a repo"**. (Also reachable from the empty-state on the Projects grid when no projects exist.)
2. Clicking it opens an **AdoptSheet** with two fields:
   - **Path** (text input, required) — absolute path to the repo on disk. The user pastes; we can't browse local FS from a browser. Validation on blur: path exists and is a git repo.
   - **Name** (text input, optional) — defaults to the directory basename; user can override. Must be unique in the project registry.
   - A single primary action: **"Adopt"**.
3. Submit calls `POST /api/adopt`. The sheet shows a **progress state**: "Reading repo… (~30s)" → "Asking discovery agent… (~30s)" → "Writing CLAUDE.md and staging team proposal…". One spinner, sequential labels matching server stages.
4. On success the sheet closes and the user lands on `/projects/:name/runs/:proposalId` — the proposal review page, with the starter team rendered and a banner noting "Adopted from `<path>`".
5. From there the user approves, edits, or discards as with any other proposal.

### 2.2 CLI parity

`dmux adopt <path> [--name <name>]`:

- Same backend call as the UI (via `dmux-core` directly, not via the server).
- Prints stage progress as text:
  ```
  Adopting /Users/dani/todo-api as "todo-api"…
    ✓ Registered project
    ✓ Read repo (24 files, package.json + README.md detected)
    · Running discovery (this takes 30-60s)…
    ✓ Wrote CLAUDE.md (existing file preserved; appended discovered block)
    ✓ Staged starter team as proposal 2026-05-25T120000-abc123
  
  Review the proposed team:
    dmux ui                                          (then click the proposal)
    or open http://localhost:3100/projects/todo-api/runs/2026-05-25T120000-abc123
  ```
- Exit codes: 0 success, 1 usage, 2 path not a git repo, 3 name conflict, 4 discovery failure.

### 2.3 Server flow

`POST /api/adopt` body `{ path: string, name?: string }`:

1. **Validate path** — absolute, exists, contains a `.git/` directory. Returns 400 with a clear message otherwise.
2. **Resolve name** — use provided name or `basename(path)`. Reject if already in registry (409).
3. **Register project** — call existing `addProject(name, path)`.
4. **Run discovery** — new `runDiscovery(projectPath, projectName)` helper in `dmux-ui/server/lib/dmux.js`. Shells claude with the discovery prompt; extracts both fenced blocks; validates the YAML via `parseAgentsConfig`; retries once on validation failure.
5. **Write CLAUDE.md** — new `writeClaudeMd(projectPath, content)` helper. Applies the merge logic from §1.2.
6. **Create proposal** — call `createProposal` with the discovered YAML, `trigger: { type: 'adopt', adoptedPath: path }`.
7. **Respond** `{ ok: true, projectName, proposalId }`.

Error mapping: 400 (bad path), 409 (name conflict), 422 (discovery output unparseable after retry), 503 (claude not on PATH), 504 (timeout), 500 (other).

---

## Section 3 — The discovery prompt

A skeleton — refine empirically once we run it against a handful of real repos. The Wave 2B planner prompt is the right reference for tone.

```
You are dmux's discovery agent. Your job is to read a project the user just
adopted into dmux, then emit two artifacts: an updated CLAUDE.md and a
starter .dmux-agents.yml.

You will see: the depth-limited file tree, the README (if any), top-level
manifest files (package.json / Cargo.toml / etc., if any), the existing
CLAUDE.md (if any), and the existing .dmux-agents.yml (if any).

Output format: exactly two fenced code blocks, in this order:

  ```claude-md
  <content>
  ```

  ```yaml
  <content>
  ```

Plus one short paragraph outside the blocks summarizing what you found and
what kind of team you proposed.

### CLAUDE.md rules

- Wrap your output in:
    <!-- dmux:discovered start -->
    ...your content...
    <!-- dmux:discovered end -->
- Sections to include (only those you have evidence for): Project Overview,
  Stack, Layout, Commands (build/test/lint/run), Conventions.
- Cite real evidence: "Express routes live under `src/routes/` (5 files
  detected)", not "Express routes typically live under src/routes".
- Do NOT include sections you can't ground in the files you saw.

### .dmux-agents.yml rules

(same rules as the NL planner — see Wave 2B §3.2)

- One fenced ```yaml block, valid against dmux's schema.
- session, worktree_base, main_pane, agents[].
- Every agent needs: name, role, branch, task, model, scope, context,
  depends_on. EVERY agent including plan/review roles needs a unique
  branch.
- model must be one of: opus, sonnet, haiku.

### Starter-team guidance

The user hasn't asked for anything yet — they just adopted the repo. So
your starter team should be a low-stakes "first task" the user can either
approve immediately to dogfood dmux on this project, or use as a template.
Good defaults:
  - A single-agent plan-role team that writes docs/project-tour.md
    summarizing the codebase. Useful for any project.
  - Or, if the repo has obvious gaps (no tests, no CI, missing README),
    a 2-agent plan→build team that addresses one of them.

Project: {project_name}
File tree:
```
{file_tree}
```

README.md: {readme_or_none}

Manifests:
{manifests_or_none}

Existing CLAUDE.md: {existing_claude_md_or_none}

Existing .dmux-agents.yml: {existing_agents_yaml_or_none}

Now emit the two artifacts.
```

---

## Section 4 — Wireframes

### 4.1 Dashboard adopt entry point

```
┌───────────────────────────────────────────────────────────────────────────┐
│  dmux                                                          [+ New Run]│
│                                                              [Adopt repo] │
│ ─────────────────────────────────────────────────────────────────────────│
│  Pending proposals (2)                                                    │
│  ...                                                                      │
│                                                                           │
│  Running                                                                  │
│  ...                                                                      │
└───────────────────────────────────────────────────────────────────────────┘
```

The Adopt button sits next to + New Run, visually secondary. Always present (not gated on "no projects" — re-adopting an existing repo is valid).

### 4.2 Adopt sheet

```
┌─ Step 1 of 1 — Adopt a repo ──────────────────────────────────────┐
│                                                                    │
│  Path on disk                                                      │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ /Users/dani/code/todo-api                                    │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  Must be an existing git repository.                              │
│                                                                    │
│  Project name (optional)                                          │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │ todo-api                                                     │ │
│  └──────────────────────────────────────────────────────────────┘ │
│  Defaults to the directory name.                                  │
│                                                                    │
│  What happens next:                                               │
│  · We register the project                                        │
│  · A discovery agent reads the repo (~30-60s)                     │
│  · We write CLAUDE.md and stage a starter team for your review    │
│                                                                    │
├───────────────────────────────────────────────────────────────────┤
│  [Cancel]                                                 [Adopt] │
└───────────────────────────────────────────────────────────────────┘
```

### 4.3 Adopting progress state (in the sheet)

```
┌─ Adopting todo-api… ──────────────────────────────────────────────┐
│                                                                    │
│  ✓ Registered project                                              │
│  ✓ Read repo (24 files, package.json + README.md detected)         │
│  ⟳ Running discovery agent…                                       │
│  · Writing CLAUDE.md and staging team proposal                    │
│                                                                    │
│  This usually takes 30-60 seconds.                                │
│                                                                    │
└───────────────────────────────────────────────────────────────────┘
```

Progress is rendered from server-sent stage updates (see §6 open question on transport — SSE vs polling).

### 4.4 Proposal review with "Adopted from" banner

The existing proposal review page from PR #38, with one addition above the "Your request" card:

```
┌───────────────────────────────────────────────────────────────────┐
│  ⌂ Adopted from /Users/dani/code/todo-api                         │
│     CLAUDE.md was written/updated with discovered context.        │
│     Review the starter team below.                                │
└───────────────────────────────────────────────────────────────────┘
```

The "Your request" card is hidden when `trigger.type === 'adopt'` (no NL prompt to quote).

---

## Section 5 — Implementation surface

### 5.1 dmux-core additions

Minimal — Wave 2C is mostly server + UI work.

- No new exports from dmux-core. The `createProposal` API ships everything we need.
- Test additions: a few cases asserting that `trigger.type === 'adopt'` round-trips through createProposal / readRun. ~3 tests.

### 5.2 Server additions

In `dmux-ui/server/lib/dmux.js`:

- **`runDiscovery(projectPath, projectName)`** — sibling of `runPlanner`. Builds discovery context (file tree, README, manifests, existing CLAUDE.md, existing .dmux-agents.yml), shells claude, extracts both fenced blocks, validates the YAML with one retry on schema failure, returns `{ claudeMdContent, agentsYaml }`.
- **`writeClaudeMd(projectPath, content)`** — implements §1.2 merge logic. Pure function on a single file.
- **`runAdoption(path, providedName)`** — top-level orchestrator. Validates path, registers project, calls `runDiscovery`, calls `writeClaudeMd`, calls `createProposal`. Returns `{ projectName, proposalId }`.

In `dmux-ui/server/index.js`:

- `POST /api/adopt` route handler — thin wrapper around `runAdoption` with the error mapping from §2.3.

### 5.3 UI additions

In `dmux-ui/src/components/`:

- **`AdoptSheet.jsx`** — new component, single-step sheet. Reuses `Sheet`, `Field` (Input), `Button`. Local state for path, name, submitting, stage. Polls `/api/adopt/progress/:correlationId` if we choose polling for stage updates (see §6).

In `dmux-ui/src/pages/Dashboard.jsx`:

- Add the **"Adopt a repo"** button to the existing top action area. Opens AdoptSheet.

In `dmux-ui/src/pages/RunDetail.jsx`:

- In `ProposalReview`, render an "Adopted from" banner when `run.trigger?.type === 'adopt'`, and hide the "Your request" card in that case.

### 5.4 CLI additions

In `dmux.sh`:

- New `adopt` subcommand: `dmux adopt <path> [--name <name>]`. Implementation is a thin bash wrapper that shells `dmux-core` directly (via the existing `dmux-runs`-style binary, extended with an `adopt` command) or — simpler — shells the running dev server's HTTP API via curl. **Open question §6.4** — decide between these.

If we go with the binary path:
- Extend `dmux-core/bin/runs.js` (or a new `dmux-core/bin/adopt.js`) with an `adopt` command.

---

## Section 6 — Decisions to confirm before implementation

These are the load-bearing choices. Push back on any of them.

1. **Reuse proposal lifecycle for the .dmux-agents.yml output.** Confirmed: yes (see §1.3). The alternative is a separate "draft" mechanism, which would fragment the review UX.

2. **`trigger: { type: 'adopt', adoptedPath: '/Users/.../todo-api' }`** for the proposal. The `adoptedPath` field is for the banner; otherwise it's just provenance. New trigger type is uncontroversial — the existing trigger union (`manual` | `skill` | `nl`) is open.

3. **CLAUDE.md merge marker syntax.** `<!-- dmux:discovered start -->` / `<!-- dmux:discovered end -->` HTML comments. Confirmed: HTML comments render invisibly in markdown viewers and are unambiguous. Alternative would be a fenced "config" block — uglier.

4. **CLI implementation.** Two options:
   - **(a) Bash shells the HTTP API via curl.** Requires the dev server (or a built `dmux ui` instance) to be running. Simpler. Symmetrical with how the UI does it.
   - **(b) New dmux-core binary subcommand.** Doesn't require the server. More code; more places to keep in sync.
   - **Recommended: (a)** for now. The CLI is currently lower-priority than UI-first (per the UI-first principle). If users complain we'll add (b).

5. **Stage progress transport.** The discovery call takes 30-60s. Three options:
   - **(a) Block on the POST and report only end state.** Simplest. UX is a single spinner; no granular feedback.
   - **(b) Poll a `/api/adopt/progress/:correlationId` endpoint every 1s.** Stage labels feel responsive.
   - **(c) SSE on the same correlation id.** Cleanest UX, more server complexity.
   - **Recommended: (b)** — polling is straightforward, matches the WS+polling mix already in use, and we don't have an SSE primitive yet.

6. **Adopt button placement.** Dashboard top-right, next to "+ New Run". Also visible on the Projects grid empty state. The Projects grid's normal state (with projects) does not gain a button — Dashboard is canonical. Push back if you want it on every project's empty state too.

7. **Re-adoption.** If the user clicks Adopt on a path that's already registered: we register-as-noop (return the existing project name) and proceed to run discovery again, producing a new proposal alongside the existing config. The CLAUDE.md merge logic from §1.2 protects user content. Worth confirming this is the right behavior vs. "already adopted — open the project instead."

---

## Section 7 — Open questions (defer to implementation if not blocking)

1. **File-size cap on manifest reads.** `package.json` is small; `Cargo.lock` is huge. Cap manifest reads at 50KB each? Or whitelist filenames?
2. **Path validation strictness.** Do we require the path to be a git repo (i.e. has `.git/`) or any directory? Recommend: require git, since dmux's whole model assumes branches/worktrees.
3. **What if the discovery agent returns an empty/trivial team** (e.g. just a one-line task)? Validate-and-accept, or reject with a retry? Probably accept — trivial isn't wrong.
4. **Concurrency.** Two simultaneous Adopt clicks on the same path? Add a server-side lock per path, or rely on registration-conflict to fail fast? Fail fast is fine for v1.
5. **Worktree base.** What does the starter team's `worktree_base` default to? Probably `/tmp/dmux-worktrees/{project_name}` — match what Wave 2A/2B examples used.
6. **Should we run discovery in a worktree, or against the live working tree?** Discovery is read-only, no risk of touching the user's files. Live tree is fine. (Future read-write discovery refinements may need a worktree.)

---

## Section 8 — What's explicitly NOT in Wave 2C

Reserved for Wave 2D (onboarding experience) per the user's sequencing decision:

- **Agent intro chat** — after discovery, a conversational surface where the discovery agent answers questions about what it found.
- **Recommended-skills surface** — discovery agent suggests which built-in skills to install (graphify, tdd-feature, etc.) and the UI renders an "Install these?" panel.
- **"Name your first agent" wizard step** — Maestro-style first-agent naming flow.
- **Greenfield `dmux init`** — discovery against an empty/near-empty repo with a "what do you want to build?" prompt. Different problem; Wave 2D or later.

Anything in this list that creeps into Wave 2C implementation needs explicit justification or gets bounced.

---

## Implementation order (after this doc is approved)

One PR, three slices in dependency order:

**Slice 1 — Server: discovery + adopt orchestrator.** ~1 day.
- `runDiscovery` helper in `lib/dmux.js` with the §3 prompt.
- `writeClaudeMd` helper with the §1.2 merge logic.
- `runAdoption` orchestrator that wires register → discover → write → propose.
- `POST /api/adopt` route handler with error mapping.
- Optional: `GET /api/adopt/progress/:correlationId` if we go with §6.5 option (b).

**Slice 2 — UI: AdoptSheet + dashboard entry + review banner.** ~1 day.
- `AdoptSheet.jsx` with path/name fields + stage display.
- Dashboard "Adopt a repo" button.
- "Adopted from" banner on the proposal review variant in `RunDetail.jsx`.

**Slice 3 — CLI: `dmux adopt`.** ~0.5 day.
- Bash subcommand that shells curl to the HTTP API (per §6.4 (a)).
- Helpful error messages when the dev server isn't running.

Wave 2C is done when all three land + end-to-end verified against a fresh real repo. Total ~2-3 days of compressed work.

---

*Ready for review. Push back on anything in Section 6 (decisions) before implementation begins.*
