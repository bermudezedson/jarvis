'use strict';

const fs   = require('fs');
const path = require('path');
const yaml = require('js-yaml');

const INVOICE_SUBJECT_PATTERNS = [
  /factura/i, /nota de cr[eé]dito/i, /boleta/i, /cobro/i, /pago.*pendiente/i,
];
function isInvoiceSubject(subject) {
  return INVOICE_SUBJECT_PATTERNS.some(p => p.test(subject || ''));
}

function isTypeAFixed() {
  try {
    const src = fs.readFileSync(
      path.join(__dirname, 'mail-ops.js'), 'utf8');
    return src.includes('isInvoiceSubject') && src.includes('invoice_override');
  } catch { return false; }
}

function loadConfigs() {
  const rules = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));
  let providers = { providers: [] };
  try {
    providers = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/providers.yml'), 'utf8'));
  } catch { /* optional */ }
  const db = require('../db/database');
  const learnedRules = db.getDb().prepare('SELECT * FROM learned_rules WHERE active = 1').all();
  return { rules, providers, learnedRules, db };
}

function runAudit() {
  const { rules, providers, learnedRules, db } = loadConfigs();
  const sm = rules.state_machine || {};
  const conflicts = [];
  const resolved  = [];
  const warnings  = [];
  const infos     = [];

  // ─── TIPO A: Regla de tiempo anula regla de tiempo ──────────────────────────
  const archiveDays = sm.informativo_auto_archive_days || 7;
  const pendingDays = sm.invoice_rules?.days_without_response_to_pending || 15;

  if (archiveDays < pendingDays) {
    const fixed = isTypeAFixed();
    if (fixed) {
      resolved.push({
        type: 'A',
        title: 'Auto-archivo (7d) vs escalación de facturas (15d)',
        fix: 'Facturas enviadas por el equipo clasifican como esperando_cliente (no informativo). Safety net en runAutoRules excluye facturas team-sent del auto-archivo.',
      });
    } else {
      conflicts.push({
        type: 'A',
        title: 'Auto-archivo anula escalación de facturas',
        detail: `Informativos se archivan a los ${archiveDays}d, pero facturas escalan a pendiente a los ${pendingDays}d.`,
      });
    }
  }

  // ─── TIPO B: Patrón genérico captura correos de clientes ────────────────────
  const sqlDb = db.getDb();
  const allNoAction = rules.mail?.no_action_patterns || [];
  const allExclude  = rules.mail?.exclude_patterns   || [];

  for (const pattern of allNoAction) {
    const allMatches = sqlDb.prepare(`
      SELECT thread_id, subject, client_name, estado FROM threads
      WHERE client_name IS NOT NULL
        AND LOWER(subject) LIKE ?
        AND estado NOT IN ('solucionado','archivado')
    `).all(`%${pattern.toLowerCase()}%`);

    // Filtrar falsos positivos: facturas ya reclasificadas a esperando_cliente
    const realMatches = allMatches.filter(t =>
      !(t.estado === 'esperando_cliente' && isInvoiceSubject(t.subject))
    );

    if (realMatches.length > 0) {
      warnings.push({
        type: 'B',
        title: `Patrón no_action "${pattern}" matchea correos de clientes`,
        threads: realMatches.map(t => ({ thread_id: t.thread_id, subject: t.subject, client: t.client_name, estado: t.estado })),
        suggestion: 'Revisar si estos correos deberían ser informativos o requieren acción.',
      });
    }
  }

  for (const pattern of allExclude) {
    const matches = sqlDb.prepare(`
      SELECT thread_id, subject, client_name FROM threads
      WHERE client_name IS NOT NULL
        AND LOWER(subject) LIKE ?
    `).all(`%${pattern.toLowerCase()}%`);
    if (matches.length > 0) {
      warnings.push({
        type: 'B',
        title: `Patrón exclude "${pattern}" matchea correos de clientes (descarte silencioso)`,
        threads: matches.map(t => ({ thread_id: t.thread_id, subject: t.subject, client: t.client_name })),
        suggestion: 'RIESGO ALTO: estos correos se descartan sin guardar. Considerar mover a no_action_patterns.',
      });
    }
  }

  // ─── TIPO C: Regla aprendida podría silenciar correos de clientes ────────────
  for (const rule of learnedRules) {
    if (!['informativo', 'archivado'].includes(rule.correct_estado)) continue;
    let allMatches = [];
    if (rule.pattern_type === 'from') {
      allMatches = sqlDb.prepare(`
        SELECT thread_id, subject, client_name, estado FROM threads
        WHERE client_name IS NOT NULL
          AND LOWER(last_from_email) LIKE ?
          AND estado NOT IN ('solucionado','archivado')
      `).all(`%${rule.pattern_value.toLowerCase()}%`);
    } else {
      allMatches = sqlDb.prepare(`
        SELECT thread_id, subject, client_name, estado FROM threads
        WHERE client_name IS NOT NULL
          AND LOWER(subject) LIKE ?
          AND estado NOT IN ('solucionado','archivado')
      `).all(`%${rule.pattern_value.toLowerCase()}%`);
    }

    const realMatches = allMatches.filter(t =>
      !(t.estado === 'esperando_cliente' && isInvoiceSubject(t.subject))
    );

    if (realMatches.length > 0) {
      warnings.push({
        type: 'C',
        title: `Regla aprendida ID ${rule.id} ("${rule.pattern_value}" → ${rule.correct_estado}) matchea correos de clientes`,
        threads: realMatches.map(t => ({ thread_id: t.thread_id, subject: t.subject, client: t.client_name })),
        suggestion: 'Verificar si estos correos de clientes deberían ser silenciados.',
      });
    }
  }

  // ─── TIPO D: Reglas redundantes ─────────────────────────────────────────────
  const allPatterns = [];
  allNoAction.forEach(p => allPatterns.push({ source: 'no_action_patterns', pattern: p.toLowerCase() }));
  learnedRules.forEach(r => allPatterns.push({ source: `learned_rule_${r.id}`, pattern: r.pattern_value.toLowerCase() }));

  const seen = {};
  for (const item of allPatterns) {
    if (!seen[item.pattern]) seen[item.pattern] = [];
    seen[item.pattern].push(item.source);
  }
  for (const [pattern, sources] of Object.entries(seen)) {
    if (sources.length > 1) {
      infos.push({
        type: 'D',
        title: `Patrón redundante: "${pattern}" en: ${sources.join(', ')}`,
        suggestion: 'Mantener solo uno — la regla aprendida tiene precedencia.',
      });
    }
  }

  // ─── TIPO E: Proveedor sin alert_keywords ────────────────────────────────────
  for (const prov of (providers.providers || [])) {
    if (!prov.alert_keywords?.length) {
      warnings.push({
        type: 'E',
        title: `Proveedor "${prov.name}" sin alert_keywords`,
        detail: `Dominios: ${prov.domains?.join(', ')}. Todos sus correos llegarán como informativo.`,
        suggestion: 'Agregar alert_keywords relevantes.',
      });
    }
  }

  const totalIssues = conflicts.length + warnings.length;
  return {
    run_at: new Date().toISOString(),
    summary: {
      conflicts: conflicts.length,
      resolved:  resolved.length,
      warnings:  warnings.length,
      infos:     infos.length,
      total:     totalIssues,
      status:    totalIssues === 0 ? 'SIN CONFLICTOS ACTIVOS' : conflicts.length > 0 ? 'CONFLICTOS ACTIVOS' : 'WARNINGS',
    },
    resolved,
    conflicts,
    warnings,
    infos,
  };
}

module.exports = { runAudit };
