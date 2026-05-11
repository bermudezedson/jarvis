# Jarvis CEO Cockpit — Session Summary v3
Última actualización: 2026-05-11

## Stack
- **Backend:** Node.js + Express en puerto 3000
- **Frontend:** React + Vite en puerto 5173
- **DB:** SQLite (`data/jarvis.db`) vía `better-sqlite3`
- **Gmail:** OAuth2 directo (no MCP)
- **IA:** Claude Haiku 4.5 (`claude-haiku-4-5-20251001`)
- **Config:** YAML (`js-yaml`) en `config/`

## Arquitectura clave

```
Gmail API → universalInboxScan() → processUniversalScan() → SQLite threads
                                                               ↕
                                               /api/dashboard  →  React frontend
                                               thread_metrics ← getDashboardMetrics()
```

### Fuente única de métricas
`src/skills/metrics.js` → `getDashboardMetrics()` → `/api/dashboard` (campo `thread_metrics`).
**Nadie más calcula conteos.** StatusBar, ClientActionList, RiskRadar, ClientThreads leen del prop `threadMetrics`.

### Criterio de urgente
```
estado IN ('requiere_mi_accion', 'esperando_nosotros', 'pendiente')
AND severity IN ('high', 'critical')
AND last_sender_is_me = 0
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
5. **Invoice override:** `no_action_pattern` + subject es factura + `lastSenderIsUs` + cliente conocido → `esperando_cliente` (NO informativo)
6. `no_action_pattern` → `informativo`
7. Internal domain → `informativo`
8. Provider con alert keyword → `requiere_mi_accion`
9. Provider sin alert keyword → `informativo`
10. Client + lastSenderIsUs → `esperando_cliente`
11. Client + !lastSenderIsUs → `esperando_nosotros`
12. Unknown → AI classify → route

## Estados válidos en DB

| Estado | Significado | Tab en dashboard |
|--------|-------------|-----------------|
| `esperando_nosotros` | Cliente respondió, debemos actuar | Urgentes / Pendientes |
| `requiere_mi_accion` | Requiere acción explícita del CEO | Urgentes |
| `pendiente` | Manual CEO, pendiente de resolución | Pendientes |
| `esperando_cliente` | Nosotros respondimos / enviamos, esperando al cliente | Esperando |
| `informativo` | FYI, no requiere acción | Informativos |
| `en_jira` | Escalado a Jira | (no aparece en tabs activos) |
| `solucionado` | Resuelto | Solucionados |
| `archivado` | Archivado | Archivados |

## Reglas importantes

### no_action_patterns → informativo (pero con exception de facturas)
Facturas enviadas POR EL EQUIPO a clientes (`isInvoiceSubject()` + `lastSenderIsUs`) → `esperando_cliente`, no informativo.

### Auto-archivo (runAutoRules)
- Informativos → archivado tras 7 días (sin actividad)
- **Safety net:** NUNCA auto-archivar facturas team-sent antes de 15 días
- Facturas sin respuesta → pendiente tras 15 días
- esperando_cliente → severity high tras 14 días

## Scripts útiles

```bash
node scripts/validate-dashboard.js    # Verifica consistencia de métricas (6 checks)
node scripts/audit-rules.js           # Detecta conflictos entre reglas (5 tipos)
node scripts/reclassify-invoices.js   # Reclasifica facturas team-sent mal clasificadas
```

## Endpoints importantes

| Endpoint | Qué hace |
|----------|---------|
| `GET /api/dashboard` | Datos completos + thread_metrics |
| `GET /api/dashboard/metrics` | Solo métricas de threads |
| `GET /api/mail/client-threads` | Lista de threads activos |
| `GET /api/mail/rules-full` | Todas las reglas del sistema |
| `GET /api/mail/audit-rules` | Auditoría de conflictos entre reglas |
| `POST /api/mail/universal-scan` | Forzar scan universal |
| `DELETE /api/mail/learned-rules/:id` | Eliminar regla aprendida |
| `GET /api/mail/thread/:id/why` | Trazabilidad: por qué está clasificado así |
| `POST /api/mail/learned-rules/deduplicate` | Deduplicar reglas |

## Estado actual del auditor (audit-rules.js)

- ✅ 0 conflictos activos (Tipo A resuelto en Prompt 15)
- ⚠️ 1 warning real pendiente de tu decisión (ver abajo)
- ✅ 0 redundancias

## Hallazgos pendientes de decisión (audit-rules.js)

1. ✅ **"Advertencia del uso del disco"** eliminado de no_action_patterns (Prompt 16). Los 2 threads de May Energía y Top Rental reclasificados a `requiere_mi_accion`.
2. **Regla learned ID 9:** "Diferencia en cantidades solicitadas por API" → archivado. Alerta ERP de ClickRepuestos. Verificar si requiere atención.
3. ✅ **Regla learned ID 11** "Factura de servicios" eliminada (Prompt 16, redundante con config).
4. **Warning activo:** 2 threads de Repuestos del Sol — "Factura N°382 para SantaElba" y "Factura N°380 para Repuestos del Sol Perú" — en estado `informativo`, fecha NULL. Son facturas a terceros donde el admin de Repuestos del Sol fue incluido. Decidir si son informativo o requieren acción.

## Prompts completados

| # | Descripción | Estado |
|---|-------------|--------|
| 1-8 | Desarrollo inicial | ✅ |
| 12 | Universal scan, blacklist pipeline, Nuevos tab | ✅ |
| 13 | Auditoría y estabilización: metrics.js, classification_reason, pipelines consolidados | ✅ |
| 14 | Fix métricas (whitelist estados), reglas gobernables, RulesPanel reescrito, deduplicación | ✅ |
| 15 | Fix conflicto facturas/auto-archivo, audit-rules.js, reclasificación retroactiva 12 facturas | ✅ |
| 16 | Limpieza post-auditoría: patrones, reglas redundantes, auditor mejorado | ✅ |
