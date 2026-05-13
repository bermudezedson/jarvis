# Jarvis CEO Cockpit — Session Summary v5
Última actualización: 2026-05-13

## Stack

- **Backend:** Node.js + Express en puerto 3000
- **Frontend:** React + Vite en puerto 5173
- **DB:** SQLite (`data/jarvis.db`) vía `better-sqlite3`
- **Gmail:** OAuth2 directo (no MCP) — `src/mcp/gmail.js`
- **Jira:** REST API directa con Basic auth (`email:api_token`) — `src/mcp/jira.js`
  - Auth: `Authorization: Basic {base64(JIRA_USER_EMAIL:JIRA_ACCESS_TOKEN)}`
  - Base URL: `https://api.atlassian.com/ex/jira/{JIRA_CLOUD_ID}/rest/api/3`
  - Agile URL: `https://api.atlassian.com/ex/jira/{JIRA_CLOUD_ID}/rest/agile/1.0`
  - **IMPORTANTE:** El MCP de Jira configurado NO tiene los tools de Jira (tiene `getTeamworkGraphContext`). `healthCheck()` devuelve 'connected' pero es falso positivo para ese MCP. La integración real es por REST API.
- **IA clasificación:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`) — para clasificación rápida y summaries de 1 línea
- **IA agéntica:** Claude Sonnet (`claude-sonnet-4-6`) — para análisis profundo de hilos y propuesta de acciones
- **Config:** YAML (`js-yaml`) en `config/`

## Arquitectura

```
Gmail API → universalInboxScan() → processUniversalScan() → SQLite threads
                                                               ↕
                                               /api/dashboard  →  React frontend
                                               thread_metrics ← getDashboardMetrics()

threads → analyzeThread() [Sonnet] → proposed_actions
                                          ↓ CEO aprueba
                                      createTicket() → Jira + moveToSprint()
```

### Fuente única de métricas
`src/skills/metrics.js` → `getDashboardMetrics()` → `/api/dashboard` (campo `thread_metrics`).
**Nadie más calcula conteos.** `en_jira` excluido de `actionable` en `getClientThreadsSummary()` y en `validate-dashboard.js`.

### Criterio de urgente
```
estado IN ('requiere_mi_accion', 'esperando_nosotros', 'pendiente')
AND severity IN ('high', 'critical')
AND last_sender_is_me = 0
AND estado != 'en_jira'
```

## Pipelines de correo

| Pipeline | Función | Trigger | Qué hace |
|----------|---------|---------|----------|
| `runUniversalScan()` | Principal | Cron cada hora + botón ↻ | Escanea todo inbox+sent, clasifica por origen |
| `classifyClientThreads({ mode: 'refresh_states' })` | Refresh | Cada 5 min (sin Gmail) | Recalcula severity/estado desde DB |
| `classifyClientThreads({ mode: 'initial' })` | Manual | Tab Correo → Escaneo inicial | Scan de 30 días solo clientes |

## Lógica de clasificación (order of precedence)

1. Estado terminal (`solucionado`, `archivado`) → skip
2. Dominio bloqueado (spam_domains + blacklist) → descartar
3. Subject en exclude_patterns → descartar
4. Learned rule → aplicar su estado/categoría
5. **Invoice override:** `no_action_pattern` + subject es factura + `lastSenderIsUs` + cliente conocido → `esperando_cliente`
6. `no_action_pattern` → `informativo`
7. Internal domain → `informativo`
8. Provider con alert keyword → `requiere_mi_accion`
9. Provider sin alert keyword → `informativo`
10. Client + lastSenderIsUs → `esperando_cliente`
11. Client + !lastSenderIsUs → `esperando_nosotros`
12. Unknown → AI classify (Haiku) → route

## Estados válidos en DB

| Estado | Significado | Tab en dashboard |
|--------|-------------|-----------------|
| `esperando_nosotros` | Cliente respondió, debemos actuar | Urgentes / Pendientes |
| `requiere_mi_accion` | Requiere acción explícita del CEO | Urgentes |
| `pendiente` | Manual CEO, pendiente de resolución | Pendientes |
| `esperando_cliente` | Nosotros respondimos, esperando al cliente | Esperando |
| `informativo` | FYI, no requiere acción | Informativos |
| `en_jira` | Escalado a Jira — **NO aparece en tabs activos** | — |
| `solucionado` | Resuelto | Solucionados |
| `archivado` | Archivado | Archivados |

## Schema SQLite — tablas clave

### threads (columnas nuevas desde v3)
```
ai_analysis TEXT          -- JSON del análisis de Sonnet
ai_analysis_at TEXT       -- datetime del último análisis
ai_summary TEXT           -- Resumen de 1 línea (Haiku)
summary_generated_at TEXT
source_type TEXT          -- 'client'|'provider'|'internal'|'unknown'
ai_classification TEXT    -- Clasificación Haiku para unknowns
is_new_contact INTEGER
manually_transitioned_at TEXT
classification_reason TEXT -- JSON con pasos del pipeline
jira_issue_key TEXT       -- ej: 'CLICK-713'
```

### proposed_actions (tabla nueva — Prompt #17)
```
id INTEGER PRIMARY KEY AUTOINCREMENT
thread_id TEXT
action_type TEXT    -- crear_ticket_jira|responder_correo|delegar|agendar_reunion|marcar_solucionado|escalar
description TEXT    -- Título del ticket (≤80 chars) o descripción de la acción
assignee TEXT       -- luciano|richard|johana|alejandro|null
priority TEXT       -- alta|media|baja
draft_content TEXT  -- null por ahora (Prompt #19)
status TEXT         -- pending|executed|rejected|superseded
time_estimate TEXT  -- 30m|1h|2h|4h|1d
created_at TEXT
resolved_at TEXT
resolved_by TEXT
```

## Cerebro agéntico — agent-brain.js

`src/skills/agent-brain.js` — análisis profundo con Sonnet.

### Flujo de analyzeThread(threadId, { force })
1. Cargar thread desde SQLite
2. Cache: si `ai_analysis_at` < 24h → retornar análisis existente + acciones del DB
3. Cargar mensajes (SQLite cache → fallback Gmail API)
4. Buscar tickets Jira relacionados (no bloqueante)
5. Construir prompt con contexto completo
6. Llamar Sonnet (`claude-sonnet-4-6`, `max_tokens: 1024`)
7. Parsing defensivo del JSON (3 intentos + fallback con `_parse_error: true`)
8. Guardar `ai_analysis` en threads
9. Marcar acciones anteriores como `superseded` si es force
10. Insertar nuevas acciones en `proposed_actions`
11. Registrar en `actions_log`

### Funciones auxiliares exportadas
- `getAnalysisCandidates()` — threads sin análisis en `requiere_mi_accion`/`esperando_nosotros` con `client_name`
- `resolveAssignee(name)` — 'luciano' → `{ nombre, jira_account_id, email, ... }` desde `config/team.yml`
- `getProjectForClient(clientName)` — 'WebySEO' → 'WYS', 'ClickRepuestos' → 'CLICK'
- `extractKeywords(subject)` — extrae 2-3 keywords para JQL (regex, sin IA)

### Prompt de Sonnet — reglas críticas
- Para `crear_ticket_jira` / `delegar`: `descripcion` = título del ticket, máx 80 chars, NO instrucción
- `tiempo_estimado`: `"30m"` limpiar/config, `"1h"` bug simple, `"2h"` feature pequeña, `"4h"` mediana, `"1d"` módulo nuevo
- Si hay tickets Jira relacionados → sugerir vincular, no crear duplicado

## Integración Jira — jira.js (reescrito en Prompt #18)

### Auth
```js
Authorization: Basic {base64(JIRA_USER_EMAIL:JIRA_ACCESS_TOKEN)}
```

### Datos del workspace
- **Cloud ID:** `97df9be6-4728-416b-89fe-667ef3961c4f`
- **Proyectos:** `CLICK` (ClickRepuestos ®, board 67), `WYS` (WebySEO ®, board 100)
- **Issue types (en español):** `Tarea`, `Historia`, `Error`, `Epic`
- **Sprint field:** `customfield_10020` — se asigna via `moveToSprint()` post-creación (el field en body es ignorado por Jira)

### Account IDs del equipo
| Persona | account_id |
|---------|------------|
| Luciano Alvares | `62727c32e01c14006a51fd3d` |
| Richard Martinez | `627280c8f42962006fdfa043` |
| Alejandro Bermúdez | `6358866a1cc605b1fd162e92` |
| Johana Pailanca | `null` — no tiene cuenta Jira |

### Funciones clave
- `createTicket({ summary, description, projectKey, issueType, assigneeAccountId, priority, labels, timeEstimate, sprintId })` — crea ticket + mueve a sprint
- `searchRelatedTickets(keywords, projectKey)` — JQL `summary ~ "keywords"`, retorna [] si falla
- `getActiveSprintForProject(projectKey)` — cache 1h, retorna `{ id, name, state, startDate, endDate }` o `null`
- `moveToSprint(issueKey, sprintId)` — `POST /agile/1.0/sprint/{id}/issue`
- `getLinkedTicket(threadId)` — busca en `actions_log` si ya se creó ticket para ese thread

### Descripción ADF
La descripción se convierte a Atlassian Document Format via `textToAdf()`. Markdown `##` se envía como texto plano (Jira lo renderiza bien).

## Config — team.yml (nuevo en Prompt #18)

`config/team.yml` — mapping equipo → Jira account IDs. Leer con `resolveAssignee()` en `agent-brain.js`.

## Flujo completo CEO → Jira

```
1. Thread en Urgentes/Pendientes
2. CEO expande thread → click "🤖 Analizar"
   → GET /api/mail/thread/:id/analysis (si ya hay análisis)
   → POST /api/mail/thread/:id/analyze (si no hay o re-analizar)
3. Panel muestra: resumen, urgencia, tipo, acciones sugeridas
4. En acciones de tipo crear_ticket_jira o delegar:
   → click "📋 Preparar ticket"
   → POST /api/agent/action/:id/prepare-ticket
   → formulario pre-llenado: título, proyecto, sprint activo, tipo, prioridad, asignado, tiempo, etiquetas, descripción
5. CEO edita campos si quiere → click "✅ Crear ticket"
   → POST /api/agent/action/:id/create-ticket
   → Jira: POST /issue + POST /agile/1.0/sprint/{id}/issue
   → thread.estado → 'en_jira', thread.jira_issue_key → 'CLICK-XXX'
6. Formulario muestra "✅ Ticket CLICK-XXX creado" con link
```

## Endpoints — cerebro agéntico (nuevos desde v3)

| Endpoint | Qué hace |
|----------|---------|
| `POST /api/mail/thread/:id/analyze` | Llama Sonnet, guarda análisis + acciones. Body: `{ force: bool }` |
| `GET /api/mail/thread/:id/analysis` | Retorna análisis JSON + acciones pending del DB |
| `GET /api/agent/candidates` | Threads sin análisis reciente que requieren acción |
| `GET /api/agent/pending-actions` | Todas las acciones pending con contexto del thread |
| `POST /api/agent/action/:id/prepare-ticket` | Preview editable del ticket con sprint activo |
| `POST /api/agent/action/:id/create-ticket` | Crea ticket en Jira real + mueve a sprint |
| `POST /api/agent/action/:id/reject` | Marca acción como rejected |

## Endpoints — correo (existentes, sin cambios desde v3)

| Endpoint | Qué hace |
|----------|---------|
| `GET /api/dashboard` | Datos completos + thread_metrics |
| `GET /api/dashboard/metrics` | Solo métricas |
| `GET /api/mail/client-threads` | Lista threads activos desde DB |
| `GET /api/mail/uncategorized` | Threads `source_type=unknown` sin analizar |
| `GET /api/mail/scan-status` | Estado del último scan |
| `POST /api/mail/universal-scan` | Forzar scan universal |
| `POST /api/mail/thread/:id/analyze` | *ver arriba* |
| `POST /api/mail/thread/:id/summary` | Genera resumen 1 línea con Haiku |
| `POST /api/mail/thread/:id/suggest-reply` | Borrador de respuesta con Haiku |
| `POST /api/mail/thread/:id/reply` | Enviar respuesta por Gmail |
| `POST /api/mail/thread/:id/transition` | Cambiar estado (state machine) |
| `POST /api/mail/thread/:id/feedback` | Corrección CEO → regla aprendida |
| `GET /api/mail/thread/:id/why` | Trazabilidad de clasificación |
| `GET /api/mail/rules-full` | Todas las reglas del sistema |
| `POST /api/mail/silence-domain` | Blacklist de dominio + archivar threads |
| `POST /api/mail/silence-pattern` | Blacklist de patrón de subject |

## Dashboard React — componentes nuevos/modificados

| Componente | Cambio |
|------------|--------|
| `ClientActionList.jsx` | Botón "🤖 Analizar" en cada ThreadRow; al click carga acciones del DB si ya hay análisis (GET /analysis), sino llama Sonnet (POST /analyze) |
| `AnalysisPanel` (en ClientActionList) | Muestra resumen, urgencia, tipo, acciones. En `crear_ticket_jira` / `delegar` → botón "📋 Preparar ticket". Botón "❌ Rechazar" en todas las acciones. |
| `TicketPreview.jsx` (nuevo) | Formulario editable: título, proyecto, sprint, tipo, prioridad, asignado, tiempo estimado, etiquetas, descripción. Muestra tickets similares si los hay. |

## Scripts útiles

```bash
node scripts/validate-dashboard.js    # 7 checks de consistencia (8/8 ideal, 7/8 real — mismatch Nuevos pre-existente)
node scripts/audit-rules.js           # Detecta conflictos entre reglas
node scripts/reclassify-invoices.js   # Reclasifica facturas team-sent mal clasificadas
```

## Estado actual del auditor (audit-rules.js)

- ✅ 0 conflictos activos
- ⚠️ 1 warning: patrón "Factura N°" matchea thread de Repuestos del Sol (pre-existente, pendiente de decisión)

## Prompts completados

| # | Descripción | Estado |
|---|-------------|--------|
| 1-8 | Desarrollo inicial | ✅ |
| 12 | Universal scan, blacklist pipeline, Nuevos tab | ✅ |
| 13 | Auditoría y estabilización: metrics.js, classification_reason | ✅ |
| 14 | Fix métricas, reglas gobernables, RulesPanel, deduplicación | ✅ |
| 15 | Fix conflicto facturas/auto-archivo, audit-rules.js | ✅ |
| 16 | Limpieza post-auditoría: patrones, reglas redundantes | ✅ |
| 17 | Cerebro agéntico: agent-brain.js, Sonnet analiza hilos, proposed_actions, botón "🤖 Analizar" | ✅ |
| 18 | Jira bidireccional: jira.js reescrito (REST API), team.yml, TicketPreview, prepare/create/reject | ✅ |
| 18b | Títulos descriptivos en tickets, descripción estructurada (## Problema / ## Qué se necesita), tiempo estimado | ✅ |
| 18c | Sprint activo: getActiveSprint(), moveToSprint(), dropdown en formulario, CLICK board 67 sprint 413 / WYS board 100 sprint 100 | ✅ |

## Pendientes de decisión

1. **Regla learned ID 9:** "Diferencia en cantidades solicitadas por API" → archivado. Alerta ERP de ClickRepuestos. Verificar si requiere atención.
2. **2 threads Repuestos del Sol** (Factura N°382/380 a terceros) en `informativo`, fecha NULL. Decidir si son informativos o requieren acción.
3. **Mismatch "Nuevos":** `metrics.nuevos_sin_catalogar=62` vs `tab Nuevos=50`. Pre-existente, no crítico.
4. **Johana no tiene cuenta Jira** — tickets asignados a ella quedan sin asignado. Crear cuenta o redirigir a Alejandro.
