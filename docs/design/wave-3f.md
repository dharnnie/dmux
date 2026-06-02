# dmux — Wave 3F Design Pass

Status: drafting before implementation. Pair-mode review welcome.
Audience: dmux maintainers (currently @danielosineye + Claude).
Predecessor: `wave-3e.md`. Parent: `wave-3.md` (3F is the sixth and last of the planned Wave 3 sub-waves).

---

## Where Wave 3E left us

After 3E, dmux has handoff artifacts (plan + review) between roles, MCP integrations (3D), provider picker UI (3C), chat + convert-to-proposal (3B), PRD ingestion + notifications (3A), Maestro-style onboarding (2D), `dmux adopt` (2C), parameterized skills + proposal lifecycle (2B). The substrate is real.

What's still locked in: **skills only flow one way.** A user can install dmux's built-in skills, write their own, or use ones embedded in the source tree. There's no way to **discover what other dmux users have built** and pull those into their setup. Today's "share a skill" story is "copy-paste the YAML and hope."

The user's stated vision for this wave (from `wave-3.md` §3F):

> "I want to have a repo of skills, agents, rules, other people have used that I can just download on to my computer and use in a project, modify if required."

That's the core. Wave 3F **narrows aggressively** from the original outline:

- **In scope (v1):** a remote skill catalogue + browse/install UI + CLI. Pulled from a configurable URL (default: a community GitHub repo). Cached locally. Already-installed skills are detected so the UI shows the right state.
- **Out of scope (deferred per §7):** the **workflows** concept that the original outline introduced, recommendation engines beyond Wave 2D's discovery, the "Claude Code features channel," paid skills, ratings/social features.

Why narrow this hard: workflows are a brand-new abstract concept (named multi-step recipes over skills + git + MCP). They need their own design pass once we've felt the marketplace shape with skills first. Shipping a half-baked workflow system alongside marketplace plumbing dilutes both.

---

## Section 1 — Concepts introduced in Wave 3F

Two small concepts. (Workflows were the third in the original outline; deferred.)

### 1.1 The skill catalogue

A static JSON/YAML manifest fetched from a URL. v1 default points at `https://raw.githubusercontent.com/dharnnie/dmux-skills/main/catalogue.yml` (a repo the user creates separately — see §6.5). The URL is overridable via env var `DMUX_SKILL_CATALOGUE_URL` or a one-line `~/.config/dmux/catalogue.url` file.

Manifest shape:

```yaml
version: 1
skills:
  - name: react-tdd
    description: TDD-driven React component generation
    author: dharnnie
    tags: [react, tdd, frontend]
    raw_url: https://raw.githubusercontent.com/dharnnie/dmux-skills/main/react-tdd/skill.yml
  - name: go-api-bootstrap
    description: Scaffold a Go HTTP API with middleware + tests
    author: someoneelse
    tags: [go, scaffold]
    raw_url: https://raw.githubusercontent.com/dharnnie/dmux-skills/main/go-api-bootstrap/skill.yml
```

Each entry's `raw_url` points at the skill's `skill.yml` (the existing Wave 2B parameterized-skill format — no new schema). To install, dmux fetches the YAML, validates via dmux-core's `parseSkillYaml`, writes it to `~/.local/share/dmux/skills/<name>/skill.yml`. The existing built-in skill machinery just sees a new installed skill.

This shape is intentionally boring. There's no auth, no per-user customization, no paid tier. It's a fancy list of URLs.

### 1.2 Catalogue cache + freshness

Fetching from GitHub raw URLs every time the user opens the Skills page is wasteful and breaks offline. The catalogue is cached at `~/.config/dmux/catalogue.cache.json` with a fetched-at timestamp.

Refresh rules:
- **Manual:** `dmux skills refresh` always refetches.
- **Auto-stale:** if the cached copy is older than 24 hours, the next `dmux skills list --remote` (or the UI's GET /api/skills/catalogue) silently refreshes in the background. The stale cache is served immediately so the user never waits on a refresh.
- **Offline:** missing network → serve the cache, surface a warning. Empty cache → return an empty list + the warning.

---

## Section 2 — End-to-end flow

### 2.1 Browsing + installing from the UI

1. User opens `/skills` (existing page).
2. New "Available" tab alongside the existing "Installed" view (or a section underneath it — see §5.4).
3. Lists every entry from the catalogue. Per-row: name + description + author + tags + Install button. If already installed (or built-in), the button is replaced by a "✓ Installed" badge.
4. Click Install → POST `/api/skills/install-from-catalogue` body `{ name }` → server fetches `raw_url`, validates via `parseSkillYaml`, writes the file → returns OK → UI flips the row to "✓ Installed."
5. Refresh: a small "Refresh catalogue" button next to the section header. Shows last-fetched timestamp.

### 2.2 Browsing + installing from the CLI

```
dmux skills list --remote                     # show catalogue
dmux skills install <name>                    # extended to fall through to catalogue
dmux skills refresh                           # force-refetch
```

The existing `dmux skills install <name>` already looks at built-ins. v1 of 3F extends it: if `<name>` isn't a built-in but IS in the (possibly auto-refreshed) catalogue, install it.

### 2.3 No publishing flow

dmux doesn't publish skills. Users contribute to the community catalogue by:
1. Forking the dmux-skills repo
2. Adding their `skill.yml`
3. Adding an entry to `catalogue.yml`
4. PR

dmux is a **client**, not a publishing platform. Documented in `docs/skills-catalogue.md` (new) with the contribution flow.

---

## Section 3 — Implementation surface

### 3.1 dmux-core additions

Minimal — the catalogue is server-side state, but parsing reuses Wave 2B's existing `parseSkillYaml`.

- `dmux-core/src/catalogue.js` — small new module.
- `parseCatalogueManifest(yamlOrJson)` — validates the shape (version, skills[], required fields per entry). Throws `CatalogueError`. ~30 lines.
- 3–4 tests in `catalogue.test.js`.

The manifest format is YAML for human readability (matches the existing skill.yml convention).

### 3.2 Server additions

In `dmux-ui/server/lib/catalogue.js` (new):

- **`fetchCatalogue({force} = {})`** — reads the configured URL, fetches via Node 22's built-in `fetch()`, validates via `parseCatalogueManifest`, writes the cache. Returns the parsed catalogue. Promise-returning. Handles network errors by returning the cached copy + a warning.
- **`readCachedCatalogue()`** — sync read of `~/.config/dmux/catalogue.cache.json`. Returns `{ catalogue, fetchedAt } | null`.
- **`getCatalogueUrl()`** — checks `DMUX_SKILL_CATALOGUE_URL` env var, then `~/.config/dmux/catalogue.url`, then the hardcoded default.
- **`installSkillFromCatalogue(name)`** — looks up the catalogue entry, fetches `raw_url`, validates via `parseSkillYaml`, writes to the user skills dir. Returns the installed skill summary.

In `dmux-ui/server/index.js`:

- **`GET /api/skills/catalogue`** — returns `{ catalogue: [...], fetchedAt, warning? }`. Auto-stale: if cache > 24h, kicks off a background refresh (fire and forget) before responding with the stale copy.
- **`POST /api/skills/refresh-catalogue`** — forces a refresh; returns the new catalogue.
- **`POST /api/skills/install-from-catalogue`** body `{ name }` — installs. Returns 422 with `parseSkillYaml`'s error if the fetched YAML is broken.

The existing `installSkill(name)` for built-ins stays as-is. A separate endpoint keeps the two paths cleanly distinguishable.

### 3.3 UI additions

In `dmux-ui/src/pages/Skills.jsx`:

- New "Available" section under "Installed" (single-page, two sections — keeps the existing IA intact).
- Renders the catalogue list with Install buttons. Already-installed entries show the badge instead.
- Last-fetched timestamp + Refresh button next to the section header.

In `dmux-ui/src/hooks/`:

- `useSkillsCatalogue.js` — fetch on mount, expose `{ catalogue, fetchedAt, warning, refresh, ready }`.

No new pages. The existing `/skills` route gains a section.

### 3.4 CLI additions

In `dmux.sh` skills handler (existing `handle_skills_command`):

- `dmux skills list --remote` — fetches catalogue via curl + python3 YAML/JSON parsing, prints table.
- `dmux skills install <name>` — extended to check the catalogue when the name isn't a built-in.
- `dmux skills refresh` — force-refetch.

The CLI is a thin client over the same server endpoints used by the UI when the dev server is running. Falls back to direct HTTPS fetch when the server isn't running (same posture as `dmux skills install <built-in>` today).

### 3.5 Docs

`docs/skills-catalogue.md` (new) — ~60 lines:
- Where the catalogue lives
- The manifest format
- How to add a skill to the official catalogue (fork + PR)
- How to point dmux at a different catalogue (env var, override file)
- Cache behavior

---

## Section 4 — Wireframes

### 4.1 Skills page with Available section

```
┌─ Skills ──────────────────────────────────────────────────────────┐
│                                                                    │
│  Installed (6)                                                    │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ tdd-feature      Built-in    [...]                          │ │
│  │ code-review      Built-in    [...]                          │ │
│  │ ...                                                         │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
│  Available · last refreshed 2 hours ago    [↻ Refresh]            │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │ react-tdd        by dharnnie         react · tdd            │ │
│  │   TDD-driven React component generation        [Install]   │ │
│  │                                                             │ │
│  │ go-api-bootstrap by someoneelse      go · scaffold          │ │
│  │   Scaffold a Go HTTP API with middleware + tests            │ │
│  │                                                  ✓ Installed │ │
│  │                                                             │ │
│  │ ... (etc)                                                   │ │
│  └─────────────────────────────────────────────────────────────┘ │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

### 4.2 Empty / offline / no-network state

```
┌─ Available · (network unavailable) ───────────────────────────────┐
│                                                                    │
│  Couldn't reach the skill catalogue. Showing 0 cached entries.    │
│  Check your connection and click Refresh.                         │
│                                                  [↻ Refresh]      │
│                                                                    │
└────────────────────────────────────────────────────────────────────┘
```

---

## Section 5 — Decisions to confirm before implementation

These are the load-bearing choices.

1. **v1 is the skills marketplace only. Workflows are deferred.** Workflows are a brand-new abstract concept (multi-step recipes over skills + git + MCP); inventing the format alongside the marketplace plumbing dilutes both. A separate wave can land workflows once we've felt the marketplace shape. Recommended: confirm.

2. **Single catalogue source, configurable URL.** Multi-source / user-added catalogues (forks pointing at different lists) are deferred — that's a "package manager with channels" problem. v1: one default URL, env var override. Recommended: confirm.

3. **No publishing flow from dmux.** Users contribute by PR'ing the community catalogue repo. dmux is a client. Recommended: confirm.

4. **Default catalogue is at `github.com/dharnnie/dmux-skills`** (a repo you create separately — see §6.5). Until that repo exists, v1 ships the *infrastructure* with the default URL pointing at it, and the empty-catalogue path handles "URL returns 404" gracefully. Recommended: confirm — and accept that the catalogue's actual usefulness depends on the seed-repo work happening separately.

5. **Cache duration: 24 hours auto-stale + manual refresh.** Long enough to not hammer GitHub raw on every page load; short enough that a new skill appears within a day. Recommended: confirm.

6. **`dmux skills install <name>` falls through to catalogue.** Existing behavior + extended with one more lookup. Less ergonomic friction than introducing `dmux skills install-remote`. Recommended: confirm.

7. **No version pinning.** The catalogue points at a `raw_url` which is typically the `main` branch's `skill.yml`. Whatever's there at install time is what you get. Adding versioning (git refs in raw URLs) is a future concern. Recommended: confirm.

8. **No signature verification.** v1 trusts the catalogue repo's content. Anyone with PR-merge rights effectively has install-side-effect rights. Same trust model as `npm install`. Recommended: confirm — this is the solo-first scope; signing comes when teams adopt.

9. **Network calls happen server-side.** The UI hits dmux-ui's server, which does the GitHub fetch. Avoids CORS, centralizes the cache, lets the CLI use the same endpoints when the server is up. Recommended: confirm.

10. **Two slices, one PR.** Slice 1: catalogue infra + endpoints + CLI. Slice 2: UI + docs. Recommended: confirm.

---

## Section 6 — Open questions (defer to implementation if not blocking)

1. **What's the exact manifest YAML schema?** Pin during Slice 1 by writing a real catalogue.yml and seeing what fields prove necessary (description length limits, tag uniqueness, etc.).

2. **Network error UX.** Should "fetch failed, serving stale" be a toast, an inline warning on the section, or both? v1: inline warning (less obtrusive); revisit if users miss it.

3. **What about installing built-in skills FROM the catalogue?** Some users might want to reinstall a built-in after editing locally. v1: catalogue entries that share a name with a built-in are flagged "built-in available" and the Install button is hidden. They aren't actually duplicated.

4. **Catalogue refresh cadence in the CLI.** `dmux skills list` (no `--remote`) shouldn't trigger a fetch. `--remote` should. `--remote --no-refresh` to force the cached copy. Pin in Slice 1.

5. **The seed catalogue repo at `github.com/dharnnie/dmux-skills`.** Out of scope for this PR (can't push to it from here). After 3F lands, set up the repo with 2–3 example skills: `react-tdd`, `python-fastapi-bootstrap`, something else useful. Documented in `docs/skills-catalogue.md` as the next step.

6. **Should we expose `parseCatalogueManifest` for users who want to host their own catalogue?** Yes — already exposed via dmux-core/src/index.js. Other people can spin up their own catalogue, point `DMUX_SKILL_CATALOGUE_URL` at it, and dmux works with no fork.

7. **Removing an installed-from-catalogue skill.** The existing `dmux skills remove <name>` works; the catalogue entry doesn't disappear (it's not "uninstalled," just becomes available again). Confirmed by reading the existing remove path — no new code needed.

---

## Section 7 — What's explicitly NOT in Wave 3F

The biggest deferred items:

- **Workflows as a first-class concept.** Multi-step recipes over skills + git + MCP. Wave 3F.next (or a fresh design pass — they may not even live in the same wave as the marketplace).
- **Recommendation engines beyond Wave 2D's discovery.** The discovery agent already recommends skills during adopt; v1 doesn't add additional recommendation surfaces.
- **The "Claude Code features channel."** Curating CC's new releases as installable bits is more a curation discipline than a feature. Skip.
- **Paid skills / revenue share.** Solo-first scope. Future.
- **Ratings / comments / social features.** Static catalogue.
- **Multi-source catalogues.** One URL in v1.
- **Catalogue authentication.** v1 trusts the public repo.
- **Signature verification.** v1 trusts the catalogue maintainers.
- **Catalogue diffs / "what's new."** Just a freshly-fetched list each refresh.
- **Auto-updates of installed skills.** Install is one-shot. The user has to remove + reinstall to get a newer version. Documented.

---

## Implementation order (after this doc is approved)

Two slices, one PR:

**Slice 1 — Catalogue infrastructure.** ~1.5 days.
- `dmux-core/src/catalogue.js` with `parseCatalogueManifest` + tests.
- `dmux-ui/server/lib/catalogue.js` with fetch + cache + install helpers.
- Three endpoints: `GET /api/skills/catalogue`, `POST /api/skills/refresh-catalogue`, `POST /api/skills/install-from-catalogue`.
- `dmux.sh` skills handler extended: `--remote`, `refresh`, and the install fall-through.
- Smoke-test against a hand-crafted catalogue file served from a local file URL or a one-off gist.

**Slice 2 — UI + docs.** ~1 day.
- `useSkillsCatalogue` hook.
- `Skills` page extended with the Available section.
- "Refresh" button + last-fetched timestamp.
- `docs/skills-catalogue.md` (manifest format, contribution flow, override knobs, cache behavior).

Total ~2.5 days. Wave 3F v1 is done when:
- The infrastructure works against a real catalogue file (local file, gist, or the actual `dmux-skills` repo once it exists).
- The UI shows the Available section + at least one round-trip install from the catalogue completes correctly.

The actual `dmux-skills` seed repo is a follow-up (§6.5).

---

*Ready for review. Push back on anything in Section 5 (decisions) before implementation begins. The biggest scope call is §5.1: keeping workflows out of 3F. The biggest open question is §6.5: this wave's usefulness depends on the seed repo existing, which has to happen separately from the code in this PR.*
