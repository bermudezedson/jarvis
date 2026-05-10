# ⚡ Jarvis — CEO Cockpit

> Agente de productividad personal para CEOs de empresas SaaS/tech. Consolida Gmail, Google Calendar, Jira y Confluence en un dashboard tipo "cockpit" que te da el estado completo del día en segundos.

---

## ¿Qué es Jarvis?

Jarvis es un agente local que corre en tu máquina y actúa como tu chief of staff digital. Cada mañana a las 7:00 AM genera un briefing con todo lo que necesitas saber: correos que requieren decisión, tareas vencidas, próximas reuniones, compromisos pendientes y el estado de salud de tus clientes B2B — todo en una sola pantalla.

**No es un SaaS. No manda tus datos a ningún lado.** Corre 100% local, lee de tus herramientas vía MCP y presenta todo en un dashboard privado en `localhost`.

---

## Vista general del sistema

```
                    ┌─────────────────────────────────┐
                    │         Cron jobs (node-cron)    │
                    │   7:00 AM ──── 18:00 PM          │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │      daily-briefing.js           │
                    │   (orquesta todos los MCP)       │
                    └──┬──────┬──────┬────────────────┘
                       │      │      │
              ┌────────▼─┐ ┌──▼───┐ ┌▼────────┐
              │  Gmail   │ │ Cal  │ │  Jira   │
              │   MCP    │ │ MCP  │ │  MCP    │
              └────────┬─┘ └──┬───┘ └┬────────┘
                       │      │      │
                    ┌──▼──────▼──────▼────────┐
                    │   cache/data/*.json      │  ← fuente de verdad
                    └──────────────┬──────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │    Express API (puerto 3000)     │
                    └──────────────┬──────────────────┘
                                   │
                    ┌──────────────▼──────────────────┐
                    │   Dashboard React (puerto 5173)  │
                    │   auto-refresh cada 5 minutos    │
                    └─────────────────────────────────┘
```

**Principio clave: cache-first.** El dashboard nunca llama directamente a los MCP servers. Los cron jobs escriben al cache JSON, el dashboard solo lee ese cache. Si un MCP falla, el sistema sigue funcionando con la última data disponible.

---

## Stack técnico

| Capa | Tecnología |
|------|-----------|
| Backend / API | Node.js + Express |
| Frontend | React + Vite |
| Protocolo de integración | Model Context Protocol (MCP) |
| Cache | Archivos JSON locales |
| Scheduler | node-cron |
| Logs | Winston |
| Clasificación IA | Claude API (Anthropic) — opcional |

---

## Requisitos previos

- **Node.js** v18 o superior
- **npm** v9 o superior
- Acceso a los servicios que quieras conectar (Gmail, Calendar, Jira)
- Tokens de acceso OAuth para cada servicio (ver sección Configuración)
- *(Opcional)* API Key de Anthropic para clasificación inteligente de correos

---

## Instalación

```bash
# 1. Clonar el repositorio
git clone https://github.com/bermudezedson/jarvis.git
cd jarvis

# 2. Instalar dependencias (backend + dashboard)
bash scripts/setup.sh
```

El script `setup.sh` instala las dependencias de Node.js en la raíz y en el directorio `dashboard/`, y crea el archivo `.env` a partir del ejemplo.

---

## Configuración

### 1. Variables de entorno

Edita el archivo `.env` que se creó durante el setup:

```env
# MCP Server endpoints
GMAIL_MCP_URL=https://gmail.googleapis.com/mcp/v1
GMAIL_ACCESS_TOKEN=ya29.tu-token-google-oauth

CALENDAR_MCP_URL=https://calendar.googleapis.com/mcp/v1
CALENDAR_ACCESS_TOKEN=ya29.tu-token-google-oauth

JIRA_MCP_URL=https://mcp.atlassian.com/v1/mcp
JIRA_ACCESS_TOKEN=tu-token-atlassian
JIRA_CLOUD_ID=tu-cloud-id
JIRA_USER_EMAIL=tu@empresa.com

CONFLUENCE_MCP_URL=https://mcp.atlassian.com/v1/mcp
CONFLUENCE_ACCESS_TOKEN=tu-token-atlassian

# API
PORT=3000
NODE_ENV=development

# Claude API (opcional — activa clasificación inteligente de correos)
ANTHROPIC_API_KEY=sk-ant-...

# Timezone
TZ=America/Santiago
```

> **Nota:** Mientras no configures los tokens MCP, el sistema funciona igual con los datos de demostración incluidos (`mock-briefing.json`, `mock-client-pulse.json`, etc.). Puedes ver el dashboard completo sin conectar nada.

### 2. Reglas de negocio (`config/rules.yml`)

Aquí defines el comportamiento del agente:

```yaml
timezone: "America/Santiago"

briefing:
  morning_cron: "0 7 * * 1-5"   # Briefing matutino, lunes a viernes 7 AM
  evening_cron: "0 18 * * 1-5"  # Cierre de día, 6 PM

mail:
  safe_mode: true                # true = solo propuestas, nunca ejecuta sin confirmación
  priority_keywords:
    - "urgente"
    - "pago"
    - "factura"
    - "reclamo"
  max_executive_inbox_items: 7

jira:
  default_project: "CR"
  stale_days: 5                  # Días sin actividad = alerta

clients:
  stale_contact_days: 14         # Días sin contacto = alerta en radar
```

### 3. Clientes B2B (`config/clients.yml`)

Agrega aquí tus clientes para que Jarvis los reconozca en correos, tickets y reuniones:

```yaml
clients:
  - name: "Nombre del Cliente"
    domains: ["cliente.cl"]
    contacts: ["contacto@cliente.cl"]
    jira_label: "client-nombrecliente"
    tier: "premium"   # premium | standard | trial
```

---

## Uso

### Arrancar el sistema completo

```bash
bash scripts/start.sh
```

Esto levanta:
- **API** en `http://localhost:3000`
- **Dashboard** en `http://localhost:5173`

### Arrancar por separado

```bash
# Solo el backend
node src/index.js

# Solo el dashboard
cd dashboard && npm run dev
```

---

## Dashboard

El dashboard se divide en cinco zonas:

### Zona 1 — Métricas del día
Cuatro tarjetas con semáforo de colores (verde / amarillo / rojo):
- **Correos sin leer** — cuántos requieren decisión del CEO
- **Tareas Jira hoy** — activas y vencidas
- **Reuniones** — total del día y próxima con hora
- **Compromisos abiertos** — detectados en correos enviados

### Zona 2 — Bandeja Ejecutiva
Los items más importantes del día, ordenados por severidad. Cada item muestra:
- Badge de tipo (Cliente / Seguimiento / Jira / Interno)
- Resumen en una línea
- Antigüedad en días
- Acción sugerida
- Botón para abrir el correo o el ticket en Jira

### Zona 3 — Radar de Riesgos
Alertas activas ordenadas: rojo → amarillo → azul informativo.
- Tareas vencidas en Jira
- Correos de clientes sin respuesta +48h
- Clientes en estado crítico o en riesgo (desde el health score)

### Zona 4 — Compromisos Abiertos
Lista de compromisos detectados automáticamente en correos enviados (frases como *"te lo envío"*, *"me encargo"*, *"quedamos en"*). Cada uno muestra:
- A quién fue el compromiso
- La frase detectada y su contexto
- Deadline estimado (extraído del correo o por defecto +3 días)
- Botón para marcarlo como resuelto

### Zona 5 — Client Health Score
Puntuación de salud por cliente B2B calculada en base a:
- Días desde el último email
- Días desde la última reunión
- Tickets Jira abiertos
- Tiempo de respuesta

Haz click en cualquier cliente para ver el desglose completo.

### Controles del header
- **Toggle AM / AHORA / PM** — alterna entre el briefing matutino, el vespertino, o el más reciente
- **Botón Actualizar** — fuerza una regeneración del briefing consultando los MCP en ese momento
- **Timestamp** — muestra hace cuántos minutos se actualizaron los datos

---

## API Reference

### Briefing

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/briefing/current` | Briefing actual (AM o PM según la hora) |
| `GET` | `/api/briefing/morning` | Briefing matutino cacheado |
| `GET` | `/api/briefing/evening` | Cierre de día cacheado |
| `POST` | `/api/briefing/refresh` | Regenera el briefing consultando los MCP ahora |
| `GET` | `/api/health` | Estado de las conexiones MCP |

### Correos (Fase 2)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/mail/classify` | Clasifica correos recientes con reglas + IA opcional |
| `POST` | `/api/mail/apply-labels` | Aplica etiquetas Gmail (requiere `safe_mode: false`) |

### Compromisos (Fase 2)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/commitments` | Lista compromisos abiertos y vencidos |
| `POST` | `/api/commitments/scan` | Escanea correos enviados buscando compromisos |
| `POST` | `/api/commitments/:id/resolve` | Marca un compromiso como resuelto |

### Clientes (Fase 2)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/clients/pulse` | Health score de todos los clientes |
| `POST` | `/api/clients/pulse/refresh` | Recalcula el health score consultando MCP |

### Task Bridge (Fase 2)

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `POST` | `/api/task-bridge/email-to-jira` | Propone issue Jira desde un correo |
| `POST` | `/api/task-bridge/jira-to-calendar` | Propone evento Calendar desde deadline Jira |
| `POST` | `/api/task-bridge/sync-jira` | Cachea tareas Jira actuales |

### Configuración

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| `GET` | `/api/config/clients` | Lista de clientes desde `clients.yml` |

---

## Safe Mode

Todas las acciones de escritura (crear tickets, enviar correos, aplicar etiquetas, crear eventos) están bloqueadas por defecto con `safe_mode: true` en `rules.yml`.

En modo seguro, los endpoints del task bridge y mail-ops devuelven una **propuesta** en lugar de ejecutar la acción:

```json
{
  "mode": "proposal",
  "message": "Safe mode activo — confirmar para crear en Jira",
  "issue": { "summary": "...", "project": "CR", ... }
}
```

Para habilitar acciones reales, cambia a `safe_mode: false` en `config/rules.yml`. Se recomienda mantenerlo activo siempre.

---

## Fases del proyecto

### ✅ Fase 1 — Base (completa)
- Estructura del proyecto
- Sistema de cache JSON
- Daily Briefing: Gmail + Calendar + Jira via MCP
- Cron jobs matutino (7:00 AM) y vespertino (18:00)
- Dashboard React con zonas de métricas, bandeja ejecutiva y radar de riesgos
- Auto-refresh cada 5 minutos
- Datos de demostración listos para usar sin configurar nada

### ✅ Fase 2 — Skills de productividad (completa)
- **mail-ops:** clasificación de correos con reglas + Claude Haiku opcional
- **commitment-tracker:** detección automática de compromisos en correos enviados
- **client-pulse:** health score por cliente B2B
- **task-bridge:** puente email ↔ Jira ↔ Calendar (propuestas en safe mode)
- Dashboard ampliado con zonas de compromisos y client health score

### 🔜 Fase 3 — Doc Engine (planificada)
- Generación de documentos Confluence desde decisiones y reuniones
- Decision log automático
- Integración con Notion

---

## Estructura del proyecto

```
jarvis/
├── config/
│   ├── rules.yml          # Reglas de negocio (editar aquí primero)
│   ├── clients.yml        # Lista de clientes B2B
│   └── mcp-servers.json   # URLs de los MCP servers
├── src/
│   ├── index.js           # Entry point — Express + cron
│   ├── skills/            # Lógica de negocio del agente
│   │   ├── daily-briefing.js
│   │   ├── mail-ops.js
│   │   ├── commitment-tracker.js
│   │   ├── client-pulse.js
│   │   └── task-bridge.js
│   ├── mcp/               # Clientes MCP (abstracción de cada servicio)
│   │   ├── gmail.js
│   │   ├── calendar.js
│   │   ├── jira.js
│   │   └── confluence.js
│   ├── api/               # Endpoints REST
│   ├── cache/             # Store JSON + datos mock
│   ├── cron/              # Jobs programados
│   └── utils/             # Logger, date helpers, AI classifier
├── dashboard/             # App React/Vite
│   └── src/
│       ├── components/    # StatusBar, ExecutiveInbox, RiskRadar, etc.
│       ├── hooks/         # useJarvisData (fetch + auto-refresh)
│       └── styles/
├── scripts/
│   ├── setup.sh           # Instalación inicial
│   └── start.sh           # Arranque de API + dashboard
└── .env.example           # Plantilla de variables de entorno
```

---

## Logs

Todos los eventos del agente se loguean en consola con formato estructurado:

```
07:00:12 info [daily-briefing]: Generating briefing {"type":"morning"}
07:00:13 info [mcp:gmail]: Fetching unread threads {"hours":12}
07:00:14 warn [daily-briefing]: Calendar fetch failed {"error":"..."}
07:00:14 info [daily-briefing]: Briefing saved to cache {"type":"morning","sources":{...}}
```

---

## Contribuir

Este es un proyecto personal. Si lo forkeas y lo adaptas para tu negocio, los puntos de entrada más importantes son:

- `config/rules.yml` — ajusta las reglas sin tocar código
- `config/clients.yml` — agrega tus clientes B2B
- `src/skills/` — aquí vive toda la lógica del agente
- `src/mcp/` — si cambia el protocolo o el proveedor, solo tocas estos archivos

---

## Licencia

MIT — úsalo, adáptalo, mejóralo.
