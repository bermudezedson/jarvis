# Changelog

All notable changes to Jarvis CEO Cockpit are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versioning follows [Semantic Versioning](https://semver.org/).

---

## [0.6.1] — 2026-05-10

### Fixed
- Universal scan window raised from 2h minimum to 8h — prevents missing emails indexed with delay by Gmail
- Auto-calculated window (time since last scan + 30 min overlap) with 48h fallback on first run
- Refresh button no longer hardcodes `timeWindowMinutes`; server calculates optimal window

---

## [0.6.0] — 2026-05-10

### Added
- **Universal Inbox Scan** — scans ALL inbox threads, not just known client domains
- `config/providers.yml` — known providers: AWS, Google, Transbank, MercadoLibre, banks, NIC.cl, cPanel, GitHub
- `config/rules.yml` — new `blacklist` section (`discard_domains`, `discard_subjects`) as consolidated alias
- 4-step blacklist pipeline: discard → identify origin → Haiku AI for unknowns → routing
- `source_type`, `ai_classification`, `is_new_contact` columns in threads table
- `scan_log` table to track scan history and costs
- Dashboard tab **"Nuevos"** — shows uncategorized threads with AI classification badges
- `🔇 Silenciar` button per thread — one-click domain blacklisting + archive
- Endpoints: `POST /mail/universal-scan`, `GET /mail/uncategorized`, `GET /mail/scan-status`, `POST /mail/silence-domain`, `POST /mail/silence-pattern`
- Cron job: universal scan runs every hour

### Changed
- ↻ Actualizar button now triggers universal scan instead of incremental client scan
- Incremental and refresh-states crons registered properly on startup

---

## [0.5.0] — 2026-05-09

### Added
- **State machine** with 7 estados: `requiere_mi_accion`, `pendiente`, `esperando_cliente`, `en_jira`, `informativo`, `solucionado`, `archivado`
- **"Mover a ▾"** dropdown in every thread row — context-aware transitions per current estado
- **RulesPanel** — overlay showing learned rules, auto-rule config, no-action patterns, feedback history
- `src/skills/state-machine.js` — `transition()` + `runAutoRules()` (auto-archive, escalate, invoice pending)
- Auto-rules cron added to morning briefing
- `PUT /mail/learned-rules/:id` — toggle rule active/inactive

### Fixed
- FOREIGN KEY constraint error in feedback confirm — uses source thread_id for `logAction`

---

## [0.4.0] — 2026-05-08

### Added
- **Feedback loop** — 2-step propose/confirm flow; learned rules applied retroactively
- **Contacts table** seeded from `clients.yml`; inline name editing in MessageBubble
- **Team-aware classification** — `is_from_team` computed from `rules.yml team.domains`
- `team` section in `rules.yml` with `domains` and `ceo_emails`
- **Expandable informativos** — same accordion as other threads
- **AI summary per thread** — Claude Haiku, cached in `ai_summary` column, lazy-loaded
- Batch summary generation button ("✦ Resúmenes")
- **Reply to correct recipient** — finds last external (non-team) participant
- CC support in replies; Reply-All toggle
- `is_informativo` and `last_sender_is_team` columns in threads table

### Fixed
- FeedbackModal confirm phase — correct `feedback_id` and `apply_to_existing` keys
- SQLite DB path moved inside project (`jarvis/data/jarvis.db`)
- Stale message cache detection — re-downloads if `to_recipients` empty

---

## [0.3.0] — 2026-05-07

### Added
- Dashboard v2 — CEO Cockpit with real Gmail/Calendar/Jira data
- Client thread deep scan (30-day window, read + unread)
- SQLite as primary data store (better-sqlite3, WAL mode)
- `GET /mail/client-threads` — paginated thread list with filters
- Phishing report action
- Email lifecycle widget (MailStatusWidget)
- ERP noise filter (`exclude_patterns` in `rules.yml`)
- `pago_recibido` / `cobro_pendiente` categories

---

## [0.2.0] — 2026-05-06

### Added
- **Mail Classifier** — rule-based + Claude AI classification pipeline
- Iron Man dark theme dashboard
- Client Pulse with real data
- Gmail REST API integration (replaces MCP)
- `config/clients.yml` — B2B client list with domains and Jira labels

---

## [0.1.0] — 2026-05-05

### Added
- **Jarvis CEO Cockpit** — initial release
- Daily briefing: Gmail + Google Calendar + Jira summary
- Morning (7am) and evening (6pm) cron jobs
- Cache-first architecture (`src/cache/data/*.json`)
- Vite + React dashboard with 5-min auto-refresh
- MCP server integrations: Gmail, Calendar, Jira, Confluence
- `config/rules.yml` — business rules configuration
