# dmux — Wave 2D Design Pass

Status: drafting before implementation. Pair-mode review welcome.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-2c.md`. Successor: nothing yet (next is Wave 3 — see `wave-3.md`).

---

## Where Wave 2C left us

After Wave 2C (PR #39) merged, dmux can adopt a fresh repo end-to-end: the discovery agent reads it, writes a marker-wrapped `CLAUDE.md`, and stages a starter `.dmux-agents.yml` as a proposal. The flow works from both the UI (Adopt button on the Dashboard) and the CLI (`dmux adopt <path>`).

What 2C delivered was the **plumbing** of onboarding — register, discover, propose. What it deliberately deferred is the **experience** Maestro is known for: a conversation that helps the user shape what they're going to build, surface relevant skills they hadn't thought of, and feel ownership over the agents that get launched. Today after adoption the user lands on a proposal review page with a take-it-or-leave-it config; there's no surface to refine it, no recommendations, and no narrative.

Wave 2D closes that gap. Three threads:

1. **Discovery chat** — a chat surface scoped to the adoption proposal, with the discovery agent on the other side. User can ask follow-ups, request changes ("add a security review agent", "drop the planner — I already have a plan"), and either get the agent to re-emit an updated proposal or just learn about the repo.
2. **Skill recommendations** — discovery's output gains a third artifact: a list of `recommended-skills` from the installed catalogue. UI surfaces them on the proposal review page with one-click install.
3. **First-agent naming** — a lightweight customization step (rename agents, optionally tweak model) that runs between proposal review and approve. Makes the user the author, not the recipient.

Greenfield `dmux init` (discovery against an empty repo driven by "what do you want to build?") is **explicitly out of scope** — deferred to Wave 3 where it can land alongside the chat-in-dmux and markdown-PRD ingestion threads from `wave-3.md` §3A/3B.

---

## Section 1 — Concepts introduced in Wave 2D

Three new ideas land in this wave. Each is independently shippable; together they're the onboarding experience.

### 1.1 Proposal-scoped chat

The adoption proposal record (introduced in Wave 2C via `createProposal` with `trigger.type === 'adopt'`) gains a chat history. Each chat is a JSON array of `{ role, content, ts }` entries at `.dmux/chats/<proposalId>.json`. Chats are bound to the proposal — when the proposal is approved or discarded, the chat persists as audit trail but new messages stop accepting (UI hides the input).

**Why per-proposal, not per-project:** Wave 3 will introduce project-global and dmux-global chat (`wave-3.md` §3B). Per-proposal in 2D keeps scope tight and gives 3B a real precedent to generalize from. A project-global chat that exists before any proposal does is a different design problem.

**Conversation assembly:** each turn rebuilds the full conversation as a single prompt and shells `claude --print` (same primitive as the planner and discovery agent). No SDK migration in 2D — re-sending the full transcript every turn is wasteful but works, and prompt caching becomes worth the SDK migration only when we have several chat surfaces (Wave 3). Flagged in §7 as an open question.

**Cost ceiling:** soft cap at 15 messages per chat (warn in the UI), hard cap at 25 (button disables). Predictable per-proposal cost.

### 1.2 Recommended skills

Discovery's output schema changes from two fenced blocks to **three**:

```
```claude-md
<content>
```

```yaml
<starter agents config>
```

```recommended-skills
- name: graphify
  reason: "Codebase has 80+ files across many directories — a knowledge graph view will help the user orient before kicking off the first run."

- name: tdd-feature
  reason: "Test coverage is uneven (renderer.js has no tests). The TDD skill enforces test-first on future work."
```
```

The third block is optional — if discovery emits no recommendations, the UI just shows nothing. When recommendations are present, the proposal review page renders an "Install these to make future runs better" card with one-click install per skill (reuses the existing `installSkill` server fn from Wave 1).

**Why optional, not required:** small repos with no obvious skill matches shouldn't force the agent to recommend something it doesn't believe in. The empty-list case is a valid outcome.

**Re-running discovery after install:** **no auto-rerun** in v1. Installing a skill is a side-effect on the user's machine; conflating it with a fresh planning pass costs more tokens than it saves. The UI exposes a manual "Re-run discovery with installed skills" button as a follow-up action — flagged in §6.4 if we should ship this in v1 or defer.

### 1.3 First-agent naming

A lightweight pre-approve step. Today the proposal review page has three actions: **Approve & Run** / **Edit before running** / **Discard**. Edit-before-running drops the user into the full config editor — heavy lift for "just rename the planner".

Wave 2D inserts a fourth action: **Customize & Run**. Opens an inline panel on the same page that lets the user, per agent in the proposal:

- Rename the agent (string field, max 32 chars, must be unique within the proposal)
- Override the model (dropdown: opus / sonnet / haiku, defaulting to whatever the agent has)

Nothing else. Branches, scope, task, depends_on stay as discovery emitted them. If the user wants to edit those, **Edit before running** is still the right path (Wave 2B's existing flow). The narrow scope is the point — this is "make the first agent yours," not "rebuild the team."

On Save: server PATCHes the proposal record with the renamed agents + reshuffled `depends_on` references, then routes to the normal approve flow.

---

## Section 2 — End-to-end flow

### 2.1 UI happy path (after adopting a repo)

1. User completes adoption (existing 2C flow). Lands on proposal review at `/projects/:name/runs/:proposalId`.
2. Page now has **three new surfaces** alongside the existing review:
   - **Recommended skills** card (between the Adopted-from banner and the Proposed agents table) — only renders if `trigger.recommendedSkills` is non-empty.
   - **Customize & Run** action button (between Approve and Edit) — opens an inline customization panel.
   - **Chat with discovery** tab — adds a tab strip to the page; default tab is "Review" (current view), second tab is "Chat with discovery". Chat tab only present when `trigger.type === 'adopt'`.
3. User can mix-and-match: install one skill, chat to ask "what tests would you run first?", rename the planner agent, then approve.

### 2.2 Chat tab

```
┌─ Review | Chat with discovery ─────────────────────────────────────┐
│                                                                    │
│  Discovery: I read the repo. It's a small Express TODO API in     │
│             Node with Jest tests under `test/`. No auth, no       │
│             database — store is in-memory. I proposed a 4-agent   │
│             team focused on adding bcrypt+JWT auth with tests +   │
│             a security review.                                    │
│                                                                    │
│  You:       what's the right first agent to drop if I want a      │
│             smaller team?                                          │
│                                                                    │
│  Discovery: Drop the security-reviewer. The auth-builder + test-  │
│             builder pair gets you the feature; security review    │
│             is valuable but can run later as its own proposal.    │
│             Want me to re-propose with just those three?          │
│                                                                    │
│             [Yes, re-propose with 3 agents]                       │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│  Ask discovery a question…                                        │
│  ┌──────────────────────────────────────────────────────────────┐ │
│  │                                                              │ │
│  └──────────────────────────────────────────────────────────────┘ │
│                                                          [Send]   │
│                                                                    │
│  6 / 15 messages                                                  │
└────────────────────────────────────────────────────────────────────┘
```

When discovery offers a re-propose, the user clicks the inline button, the server runs discovery again (with the chat as additional context), updates the proposal record's `config.yaml` + `agentsSummary` in place (no new proposal record — same id), and the Review tab reflects the new team.

### 2.3 Recommended skills card

```
┌─ Recommended skills ──────────────────────────────────────────────┐
│                                                                    │
│  Based on what discovery saw, these skills will sharpen future    │
│  runs on this project:                                            │
│                                                                    │
│  ┌─ graphify ──────────────────────────────── [Install] ─┐        │
│  │  Knowledge-graph visualization for codebases. 80+    │        │
│  │  files across many directories — useful for          │        │
│  │  orienting before the first run.                     │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                    │
│  ┌─ tdd-feature ──────────────────────────── [Install] ─┐        │
│  │  TDD-first feature workflow. renderer.js has no      │        │
│  │  test coverage; this skill enforces tests-first.     │        │
│  └──────────────────────────────────────────────────────┘        │
│                                                                    │
│  [Skip — I'll install later]                                      │
└────────────────────────────────────────────────────────────────────┘
```

Install is per-skill. After install, the card shows ✓ Installed alongside that skill. Skip dismisses the card for this proposal (sticky per proposal, not project-wide).

### 2.4 Customize & Run panel

Inline on the review page:

```
┌─ Customize the team before running ───────────────────────────────┐
│                                                                    │
│  Rename agents to make them yours. Edit task, scope, etc. via     │
│  "Edit before running" if you need more than naming.              │
│                                                                    │
│  Agent 1: planner            (role: plan,  model: [sonnet ▾])     │
│    Name: ┌────────────────────────────────────────┐               │
│          │ planner                                │               │
│          └────────────────────────────────────────┘               │
│                                                                    │
│  Agent 2: auth-builder       (role: build, model: [opus ▾])       │
│    Name: ┌────────────────────────────────────────┐               │
│          │ auth-builder                           │               │
│          └────────────────────────────────────────┘               │
│                                                                    │
│  ... (rest of agents)                                             │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│  [Cancel]                              [Save & Approve]           │
└────────────────────────────────────────────────────────────────────┘
```

Renaming an agent A → A' must rewrite every other agent's `depends_on` that referenced A. Server-side, not client-side — keeps the rename safe under the YAML schema validator.

### 2.5 CLI parity (or lack thereof)

The chat surface and recommended-skills install are **UI-only** in Wave 2D. CLI parity is non-goal:

- The chat is fundamentally a UI experience; a text-mode chat in a terminal would be a different feature (and arguably the user is already in a chat with `claude` itself).
- Skill install via CLI already exists (`dmux skills install <name>`). The recommendations themselves can be surfaced as a one-line summary in `dmux adopt`'s success output (see §5.4) so CLI users can pipe to `dmux skills install`.
- First-agent naming via CLI is similarly low-value — anyone editing config via CLI is already comfortable opening the YAML.

If users push back, CLI parity becomes a Wave 3 sub-thread.

---

## Section 3 — The discovery prompt (updated)

The Wave 2C discovery prompt is updated to emit three blocks. Diff against `wave-2c.md` §3:

- Adds a section telling the agent it will receive a list of installed skills and optionally a list of available built-in skills it could recommend.
- Adds the `recommended-skills` block to the required output format, with explicit instruction that the list MAY be empty.
- Each recommendation needs a one-sentence reason tied to evidence the agent saw in the repo. No generic recommendations.

The full updated prompt is implemented in Slice 2 (recommended skills) and committed there; not repeated in full here.

---

## Section 4 — Wireframes

(Already shown in §2.2, §2.3, §2.4. No additional surfaces.)

---

## Section 5 — Implementation surface

### 5.1 dmux-core additions

Minimal — Wave 2D continues to be mostly server + UI work.

- **`updateProposal(projectPath, runId, { configYaml, agentsSummary })`** — new function. Replaces the proposal's frozen YAML and agents summary while keeping the run id and `proposed_at` unchanged. Throws if the run is no longer in `proposed` state. ~30 lines + 3 tests.
- No other dmux-core changes.

### 5.2 Server additions

In `dmux-ui/server/lib/dmux.js`:

- **Chat storage** — `readProposalChat(projectPath, proposalId)` / `appendProposalChatMessage(projectPath, proposalId, { role, content })`. Both round-trip a JSON array at `.dmux/chats/<proposalId>.json`. Atomic write via tmpfile + rename (match `writeAgentsConfig` pattern).
- **`runProposalChat(projectPath, proposalId, userMessage)`** — assembles the full conversation as a single prompt to `claude --print`, including discovery context (file tree, manifests, CLAUDE.md, current proposal YAML) and prior turns. Appends both the user message and the assistant response to the chat history. Returns the assistant message. Soft-cap at 15 messages with a flag in the response; hard-cap at 25 throws.
- **`runDiscoveryRefresh(projectPath, projectName, proposalId, additionalContext)`** — reuses `runDiscovery` but with the chat transcript folded in as `additionalContext`. Returns the updated `{ claudeMdContent, agentsYaml, recommendedSkills }`. Caller decides what to do with the output (chat handler updates the proposal in-place).
- **`updateProposalConfig(projectPath, proposalId, newYaml, agentsSummary)`** — thin wrapper over dmux-core's new `updateProposal`. Validates the new YAML before writing.
- **Recommended-skills parsing** — extend `runDiscovery` to extract the optional `recommended-skills` block, validate against installed/available catalogue, store on the proposal at `trigger.recommendedSkills` (array of `{ name, reason, installed: boolean }`).

In `dmux-ui/server/index.js`:

- **`GET /api/projects/:name/runs/:proposalId/chat`** — returns the chat history.
- **`POST /api/projects/:name/runs/:proposalId/chat`** body `{ message }` → appends user msg, runs the chat, appends assistant msg, returns `{ message: { role: 'assistant', content }, messageCount }`. Status mapping: 404 (no proposal), 409 (proposal terminated), 429 (hard cap exceeded), 422 (LLM failure), 503/504 (claude not on PATH / timeout).
- **`POST /api/projects/:name/runs/:proposalId/regenerate`** body `{}` → runs `runDiscoveryRefresh` using the current chat as context, updates the proposal in place, returns the new agents summary.
- **`POST /api/projects/:name/runs/:proposalId/customize`** body `{ renames: [{ from, to }], modelOverrides: [{ agent, model }] }` → applies renames + model overrides to the proposal YAML (server-side rewrites `depends_on` references), validates, calls `updateProposalConfig`. Returns the new proposal state.
- Recommended-skills install reuses the existing `POST /api/projects/:name/skills/:skill` endpoint — no new endpoint.

### 5.3 UI additions

In `dmux-ui/src/components/`:

- **`ProposalChat.jsx` + module CSS** — message list + composer + message-count footer. Reuses `react-markdown` (already a dep) to render assistant messages. Inline "regenerate proposal" button when the assistant includes a structured suggestion.
- **`RecommendedSkillsCard.jsx`** — list of recommended skills with per-skill Install button + Skip-all action. Reuses existing skill-install primitives from Wave 1.
- **`CustomizePanel.jsx`** — inline form on the review page. Per-agent name input + model select. Save button calls the customize endpoint.

In `dmux-ui/src/pages/RunDetail.jsx`:

- The proposal review view (when `run.status === 'proposed'`) gains a tab strip when `trigger.type === 'adopt'`. Two tabs: Review (current view) / Chat with discovery.
- The Review tab gains the Recommended-skills card (between the Adopted-from banner and the Proposed-agents table) and the Customize & Run button (between Approve and Edit).

In `dmux-ui/src/pages/AdoptSheet.jsx` (Wave 2C):

- Success toast: append a "X skills recommended" line if `recommendedSkills.length > 0` so the user knows to look on the review page.

### 5.4 CLI additions (one line)

In `dmux.sh`'s `handle_adopt_command`:

- After the success-line block, if the response includes `recommendedSkills`, print:
  ```
  Recommended skills based on this repo:
    · graphify — Knowledge graph for orienting on large codebases
    · tdd-feature — TDD-first feature workflow

  Install with: dmux skills install <name>
  ```

That's the entire CLI-side change. ~15 lines.

---

## Section 6 — Decisions to confirm before implementation

These are the load-bearing choices. Push back on any of them.

1. **Three slices, one wave.** Confirm 2D ships all three threads (chat, recommendations, customize) rather than splitting into 2D + 2E. Trade-off: bigger wave, but the three threads share the proposal-review page surface area — splitting means two passes editing the same files. Recommended: ship as one wave.

2. **Chat scope: per-proposal only in 2D.** Project-global and dmux-global chats are explicitly Wave 3. Recommended: confirm.

3. **Conversation assembly: manual via `claude --print`.** Not SDK. Accept the inefficiency for v1. If Wave 3 ships project-global chats this WILL flip and the chat code will need to be revisited. Recommended: confirm with the understanding it's revisitable.

4. **Auto-rerun discovery after skill install: no.** Manual button on the review page instead. Reason: cost predictability. Recommended: confirm.

5. **Customize panel: name + model only.** No editing of task, scope, branch, or depends_on. Heavier edits route to the existing Edit-before-running flow. Recommended: confirm. The naming step is the narrative; full editing is a different UX.

6. **Customize implementation: server-side YAML rewrite, not client.** Renaming an agent rewrites `depends_on` references on the server, then re-validates via `parseAgentsConfig`. Client passes intent (`renames: [{from, to}]`), not raw YAML. Recommended: confirm — keeps the schema-validation guarantee.

7. **Recommended-skills block format: YAML-like list under a custom fenced language tag.** Not strictly YAML, but parseable line-by-line with a simple regex. Alternative: emit the recommendations inside the existing yaml block as a `_recommended_skills` field. Recommended: custom fenced block — keeps the agents YAML clean (no dmux-specific extensions to the schema).

---

## Section 7 — Open questions (defer to implementation if not blocking)

1. **Chat resumption after browser reload.** UI re-fetches `GET /chat` on mount. No special token-streaming. Fine.
2. **Concurrency: user opens chat in two tabs.** Each POST is serialized server-side via the chat-file atomic write; two near-simultaneous messages will land in send-order. Edge case; live with it.
3. **What if `claude` returns no answer or an empty response?** Treat as a single retry; on second empty response, return the error to the UI with "the agent didn't have a response — try rephrasing."
4. **Should chat have its own model picker?** Defaulting to sonnet matches discovery. Per-chat model override is a Wave 3 problem.
5. **Should `recommended-skills` ever recommend skills that aren't installed?** Yes — installed catalogue + first-party built-ins are both shown. Discovery is told which is which so the install button can be wired correctly.
6. **What happens if the user installs a skill, then chats with discovery, then re-generates the proposal?** The new proposal should reflect the now-installed skill. Out of scope for 2D's first cut — re-discovery via the chat-driven regenerate endpoint will pick up newly-installed skills automatically because the prompt re-pulls the skill list.
7. **SDK migration trigger.** Re-evaluate after Wave 2D ships. Pressure point: if chat tokens become a significant fraction of total spend, or if we add a second chat surface (Wave 3 project-global).

---

## Section 8 — What's explicitly NOT in Wave 2D

Reserved for Wave 3 or later:

- **Greenfield `dmux init`** — discovery against an empty/near-empty repo driven by "what do you want to build?" — Wave 3 (or a sub-thread once we feel 2D in use).
- **Project-global and dmux-global chats** — Wave 3 (`wave-3.md` §3B).
- **Anthropic SDK migration for chat** — wait for cost/feature pressure.
- **CLI parity for chat / customize** — non-goal; revisit if users push back.
- **Per-chat model overrides** — Wave 3.
- **Streaming responses** — single-shot via `--print`; streaming requires SDK migration anyway.
- **Tool use during chat** — discovery's context is loaded once at chat start; mid-conversation file reads are out of scope.
- **Chat search/filter/export** — per-proposal scope; chat lifetime tied to the proposal record.

Anything in this list that creeps into 2D implementation needs explicit justification or gets bounced.

---

## Implementation order (after this doc is approved)

Three slices, one PR (per §6.1) — three commits in dependency order:

**Slice 1 — Discovery chat surface.** ~1.5 days.
- dmux-core: `updateProposal` + tests.
- Server: chat storage helpers, `runProposalChat`, `runDiscoveryRefresh`, `updateProposalConfig`, three endpoints (GET chat, POST chat, POST regenerate).
- UI: `ProposalChat.jsx` + tab strip on `RunDetail.jsx` for adopt proposals.

**Slice 2 — Recommended skills.** ~1 day.
- Server: extend `runDiscovery` to extract the optional `recommended-skills` block. Update the discovery prompt. Validate against installed + available skills catalogue.
- UI: `RecommendedSkillsCard.jsx` rendered on the Review tab.
- CLI: print recommendations in `dmux adopt` success output.

**Slice 3 — Customize & Run.** ~1 day.
- Server: `POST /api/projects/:name/runs/:proposalId/customize` — rewrites YAML server-side, validates, calls `updateProposalConfig`.
- UI: `CustomizePanel.jsx` + button on the review page.

Wave 2D is done when all three land + end-to-end verified against a fresh real repo. Total ~3.5 days of compressed work.

---

*Ready for review. Push back on anything in Section 6 (decisions) before implementation begins.*
