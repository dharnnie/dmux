# dmux skills catalogue

dmux can install skills from a remote catalogue — a YAML manifest listing skills others have published, each pointing at a `skill.yml` you can install with one click (or one CLI command).

This doc covers: where the catalogue lives, the manifest format, how to add your own skill, how to point dmux at a different catalogue, and the cache behavior.

## Where the catalogue lives

By default, dmux fetches from:

```
https://raw.githubusercontent.com/dharnnie/dmux-skills/main/catalogue.yml
```

You can override that:

- **Env var:** `DMUX_SKILL_CATALOGUE_URL=https://...` (highest precedence)
- **File:** write the URL on a single line in `~/.config/dmux/catalogue.url`
- **Fallback:** the default above

The override only changes where dmux *reads* from. dmux never publishes — see "Contributing" below.

## Manifest format

The catalogue is a YAML file (JSON also works, since YAML is a superset). Shape:

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
    raw_url: https://example.com/go-api-bootstrap/skill.yml
```

Per-entry rules:

| Field | Required | Notes |
|---|---|---|
| `name` | yes | lowercase slug: `a-z`, `0-9`, `-`. Must be unique in the catalogue. |
| `description` | yes | non-empty string |
| `raw_url` | yes | must be `http://` or `https://`. Points at a `skill.yml` in the Wave 2B parameterized-skill format. |
| `author` | no | display string; defaults to none |
| `tags` | no | array of strings; empty/non-string entries are stripped |

Top-level `version` must be `1`. Future schema versions get their own number.

## What the skill.yml at `raw_url` looks like

dmux installs the file at `raw_url` directly into `~/.local/share/dmux/skills/<name>/skill.yml`. The format is the same as the parameterized-skill format from Wave 2B — see existing built-ins under `skills/` in the dmux repo for examples (e.g. `tdd-feature`).

dmux validates the fetched file via `parseSkillYaml` before writing — a broken `skill.yml` doesn't land on disk.

## Contributing a skill

dmux doesn't publish. To add a skill to the **default** community catalogue:

1. Fork `github.com/dharnnie/dmux-skills`.
2. Add a directory `<your-skill-name>/` with a `skill.yml` inside.
3. Add an entry to `catalogue.yml` pointing at the raw URL of your `skill.yml` on `main`.
4. Open a PR.

Skills get merged based on the maintainer's curation. dmux's trust model is "the catalogue maintainers vetted what's in there"; same posture as `npm install <name>` where you trust the registry.

To run a **private** catalogue (e.g. company-internal skills), spin up a YAML file at any URL — your own GitHub repo, a static site, anywhere reachable over HTTPS — and point dmux at it via the override env var. Same install flow.

## Cache behavior

- The catalogue is cached at `~/.config/dmux/catalogue.cache.json` after each successful fetch.
- **Auto-stale:** the cache is considered stale after 24 hours. The next read kicks off a fresh fetch in the background. The stale list is served immediately — the UI never blocks on a refresh.
- **Manual refresh:** `dmux skills refresh` (CLI) or the "↻ Refresh" button on the Skills page forces a fresh fetch.
- **Offline:** if the network is unreachable, dmux serves the cached copy alongside a warning. Empty cache + offline → empty list + warning.

## What dmux does NOT do (per Wave 3F design §7)

- **No version pinning.** `raw_url` typically points at `main`'s `skill.yml`. Whatever's there at install time is what you get.
- **No signature verification.** dmux trusts the catalogue maintainers — same trust model as any package manager.
- **No auto-updates.** Once you install a skill, it stays at the version you installed. To get a newer version, `dmux skills remove <name>` then `dmux skills install <name>`.
- **No ratings, comments, or social features.** Static catalogue.
- **No paid skills / revenue share.** Public catalogue, no payments.
- **No workflows yet.** "Named multi-step recipes over skills + git + MCP" was in the original outline but deferred to a future wave.

## CLI reference

```
dmux skills list                    # built-in + installed
dmux skills list --remote           # remote catalogue (requires `dmux ui` running)
dmux skills install <name>          # built-in OR remote (falls through automatically)
dmux skills refresh                 # force-refetch the catalogue
dmux skills remove <name>           # uninstall (works regardless of source)
```

The remote-catalogue commands (`list --remote`, `refresh`, and the install fall-through) need the dmux UI server running locally (`dmux ui`). The server does the network fetch + caches centrally; the CLI is a thin client.
