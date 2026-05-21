# dmux — Wave 2B Design Pass

Status: drafting before implementation. Pair-mode review welcome.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-2a.md`.

---

## Where Wave 2A left us

After Wave 2A's 18 slices, dmux has the Maestro-shaped IA running end-to-end:

- Dashboard → Run → Agent Detail (Terminal / Plan / Diff / Violations) is fully wired.
- `dmux-core` owns YAML parsing, Run persistence, scope-violation logic.
- The Run lifecycle enum (`proposed → pending → running → completed/failed → cleaned/abandoned`) is defined, **but `proposed` has no current path that produces it**.
- The New Run spawn sheet exists with a Quick path (skill picker → review → launch). The Smart card is rendered but disabled with "Coming in Wave 2B."
- Skills are static templates — agent blocks copied verbatim into `.dmux-agents.yml`. No parameters, no inputs, no templating.

Wave 2B closes those two gaps:

1. **Parameterized skills** — the Quick path becomes "skill + parameters → personalized config." A `tdd-feature` skill asks for `feature_name`, `files_in_scope`, etc., and substitutes them into the generated config.
2. **NL planner Smart path** — the user describes work in their own words ("add OAuth login with tests and a security review"); a planner agent reads the repo, proposes an agent team, and the user reviews + approves before the run actually launches. This is what makes the `proposed` lifecycle state useful.

---

## Section 1 — Concepts introduced in Wave 2B

Four new ideas land in this wave. Each is small in isolation; their combination is the wave.

### 1.1 Input schemas

A skill's YAML gains an optional `inputs:` block declaring the parameters users fill in when they pick the skill:

```yaml
name: tdd-feature
description: Plan → tests → code → review for a single feature
inputs:
  - name: feature_name
    type: text
    description: Short name for the feature (used in branch names)
    required: true
  - name: files_in_scope
    type: paths
    description: Files the engineer agent may modify
    required: false
  - name: with_security_review
    type: boolean
    description: Add a security-focused review agent
    default: true
agents:
  - name: planner
    role: plan
    task: "Plan the implementation of {{feature_name}}."
    model: sonnet
  - name: engineer
    branch: feature/{{feature_name}}
    task: "Implement {{feature_name}} following the upstream plan. Write tests first."
    scope: {{files_in_scope}}
    depends_on: [planner]
```

Field types supported in v1:

| Type | Renders as | Stored value |
|---|---|---|
| `text` | single-line `Input` | string |
| `textarea` | multi-line `Textarea` | string |
| `select` | `Select` (requires `choices:`) | string |
| `boolean` | `Checkbox` | true / false |
| `paths` | `ListEditor` | string[] |
| `agents` | `ListEditor` with autocomplete from `agents[*].name` of the current draft | string[] |

Each input gains a `default` (optional). `required: true` makes the field mandatory in the form. The schema is small and not extensible to arbitrary validation — that's intentional. Wave 2B's surface is "parameters, not a programming language."

### 1.2 Template syntax

`{{name}}` substitutes the value of the input named `name`. Two distinct evaluation modes based on where the placeholder appears:

- **In a string field** (e.g. `task: "Implement {{feature_name}}."`) — the value is stringified and inserted. Numbers/booleans become their default JS string representation. Lists become a comma-separated string.
- **As the entire YAML value** (e.g. `scope: {{files_in_scope}}`) — the placeholder is replaced by the value's native YAML representation. A `paths` input expands to a YAML list; a `boolean` becomes `true`/`false`; etc.

Conditional rendering (`{% if %}`) is **out of scope**. If a skill author wants "include this agent only when `with_security_review` is true," they fork the skill. Keeps the templating tractable; we can revisit if real skills demand it.

**Reserved placeholder:** `{{project_name}}` — the project the skill is being applied to. Always available, no schema entry needed.

### 1.3 Proposals

A "proposal" is a Run with `status === 'proposed'`. The Wave 2A lifecycle enum already included it; Wave 2B is what produces and resolves it.

Storage: the same `.dmux/runs/{id}/run.json` as a regular run, with these specifics:

- `status: 'proposed'` derived (not stored — derived from `proposed_at` being set and `started_at` being null).
- `config.yaml` holds the draft YAML the planner produced.
- `proposed_at` timestamp.
- `trigger: { type: 'nl', prompt: '...' }` captures what the user typed.
- No `signals/` activity until the proposal is approved.

Approval transitions the run from proposed → pending → running:

1. Write the draft YAML as the project's live `.dmux-agents.yml` (or a versioned copy).
2. Set `started_at` on the run.json (no longer "proposed").
3. Call the existing `agents start` path. The Run record already exists, so the bash side needs a way to **adopt** an existing run rather than create a new one (more on this below).

Discard transitions to `abandoned`:

- Set `abandoned_at`.
- No worktrees were ever created. No cleanup needed beyond marking the record.

Listing: proposals show up on the Dashboard's "Pending proposals" section (the placeholder shipped in Wave 2A) and on each project's history.

### 1.4 The planner agent

A one-shot agent spawned by the server when the user submits a Smart-path request. Conceptually it is a `plan`-role agent — same prompt-injection convention — but with a few differences from the existing in-run plan agents:

- **Spawn site:** server-side subprocess (no tmux session, no worktree). Direct `execFile` of the provider CLI with the prompt piped in via stdin.
- **Input:** the user's NL request + repo metadata (file tree summary, CLAUDE.md if present, `.dmux-agents.yml` if any).
- **Output:** valid `.dmux-agents.yml` (validated by `dmux-core`'s parser before storage). The planner's prompt asks for the YAML in a fenced code block which the server extracts.
- **Storage:** the parsed config goes straight into the new proposed Run record. The user sees the proposal in the UI as if dmux-core itself generated it.
- **Model + provider:** Sonnet by default; user-overridable via a setting later. No bash, no tmux — invisible to the user except as a "Planner thinking..." spinner.

Cost is small per invocation (~one Sonnet prompt, ~5–10s) but real. Worth surfacing the user-paid nature in the Smart-card description.

---

## Section 2 — Parameterized skills (Quick path)

The smaller, more contained half of Wave 2B. Ship first.

### 2.1 dmux-core changes

**New module: `dmux-core/src/skills.js`**

```js
export function parseSkillYaml(yamlText)         // schema-validates a skill.yml
export function applyInputs(skillYaml, values)   // performs templating, returns final agents YAML
```

`parseSkillYaml`:

- Reads the `inputs:` block, validates each entry has the required fields.
- Returns `{ name, description, inputs: [...], agents: [...], rawYaml }`.
- Throws `SkillSchemaError` (new exception type, parallel to `ConfigError`) on validation failures with `field` + `input` context.

`applyInputs`:

- Walks the agents block.
- Substitutes `{{var}}` placeholders per Section 1.2 rules.
- Returns the rendered YAML string.
- Throws if a required input is missing from `values`, or if a placeholder references an unknown name.

Tests: ~15 cases covering each input type, both substitution modes, missing required, unknown placeholder, reserved `{{project_name}}`.

### 2.2 Server changes

`GET /api/skills` already returns the list. Extend each entry to include the inputs schema (when present) so the UI can render the form without a second fetch.

`POST /api/projects/:name/skills/:skill` — currently writes the skill's static YAML to the project. Extend to accept a body:

```json
{
  "inputs": { "feature_name": "oauth", "files_in_scope": ["src/auth/"], "with_security_review": true }
}
```

When `inputs` is present, call `applyInputs` before writing. When absent (old behavior), write the raw template.

### 2.3 UI changes

**`FormFromSchema` primitive** (see Section 4) — renders the form for a given inputs schema + values.

**Spawn sheet step 2 becomes adaptive:**

- Pick a project (unchanged).
- Pick a skill (unchanged — clicking a skill card).
- **If the skill has `inputs:`**, the sheet advances to a new **Step 2.5: Fill inputs** with `FormFromSchema`. Continue button advances to Review.
- **If the skill has no inputs**, advance directly to Review (today's behavior, preserved).

**Step 3 (Review)** previews the rendered YAML when inputs were used, so the user sees what will be written. Existing review screen already shows agent count; we add the rendered preview as a "Show generated YAML" disclosure.

### 2.4 Existing built-in skills

The five Wave 1 built-ins (`code-review`, `docs-gen`, `refactor`, `security-audit`, `test-coverage`) currently have no inputs. They keep working unchanged via the "no inputs → direct advance" path. We add inputs to whichever ones genuinely benefit:

- `code-review` — `branches: agents` (read-only review across specific branches). Or stay parameter-free; defaults are fine.
- `tdd-feature` (new skill we ship as part of Wave 2B) — the canonical parameterized example: `feature_name`, `files_in_scope`, `branch_prefix`.

The new `tdd-feature` skill is the demo + dogfood of the feature.

---

## Section 3 — NL planner (Smart path)

The bigger half. Builds on the parameterized-skills work.

### 3.1 The planner invocation

**Server endpoint:** `POST /api/projects/:name/proposals`

Body:
```json
{ "prompt": "Add OAuth login with tests and a security review" }
```

Server-side flow:

1. Read project metadata: file tree (depth-limited), `CLAUDE.md` if present, current `.dmux-agents.yml` if present (to suggest reusing existing agent names / patterns).
2. Build a system prompt for the planner — see Section 3.2.
3. `execFile('claude', ['--model', 'sonnet', '--print'])` with the prompt on stdin. (Or `gemini --model pro` if configured.)
4. Extract the fenced ```yaml block from the response.
5. Validate via `parseAgentsConfig`. If invalid: capture the error, re-prompt the planner once with the error included ("Your previous YAML was rejected: {error}. Fix and re-emit.").
6. Build a new Run record with `status: 'proposed'`, frozen YAML, `trigger: { type: 'nl', prompt: '...' }`.
7. Respond with `{ proposalId: 'YYYY-MM-DDTHHMMSS-xxx' }`.

Total wait: ~5–15 seconds. UI shows a spinner; on resolve, navigates to the proposal review page.

### 3.2 The planner prompt

A skeleton — refine empirically:

```
You are dmux's planner agent. Your job is to read a project's state and a user's
work request, then propose an agent team as a valid .dmux-agents.yml.

The agent team usually has:
- One plan-role agent (writes a plan markdown that downstream agents consume)
- One or more build-role agents (each on its own branch, with declared `scope`)
- Optionally one review-role agent at the end

Rules:
- Emit exactly one fenced ```yaml code block. No prose outside it.
- Use the dmux-core schema: session, worktree_base, main_pane, agents[]
  with name, role, branch, task, model, scope, context, depends_on.
- Pick models thoughtfully: sonnet for planners and reviewers, opus for builders
  on complex work, haiku only when speed matters more than quality.
- Declare `scope` for every build agent — list the directories or files each
  agent is allowed to modify. Be specific.

Project: {project_name}
Existing .dmux-agents.yml: {existing_config_or_none}
File tree summary: {file_tree}
CLAUDE.md: {claude_md_or_none}

User request:
{user_prompt}

Now emit the .dmux-agents.yml.
```

Important details:

- The file-tree summary is depth-limited (3 levels deep, max 200 entries) — we don't want to send a giant repo's whole tree.
- The planner is told to set `scope:` per agent because scope violations are how Wave 2A flags overreach. We want the planner to be conservative by default.

### 3.3 Proposal storage

Per Section 1.3, a proposal is a Run with status=proposed:

```
.dmux/runs/{id}/run.json
  - status: 'proposed' (derived from proposed_at being set)
  - proposed_at: '2026-05-21T...'
  - started_at: null
  - trigger: { type: 'nl', prompt: 'add OAuth...' }
  - config.yaml: '<the planner's output>'
  - config.agents: [parsed summary]
```

No `signals/` activity. No `plans/` activity. The run dir exists but is mostly inert until approved.

**dmux-core changes:**

- `createProposal(projectPath, { prompt, configYaml, agentsSummary })` — new function, mirrors `createRun` but sets `proposed_at` instead of `started_at`.
- `approveProposal(projectPath, runId, now)` — transitions: sets `started_at`, writes the frozen yaml as the live `.dmux-agents.yml`, returns `{ ok: true }`. Does NOT spawn agents — that's the bash side's job.
- `discardProposal(projectPath, runId, now)` — sets `abandoned_at`.
- `readRun` learns to derive status=`'proposed'` when `proposed_at` is set + `started_at` is null + `abandoned_at` is null.

### 3.4 The bash side: adopting an existing run

Today, `dmux agents start` creates a fresh Run record. For approved proposals, we need to **adopt** an existing one — its id, frozen config, and run dir already exist.

**Approach:** `dmux agents start` accepts an env var `DMUX_ADOPT_RUN_ID`. When set:

- Skip the `start_run` step entirely.
- Use the existing `.dmux/active_run` pointer (write the adopted id there).
- Use the existing run dir's `signals/` and `plans/` for the per-run state.
- The frozen config is already in the run.json; just read the live `.dmux-agents.yml` (which `approveProposal` wrote moments ago).

Server-side approve flow:
1. `dmux-core: approveProposal(...)` → writes `.dmux-agents.yml`, marks the run as no-longer-proposed.
2. `execDmux('agents start', { DMUX_ADOPT_RUN_ID: id })`.
3. Bash spawns agents against the adopted run.

### 3.5 The proposal review page

New route: `/projects/:name/proposals/:proposalId` (also reachable as `/projects/:name/runs/:runId` since they share storage — when status=proposed, the Run Detail page renders the proposal view automatically).

Renders:

- The user's NL prompt at top (quoted, like an email subject).
- The proposed agents as cards (read-only) with: name, role, model, branch, task summary, scope.
- The full proposed `.dmux-agents.yml` as a code block (with copy-to-clipboard).
- **Approve and run** primary button → server call → navigates to the now-active Run Detail.
- **Edit before running** secondary → opens the existing Agent Config Editor pre-filled with the proposed YAML, where the user can tweak then Save & Run normally. (Implementation: write the YAML to `.dmux-agents.yml`, mark proposal as abandoned, redirect to editor.)
- **Discard** danger → ConfirmDialog → abandon the proposal.

If the run.json's status is already approved (not proposed), redirect to the live Run Detail. That handles the case where someone bookmarks a proposal URL after it's been approved.

### 3.6 Dashboard surface

The "Pending proposals" section that Wave 2A stubbed becomes real. Renders proposed runs as RunCards (existing primitive) with a distinct tone (cyan border instead of green) and a "Review →" link instead of "view run →".

---

## Section 4 — `FormFromSchema` primitive

Used by parameterized skills (Section 2) and, in Wave 2C, the Adopt flow. Defining it once and well saves work both places.

### 4.1 API

```jsx
<FormFromSchema
  schema={[
    { name: 'feature_name', type: 'text', description: '...', required: true },
    { name: 'files_in_scope', type: 'paths', description: '...' },
    { name: 'with_tests', type: 'boolean', default: true },
  ]}
  values={values}
  onChange={setValues}
  errors={validationErrors}   // optional: { feature_name: 'required' }
/>
```

### 4.2 Field rendering rules

| Schema type | UI primitive | Notes |
|---|---|---|
| `text` | `Input` | placeholder = description if no separate placeholder |
| `textarea` | `Textarea` | rows: 4 default |
| `select` | `Select` | requires `choices: [{ value, label }]` |
| `boolean` | `Checkbox` | label = description |
| `paths` | `ListEditor` | placeholder = "src/auth/" |
| `agents` | `ListEditor` | suggestions from a `currentAgents` prop |

Each renders with the existing `Field` shell: visible `<label>` from `name` (humanized), helper text from `description`, error text from `errors[name]`, asterisk + `aria-required` when `required`.

### 4.3 Validation

`FormFromSchema` does **not** validate on its own — the parent reports errors via the `errors` prop. The skill-apply server endpoint validates via `applyInputs` and returns `{ field, error }` shape on 422, which the spawn sheet maps into the `errors` prop.

This keeps the primitive simple and lets the server be the source of truth for validation.

---

## Section 5 — Wireframes

ASCII, same convention as `wave-2a.md`. Two new surfaces, two adjustments.

### 5.1 Spawn sheet — Step 2.5 (Fill inputs)

After picking a skill that has inputs:

```
                ┌──────────────────────────────────────┐
                │ New Run                           ✕  │
                │ Step 2.5 of 3 — Fill inputs          │
                ├──────────────────────────────────────┤
                │ Skill: tdd-feature                   │
                │                                      │
                │ Feature name *                        │
                │ [                                  ]  │
                │ Short name; used in branch names.    │
                │                                      │
                │ Files in scope                       │
                │ [ src/auth/                    [×] ] │
                │ [ + Add path                       ] │
                │ Files the engineer agent may modify. │
                │                                      │
                │ ☑ With security review                │
                │ Add a security-focused review agent. │
                │                                      │
                │ [← Back]              [Review →]     │
                └──────────────────────────────────────┘
```

Step indicator displays as "2 of 3" still (the inputs step is conceptually inside step 2). Or we just call it Step 3 of 4 — wireframe shows 2.5 for clarity.

### 5.2 Spawn sheet — Step 3 (Review with inputs)

```
                ┌──────────────────────────────────────┐
                │ New Run                           ✕  │
                │ Step 3 of 3 — Review                 │
                ├──────────────────────────────────────┤
                │ Project:  dmux                       │
                │ Skill:    tdd-feature                │
                │                                      │
                │ Inputs:                              │
                │   feature_name = oauth                │
                │   files_in_scope = src/auth/         │
                │   with_security_review = true         │
                │                                      │
                │ Agents this will create:             │
                │   • planner    plan      sonnet      │
                │   • engineer   build     opus        │
                │   • reviewer   review    sonnet      │
                │                                      │
                │ ▶ Show generated YAML                 │
                │                                      │
                │ ⚠ This will overwrite the existing    │
                │   .dmux-agents.yml.                  │
                │                                      │
                │ [← Back]              [Save & Run]   │
                └──────────────────────────────────────┘
```

### 5.3 Smart-path entry — Step 2 (NL prompt)

When the user picks Smart in step 1:

```
                ┌──────────────────────────────────────┐
                │ New Run                           ✕  │
                │ Step 2 of 3 — Describe the work      │
                ├──────────────────────────────────────┤
                │ Project:  [ dmux                  ▾] │
                │                                      │
                │ What do you want the agents to do?   │
                │ ┌────────────────────────────────────┐│
                │ │ Add OAuth login with tests and a   ││
                │ │ security review.                    ││
                │ │                                    ││
                │ └────────────────────────────────────┘│
                │ A planner will read your project and │
                │ propose an agent team. You review    │
                │ before anything actually runs.       │
                │                                      │
                │ [← Back]              [Plan it →]    │
                └──────────────────────────────────────┘
```

Clicking "Plan it →" submits to the planner endpoint, shows a spinner, and on success closes the sheet and navigates to the proposal review page.

### 5.4 Proposal review page

```
┌─ TopNav ───────────────────────────────────────────────────────────────┐
│  Projects / dmux / Proposal 2026-05-21T14:32                           │
│                                                                        │
│  ◌ proposed · planner used: sonnet · 12s ago                           │
│                                                                        │
│  > "Add OAuth login with tests and a security review."                 │
│                                                                        │
│  ┌─ Proposed agents (4) ─────────────────────────────────────────────┐ │
│  │ planner       plan      sonnet                                     │ │
│  │ Plan the OAuth implementation: provider config, token storage,    │ │
│  │ session middleware.                                                │ │
│  │                                                                    │ │
│  │ engineer      build     opus      branch: feature/oauth-login      │ │
│  │ Implement OAuth following the upstream plan. Write tests first.   │ │
│  │ Scope: src/auth/, src/middleware/auth.ts                          │ │
│  │                                                                    │ │
│  │ ... (other agents)                                                 │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ▶ Show proposed .dmux-agents.yml                                       │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │  [Discard]              [Edit before running]  [Approve and run]  │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

Discard opens a ConfirmDialog. Edit-before-running writes the YAML to live config + navigates to the editor. Approve-and-run hits the approve endpoint.

### 5.5 Dashboard "Pending proposals" section

Same `RunCard[variant=row]` as Recent, but with cyan border + "Review →" CTA. Renders between Running and Recent on the Dashboard when any proposed runs exist.

---

## Section 6 — Decisions to confirm

These are the calls I'm committing to that may want pushback before implementation:

1. **Template syntax is `{{var}}` substitution only.** No conditionals, no loops, no expressions. If skill authors need more, they fork the skill. Easy to extend later if real pain shows up.

2. **`{{var}}` evaluation mode is position-based:** string fields stringify; full-YAML-value placeholders expand to native YAML. No explicit `{{var | string}}` filters.

3. **Reserved placeholders: only `{{project_name}}`.** No `{{timestamp}}`, `{{git_branch}}`, etc. Easy to add later.

4. **`SkillSchemaError` is its own exception class, parallel to `ConfigError`.** Avoids overloading ConfigError with skill-template concerns; lets the UI render different surfaces for each.

5. **Proposals are Runs with status=proposed.** Same storage, same `.dmux/runs/{id}/` path. NOT a separate `.dmux/proposals/` directory. The Run lifecycle enum already supported it; this just produces them.

6. **The planner is a server-side subprocess, not a tmux pane.** Streaming the planner's output to the UI is deferred; v1 shows a spinner.

7. **The planner gets a depth-limited file tree summary.** 3 levels, 200 entries max, plus CLAUDE.md + current `.dmux-agents.yml`. Skips `node_modules/`, `.git/`, `dist/`, etc.

8. **Approval writes the proposed YAML to the live `.dmux-agents.yml`.** This is destructive of any existing config — same as the existing skill apply flow. Section 6 vocabulary already prepared users for "overwrite the existing config" copy.

9. **`agents start` learns `DMUX_ADOPT_RUN_ID` env** to adopt an existing run instead of creating a new one. Small bash change.

10. **`FormFromSchema` does not validate.** Server validates via `applyInputs`; UI just renders + reports errors passed from the parent.

11. **The new `tdd-feature` built-in skill is the dogfood example** — ships with Wave 2B as the parameterized-skill demo.

---

## Open questions (defer to implementation if not blocking)

- **Planner provider override:** should the user be able to pick claude/gemini for the planner, or hard-code claude as the default? Probably default to claude with a settings override in a later wave.
- **Planner cost transparency:** should the UI show estimated cost / token count? Defer — we don't have a token-counting layer.
- **Retry on planner failure:** v1 retries once if YAML doesn't parse, with the error fed back. After one retry, surface the error and let the user try a different prompt. Anything more elaborate (multi-turn refinement) is later.
- **Editing the proposal in-place:** instead of "edit before running" routing to the editor, could we render an inline edit panel on the proposal page? Probably yes, but more UI work. v1 routes to the existing editor; v2 could embed.
- **Skill discovery for the spawn sheet:** the current skill list comes from the bundled set + ~/.config/dmux/skills/. We don't have a way to "publish" a skill. Out of scope for 2B.

---

## Implementation order (after this doc is approved)

Three PRs roughly:

**PR 1 — Parameterized skills foundation (Quick path enhancement).** ~2–3 days.
- dmux-core: `parseSkillYaml`, `applyInputs`, `SkillSchemaError`, tests.
- `FormFromSchema` primitive.
- Server: extend `/api/skills` payload + `/api/projects/:name/skills/:skill` body to accept inputs.
- Spawn sheet: insert the Fill-inputs step when a skill has `inputs:`.
- Ship `tdd-feature` as the demo built-in skill.

**PR 2 — Proposal lifecycle in dmux-core + bash.** ~1–2 days.
- dmux-core: `createProposal`, `approveProposal`, `discardProposal`. `readRun` derives proposed status.
- bash: `DMUX_ADOPT_RUN_ID` env handling in `agents_start`.
- Dashboard: real "Pending proposals" section using the existing RunCard.
- Project Detail history: show proposed status with distinct tone.

**PR 3 — NL planner Smart path.** ~2–3 days.
- Server: `POST /api/projects/:name/proposals` — the planner invocation.
- Server: `POST /api/projects/:name/proposals/:id/approve` and `.../discard`.
- Spawn sheet: Smart card becomes enabled; step 2 is the NL prompt; submit creates a proposal and navigates to review.
- New page: `/projects/:name/proposals/:id` (or Run Detail when status=proposed).
- Run Detail page handles the proposed-status variant.

Wave 2B is done when all three land. Total ~5–8 days of compressed work.

---

*Ready for review. Push back on anything in Section 6 (decisions) before implementation begins.*
