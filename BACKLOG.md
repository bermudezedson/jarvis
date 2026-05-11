# BACKLOG — Features pendientes para prompts futuros

Este archivo contiene features nuevas que surgieron durante la auditoría del Prompt #13.
**No implementar hasta que el prompt #13 esté completo y estabilizado.**

---

## Crítico — bugs conocidos

### B-000: Reglas aprendidas con regex — no funcionan como se espera
`findLearnedRule()` usa `String.includes()`, no regex. Los patrones IDs 2 y 10 tienen sintaxis regex (`|`, `.*`) que se interpretan literalmente — nunca matchearán.
- ID 2: `"resumen|reporte|notificación de.*plugin|backup.*automático"` — solo matchea si el asunto contiene ESA cadena exacta
- ID 10: `"Weekly.*Summary|wordpress@"` — mismo problema
**Fix:** Migrar `findLearnedRule()` a `RegExp` o proveer modo de escape. Por ahora, eliminar esas reglas y recrearlas con patrones simples.

---

## Alta prioridad

### B-001: `classification_reason` — trazabilidad completa
Agregar campo JSON en cada thread que registre la cadena de decisión:
- Qué pipeline lo procesó
- Qué reglas se evaluaron y cuáles matchearon
- Por qué quedó en ese estado/categoría
- Mostrar en el accordion del thread como tooltip/mini-panel

### B-002: Unificar estados del sistema
Definir un único enum de estados que use tanto `mail-ops.js` como `state-machine.js`:
- Reemplazar `'esperando_nosotros'` por `'requiere_mi_accion'` en todos los pipelines
- O agregar `'esperando_nosotros'` a `VALID_ESTADOS` y actualizar el frontend

### B-003: Panel de reglas completo
Mostrar en `RulesPanel.jsx`:
- `spam_domains` con toggle para activar/desactivar individualmente
- `exclude_patterns` con contador de threads descartados
- `providers.yml` — lista de proveedores + alert_keywords
- `priority_keywords` y `client_request_keywords`
- Blacklist dinámica (`blacklist.discard_domains`, `blacklist.discard_subjects`)

---

## Media prioridad

### B-004: Deprecar Pipeline A (`classify()`) o reconectarlo
Pipeline A (`classify()`) escribe en `mail-classifications.json` que el dashboard principal ignora.
Opciones:
- A) Eliminar Pipeline A y hacer que `MailClassifier.jsx` use SQLite
- B) Migrar toda la lógica de detección de phishing/facturas/envíos de Pipeline A a Pipeline C

### B-005: Detectar phishing en Universal Scan
`isPhishing()`, `isSubscription()`, `isShipping()`, `BRAND_DOMAINS` solo corren en Pipeline A.
El universal scan (Pipeline C) no detecta phishing. Si un correo phishing llega a la inbox, Pipeline C lo clasifica como `'unknown'` → AI → posiblemente `'plataforma'` sin alertar.

### B-006: `refreshStatesFromCache` respetar transiciones manuales
Actualmente sobrescribe manualmente el estado calculado. Necesita saber si el CEO hizo una transición manual reciente y preservarla por X horas.

### B-007: `GET /investigate` con ventana configurable
Hoy hardcodeado a `newer_than:30d`. Permitir buscar threads más antiguos cuando el CEO sabe que el email existe pero es de hace >30 días.

### B-008: Tab "Nuevos" con acciones en masa
El tab "Nuevos" muestra unknowns pero no permite:
- Silenciar dominio en masa
- Clasificar múltiples como clientes/proveedores a la vez
- Exportar lista para revisar

### B-009: Métricas históricas
Crear vista de evolución semanal:
- Threads resueltos por semana
- Tiempo promedio de respuesta por cliente
- Volumen por estado a lo largo del tiempo

---

## Baja prioridad

### B-010: Cleanup de código muerto
Después de que Pipeline A quede deprecado:
- Eliminar `needsAction()`, `needsActionFromCategory()`, `countByCategory()`, `countByEstado()`
- Eliminar o limpiar el parámetro `daysSince` de `calculateEstado()`
- Eliminar o documentar `hasThreadMessages()` (nunca usado)
- Limpiar `sortAndBuild()` (solo accesible por path obsoleto)

### B-011: Diagnóstico de por qué un correo de AWS no aparece
La raíz del problema del email de AWS no encontrado es probablemente que:
1. El email llegó hace >48h antes del primer scan ó
2. No está en Gmail INBOX (solo en un label)
El `investigate` ya lo encontraría si cumple `newer_than:30d`. Mejorar con:
- Buscar también en `in:all` (no solo inbox/sent)
- Si thread tiene >30 días, informar que fue escaneado fuera de ventana

### B-012: Notification cuando hay nuevos threads urgentes
Al abrir el dashboard, mostrar un toast si llegaron nuevos high-severity threads desde la última visita.

---

*Última actualización: 2026-05-10 — Prompt #13 Auditoría y Estabilización*
