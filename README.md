# ⚡ Jarvis — CEO Cockpit v1.1.0

> Agente de productividad personal para CEOs de empresas B2B. Consolida Gmail, Jira y Google Calendar en un **cockpit ejecutivo** con cerebro agéntico: Sonnet analiza correos, propone acciones, y crea tickets en Jira. Los correos procesados quedan etiquetados en Gmail automáticamente.

**No es un SaaS. No manda tus datos a ningún lado.** Corre 100% en `localhost`.

---

## ¿Qué hace Jarvis?

Jarvis es un agente local que actúa como asistente ejecutivo digital. Clasifica todo el inbox de Gmail con 5 capas de reglas (sin IA para el 90%), usa Haiku para correos desconocidos, y Sonnet para análisis profundo de los correos que requieren acción del CEO.

**Flujo principal:**
1. El CEO abre el cockpit → ve métricas, sprint activo, correos urgentes y alertas
2. Hace click en un correo → se abre un modal con el hilo completo
3. Analiza con Sonnet → propone acciones (ticket Jira, responder, delegar, escalar)
4. El CEO aprueba con un click → ticket creado en Jira con sprint, estimación y asignado
5. El correo queda etiquetado `Jarvis/En Jira` en Gmail automáticamente

**El CEO siempre decide.** Sonnet propone, el CEO aprueba. Nada se ejecuta automáticamente.

---

## Arquitectura

```
Gmail API ──→ universalInboxScan() ──→ SQLite (threads + messages)
                                              │
                    ┌─────────────────────────┘
                    │
                    ▼
           analyzeThread() [Sonnet]  ──→  proposed_actions
                                                │
                                         CEO aprueba
                                                │
                                                ▼
                                       createTicket() ──→ Jira + Sprint
                                                │
                    ┌───────────────────────────┘
                    │
                    ▼
           Gmail Labels ◀──  syncThreadLabels()  ──▶  Express API (port 3000)
                                                              │
                                                              ▼
                                                    React Cockpit (port 5173)
                                                    Sidebar + Router + MailModal
```

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express (puerto 3000) |
| Frontend | React + Vite + React Router (puerto 5173) |
| Base de datos | SQLite vía `better-sqlite3` |
| Gmail | OAuth2 directo — labels bidireccionales (`gmail.modify` scope) |
| Jira | REST API directa con Basic auth — `api.atlassian.com` |
| IA clasificación | Claude Haiku 4.5 — clasificación rápida, resúmenes 1 línea |
| IA agéntica | Claude Sonnet (`claude-sonnet-4-6`) — análisis profundo, acciones |
| Config | YAML (`js-yaml`) en `config/` |

---

## Requisitos

- Node.js v18 o superior
- Cuenta Gmail con OAuth configurado (**scope `gmail.modify` requerido** para labels)
- Cuenta Atlassian/Jira con API token
- API Key de Anthropic (para el cerebro agéntico — requerido)

---

## Instalación

```bash
git clone https://github.com/bermudezedson/jarvis.git
cd jarvis
bash scripts/setup.sh
```

---

## Configuración

### Variables de entorno (`.env`)

```env
# Gmail OAuth2 (requiere scope gmail.modify para labels bidireccionales)
GMAIL_CLIENT_ID=...
GMAIL_CLIENT_SECRET=...
GMAIL_REFRESH_TOKEN=...

# Jira — REST API directa (Basic auth: email + API token)
JIRA_USER_EMAIL=tu@empresa.com
JIRA_ACCESS_TOKEN=tu-api-token-de-atlassian
JIRA_CLOUD_ID=tu-cloud-id-uuid

# Claude API
ANTHROPIC_API_KEY=sk-ant-...

# Timezone
TZ=America/Santiago
PORT=3000
```

> **Jira:** el `JIRA_ACCESS_TOKEN` es un **API token de Atlassian** (no OAuth). Generarlo en `id.atlassian.com → Security → API tokens`. La auth es `Basic base64(email:token)`.

### Clientes B2B (`config/clients.yml`)

```yaml
clients:
  - name: "Nombre del Cliente"
    domains: ["cliente.cl"]
    contacts: ["contacto@cliente.cl"]
    empresa: "TuEmpresa"
    jira_label: "client-nombrecliente"
```

### Equipo (`config/team.yml`)

```yaml
team:
  luciano:
    nombre: "Luciano Alvares"
    email: "luciano@empresa.cl"
    jira_account_id: "account-id-de-jira"
    skills: ["erp", "api", "bugs"]
  richard:
    nombre: "Richard Martinez"
    email: "richard@empresa.cl"
    jira_account_id: "account-id-de-jira"
    skills: ["hosting", "servidores", "ssl"]
```

---

## Uso

```bash
# Arrancar todo (API + dashboard)
bash scripts/start.sh

# Solo backend
node src/index.js

# Forzar scan de correos ahora
curl -X POST http://localhost:3000/api/mail/universal-scan

# Sincronizar labels de Gmail para todos los threads existentes (una vez)
node scripts/sync-gmail-labels.js
```

---

## Dashboard — Cockpit Ejecutivo

### Navegación (sidebar)

| Sección | Qué muestra |
|---------|-------------|
| **Inicio** | Métricas CEO + sprint activo + correos urgentes + carga del equipo + alertas |
| **Correo** | Lista filtrable de threads + modal de correo completo |
| **Tareas** | Acciones propuestas por Jarvis pendientes de aprobación |
| **Sprint** | Tickets del sprint activo en Jira (CLICK + WYS) |
| **Clientes** | Client Pulse — health score por cliente |
| **Reglas** | Reglas aprendidas, filtros y configuración de clasificación |

### Modal de correo

Al hacer click en cualquier hilo se abre el MailModal con:
- **Barra de acciones sticky** (siempre visible): Mover a, Responder, Analizar, Spam, Gmail↗, Corregir, ?
- **Análisis Sonnet colapsable** con acciones sugeridas y botones de ejecución
- **Mensajes con scroll** — auto-scroll al mensaje más reciente al abrir
- **Respuesta auto-borrador** — click en "✏ Escribir respuesta" genera borrador con Jarvis automáticamente
- **Prompt post-envío** — después de responder pregunta: ¿Quedó resuelto? → [Solucionado / Esperando / Pendiente]

### Labels Gmail automáticos

Jarvis mantiene 7 labels en Gmail sincronizados automáticamente:

| Label | Cuándo |
|-------|--------|
| `Jarvis/Procesado` | Todo correo que Jarvis escaneó |
| `Jarvis/Cliente` | Correos de clientes conocidos |
| `Jarvis/Acción Requerida` | Requiere respuesta del CEO |
| `Jarvis/En Jira` | Tiene ticket creado en Jira |
| `Jarvis/Solucionado` | Resuelto |
| `Jarvis/Spam` | Marcado como spam por Jarvis |
| `Jarvis/Proveedor` | Correos de proveedores |

Botón **✉ Sync Gmail** en el topbar sincroniza todos los hilos existentes.

### Búsqueda global

- **`Cmd+K`** desde cualquier página activa la búsqueda
- Busca en correos (subject, cliente, from), clientes (`clients.yml`) y tareas pendientes
- Si un correo no está en Jarvis → botón **📥 Buscar e importar desde Gmail**
- Soporta búsqueda por Message-ID exacto (`rfc822msgid:`)

---

## Flujo: correo → ticket Jira

1. Dashboard → **Correo** → click en un hilo urgente
2. Click **🤖 Analizar** → Sonnet lee el hilo + busca tickets relacionados en Jira
3. Panel de análisis: resumen, urgencia, tipo, acciones sugeridas
4. Para acciones `crear_ticket_jira` o `delegar` → click **📋 Preparar ticket**
5. Formulario pre-llenado: título descriptivo, proyecto, sprint activo, prioridad, asignado, tiempo estimado
6. El CEO edita si quiere → click **✅ Crear ticket**
7. Ticket creado en Jira + asignado al sprint activo
8. Thread pasa a estado `en_jira` + label `Jarvis/En Jira` en Gmail

---

## API Reference

### Correo y threads

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/mail/universal-scan` | Escanea inbox + sent, clasifica todo |
| `GET` | `/api/mail/client-threads` | Lista threads activos |
| `GET` | `/api/mail/thread/:id/messages` | Mensajes completos (orden cronológico) |
| `POST` | `/api/mail/thread/:id/reply` | Enviar respuesta por Gmail |
| `POST` | `/api/mail/thread/:id/transition` | Cambiar estado + sync Gmail label |
| `POST` | `/api/mail/thread/:id/mark-spam` | Marcar spam + bloquear dominio opcional |
| `POST` | `/api/mail/import-thread` | Importar correo desde Gmail por query/Message-ID |
| `POST` | `/api/mail/sync-gmail-labels` | Sincronizar labels Gmail para todos los threads |
| `GET` | `/api/search?q=` | Búsqueda global en threads, clientes y tareas |

### Cerebro agéntico (Sonnet)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/mail/thread/:id/analyze` | Análisis Sonnet. Body: `{ force: bool }` |
| `GET` | `/api/mail/thread/:id/analysis` | Análisis + acciones propuestas del DB |
| `GET` | `/api/agent/candidates` | Threads listos para analizar |
| `GET` | `/api/agent/pending-actions` | Acciones pendientes de aprobación |
| `POST` | `/api/agent/action/:id/prepare-ticket` | Preview editable del ticket con sprint |
| `POST` | `/api/agent/action/:id/create-ticket` | Crear en Jira + asignar al sprint |
| `POST` | `/api/agent/action/:id/reject` | Rechazar acción propuesta |

### Dashboard y métricas

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/health` | Estado conexiones (Gmail, Jira, Calendar) |
| `GET` | `/api/dashboard` | Datos completos + métricas |
| `GET` | `/api/dashboard/metrics` | Solo métricas de threads |
| `GET` | `/api/agent/sprint-summary` | Tickets del sprint activo (cache 5 min) |
| `GET` | `/api/agent/alerts` | Alertas combinadas (correos urgentes + Jira) |

---

## Estructura del proyecto

```
jarvis/
├── config/
│   ├── rules.yml              # Reglas: spam, keywords, no_action_patterns, state_machine
│   ├── clients.yml            # Clientes B2B con dominios y etiquetas Jira
│   ├── team.yml               # Equipo con account IDs de Jira y skills
│   └── providers.yml          # Proveedores conocidos con alert_keywords
├── src/
│   ├── index.js               # Arranque: DB + Gmail labels + crons
│   ├── skills/
│   │   ├── agent-brain.js     # Sonnet analiza hilos, propone acciones, tipo marcar_spam
│   │   ├── mail-ops.js        # Pipelines de clasificación + processUniversalScan
│   │   ├── metrics.js         # Fuente única de métricas del dashboard
│   │   └── state-machine.js   # Transiciones de estado de threads
│   ├── mcp/
│   │   ├── gmail.js           # OAuth2 + labels bidireccionales + searchGmailByQuery
│   │   └── jira.js            # REST API + sprints + getSprintIssues
│   ├── db/database.js         # SQLite — threads, proposed_actions, messages
│   └── api/routes.js          # Todos los endpoints REST
├── dashboard/src/
│   ├── App.jsx                # HashRouter con 7 rutas
│   ├── layouts/MainLayout.jsx # Topbar + Sidebar + JarvisContext
│   ├── contexts/JarvisContext.jsx
│   ├── components/
│   │   ├── MailModal.jsx      # Modal de correo — análisis, respuesta, spam, ticket
│   │   ├── GlobalSearch.jsx   # Búsqueda global Cmd+K con importación desde Gmail
│   │   ├── Topbar.jsx         # Sync status + Actualizar + Sync Gmail + notificaciones
│   │   ├── Sidebar.jsx        # Navegación lateral con badges
│   │   ├── SprintCard.jsx     # Tarjeta sprint activo
│   │   ├── AlertsCard.jsx     # Alertas combinadas
│   │   ├── TeamLoadCard.jsx   # Carga del equipo
│   │   ├── MetricCard.jsx     # Tarjeta métrica reutilizable
│   │   ├── EmailList.jsx      # Lista de correos con filtros pills
│   │   ├── TicketPreview.jsx  # Formulario editable para crear tickets Jira
│   │   ├── FeedbackModal.jsx  # Enseñar a Jarvis (2 fases)
│   │   └── RulesPanel.jsx     # Panel de reglas aprendidas
│   ├── pages/
│   │   ├── HomePage.jsx       # Cockpit — métricas + grid 2×2
│   │   ├── MailPage.jsx       # Lista de correos + modal
│   │   ├── TasksPage.jsx      # Acciones pendientes
│   │   ├── SprintPage.jsx     # Sprint activo
│   │   ├── ClientsPage.jsx    # Client Pulse
│   │   ├── RulesPage.jsx      # Panel de reglas
│   │   └── ConfigPage.jsx     # Configuración (placeholder)
│   └── hooks/
│       ├── useJarvisData.js   # Datos globales + refreshThreads() instantáneo
│       ├── useSprintData.js   # Sprint activo desde Jira
│       ├── useAlerts.js       # Alertas combinadas
│       └── useNotifications.js # Notificaciones en memoria
├── scripts/
│   ├── validate-dashboard.js  # 8 checks de consistencia de métricas
│   ├── audit-rules.js         # Detecta conflictos entre reglas
│   └── sync-gmail-labels.js   # Sincronización retroactiva de labels Gmail
└── jarvis-session-summary-v6.md  # Referencia técnica completa
```

---

## Safe mode

`config/rules.yml → mail.safe_mode: true` — activo por defecto. Bloquea acciones de escritura no aprobadas por el CEO. El agente solo puede leer, clasificar y proponer.

---

## Scripts de validación

```bash
node scripts/validate-dashboard.js  # 8 checks de consistencia de métricas
node scripts/audit-rules.js         # Detecta conflictos entre reglas aprendidas
node scripts/sync-gmail-labels.js   # Sincronizar labels Gmail retroactivamente
```

---

## Historial de versiones

| Versión | Descripción |
|---------|-------------|
| **v1.1.0** | Búsqueda global Cmd+K + importar desde Gmail + sync Gmail labels robusto |
| **v1.0.0** | Cockpit ejecutivo completo: sidebar, router, MailModal, HomePage con métricas |
| **v0.9.0** | Spam desde Jarvis, labels Gmail automáticos, UX mejorado |
| **v0.8.0** | Cerebro agéntico Sonnet + Jira bidireccional con sprints |
| **v0.7.0** | Métricas unificadas, reglas gobernables, fix facturas |
| **v0.6.1** | Semver, auditoría de reglas, limpieza |
| **v0.5.0** | Universal Inbox Scan — blacklist pipeline, Nuevos tab |

---

## Licencia

MIT
