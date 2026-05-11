'use strict';

// Estados donde el CEO debe responder (cliente escribió último o está pendiente)
const URGENTE_ESTADOS = new Set(['requiere_mi_accion', 'esperando_nosotros', 'pendiente']);
// Estados donde esperamos respuesta del cliente
const WAITING_ESTADOS = new Set(['esperando_cliente']);

/**
 * ÚNICA fuente de cálculo de métricas del dashboard.
 * Un thread es urgente IFF:
 *   estado IN (requiere_mi_accion, esperando_nosotros, pendiente)
 *   AND severity IN (high, critical)
 *   AND last_sender_is_me = 0
 */
function getDashboardMetrics() {
  const db    = require('../db/database');
  const sqlDb = db.getDb();

  const rows = sqlDb.prepare(`
    SELECT estado, severity, last_sender_is_me, source_type
    FROM threads
    WHERE estado NOT IN ('solucionado', 'archivado')
  `).all();

  let correos_accion      = 0;
  let correos_urgentes    = 0;
  let correos_pendientes  = 0;
  let esperando_cliente   = 0;
  let informativos        = 0;
  let nuevos_sin_catalogar = 0;

  const por_estado = {};

  for (const row of rows) {
    const estado = row.estado || 'pendiente';
    const lsim   = !!row.last_sender_is_me;

    por_estado[estado] = (por_estado[estado] || 0) + 1;

    if (estado === 'informativo') {
      informativos++;
    } else if (URGENTE_ESTADOS.has(estado) && !lsim) {
      correos_accion++;
      if (row.severity === 'high' || row.severity === 'critical') {
        correos_urgentes++;
      } else {
        correos_pendientes++;
      }
    } else if (WAITING_ESTADOS.has(estado)) {
      esperando_cliente++;
    }
    // en_jira y otros estados → contados en por_estado pero no en métricas de acción

    if (row.source_type === 'unknown') nuevos_sin_catalogar++;
  }

  const closedRows = sqlDb.prepare(`
    SELECT estado, COUNT(*) as cnt FROM threads
    WHERE estado IN ('solucionado', 'archivado')
    GROUP BY estado
  `).all();
  const solucionados = closedRows.find(r => r.estado === 'solucionado')?.cnt || 0;
  const archivados   = closedRows.find(r => r.estado === 'archivado')?.cnt  || 0;

  const ultimo_scan = db.getLastUniversalScan();

  return {
    correos_accion,
    correos_urgentes,
    correos_pendientes,
    esperando_cliente,
    informativos,
    nuevos_sin_catalogar,
    solucionados,
    archivados,
    por_estado: {
      requiere_mi_accion: por_estado.requiere_mi_accion  || 0,
      esperando_nosotros: por_estado.esperando_nosotros  || 0,
      pendiente:          por_estado.pendiente            || 0,
      esperando_cliente:  por_estado.esperando_cliente    || 0,
      informativo:        por_estado.informativo          || 0,
      en_jira:            por_estado.en_jira              || 0,
    },
    ultimo_scan: {
      timestamp: ultimo_scan || null,
      tipo: 'universal',
    },
  };
}

module.exports = { getDashboardMetrics, URGENTE_ESTADOS, WAITING_ESTADOS };
