# dmux-ui

Local web interface for [dmux](../README.md). Provides a visual alternative to writing YAML and running CLI commands.

## Stack

- **Server:** Node + Express — thin API layer that shells out to `dmux` CLI and reads config files directly
- **Frontend:** React 19 + Vite + React Router with CSS modules
- **No database** — stateless, reads `~/.config/dmux/projects` and per-project `.dmux-agents.yml`

## Development

```bash
npm install
npm run dev    # Express on :3100, Vite on :3101 (with hot reload)
```

## Production

```bash
npm run build
npm start      # Serves built assets on :3100
```
