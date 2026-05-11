# Jarvis Mail System — Audit Report
Fecha: 2026-05-10

---

## 1. Flujo de correos: cómo funciona realmente

### Pipeline A: Clasificación inbox genérica (`classify`)

| Campo | Detalle |
|-------|---------|
| Trigger | `POST /api/mail/classify` — solo manual, nadie lo llama automáticamente |
| Entrada | `gmail.getUnreadThreads(hours)` — solo NO LEÍDOS del inbox |
| Proceso | `classifyThread()` reglas hardcodeadas → opcionalmente `enhanceWithAI()` |
| Salida | Escribe `src/cache/data/mail-classifications.json` (NO SQLite) |
| Estado | **HUÉRFANO** — ni el cron, ni el botón ↻, ni `useJarvisData.js` lo llaman |

Pipeline A escribe en un JSON plano con un schema distinto al de SQLite (tiene campos `aprobado`, `accion_sugerida`, no tiene `source_type`). El dashboard principal **no lee este JSON** — lee SQLite.

---

### Pipeline B: Scan de clientes (`classifyClientThreads`)

| Campo | Detalle |
|-------|---------|
| Trigger | `POST /api/mail/client-scan`, + `POST /mail/client-archive` y `/client-resolve` (modo refresh_states), + `useJarvisData.js` cada 5 min (modo refresh_states) |
| Entrada | `gmail.getClientThreads(allDomains, days)` — solo dominios en `clients.yml` |
| Proceso | Match cliente → calcular estado/severity → upsert SQLite |
| Salida | Tabla `threads` en SQLite + `client-threads.json` (cache de JSON) |
| Modos | `initial` (30 días), `incremental` (desde último scan), `refresh_states` (solo recalcula, 0 llamadas Gmail) |

---

### Pipeline C: Universal scan (`runUniversalScan` / `processUniversalScan`)

| Campo | Detalle |
|-------|---------|
| Trigger | `POST /api/mail/universal-scan` + botón ↻ en `useJarvisData.js:50` + cron `"0 * * * *"` (cada hora) |
| Entrada | `gmail.universalInboxScan()` — TODO inbox + sent, ventana auto-calculada (mín 8h) |
| Proceso | Filtro blacklist → identificación origen (client/provider/internal/unknown) → IA para unknowns → upsert SQLite |
| Salida | Tabla `threads` en SQLite (también escribe `source_type`, `ai_classification`, `is_new_contact`) |

**El universal scan es el pipeline principal del sistema.** El Pipeline B `refresh_states` corre cada 5 min y recalcula severity/estado de todos los threads activos sin llamar a Gmail.

---

## 2. Problemas encontrados

### Problema 1: `processUniversalScan` tiene el argumento de `calculateEstado` invertido

**Archivos:** `src/skills/mail-ops.js:980`

```javascript
// Pipeline C (INCORRECTO):
estado = calculateEstado(!lastSenderIsUs, daysSince);

// Pipeline B (CORRECTO):
if (lastSenderIsUs) {
  estado = calculateEstado(true, daysSince);  // → 'esperando_cliente' ✓
} else {
  estado = calculateEstado(false, daysSince); // → 'esperando_nosotros' ✓
}
```

`calculateEstado(lastSenderIsMe)` retorna `'esperando_cliente'` si `true`, `'esperando_nosotros'` si `false`. El universal scan pasa `!lastSenderIsUs` en lugar de `lastSenderIsUs`, lo que **invierte el estado** de todos los threads de clientes que procesa.

**Impacto:** Threads donde el CEO respondió último quedan con estado `'esperando_nosotros'` en vez de `'esperando_cliente'`. La UX visual no se rompe porque el frontend usa `last_sender_is_me` para filtrar (no el campo `estado`), pero el campo `estado` en SQLite está incorrecto.

**Nota mitigante:** El cron de `refresh_states` cada 5 min llama a `refreshStatesFromCache()` que recalcula el estado desde `last_sender_is_me` y **corrige accidentalmente este bug**. Por eso no produce síntomas graves visibles.

---

### Problema 2: `StatusBar.high_severity` ≠ count del tab "Urgentes"

**Archivos:** `dashboard/src/components/StatusBar.jsx:21`, `ClientActionList.jsx:928-929`, `src/db/database.js:348`

**StatusBar** muestra `clientThreads.high_severity` calculado en el backend como:
```javascript
// database.js:348 — incluye TODOS los high severity activos
actionable.filter(t => t.severity === 'high').length
```

**Tab "Urgentes"** calcula en el frontend:
```javascript
// ClientActionList.jsx:928 — solo high severity donde el cliente escribió último
actionable.filter(t => t.severity === 'high' && !t.last_sender_is_me)
```

**RiskRadar** calcula:
```javascript
// RiskRadar.jsx:8 — igual que el tab pero también excluye archivados (redundante)
clientThreads.items.filter(t => t.severity === 'high' && !t.last_sender_is_me && t.estado !== 'archivado')
```

**La discrepancia concreta:** Si hay 2 threads high-severity donde el CEO respondió último (esperando al cliente), `high_severity` cuenta 2, pero el tab "Urgentes" muestra 0. StatusBar dice "2 urgentes" pero al hacer click no aparece ninguno.

---

### Problema 3: `refreshStatesFromCache` sobrescribe transiciones manuales del CEO

**Archivo:** `src/skills/mail-ops.js:434-464`

Cada 5 minutos (`useJarvisData.js:36-41`), el sistema llama `refresh_states` que recalcula el estado de TODOS los threads activos usando solo `last_sender_is_me`. Esto sobrescribe cualquier transición manual a `'pendiente'` o `'requiere_mi_accion'` porque esos estados no cambian `last_sender_is_me`.

Ejemplo: CEO mueve un thread de "Urgentes" a "Pendientes" (`'pendiente'`). En 5 minutos, refresh_states lo revierte a `'esperando_nosotros'` (misma tab visualmente, pero estado DB cambiado).

Las únicas transiciones que **sobreviven** al refresh son: `'solucionado'`, `'archivado'`, `'en_jira'`, `'informativo'`, y `'esperando_cliente'` (porque este último sí cambia `last_sender_is_me=1`).

---

### Problema 4: `estado 'esperando_nosotros'` no es un estado válido en `state-machine.js`

**Archivos:** `src/skills/state-machine.js:8`, `src/skills/mail-ops.js:385`

```javascript
// state-machine.js — estados válidos:
const VALID_ESTADOS = [
  'requiere_mi_accion', 'pendiente', 'esperando_cliente',
  'en_jira', 'informativo', 'solucionado', 'archivado',
];

// mail-ops.js calculateEstado() — puede retornar:
'esperando_nosotros'  // ← NO está en VALID_ESTADOS
```

Los pipelines B y C escriben `'esperando_nosotros'` en la DB para threads donde el cliente escribió último. Si alguien intenta transicionar a `'esperando_nosotros'` vía API, falla con "Estado inválido". El frontend evita esto (no ofrece esa opción en el dropdown), pero el estado queda inconsistente con el schema declarado.

---

### Problema 5: `Pipeline A` (`classify()`) está desconectado del dashboard principal

**Archivos:** `src/skills/mail-ops.js:42-83`, `src/api/routes.js:127-131`

`classify()` escribe en `mail-classifications.json`. El dashboard (`/api/dashboard`) lee de SQLite vía `db.getClientThreadsSummary()`. El endpoint `GET /api/mail/inbox` lee el JSON, pero ningún componente del dashboard actual consume ese endpoint.

Los endpoints `POST /mail/approve`, `POST /mail/reclassify`, `POST /mail/set-status`, `POST /mail/approve-all`, `POST /mail/apply-labels` todos operan sobre `mail-classifications.json`, pero el dashboard no muestra esos datos.

**Impacto:** El `MailClassifier.jsx` (tab Bandeja General) consume el JSON y funciona, pero es una vista secundaria. La vista principal (`ClientActionList`) usa SQLite.

---

### Problema 6: `POST /mail/investigate/add` solo funciona para threads de clientes

**Archivo:** `src/api/routes.js:1063-1084`

El botón "Agregar al dashboard" llama a `classifyClientThreads({ mode: 'incremental' })` que **solo procesa dominios de `clients.yml`**. Si el thread es de un proveedor (AWS, GoDaddy, etc.) o de un dominio desconocido, el thread nunca se agrega al dashboard porque `classifyClientThreads` lo omite (no encuentra match de cliente).

---

### Problema 7: Optimistic update de "Mover a Pendientes" no cambia la severidad

**Archivo:** `dashboard/src/components/ClientActionList.jsx:826-846`

```javascript
// handleTransition — para 'pendiente':
if (newEstado === 'pendiente') { updates.last_sender_is_me = 0; }
// Falta: updates.severity = 'low';
```

El servidor (`state-machine.js:46-47`) sí baja la severidad a `'low'` al transicionar a `'pendiente'`. Pero el optimistic update del frontend no lo hace. El thread sigue apareciendo en el tab "Urgentes" localmente hasta la próxima recarga (5 min).

---

### Problema 8: `calculateEstado()` tiene un parámetro `daysSince` que no usa

**Archivo:** `src/skills/mail-ops.js:384`

```javascript
function calculateEstado(lastSenderIsMe, daysSince) {
  return lastSenderIsMe ? 'esperando_cliente' : 'esperando_nosotros';
  // daysSince no se usa — dead parameter
}
```

`daysSince` es aceptado pero ignorado. Fue probablemente intención futura para escalar a `'requiere_mi_accion'` cuando pasan muchos días, pero nunca se implementó.

---

### Problema 9: `RulesPanel` muestra solo reglas aprendidas, no las reglas de config

**Archivo:** `dashboard/src/components/RulesPanel.jsx`

El panel llama a `GET /api/mail/learned-rules` que retorna:
- `learned_rules` (SQLite) ✓
- `no_action_patterns` (rules.yml) ✓  
- `auto_rules` (state_machine config) ✓

Pero **no muestra**:
- `spam_domains` (15 dominios) 
- `exclude_patterns` (9 patrones ERP)
- `blacklist.discard_domains` y `blacklist.discard_subjects` (dinámicos)
- Proveedores configurados en `providers.yml`
- `priority_keywords` y `client_request_keywords`

---

### Problema 10: No existe campo `classification_reason` en threads

**Archivo:** `src/db/database.js` (schema)

No hay forma de saber por qué un thread fue clasificado de cierta manera. No existe ningún campo ni tabla que registre la cadena de decisión (qué reglas se evaluaron, cuál matcheó, qué pipeline lo procesó).

---

### Problema 11: AWS — `sns.amazonaws.com` SÍ debería matchear providers.yml

**Archivo:** `config/providers.yml:4`, `src/skills/mail-ops.js:794-799`

`matchProvider()` usa `.endsWith('.' + pd)`, por lo tanto `sns.amazonaws.com`.endsWith('.amazonaws.com') = true. El dominio SÍ matchea AWS.

El problema real con correos de AWS no visibles es más probablemente:
1. El email tiene más de 48h y el primer scan nunca lo capturó
2. El email está en un label de Gmail pero no en INBOX, y las búsquedas incluyen `in:inbox newer_than:Xh`
3. El thread está marcado como archivado/solucionado en SQLite y se saltea en `processUniversalScan`

`investigate` SÍ busca en Gmail directamente (línea 972 de routes.js). Si no encuentra el thread, puede ser que la query de búsqueda no matchee o que tenga más de 30 días (`newer_than:30d` hardcodeado).

---

## 3. Métricas — Fuentes de verdad actuales

| Métrica | Componente | Fuente/Cálculo | ¿Consistente? |
|---------|-----------|----------------|---------------|
| Correos de clientes | StatusBar | `clientThreads.requiring_my_action` (backend) = non-informativo + !last_sender_is_me | — |
| Urgentes (sub-label) | StatusBar | `clientThreads.high_severity` = ALL active high severity (incluye waiting) | ❌ vs tab |
| Urgentes (tab badge) | ClientActionList | `severity==='high' && !last_sender_is_me` (filtrado en frontend) | ❌ vs StatusBar |
| Riesgos | RiskRadar | `severity==='high' && !last_sender_is_me && estado!=='archivado'` (frontend) | ≈ tab (redundante) |
| Por estado | header badges | `clientThreads.requiring_my_action`, `.waiting_client_response`, `.high_severity` (backend) | ❌ high_severity inconsistente |

**La causa raíz:** `high_severity` en el backend cuenta threads high con `last_sender_is_me=1` (esperando cliente), pero la tab Urgentes excluye esos. Son números distintos por diseño distinto, no por bug de cálculo.

---

## 4. Reglas — Inventario completo

| Regla | Fuente | ¿Se aplica? | ¿Dónde? | ¿Visible en UI? |
|-------|--------|-------------|---------|-----------------|
| `spam_domains` (15 dominios) | rules.yml | ✓ | `processUniversalScan` paso 1 | ❌ |
| `exclude_patterns` (9 patrones ERP) | rules.yml | ✓ | `shouldExclude()` (Pipeline A) + Pipeline C | ❌ |
| `no_action_patterns` (11 patrones) | rules.yml | ✓ | Pipelines B y C | ✓ (RulesPanel) |
| `priority_keywords` (11 keywords) | rules.yml | ✓ | Pipeline A `classifyThread()` | ❌ |
| `client_request_keywords` (13) | rules.yml | ✓ | Pipeline A solo | ❌ |
| `blacklist.discard_domains` | rules.yml | ✓ | `mergeBlacklist()` en Pipeline C | ❌ |
| `blacklist.discard_subjects` | rules.yml | ✓ | `mergeBlacklist()` en Pipeline C | ❌ |
| `learned_rules` | SQLite | ✓ | Pipelines B y C | ✓ (RulesPanel) |
| `providers.yml` (13 proveedores) | providers.yml | ✓ | Pipeline C `matchProvider()` | ❌ |
| `state_machine` rules | rules.yml | ✓ | `runAutoRules()` | ✓ parcial (RulesPanel) |
| `BRAND_DOMAINS` phishing map | mail-ops.js:219 | ✓ | Pipeline A solo | ❌ |

---

## 5. Código muerto o no conectado

| Función/Endpoint | Estado | Detalles |
|-----------------|--------|----------|
| `classify()` — Pipeline A | Huérfano | Solo accesible via `POST /mail/classify` manual. No corre en ningún flujo automático ni refresh. El `MailClassifier.jsx` sí lo llama pero es el tab secundario "Bandeja General". |
| `GET /mail/inbox` | Huérfano | Lee `mail-classifications.json`. Ningún componente del dashboard principal lo consume. |
| `POST /mail/approve` | Semi-activo | Solo opera sobre `mail-classifications.json` (no SQLite). MailClassifier.jsx lo usa. |
| `POST /mail/approve-all` | Semi-activo | Igual |
| `POST /mail/reclassify` | Semi-activo | Igual |
| `POST /mail/set-status` | Huérfano | Opera sobre JSON cache. Ningún componente llama a este endpoint actualmente. |
| `POST /mail/apply-labels` | Manual | MailClassifier.jsx expone un botón. Es un flujo separado. |
| `calculateEstado(daysSince)` | Dead param | El segundo parámetro nunca se usa dentro de la función. |
| `BRAND_DOMAINS` / `isPhishing()` | Solo Pipeline A | No corre en Pipelines B ni C. Los pipelines principales no detectan phishing. |
| `isSubscription()`, `isInvoice()`, `isShipping()`, etc. | Solo Pipeline A | Toda la lógica de categorías (FACTURA, ENVIO, SUSCRIPCION, etc.) solo aplica en el Pipeline A huérfano. |
| `enhanceWithAI()` | Solo Pipeline A | El Pipeline C usa `aiClassifyUnknown()` distinto. |
| `needsAction()`, `needsActionFromCategory()` | Solo Pipeline A | |
| `applyLabels()` | Manual | Solo via `POST /mail/apply-labels`. |
| `countByCategory()`, `countByEstado()` | Solo Pipeline A | |
| `sortAndBuild()` | Muerto en práctica | Solo lo llama la rama `initial`/`incremental` de `classifyClientThreads`, que ya fue reemplazada por universal scan en el flujo normal. |

---

## 6. Inconsistencias menores adicionales

### 6.1 Estados del sistema — nomenclatura mixta

Los pipelines usan `'esperando_nosotros'` para "el cliente respondió, yo tengo que actuar". El `state-machine.js` usa `'requiere_mi_accion'` para el mismo concepto. Son sinónimos en práctica pero nombres distintos en la DB. El frontend abstrae esto con `last_sender_is_me` así que no se rompe nada, pero la DB tiene threads con ambos nombres para el mismo significado.

### 6.2 `runAutoRules()` no procesa `'esperando_nosotros'`

`runAutoRules()` en state-machine.js excluye `solucionado`, `archivado`, `en_jira`, `informativo`. Los threads `'esperando_nosotros'` sí se procesan (se recalcula severity), lo cual es correcto.

### 6.3 `investigate` busca en Gmail con `newer_than:30d` hardcodeado

Si el correo ausente tiene más de 30 días, `investigate` no lo encontrará. No hay feedback explicativo sobre esto en la UI.

### 6.4 `hasThreadMessages()` definida pero nunca usada

`database.js:403` — función exportada que ningún módulo llama.

---

## 7. Plan de corrección (orden de ejecución)

### FASE 2 — Fuente única de métricas (PRIORIDAD: ALTA)

**Problema raíz:** `StatusBar.high_severity` incluye threads donde `last_sender_is_me=1` pero el tab Urgentes los excluye.

**Fix:** Cambiar el backend `getClientThreadsSummary()` para que `high_severity` use la misma definición que el frontend:
```javascript
// database.js — high_severity solo para threads donde el cliente escribió último
high_severity: actionable.filter(t => t.severity === 'high' && !t.last_sender_is_me).length
```
Crear `src/skills/metrics.js` como fuente única de verdad para métricas del dashboard.

---

### FASE 3 — Fix `processUniversalScan` estado invertido

**Fix:** Cambiar línea 980 de `mail-ops.js`:
```javascript
// Antes (incorrecto):
estado = calculateEstado(!lastSenderIsUs, daysSince);
// Después (correcto):
estado = calculateEstado(lastSenderIsUs, daysSince);
```

---

### FASE 4 — Fix optimistic update de "Mover a Pendientes"

**Fix:** En `handleTransition` de `ClientActionList.jsx`, agregar severity update para 'pendiente':
```javascript
if (newEstado === 'pendiente') { updates.last_sender_is_me = 0; updates.severity = 'low'; }
```

---

### FASE 5 — Fix `refreshStatesFromCache` no sobrescribir transiciones manuales

**Fix:** Agregar campo `manually_transitioned` o una lógica que respete cuando el CEO movió un thread a `'pendiente'` o `'requiere_mi_accion'` manualmente. La forma más simple: que `refreshStatesFromCache` respete `updated_at` y no modifique threads que fueron actualizados manualmente en las últimas N horas.

O más simple: que la transición a `'pendiente'` en `state-machine.js` también actualice `last_sender_is_me=0` para que `refreshStatesFromCache` conserve el estado.

---

### FASE 6 — Fix `/investigate/add` para threads que no son clientes

**Fix:** Cambiar `investigate/add` para usar `runUniversalScan` en vez de `classifyClientThreads`:
```javascript
// Antes:
await mailOps.classifyClientThreads({ mode: 'incremental', days: 30 });
// Después:
await mailOps.runUniversalScan({ timeWindowMinutes: 30 * 24 * 60 }); // 30 días
```

---

### FASE 7 — Agregar `classification_reason` a threads

Agregar columna a SQLite y registrar la cadena de decisión en cada pipeline.

---

### FASE 8 — Panel de reglas completo

Agregar endpoint `GET /api/mail/rules-config` que exponga todas las reglas (spam_domains, exclude_patterns, providers, etc.) y actualizar `RulesPanel.jsx`.

---

### FASE 9 — Validación cruzada (scripts/validate-dashboard.js)

Script de test para verificar consistencia entre métricas del backend y lo que mostraría el frontend.

---

## 8. Estado real de cada componente del dashboard

| Componente | ¿Funciona? | Notas |
|-----------|-----------|-------|
| StatusBar | ✓ con bug | `high_severity` puede no coincidir con tab Urgentes |
| ClientActionList | ✓ con bug menor | Optimistic update de "Pendientes" no baja severity |
| RulesPanel | ✓ parcial | Solo muestra learned_rules + no_action_patterns. Falta spam_domains, providers, etc. |
| RiskRadar | ✓ | Usa su propio cálculo pero es consistente con el tab Urgentes |
| InvestigatePanel | ✓ con limitación | Busca en Gmail correctamente, pero "Agregar" solo funciona para clientes.yml |
| FeedbackModal | ✓ | Funciona correctamente |
| MoveToDropdown | ✓ con bug | "Mover a Pendientes" no cambia severity en optimistic update |
| RefreshIndicator (↻) | ✓ | Llama universal-scan + briefing/refresh correctamente |
| MailClassifier | ✓ | Opera sobre Pipeline A (separado de SQLite) — tab secundario |
