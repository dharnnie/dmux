# dmux — Wave 3 Outline

Status: **outline only**, written ahead of time so we don't lose track of the product-experience layer while Wave 2 is in flight. Not yet a design pass. Do not start implementation until Wave 2C lands.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-2b.md`, then `wave-2c.md` (not yet written).

---

## Why Wave 3 exists

Waves 2A–2C give dmux a working foundation: multi-project state, parameterized skills, proposal lifecycle, NL-planned teams, and an onboarding flow for new repos. That is the **infrastructure** for the product the user described — it is not yet the product.

The vision goes further:

- A single place where the user juggles many projects at once.
- A workflow that starts in brainstorm (markdown PRD / feature spec) and lands as a running team without a translation step.
- A wrapper for *multiple* coding agents (Claude Code, Gemini, Codex, …), not just one.
- Real orchestration between agents, not just parallel isolation.
- Skills, agents, rules, and named workflows that are **shared** — discoverable and installable from a community catalogue, with recommendations during onboarding.
- Awareness when long-running work needs the user's attention, including when they're away from the keyboard.
- First-class integrations with the services the work touches (GitHub via MCP, etc.).
- A deliberate posture toward new Claude Code features as they ship — surface them, don't reimplement them.

Wave 3 is where those user-facing concerns become first-class. Solo-engineer focus continues; teams / self-hosted / SaaS are still later phases.

---

## Sequencing principle

Order tracks **leverage on the user's actual workflow**, not technical interest. Cheapest, highest-impact things first; ecosystem plays last because they need critical mass.

1. **3A — PRD ingestion + notifications** (unlocks the user's stated daily workflow)
2. **3B — Chat sessions inside dmux** (closes the brainstorm-to-action loop without leaving the app)
3. **3C — Multi-provider runners** (Gemini, Codex; broadens audience and reduces lock-in)
4. **3D — MCP integrations** (GitHub first; bridges dmux to where work actually lives)
5. **3E — Real agent orchestration** (handoffs, reviews, escalation — distinct from parallel isolation)
6. **3F — Skills & workflows marketplace + recommendations** (needs everything above to be worth installing into)

Each is a sub-wave on its own. None of this lands before 2C ships.

---

## 3A — PRD ingestion + notifications

**Why first:** the user's described daily workflow already exists in Claude Desktop; dmux needs to be the *destination* for the markdown it produces, and it needs to call them back when work that began there is ready for review.

In scope:
- A "From PRD / spec" entry point on the Spawn sheet that takes a markdown file (drag-drop, paste, or path) and pipes it into the NL planner from Wave 2B PR 3. Planner output is the same `proposed` lifecycle state — no new state machine.
- Notifications for: long-running task completion, permission-prompt requests blocking an agent, scope violations, proposal awaiting review. Channels (pick during design pass): local OS notification (macOS first), optional companion tray app, optional webhook (Slack/Telegram bridge later).
- Per-project + per-event notification preferences.

Explicitly out:
- Two-way conversation about the PRD (that's 3B).
- Mobile push (later, needs hosted infra).

Open questions:
- Should the markdown PRD be stored in the project's `.dmux/` directory as a first-class artifact linked to the run, or treated as ephemeral input? Leaning stored.
- Tray app vs. CLI daemon vs. piggyback on the dev server — affects install story.

---

## 3B — Chat sessions inside dmux

**Why second:** once PRDs are flowing in, the user needs a place to refine them and to talk *to* a project (or to dmux itself) without context-switching to Claude Desktop.

In scope:
- A chat surface scoped to a project (and a separate one scoped to dmux globally, for cross-project planning).
- Chats are backed by the underlying provider (Claude API by default; uses the project's configured model from Wave 2A).
- A "convert this chat into a proposal" action that pipes the conversation as context into the NL planner — closes the loop between brainstorm and action.
- Chat history persists in `.dmux/chats/` per project.

Explicitly out:
- Live multi-user chat (teams concern, later wave).
- Voice (not on the table).

Open questions:
- Do chats and runs share a context envelope (project tree, CLAUDE.md, recent runs), or does the user choose what to attach? Probably auto-attach with override.
- Cost ceiling per chat — needed if this is going to be left running.

---

## 3C — Multi-provider runners

**Why third:** broadens audience and de-risks dmux being read as "a Claude Code wrapper." Wave 2A already added per-agent provider/model fields; this wave makes them real for non-Anthropic providers.

In scope:
- Runner adapters for Gemini CLI and Codex CLI (or whichever Codex SKU is current at the time). Each adapter normalizes: spawn, stream output, plan extraction (where supported), permission prompts, diff capture.
- Capability matrix in the UI — show which features (plan mode, scope enforcement, MCP) work with which provider so users don't pick a combination that silently degrades.
- Documented contract for adding a new runner.

Explicitly out:
- Self-hosted / open-weights model runners (later).
- Cross-provider agent handoff inside one run (that's 3E).

Open questions:
- How much of dmux's scope enforcement / plan extraction depends on Claude Code's specific output format? Answer determines how thin the adapter layer can be.

---

## 3D — MCP integrations

**Why fourth:** the user named GitHub specifically; MCP is the right abstraction and several useful servers already exist. This is integration work more than design work.

In scope:
- A project-level `mcp:` config block (list of MCP servers + scopes the project's agents can talk to).
- Built-in starter set: GitHub, filesystem (already implicit), and one of {Linear, Notion, Slack} based on what's most asked for at the time.
- UI for adding/removing/configuring MCP servers per project, with credential handling that doesn't put secrets on disk in plaintext.
- Surface MCP tool calls in the run timeline so the user can see what an agent actually did externally.

Explicitly out:
- Writing custom MCP servers from inside dmux (out of scope; users bring their own).
- Cross-project MCP credential sharing (security review needed first).

Open questions:
- Credential storage: macOS Keychain only, or pluggable? Keychain-only is simpler and fine for solo phase.

---

## 3E — Real agent orchestration

**Why fifth:** this is the genuinely hard one and the most under-spec'd part of the vision. Today's "team" is N parallel agents in isolated worktrees — coordination by *isolation*, not communication. A real swarm needs handoffs, reviews, escalation, and a clear model for who decides what.

In scope (to be designed, not implemented in 3E itself — 3E is a design pass plus a first concrete pattern):
- A named coordination pattern: e.g. **planner → implementer → reviewer**, with explicit handoff artifacts (the proposal, the diff, the review comments).
- A messaging primitive between agents in the same team (post / read structured messages, not free-form chat).
- An escalation contract — when an agent gets stuck or hits a scope violation, what happens (user prompt, hand to a different agent, fail the run).
- A study of how Claude Code's own subagent / Task tool model handles this, so we extend rather than fight it.

Explicitly out (for the first pass):
- Generalized swarm graphs (any agent can talk to any other). Start with a fixed pattern, learn from it.
- Cross-run coordination (one swarm, one run, for now).

Open questions:
- Does each agent in a swarm still get its own worktree, or do reviewer-style agents read the implementer's worktree? Probably the latter; needs design.
- Where does swarm state live — `.dmux/runs/<id>/swarm.json` or in each agent's record?

This sub-wave is the most likely to slip or split. Treat the design pass as the deliverable.

---

## 3F — Skills & workflows marketplace + recommendations

**Why last:** a marketplace is only useful if there's already a substrate of skills, workflows, MCP servers, and providers worth sharing — and an onboarding flow to drop them into. By 3F all of that exists.

In scope:
- A community catalogue (likely a GitHub repo with a manifest format, not a custom backend in the solo phase).
- `dmux skills install <name>` and `dmux workflows install <name>` from the catalogue.
- Recommendation engine: during onboarding (built in 2C) and after, suggest skills/workflows based on detected stack and stated goals. First-class slot for things like `graphify`.
- A "leveraging new Claude Code features" channel — when a new Claude Code release adds something dmux can wrap (new slash command, new hook, new tool), surface it as a recommended install/update inside dmux. This is a curation discipline as much as a feature.

Named **workflows** become a real concept here (they're hinted at in the vision but not in current scope):
- A workflow is a multi-step recipe over skills + git + MCP — e.g. "start a new feature" = create branch → spawn planner → propose team → on approve, spawn implementers → on completion, open PR.
- Workflows are portable: install one into a new project the same way you install a skill.

Explicitly out:
- Paid skills / revenue share (way later).
- Ratings, comments, social features (later, and may never be needed if the catalogue stays curated).

Open questions:
- Catalogue governance: fully open, curated by maintainers, or trusted-publisher model? Affects trust and the security review story.
- Workflow execution engine: build a minimal one, or piggyback on Claude Code's slash-command + hooks system? Latter is more aligned with the "don't reimplement Claude Code" principle.

---

## What this outline is NOT

- Not a commitment to ship all six sub-waves. After 2C, re-evaluate and re-order based on what hurt most during 2B/2C use.
- Not a spec. Each sub-wave gets its own design pass document (`wave-3a.md`, etc.) before any code.
- Not scope creep for the current wave. Anything here that gets pulled into 2B or 2C should be explicitly justified or deferred.

---

## Cross-cutting principles (apply to every sub-wave)

These come from the user's stated values; keep them in front of mind during the eventual design passes.

1. **Don't reimplement Claude Code.** Wrap, surface, recommend — but extending CC's own primitives beats parallel ones every time.
2. **Solo-first, then teams.** Every feature must be valuable for a single engineer before any team or cloud concern enters the design.
3. **Public-ready from the start.** Docs, error messages, install story are part of the same change — not "polish at the end."
4. **UI-first.** Every capability must be fully usable from the web UI, not CLI-only.
5. **Skills, workflows, and chats are portable artifacts** — designed for copy/install into another project, not entangled with the project that created them.
