# dmux — Wave 3C Design Pass

Status: drafting before implementation. Pair-mode review welcome.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-3b.md`. Parent: `wave-3.md` (3C is the third of six sub-waves).

---

## Where Wave 3B left us

After 3B, dmux has project-scoped and global chat, both bridged back to action via "Convert to proposal." The Maestro-shaped loop is end-to-end across multiple surfaces.

What's still locked into one provider: **the agents that actually do the work in each run.** dmux's schema has accepted `provider: gemini` since Wave 2A, and the bash side has a real provider registry (`provider_binary`, `provider_auto_accept_flag`, `provider_process_name`) wired for claude + gemini. But:

- We've never actually shipped a verified end-to-end run on a non-Claude provider.
- Codex / OpenAI runners aren't in the registry at all.
- There's no UI surface for picking provider per agent — users have to hand-edit YAML.
- There's no documented contract for adding a new runner — extending the bash case statements works in practice but no one outside dmux maintainership would discover it.

Wave 3C closes those gaps **narrowly**:

1. **Codex as a third provider** — add to the dmux-core validator, the bash provider registry, and the planner-prompt's model alias list. Bring it to parity with claude + gemini for the things dmux actually exercises (binary, auto-accept flag, ps-grep name).
2. **End-to-end verification on Gemini and Codex** — actually run a real multi-agent team using each, not just paper-launch. This is the load-bearing piece of 3C; the schema/registry plumbing is cheap.
3. **Capability matrix in the UI** — when picking a provider for an agent, show what's supported (auto-accept flag, model aliases, MCP) and what isn't. Surfaces silent-degradation risks before they surprise the user.
4. **A documented contract for adding a runner** — a short `docs/providers.md` explaining the registry + how a fourth provider would plug in.

Self-hosted / open-weights runners and cross-provider handoff inside one run are **out of scope** per `wave-3.md` §3C — the latter is 3E.

### Auth: no new auth model

dmux's own LLM use (planner / discovery / chat) stays on Claude Max via `claude --print`, per the Wave 3B decision. **Provider choice in Wave 3C is for agents in a run, not dmux infrastructure.** If a user picks `gemini` for an agent, they're responsible for the Gemini CLI being installed and authed; same for Codex. dmux doesn't introduce or manage those credentials.

---

## Section 1 — Concepts introduced in Wave 3C

Three concepts, all small.

### 1.1 The provider registry

A formalized version of what bash already has. The "registry" is the set of cases in three bash functions plus the validator's `VALID_PROVIDERS` + `MODEL_ALIAS_PATTERNS`. Slice 1 expands it to three entries:

| Provider | Binary  | Auto-accept flag                     | Model aliases     |
|----------|---------|--------------------------------------|-------------------|
| claude   | claude  | `--dangerously-skip-permissions`    | opus, sonnet, haiku |
| gemini   | gemini  | `--yolo`                             | pro, flash        |
| codex    | codex   | (TBD — confirm during impl)          | (TBD — confirm)   |

The "TBD" rows get pinned during Slice 1 by reading Codex CLI's actual docs. The design doc records them once confirmed.

The registry is intentionally narrow. Things NOT in it:
- Plan-mode flags (`--permission-mode plan` etc.) — dmux's "plan" role today just means "this agent writes a markdown doc that downstream agents read." It doesn't invoke any provider's plan-mode. Provider-agnostic by accident; we keep it that way.
- Streaming flags — agents run in tmux panes; their stdout streams to the pane natively whether or not the CLI streams to its own stdout.
- MCP server config — orthogonal; lives in `.dmux-agents.yml` per-agent or per-project (and is a Wave 3D problem anyway).

### 1.2 The capability matrix

Some features differ across providers. Wave 3C shows the user the matrix at the moment they pick a provider, so silent degradation doesn't surprise them. The matrix in v1:

| Capability                        | claude | gemini | codex |
|-----------------------------------|--------|--------|-------|
| Auto-accept (`-y`-style)          | ✓      | ✓      | TBD   |
| Per-agent model selection         | ✓      | ✓      | TBD   |
| Post-hoc scope enforcement        | ✓ (via git diff — works for any CLI that produces commits) | ✓ | ✓ |
| MCP support (Wave 3D)             | ✓ (Claude Code) | ✓ (preview) | TBD |
| Tool use during chat (Wave 4)     | n/a    | n/a    | n/a   |

The matrix is data, not opinion — a JSON file under `dmux-ui/src/` that the UI reads. Adding a new provider means adding a row + an entry to the bash registry.

### 1.3 Provider picker in the UI

Today the agent-level `provider:` field is set in three places:

- A skill YAML (built-in skills hardcode `provider: claude`)
- The NL planner's output (defaults to whatever its prompt suggests)
- The user editing `.dmux-agents.yml` directly

3C adds a fourth surface: the **Customize before approving** panel from Wave 2D Slice 3. Currently that panel lets the user rename agents + pick a model. v1 of 3C extends it with a provider picker per agent. Changing the provider implicitly resets the model to that provider's default (sonnet for claude, pro for gemini, etc.) since the model namespaces don't overlap.

Other UI surfaces (the proposed-agents table on the review page, the agents table on the run detail page) **just display** the provider — they don't get a picker. The customize panel is the canonical edit surface for v1.

---

## Section 2 — End-to-end flow (the parts that change)

### 2.1 Spawning a run with a non-Claude provider

Today (with claude):
1. User adopts / proposes / spawns a run.
2. Proposal lands; user reviews.
3. Approve → bash launches agents, each shelling `claude --dangerously-skip-permissions --model sonnet` (per the per-agent config).

Wave 3C with gemini or codex:
1–2 unchanged.
3. Approve → bash launches each agent shelling the resolved binary with the resolved flag and model. The provider registry decides what to invoke.

The only difference is the binary. From dmux's perspective the agent's lifecycle (signal files, scope-violation checks, changelog generation, completion notifications) is identical.

### 2.2 Customize panel with provider picker

Wireframe:

```
┌─ Customize before running ─────────────────────────────────────────┐
│                                                                    │
│  Rename agents to make them yours. Heavier edits — use "Edit       │
│  before running" instead.                                          │
│                                                                    │
│  Agent 1: planner            (role: plan)                          │
│    Name: ┌─────────────────────────────────┐                       │
│          │ planner                         │                       │
│          └─────────────────────────────────┘                       │
│    Provider: [claude ▾]    Model: [sonnet ▾]                       │
│                                                                    │
│  Agent 2: auth-builder       (role: build)                         │
│    Name: ┌─────────────────────────────────┐                       │
│          │ auth-builder                    │                       │
│          └─────────────────────────────────┘                       │
│    Provider: [gemini ▾]    Model: [pro ▾]                          │
│                                                                    │
│  Capabilities for current selections:                              │
│    · gemini: auto-accept ✓, MCP preview, no plan-mode              │
│                                                                    │
│  [Cancel]                          [Save & Approve]                │
└────────────────────────────────────────────────────────────────────┘
```

The capabilities line under the agents reflects the current selections. v1 keeps the matrix display compact — a one-line summary per non-default provider. Detailed matrix viewing is a (small) follow-up.

### 2.3 Documented contract for adding a runner

A new `docs/providers.md` (~50 lines) covering:

- The 3 bash functions that need cases added (`provider_binary`, `provider_auto_accept_flag`, `provider_process_name`).
- The dmux-core validator entries (`VALID_PROVIDERS`, `VALID_MODELS_BY_PROVIDER`, `MODEL_ALIAS_PATTERNS`).
- The capability matrix JSON entry.
- A "things to verify when adding" checklist: end-to-end run, scope enforcement, auto-accept actually suppresses prompts, model aliases match what users will write.

Lives alongside `docs/notifications.md` from Wave 3A. Same target audience: people reading the source who want to extend it.

---

## Section 3 — Implementation surface

### 3.1 dmux-core additions

- `VALID_PROVIDERS`: add `'codex'`.
- `VALID_MODELS_BY_PROVIDER.codex`: the OpenAI Codex CLI's accepted model aliases (confirmed during impl).
- `MODEL_ALIAS_PATTERNS`: regexes mapping fully-qualified OpenAI ids to aliases, mirroring the existing claude/gemini patterns (e.g. `/^gpt-5-codex/i → 'codex'` or whatever pans out).
- New tests in `config.test.js`: 2–3 tests covering codex parsing + alias normalization. dmux-core tests should be 100+ after Wave 3C.

### 3.2 Server additions

- Capability matrix lives at `dmux-ui/server/lib/providers.js` (new) as a constant. Exposed via `GET /api/providers` — the UI reads it to populate the picker and the capability-line summary.
- That's it on the server. The launch path is bash; the server doesn't actually shell to provider CLIs except for dmux's own planner/discovery/chat which stays claude-locked.

### 3.3 UI additions

- `dmux-ui/src/components/CustomizePanel.jsx` (extended): the per-agent row gains a `Provider` Select alongside the `Model` Select. Changing provider resets model to that provider's first listed alias.
- `dmux-ui/src/components/ProvidersCapabilityLine.jsx` (new, tiny): renders the one-line summary for the providers in use.
- `dmux-ui/src/hooks/useProviders.js` (new, also tiny): single fetch of `/api/providers` on mount, cached for the session.

### 3.4 Bash additions

- `provider_binary`, `provider_auto_accept_flag`, `provider_process_name`: add `codex)` cases.
- The customize-customize endpoint (`POST /api/projects/:name/runs/:proposalId/customize`) already accepts model overrides; it gains provider overrides too. Server-side YAML rewrite logic in `customizeProposal` extends to set both `provider:` and `model:` per agent. The `depends_on` rewrite from Wave 2D continues to work unchanged.

### 3.5 What about the planner / discovery / chat?

**Unchanged.** All three keep shelling `claude --print` on Max. They generate configs that may reference any provider, but they don't invoke those providers themselves.

The NL planner's prompt mentions only Claude models today. v1 of 3C leaves this alone — proposed teams default to claude unless the user picks otherwise via Customize. A future revision could teach the planner to propose non-claude teams when the user's prompt hints at it ("...using gemini..."), but that's planner-prompt work, not provider-runner work.

---

## Section 4 — Decisions to confirm before implementation

These are the load-bearing choices.

1. **Codex is the third provider.** No other v1 additions (no Cursor agents, no local llama, no open-router proxy). Recommended: confirm.

2. **dmux-internal LLM calls stay Claude-only.** Planner, discovery, chat all keep using `claude --print`. Provider choice is for agents-in-a-run only. This was reinforced by the Wave 3B SDK-rejection decision; restating it here for clarity. Recommended: confirm.

3. **Codex CLI specifics get pinned during Slice 1.** Auto-accept flag, model aliases, and confirmation that it produces git commits compatible with dmux's scope-enforcement post-hoc check are all empirical questions answered by actually installing and running the CLI. The design doc records what we find. Recommended: confirm.

4. **Provider picker lives only in the Customize panel for v1.** Not on the new-run sheet, not on the proposal review table. Customize is the canonical edit surface; everywhere else just renders the provider. Recommended: confirm — keeps the surface small.

5. **Changing provider resets model.** Because model namespaces don't overlap (claude/sonnet, gemini/pro, codex/...), you can't keep a model when switching provider. The UI auto-picks the new provider's default; user can change. Recommended: confirm.

6. **Capability matrix is a static JSON, not derived.** Hand-maintained alongside the bash registry. Recommended: confirm — small, low-churn.

7. **Customize endpoint extends; no new endpoint.** Per-agent model + provider overrides go through the same `POST /customize` route from Wave 2D. Recommended: confirm.

8. **End-to-end verification must include a real run on each provider.** Not just "the bash invoked the right binary" — an actual agent that produces commits and goes through the dmux scope/changelog/notification path. Recommended: confirm — this is the load-bearing piece.

9. **`docs/providers.md` is the contract doc, not a separate spec file.** Same place pattern as `docs/notifications.md`. Recommended: confirm.

---

## Section 5 — Open questions (defer to implementation if not blocking)

1. **Codex auto-accept flag name.** Pin during Slice 1 by reading `codex --help`. If there isn't one, document the gap (provider table shows ✗) and decide whether to ship without it or block on getting one.
2. **What happens if a user picks a provider whose binary isn't installed?** Today's behavior: agent tries to start, the binary is missing, the agent dies on first run, dmux marks it failed. Improvement: pre-flight check in `customizeProposal` (or even `approveProposal`) that warns when any agent's provider binary isn't on PATH. Worth doing in 3C? Lean yes; small.
3. **Gemini's MCP preview.** The matrix lists it as "preview." If the gemini CLI's MCP support is too half-baked to be useful, we mark it ✗ and tell the user "Wave 3D MCP integrations support claude only at first." Pin during implementation.
4. **NL planner provider awareness.** Out for v1 (per §3.5). Tracked as a future item if it becomes friction.
5. **Per-project default provider.** Currently the top-level `.dmux-agents.yml` config has `provider: claude`. Should the customize panel let the user change the project-wide default in addition to per-agent? v1 says no — per-agent is sufficient surface area.

---

## Section 6 — What's explicitly NOT in Wave 3C

Reserved for later sub-waves or never:

- **Self-hosted / open-weights runners.** Wave 3F or later.
- **Cross-provider agent handoff within one run.** Wave 3E.
- **The NL planner proposing non-Claude teams by default.** Out for v1.
- **Cursor / Aider / other coding agent integrations** that aren't simple CLI binaries. Different shape.
- **Provider-specific auth surfaces in dmux.** Users manage their gemini / openai credentials themselves.
- **Per-provider feature flags beyond the small capability matrix.** Don't pre-build for hypothetical differences.
- **A provider-aware planner prompt.** Mentioned as a future item but not in 3C.

---

## Implementation order (after this doc is approved)

Two slices, one PR:

**Slice 1 — Codex provider end-to-end + verification.** ~1.5 days.
- dmux-core: add codex to `VALID_PROVIDERS`, `VALID_MODELS_BY_PROVIDER`, `MODEL_ALIAS_PATTERNS`. Tests.
- Bash: add codex cases to all three provider functions. Pin auto-accept flag during this slice.
- Verify end-to-end: install Codex CLI, run a small real team (codex + claude mixed) against a fixture, confirm signal files / changelog / scope enforcement / notifications all work.
- Same verification step against Gemini if not already verified recently (it should be from Wave 2A but explicit re-verify).

**Slice 2 — Capability matrix + Customize panel provider picker + docs.** ~1 day.
- `dmux-ui/server/lib/providers.js` + `GET /api/providers`.
- `useProviders` hook.
- `CustomizePanel` per-agent provider picker; reset model on provider change; show capability summary line.
- `customizeProposal` server fn extended to accept provider overrides; YAML rewrite respects both provider + model fields.
- `docs/providers.md` contract doc.

Total ~2.5 days. Wave 3C is done when a real multi-provider team has run end-to-end + the capability matrix renders correctly + the docs land.

---

*Ready for review. Push back on anything in Section 4 (decisions) before implementation begins.*
