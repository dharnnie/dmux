# dmux — Wave 3B Design Pass

Status: drafting before implementation. Pair-mode review welcome.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-3a.md`. Parent: `wave-3.md` (3B is the second of six sub-waves).

---

## Where Wave 3A left us

Wave 3A landed PRD ingestion + notifications. The brainstorm-from-Claude-Desktop → markdown PRD → running team loop now works end-to-end without the user pasting a 2-page spec into a one-line NL prompt.

What's still missing per the user's stated vision:

> I want to be able to have chat sessions within my project, or just in dmux, but of course linked to claude or gemini etc...

Wave 2D shipped a **per-proposal** chat — useful but narrow. It's bound to a specific proposal, the agent is loaded with that proposal's context, and the chat disappears as a useful surface once the run is approved. There's no place for "I'm thinking about adding X to project-Y, what do you think?" before any proposal exists, and no place at all for cross-project brainstorming.

Wave 3B closes that gap with **two new chat surfaces**:

1. **Project-scoped chat** — `/projects/:name/chat`. A general-purpose conversation about a specific project. The agent sees the project's file tree, CLAUDE.md, current `.dmux-agents.yml`, and recent runs. Persists at `<projectPath>/.dmux/chats/project.json`.
2. **dmux-global chat** — `/chat`. Cross-project planning surface. The agent sees the list of registered projects (names + paths + a one-line summary of each) but no project file trees by default. Persists at `~/.config/dmux/chats/global.json`.

Both chats have a **"Convert this chat into a proposal"** action — picks a project (preselected for the project-scoped case), passes the full transcript through the existing NL planner, and the user lands on the proposal review page. Closes the loop between brainstorm and action.

The big architectural shift this wave forces: **migrating chat dispatch from `claude --print` to the Anthropic SDK.** Per-proposal chats from Wave 2D were short-lived (≤25 messages) so manual full-transcript re-assembly worked. Project-scoped and dmux-global chats can live for days with 100+ messages — re-sending the full transcript every turn becomes expensive fast, and the lack of streaming makes 30+ second waits feel broken. The SDK gives us prompt caching, streaming, and a proper multi-turn API. Worth the dep + the API-key gate.

Wave 2D's per-proposal chat stays on `claude --print` for now — it works fine for that scope, and migrating it is unnecessary risk for v1.

---

## Section 1 — Concepts introduced in Wave 3B

Three new concepts.

### 1.1 Two chat scopes

Wave 2D introduced one chat scope (proposal). Wave 3B adds two more:

- **Project chat** — one per project, addressed as `<projectPath>/.dmux/chats/project.json`. Context envelope: file tree (depth-limited, same `summarizeFileTree` helper as discovery), CLAUDE.md, current `.dmux-agents.yml`, last N run summaries (id, status, agent count, trigger). Tone: "agent who knows this project."
- **Global chat** — one per dmux installation, at `~/.config/dmux/chats/global.json`. Context envelope: the project registry (names + paths + a one-line description each if available), nothing more. Tone: "agent who knows your projects exist but doesn't read any of them."

Both use the same chat primitive under the hood (same storage shape, same message format, same SDK calls) — they differ only in the context envelope assembled at each turn.

Per-proposal chats from Wave 2D continue to exist at `<projectPath>/.dmux/chats/<proposalId>.json`. Three coexisting chat scopes; no fusion between them in v1.

### 1.2 SDK-driven streaming

`claude --print` was the right primitive for short, single-shot LLM calls (planner, discovery, per-proposal chat). For long-running chats it has two real problems:

1. **No prompt caching.** Every turn we re-pay the full transcript at the full input price. A 100-message chat on every turn costs proportionally more than a 5-message chat. With the SDK + Anthropic's prompt caching, the system prompt and early turns become cache hits at ~90% off.
2. **No streaming.** The user sees nothing for 30s, then a wall of text. With streaming, characters arrive as the model produces them — feels alive.

This wave migrates the chat path to the **Anthropic SDK** (`@anthropic-ai/sdk`). New dep on `dmux-ui`. Requires an `ANTHROPIC_API_KEY` env var.

**Backward compatibility:** Wave 2D's per-proposal chat is unchanged. The new SDK path is dedicated to Wave 3B's two new chat scopes. We don't migrate `claude --print` callers (planner, discovery) — those are short-lived and benefit less.

**API key gate:** if `ANTHROPIC_API_KEY` isn't set, the chat UI shows a friendly "Set ANTHROPIC_API_KEY to use chat" panel with a one-liner explaining how. The rest of dmux continues to work — chat is opt-in.

### 1.3 "Convert chat to proposal"

The bridge back to action. A button at the bottom of any chat opens a small modal:

```
Convert this chat to a proposal?

  Project:  [project-name ▾]   (preselected for project-scoped chats)

  This sends the full transcript through the planner, which will propose
  a team to execute on the conversation's intent. You'll review the team
  before anything runs.

  [Cancel]  [Convert]
```

Submit pipes the entire transcript (as a structured prompt) into the existing NL planner endpoint (`POST /api/projects/:name/proposals`), with `source: 'chat'` on the trigger and `chatPath` pointing to the chat file for audit. The user lands on the proposal review page.

This works because the planner is already good at extracting actionable intent from longer inputs (we proved this with PRD ingestion in 3A). The transcript becomes the prompt; the planner does its thing.

---

## Section 2 — End-to-end flow

### 2.1 Project chat (UI happy path)

1. User opens Project Detail (`/projects/:name`). A new "Chat" tab appears alongside History etc.
2. Clicking it loads `/projects/:name/chat` (or renders the chat tab inline — see §6.3).
3. First open: chat is empty. A bootstrapped opener from the agent: "I know about <project-name>. Ask me about the codebase, plan changes, or have me draft a proposal."
4. User types a message → hits Send → the message appears immediately, then the assistant's response **streams in** token-by-token.
5. Chat history persists at `<projectPath>/.dmux/chats/project.json`. Survives reloads.
6. Bottom of the chat: a "Convert to proposal" button. Click → modal → confirm → planner runs → lands on the proposal review page.

### 2.2 Global chat (UI happy path)

1. User clicks "Chat" in the navbar (new entry next to Dashboard / Projects / Skills).
2. Loads `/chat`. Same surface as project chat but with the global context envelope.
3. Identical flow otherwise. "Convert to proposal" surfaces a project picker since no project is pre-selected.

### 2.3 Server flow per turn

For both surfaces:

1. Client POSTs `/api/chat/project/:name/message` (or `/api/chat/global/message`) with `{ message }`.
2. Server appends the user message to the chat file (atomic write, same pattern as Wave 2D).
3. Server assembles the conversation for the SDK:
   - System message: dmux's persona + context envelope (file tree, CLAUDE.md, etc. for project-scoped; registry for global).
   - All prior messages from the file.
   - The new user message.
4. Server opens an SSE stream back to the client and pipes the SDK's streaming response through, emitting one event per text-delta.
5. As tokens stream, the server accumulates the assistant's response in memory.
6. When the stream ends, the server atomically appends the full assistant message to the chat file.
7. SSE stream closes; client renders the final message.

If the client disconnects mid-stream, the server still completes the stream and writes the message — same shape as Wave 2D's optimistic UI.

### 2.4 "Convert to proposal" flow

1. Client POSTs `/api/chat/project/:name/convert` (or `/api/chat/global/convert`) with `{ targetProject }` (omitted for project-scoped — uses the URL param).
2. Server reads the chat transcript.
3. Server calls `runPlanner(targetProjectPath, targetProjectName, transcriptAsPrompt, { source: 'chat', chatPath })`. The transcript is formatted as a structured prompt: "Here's a conversation I had about this project. Propose a team to address the intent expressed in it. Conversation: ..."
4. Planner returns a `proposalId`.
5. Client navigates to the proposal review page.

The chat persists — converting doesn't archive or clear it. The proposal's trigger carries `source: 'chat'` so future "From chat" badges can be added (skipped in v1 — the PRD-card pattern from 3A is the precedent if someone wants to add a similar Chat-card).

---

## Section 3 — Implementation surface

### 3.1 dmux-core additions

None. Wave 3B is server + UI work; no schema changes.

### 3.2 Server additions

New package dep on `dmux-ui`: `@anthropic-ai/sdk`.

In `dmux-ui/server/lib/chat.js` (new file — keeps chat code separable from `lib/dmux.js` which has grown large):

- **`getAnthropicClient()`** — lazy-initializes the SDK client from `process.env.ANTHROPIC_API_KEY`. Throws a clear error with status 503 if the key is missing.
- **`readChat(scope, identifier)`** — reads the chat file. `scope` is `'project'` or `'global'`; `identifier` is the project path (for project) or unused (for global). Returns `{ messages, count }`.
- **`appendChatMessage(scope, identifier, message)`** — atomic-write append to the chat file. Same pattern as Wave 2D.
- **`buildProjectChatContext(projectPath, projectName)`** — assembles the project context envelope (file tree, CLAUDE.md, current YAML, recent runs).
- **`buildGlobalChatContext()`** — assembles the global context envelope (project registry).
- **`streamChatTurn(scope, identifier, userMessage, ctx, res)`** — the main worker. Appends the user message, assembles the SDK request, opens the SSE stream on `res`, pipes deltas, accumulates the assistant response, writes it on stream end. Wraps Anthropic SDK errors as 503/504/422 with clean messages.
- **`convertChatToProposal(scope, identifier, targetProjectPath, targetProjectName)`** — reads the chat, formats as a planner prompt, calls `runPlanner` with `source: 'chat'`, returns the proposalId.

In `dmux-ui/server/index.js`:

- `GET /api/chat/project/:name` → returns history + bootstrap greeting.
- `POST /api/chat/project/:name/message` body `{ message }` → SSE stream of assistant deltas.
- `POST /api/chat/project/:name/convert` body `{}` → returns `{ proposalId }`.
- `GET /api/chat/global` / `POST /api/chat/global/message` / `POST /api/chat/global/convert` — same shapes for the global scope. Convert takes a body `{ targetProject }`.
- Each endpoint checks the API key up front; returns 503 with a useful message if missing.

### 3.3 UI additions

In `dmux-ui/src/components/`:

- **`ChatSurface.jsx`** — generalized chat component. Takes `scope`, `identifier`, `apiPath`, `convertEndpoint`. Renders message list (same shape as Wave 2D's `ProposalChat`), composer with streaming-aware send, "Convert to proposal" button + modal. ~250 lines.
- **`ConvertToProposalModal.jsx`** — small modal: project picker + Convert / Cancel. Picker is hidden when called from project-scoped chat (already set).

In `dmux-ui/src/pages/`:

- **`ProjectChat.jsx`** — page wrapper for `/projects/:name/chat`. Uses `ChatSurface` with the project's scope. ~60 lines.
- **`GlobalChat.jsx`** — page wrapper for `/chat`. Uses `ChatSurface` with the global scope.

In `dmux-ui/src/App.jsx`:

- Add the two new routes.
- Add a "Chat" link in the Navbar pointing at `/chat`.
- Add a "Chat" tab on Project Detail pointing at `/projects/:name/chat` (or render inline — see §6.3).

In `dmux-ui/src/pages/ProjectDetail.jsx`:

- Either add a "Chat" tab to the existing tab structure (if any) or just a "Chat" link in the project's top action area. (Inline tab vs separate page — §6.3 decision.)

### 3.4 CLI additions

**None in v1.** Per `wave-3a.md` §2.5 the chat surface is fundamentally a UI experience; CLI parity is non-goal until users push back. Same posture here.

### 3.5 Streaming infrastructure

SSE is the right tool: one-way server-to-client text stream, simpler than WebSockets, native browser support via `EventSource`. The dmux-ui server already has WebSocket infrastructure (Wave 1 agent status WS), but those are bidirectional / session-scoped. SSE is simpler for "stream this one response."

Client uses native `fetch` + `ReadableStream` (no `EventSource` because we POST — `EventSource` only does GET). Server emits `Content-Type: text/event-stream` with `data: ` chunks.

If we hit issues with SSE (proxies stripping, etc.) the fallback is buffered JSON like Wave 2D — slower but works everywhere. Not the default.

---

## Section 4 — Wireframes

### 4.1 Project chat surface

```
┌─ Chat — project-foo ──────────────────────────────────────────────┐
│                                                                    │
│  Agent: I know about project-foo. I can read its source, help     │
│         plan changes, and draft a team proposal when you're       │
│         ready. What's on your mind?                               │
│                                                                    │
│  You:    I'm thinking of adding rate limiting to /api/login.      │
│          What's the simplest place to put it?                     │
│                                                                    │
│  Agent:  Looking at src/middleware/, you already have an `auth.js`│
│          and a `logger.js`. A `rateLimit.js` sibling is the       │
│          natural fit — wire it before auth so we don't waste      │
│          cycles on bad requests... ▌                              │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ Ask anything about this project...                                │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │                                                              │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ 5 messages                            [Convert to proposal] [Send]│
└────────────────────────────────────────────────────────────────────┘
```

Streaming response renders with a blinking cursor (▌) at the cursor position. The "Convert to proposal" button is always visible; it's a no-op (greyed) when no messages have been sent yet.

### 4.2 Global chat surface

```
┌─ dmux Chat ───────────────────────────────────────────────────────┐
│                                                                    │
│  Agent: I know about 8 projects you've registered: project-foo,   │
│         project-bar, ... . Ask me about any of them, or start a   │
│         cross-project conversation. I'll draft a proposal for     │
│         whichever project you point me at when you're ready.      │
│                                                                    │
│  You:    Which of these projects is closest to needing tests?     │
│                                                                    │
│  ...                                                               │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│ ...                                                                │
└────────────────────────────────────────────────────────────────────┘
```

### 4.3 "Convert to proposal" modal

```
┌─ Convert this chat to a proposal? ────────────────────────────┐
│                                                                │
│  Project:  [project-foo ▾]                                    │
│                                                                │
│  This sends the full chat transcript through the planner.     │
│  You'll review the proposed team before anything runs.        │
│                                                                │
├────────────────────────────────────────────────────────────────┤
│  [Cancel]                                          [Convert]  │
└────────────────────────────────────────────────────────────────┘
```

Project picker is hidden (or just shows the pre-selected project) for project-scoped chats.

### 4.4 API key missing state

```
┌─ Chat ────────────────────────────────────────────────────────┐
│                                                                │
│  Chat needs an ANTHROPIC_API_KEY                              │
│                                                                │
│  dmux chat uses the Anthropic SDK directly so it can stream   │
│  responses and stay efficient on long sessions. Set the env   │
│  var in the shell that runs `dmux ui`:                        │
│                                                                │
│  export ANTHROPIC_API_KEY=sk-ant-...                          │
│                                                                │
│  Get a key at console.anthropic.com.                          │
│                                                                │
│  Everything else in dmux works without this — only chat       │
│  requires it.                                                 │
│                                                                │
└────────────────────────────────────────────────────────────────┘
```

---

## Section 5 — Decisions to confirm before implementation

These are the load-bearing choices.

1. **SDK migration is mandatory for Wave 3B.** Long-running chats need prompt caching + streaming. The `--print` shape doesn't scale here. Recommended: confirm.

2. **API key gate.** `ANTHROPIC_API_KEY` is required for chat only. Everything else in dmux continues to work without it. Surface a clear "set this env var" panel in the chat UI when missing. Recommended: confirm.

3. **Wave 2D's per-proposal chat stays on `claude --print`.** No migration in this wave. If cost / UX pressure surfaces later (it likely won't for ≤25-message chats), migrate then. Recommended: confirm.

4. **Two chat scopes in one wave, not split.** Project + global ship together. They share the same component, the same storage shape, the same SDK path — splitting would mean two passes over the same code. Recommended: confirm.

5. **Project chat lives at `<projectPath>/.dmux/chats/project.json` (one chat per project).** Not multiple "chat threads" per project. If users want multiple ongoing conversations they create a new chat by clearing the existing one. Threading is a Wave 4 problem (if ever). Recommended: confirm.

6. **Global chat lives at `~/.config/dmux/chats/global.json`.** One global chat per dmux installation. Same single-chat-per-scope rule. Recommended: confirm.

7. **Context envelopes:**
   - Project chat: file tree, CLAUDE.md, current .dmux-agents.yml, last 5 run summaries (id, status, agent count, trigger type).
   - Global chat: project registry (name + path + first line of CLAUDE.md per project if present).
   No file contents in either by default; the agent can't read files mid-conversation in v1 (tool use is a Wave 4 thing). Recommended: confirm.

8. **Soft cap 50 messages, hard cap 100.** Looser than Wave 2D since these chats live longer. Above the hard cap the UI shows "Chat too long — start a new chat or convert this one to a proposal." Recommended: confirm.

9. **"Convert to proposal" sends the full transcript as the planner prompt.** No pre-summarization. Same posture as PRD ingestion in 3A — the planner is good at extracting intent from long inputs. Recommended: confirm.

10. **Place the project-Chat tab on the Project Detail page (inline tab) vs a separate `/projects/:name/chat` route.** Inline tab is more discoverable; separate route is shareable. Recommended: separate route (`/projects/:name/chat`) plus a tab-shaped link from Project Detail. Same pattern as Wave 2D's chat-tab on proposal review.

---

## Section 6 — Open questions (defer to implementation if not blocking)

1. **Token budget vs message count caps.** Message-count caps are crude but easy. Token budget needs the tokenizer (the SDK exposes one). For v1, message count; revisit if users actually hit it.
2. **Prompt caching strategy.** The Anthropic SDK supports cache control via the API. v1: cache the system prompt only. v2: cache the first N messages. Tune empirically.
3. **Streaming reconnect on flaky networks.** If the SSE stream drops mid-response, do we resume or discard? v1: discard, show "lost connection — retry?" Resume is a Wave 4 problem.
4. **Multi-tab safety.** Two browser tabs on the same chat could append messages out of order. The atomic-write pattern from Wave 2D handles file-level safety but not semantic ordering. For v1, last-write-wins; if it bites we add per-chat send locking.
5. **Cost visibility.** Should the UI show a running token / cost meter? Recommended: defer — surfacing $ amounts in the UI invites bad-feeling-by-design. Just enforce the cap.
6. **Tool use during chat (read files, run grep).** Out for v1 — see §7. The chat agent gets context loaded once at the start and can't fetch more. If this becomes friction, it's a Wave 4 design problem.
7. **Existing chat history when migrating to SDK.** Wave 2D chat files are JSON arrays of `{role, content, ts}`. Wave 3B chat files use the same shape. No migration needed because they live in different files; the SDK is transparent to the on-disk format.

---

## Section 7 — What's explicitly NOT in Wave 3B

Reserved for later sub-waves or never:

- **Multi-user chat.** Teams concern. Phase 3/4.
- **Voice input/output.** Not on the roadmap.
- **Tool use during chat** — agent reading files mid-conversation. Wave 4 (or never; the planner pathway is already the place for "I read your repo and proposed X").
- **Threading / multiple chats per scope.** One per scope in v1.
- **Migrating Wave 2D per-proposal chat to SDK.** Stays on `--print`.
- **Migrating planner / discovery callers to SDK.** They're short-lived; `--print` is fine.
- **Cost meter in the UI.** Just enforce caps.
- **Chat search / filter / export.** Per-scope, lifetime tied to whatever's natural (project lifetime / dmux lifetime).
- **CLI parity (`dmux chat`).** Non-goal in v1.
- **Mobile UI tweaks.** Solo-first on desktop.

Anything pulled forward needs explicit justification.

---

## Implementation order (after this doc is approved)

Three slices, one PR:

**Slice 1 — SDK migration foundation + project chat surface.** ~2 days.
- Add `@anthropic-ai/sdk` to dmux-ui deps.
- `dmux-ui/server/lib/chat.js` (new file): client init, storage, project context builder, `streamChatTurn` over SSE.
- API endpoints: GET/POST/POST-convert for project chat scope.
- `ChatSurface.jsx`, `ProjectChat.jsx`, route + ProjectDetail link.
- API-key-missing UI state.

**Slice 2 — Global chat surface.** ~0.5 days (leverages Slice 1 plumbing).
- Global context builder (project registry summary).
- API endpoints for global scope.
- `GlobalChat.jsx`, navbar link, route.

**Slice 3 — Convert to proposal.** ~1 day.
- `convertChatToProposal` server helper (wraps `runPlanner` with chat transcript as prompt).
- `ConvertToProposalModal.jsx`.
- Wire into both chat surfaces.
- Planner trigger gains `source: 'chat'` + `chatPath` provenance.

Total ~3.5 days. Wave 3B is done when all three land + end-to-end verified (project chat round-trip, global chat round-trip, convert-to-proposal round-trip on both).

---

*Ready for review. Push back on anything in Section 5 (decisions) before implementation begins.*
