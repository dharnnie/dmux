# dmux — Wave 2A Design Pass

Living document for the design pass before Wave 2A implementation.
Audience: dmux maintainers (currently @danielosineye + Claude).
Status: complete v1 — pending review before implementation. Consolidated for internal consistency (see Consolidation notes at end).

---

## Section 1 — Wave 1 UI audit

A page-by-page read of what shipped in `wave1-ui-skills` (commit `8206b36`), based on the actual source under `dmux-ui/src/`. The goal is to identify what holds up, what doesn't, and where Wave 2 lands.

### Cross-cutting observations

These apply to every surface and are worth fixing as a baseline before page-level work.

- **Dark-only theme.** `theme.css` defines a single black palette (`#000` / `#0a0a0a` / `#141414`) with four accents (pink, cyan, green, orange). No light mode, no system preference detection. For public-ready, this is a reach issue — many users still prefer or require light themes. Decision deferred but should be flagged.
- **`outline: none` applied globally to all buttons, inputs, textareas, selects** (`theme.css:61, 66`). This kills the default focus indicator with no replacement defined. **Concrete a11y regression** — keyboard users currently cannot see what's focused. First thing to fix in Section 5.
- **No loading skeletons.** Pages show plain "Loading..." text (`ProjectDetail.jsx:96`, `Skills.jsx:58`). Acceptable for v0; should evolve to skeletons for perceived performance on public-ready.
- **Native `confirm()` dialogs.** `ProjectDetail.jsx:76` uses `window.confirm()` for project deletion. Breaks visual consistency with the in-app toast/modal system, can't be styled, looks unpolished.
- **No real `<dialog>` element for the Add Project modal** (`ProjectsGrid.jsx:103–144`). Custom overlay div with `onClick` to dismiss. No ESC handling, no focus trap, no `aria-modal`. Same a11y red flag.
- **Placeholders as the only hints.** Most inputs rely on `placeholder` text instead of helper text below the field (e.g., `AgentForm.jsx:147` "auth", `:171` "feature/auth"). Placeholders disappear on focus and have lower contrast. For form-heavy surfaces like the agent editor, this consistently hides what the field actually wants.
- **No inline validation.** Required-ness, format constraints, and errors only surface on submit (when they surface at all). The Add Project modal returns a single string error to `setError`; the Agent config form returns nothing.
- **The CLI is taught everywhere.** Empty state copy in Projects (`"dmux -a myproject ~/code/myproject"`) and the Skills page footer (`"dmux skills list ..."`) actively coach users into the terminal. This contradicts the UI-first principle decided 2026-05-19 — the UI should be self-sufficient, not a shopfront for the CLI.

### Page-by-page

#### Navbar (`Navbar.jsx`)

- Two links: Projects, Skills. No active-route styling visible in JSX.
- No breadcrumbs anywhere — once you're three levels deep (Projects → Project → Agent Session) the only way back is the small `← name` link.
- The branding (`d|mux`) is fine. Considered: does it need a primary CTA in the navbar (e.g., "+ New Project")? Probably yes for product-track.

#### Projects grid (`ProjectsGrid.jsx`)

What works:
- Clean grid layout, server-side sorting (running → configured → alphabetical) is implemented client-side at `:34–38`. Good default.
- Add Project modal is functional, with `autoFocus` on the name field and Enter-to-submit. Decent ergonomics.

What doesn't:
- **Search visibility is conditional** (`:71` `projects.length > 3`). Confusing — present at 4 projects, absent at 3. Should always be present or never.
- **No folder picker.** Users type the path. On a desktop app this would be a `<input type="file" webkitdirectory>` or a folder dialog via Electron/Tauri/native bridge. For a browser-based UI we're at least limited to a typed path — but we can do better with autocomplete from `~/` or a "recent paths" list.
- **No "scan for repos" / adopt flow.** Adding a project requires you to already know its path. Wave 2C addresses this directly.
- **Empty state pushes the CLI** (`:99`). Should show a primary "Add Project" button and an "Adopt an existing repo" secondary action.

#### Project card (`ProjectCard.jsx`)

- Information-thin: name, path, two badges (`agents`, `running`). Eighteen lines of JSX for what is the primary entry point into all per-project work.
- **Missing:** last-touched timestamp, current branch, agent count if configured, recent activity hint, secondary actions (start, stop) without entering the detail page.
- Whole card is a `Link`. Reasonable for primary navigation but means no inline secondary actions.

#### Project detail (`ProjectDetail.jsx`)

The most overloaded page. Six stacked cards with equal visual weight: Quick Launch → Agents → Git → Status → Terminals → Danger Zone.

Specific issues:

- **Quick Launch is the first card** (`:111–141`). This is the *old* tmux pane-spawning feature (e.g. "3 panes, 1 of them Claude"). It's the least relevant thing to an agents-first product. Top placement implies primacy it doesn't have.
- **Agents card buries the primary action.** Four buttons in a flat row (`:147–169`): Edit Config, Start Agents, Use Skill (a dropdown trigger), Cleanup. All equal weight. There is no clear "what should I click first?". Cleanup sits adjacent to Start which invites mistakes.
- **`SkillPicker` dropdown is inside the same row.** Easy to miss. Skills are arguably the most important Wave 2 surface — they deserve dedicated real estate, not a dropdown among siblings.
- **No project summary.** A bar at top showing: current branch, last commit, # configured agents, last session result — would set context before the user hunts through cards.
- **Danger Zone is just another card** (`:182–190`). Visually identical to Git Panel. Real "danger zone" patterns use color, separation, or a settings sub-page.
- **No way to edit `.dmux-agents.yml` while agents are running.** `AgentSession.jsx:277` switches the page to status-only when `isRunning`. The "why" isn't explained.
- **No view of past sessions.** Once you `cleanup`, the history is gone.

#### Agent session — config editor (`AgentSession.jsx` + `AgentForm.jsx`)

This is the most consequential page for Wave 2A and the one with the most structural issues.

- **Two-pane layout: form on left, YAML preview on right** (`:288–303`). YAML preview is treated as a co-equal artifact. That's developer-comfortable but it commits the UI to "you're editing YAML by hand, with a form helper" rather than "you're configuring agents, with YAML available if you want it." UI-first principle says flip this.
- **A hand-written YAML parser lives in the React app** (`:88–179`, ~90 lines). It is **separate from the bash parser in `dmux.sh:392–694`**. Two parsers, one config format, no shared source of truth. Concrete bug surface — they can and will diverge.
  - This is the most load-bearing argument for the bash→Node extraction. After extraction, both bash and the UI consume the same parser.
- **Comma-separated lists in single-line text inputs** for `depends_on` (`:189`), `scope` (`:198`), and `context` (`:209`). Paths in a flat string. No autocomplete from real filesystem, no validation that the path exists, no per-entry remove. A list of paths should be a list editor with add/remove and (ideally) a file/folder picker.
- **`on_complete` checkboxes appear twice** — once globally (`:91–121`) and once per agent (`:217–250`). Visually identical, semantically different (global is default, per-agent overrides). No indicator that the per-agent set inherits from global. Likely source of confusion.
- **Role select has only `build` / `review`** (`:154–161`). Wave 2A adds `plan`. The UI is hardwired in two places (form options here, conditional branch field below) — refactor target.
- **No model selector.** Wave 2A adds `model:` per agent. Currently nowhere.
- **`depends_on` is a text field, not a graph.** For two agents this is fine. For five with cross-dependencies, you cannot see the order. Wave 2A's DAG view replaces this.
- **Agent cards in the form are not collapsible.** Five agents = five fully-expanded forms on one page. Should be expand/collapse with a summary line (name, role, branch, deps).
- **No drag-to-reorder.** Order in `.dmux-agents.yml` matters for readability if not for execution; users have no way to reorder beyond delete + re-add.
- **No "duplicate agent" action.** Common workflow: build agent A, then create B identical to A but for a different feature.
- **Save vs Save & Start.** Both at the bottom (`:291–298`). Outline-styled Save, pink-filled Save & Start. Reasonable hierarchy. But there's no "Save as draft / discard changes" — once you edit, the form is the source of truth until you save.

#### Skills (`Skills.jsx`)

What works:
- Clean Installed / Available split (`:75–138`). Good IA.
- Tags and provider visible per card.

What doesn't:
- **Skills page is a dead-end.** From here you can install/remove, but to actually *use* a skill you must navigate to a project and open the SkillPicker. Should support "Run this skill on [project picker]" inline.
- **Skills are static templates** — no parameterization yet. Wave 2B adds `inputs:`. The UI must grow form rendering off skill schemas.
- **No "what does this skill actually do?" preview.** A skill description is one line. The user can't see the agent shape (build vs review, deps, prompts) before installing or running. Open this on click.
- **No custom skills authoring path.** "Create new skill from this project's config" doesn't exist. Wave 2B's `dmux skills new` should have a UI equivalent.
- **No source provenance.** Built-in skills and installed skills look identical; only the "Available" / "Installed" section header distinguishes them. Where the skill came from (built-in / installed / custom) should be on the card.
- **CLI hint footer** (`:147–152`) — same reach issue as elsewhere.

#### Status table (`StatusTable.jsx`)

- Decent baseline. Color-coded badges, refresh button, WebSocket connection dot.
- **No per-row affordance.** Click an agent → nothing happens. Should drill into the agent's terminal/log/diff.
- **No duration or timestamps.** "running" doesn't tell you whether it's been running 30 seconds or 30 minutes.
- **No actions per row.** Can't stop a single agent, can't requeue, can't view its plan.
- **No grouping by dependency layer.** When agents have `depends_on`, the table renders flat — you can't see "these three are waiting on this one."

#### Skill picker dropdown (`SkillPicker.jsx`)

- Functional but spartan. Two buttons per skill: "Generate" (writes config but doesn't start) and "Run" (writes and starts). The labels don't convey the destructive aspect — both **overwrite** the project's `.dmux-agents.yml` with no confirmation or diff preview.
- **No preview of the generated config before running.** Especially dangerous given Wave 2B parameterizes skills with user inputs.

### What's missing entirely (for Wave 2)

Concepts that have no place in the current UI but Wave 2 introduces:

| Concept | Wave | Where in Wave 1 UI? |
|---|---|---|
| `model:` per agent | 2A | Nowhere |
| `plan` role | 2A | Nowhere — role select is `build`/`review` only |
| Plan output files (`.dmux/plans/`) | 2A | Nowhere — no view of agent outputs beyond terminal |
| Scope violation warnings | 2A | Nowhere — `scope` is just a text field |
| Agent DAG view | 2A | Nowhere — `depends_on` is a text field |
| Parameterized skill inputs | 2B | Nowhere — skills are static cards |
| Skill picker with parameter form | 2B | Dropdown with no inputs |
| NL planner request → proposal | 2B | Nowhere — no place to type a free-form task |
| Proposal review/approve UI | 2B | Nowhere |
| Adopt-repo wizard | 2C | Nowhere — Add Project is just name + path |
| Generated CLAUDE.md preview | 2C | Nowhere |
| Session history / past runs | (cross) | Nowhere — runs vanish after cleanup |
| Activity dashboard across projects | (cross) | Nowhere |

### Summary — what the audit implies for Wave 2A's design

Five things to fix before Wave 2A's features get bolted on:

1. **Restore focus visibility.** Remove `outline: none` global; define an accessible focus ring as a primitive. Non-negotiable for keyboard users.
2. **Demote the YAML preview from co-equal to "show source."** The form is the surface; YAML is a debug view. This requires the bash→Node extraction to give the form a real parser to lean on.
3. **Reframe the project detail page.** Lead with a project summary and a single primary action ("Configure agents" or "Run skill"). Move Quick Launch and Cleanup out of the primary surface.
4. **Make the agent editor list-aware.** `depends_on`, `scope`, `context` become real list editors. Roles, models, and dependencies need their own components because Wave 2A adds to all three.
5. **Stop teaching the CLI in empty states.** Replace with affordances that complete the task in the UI.

These five are the platform on which Wave 2A's new features (`model`, `plan` role, scope checks, DAG view) get built. Without them, every new feature compounds the same problems.

---

## Section 2 — Information architecture

The shape of the app: what are the top-level surfaces, where new Wave 2 concepts live, and how a user moves between them.

### The mental-model shift

Wave 1's IA is **project-centric**: the user navigates to a project and does things to it. Spawning agents is hidden inside the project detail page; it's a verb attached to a place.

Wave 2 reframes this. The user's primary job is *running agents on work*, not *managing projects*. Projects are still real (you need somewhere to anchor a worktree, a CLAUDE.md, a config) but they become **a noun in service of the verb**, not the front door.

Concretely:

- The default landing surface should show **what's happening now**, not a list of folders.
- The single most common action — "spawn an agent team on a task" — should be invocable from anywhere with one click, not buried two pages deep.
- The user should be able to **trace history**: "what did that OAuth team do last Tuesday?" Today, when you `cleanup`, the run is gone.

This is the Maestro-shaped shift, and it requires one new first-class noun.

### Introducing the "Run"

Today dmux has no word for *a specific invocation of agents*. There's a project, a config file, and a binary "agents are running / agents are not running" state. That model breaks the moment we want to:

- Show history of past runs.
- Reference the plan that was generated for *this* run.
- Show which scope violations happened on *this* run.
- Distinguish "the config I'm editing" from "the agents currently executing."

**Define:** a **Run** is one execution of one or more agents in a project. It has:

- An ID (timestamp-based or short UUID).
- A project it belongs to.
- A trigger: skill picker, NL planner proposal, or manual config edit.
- A frozen copy of the `.dmux-agents.yml` it executed against (so config edits during/after the run don't rewrite history).
- A lifecycle: `proposed` → `pending` → `running` → `completed` / `failed` → `cleaned`.
- Children: agents, each with their own outputs (plan files, terminal logs, diffs, scope-violation reports).

Runs are persisted under `.dmux/runs/{id}/` in the project. Cleanup removes worktrees but **preserves the run record**. Users can browse, re-open, and re-run history.

This is the load-bearing new concept of Wave 2 IA. Everything else hangs off it.

### Top-level surfaces

Five top-level routes, in priority order:

| Route | Purpose | Primary content |
|---|---|---|
| `/` | **Dashboard** | Active runs across all projects; recent runs; pending proposals; quick spawn |
| `/projects` | **Projects** | List, search, add, adopt |
| `/projects/:name` | **Project detail** | Summary, runs history, config, settings |
| `/skills` | **Skills library** | Browse, install, author, run-from-here |
| `/settings` | **Settings** | Theme, default model, providers, paths, telemetry opt-in |

Deeper routes (not top-level but reachable):

| Route | Purpose |
|---|---|
| `/projects/:name/config` | Agent config editor (was `/projects/:name/agents` in Wave 1) |
| `/projects/:name/runs/:runId` | A specific run: agents, status, plans, terminals |
| `/projects/:name/runs/:runId/agents/:agentName` | Drill into one agent: terminal, plan, diff, scope violations |
| `/projects/:name/proposals/:id` | NL planner output awaiting approval (Wave 2B) |
| `/skills/:name` | Skill detail — what it creates, parameters, prompts |
| `/adopt` | Adopt-an-existing-repo wizard (Wave 2C) |

URL principles:
- Resource-shaped, not action-shaped (`/projects/x/runs/123`, not `/run-page?project=x`).
- Stable across sessions — users can bookmark a specific run.
- The route hierarchy mirrors the filesystem on disk (`.dmux/runs/{id}/agents/{name}/`), which makes the system explorable from both directions.

### Navigation pattern

**Top nav, persistent on every page:**

```
[dmux]   Dashboard   Projects   Skills          (+) New Run     ⚙
```

- Logo links to `/`.
- Three primary destinations. Active state visually distinct (Wave 1 has no active state — fix in Section 3).
- **`+ New Run` is a prominent button**, not a nav link. It opens the spawn flow as a sheet/modal over the current page, so the user doesn't lose context. This is the single most important affordance in the app.
- Settings as an icon, right-aligned. Cold-path destination.

**Breadcrumbs, on deep pages:**

```
Projects / dmux / Run 2026-05-19 14:32 / agent: build-oauth
```

Breadcrumbs are clickable. They give shape to the navigation hierarchy without forcing back-button reliance.

**No side rail.** dmux's depth is medium; a top nav plus breadcrumbs is sufficient and lighter visually. Reconsider if we add 8+ top-level destinations (we shouldn't).

### The spawn flow is an *action*, not a *page*

A core IA decision: **`+ New Run` opens a sheet/modal**, not a separate page. Reasons:

- The user is usually *somewhere* when they decide to spawn — looking at a project, browsing skills, reviewing a past run. Yanking them to a new page loses that context.
- The flow has two paths (quick / smart) that should share a common shell.
- It needs to be invocable from the top nav, project detail, skill detail, and dashboard — all without separate route plumbing.

The sheet steps:

1. **Path choice.** Quick (skill picker) or Smart (describe in natural language). One question, two big buttons.
2. **Quick path:** pick skill → pick project (defaults to current if you're on a project page) → fill skill `inputs:` form → review generated `.dmux-agents.yml` → Confirm and Start.
3. **Smart path:** pick project → describe the work → spawn a planner agent → wait for proposal → review/edit → Confirm and Start.

Either path produces a Run record. The sheet closes; the user lands on `/projects/:name/runs/:runId`.

### Where Wave 2 concepts live (filling in the Section 1 table)

| Concept | Wave | Home in the new IA |
|---|---|---|
| `model:` per agent | 2A | Field in `/projects/:name/config` agent editor; visible on agent cards in run views |
| `plan` role | 2A | Role option in agent editor; plan output visible at `/projects/:name/runs/:runId/agents/:agentName` (Plan tab) |
| Plan output files | 2A | Rendered in Plan tab of agent detail; also surfaced as context preview on downstream agents in the editor |
| Scope violation warnings | 2A | Surfaced on run page (summary banner) and agent detail (Violations tab); also a post-run badge on the run card |
| Agent DAG view | 2A | In agent editor (visualizes `depends_on` while editing); compact version in run view header |
| Parameterized skill inputs | 2B | Form rendered in step 2 of spawn sheet (Quick path); visible on `/skills/:name` |
| Skill picker with parameter form | 2B | Step 2 of spawn sheet Quick path |
| NL planner request | 2B | Step 2 of spawn sheet Smart path |
| Proposal review/approve | 2B | `/projects/:name/proposals/:id` (or as a modal continuation of the spawn sheet) |
| Adopt-repo wizard | 2C | `/adopt`, reachable from `/projects` empty state and Add Project flow |
| Generated CLAUDE.md preview | 2C | Step in adopt wizard; also surfaceable in project detail "Project context" section |
| Session history / past runs | (cross-cutting) | `/projects/:name` runs list; `/` dashboard recent runs |
| Activity across projects | (cross-cutting) | `/` dashboard |

Every concept now has a home. None of them needs a new top-level destination.

### What this implies for project detail

The current Project Detail page (six equal cards) is cleaned up significantly:

**New structure for `/projects/:name`:**

1. **Project summary header** — name, path, current branch, last commit, agent count if configured. Single line / band, no card.
2. **Primary action zone** — one `New Run` button (opens spawn sheet pre-scoped to this project), and a smaller "Edit config" link. Skill picker is *not* here — it's accessed through New Run.
3. **Runs history list** — most recent first. Each row: timestamp, trigger (skill name or "NL planner" or "manual"), agents, status, link to run detail. This replaces the live status table for non-running projects.
4. **Active run inline panel** — if a run is currently in-flight, show its status table + a "View run" link. Otherwise hidden.
5. **Context section** — git panel + CLAUDE.md preview (Wave 2C will use this).
6. **Settings** — collapsed by default. Inside: rename, remove, Quick Launch (the legacy tmux-spawning feature, demoted from primary).

Quick Launch survives as a feature but is no longer the first thing users see.

### What about runs that never produced a config?

Edge case worth naming: in the Smart path, a user types a request but the planner agent fails or is cancelled. The proposal never produced a runnable config.

Such a "stub run" should still be persisted with `status: abandoned` and the original user request. This builds a habit: every spawn attempt is recorded, even unsuccessful ones. Helps debug "why didn't my idea become agents?" later.

### What's deliberately not in this IA

- **Multi-tenancy / team views.** Phase 3 territory.
- **Cross-project agent pools.** Agents are scoped to a project's worktrees.
- **A "tasks" or "tickets" concept separate from runs.** A run is the smallest unit; if users need finer-grained tracking, they have GitHub issues, Linear, etc.
- **Notifications inbox.** Toasts and badges on the dashboard are enough for now. Wave 2A may add a small badge for completed runs; a real inbox is beyond scope.

### Decisions to confirm before Section 3

These are the IA calls I'm committing to that may want pushback:

1. **"Run" as a first-class noun, persisted under `.dmux/runs/{id}/`.** Big enough commitment to flag explicitly.
2. **Dashboard as the default landing page, not Projects.** Reverses current behavior.
3. **Spawn is a modal/sheet, not a page.** Cross-cutting affordance.
4. **No side rail.** Top nav + breadcrumbs only.
5. **Project Detail is restructured around runs history, not config-by-default.** Config moves to a sub-route.

If any of these are wrong, Section 3 (components) gets the wrong primitives.

---

## Section 3 — Component primitives

A small, named inventory of the patterns Wave 2 leans on. Not a full design system — a *contract* for what exists, how it behaves, and where it gets used. Each primitive listed below either already exists (and gets refined) or ships with the Wave that first needs it.

### Tokens (not components, but they govern every component)

Before naming components, fix the design tokens. They live in `dmux-ui/src/theme.css` today.

- **Color tokens:** the existing palette stays (`--bg-primary` through `--accent-orange`). Two additions for Wave 2A:
  - `--accent-red: #ff5555` (or similar) — currently `StatusTable.module.css` uses an unscoped `red` style class; promote to a token. Used for `failed`, `blocked`, and destructive actions.
  - `--bg-card-active: #1f1f1f` (or similar) — for the selected/active state of cards. Currently we have hover (`--bg-card-hover`) but no active.
- **Focus token:** `--focus-ring: 0 0 0 2px var(--accent-cyan)` (or equivalent). Section 5 ratifies the exact value. This is the single most important token to add — it's the fix for the global `outline: none` problem.
- **Radius, font, spacing:** keep existing (`--radius-sm/md/lg`, `--font-sans`, `--font-mono`). No reason to disrupt.
- **Spacing scale:** introduce a 6-step scale (`--space-1: 4px`, `--space-2: 8px`, `--space-3: 12px`, `--space-4: 16px`, `--space-5: 24px`, `--space-6: 32px`) as the rule of thumb for padding/gap. Current CSS uses ad-hoc px values; standardizing matters more for Wave 2 since we'll have ~3x the components.

### Tier 1 — Foundation primitives

Used everywhere. Defined once. No exceptions.

#### `Button`
The single button primitive. Replaces ad-hoc button styles in `ProjectsGrid.module.css`, `ProjectDetail.module.css`, `AgentSession.module.css`, `Skills.module.css` (each currently rolls its own).
- **Variants:** `primary` (pink-filled, the one most-important action per surface), `secondary` (outlined), `danger` (red-outlined, requires confirmation pattern), `ghost` (no chrome, for tertiary actions).
- **Sizes:** `md` (default), `sm` (table rows, tight contexts).
- **States:** default, hover, focus (visible ring), active (pressed), disabled, loading (spinner replaces label, button width preserved).
- **Notes:** never relies on color alone for state (a11y); loading state announced via `aria-busy`.

#### `Input`, `Textarea`, `Select`
Three siblings sharing a label+helper+error contract:
- **Slots:** label (always visible above; placeholder is *not* a label substitute — fix for the Section 1 observation), optional helper text below, error text replaces helper when invalid.
- **States:** default, hover, focus, disabled, error, readonly.
- **`required` indicator** rendered explicitly (asterisk + `aria-required`), not implied.
- Replaces the bare inputs in `AgentForm`, `ProjectsGrid` Add modal, etc.

#### `Checkbox`, `Radio`
Standard form controls. Same focus/disabled/error treatment as Input. Group container handles `role="radiogroup"` semantics.

#### `Badge`
Used for status, tags, and counts.
- **Color variants:** maps to color tokens — `green`, `cyan`, `orange`, `red`, `pink`, `muted`. Variant is set by *state semantic*, not raw color (`<Badge tone="failed">` not `<Badge color="red">`).
- **Size variants:** `md`, `sm`.
- Replaces `StatusTable.module.css` `badge_green` etc. and `ProjectCard.module.css` badges.
- **Status map** centralized (aligned with Section 6 vocabulary): `running → green`, `completed → green`, `failed → red`, `blocked → red`, `waiting → orange`, `idle → muted`, `unknown → muted`, plus new states for Wave 2: `proposed → cyan`, `pending → muted`, `cleaned → muted`, `abandoned → muted`. This map lives in one place (today it's duplicated between `StatusTable.jsx:3` and CSS classes). Note: "muted" here is a Badge tone (a pill with low-emphasis fill), not the forbidden `--text-muted` token from Section 5 — Badge text uses `--text-secondary` or `--text-primary` per the contrast audit.

#### `Card`
The base container for project cards, run cards, skill cards, agent cards, settings sections.
- **Slots:** header (optional), body, footer (optional).
- **Variants:** `default`, `linked` (whole card is a link, gets hover/active styling — like current ProjectCard), `interactive` (focusable, keyboard-actionable as a button — for Wave 2's run cards on the dashboard).
- **States:** default, hover, focus, active (selected), disabled.
- **Notes:** a linked Card uses a real `<a>` wrapping the content (current pattern is correct). An interactive Card uses a `<button>` or `<div role="button" tabIndex="0">` with proper keyboard handling.

#### `Toast`
Already exists in `Toasts.jsx`. Keep. Refinements:
- Variants: `info`, `success`, `error`, `warning`. Currently has `info`/`success`/`error`; add `warning` for scope violations.
- Dismissable + auto-dismiss timer + ARIA live region for screen readers (Section 5 confirms exact attributes).

#### `EmptyState` (pattern)
Not a strict component — a layout convention. Three slots: illustration/icon, headline, primary action, optional secondary action.
- Replaces all the ad-hoc empty-state divs in `ProjectsGrid`, `Skills`, etc.
- Critical: empty states **must not teach the CLI**. Action is always an in-UI affordance.

#### `Skeleton` (pattern)
Replaces "Loading..." text. Skeleton blocks shaped like the content they'll be replaced with. Lives in cards, tables, and the agent drill-in view.

### Tier 2 — Containers

Used by spawn flow, adopt wizard, drill-in views, settings.

#### `Sheet`
The modal/drawer shell. Replaces the hand-rolled overlay in `ProjectsGrid.jsx:103–144`.
- **Variants:** `dialog` (centered, for short forms — like Add Project), `sheet` (slides from right or bottom, for longer flows like the spawn flow).
- **Behaviors:** focus trap, ESC to close, click-outside to close (optional per usage), `aria-modal="true"`, scroll lock on body, opens-to-focus rule (first focusable input gets focus, or the close button if none).
- **Slots:** title (required), close button (required), body, footer (typically Cancel + Primary).

#### `Wizard`
Multi-step navigation *inside* a Sheet. Used by spawn flow (Smart path) and Adopt-repo flow.
- Steps with title, body, footer (Back / Next / Finish).
- Progress indicator (dots or numbered steps).
- Step state preserved if user goes Back, so they don't refill forms.
- Final step is always a review/confirm before destructive action.

#### `Tabs`
Used for the agent drill-in (Terminal | Plan | Diff | Violations) and possibly the spawn-flow path chooser.
- Horizontal tabs by default; vertical variant for very long content.
- Keyboard nav: Left/Right between tabs, Home/End to first/last.
- `role="tablist"` / `role="tab"` / `role="tabpanel"`.

#### `Disclosure` / `Collapsible`
Used for collapsible agent cards in the editor, project settings section, and the future "advanced options" patterns.
- Header is a button; content is `aria-controlled` panel.
- Open/close state animated subtly (200ms).
- Multiple disclosures can be open simultaneously (Accordion behavior is a separate, more constrained variant — not building it unless we need it).

### Tier 3 — Navigation

#### `TopNav`
Refines `Navbar.jsx`. Adds:
- Active route styling (current page distinguishable).
- Primary action button (`+ New Run`) right-of-center.
- Settings icon, right-aligned.
- Responsive collapse to a hamburger below a breakpoint (responsive layouts deferred entirely from Wave 2A — see §4.10 out-of-scope).

#### `Breadcrumbs`
New. Used on every page deeper than top-level.
- Each crumb is a link except the current page.
- Truncates middle crumbs with ellipsis at narrow widths.
- `aria-label="Breadcrumb"`, `<ol>` with `aria-current="page"` on the last item.

### Tier 4 — dmux composites

Domain-specific. Built on Tier 1–3 primitives. Each tied to the Wave that first needs it.

#### `RunCard` (Wave 2A)
The dashboard's primary repeating unit.
- **Built from:** `Card[variant=linked]` + `Badge` (status) + small inline meta (project, trigger, agent count, duration).
- **Slots:** title (run timestamp or label), project breadcrumb, trigger description ("Skill: tdd-feature" or "NL: 'add OAuth login'"), agent summary chips, status badge.
- **States:** running (subtle animated indicator), completed, failed, proposed (pending approval — visually distinct).

#### `AgentCard` (Wave 2A)
Used in the editor (`AgentForm` per-agent block) and in run views (read-only display).
- **Built from:** `Card` + `Disclosure` (in the editor; expanded by default for new agents, collapsed for existing) + `Badge` (role, status if in run view).
- **Editor slots:** name, role (pill — build/review/plan), model selector, branch (hidden if review/plan), task textarea, depends_on (`ListEditor`), scope (`ListEditor`), context (`ListEditor`), on_complete checkboxes, auto_accept toggle.
- **Run-view slots:** name, role badge, status badge, branch link, duration, link to drill-in.

#### `ProjectSummaryHeader` (Wave 2A)
Replaces the current `ProjectDetail` header block.
- Single horizontal band, not a card.
- Project name, path, current branch, last commit short SHA + message, configured agent count.
- Primary action `New Run` button (opens spawn sheet pre-scoped to this project).
- Secondary link `Edit config`.

#### `ListEditor` (Wave 2A)
For `depends_on`, `scope`, `context`. Replaces comma-separated text inputs.
- Each entry is a row: `Input` + remove button.
- "+ Add" button below.
- Optional autocomplete source (for `scope`/`context`, autocomplete from project file tree once the bash→Node extraction lands; for `depends_on`, autocomplete from other agents in the current config).
- Keyboard-friendly: Enter submits row, Tab moves to next, Backspace on empty row removes.

#### `DAGView` (Wave 2A)
Visualizes `depends_on` across all agents in a config or run.
- Nodes = agents (labeled with name + role badge). Edges = dependencies.
- Layout: layered top-to-bottom (sources at top, sinks at bottom).
- In the editor: hovering a node highlights its row in the form.
- In run view: nodes show live status (color-coded).
- No drag-to-rearrange; layout is automatic.
- **Implementation note:** SVG-based, hand-rolled or via a tiny dependency (e.g. `dagre-d3`). Open question — decision deferred to first DAG implementation PR; see wrap-up.

#### `PlanViewer` (Wave 2A)
Renders a `plan` role agent's output (markdown file from `.dmux/plans/`).
- Markdown rendered (via `react-markdown` or similar — open question; see wrap-up).
- Header: file path, agent that wrote it, timestamp.
- "Open in editor" link (optional, Wave 2A+).

#### `ScopeViolationViewer` (Wave 2A)
Surfaces files an agent touched outside its declared `scope`.
- Lists each violating file with a one-line diff stat (+N -M).
- "View diff" expands inline.
- "Add to scope" quick action (writes back to `.dmux-agents.yml`).
- **Banner variant** (used on run page header when violations exist) — see Tier 1 alert/banner note below.

#### `TerminalEmbed` (Wave 2A — refine existing)
The xterm.js wrapper. Currently in `AgentTerminals.jsx` + `TerminalPane.jsx`. Refinements:
- Consistent chrome: title bar with agent name, status badge, "Open in tmux" link (`tmux attach -t {session}:{pane}`).
- Resize observer for proper xterm sizing inside any container.
- Copy-to-clipboard for the last N lines.

#### `ProjectCard` (refine existing — Wave 2A)
Currently information-thin (Section 1 finding). Add:
- Last-touched timestamp.
- Current branch (small text).
- Agent count badge if `hasAgentsConfig`.
- Active run indicator if a run is currently running.

#### `SkillCard` (refine existing — Wave 2A)
Currently fine; add:
- Source badge (`built-in` / `installed` / `custom`).
- "Run on…" inline action (opens spawn sheet, Quick path, with this skill pre-selected).
- Click-through to `/skills/:name` for full detail.

#### `Banner` / `Alert` (Wave 2A)
Full-width attention surface, sits at top of page content.
- Variants: `info`, `success`, `warning`, `error`.
- Dismissable optional.
- Used for: scope violations on a run page, system messages (e.g. "Provider `claude` not found in PATH"), pending proposals on Dashboard.

#### `FormFromSchema` (Wave 2B)
Renders a dynamic form from a skill's `inputs:` block (and possibly other schema-driven surfaces later).
- Input types: text, textarea, select, multi-select, paths (uses `ListEditor`), boolean, number.
- Validation per the schema.
- Used in spawn sheet Quick path step 2.

### Compositional summary

How surfaces compose from primitives:

| Surface | Composes |
|---|---|
| Dashboard | `TopNav` + `Breadcrumbs` + `RunCard[]` + `EmptyState` |
| Projects list | `TopNav` + `ProjectCard[]` + `Input` (search) + `Sheet[dialog]` (Add) + `EmptyState` |
| Project Detail | `TopNav` + `Breadcrumbs` + `ProjectSummaryHeader` + `Button` + `RunCard[]` + `Disclosure` (settings) |
| Run Detail | `TopNav` + `Breadcrumbs` + `Banner` (if violations) + `DAGView` + `AgentCard[]` |
| Agent Detail (drill-in) | `TopNav` + `Breadcrumbs` + `Tabs` (Terminal/Plan/Diff/Violations) + `TerminalEmbed` + `PlanViewer` + `ScopeViolationViewer` |
| Agent Config Editor | `TopNav` + `Breadcrumbs` + `AgentCard[]` (editable) + `DAGView` + `Button` (save/start) |
| Skills Library | `TopNav` + `SkillCard[]` |
| Skill Detail | `TopNav` + `Breadcrumbs` + `Card` + `AgentCard[]` (preview) + `Button` (Run on…) |
| Spawn Sheet | `Sheet[sheet]` + `Wizard` + (Quick: `SkillCard[]` + `FormFromSchema`) or (Smart: `Textarea` + agent progress + proposal review) |
| Adopt Wizard | `Sheet[sheet]` + `Wizard` |
| Settings | `TopNav` + `Card[]` (sectioned) |

Every Wave 2 surface decomposes into ≤8 primitives. If a new surface needs primitive #9, that's a signal — either reuse harder or formalize a new primitive in the inventory.

### What we are deliberately not building

- **Rich text editor** for task descriptions. Plain textarea + markdown rendering on display is enough.
- **Kanban view** of agents. The DAG view covers ordering; kanban would be parallel state, not work.
- **Chart library / metrics dashboards.** No telemetry surface in Wave 2.
- **A real graph view** beyond the constrained `DAGView`. No network diagrams, no force-directed layouts.
- **Dark/light theme switcher** in Wave 2A. Stays dark-only for now; revisit in Wave 2B+.
- **Drag-and-drop reordering** in the agent editor. Up/down buttons if we want reorder; DnD is a tax that adds a11y complexity.
- **Customizable layouts.** Single canonical layout per surface.

### Dependencies on bash→Node extraction

Three composites *cannot* be built well until the parser is shared:
- `AgentCard` editor variant (today's `AgentForm` reparses YAML in JS — must use the shared parser instead).
- `FormFromSchema` for skill inputs (skill schemas must come from the same module both CLI and UI consume).
- `ScopeViolationViewer` (the post-run diff check must run in Node, not bash, to surface to the UI).

This concretizes the "extraction is load-bearing" claim from Section 1: three Wave 2A composites have hard dependencies on it.

### Decisions to confirm before Section 4

1. **Token-level focus ring** as a single source of truth, applied automatically to every focusable primitive (no per-component `:focus` styling).
2. **Spacing scale** introduced (`--space-1` through `--space-6`) and used consistently — small breaking change to existing CSS.
3. **No theme switcher in Wave 2A.** Dark-only stays.
4. **DAG view is hand-rolled SVG** unless reviewer prefers `dagre-d3` or similar dependency.
5. **Markdown rendering** via `react-markdown` (or equivalent). One library decision worth ratifying upfront.
6. **Banner/Alert exists as a separate primitive** from Toast (Toasts are ephemeral; Banners are persistent until acted on).

---

## Section 4 — Wave 2A wireframes

Text-based wireframes for the surfaces that ship in Wave 2A. Each wireframe is followed by notes on behavior, state variants, and key interactions. **All wireframes assume a desktop viewport (≥1024px wide); responsive/mobile is deferred** and called out at the end.

The eight surfaces below correspond to Wave 2A scope: model-per-agent, plan role, scope enforcement, prompt composition. Wave 2B surfaces (full Smart path of the spawn flow, parameterized skill inputs, NL planner UI) and 2C surfaces (Adopt wizard) are stubbed where they intersect Wave 2A but not fully wireframed.

### 4.1 Top nav

```
┌────────────────────────────────────────────────────────────────────────┐
│  dmux    Dashboard    Projects    Skills          [+ New Run]      ⚙  │
│          ━━━━━━━━━                                                     │
└────────────────────────────────────────────────────────────────────────┘
```

- **Logo** links to `/` (Dashboard).
- Three primary destinations. Active route gets an underline + brighter text (current Wave 1 has no active state).
- **`+ New Run`** is a `Button[variant=primary]`, not a nav link. Always visible. Opens the New Run sheet over the current page.
- **Settings cog** right-aligned. Icon-only button; tooltip on hover; route `/settings`.
- On narrow viewports (deferred), nav links collapse into a hamburger; `+ New Run` stays visible.

### 4.2 Dashboard (`/`)

The landing page. Lists what's happening across all projects.

```
┌─ TopNav ───────────────────────────────────────────────────────────────┐
│                                                                        │
│  Activity                                              [+ New Run]    │
│                                                                        │
│  ┌─ Running (2) ─────────────────────────────────────────────────────┐ │
│  │ ┌────────────────────────────────────────────────────────────────┐│ │
│  │ │ ● running     dmux > Run 2026-05-19 14:32                       ││ │
│  │ │ Skill: tdd-feature                                              ││ │
│  │ │ 3 agents · 12m elapsed                          view run →     ││ │
│  │ └────────────────────────────────────────────────────────────────┘│ │
│  │ ┌────────────────────────────────────────────────────────────────┐│ │
│  │ │ ● running     my-api > Run 2026-05-19 14:18                     ││ │
│  │ │ Manual config                                                   ││ │
│  │ │ 4 agents · 26m elapsed                  ⚠ 1 scope warning      ││ │
│  │ └────────────────────────────────────────────────────────────────┘│ │
│  └───────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ Recent (5) ──────────────────────────────────────────────────────┐ │
│  │   ✓ completed   dmux > 2026-05-19 11:04   Skill: code-review      │ │
│  │   ✓ completed   my-api > 2026-05-19 09:30   5 agents              │ │
│  │   ✗ failed      my-api > 2026-05-18 17:22   2 agents              │ │
│  │   ⊘ abandoned   prototype > 2026-05-18 16:11                       │ │
│  │   ✓ completed   dmux > 2026-05-18 14:50                           │ │
│  │                                                view all runs →    │ │
│  └───────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

- **`Running` section** appears only if there are in-flight runs. `RunCard[variant=full]`.
- **`Recent` section** shows 5 most recent terminated runs as compact `RunCard[variant=row]` (one line each).
- **Pending proposals** section (between Running and Recent) appears only when Wave 2B's planner outputs exist. In Wave 2A, this section is absent.
- **Empty state** (no runs ever): `EmptyState` with headline ("No runs yet"), primary `[+ New Run]`, secondary `[Browse projects]`. No CLI text.
- **Live updates** via the existing WebSocket; Running cards animate progress without page reload.

Edge cases:
- 10+ running runs: scroll within the section, not a paginated table.
- Failed-but-not-cleaned runs surface in `Recent`, not `Running`.

### 4.3 Projects list (`/projects`)

Small refinement of Wave 1, not a redesign. Wave 2A scope:

```
┌─ TopNav ───────────────────────────────────────────────────────────────┐
│                                                                        │
│  Projects                          [Search...]  [+ Add]  [Adopt repo] │
│                                                                        │
│  ┌────────────────┐  ┌────────────────┐  ┌────────────────┐           │
│  │ dmux           │  │ my-api         │  │ prototype      │           │
│  │ ~/code/dmux    │  │ ~/code/api     │  │ ~/proto        │           │
│  │ ● running       │  │ ◇ idle           │  │                │           │
│  │ on wave1-ui... │  │ on main         │  │ no config      │           │
│  │ 3 agents · 8m  │  │ 4 agents        │  │                │           │
│  └────────────────┘  └────────────────┘  └────────────────┘           │
└────────────────────────────────────────────────────────────────────────┘
```

- `ProjectCard` enriched per Section 3: branch, agent count, active run indicator.
- **Search input always visible** (no longer hidden under 4 projects).
- **`Adopt repo` button** is stubbed in Wave 2A — clicking it shows a Toast "Coming in Wave 2C." Visible so the affordance lands in the user's mental model even before the feature ships.
- **Empty state:** `EmptyState` with headline ("No projects yet"), primary `[+ Add project]`, secondary `[Adopt an existing repo]`. No `dmux -a` CLI text.

Add Project sheet (replaces current modal — uses the `Sheet[dialog]` primitive with focus trap, ESC, etc.):

```
                ┌─────────────────────────────────────────┐
                │ Add Project                          ✕  │
                ├─────────────────────────────────────────┤
                │ Name                                    │
                │ [ myproject                           ] │
                │                                         │
                │ Path                                    │
                │ [ ~/code/myproject                    ] │
                │ Absolute path or use ~ for home dir.    │
                │                                         │
                │ [Cancel]                       [Add →]  │
                └─────────────────────────────────────────┘
```

- Helper text replaces silent placeholders.
- Error appears inline above buttons, not below the path field.
- `Add →` is `Button[primary]`; `Cancel` is `Button[secondary]`.
- Enter submits; ESC closes; focus traps in the sheet.

### 4.4 Project Detail (`/projects/:name`) — restructured

```
┌─ TopNav ───────────────────────────────────────────────────────────────┐
│  Projects / dmux                                                       │
│                                                                        │
│  dmux                                                  [+ New Run]    │
│  ~/code/dmux  ·  on wave1-ui-skills  ·  8206b36 "Add Wave 1 UI..."   │
│  3 agents configured                              Edit config →       │
│                                                                        │
│  ┌─ Active run ──────────────────────────────────────────────────────┐ │
│  │ ● running    Run 2026-05-19 14:32   ·   Skill: tdd-feature         │ │
│  │   ┌──────────┬──────────┬──────────┐                                │ │
│  │   │ planner  │ engineer │ reviewer │   12m elapsed   view run →   │ │
│  │   │ ✓        │ ●        │ ○        │                                │ │
│  │   └──────────┴──────────┴──────────┘                                │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ History ─────────────────────────────────────────────────────────┐ │
│  │   ✓ 2026-05-19 11:04   Skill: code-review        2 agents          │ │
│  │   ✓ 2026-05-18 14:50   NL: "add screenshot..."    3 agents          │ │
│  │   ✗ 2026-05-17 09:21   Manual                    4 agents          │ │
│  │                                          view all 12 runs →       │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ Context ─────────────────────────────────────────────────────────┐ │
│  │ Git: wave1-ui-skills · 2 modified · 1 untracked                    │ │
│  │ CLAUDE.md: 47 lines · last edited 2 days ago         preview →    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ▶ Settings                                                            │
│    (Quick Launch · Rename project · Remove project)                    │
└────────────────────────────────────────────────────────────────────────┘
```

- **Header band (`ProjectSummaryHeader`)** — name, path, branch + commit, agent count. Not a card — sits on the page background.
- **Primary action `+ New Run`** in the header band. Single highest-priority action on the page.
- **`Edit config →`** is a secondary link, routes to `/projects/:name/config`.
- **Active run section** — appears only when a run is in-flight. Compact `DAGView` (mini) + elapsed time + link to full Run Detail.
- **History section** — `RunCard[variant=row]` list. Empty state if no history.
- **Context section** — git panel + CLAUDE.md preview (Wave 2C uses this slot).
- **Settings disclosure (collapsed by default)** — contains the demoted Quick Launch feature, rename action, and **Remove project** styled as `Button[variant=danger]`. No more "Danger Zone" header — destructive actions tucked here.

Empty state for History (no runs yet on this project): a friendly callout below the active-run slot — "No runs yet — `[+ New Run]` to start one."

### 4.5 Agent Config Editor (`/projects/:name/config`)

This is the most consequential refactor in Wave 2A. Replaces today's `AgentSession.jsx` config-editing mode.

```
┌─ TopNav ───────────────────────────────────────────────────────────────┐
│  Projects / dmux / Config                              [Show YAML]    │
│                                                                        │
│  Agent Configuration                                                   │
│                                                                        │
│  ┌─ Session ─────────────────────────────────────────────────────────┐ │
│  │ Session name       [ dmux-agents                              ]   │ │
│  │ Worktree base      [ ..                                       ]   │ │
│  │ ☑ Main integration pane     ☐ Namespace branches                  │ │
│  │ On complete (default)   ☐ Test   ☐ Push   ☐ PR                    │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ Dependency graph ────────────────────────────────────────────────┐ │
│  │           ┌────────────┐                                            │ │
│  │           │  planner   │                                            │ │
│  │           └─────┬──────┘                                            │ │
│  │                 │                                                   │ │
│  │       ┌─────────┴─────────┐                                         │ │
│  │       ▼                   ▼                                         │ │
│  │  ┌──────────┐        ┌──────────┐                                   │ │
│  │  │engineer  │        │engineer  │                                   │ │
│  │  │  -auth   │        │   -ui    │                                   │ │
│  │  └─────┬────┘        └─────┬────┘                                   │ │
│  │        └─────────┬─────────┘                                        │ │
│  │                  ▼                                                  │ │
│  │            ┌──────────┐                                             │ │
│  │            │ reviewer │                                             │ │
│  │            └──────────┘                                             │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ Agents ──────────────────────────────────────────────────────────┐ │
│  │ ▼ planner       [plan]   sonnet      depends on: —     [Remove]    │ │
│  │  ┌────────────────────────────────────────────────────────────────┐│ │
│  │  │ Name      [ planner                                          ] ││ │
│  │  │           Used in branch name and run output paths.            ││ │
│  │  │                                                                ││ │
│  │  │ Role      ◉ plan      ○ build      ○ review                   ││ │
│  │  │           Plan agents are read-only; they produce a plan       ││ │
│  │  │           file consumed by downstream build agents.            ││ │
│  │  │                                                                ││ │
│  │  │ Model     [ sonnet                                          ▾] ││ │
│  │  │                                                                ││ │
│  │  │ Task      ┌────────────────────────────────────────────────┐  ││ │
│  │  │           │ Produce an implementation plan for OAuth login  │  ││ │
│  │  │           │ covering provider config, token storage, and   │  ││ │
│  │  │           │ session middleware.                             │  ││ │
│  │  │           └────────────────────────────────────────────────┘  ││ │
│  │  │                                                                ││ │
│  │  │ Depends on  (none — first in chain)                            ││ │
│  │  │                                                                ││ │
│  │  │ Scope     — (disabled; plan role is read-only)                 ││ │
│  │  │                                                                ││ │
│  │  │ Context   ┌──────────────────────────────────────────────────┐ ││ │
│  │  │           │ src/auth/                                  [×]   │ ││ │
│  │  │           │ src/middleware/                            [×]   │ ││ │
│  │  │           │ + Add path...                                    │ ││ │
│  │  │           └──────────────────────────────────────────────────┘ ││ │
│  │  │                                                                ││ │
│  │  │ ☑ Auto-accept                                                  ││ │
│  │  │ On complete   ☐ Test  ☐ Push  ☐ PR  (inherits global)          ││ │
│  │  └────────────────────────────────────────────────────────────────┘│ │
│  │                                                                    │ │
│  │ ▶ engineer-auth  [build]   opus       depends on: planner          │ │
│  │ ▶ engineer-ui    [build]   sonnet     depends on: planner          │ │
│  │ ▶ reviewer       [review]  opus       depends on: engineer-*       │ │
│  │                                                                    │ │
│  │  [+ Add agent]      [Duplicate selected]                           │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌────────────────────────────────────────────────────────────────────┐ │
│  │ [Discard changes]                     [Save config]  [Save & Run] │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

Key changes from Wave 1's `AgentSession.jsx`:

1. **YAML preview is hidden by default.** `[Show YAML]` button top-right opens a side panel; the form is the source of truth.
2. **DAG view is inline and live** — updates as the user edits `depends_on`. Wired to the same parser (post-extraction) so it reflects truth.
3. **Agent cards are collapsible** (`Disclosure`). Summary line shows name, role badge, model, depends_on. Open card shows full form.
4. **Role is a segmented radio** with three options: plan, build, review. Selecting `plan` disables the Scope and Branch fields; selecting `review` disables Branch.
5. **`Model` is a select per agent**, populated from a known list (`opus`, `sonnet`, `haiku`, and gemini equivalents).
6. **`Scope`, `Context`, `Depends on` are `ListEditor`** — chip-style entries with explicit remove buttons. Comma-separated text fields are gone.
7. **Helper text under non-obvious fields** — replaces silent placeholders.
8. **`Save & Run`** is the primary action (creates a Run and navigates to Run Detail). `Save config` is secondary (writes the file, no run).
9. **`Duplicate selected`** appears once an agent card is checked (checkbox added next to the row, not shown in the wireframe for brevity).
10. **Validation:** cyclic dependencies show an inline error on the DAG section header; can't save until fixed.

State variants:
- **No agents yet** (fresh config): the Agents section shows an `EmptyState` inside it with `[+ Add agent]` as the primary action and a hint to use a skill.
- **Agents running:** entire editor is disabled with a banner explaining "Run in progress — cleanup or wait to edit."

### 4.6 New Run sheet — Wave 2A skeleton

Wave 2A delivers the bare bones: pick path → pick skill (Quick only) → review → start. Wave 2B fills in the Smart path and parameterized skills.

**Step 1 of 3 — Path:**

```
                    ┌──────────────────────────────────────┐
                    │ New Run                           ✕  │
                    │ Step 1 of 3 — Choose path            │
                    ├──────────────────────────────────────┤
                    │                                      │
                    │ ┌──────────────────────────────────┐ │
                    │ │  ⚡  Quick                         │ │
                    │ │  Pick a skill and launch          │ │
                    │ │                                   │ │
                    │ │  [Choose →]                        │ │
                    │ └──────────────────────────────────┘ │
                    │                                      │
                    │ ┌──────────────────────────────────┐ │
                    │ │  ✨  Smart                          │ │
                    │ │  Describe in your own words       │ │
                    │ │  (Available in Wave 2B)            │ │
                    │ │  [Coming soon]                    │ │
                    │ └──────────────────────────────────┘ │
                    │                                      │
                    └──────────────────────────────────────┘
```

- Smart card is visibly disabled and labeled "Coming soon" — keeps the affordance in the user's mental model.

**Step 2 of 3 — Pick skill (Quick path):**

```
                    ┌──────────────────────────────────────┐
                    │ New Run                           ✕  │
                    │ Step 2 of 3 — Pick skill             │
                    ├──────────────────────────────────────┤
                    │                                      │
                    │ Project:  [ dmux                  ▾] │
                    │                                      │
                    │ ┌─ tdd-feature ────────────────────┐ │
                    │ │ Plan → tests → code → review     │ │
                    │ │ 4 agents · built-in               │ │
                    │ │                       [Select →] │ │
                    │ └──────────────────────────────────┘ │
                    │ ┌─ code-review ────────────────────┐ │
                    │ │ Review pending changes           │ │
                    │ │ 1 agent · built-in                │ │
                    │ │                       [Select →] │ │
                    │ └──────────────────────────────────┘ │
                    │ ┌─ refactor ───────────────────────┐ │
                    │ │ ...                              │ │
                    │ └──────────────────────────────────┘ │
                    │ ──────────────────────────────────── │
                    │ Or use the existing config           │
                    │ [Edit current .dmux-agents.yml →]    │
                    │                                      │
                    │ [← Back]                             │
                    └──────────────────────────────────────┘
```

- Project select defaults to the current project if the sheet was opened from a project page; otherwise prompts to pick.
- Skill cards from the existing library; "built-in" / "installed" / "custom" source badge.
- Selecting a skill advances to Step 3.

**Step 3 of 3 — Review:**

```
                    ┌──────────────────────────────────────┐
                    │ New Run                           ✕  │
                    │ Step 3 of 3 — Review                 │
                    ├──────────────────────────────────────┤
                    │                                      │
                    │ Project:  dmux                       │
                    │ Skill:    tdd-feature                 │
                    │                                      │
                    │ Agents this will create:             │
                    │   • planner    plan      sonnet      │
                    │   • engineer   build     opus        │
                    │   • tester     build     sonnet      │
                    │   • reviewer   review    opus        │
                    │                                      │
                    │ ⚠ This will overwrite the existing    │
                    │   .dmux-agents.yml.                  │
                    │                                      │
                    │ [← Back]               [Save & Run] │
                    └──────────────────────────────────────┘
```

- Explicit overwrite warning. (Wave 2B: a diff view of existing config vs. new config.)
- `Save & Run` is `Button[primary]`; clicking creates the Run record, writes the YAML, starts agents, closes the sheet, navigates to Run Detail.
- Error states: if the skill template fails to render, error message in place of the agent list with `[← Back]` enabled.

### 4.7 Run Detail (`/projects/:name/runs/:runId`)

```
┌─ TopNav ───────────────────────────────────────────────────────────────┐
│  Projects / dmux / Run 2026-05-19 14:32                                │
│                                                                        │
│  ⚠ 1 scope violation detected     [View violations →]      [Dismiss]   │
│                                                                        │
│  Run 2026-05-19 14:32                            ● running · 12m       │
│  Skill: tdd-feature  ·  3 agents                                       │
│                                                          [Stop run]    │
│                                                                        │
│  ┌─ Agents ──────────────────────────────────────────────────────────┐ │
│  │            ┌────────────┐                                           │ │
│  │            │ ✓ planner   │                                           │ │
│  │            │ sonnet · 3m │                                           │ │
│  │            └─────┬───────┘                                           │ │
│  │                  │                                                   │ │
│  │       ┌──────────┴──────────┐                                       │ │
│  │       ▼                     ▼                                       │ │
│  │  ┌────────────┐        ┌────────────┐                                │ │
│  │  │● engineer ⚠ │        │○ tester     │                                │ │
│  │  │ opus · 7m   │        │ waiting     │                                │ │
│  │  └────────────┘        └────────────┘                                │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ┌─ Agent list ──────────────────────────────────────────────────────┐ │
│  │ Agent       Role     Model    Status          Duration     Open    │ │
│  │ planner     plan     sonnet   ✓ completed     3m 12s        open → │ │
│  │ engineer    build    opus     ● running ⚠     7m 04s        open → │ │
│  │ tester      build    sonnet   ○ waiting       —             open → │ │
│  └────────────────────────────────────────────────────────────────────┘ │
│                                                                        │
│  ▶ Run config (frozen at 14:32)                                        │
└────────────────────────────────────────────────────────────────────────┘
```

- **`Banner[warning]`** at top when violations exist. Dismissable; persists per-page-load (resurfaces on reload — it's a real state, not a notification).
- **DAG view** with live status colors. The `⚠` overlay on a node = that agent has scope violations.
- **Agent list table** — sortable, every row links to Agent Detail.
- **Frozen config disclosure** — opens the `.dmux-agents.yml` snapshot from when this run launched. Read-only.
- **`Stop run`** is `Button[variant=danger]`, only visible while running.

Completed run header swaps:

```
│  Run 2026-05-19 14:32                          ✓ completed · 24m       │
│  Skill: tdd-feature  ·  3 agents                                       │
│                                            [Re-run with same config]   │
```

Failed:
```
│  Run 2026-05-19 14:32                            ✗ failed · 11m        │
│  Skill: tdd-feature  ·  3 agents                                       │
│                       [Re-run]   [Cleanup worktrees]                   │
```

### 4.8 Agent Detail (drill-in)

```
┌─ TopNav ───────────────────────────────────────────────────────────────┐
│  Projects / dmux / Run 2026-05-19 14:32 / engineer                     │
│                                                                        │
│  engineer    [build] [opus] [● running · 7m 04s]    branch: feat/auth  │
│  Depends on: planner (✓ completed)                                     │
│                                                                        │
│  ┌─ [Terminal]  [Plan]  [Diff]  [Violations (1)] ────────────────────┐ │
│  ├────────────────────────────────────────────────────────────────────┤ │
│  │ ╭────────────────────────────────────────────────────────────────╮ │ │
│  │ │ ● engineer · pane 2 · session dmux-agents      [Attach in tmux]│ │ │
│  │ │                                                                │ │ │
│  │ │  $ git checkout feat/auth                                      │ │ │
│  │ │  Switched to a new branch 'feat/auth'                          │ │ │
│  │ │  $ claude --model opus                                         │ │ │
│  │ │  > Reading plan from .dmux/plans/planner.md                    │ │ │
│  │ │  > Writing src/auth/oauth.ts...                                │ │ │
│  │ │  ...                                                            │ │ │
│  │ ╰────────────────────────────────────────────────────────────────╯ │ │
│  └────────────────────────────────────────────────────────────────────┘ │
└────────────────────────────────────────────────────────────────────────┘
```

Four tabs (`Tabs` primitive):

- **Terminal** — `TerminalEmbed` with `[Attach in tmux]` link that copies `tmux attach -t session:pane` to clipboard. The default tab.
- **Plan** — `PlanViewer`. For plan-role agents, shows the plan they wrote. For build/review agents, shows the upstream plan they consumed (if any). Empty if no plan applies.
- **Diff** — file tree on left, unified diff on right. Shows the agent's worktree diff against the branch base. (Implementation note: server returns `git diff --no-color base..HEAD` parsed.)
- **Violations (N)** — `ScopeViolationViewer`. Only renders the tab if violations exist; the count is shown in the tab label.

Violations tab content:

```
│  ┌─ Violations ──────────────────────────────────────────────────────┐ │
│  │ Files modified outside declared scope:                             │ │
│  │                                                                    │ │
│  │  src/middleware/auth.ts        +18  -2     [Add to scope]          │ │
│  │  ▶ View diff                                                       │ │
│  │                                                                    │ │
│  │  Declared scope: src/auth/                                         │ │
│  └────────────────────────────────────────────────────────────────────┘ │
```

- `[Add to scope]` quick action writes `src/middleware/` into this agent's scope in `.dmux-agents.yml` (and reloads the violation check). Confirmation toast.
- `▶ View diff` expands the diff inline for that file.

### 4.9 States and edge cases (cross-page)

A few state variants worth specifying that don't fit cleanly under any single surface:

**Loading states.** Use `Skeleton` blocks shaped like the content they replace. No "Loading..." text in Wave 2A.

**Empty states.** Each surface has a defined empty state:
- Dashboard, no runs ever: large `EmptyState`, `[+ New Run]` primary.
- Projects, no projects: `EmptyState`, `[+ Add project]` + `[Adopt existing repo]`.
- Project Detail, no history: small inline callout under the header.
- Run Detail, agent list empty (shouldn't happen for valid runs): error state.
- Agent Detail, Plan tab when no plan exists: small callout "No plan for this agent — it didn't depend on a plan-role agent."

**Error states.** Every fetch failure surfaces as a Toast (transient) AND an inline error on the affected card. Don't rely on Toasts alone — they vanish.

**Disconnected websocket.** The existing dot indicator on `StatusTable` extends to a `Banner[warning]` at the top of any live page (Dashboard, Run Detail) when disconnected for >5s. Auto-dismisses on reconnect.

**Optimistic UI.** Save & Run, Add Project, etc. show optimistic state (button → spinner) and roll back on error. Avoids the "did the click register?" feeling.

### 4.10 Out of scope for Wave 2A wireframes

- **Smart path of the spawn flow** (NL planner) — wireframed in Wave 2B design pass.
- **Parameterized skill input form** — Wave 2B.
- **Skill detail page** (`/skills/:name`) — exists in IA but no Wave 2A user need beyond the existing card.
- **Adopt repo wizard** — Wave 2C.
- **Settings page** — Wave 2A may need a small theme/provider settings page; full design deferred. For now, settings collapses into the existing tucked-away affordances.
- **Responsive / mobile layouts.** All wireframes assume desktop. Public-ready will eventually need a tablet/mobile layer; not in Wave 2A scope.

### Decisions to confirm before Section 5

1. **DAG view in the editor is auto-laid out** (top-to-bottom, no manual placement). Confirm the constraint.
2. **`Save & Run` creates a new Run record AND writes the YAML in one action.** Alternative: separate Save then Run. Picked Save & Run for fewer clicks; flag if you'd prefer split.
3. **The terminal embed shows live agent output AND a tmux attach link.** Both, not either-or.
4. **Scope violations are surfaced in three places** (banner on Run Detail, badge on agent in DAG/list, dedicated tab in Agent Detail). Multiple surfaces are intentional — high-signal warning.
5. **Frozen run config is read-only.** Re-running starts a new Run with the current `.dmux-agents.yml`, not the frozen one. (Re-run UX revisited in 2B.)
6. **Cancel in the New Run sheet discards the flow.** No autosave of in-progress spawn state.

---

## Section 5 — Accessibility conventions

The bar dmux commits to, and the work that gets it there. Reach (non-CLI users) is the primary goal; WCAG-style accessibility (keyboard nav, screen readers, contrast) is best-effort but seriously pursued. We do **not** claim WCAG AA/AAA compliance certification.

This section establishes a checklist developers can apply per-PR. It is intentionally short on theory and long on specifics.

### Principles

1. **No `outline: none` without a replacement.** Focus must always be visible.
2. **Never rely on color alone** to convey state. Pair color with an icon, label, or shape.
3. **Native HTML first.** Use `<button>`, `<a>`, `<label>`, `<dialog>`, `<details>`. Reach for ARIA only when no native equivalent fits.
4. **Keyboard must reach everywhere the mouse can.** Every interactive control is Tab-reachable and operable with Enter/Space (and arrow keys where conventional).
5. **Don't break expected affordances.** If it looks like a button it should be a button. If it looks like a link it should navigate.

### Tokens that govern accessibility

#### Focus ring

The single fix that erases the largest a11y regression in Wave 1. Adds one token, removes the global `outline: none`.

```css
:root {
  /* Visible on both bg-primary (#000) and bg-card (#141414) */
  --focus-ring: 0 0 0 2px var(--bg-primary), 0 0 0 4px var(--accent-cyan);
  --focus-ring-offset: 2px;
}

/* Replace global outline: none with explicit handling */
*:focus { outline: none; }
*:focus-visible {
  box-shadow: var(--focus-ring);
  outline-offset: var(--focus-ring-offset);
}
```

Using `:focus-visible` (not `:focus`) means the ring shows for keyboard users and stays hidden during mouse interactions — best of both worlds.

#### Color contrast — explicit pairings

Audit of current `theme.css` token pairings against WCAG AA (4.5:1 normal text, 3:1 large text):

| Foreground | Background | Ratio | AA normal | AA large | Verdict |
|---|---|---|---|---|---|
| `--text-primary` (#fafafa) | `--bg-card` (#141414) | ~17.4:1 | ✓ | ✓ | Use for all body content |
| `--text-secondary` (#888) | `--bg-card` (#141414) | ~4.6:1 | ✓ (just) | ✓ | OK for secondary text; verify per surface |
| `--text-muted` (#555) | `--bg-card` (#141414) | ~2.4:1 | ✗ | ✗ | **Decorative only.** Never for content, error messages, or labels |
| `--accent-cyan` (#0099ff) | `--bg-card` | ~4.7:1 | ✓ | ✓ | OK for links/buttons |
| `--accent-green` (#63ed40) | `--bg-card` | ~10.6:1 | ✓ | ✓ | OK for status |
| `--accent-pink` (#ff5492) | `--bg-card` | ~5.0:1 | ✓ | ✓ | OK |
| `--accent-orange` (#ffa552) | `--bg-card` | ~9.5:1 | ✓ | ✓ | OK |

**Hard rule:** `--text-muted` is forbidden for any content a user must read. It's reserved for explicitly decorative use (separator labels, watermark-style hints). Section 6 (copy) will rewrite Wave 1 code paths that currently use `--text-muted` for meaningful content.

#### Reduced motion

```css
@media (prefers-reduced-motion: reduce) {
  *, *::before, *::after {
    animation-duration: 0.01ms !important;
    transition-duration: 0.01ms !important;
  }
}
```

Specifically affects: skeleton shimmer, sheet slide-in, the running-status pulse on RunCards, DAG-view layout animations.

### Per-primitive conventions

Each primitive from Section 3 gets an a11y spec. Bullets are normative — implementing the primitive without these is a regression.

#### Tier 1 — Foundation

**`Button`**
- Native `<button type="button">` unless it submits a form (then `type="submit"`).
- Icon-only buttons require `aria-label` describing the action.
- Loading state: `aria-busy="true"`; preserve width to prevent layout shift; do not announce "loading" via toast (the button is its own affordance).
- Disabled buttons: `disabled` attribute; do not rely on visual styling alone. If a button should be clickable but show a "why disabled" tooltip, use `aria-disabled="true"` with click handler that explains, not `disabled`.

**`Input` / `Textarea` / `Select`**
- Every field has a visible `<label>` (linked via `for`/`id` or wrapping). **No placeholder-as-label** — placeholder is example text only.
- Helper text linked via `aria-describedby="{id}-help"`.
- Errors: `aria-invalid="true"` plus error message linked via `aria-describedby="{id}-error"`. Error text replaces helper text or sits below it (visible to all users, not just screen readers).
- Required fields: `aria-required="true"` + visual asterisk + helper text mentioning required-ness if non-obvious.

**`Checkbox` / `Radio`**
- Native `<input type="checkbox/radio">`. Wrap label around input so the entire label area is clickable.
- Radio groups: `<fieldset>` with `<legend>` for the group label, OR `role="radiogroup"` with `aria-labelledby` if not using fieldset.
- Tri-state checkbox (used in the agent editor for inherited `on_complete`): `aria-checked="mixed"`.

**`Badge`**
- Decorative by default — color and text together convey state.
- If a badge is the **only** state indicator (e.g., the `⚠` glyph on a DAG node), supplement with `aria-label` or visually-hidden text: `<span class="visually-hidden">Has scope violations</span>`.
- Status color **must** be paired with text — never `<Badge tone="failed" />` alone; always `<Badge tone="failed">failed</Badge>` or equivalent.

**`Toast`**
- Container: `aria-live="polite"` for info/success, `role="alert"` for error.
- Auto-dismiss timer pauses on hover/focus; user can also dismiss with the close button (which has `aria-label="Dismiss notification"`).
- Toasts are **non-blocking** — they never replace the equivalent inline error state, which persists.

**`EmptyState` (pattern)**
- Semantic `<h2>` for the headline.
- Primary action is a `Button[variant=primary]` or a real `<a>` if it navigates.
- Decorative illustration: `aria-hidden="true"`.

**`Skeleton` (pattern)**
- Container has `aria-busy="true"` while loading.
- Individual skeleton blocks have `aria-hidden="true"`.
- When loading completes, focus management: do **not** auto-focus newly loaded content unless the user triggered the load and is waiting to interact (e.g., loaded search results).

#### Tier 2 — Containers

**`Sheet` (dialog / sheet)**
- Use real `<dialog>` element where browser support allows (modern Chrome/Safari/Firefox); polyfill or `role="dialog" aria-modal="true"` for older browsers.
- `aria-labelledby` points at the sheet title `<h2>`.
- **Focus trap** — Tab and Shift-Tab cycle within the sheet only.
- **Initial focus** — first focusable interactive element inside, OR the close button if none.
- **ESC closes** the sheet; for multi-step Wizards, ESC opens a "Discard changes?" confirmation if state is dirty (no autosave per Section 4 decision).
- **Restores focus** to the trigger button on close.
- Background scroll locked while open; click-outside dismisses optionally (per usage).

**`Wizard`**
- Step indicator is a list with `aria-current="step"` on the active step.
- "Step 2 of 3" text is part of the heading, not visually-hidden.
- Back/Next buttons preserve form state.

**`Tabs`**
- `role="tablist"` on the tab strip; each tab is `<button role="tab" aria-selected="..." aria-controls="...">`.
- Panel is `<div role="tabpanel" aria-labelledby="...">`.
- Keyboard: ← / → moves between tabs and activates them; Home/End jumps to first/last; Tab moves focus out of the tab strip into the panel.
- Active tab visually distinguished by more than color (underline + weight, not just color).

**`Disclosure`**
- Trigger is a `<button aria-expanded="..." aria-controls="...">`.
- Panel hidden via `hidden` attribute when collapsed (preferred) or `display: none`.
- Avoid `aria-hidden="true"` for collapsed state — `hidden` is more semantic.
- Animation respects `prefers-reduced-motion`.

#### Tier 3 — Navigation

**`TopNav`**
- `<nav aria-label="Primary">`.
- Active page link gets `aria-current="page"` plus visual treatment.
- Logo is the primary "go home" — link text "dmux" (not just a logo with no accessible name).
- `+ New Run` button has accessible name "New run" (lose the "+" from the accessible name).

**`Breadcrumbs`**
- `<nav aria-label="Breadcrumb">` wrapping `<ol>`.
- Last item has `aria-current="page"` and is not a link.
- Separators (`/`) are `aria-hidden="true"`.

#### Tier 4 — dmux composites

**`RunCard`, `ProjectCard`, `SkillCard`, `AgentCard`**
- Composed on `Card`. Same rules: linked variant uses `<a>`, interactive uses `<button>`, both have a clear accessible name.
- Status badge inside a card is supplementary; the card's accessible name includes the run/project/agent identifier (the user can read or hear that without needing the badge).

**`ProjectSummaryHeader`**
- `<header>` element wrapping an `<h1>` for the project name.
- Metadata (path, branch, commit) is paragraph or definition list text — readable in order.

**`ListEditor`**
- Group label via `<fieldset><legend>` or `aria-labelledby`.
- Each row's remove button has `aria-label="Remove {path}"` to disambiguate when multiple rows exist.
- Add button has explicit label: "Add path" or "Add dependency" — never just "+".
- Keyboard: Enter on the input adds the row; Backspace on an empty input removes the previous row (with a brief grace timer).

**`DAGView`**
- The SVG has `<title>` ("Agent dependency graph") and `<desc>` (one-line summary like "5 agents; planner → engineer-auth, engineer-ui → reviewer").
- Each node has `<title>` (agent name + status).
- The DAG is the *secondary* representation — the adjacent `Agent list` table is the canonical accessible representation. Screen reader users get full information from the table.
- Interactive nodes (hover/click to highlight) are keyboard-reachable via the table, not the SVG directly.

**`PlanViewer`**
- Markdown rendered with correct heading hierarchy. The plan's H1 becomes an `<h2>` inside the page (the page's own `<h1>` is the agent name).
- Plan file path shown as code-styled text with a copy-to-clipboard button.

**`ScopeViolationViewer`**
- Wrapping element has `role="region" aria-label="Scope violations"`.
- File list is `<ul>`; each item has the file path, diff stats, and the `[Add to scope]` button with `aria-label="Add {path} to scope"`.

**`TerminalEmbed`**
- xterm.js's native a11y is limited — it does not work well with screen readers for live output.
- **Mitigation:** prominently surface `[Attach in tmux]` (terminal access where the user controls their own environment) and `[Copy last N lines]`.
- Do **not** wire the terminal output to a live region (too noisy, would flood the screen reader).
- Visual focus indicator on the terminal pane is essential — users need to know typing goes there.

**`Banner` / `Alert`**
- `role="alert"` for warning/error; `role="status"` for info/success.
- Do not also wrap in `aria-live` — the role implies the live behavior.
- Dismissable banners' close button: `aria-label="Dismiss"`.

**`FormFromSchema`** (Wave 2B)
- Each rendered field follows the Input/Textarea/Select/Checkbox conventions above.
- Schema-driven helper text is required for any non-obvious field; the skill author owns this copy.

### Keyboard navigation patterns

Cross-cutting conventions.

| Key | Behavior |
|---|---|
| Tab / Shift-Tab | Move focus forward / backward through interactive elements in visual order. `tabindex > 0` is forbidden. |
| Enter | Activate the focused button or link; submit a form when on a single-line input. |
| Space | Activate the focused button; toggle checkbox; activate selected tab. |
| ESC | Close sheet/dialog; cancel in-progress flows (with confirm if dirty); dismiss dismissable banners. |
| Arrow keys | Navigate within a composite widget: tabs, radio groups, the DAG when implemented, menus. |
| Home / End | Jump to first/last in lists (tab strip, list editors). |

**Forbidden:** custom tab order via `tabindex="2"`/`tabindex="3"` etc. The DOM order must match the visual reading order.

### Focus management

- **Page navigation:** on route change, focus moves to the new page's `<h1>`. If the page has a "Skip to main content" link that was used, focus moves there instead.
- **Sheet open:** focus first focusable inside; remember the trigger element.
- **Sheet close:** restore focus to the trigger.
- **Form submit success that stays on page:** focus moves to the success message or the natural next action.
- **Form submit error:** focus moves to the first invalid field.
- **Dynamic content insertion** (e.g., a violation appearing on a Run Detail page mid-run): announce via `Toast` + `Banner`; do **not** steal focus.

### Skip link

Add a "Skip to main content" link as the first element inside `<body>`. Visually hidden until focused. Targets the page's `<main>`.

```jsx
<a href="#main" className="visually-hidden focusable">Skip to main content</a>
<TopNav />
<main id="main">...</main>
```

### Wave 1 specific fixes (immediate)

These are concrete regressions in current source that Wave 2A's first work removes:

1. **`theme.css:61,66`** — remove `outline: none` global; replace with the `:focus-visible` rule above.
2. **`ProjectsGrid.jsx:103–144`** — replace hand-rolled modal with `Sheet[dialog]` primitive (focus trap, ESC, `aria-modal`).
3. **`ProjectDetail.jsx:76`** — replace `window.confirm()` with a `Sheet[dialog]` confirmation.
4. **`AgentForm.jsx:154–161`** — convert the role `<select>` to a segmented radio group with a proper `<fieldset><legend>`.
5. **`StatusTable.jsx`** — status badge color tokens (`badge_green`, etc.) become semantic (`badge[tone=completed]`, `badge[tone=running]`, etc., matching Section 6's status vocabulary) so screen readers can rely on the text alone; the color is supplementary.
6. **All placeholder-as-label inputs** — every input gains a visible `<label>` above (`AgentForm`, `ProjectsGrid` Add modal, `AgentSession` form).
7. **`SkillPicker.jsx`** — the dropdown trigger gets `aria-expanded` and `aria-controls`; arrow-key navigation through items.
8. **`Navbar.jsx`** — wrap in `<nav aria-label="Primary">`; add `aria-current="page"` on active route.

### Testing approach

Lightweight. We are not standing up a dedicated a11y test suite for Wave 2A.

- **Manual, every Wave-2A PR:** keyboard-only navigate the new/changed surface end-to-end before requesting review. Confirm focus is always visible, every action is reachable, ESC works in any sheet.
- **Manual, once per Wave:** spot-check a major flow (Dashboard → New Run → Run Detail → Agent Detail) with VoiceOver (macOS) and/or NVDA (Windows if available). Fix the highest-signal issues.
- **Automated, deferrable:** add `axe-core` via Playwright as a smoke test in CI once Wave 2A merges. Catches the obvious regressions (missing labels, missing roles, low contrast in static pairings).
- **Not in scope:** full WCAG audit, paid screen reader testing, voice-control verification.

### What we don't promise

Be explicit so we don't oversell:

- WCAG AA or AAA certification.
- Full screen reader parity (especially in the terminal embed).
- Mobile/touch optimization (deferred with the rest of mobile).
- High-contrast Windows mode.
- Voice control (Dragon NaturallySpeaking, etc.).
- Internationalization or RTL layout (deferred to a later wave).

If a user reports an a11y issue we don't currently cover, that's a real bug — but the bar we ship against is "Wave 2A reaches non-CLI users with serviceable keyboard and screen reader support," not "fully accessible product."

### PR-blocking smells

These should fail review for any Wave 2 component:

- Missing `<label>` on an input.
- Color-only state indication.
- Icon-only button without `aria-label`.
- `outline: none` without a replacement focus style.
- Click handler on a `<div>` or `<span>` that should be a `<button>` or `<a>`.
- Custom `tabindex` greater than 0.
- A `Toast` used in place of an inline error.
- A `Sheet` opening without trapping focus, restoring focus on close, or handling ESC.
- `confirm()` or `alert()` used instead of an in-app `Sheet`.

### Decisions to confirm before Section 6

1. **`--focus-ring`** uses a 2px ring of `--accent-cyan` with an inner 2px ring matching the background, producing a clear contrasting outline on both `--bg-primary` and `--bg-card`. Alternative: a single outline with `outline-offset`. Picked the box-shadow approach because it works on rounded corners without distortion.
2. **`--text-muted` is forbidden for content.** This is a real constraint — code that currently uses it for hints/timestamps/etc. will need to switch to `--text-secondary`.
3. **Test bar is "manual keyboard + VoiceOver spot-check per wave + axe-core CI smoke test."** Not enforced per-PR by automation in Wave 2A.
4. **WCAG compliance is not claimed.** This will be reflected in the product copy / README / marketing once dmux ships publicly. (Section 6.)

---

## Section 6 — Copy guidelines

How dmux talks to users. Reach is the goal — copy that confuses or condescends loses users faster than missing features.

### Voice

dmux's voice is:

- **Direct.** State what happened and what to do. Skip filler.
- **Specific.** Names of things, paths, branches, agents — name them. "Couldn't save `.dmux-agents.yml`" beats "Save failed."
- **Confident, not chirpy.** No "Oops!", "Whoops!", "Something went wrong." Those phrases hide information.
- **Plain English.** No "leverage", "utilize", "enablement." If you'd say it to a colleague at a whiteboard, say it that way in the UI.
- **Lowercase domain nouns in running text.** "Spawn a new run" not "Spawn a new Run" — sentence case in body copy. Capitalize only when starting a sentence or in headings/labels.

What we are not:

- **Not a coach.** We don't say "Great job!" or "Nice work configuring your agents!" The user got the result. They know.
- **Not a brand voice.** No "let's get those agents fired up!". The product is a tool, not a teammate.
- **Not anxious.** Errors describe a problem and a path forward — they don't apologize.

### Vocabulary

The canonical words for the things and states dmux exposes. Inconsistency here causes more confusion than any single bad sentence.

#### Status states — runs and agents

Use these exact words everywhere a status appears. Today's code uses a mix (`done`, `completed`, `idle`); standardize on the right column.

| State | Means | Use for |
|---|---|---|
| `proposed` | Planner produced a config; awaiting human approval | Wave 2B only |
| `pending` | Config saved, not yet started | Run lifecycle (rare; usually skipped) |
| `running` | Currently executing | Runs, agents |
| `waiting` | Blocked on an upstream dependency | Agents only |
| `completed` | Finished successfully | Runs, agents (**replaces `done` in current code**) |
| `failed` | Exited non-zero or otherwise errored | Runs, agents |
| `cleaned` | Worktrees removed; record retained | Runs only |
| `abandoned` | Spawn flow started but never produced a config | Runs only |

Forbidden synonyms in user-facing copy: `done`, `finished`, `success`, `error`, `crashed`, `in progress`, `active`, `dead`, `stale`, `closed`.

**Project state** is distinct from run/agent lifecycle. A project is `idle` (no active runs) or `running` (one or more runs in flight). These are derived, not lifecycle states — a project doesn't transition through them in sequence the way a run does. Render on `ProjectCard` and in project summaries.

#### Domain nouns

| Term | Meaning | When to use |
|---|---|---|
| **Project** | A registered codebase (entry in `~/.config/dmux/projects`) | Always when referring to one |
| **Run** | One execution of one or more agents in a project | The unit of activity |
| **Agent** | One Claude or Gemini instance with a single role | Never "bot", "worker", "actor", "instance" |
| **Role** | What the agent does: `plan`, `build`, or `review` | The three values are nouns themselves |
| **Skill** | A reusable agent-config template | Not "preset", "template", "workflow" in copy |
| **Plan** | A markdown file produced by a plan-role agent | Capitalize only as a heading/label |
| **Proposal** | A draft agent config awaiting human approval (Wave 2B) | Distinct from `Plan` |
| **Worktree** | A git worktree directory the agent operates in | Hide from primary surfaces; advanced/settings/error copy only |
| **Provider** | The AI CLI backing an agent (`claude` or `gemini`) | Settings only |
| **Model** | The specific model an agent runs (`opus`, `sonnet`, `haiku`) | Agent editor, run view |

Things we do **not** name as first-class concepts in copy:

- "Session" — used in `tmux` but confusing alongside Run; only surface in advanced/settings.
- "Pane" — `tmux` term; advanced/settings only.
- "YAML" or "config file" — the form is the surface. The YAML is "the underlying config file" if we have to mention it.

#### Button verbs

| Verb | When |
|---|---|
| **Add** | Create a new entity (Add project, Add agent, Add path) |
| **Remove** | Delete an entity (Remove project, Remove agent) |
| **Save** | Persist edits without further action |
| **Save & Run** | Persist edits and start the run |
| **Start** / **Stop** | Begin/end a process (Start run is implied by "Save & Run" or "Run"; Stop run is explicit) |
| **Open** | Navigate into something detailed (Open run, Open agent) |
| **View** | Inspect something without changing it (View violations, View diff) |
| **Edit** | Open something for modification (Edit config) |
| **Cancel** | Abandon the current sheet/flow |
| **Discard changes** | Throw away unsaved edits in a page-level editor (where "Cancel" would be ambiguous) |
| **Dismiss** | Close a banner or toast |

Forbidden verbs: **Submit, OK, Apply, Execute, Process, Manage, Configure.** They're vague.

#### Note on variant prop names vs user-facing copy

The forbidden-synonyms rule applies to **strings the user reads**, not to component variant prop names. Code like `<Toast variant="success">` and `<Badge tone="failed">` is fine — these are internal taxonomy. The visible string inside the component must follow the rules above (e.g., a Toast with `variant="success"` says "Project added", not "Success!").

### Patterns

#### Errors

Three parts, ordered: what failed, why, what to do.

> Couldn't save `.dmux-agents.yml` — the project folder is read-only. Change folder permissions and try again.

> Failed to start agents — `claude` is not in your PATH. Install Claude Code, then retry.

> The skill `tdd-feature` couldn't be applied — its template references an unknown input `framework`. The skill may be incompatible with this version of dmux.

Not:

> ❌ ~~"Error: save failed"~~
> ❌ ~~"Oops! Something went wrong"~~
> ❌ ~~"An unexpected error occurred. Please try again."~~

If the underlying error string is unhelpful, **don't show it raw** — translate it. Show the raw string under a "Show details" disclosure for advanced users.

#### Empty states

Three slots: headline, optional context, primary action. No CLI references.

**Dashboard, no runs ever:**

> No runs yet
>
> Start your first agent run from a project, or pick a skill to spawn a team.
>
> `[+ New Run]`  `[Browse projects]`

**Projects, no projects:**

> No projects yet
>
> Add a project to register a codebase with dmux, or adopt an existing repo to bootstrap one quickly.
>
> `[+ Add project]`  `[Adopt an existing repo]`

**Project Detail, no runs in history:**

> No runs yet on this project — `[+ New Run]` to start one.

**Skills, no skills installed (shouldn't happen, but):**

> Built-in skills are missing
>
> dmux ships with skills bundled. Reinstall dmux to restore them.

Notice none of these say `dmux -a` or `dmux skills install` — they all surface in-UI actions.

#### Confirmations (destructive actions)

Always name the noun and state the consequence. Use a `Sheet[dialog]`, not `confirm()`.

**Remove project:**

> Remove **dmux** from dmux?
>
> This only removes the project from dmux's registry. Files on disk are untouched.
>
> `[Cancel]`  `[Remove project]`

**Overwrite config:**

> Overwrite `.dmux-agents.yml`?
>
> The current config will be replaced with the one generated by **tdd-feature**.
>
> `[Cancel]`  `[Overwrite & start]`

**Stop run:**

> Stop run?
>
> Agents will be terminated. Worktrees stay until you clean them up. This can't be undone.
>
> `[Cancel]`  `[Stop run]`

#### Form labels and helper text

**Label format:** sentence case, no trailing colon ("Session name", not "Session Name:" or "session_name:").

**Helper text:** one sentence, declarative, says what the field is *for* — not what to type.

> ✅ "Used in branch names and run output paths."
> ❌ ~~"Enter a session name."~~

**Required fields:** asterisk after the label + `aria-required`. No "(required)" suffix — wastes space.

**Placeholders:** example values only, never instructions. `myproject` is fine; `Enter a name` is not.

#### Loading and progress

- "Loading…" is acceptable only briefly. Use `Skeleton` for anything ≥1s.
- Button loading state: replace label with a spinner; do not change the button width.
- For long async actions (e.g., spawning a run that takes ~5s): show optimistic UI immediately, then a Toast on completion.

#### Toasts

Short. One sentence. No periods.

- Success: "Project added"
- Info: "Spawning agents…"
- Error: "Couldn't save — write permission denied"
- Warning (rare): "Provider gemini unreachable — falling back to claude"

If you can't say it in one sentence, use a Banner or inline message, not a Toast.

### Microcopy rewrites for Wave 1

Concrete strings in current source that change as part of Wave 2A's first PR after extraction. (Line numbers from initial audit.)

| File / location | Current | Replace with |
|---|---|---|
| `ProjectsGrid.jsx:99` | `dmux -a myproject ~/code/myproject` | Empty state pattern above (CTA buttons, no CLI) |
| `ProjectDetail.jsx:185` | "Remove this project from dmux (does not delete files)" | "This only removes the project from dmux's registry. Files on disk are untouched." (in confirmation sheet, not inline) |
| `ProjectDetail.jsx:162` | "No .dmux-agents.yml found for this project." | "No agents configured yet for this project." |
| `Skills.jsx:147–152` | CLI hint footer | Remove entirely. CLI documentation belongs in README. |
| `AgentSession.jsx:307` | `Saving...` toast | "Saving config" |
| `AgentSession.jsx:248` | `'Agents started! Check your terminal.'` | "Run started" (Toast) + navigate to Run Detail (so user doesn't *need* the terminal) |
| `SkillPicker.jsx:55` | "Use Skill" | "Run skill" (verb-led, matches button-verb convention) |
| `SkillPicker.jsx:71` | "Generate" / "Run" buttons (ambiguous) | "Save config" / "Save & run" (matches editor convention) |
| `Skills.jsx:71` | "Reusable agent workflows you can install into any project" | "Pre-built agent teams you can run on any project." (no jargon "workflow", says what they do) |
| `StatusTable.jsx:3` | `done` status label | `completed` |
| `Navbar.jsx:13` | "Projects" / "Skills" | Same, plus add **Dashboard** as first link (per Section 2). |

### README and marketing claims

What dmux is allowed to claim — and not — when it ships publicly.

**Allowed:**

- "Multi-agent orchestration for codebases."
- "Run Claude or Gemini agents in parallel git worktrees."
- "Web UI and CLI — your choice."
- "Works with keyboard navigation and screen readers (best-effort)."
- "Built-in skills for common workflows: TDD, code review, refactoring, security audits."
- "Open-source, locally-run, no telemetry."

**Not allowed (and why):**

- ❌ "WCAG AA compliant" — we haven't audited or tested formally.
- ❌ "Fully accessible" — same.
- ❌ "Production-ready for teams" — Phase 3 hasn't shipped.
- ❌ "Enterprise-grade security" — we have no enterprise security work.
- ❌ "Replaces your engineering team" — false; we orchestrate agents that need supervision.
- ❌ "Autonomous coding agents" — the agents need a human in the loop for almost every non-trivial task.

**Tagline candidates** (pick one, or roll your own):

1. *"Run Claude and Gemini agents on your codebase, in parallel, from a CLI or the web."* — descriptive, no hype.
2. *"A command center for AI agents on your code."* — Maestro-shaped, slightly more aspirational.
3. *"Orchestrate AI agents like git worktrees: parallel, isolated, reviewable."* — technical audience, signals the architecture.

I'd pick (1) for the README, (2) for a hypothetical landing page, (3) for HN.

### Decisions to confirm before closing the design pass

1. **`completed` replaces `done` everywhere.** Touches `StatusTable.jsx:3` and any callers; small but real change.
2. **Run nouns use lowercase in body copy** (`spawn a new run`), capitalized only in headings/labels (`New Run`).
3. **Tagline picked from the candidates above** — defer if not ready.
4. **Skill description copy gets a pass.** Current built-in skill descriptions (in `skills/*/skill.yml`) are inconsistent in voice; one cleanup pass before public.
5. **README rewrite is part of Wave 2A close-out**, not 2C. Public-readiness can't wait for adoption flow.

---

## Design pass — wrap-up

All six sections are drafted. The design pass concludes with this doc as the artifact; subsequent waves of design (2B, 2C) live in sibling docs (`wave-2b.md`, `wave-2c.md`) and inherit primitives and conventions from this one.

### What's next

In rough order, with the decision flag from each section attached:

1. **Review pass on this document.** Push back on anything in the six sections, especially the cross-cutting decisions:
   - Run as a first-class noun (§2)
   - Dashboard at `/` (§2)
   - Spawn flow as a modal sheet (§2)
   - Token-driven focus ring (§5)
   - `--text-muted` forbidden for content (§5)
   - `done` → `completed` (§6)
2. **Bash → Node extraction PR.** Implement the seam decided in the strategic conversation (project memory: [[dmux-bash-to-node-extraction]]). Move YAML parsing into `dmux-core/` first. No new features. **Day 1.**
3. **Wave 2A feature work, in order:**
   - Token + focus ring + theme primitives (§5 fixes).
   - `Button`, `Input`, `Sheet`, `Card`, `Badge` primitives (§3).
   - `Model` field in agent config (the smallest feature that proves the extraction works end-to-end).
   - `plan` role + plan-output convention.
   - `ListEditor` + Agent editor refactor.
   - `DAGView`.
   - `Run` noun + persistence + Dashboard + Run Detail + Agent Detail.
   - Scope-violation check + ScopeViolationViewer.
   - New Run sheet (Quick path skeleton).
   - Copy rewrites + README pass.
4. **Wave 2B design pass** (`wave-2b.md`): parameterized skills, NL planner, Smart spawn path.
5. **Wave 2C design pass** (`wave-2c.md`): adopt-repo flow, ramp-up agent, CLAUDE.md generation.

### Open questions worth a follow-up conversation

- **Markdown library** for plans and CLAUDE.md preview — pick one (`react-markdown` is my default; commit before Wave 2A starts using it).
- **DAG layout** library vs hand-rolled — `dagre-d3` is the obvious dependency; tiny but adds a build cost. Decision can wait until the first DAG implementation PR.
- **Settings page** — Wave 2A surfaces settings via a Disclosure on Project Detail; eventually it deserves a real page. Worth a short side-design before public release.
- **Telemetry** — explicitly out of scope for Wave 2A, but public-ready will get the question "does dmux phone home?". Decide and document the answer.
- **Theme switcher** (light mode) — deferred but the user demand for it on public will be real. Add to Wave 2B/2C scope discussion.

The design pass is complete. Implementation begins with the extraction PR.

---

## Consolidation notes

A pass made after all six sections were drafted, reconciling drift between sections.

**Status terminology unified to Section 6's vocabulary.** Wireframe occurrences of `done` in §4.4, §4.7, §4.8 replaced with `completed` (or, in the mini DAG node where the box is tight, reduced to the `✓` glyph alone — status text appears in the adjacent table). The Section 3 status map now uses `completed → green` instead of `done → green`.

**`Save & Start` → `Save & Run`** in the §4.6 New Run sheet wireframe. Section 6's button-verb table defines `Save & Run`; the spawn sheet had drifted to `Save & Start`. Aligned.

**`Cancel` → `Discard changes`** in the §4.5 Agent Config Editor footer. The editor is a page, not a sheet, so "Cancel" was semantically ambiguous (per Section 6's definition of Cancel as "abandon the current sheet/flow"). Added `Discard changes` to Section 6's button-verb table.

**Project state clarified separately from run/agent lifecycle states.** `idle` and (project-level) `running` describe a project's *current activity*, not a lifecycle. Section 6 now distinguishes these from the run/agent state table.

**Variant prop names vs user-facing copy** — clarified in Section 6 that forbidden-synonym rules apply only to strings the user reads. `<Toast variant="success">` is fine as a prop; the user-visible string inside still must follow the copy rules.

**Forward references resolved.** Section 3 had "Decide in Section 4" notes for DAG library and markdown library; Section 4 didn't decide. Pointers redirected to the wrap-up's Open Questions, which is where those decisions live.

**Token cleanup.**
- Spacing scale fixed from "4-step" (incorrect) to "6-step" (matches `--space-1` through `--space-6`).
- Added a note on the Badge `muted` tone vs the forbidden `--text-muted` token — they share a word but are different things; Badge tone uses Section-5-compliant text colors on a low-emphasis pill.

**Untouched (deliberate).** A few minor stylistic drifts were left alone:
- Section 1 uses "session" in describing Wave 1 (e.g. "past sessions") — accurate to the audit subject; the term is correctly demoted from Wave 2 vocabulary in Section 6.
- Section 3's reference to `Section 5 confirms exact attributes` and `Section 5 ratifies the exact value` — those forward references *do* resolve, so left as-is.
- Wireframe agent names (`engineer`, `engineer-auth`, `build-oauth`) are examples; minor inconsistency across examples is acceptable.

**Things this pass did not change** (still open, intentionally):
- Choice of markdown library (`react-markdown` is my default).
- Choice of DAG layout (`dagre-d3` vs hand-rolled).
- Tagline selection from the three candidates in §6.
- Whether `idle` deserves a Badge tone separate from `muted` (currently mapped to `muted`).

If the reviewer wants any of those listed-as-untouched items resolved before implementation, flag and I'll handle them in the same pass.
