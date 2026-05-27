# dmux — Wave 3D Design Pass

Status: drafting before implementation. Pair-mode review welcome.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-3c.md`. Parent: `wave-3.md` (3D is the fourth of six sub-waves).

---

## Where Wave 3C left us

After 3C (partial), dmux exposes a provider picker in the Customize panel + a capability matrix that hand-lists what each provider supports. MCP support is in the matrix today (claude = native, gemini = preview) but **dmux doesn't do anything with it** — agents launch with whatever MCP config they happen to inherit from the user's global `~/.claude/mcp.json` or a project-local `.mcp.json` the user maintains by hand.

That's the gap Wave 3D closes. The user's stated vision:

> Agent orchestration. MCP connecting to services like github, etc...

dmux should be the place users **manage MCP per project** — pick from a small catalogue of common servers (GitHub first), configure them, and have agents run with that MCP config automatically — without poking at `.mcp.json` or remembering which `npx` invocation matches which server.

Wave 3D ships three things, narrowly:

1. **A project-scoped MCP config** stored at `<projectPath>/.dmux/mcp.json` (under dmux's own dir, NOT colliding with a project's own `.mcp.json` if the user already maintains one). Bash passes `--mcp-config .dmux/mcp.json` to `claude` at agent launch when the file exists.
2. **A small built-in catalogue** of MCP servers + a UI surface to install/configure/remove them per project. v1 ships **GitHub** as the concrete one; the catalogue infrastructure makes adding more cheap.
3. **Keychain-backed credential storage on macOS** so tokens don't end up in plaintext in the project dir. Cross-platform fallback is env-var indirection — the config references an env var name, the user manages the env var.

Run-timeline visibility into MCP tool calls (seeing what an agent actually did externally), custom-server-as-first-class, cross-project credential sharing, and per-agent MCP scope are all **out** per `wave-3.md` §3D. Wave 4 territory.

---

## Section 1 — Concepts introduced in Wave 3D

Three concepts.

### 1.1 dmux-managed MCP config

A new file at `<projectPath>/.dmux/mcp.json` with the same shape Claude Code expects:

```json
{
  "mcpServers": {
    "github": {
      "command": "npx",
      "args": ["-y", "@modelcontextprotocol/server-github"],
      "env": {
        "GITHUB_PERSONAL_ACCESS_TOKEN": "keychain:dmux-mcp/github:token"
      }
    }
  }
}
```

The shape matches Claude Code's. The only dmux-specific extension is the **`keychain:<account>/<service>:<key>`** sentinel for env values — read by the launch wrapper just before `claude` is invoked and resolved to the actual secret. On the wire to `claude`, the env value is the real token.

Why not just write to the project's `.mcp.json`? Two reasons:
1. The user may already maintain their own `.mcp.json` for personal Claude Code use; dmux clobbering it is rude.
2. dmux-managed config lives with the rest of dmux's state (`<projectPath>/.dmux/`). Symmetry with `chats/`, `runs/`, `prds/`.

At agent launch, bash passes `--mcp-config <projectPath>/.dmux/mcp.json` to the `claude` invocation when the file exists. Gemini agents skip MCP entirely in v1 — gemini's MCP support is preview and exposing it would require translating the config format. Documented restriction.

### 1.2 The MCP server catalogue

A small static catalogue at `dmux-ui/server/lib/mcp-catalogue.js` listing servers dmux knows about + how to install them. v1 entries:

| name | description | install | required credentials |
|---|---|---|---|
| `github` | Read repos, issues, PRs through Anthropic's official GitHub MCP server | `npx -y @modelcontextprotocol/server-github` | `GITHUB_PERSONAL_ACCESS_TOKEN` |
| `filesystem` | Sandboxed filesystem reads under a path you pick | `npx -y @modelcontextprotocol/server-filesystem <path>` | (none) |

Two entries is enough to make the catalogue infrastructure real without committing to a sprawling catalogue. Adding a third (Linear / Notion / Slack) is one entry in this file — no other code changes — once we have a clear request.

Users with their own custom MCP server can hand-edit `.dmux/mcp.json` to add it; the UI just doesn't have a button for non-catalogue entries in v1. Documented escape hatch.

### 1.3 Credentials via macOS Keychain (with env-var fallback)

`wave-3.md` §3D was explicit: secrets must not be on disk in plaintext. Two implementations live in one config syntax:

- **macOS**: The Keychain. dmux writes the secret with `security add-generic-password -s dmux-mcp -a <server> -w <token>`. The config stores `keychain:dmux-mcp/<server>:token`. At agent launch, the launch wrapper resolves via `security find-generic-password -s dmux-mcp -a <server> -w` and exports the result into the agent's env.
- **Linux / Windows / no-keychain fallback**: env-var indirection. The config stores `env:GITHUB_TOKEN`. The user maintains `GITHUB_TOKEN` in their shell themselves. The UI's secret form, when keychain isn't available, prompts the user for an env var name instead of the secret itself.

A third path — plaintext in `.dmux/mcp.json` — is **disallowed**. The UI never writes secrets to the file; resolution always happens at launch time.

---

## Section 2 — End-to-end flow

### 2.1 Adding an MCP server (UI)

1. User opens Project Detail.
2. New "MCP" card alongside the existing Context card. Empty state: "No MCP servers configured. Agents in this project don't have external tool access. Add a server →".
3. Click → modal with the catalogue list. Pick `github`.
4. Configuration form:
   - Server is identified by its catalogue name (locked).
   - One field per required credential: `GITHUB_PERSONAL_ACCESS_TOKEN` (password input).
   - On macOS: tooltip "stored in Keychain". On other platforms: "stored as env var reference — paste the env var name (e.g. GITHUB_TOKEN), set it in your shell."
5. Save → server is registered in `.dmux/mcp.json`, secret written to keychain (or env-var name recorded).
6. Card collapses; project's MCP section now shows "✓ github connected".

### 2.2 Removing / reconfiguring

Per-server "Configure" and "Remove" buttons on the MCP card. Remove also deletes the keychain entry on macOS.

### 2.3 Agent launch flow change

When `dmux agents start` launches each agent:

- If the agent's provider is `claude` and `<projectPath>/.dmux/mcp.json` exists, pass `--mcp-config <projectPath>/.dmux/mcp.json` to the `claude` invocation.
- Before the `claude` exec, run a one-shot helper (`dmux _resolve-mcp-env <projectPath>`) that reads the config, finds all `keychain:` and `env:` sentinels, resolves them to real values, and emits a shell-evalable `export FOO=bar; export BAZ=qux` script for the agent's shell. The agent's `claude` then sees the secrets in its environment.
- For gemini agents in v1: skip MCP entirely. Documented restriction.

This keeps the secret-resolution logic in one tested place and gates it on the agent provider.

### 2.4 What the agent sees

When the agent (claude) starts, it sees an MCP config block that references the right env vars. Claude Code's MCP layer connects to the configured servers, exposes their tools, and the agent uses them as normal. No dmux-specific behavior at runtime; we just got the user to a configured-MCP state without the user touching `.mcp.json` directly.

---

## Section 3 — Implementation surface

### 3.1 dmux-core additions

- New module: `dmux-core/src/mcp.js`.
- `parseMcpConfig(jsonText)` — validates against the schema. Throws `McpConfigError` (new exception class) on invalid input.
- `MCP_SECRET_PREFIX_KEYCHAIN = 'keychain:'` and `MCP_SECRET_PREFIX_ENV = 'env:'` constants.
- A normalizer that flags any plain-text-looking env values as schema errors — explicit policy.
- Tests: parse valid + invalid, sentinel detection, plaintext rejection. ~10 tests.

### 3.2 Server additions

In `dmux-ui/server/lib/mcp.js` (new file — keeps MCP code separable like Wave 3B's `chat.js`):

- **`readMcpConfig(projectPath)`** — reads `.dmux/mcp.json`, returns parsed JSON or `null`.
- **`writeMcpConfig(projectPath, config)`** — atomic write (tmpfile + rename) under `.dmux/mcp.json`, creates the dir.
- **`addMcpServer(projectPath, catalogueName, credentials)`** — looks up the catalogue entry, builds the server config block, stores secrets (keychain or env-var name), persists the config.
- **`removeMcpServer(projectPath, serverName)`** — removes the entry, deletes the keychain entry if present.
- **`listMcpServers(projectPath)`** — returns the configured-server list with their catalogue names + a `configured: true/false` flag per credential (for UI display, never returns the actual secret).
- **`secretsBackend()`** — returns `'keychain'` on macOS if `security` is on PATH, else `'env'`. Determined once at module load.

In `dmux-ui/server/lib/mcp-catalogue.js` (new):

- The static array of catalogue entries. v1: github + filesystem.

In `dmux-ui/server/index.js`:

- `GET /api/mcp/catalogue` — returns the catalogue.
- `GET /api/projects/:name/mcp` — returns the project's current MCP server list (with `configured` flags, NOT secrets).
- `POST /api/projects/:name/mcp/servers` body `{ catalogueName, credentials: {KEY: value} }` — adds + persists.
- `DELETE /api/projects/:name/mcp/servers/:serverName` — removes.

### 3.3 Bash additions

In `dmux.sh`:

- New internal subcommand `_resolve-mcp-env <projectPath>` — reads `.dmux/mcp.json`, walks all `keychain:` / `env:` sentinels, prints `export KEY=value` lines (or returns 1 with a clear error if a referenced keychain entry is missing).
- `agents_start` extended: when launching a claude-provider agent and `.dmux/mcp.json` exists at the project root, prefix the agent command with `eval "$(dmux _resolve-mcp-env "$project_root")"` and add `--mcp-config "$project_root/.dmux/mcp.json"` to the claude invocation.
- A pre-flight check: at start time, if `.dmux/mcp.json` references a keychain entry that doesn't exist, fail loudly with a "run dmux ui and reconfigure" hint. Don't silently launch an agent with no MCP.

### 3.4 UI additions

- **`McpCard.jsx`** + module CSS — renders on Project Detail's right column alongside Context. Empty state when no servers; per-server rows with name + Remove + Configure. "Add server" button opens a modal.
- **`AddMcpServerModal.jsx`** + module CSS — catalogue picker → credential form. Form is dynamic (one input per required credential, all password fields). Submit hits `POST /api/projects/:name/mcp/servers`. On platforms without keychain, switches the input affordance from "password" to "env var name" with explanatory hint text.
- **`useMcpCatalogue.js`** hook — single fetch of the catalogue.

In `dmux-ui/src/pages/ProjectDetail.jsx`:

- Add `<McpCard projectName={name} />` to the sections list near the Context card.

### 3.5 CLI additions

**None for v1.** MCP config is a UI-first concern. CLI parity is a follow-up only if users push back.

---

## Section 4 — Wireframes

### 4.1 MCP card on Project Detail (empty state)

```
┌─ MCP ─────────────────────────────────────────────────────────────┐
│                                                                    │
│  No MCP servers configured. Agents in this project run without    │
│  external tool access.                                            │
│                                                                    │
│  [Add server]                                                     │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 MCP card with one server

```
┌─ MCP ─────────────────────────────────────────────────────────────┐
│                                                                    │
│  ✓ github     1 credential                  [Configure] [Remove]  │
│                                                                    │
│  [Add server]                                                     │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 4.3 Add server modal (catalogue step)

```
┌─ Add MCP server ──────────────────────────────────────────────────┐
│                                                                    │
│  Pick from the catalogue:                                         │
│                                                                    │
│   ┌────────────────────────────────────────────────────────┐     │
│   │ github                                                 │     │
│   │ Read repos, issues, PRs via Anthropic's GitHub MCP    │     │
│   │ Requires: GITHUB_PERSONAL_ACCESS_TOKEN                │     │
│   └────────────────────────────────────────────────────────┘     │
│                                                                    │
│   ┌────────────────────────────────────────────────────────┐     │
│   │ filesystem                                             │     │
│   │ Sandboxed file reads under a path you pick            │     │
│   │ No credentials needed                                  │     │
│   └────────────────────────────────────────────────────────┘     │
│                                                                    │
│  Need a server we don't list? Edit                                │
│  <projectPath>/.dmux/mcp.json directly.                           │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 4.4 Add server modal (credential step, macOS)

```
┌─ Configure github ────────────────────────────────────────────────┐
│                                                                    │
│  GITHUB_PERSONAL_ACCESS_TOKEN  ●●●●●●●●●●●●●●●●●●●●●              │
│  Stored in macOS Keychain (dmux-mcp/github).                      │
│                                                                    │
│  Need a token? https://github.com/settings/tokens                 │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│  [Cancel]                                                  [Save] │
└────────────────────────────────────────────────────────────────────┘
```

### 4.5 Add server modal (credential step, Linux/no-keychain)

```
┌─ Configure github ────────────────────────────────────────────────┐
│                                                                    │
│  GITHUB_PERSONAL_ACCESS_TOKEN  ┌──────────────────────────────┐  │
│                                │ GITHUB_TOKEN                 │  │
│                                └──────────────────────────────┘  │
│                                                                    │
│  No keychain available. Paste the name of an env var you'll      │
│  set in your shell — dmux will reference it. Don't paste the     │
│  token itself.                                                    │
│                                                                    │
├────────────────────────────────────────────────────────────────────┤
│  [Cancel]                                                  [Save] │
└────────────────────────────────────────────────────────────────────┘
```

---

## Section 5 — Decisions to confirm before implementation

These are the load-bearing choices.

1. **Config lives at `<projectPath>/.dmux/mcp.json`, not at `.mcp.json`.** Avoids clobbering a user's existing personal Claude Code MCP config; lives under dmux's own state dir. Bash passes `--mcp-config` to point Claude at it. Recommended: confirm.

2. **Secrets via Keychain on macOS, env-var indirection elsewhere. No plaintext on disk, ever.** Three implementations of one sentinel syntax (`keychain:...`, `env:...`). Recommended: confirm.

3. **v1 catalogue is 2 entries (github + filesystem).** Linear / Notion / Slack are a future add. Single-line additions to the catalogue file. Recommended: confirm.

4. **v1 is claude-only.** Gemini agents skip MCP because gemini's MCP support is preview and exposing it would require translating the config format. Documented restriction. Recommended: confirm — pair with Wave 3C's stance that gemini support is plumbed but not load-bearing.

5. **No UI for custom (non-catalogue) servers in v1.** Users with niche servers hand-edit `.dmux/mcp.json`. Recommended: confirm — small surface, clear escape hatch.

6. **Run-timeline visibility for MCP tool calls is deferred.** Wave 4 territory. Recommended: confirm.

7. **Per-project MCP scope, not per-agent.** All agents in a run share the same MCP config. Per-agent narrowing is a Wave 3E concern (orchestration). Recommended: confirm.

8. **One MCP card on Project Detail; no dedicated route.** Project Detail is already the natural per-project surface. A `/projects/:name/mcp` route would be empty most of the time. Recommended: confirm.

9. **Pre-flight check on `dmux agents start`: if any MCP secret can't be resolved, fail loudly.** Better to surface "your GitHub token isn't in Keychain anymore" before an agent starts than to silently launch with broken MCP. Recommended: confirm.

10. **Three slices, one PR.** Slice 1 plumbs the schema + bash; Slice 2 ships catalogue + UI with plaintext credentials; Slice 3 adds keychain backing. Tempting to combine Slice 2 + 3 since the credential affordance changes shape, but separating them lets the UI land before keychain is wired and lets Slice 2 be testable in isolation. Recommended: confirm.

---

## Section 6 — Open questions (defer to implementation if not blocking)

1. **What does Claude Code's `--mcp-config` flag actually look like in the current release?** Pin during Slice 1 — confirm flag name, confirm config format compatibility, confirm precedence over `~/.claude/mcp.json` and project-local `.mcp.json`.
2. **Keychain account naming collisions.** Two dmux projects both configuring "github" would write to `dmux-mcp / github` — overwriting each other. Solution: include the project name: `dmux-mcp / <projectName>:github`. Pin during Slice 3.
3. **What happens if the user installs an MCP server that itself fails to start?** Claude Code surfaces the error in the agent's stdout. dmux doesn't catch it specially. v1 lives with that; v2 could pre-flight by trying to start the server before launching the agent.
4. **Filesystem server path scoping.** v1 hardcodes the project's worktree path as the sandbox. v2 could let the user widen or narrow.
5. **Should `removeMcpServer` also delete keychain entries by default, or prompt?** Recommended: delete by default. The user can always re-paste.
6. **What if the catalogue add fails halfway (config written, keychain write fails)?** Rollback the config write. Atomic from the user's perspective.
7. **Does Gemini's MCP preview have a config we could translate to in a follow-up?** Yes — pin once gemini support becomes more than preview. Not 3D's job.

---

## Section 7 — What's explicitly NOT in Wave 3D

Reserved for later or never:

- **Custom-MCP-server UI** — users hand-edit `.dmux/mcp.json` for non-catalogue entries.
- **Per-agent MCP scope** — Wave 3E.
- **Run timeline visibility for MCP tool calls** — Wave 4.
- **Cross-project credential sharing** — needs a security review; not on the critical path.
- **Gemini MCP** — preview upstream; revisit when stable.
- **Linear / Notion / Slack catalogue entries** — adds when there's a clear request.
- **A dmux-hosted MCP server registry / proxy** — out of scope; we point at upstream packages.
- **CLI parity (`dmux mcp add`, etc.)** — non-goal in v1.

---

## Implementation order (after this doc is approved)

Three slices, one PR:

**Slice 1 — Schema + bash wiring + GET endpoint.** ~1 day.
- `dmux-core/src/mcp.js` with `parseMcpConfig` + sentinel constants + tests.
- `dmux-ui/server/lib/mcp.js` with read/write helpers (no catalogue or secrets yet).
- `_resolve-mcp-env` bash subcommand.
- `agents_start` change to add `--mcp-config` for claude agents when the file exists.
- `GET /api/projects/:name/mcp` endpoint.
- Verifiable by hand-editing `.dmux/mcp.json` with an `env:` sentinel and a known env var.

**Slice 2 — Catalogue + UI + add/remove endpoints.** ~1.5 days.
- `mcp-catalogue.js` with github + filesystem entries.
- `useMcpCatalogue` hook.
- `McpCard` + `AddMcpServerModal` components.
- `POST /api/projects/:name/mcp/servers` + `DELETE` endpoints.
- Credentials write as `env:` sentinels in v1 — keychain comes next slice.
- `GET /api/mcp/catalogue` endpoint.

**Slice 3 — Keychain backend + pre-flight.** ~1 day.
- `secretsBackend()` detector.
- macOS `security` CLI integration.
- AddMcpServerModal affordance switch (password input on macOS, env-var-name input elsewhere).
- Pre-flight in `dmux agents start` that fails loudly on missing keychain entries.

Total ~3.5 days. Wave 3D is done when github MCP works end-to-end against a real run on a fresh fixture: server installed via the UI, secret in Keychain, agent launches with `--mcp-config`, agent successfully uses a GitHub tool.

---

*Ready for review. Push back on anything in Section 5 (decisions) before implementation begins.*
