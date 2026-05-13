#!/usr/bin/env node
'use strict';

/**
 * Verifica consistencia entre las métricas del backend y los threads reales.
 * Uso: node scripts/validate-dashboard.js
 * Requiere que el servidor esté corriendo en http://localhost:3000
 */

const http = require('http');

function get(path) {
  return new Promise((resolve, reject) => {
    http.get(`http://localhost:3000/api${path}`, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => { try { resolve(JSON.parse(raw)); } catch { resolve(raw); } });
    }).on('error', reject);
  });
}

function ok(label)   { console.log(`  ✅ ${label}`); }
function fail(label) { console.error(`  ❌ ${label}`); }
function info(label) { console.log(`  ℹ️  ${label}`); }

async function main() {
  console.log('\n🔍 Jarvis — Validación cruzada de métricas\n');

  let metrics, threads, uncategorized;

  try {
    [metrics, threads, uncategorized] = await Promise.all([
      get('/dashboard/metrics'),
      get('/mail/client-threads'),
      get('/mail/uncategorized'),
    ]);
  } catch (e) {
    console.error('❌ No se pudo conectar al servidor:', e.message);
    console.error('   Verifica que node src/index.js esté corriendo en puerto 3000.');
    process.exit(1);
  }

  const items = threads?.items || [];
  const active = items.filter(t => t.estado !== 'archivado' && t.estado !== 'solucionado');
  // en_jira is tracked separately — not counted in accion/urgentes
  const actionable = active.filter(t => t.estado !== 'informativo' && t.estado !== 'en_jira');

  // ─── Urgentes ─────────────────────────────────────────────────────────────
  const urgentFrontend = actionable.filter(t => t.severity === 'high' && !t.last_sender_is_me).length;
  const urgentMetrics  = metrics.correos_urgentes;
  const urgentBackend  = threads.high_severity;

  console.log('── Urgentes ────────────────────────────────────');
  if (urgentMetrics === urgentFrontend) {
    ok(`metrics.correos_urgentes = tab Urgentes = ${urgentMetrics}`);
  } else {
    fail(`metrics.correos_urgentes=${urgentMetrics} vs tab Urgentes=${urgentFrontend} — MISMATCH`);
  }
  if (urgentBackend === urgentFrontend) {
    ok(`clientThreads.high_severity = tab Urgentes = ${urgentBackend}`);
  } else {
    fail(`clientThreads.high_severity=${urgentBackend} vs tab Urgentes=${urgentFrontend} — MISMATCH`);
  }

  // ─── Requiere acción ──────────────────────────────────────────────────────
  const actionFrontend = actionable.filter(t => !t.last_sender_is_me).length;
  const actionMetrics  = metrics.correos_accion;
  const actionBackend  = threads.requiring_my_action;

  console.log('\n── Requiere acción ─────────────────────────────');
  if (actionMetrics === actionFrontend) {
    ok(`metrics.correos_accion = frontend items = ${actionMetrics}`);
  } else {
    fail(`metrics.correos_accion=${actionMetrics} vs frontend=${actionFrontend} — MISMATCH`);
  }
  if (actionBackend === actionFrontend) {
    ok(`clientThreads.requiring_my_action = frontend items = ${actionBackend}`);
  } else {
    fail(`clientThreads.requiring_my_action=${actionBackend} vs frontend=${actionFrontend} — MISMATCH`);
  }

  // ─── Esperando cliente ────────────────────────────────────────────────────
  const waitingFrontend = actionable.filter(t => t.last_sender_is_me).length;
  const waitingMetrics  = metrics.esperando_cliente;
  const waitingBackend  = threads.waiting_client_response;

  console.log('\n── Esperando cliente ───────────────────────────');
  if (waitingMetrics === waitingFrontend) {
    ok(`metrics.esperando_cliente = tab Esperando = ${waitingMetrics}`);
  } else {
    fail(`metrics.esperando_cliente=${waitingMetrics} vs tab Esperando=${waitingFrontend} — MISMATCH`);
  }
  if (waitingBackend === waitingFrontend) {
    ok(`clientThreads.waiting_client_response = tab Esperando = ${waitingBackend}`);
  } else {
    fail(`clientThreads.waiting_client_response=${waitingBackend} vs frontend=${waitingFrontend} — MISMATCH`);
  }

  // ─── Informativos ─────────────────────────────────────────────────────────
  const infoFrontend = active.filter(t => t.estado === 'informativo').length;
  const infoMetrics  = metrics.informativos;

  console.log('\n── Informativos ────────────────────────────────');
  if (infoMetrics === infoFrontend) {
    ok(`metrics.informativos = tab Informativos = ${infoMetrics}`);
  } else {
    fail(`metrics.informativos=${infoMetrics} vs tab Informativos=${infoFrontend} — MISMATCH`);
  }

  // ─── Nuevos ───────────────────────────────────────────────────────────────
  const nuevosFrontend = uncategorized?.total || 0;
  const nuevosMetrics  = metrics.nuevos_sin_catalogar;

  console.log('\n── Nuevos sin catalogar ────────────────────────');
  if (nuevosMetrics === nuevosFrontend) {
    ok(`metrics.nuevos_sin_catalogar = tab Nuevos = ${nuevosMetrics}`);
  } else {
    fail(`metrics.nuevos_sin_catalogar=${nuevosMetrics} vs tab Nuevos=${nuevosFrontend} — MISMATCH`);
  }

  // ─── Totales generales ────────────────────────────────────────────────────
  console.log('\n── Totales ─────────────────────────────────────');
  info(`Threads activos en DB: ${active.length} (${actionable.length} accionables + ${infoFrontend} informativos)`);
  info(`Último universal scan: ${metrics.ultimo_scan?.timestamp || 'nunca'}`);

  // ─── Threads con estado inválido ──────────────────────────────────────────
  const knownEstados = new Set([
    'requiere_mi_accion','esperando_nosotros','pendiente',
    'esperando_cliente','informativo','en_jira','solucionado','archivado',
  ]);
  const unknownEstado = items.filter(t => !knownEstados.has(t.estado));
  console.log('\n── Integridad de estados ───────────────────────');
  if (unknownEstado.length === 0) {
    ok(`Todos los threads tienen estados conocidos`);
  } else {
    fail(`${unknownEstado.length} thread(s) con estado no reconocido:`);
    unknownEstado.slice(0, 5).forEach(t => console.error(`    - ${t.thread_id}: "${t.estado}"`));
  }

  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
