# ⚡ Jarvis — CEO Cockpit v0.8.0

> Agente de productividad personal para CEOs de empresas B2B. Consolida Gmail, Jira y Google Calendar en un dashboard tipo "cockpit" con **cerebro agéntico**: Sonnet analiza tus correos, propone acciones y crea tickets en Jira con un click.

---

## ¿Qué hace Jarvis?

Jarvis es un agente local que corre en tu máquina. Lee tu correo, identifica qué requiere tu atención, y cuando un correo merece un ticket Jira, te muestra un formulario pre-llenado para que lo revises y apruebes — con sprint activo, tiempo estimado y asignado sugerido.

**No es un SaaS. No manda tus datos a ningún lado.** Corre 100% en `localhost`.

---

## Arquitectura

```
Gmail API ──→ universalInboxScan() ──→ SQLite (threads)
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
           Express API (port 3000)  ──→  Dashboard React (port 5173)
```

**Principio clave: el CEO siempre decide.** Sonnet propone, el CEO edita y aprueba. Nada se crea automáticamente.

---

## Stack

| Capa | Tecnología |
|------|-----------|
| Backend | Node.js + Express (puerto 3000) |
| Frontend | React + Vite (puerto 5173) |
| Base de datos | SQLite vía `better-sqlite3` |
| Gmail | OAuth2 directo (REST API) |
| Jira | REST API directa con Basic auth — `api.atlassian.com` |
| IA clasificación | Claude Haiku 4.5 — clasificación rápida, resúmenes 1 línea |
| IA agéntica | Claude Sonnet (`claude-sonnet-4-6`) — análisis profundo, acciones |
| Config | YAML (`js-yaml`) en `config/` |

---

## Requisitos

- Node.js v18 o superior
- Cuenta Gmail con OAuth configurado
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
# Gmail OAuth2
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
```

---

## Flujo principal: correo → ticket Jira

1. **Dashboard → tab Urgentes/Pendientes** — hilos de clientes que requieren atención
2. **Expandir un thread** — ver mensajes completos + resumen automático
3. **Click "🤖 Analizar"** — Sonnet lee el hilo completo y propone acciones
4. **Formulario de acción** — para acciones de tipo "crear ticket" o "delegar":
   - Click **"📋 Preparar ticket"**
   - Formulario pre-llenado: título descriptivo, proyecto, sprint activo, prioridad, asignado, tiempo estimado, etiquetas, descripción estructurada
   - El CEO puede editar cualquier campo
5. **Click "✅ Crear ticket"** → el ticket se crea en Jira y se asigna al sprint activo
6. El thread pasa automáticamente a estado `en_jira`

---

## Dashboard — tabs y funciones

| Tab | Qué muestra |
|-----|-------------|
| **Urgentes** | Threads con severity high que requieren acción del CEO |
| **Pendientes** | Threads en acción pendiente, menor severidad |
| **Esperando** | Threads donde el equipo respondió, esperando al cliente |
| **Informativos** | FYI: notificaciones, facturas enviadas, alertas automáticas |
| **Nuevos** | Dominios desconocidos clasificados por Haiku |
| **Solucionados** | Resueltos |
| **Archivados** | Archivados |

### Acciones por thread (en el acordeón expandido)

- **🤖 Analizar** — análisis Sonnet: resumen, urgencia, tipo, acciones propuestas con asignado y tiempo estimado
- **📋 Preparar ticket** — formulario editable para crear en Jira
- **✦ Jarvis** — borrador de respuesta al cliente (Haiku)
- **Enviar** — envía la respuesta por Gmail
- **Mover a ▾** — cambiar estado manualmente (state machine)
- **✎ Corregir** — feedback al clasificador para aprender
- **🔇** — silenciar dominio para siempre
- **?** — trazabilidad: por qué fue clasificado así

---

## API Reference

### Correo y threads

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/mail/universal-scan` | Escanea inbox + sent, clasifica todo |
| `GET` | `/api/mail/client-threads` | Lista threads activos |
| `GET` | `/api/mail/uncategorized` | Threads sin clasificar (source_type=unknown) |
| `GET` | `/api/mail/thread/:id/messages` | Mensajes completos del thread |
| `POST` | `/api/mail/thread/:id/reply` | Enviar respuesta por Gmail |
| `POST` | `/api/mail/thread/:id/transition` | Cambiar estado |
| `GET` | `/api/mail/thread/:id/why` | Trazabilidad de clasificación |
| `POST` | `/api/mail/thread/:id/feedback` | Corrección → regla aprendida |
| `POST` | `/api/mail/silence-domain` | Blacklist de dominio |

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

### Métricas y salud

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/health` | Estado conexiones (Gmail, Jira, Calendar) |
| `GET` | `/api/dashboard` | Datos completos + métricas |
| `GET` | `/api/dashboard/metrics` | Solo métricas de threads |

---

## Estructura del proyecto

```
jarvis/
├── config/
│   ├── rules.yml          # Reglas de negocio y clasificación
│   ├── clients.yml        # Clientes B2B con dominios y etiquetas Jira
│   ├── team.yml           # Equipo con account IDs de Jira
│   └── providers.yml      # Proveedores conocidos con alertas
├── src/
│   ├── index.js
│   ├── skills/
│   │   ├── agent-brain.js      # ← NUEVO: Sonnet analiza hilos, propone acciones
│   │   ├── mail-ops.js         # Pipelines de clasificación de correo
│   │   ├── metrics.js          # Fuente única de métricas del dashboard
│   │   ├── state-machine.js    # Transiciones de estado de threads
│   │   ├── daily-briefing.js
│   │   └── rule-auditor.js
│   ├── mcp/
│   │   ├── gmail.js            # OAuth2 directo + universalInboxScan
│   │   └── jira.js             # ← REESCRITO: REST API + sprints
│   ├── db/
│   │   └── database.js         # SQLite — threads, proposed_actions, messages
│   ├── api/
│   │   └── routes.js
│   └── utils/
├── dashboard/src/
│   └── components/
│       ├── ClientActionList.jsx  # Tabs, ThreadRow, AnalysisPanel
│       ├── TicketPreview.jsx     # ← NUEVO: formulario editable para Jira
│       └── ...
├── scripts/
│   ├── validate-dashboard.js  # Verifica consistencia de métricas
│   ├── audit-rules.js         # Detecta conflictos entre reglas
│   └── start.sh
└── jarvis-session-summary-v5.md  # Referencia técnica completa
```

---

## Safe mode

`config/rules.yml → mail.safe_mode: true` — activo por defecto. Bloquea cualquier acción de escritura no explícitamente aprobada por el CEO. El agente solo puede leer, clasificar y proponer.

---

## Scripts de validación

```bash
node scripts/validate-dashboard.js  # 7 checks de consistencia de métricas
node scripts/audit-rules.js         # Detecta conflictos entre reglas aprendidas
```

---

## Licencia

MIT
