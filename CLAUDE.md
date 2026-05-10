# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Install everything
bash scripts/setup.sh

# Start API + dashboard together
bash scripts/start.sh

# Start API only (port 3000)
node src/index.js

# Start dashboard only (port 5173)
cd dashboard && npm run dev

# Force a briefing refresh now (bypasses cron)
curl -X POST http://localhost:3000/api/briefing/refresh

# Check MCP connection health
curl http://localhost:3000/api/health
```

## Architecture

Jarvis is a **cache-first** system. MCP servers and cron jobs write to JSON files in `src/cache/data/`. The dashboard and API only read from that cache — they never call MCP servers directly.

```
Cron / refresh button
       │
       ▼
src/skills/daily-briefing.js   ← orchestrates all MCP calls
       │
       ├── src/mcp/gmail.js
       ├── src/mcp/calendar.js
       └── src/mcp/jira.js
       │
       ▼
src/cache/data/*.json          ← source of truth for the dashboard
       │
       ▼
src/api/routes.js  ──→  GET /api/briefing/*
       │
       ▼
dashboard (Vite + React)       ← auto-refreshes every 5 min via useJarvisData.js
```

### Key files

| File | Purpose |
|------|---------|
| `config/rules.yml` | Business rules: cron schedule, spam domains, priority keywords, Jira stale threshold |
| `config/clients.yml` | B2B client list with domains and Jira labels — add new clients here |
| `src/skills/daily-briefing.js` | Full briefing logic: fetches, normalizes, classifies, writes cache |
| `src/mcp/*.js` | MCP client wrappers — each exports clean functions + `healthCheck()` |
| `src/cache/data/mock-briefing.json` | Realistic demo data used when MCP is not configured |
| `dashboard/src/hooks/useJarvisData.js` | Fetches API, handles 5-min auto-refresh, AM/PM toggle |

## MCP clients

Each client in `src/mcp/` uses `@modelcontextprotocol/sdk` with dynamic `import()` (required because the SDK is ESM). They throw when the corresponding env vars are missing, which `daily-briefing.js` catches — the briefing is still generated with data from the sources that succeeded, marking the failed ones in `sources`.

To wire up a real MCP server: set the `*_MCP_URL` and `*_ACCESS_TOKEN` env vars and restart.

## Timezone

All timestamps use `America/Santiago` (set via `TZ` env var and enforced in `src/utils/date-helpers.js`). Use `formatChile()` for all output timestamps.

## Phases

- **Fase 1 (current):** daily-briefing + dashboard + cron
- **Fase 2:** `mail-ops.js`, `task-bridge.js`, `commitment-tracker.js`, `client-pulse.js` — stubs exist
- **Fase 3:** `doc-engine.js` — stub exists

The stub files are in `src/skills/` and marked with phase comments. Do not implement them until their phase begins.

## Safe mode

`rules.yml > mail.safe_mode: true` — the agent must never perform write actions (send email, create Jira issue, delete anything) without explicit user confirmation. All current skills are read-only.
