#!/usr/bin/env node
'use strict';
// Reclasifica retroactivamente las facturas enviadas por el equipo que quedaron
// como informativo/archivado. Idempotente: segunda ejecución no cambia nada.

const db = require('../src/db/database');

const INVOICE_PATTERNS = [/factura/i, /nota de cr[eé]dito/i, /boleta/i, /cobro/i, /pago.*pendiente/i];
function isInvoiceSubject(subject) {
  return INVOICE_PATTERNS.some(p => p.test(subject || ''));
}

function banner(t) { console.log('\n' + '═'.repeat(50) + '\n' + t + '\n' + '═'.repeat(50)); }

async function main() {
  banner('RECLASIFICACIÓN DE FACTURAS');

  db.init();
  const sqlDb = db.getDb();

  // Buscar candidatos: facturas enviadas por equipo, de clientes conocidos,
  // en estado informativo o archivado.
  // Nota: last_sender_is_team puede ser 0 en threads históricos — buscamos también por dominio.
  const candidates = sqlDb.prepare(`
    SELECT thread_id, subject, client_name, estado, date, last_from, last_from_email,
           last_sender_is_me, last_sender_is_team
    FROM threads
    WHERE (
      last_sender_is_me = 1
      OR last_sender_is_team = 1
      OR last_from_email LIKE '%@clickrepuestos.cl'
      OR last_from_email LIKE '%@webyseo.cl'
    )
    AND client_name IS NOT NULL
    AND estado IN ('informativo', 'archivado')
    AND (
      LOWER(subject) LIKE '%factura%'
      OR LOWER(subject) LIKE '%nota de cr%dito%'
      OR LOWER(subject) LIKE '%boleta%'
      OR LOWER(subject) LIKE '%cobro%'
    )
  `).all();

  // Filtrar por regex (más preciso que LIKE)
  const toReclassify = candidates.filter(t => isInvoiceSubject(t.subject));

  console.log(`\nCandidatos encontrados: ${candidates.length}`);
  console.log(`A reclasificar (filtro regex): ${toReclassify.length}`);

  if (toReclassify.length === 0) {
    console.log('\n✅ Nada que reclasificar.\n');
    return;
  }

  const updateStmt = sqlDb.prepare(`
    UPDATE threads SET
      estado            = 'esperando_cliente',
      severity          = 'low',
      is_informativo    = 0,
      last_sender_is_me = 1,
      last_sender_is_team = 1,
      category          = 'factura_enviada',
      accion_sugerida   = 'seguimiento',
      classification_reason    = ?,
      manually_transitioned_at = NULL,
      updated_at        = datetime('now'),
      archived_at       = NULL
    WHERE thread_id = ? AND estado IN ('informativo', 'archivado')
  `);

  const logStmt = sqlDb.prepare(`
    INSERT INTO actions_log (thread_id, action, detail)
    VALUES (?, 'reclassified_invoice', ?)
  `);

  let reclassified = 0;

  console.log('\nDetalle:');
  for (const t of toReclassify) {
    const reason = JSON.stringify({
      pipeline:  'reclassify-invoices-script',
      timestamp: new Date().toISOString(),
      steps: [
        { step: 'retroactive_fix', result: 'esperando_cliente',
          reason: `Factura enviada por el equipo a ${t.client_name}, esperando pago. Reclasificada retroactivamente.` },
      ],
    });

    const result = updateStmt.run(reason, t.thread_id);
    if (result.changes > 0) {
      logStmt.run(t.thread_id, JSON.stringify({
        prev_estado: t.estado,
        new_estado:  'esperando_cliente',
        reason:      'Reclasificación retroactiva: factura enviada a cliente',
      }));
      reclassified++;
      const days = Math.max(0, Math.floor((Date.now() - new Date(t.date).getTime()) / 86400000));
      console.log(`  ${reclassified}. ${t.client_name} — "${t.subject}"`);
      console.log(`     ${t.estado} → esperando_cliente (${days} días esperando pago)`);
    }
  }

  console.log(`\nReclasificados: ${reclassified} de ${toReclassify.length}`);
  if (reclassified > 0) {
    console.log('Estos threads ahora aparecen en el tab "Esperando" del dashboard.');
    console.log('La regla de escalación a 15 días aplica normalmente desde hoy.');
  }
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
