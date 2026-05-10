const logger = require('../utils/logger');
const yaml   = require('js-yaml');
const fs     = require('fs');
const path   = require('path');

const SKILL = 'state-machine';

const VALID_ESTADOS = [
  'requiere_mi_accion', 'pendiente', 'esperando_cliente',
  'en_jira', 'informativo', 'solucionado', 'archivado',
];

function loadRules() {
  return yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));
}

/**
 * Manual state transition — CEO moves a thread to a different estado.
 */
function transition(threadId, newEstado, note = '') {
  if (!VALID_ESTADOS.includes(newEstado)) {
    return { error: `Estado inválido: ${newEstado}` };
  }

  const db = require('../db/database');
  const thread = db.getDb().prepare('SELECT * FROM threads WHERE thread_id = ?').get(threadId);
  if (!thread) return { error: 'Thread no encontrado' };

  const oldEstado = thread.estado;

  // Delegate to existing helpers for terminal states
  if (newEstado === 'solucionado') {
    return db.resolveThread(threadId, note);
  }
  if (newEstado === 'archivado') {
    return db.archiveThread(threadId, note);
  }

  // Calculate new severity
  let newSeverity = 'low';
  if (newEstado === 'informativo') {
    newSeverity = 'none';
  } else if (newEstado === 'requiere_mi_accion') {
    const daysSince = Math.floor((Date.now() - new Date(thread.date).getTime()) / 86400000);
    newSeverity = daysSince > 7 ? 'high' : daysSince > 2 ? 'medium' : 'low';
  } else if (newEstado === 'esperando_cliente' || newEstado === 'pendiente') {
    newSeverity = 'low';
  }

  db.getDb().prepare(`
    UPDATE threads SET
      estado = ?, severity = ?,
      is_informativo = ?,
      last_sender_is_me = CASE WHEN ? = 'esperando_cliente' THEN 1 ELSE last_sender_is_me END,
      updated_at = datetime('now')
    WHERE thread_id = ?
  `).run(
    newEstado,
    newSeverity,
    newEstado === 'informativo' ? 1 : 0,
    newEstado,
    threadId,
  );

  db.logAction(threadId, 'state_transition', { from: oldEstado, to: newEstado, note });
  logger.info('State transition', { SKILL, threadId, from: oldEstado, to: newEstado });

  return {
    success:   true,
    thread_id: threadId,
    old_estado: oldEstado,
    new_estado: newEstado,
    severity:   newSeverity,
  };
}

/**
 * Run automatic state-machine rules (called from morning cron).
 */
async function runAutoRules() {
  const db    = require('../db/database');
  const rules = loadRules();
  const sm    = rules.state_machine || {};
  const results = { auto_archived: 0, auto_resolved: 0, escalated: 0 };

  // 1. Auto-archive informativos older than N days (based on updated_at)
  const archiveDays = sm.informativo_auto_archive_days || 7;
  const oldInfo = db.getDb().prepare(`
    SELECT thread_id FROM threads
    WHERE estado = 'informativo'
    AND julianday('now') - julianday(updated_at) > ?
  `).all(archiveDays);

  oldInfo.forEach(t => {
    db.archiveThread(t.thread_id, `Auto-archivado tras ${archiveDays} días sin actividad`);
    results.auto_archived++;
  });

  // 2. Auto-resolve invoices where client confirmed payment (snippet match)
  const resolveKws = sm.invoice_rules?.auto_resolve_keywords || [];
  if (resolveKws.length > 0) {
    const invoiceThreads = db.getDb().prepare(`
      SELECT thread_id, snippet FROM threads
      WHERE estado = 'informativo'
      AND is_informativo = 1
      AND last_sender_is_me = 0
      AND last_sender_is_team = 0
    `).all();

    invoiceThreads.forEach(t => {
      const low = (t.snippet || '').toLowerCase();
      const match = resolveKws.some(kw => low.includes(kw.toLowerCase()));
      if (match) {
        db.resolveThread(t.thread_id, 'Auto-resuelto: cliente confirmó pago');
        results.auto_resolved++;
      }
    });
  }

  // 3. Escalate waiting_client threads older than N days → severity high
  const escalateDays = sm.waiting_escalation_days || 14;
  db.getDb().prepare(`
    UPDATE threads SET severity = 'high', updated_at = datetime('now')
    WHERE estado = 'esperando_cliente'
    AND severity != 'high'
    AND julianday('now') - julianday(date) > ?
  `).run(escalateDays);

  // 4. Invoices without response after N days → move to pendiente
  const pendingDays = sm.invoice_rules?.days_without_response_to_pending || 15;
  const staleInvoices = db.getDb().prepare(`
    SELECT thread_id FROM threads
    WHERE estado = 'informativo'
    AND is_informativo = 1
    AND (last_sender_is_me = 1 OR last_sender_is_team = 1)
    AND julianday('now') - julianday(date) > ?
  `).all(pendingDays);

  staleInvoices.forEach(t => {
    transition(t.thread_id, 'pendiente',
      `Auto-escalado: factura sin confirmación de pago tras ${pendingDays} días`);
    results.escalated++;
  });

  logger.info('Auto rules executed', { SKILL, ...results });
  return results;
}

module.exports = { transition, runAutoRules };
