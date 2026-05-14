# Jarvis CEO Cockpit — Resumen de sesión completo (v6)

## Documento de continuidad — actualizado 14 mayo 2026, 23:00 Chile

**Este documento describe cómo funciona Jarvis HOY y hacia dónde va. No es un historial de cambios.**

---

## Quién soy

Alejandro Bermúdez Alcaino, CEO/CTO y fundador de:

- **WebySEO** (https://webyseo.cl/) — Agencia de Marketing Digital pivoteando a Enterprise. Target: empresas grandes con 5+ sucursales, SEO técnico, E-commerce de alto nivel, sincronización de ERPs.

- **ClickRepuestos** (https://erp.clickrepuestos.cl) — Ecosistema SaaS en AWS para repuestos automotrices. ERP/WMS omnicanal con integraciones a MercadoLibre, Shopify, Walmart, Ripley. 10 clientes B2B (cerrados por recomendación, sin marketing), Marketplace B2C con 80k visitas mensuales en MVP.

**Endgame:** Cliente B2C compra en el Marketplace → data limpia identifica repuesto exacto → sistema recomienda y agenda Taller Mecánico asociado.

**Email CEO:** alejandro@webyseo.cl / hablemos@clickrepuestos.cl
**Equipo clave:** Johana Pailanca (Administración y Finanzas — NO tiene cuenta Jira), Luciano Alvares (Desarrollo ERP, integraciones API), Richard Martínez (Hosting, servidores, cPanel, SSL, dominios, MercadoLibre, Shopify, Walmart)

**Preferencias:** Asesor empresarial sin filtros. Desafía suposiciones. Prioriza verdad incómoda. Métricas SaaS.

---

## Qué es Jarvis

Agente de productividad personal (herramienta interna, NO producto) construido con Claude Code. Cockpit de CEO para gestionar correos, tareas Jira, compromisos y agenda desde un dashboard local.

**Estado actual:** Agente con análisis inteligente de correos, creación de tickets Jira, y **sincronización bidireccional con Gmail**. Las 5 capas de reglas filtran el 90% de los correos sin IA. Haiku clasifica el 10% restante de correos desconocidos. Sonnet analiza los correos que requieren acción y puede detectar spam. Los correos procesados reciben labels automáticos en Gmail (Jarvis/Cliente, Jarvis/Procesado, Jarvis/Acción Requerida, etc.). El CEO puede marcar spam desde el dashboard con un click — archiva en Jarvis, mueve a spam en Gmail, y opcionalmente bloquea el dominio para siempre.

**Próximo paso:** Borradores de respuesta inteligentes (Prompt #19) y panel unificado de acciones (Prompt #20).

### Stack técnico
- **Backend:** Node.js + Express (puerto 3000)
- **Frontend:** React + Vite (puerto 5173)
- **Base de datos:** SQLite local con better-sqlite3 (`data/jarvis.db`)
- **Gmail:** API directa con OAuth2
- **Jira:** REST API directa con Basic Auth (API token de Atlassian). MCP NO se usa para Jira — no funcionaba.
- **Calendar, Confluence:** via MCP
- **IA clasificación:** API Anthropic (Claude Haiku 4.5) — solo para correos desconocidos
- **IA agéntica:** API Anthropic (Claude Sonnet 4.6) — análisis de correos y propuesta de acciones
- **Proyecto local:** `/Users/alejandro/Developers/jarvis`
- **Repositorio:** Git

---

## Cómo funciona el sistema de correos (el corazón de Jarvis)

### Pipeline principal: Universal Inbox Scan

Cada hora (cron) o al presionar ↻ Actualizar, Jarvis ejecuta un scan universal que lee TODO el inbox de Gmail (no solo clientes conocidos). El correo pasa por 5 capas de evaluación en orden:

**Capa 1 — Descarte por dominio** (`spam_domains` + `blacklist.discard_domains` en rules.yml)
Mira SOLO el dominio del remitente (@mailchimp.com, etc.). Si matchea → descartar sin guardar. No mira asunto ni contenido.

**Capa 2 — Descarte por asunto** (`exclude_patterns` en rules.yml)
Mira SOLO el asunto. Si contiene un patrón ("nota de Venta Normal N", etc.) → descartar sin guardar. No mira quién lo envió.

**Capa 3 — Informativo por asunto** (`no_action_patterns` en rules.yml)
Mira SOLO el asunto. Si contiene un patrón ("Factura N°", "Duplicator", etc.) → clasificar como INFORMATIVO. **Excepción:** si el correo es una factura enviada por nuestro equipo a un cliente, va a ESPERANDO_CLIENTE en vez de informativo (ver "Lógica de facturas" abajo).

**Capa 4 — Reglas aprendidas** (`learned_rules` en SQLite)
Cada regla tiene un `match_type` que define dónde busca:
- `subject` → busca el patrón en el asunto
- `from` → busca en el email/dominio del remitente
- `subject+from` → busca en ambos (más precisa)
Las reglas se crean desde el feedback del CEO (2 fases: proponer → confirmar). Se pueden editar, eliminar y desactivar desde el panel de reglas del dashboard.

**Capa 5 — Identificación de origen**
- ¿Dominio en `clients.yml`? → source: client, asignar cliente
- ¿Dominio en `team.domains`? → source: internal → INFORMATIVO
- ¿Dominio en `providers.yml`? → source: provider → INFORMATIVO (salvo que el asunto contenga `alert_keywords` → REQUIERE_ACCION con severity HIGH)
- Ninguno → source: unknown → Claude Haiku clasifica (prospecto, proveedor, plataforma, personal, spam)

### Lógica de facturas

Las facturas se manejan según QUIÉN las envió:
- **Nuestro equipo → cliente:** ESPERANDO_CLIENTE (esperamos pago). Escala a PENDIENTE tras 15 días sin respuesta.
- **Proveedor → nosotros:** INFORMATIVO (solo para registro).
- **Sistema automático:** INFORMATIVO.

### Dos relojes en paralelo

1. **Universal scan (cada 1 hora):** Llama a Gmail API, trae todo lo nuevo, aplica las 5 capas. Ventana de 90 minutos con overlap para no perder nada. El dedup por thread_id en SQLite evita duplicados.

2. **Refresh states (cada 5 minutos):** NO llama a Gmail. Solo recalcula severidades y estados en SQLite con lo que ya tiene. Es gratis (0 llamadas externas). Respeta transiciones manuales del CEO por 24 horas (`manually_transitioned_at`).

### Trazabilidad

Cada thread tiene un campo `classification_reason` (JSON) que registra la cadena de decisión: qué pipeline lo procesó, qué reglas se evaluaron, cuál matcheó, y por qué quedó en ese estado. Se puede ver en el dashboard con el botón "¿Por qué?" en cada thread. Endpoint: `GET /api/mail/thread/:id/why`.

---

## Cerebro agéntico — Sonnet analiza y propone (NUEVO en sesión 2)

### Flujo completo implementado

```
Correo llega → 5 capas de reglas (gratis, 90% resuelto aquí)
                     ↓ (solo lo que requiere acción de clientes)
              CEO clickea "🤖 Analizar" en el dashboard
                     ↓
              Jarvis busca tickets relacionados en Jira (JQL)
                     ↓
              Sonnet lee hilo completo + contexto Jira + info cliente
                     ↓
              Propone 1-3 acciones con JSON estructurado
                     ↓
              CEO ve análisis + acciones en el dashboard
                     ↓
              Si acción = crear_ticket_jira:
                CEO clickea "📋 Preparar ticket"
                     ↓
                Formulario editable (título, proyecto, tipo, prioridad,
                asignado, sprint, tiempo estimado, etiquetas, descripción)
                     ↓
                CEO edita lo que quiera → "✅ Crear ticket"
                     ↓
                Ticket creado en Jira real + asignado al sprint activo
                Thread pasa a estado EN_JIRA
```

### Archivo clave: `src/skills/agent-brain.js`

- **`analyzeThread(threadId, { force })`** — Flujo completo: carga thread de SQLite → carga mensajes via Gmail API (`getFullThread()` con body_text completo) → carga info del cliente de `clients.yml` → busca tickets relacionados en Jira → construye prompt con todo el contexto → llama a Sonnet → parsea JSON defensivamente → guarda en SQLite + `proposed_actions`
- **`getAnalysisCandidates()`** — Lista threads candidatos para analizar (estado activo + client_name IS NOT NULL + sin análisis reciente)
- **`parseAgentResponse()`** — 3 intentos de parsear JSON + fallback con `_parse_error: true`
- **`extractKeywords()`** — Extrae 2-3 keywords del subject para JQL (regex/stopwords, NO IA)
- **`resolveAssignee()`** — Resuelve nombre → account ID de Jira via `config/team.yml`
- **`getProjectForClient()`** — Determina proyecto Jira (CLICK o WYS) según `client_empresa` en `clients.yml`

### AGENT_PROMPT — reglas embebidas en el código

El prompt de Sonnet incluye (permanente en `agent-brain.js`, no depende de memoria de Claude):
- Contexto del CEO y las empresas
- Reglas de delegación del equipo
- Info del cliente, asunto, estado, severidad, días sin respuesta
- Hilo completo de correos (body_text truncado a 2000 chars por mensaje)
- Tickets Jira relacionados (si existen)
- Instrucciones para JSON estructurado con: resumen, urgencia, tipo, acciones_sugeridas, contexto_adicional
- Reglas de formato de títulos (descriptivo, NO instrucción, máx 80 chars)
- Guía de estimación de tiempo (30m a 1d según complejidad)

### Protecciones implementadas

- **Cache 24h:** No re-analiza un thread si tiene análisis de < 24 horas (salvo force=true / "🔄 Re-analizar")
- **Parsing defensivo:** 3 niveles de fallback para JSON malformado
- **Acciones superseded:** Al re-analizar, las acciones anteriores se marcan como 'superseded' (no se borran)
- **Jira graceful:** Si la búsqueda de tickets falla, continúa sin contexto Jira (no bloquea)
- **Anti-duplicado:** Si un thread ya tiene ticket creado, `prepare-ticket` retorna `already_linked`
- **Solo manual:** El análisis solo se activa con el botón "🤖 Analizar". NO hay análisis automático post-scan.

### Costo estimado real

- Sonnet 4.6: ~$3/MTok input, ~$15/MTok output
- Un hilo promedio: ~2000-5000 tokens input + ~500 tokens output
- Costo por análisis: $0.01-0.02
- 15 análisis diarios: ~$6-10/mes

---

## Integración Jira (NUEVO en sesión 2)

### Conexión

- **REST API directa** con Basic Auth (email + API token de Atlassian)
- El MCP de Jira configurado originalmente NUNCA funcionó (tools equivocados, healthCheck() era falso positivo)
- Credenciales en `.env`: `JIRA_HOST`, `JIRA_EMAIL`, `JIRA_ACCESS_TOKEN`

### Proyectos Jira

| Proyecto | Key | Board ID | Sprint activo |
|----------|-----|----------|---------------|
| ClickRepuestos | CLICK | 67 | Sí (ID variable) |
| WebySEO | WYS | 100 | Sí (ID variable) |

**IMPORTANTE:** El proyecto WebySEO es `WYS`, NO `WS` como decía la documentación anterior.

### Issue types (en español en esta instancia)

- Tarea (equivale a Task)
- Historia (equivale a Story)
- Error (equivale a Bug)

### Equipo en Jira (`config/team.yml`)

| Miembro | Account ID | Proyectos | Cuenta Jira |
|---------|-----------|-----------|-------------|
| Luciano Alvares | En team.yml | CLICK | ✅ |
| Richard Martínez | En team.yml | WYS | ✅ |
| Alejandro Bermúdez | En team.yml | CLICK, WYS | ✅ |
| Johana Pailanca | N/A | N/A | ❌ NO tiene cuenta Jira |

### Funciones en `src/mcp/jira.js` (reescrito completo)

- `searchRelatedTickets(query, projectKey)` — Busca tickets similares con JQL
- `createTicket({ summary, description, projectKey, issueType, assigneeAccountId, priority, labels })` — Crea ticket con ADF
- `moveToSprint(issueKey, sprintId)` — Mueve ticket al sprint (post-creación, porque el campo sprint se ignora en creación)
- `getActiveSprint(boardId)` — Obtiene sprint activo de un board
- `getBoards()` — Lista boards disponibles
- `getAvailableProjects()` — Lista proyectos
- `getLinkedTicket(threadId)` — Busca si ya existe ticket para este thread
- Conversión de prioridad: 'alta' → 'High', 'media' → 'Medium', 'baja' → 'Low'

### Flujo de creación de ticket

1. CEO clickea "📋 Preparar ticket" en una acción propuesta
2. `POST /api/agent/action/:id/prepare-ticket` retorna preview con campos pre-llenados + opciones (asignados, proyectos, tipos, prioridades, sprints)
3. Dashboard muestra formulario editable (TicketPreview.jsx)
4. CEO modifica lo que quiera y clickea "✅ Crear ticket"
5. `POST /api/agent/action/:id/create-ticket` crea el ticket + lo mueve al sprint
6. Thread pasa a estado `en_jira` con `jira_issue_key`

---

## Máquina de estados

```
REQUIERE_ACCION    → Cliente escribió, CEO necesita actuar
REQUIERE_MI_ACCION → Sinónimo de requiere_accion
ESPERANDO_NOSOTROS → Cliente escribió, equipo necesita actuar
PENDIENTE          → Requiere acción pero no urgente
ESPERANDO_CLIENTE  → CEO/equipo respondió, espera al cliente
EN_JIRA            → Delegado a Jira (ticket creado)
INFORMATIVO        → No requiere acción
SOLUCIONADO        → Resuelto. Estado final con tiempo de resolución
ARCHIVADO          → Descartado. Estado final
```

**Reglas automáticas:**
- Informativos → Archivado después de 7 días (excepto facturas del equipo con escalación pendiente)
- Facturas del equipo sin respuesta → Pendiente después de 15 días
- Esperando cliente +14 días → severity HIGH
- Cliente confirma pago (keywords) → Solucionado automático

**Nota:** `en_jira` fue excluido del conteo de "actionable" en `getClientThreadsSummary()` y en `validate-dashboard.js` para mantener consistencia de métricas.

---

## Métricas — fuente única de verdad

`src/skills/metrics.js` calcula TODAS las métricas del dashboard en una sola función. Todos los componentes del frontend leen de este módulo via `GET /api/dashboard/metrics`. Nadie más calcula conteos.

Script de validación: `node scripts/validate-dashboard.js` (debe pasar 7/8 — el mismatch de "Nuevos" es pre-existente).

---

## Sistema de reglas — gobernabilidad

### Fuentes de reglas
| Fuente | Archivo | Qué contiene | Editable desde UI |
|--------|---------|-------------|-------------------|
| spam_domains | rules.yml | Dominios bloqueados | Sí (silenciar dominio) |
| exclude_patterns | rules.yml | Patrones de asunto para descartar | Panel de reglas |
| no_action_patterns | rules.yml | Patrones de asunto → informativo | Panel de reglas |
| blacklist | rules.yml | Dominios y subjects adicionales para descartar | Sí (silenciar) |
| priority_keywords | rules.yml | Keywords que marcan urgente | Panel de reglas |
| learned_rules | SQLite | Reglas del feedback del CEO | Sí (editar, eliminar, toggle) |
| providers | providers.yml | Proveedores con alert_keywords | Panel de reglas |
| state_machine | rules.yml | Timers de auto-archivo y escalación | Panel de reglas |

### Herramientas de gestión
- **Panel de reglas** en el dashboard: 7 secciones colapsables, edición inline, eliminación con confirmación, toggle por regla, origen/contexto por regla
- **Botón 🔇 Silenciar** en cada thread: agrega dominio a blacklist con un click
- **Auditor de reglas:** `node scripts/audit-rules.js` o `GET /api/mail/audit-rules` — detecta 5 tipos de conflictos
- **Deduplicación:** `POST /api/mail/learned-rules/deduplicate`

---

## Estructura del proyecto

```
jarvis/
├── config/
│   ├── rules.yml              # Reglas: spam, keywords, team domains, no_action_patterns, state_machine, blacklist
│   ├── clients.yml            # 18 clientes B2B con dominios y contactos
│   ├── providers.yml          # Proveedores conocidos (AWS, Google, MercadoLibre, Transbank, bancos, NIC.cl, SII)
│   ├── team.yml               # NUEVO — Mapping equipo a Jira (account IDs, skills, proyectos)
│   └── mcp-servers.json       # Calendar y Confluence (Jira NO usa MCP)
├── data/
│   └── jarvis.db              # SQLite — fuente principal
├── scripts/
│   ├── validate-dashboard.js  # Validación de consistencia de métricas
│   ├── audit-rules.js         # Detector de conflictos entre reglas (5 tipos)
│   └── reclassify-invoices.js # Reclasificación retroactiva de facturas
├── src/
│   ├── index.js
│   ├── db/
│   │   └── database.js        # Schema + migraciones idempotentes (ALTER TABLE con try/catch)
│   ├── mcp/
│   │   ├── gmail.js           # API directa OAuth2: universalInboxScan, getFullThread (body_text completo), sendReply, createDraft
│   │   ├── jira.js            # REESCRITO — REST API directa Basic Auth: createTicket, searchRelatedTickets, moveToSprint, getActiveSprint
│   │   ├── calendar.js        # Via MCP
│   │   └── confluence.js      # Via MCP
│   ├── skills/
│   │   ├── agent-brain.js     # NUEVO — Cerebro agéntico: analyzeThread (Sonnet), parseAgentResponse, extractKeywords, resolveAssignee
│   │   ├── daily-briefing.js  # Briefing AM/PM
│   │   ├── mail-ops.js        # processUniversalScan, classifyClientThreads, isInvoiceSubject, generateSummaryForThread
│   │   ├── state-machine.js   # transition, runAutoRules (con safety net de facturas)
│   │   ├── metrics.js         # Fuente única de métricas del dashboard
│   │   ├── client-pulse.js    # Health score por cliente
│   │   ├── task-bridge.js     # Email → Jira → Calendar (legacy, pre-agente)
│   │   ├── commitment-tracker.js
│   │   └── doc-engine.js      # Fase futura
│   ├── utils/
│   │   ├── ai-classifier.js   # Clasificación Haiku (legacy, usado por mail-ops)
│   │   ├── date-helpers.js
│   │   └── logger.js
│   ├── api/routes.js          # Todos los endpoints REST
│   └── cron/
│       ├── morning-briefing.js
│       ├── evening-closing.js
│       └── universal-scan.js  # Cron cada hora
├── dashboard/
│   └── src/
│       ├── App.jsx
│       ├── components/
│       │   ├── StatusBar.jsx          # 4 métricas CEO (lee de threadMetrics)
│       │   ├── ClientActionList.jsx   # ThreadRow expandible + filtros + botón 🤖 Analizar + AnalysisPanel + TicketPreview
│       │   ├── TicketPreview.jsx      # NUEVO — Formulario editable para crear tickets Jira
│       │   ├── FeedbackModal.jsx      # Enseñar a Jarvis (2 fases)
│       │   ├── RiskRadar.jsx          # Alertas calculadas (lee de threadMetrics)
│       │   ├── TodayAgenda.jsx        # Eventos + bloques trabajo profundo
│       │   ├── RulesPanel.jsx         # Panel completo: 7 secciones, editar/eliminar/toggle por regla
│       │   └── MessageBubble.jsx      # Mensajes con sender, CC, Para
│       └── hooks/
│           ├── useJarvisData.js       # Expone threadMetrics a todos los componentes
│           └── useMailInbox.js
├── AUDIT-REPORT.md
└── BACKLOG.md
```

---

## SQLite Schema

```
threads             — estado, severidad, cliente, source_type, ai_classification, classification_reason,
                      manually_transitioned_at, is_new_contact, jira_issue_key,
                      ai_analysis (JSON del análisis Sonnet), ai_analysis_at (timestamp)
messages            — Cuerpo de correos (lazy loaded), to_recipients, cc_recipients, is_from_team
proposed_actions    — NUEVO: acciones propuestas por Sonnet (action_type, assignee, priority, draft_content,
                      status: pending/approved/rejected/executed/superseded, time_estimate)
actions_log         — Log de acciones (replied, archived, resolved, feedback, state_transition, reclassified,
                      ai_analysis, jira_ticket_created)
drafts              — Borradores propuestos por IA
feedback            — Correcciones del CEO (original vs correcto + explicación)
learned_rules       — Reglas aprendidas (pattern, match_type, action, active, origin, times_applied)
contacts            — Contactos con nombre, rol, cliente
metadata            — Key-value (last_scan_at, etc.)
scan_log            — Registro de cada scan (tipo, threads encontrados/descartados/clasificados por IA)
```

---

## Endpoints REST principales

### Dashboard
- `GET /api/dashboard` — Datos consolidados (incluye thread_metrics)
- `GET /api/dashboard/metrics` — Fuente única de métricas
- `GET /api/health` — Status MCP

### Correo — Scan y clasificación
- `POST /api/mail/universal-scan` — Scan universal (todo el inbox)
- `POST /api/mail/client-scan` — Scan legacy (mantiene retrocompatibilidad)
- `GET /api/mail/client-threads?estado=` — Threads desde SQLite
- `GET /api/mail/uncategorized` — Threads sin catalogar (source_type=unknown)

### Correo — Mensajes y respuestas
- `GET /api/mail/thread/:id/messages` — Lazy load
- `POST /api/mail/thread/:id/reply` — Enviar con to + cc
- `POST /api/mail/thread/:id/suggest-reply` — Borrador IA (Haiku)
- `POST /api/mail/thread/:id/summary` — Resumen IA
- `GET /api/mail/thread/:id/why` — Trazabilidad: por qué está clasificado así

### Correo — Estado y transiciones
- `POST /api/mail/thread/:id/transition` — Mover entre estados (protegido 24h contra refresh)
- `POST /api/mail/auto-rules` — Ejecutar reglas automáticas

### UX mejorado (Prompt #18d)
- **Action bar sticky:** El bloque de botones ahora está al TOP del acordeón (no al fondo). `position: sticky, top: 0`. Ya no desaparece del viewport.
- **Mensajes con scroll:** `max-height: 320px; overflow-y: auto` en `.thread-messages`. Los correos largos no empujan todo hacia abajo.
- **Textarea colapsable:** El área de respuesta empieza colapsada (solo botón "📝 Responder"). Se expande al hacer click. Incluye botón "✕ Cancelar" para volver a colapsar.
- **AnalysisPanel colapsable:** Muestra resumen en 1 línea con toggle ▶/▼. Expande todo el panel al hacer click.
- **Botón 🚫 Spam en action-bar:** Siempre visible, sin necesidad de análisis. Confirma con inline buttons: "Solo spam" | "+ Bloquear dominio" | ✕.
- **Botones en AnalysisPanel para tipo `marcar_spam`:** "🚫 Marcar spam" y "🔇 Spam + bloquear dominio" cuando Sonnet propone esta acción.

### Agente — Análisis y acciones (NUEVO)
- `POST /api/mail/thread/:id/analyze` — Ejecutar análisis de Sonnet para un thread
- `GET /api/mail/thread/:id/analysis` — Obtener análisis y acciones propuestas
- `GET /api/agent/candidates` — Threads candidatos para analizar
- `GET /api/agent/pending-actions` — Todas las acciones pendientes de aprobación
- `POST /api/agent/action/:id/prepare-ticket` — Preview editable del ticket Jira
- `POST /api/agent/action/:id/create-ticket` — Crear ticket en Jira real
- `POST /api/agent/action/:id/reject` — Rechazar una acción propuesta

### Spam y sincronización Gmail (NUEVO — Prompt #18d)
- `POST /api/mail/thread/:id/mark-spam` — Marcar como spam: archiva en SQLite, mueve a SPAM en Gmail, opcionalmente bloquea dominio en rules.yml. Body: `{ blockDomain: boolean }`

**Labels de Gmail (creados automáticamente al arrancar el servidor):**
- `Jarvis/Procesado` — Todo lo que Jarvis procesó
- `Jarvis/Cliente` — Correos de clientes conocidos
- `Jarvis/Proveedor` — Correos de proveedores
- `Jarvis/Spam` — Spam detectado por Jarvis
- `Jarvis/Acción Requerida` — Requiere respuesta del CEO
- `Jarvis/En Jira` — Tiene ticket en Jira
- `Jarvis/Solucionado` — Resuelto

**Funciones en `src/mcp/gmail.js`:**
- `ensureJarvisLabels()` — Crea/verifica labels al arrancar. Cachea IDs en `_labelCache`.
- `modifyThread(threadId, addLabels, removeLabels, markRead)` — Aplica/quita labels custom vía `/threads/{id}/modify`
- `archiveGmailThread(threadId)` — Quita INBOX, agrega Jarvis/Solucionado
- `markThreadAsSpam(threadId)` — Agrega SPAM + Jarvis/Spam, quita INBOX + UNREAD

**Sincronización automática:**
- **Universal scan:** labels aplicados a cada thread nuevo/cambiado de forma fire-and-forget
- **Transiciones manuales** (solucionado, archivado): sync Gmail en el endpoint de transition
- **Crear ticket Jira:** agrega `Jarvis/En Jira`
- **Marcar spam:** llama `markThreadAsSpam()`

**Script de sincronización retroactiva:** `node scripts/sync-gmail-labels.js` (ejecutar UNA VEZ para los threads existentes)

**IMPORTANTE sobre scopes OAuth2:** El refresh token debe tener `gmail.modify` (no solo `gmail.readonly`). Si los labels no aparecen, verificar los scopes de la app OAuth en Google Cloud Console. La función `request()` en gmail.js ahora lanza errores HTTP 4xx — antes los silenciaba.

### Reglas y feedback
- `GET /api/mail/rules-full` — Todas las reglas consolidadas con origen enriquecido
- `PUT /api/mail/learned-rules/:id` — Editar regla
- `DELETE /api/mail/learned-rules/:id` — Eliminar regla
- `POST /api/mail/learned-rules/deduplicate` — Eliminar duplicadas
- `GET /api/mail/audit-rules` — Detector de conflictos entre reglas
- `POST /api/mail/thread/:id/feedback` — Proponer regla
- `POST /api/mail/feedback/confirm` — Confirmar y aplicar retroactivo
- `POST /api/mail/silence-domain` — Silenciar dominio
- `POST /api/mail/silence-pattern` — Silenciar patrón de asunto

### Otros
- `GET /api/contacts?client=` | `PUT /api/contacts/:email`
- `GET /api/commitments` | `POST /api/commitments/scan`
- `GET /api/clients/pulse` | `POST /api/clients/pulse/refresh`
- `POST /api/task-bridge/email-to-jira` | `POST /api/task-bridge/sync-jira` (legacy)
- `GET /api/briefing/current|morning|evening` | `POST /api/briefing/refresh`

---

## clients.yml (18 clientes)

**ClickRepuestos:** Repuestos del Sol (Andrea Valenzuela), Amortiguadores K, Aspillaga Hornauer, Nutrabody
**WebySEO:** TGF Gruppo, Karry, Kosner (Lenisbeth), AS Automotriz, Sunny Travel, GSCom, Megaplaga, Clínica Dental Antofagasta, Funeraria Los Valles, Top Rental, Secretos del Sur
**Ambas:** QualityPro, Visla, May Energía

---

## providers.yml (proveedores conocidos)

AWS (sns.amazonaws.com, etc.), Google, MercadoLibre, Shopify, Transbank, BancoEstado, Banco Santander, NIC.cl, SII Chile. Cada proveedor tiene `alert_keywords` que hacen que correos con esas palabras escalen a requiere_accion con severity high.

---

## Decisiones de arquitectura (por qué funciona así)

1. **Herramienta personal, no producto.** Jarvis es para Alejandro, no para vender.
2. **SQLite local.** Una sola base de datos, sin red, sin latencia.
3. **Gmail API directa.** MCP era insuficiente para scan masivo. OAuth2 da acceso completo.
4. **Jira REST API directa.** MCP de Jira nunca funcionó correctamente. Basic Auth con API token es más confiable.
5. **Blacklist, no whitelist.** Lee TODO el inbox y descarta lo que no importa.
6. **5 capas de reglas en orden.** Minimiza el uso de IA (y costo).
7. **Facturas distinguen quién envió.** Safety net impide auto-archivo antes de 15 días.
8. **Una fuente de métricas.** `metrics.js` calcula todo.
9. **Transiciones manuales protegidas 24h.**
10. **Trazabilidad obligatoria.** Campo `classification_reason` en cada thread.
11. **Reglas gobernables.** Cada regla editable/eliminable desde el dashboard.
12. **Agente = reglas primero, Sonnet después.** 90% resuelto con regex gratis. Solo lo que requiere acción llega a Sonnet.
13. **Sonnet propone, CEO decide.** Nada se ejecuta automáticamente. El CEO siempre aprueba.
14. **Parsing defensivo.** 3 niveles de fallback para JSON de Sonnet.
15. **Títulos descriptivos, no instrucciones.** El AGENT_PROMPT tiene reglas explícitas de formato para tickets Jira.
16. **Sprint post-creación.** El campo sprint se ignora en la creación de Jira; se usa `moveToSprint()` después.

---

## Datos operativos conocidos

### source_type inconsistente
Los threads procesados por `classifyClientThreads()` (scan manual) mantienen `source_type = 'unknown'` porque ese pipeline no actualiza la columna. Solo `processUniversalScan()` la setea correctamente. Para identificar threads de clientes se usa `client_name IS NOT NULL` en vez de `source_type = 'client'`.

### validate-dashboard mismatch conocido
El check de "nuevos_sin_catalogar" tiene un mismatch pre-existente (55 vs 50). No fue introducido por los prompts 17-18. El resto pasa consistente.

---

## Pendientes conocidos (BACKLOG)

1. **Pipeline A (classify) es código huérfano.** El dashboard no lo usa. Deprecar o eliminar.
2. **Investigar no busca en Gmail.** Solo busca en SQLite.
3. **Investigate/add solo funciona para clientes.**
4. **Agenda sin datos.** TodayAgenda dice "Sin eventos". Verificar Calendar MCP.
5. **Compromisos en 0.** Ejecutar POST /commitments/scan.
6. **Doc Engine.** Migración Notion → Confluence, pendiente.
7. **Estado 'esperando_nosotros' no está en VALID_ESTADOS** de state-machine.js.
8. **Sprint vencido.** El sprint activo de CLICK mostraba "04 al 08 Mayo 2026" (ya vencido al 13 mayo). Cerrar en Jira y crear sprint de la semana actual.
9. **Johana sin Jira.** Cuando Sonnet propone delegar a Johana con ticket Jira, no se puede asignar. Considerar canal alternativo (email, WhatsApp).
10. **Análisis automático pendiente.** Hoy solo es manual (botón). Futuro: post-scan para threads de clientes con acción requerida.
11. **Sistema de notificaciones.** Cuando Sonnet dice "notificar a Alejandro", no hay canal de notificación. Futuro: push, badge en dashboard, o email interno.

---

## Roadmap: de dashboard a agente (Prompts #17-#20)

### Flujo agéntico implementado (parcial)
```
Correo llega → 5 capas de reglas (gratis, 90% resuelto aquí)
                     ↓ (solo lo que requiere acción)
              CEO clickea "🤖 Analizar"
                     ↓
              Sonnet lee hilo + busca en Jira + analiza
                     ↓
              Propone acciones (ticket, respuesta, delegación)
                     ↓
              Si ticket: CEO edita formulario → Crear en Jira ✅
              Si respuesta: pendiente Prompt #19
              Si otro: pendiente Prompt #20
```

### Estado de los prompts
| # | Qué hace | Estado |
|---|----------|--------|
| 17 | Sonnet lee y analiza correos (análisis + acciones sugeridas) | ✅ Implementado |
| 18 | Jira bidireccional (buscar, crear, asignar tickets) | ✅ Implementado |
| 18b | Correcciones: títulos descriptivos, descripción estructurada, tiempo estimado | ✅ Implementado |
| 18c | Sprint activo: asignar tickets al sprint via moveToSprint post-creación | ✅ Implementado |
| 19 | Borradores de respuesta inteligentes (tono del CEO, contexto Jira) | 🔜 Siguiente |
| 20 | Panel de acciones propuestas en React (aprobar/editar/rechazar unificado) | 🔜 |

### Post-agente: producción
| Paso | Qué hace | Estimación |
|------|----------|------------|
| Deploy EC2 | Nginx + HTTPS + PM2 + autenticación | 2-3h |
| Gmail webhook | Push notifications via Pub/Sub + API Gateway | 2-3h |
| Dashboard móvil | Responsive o PWA para iPhone | 2-3h |
| Planificación semanal | Sprint planning asistido por IA | TBD |
| Notificaciones | Canal de alertas para el CEO | TBD |

---

## Historial de prompts (referencia, no instrucciones)

| # | Qué hizo | Estado | Sesión |
|---|----------|--------|--------|
| 1-9 | Estructura base, dashboard, SQLite, acordeón, feedback, mensajes, contactos, informativos | ✅ | 1 |
| 10 | Reply al destinatario correcto + CC | ✅ | 1 |
| 11 | Máquina de estados + MoveToDropdown + auto-rules | ✅ | 1 |
| 12 | Universal Inbox Scan (blacklist pipeline) | ✅ | 1 |
| 13 | Auditoría y estabilización (AUDIT-REPORT.md) | ✅ | 1 |
| 14 | Métricas unificadas + reglas gobernables + trazabilidad | ✅ | 1 |
| 15 | Fix conflicto facturas + detector de conflictos + reclasificación 12 facturas | ✅ | 1 |
| 16 | Limpieza post-auditoría (reglas peligrosas eliminadas, warnings resueltos) | ✅ | 1 |
| 17 | Sonnet analiza correos (agent-brain.js, proposed_actions, botón Analizar) | ✅ | 2 |
| 18 | Jira bidireccional (REST API directa, createTicket, searchRelated, TicketPreview.jsx) | ✅ | 2 |
| 18b | Correcciones tickets (títulos descriptivos, descripción estructurada, tiempo estimado) | ✅ | 2 |
| 18c | Sprint activo (moveToSprint post-creación, dropdown sprint en formulario) | ✅ | 2 |
| 18d | Spam desde Jarvis, labels Gmail, UX mejorado (action-bar sticky, scroll msgs, textarea colapsable) | ✅ | 3 |
| 19 | Borradores de respuesta inteligentes | 🔜 | 4 |
| 20 | Panel de acciones propuestas en React | 🔜 | 4 |

---

## Cómo retomar

1. Sube este archivo (`jarvis-session-summary-v6.md`) en un chat nuevo de Claude Code
2. Di: "Soy Alejandro, estamos construyendo Jarvis CEO Cockpit. Aquí está el resumen v6. [qué quieres hacer]"
3. Para el siguiente paso di: "Quiero implementar el Prompt #19: borradores de respuesta inteligentes."
4. Para validar el estado actual: `node scripts/validate-dashboard.js` (debe pasar 7/8, el mismatch de Nuevos es conocido) y `node scripts/audit-rules.js` (debe pasar sin conflictos activos)
5. Para probar el agente: abrir dashboard → tab Urgentes → expandir thread → 🤖 Analizar → 📋 Preparar ticket → editar → ✅ Crear ticket
6. **IMPORTANTE:** Antes de crear tickets, verificar que el sprint activo en Jira esté vigente (no vencido)

### Qué NO está en el repo (solo en este documento)
- El archivo `jarvis-session-summary-v5.md` nunca se guardó en el repo. La última versión en el repo es `jarvis-session-summary-v3.md`.
- Este archivo v6 debe copiarse al repo como referencia: `cp jarvis-session-summary-v6.md /Users/alejandro/Developers/jarvis/`
