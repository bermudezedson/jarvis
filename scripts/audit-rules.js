#!/usr/bin/env node
'use strict';
// Detecta conflictos entre las reglas de Jarvis. Solo lee, no modifica nada.

const { runAudit } = require('../src/skills/rule-auditor');

function banner(text) { console.log('\n' + '═'.repeat(50)); console.log(text); console.log('═'.repeat(50)); }
function section(text) { console.log('\n── ' + text + ' ' + '─'.repeat(Math.max(0, 46 - text.length))); }

async function main() {
  banner('JARVIS RULES AUDIT — ' + new Date().toLocaleDateString('es-CL'));

  const result = runAudit();

  // ─── Resolved ───────────────────────────────────────────────────────────────
  if (result.resolved?.length > 0) {
    section('RESUELTOS (' + result.resolved.length + ')');
    for (const r of result.resolved) {
      console.log(`\n  ✅ TIPO ${r.type} (resuelto): ${r.title}`);
      console.log(`     ${r.fix}`);
    }
  }

  // ─── Conflicts ──────────────────────────────────────────────────────────────
  section('CONFLICTOS ACTIVOS (' + result.conflicts.length + ')');
  if (result.conflicts.length === 0) {
    console.log('  ✅ Sin conflictos activos');
  } else {
    for (const c of result.conflicts) {
      console.log(`\n  ⛔ TIPO ${c.type}: ${c.title}`);
      console.log(`     ${c.detail || ''}`);
    }
  }

  // ─── Warnings ───────────────────────────────────────────────────────────────
  section('WARNINGS (' + result.warnings.length + ')');
  if (result.warnings.length === 0) {
    console.log('  ✅ Sin warnings');
  } else {
    for (const w of result.warnings) {
      console.log(`\n  ⚠️  TIPO ${w.type}: ${w.title}`);
      if (w.threads?.length > 0) {
        console.log(`     Threads afectados (${w.threads.length}):`);
        w.threads.slice(0, 5).forEach(t =>
          console.log(`       · ${t.client || '?'} — "${t.subject}"`)
        );
        if (w.threads.length > 5) console.log(`       · ... y ${w.threads.length - 5} más`);
      }
      if (w.detail)     console.log(`     ${w.detail}`);
      if (w.suggestion) console.log(`     Sugerencia: ${w.suggestion}`);
    }
  }

  // ─── Infos (redundancias) ────────────────────────────────────────────────────
  section('REDUNDANCIAS (' + result.infos.length + ')');
  if (result.infos.length === 0) {
    console.log('  ✅ Sin redundancias');
  } else {
    for (const i of result.infos) {
      console.log(`\n  ℹ️  TIPO ${i.type}: ${i.title}`);
      if (i.suggestion) console.log(`     Sugerencia: ${i.suggestion}`);
    }
  }

  // ─── Resumen ─────────────────────────────────────────────────────────────────
  section('RESUMEN');
  console.log(`  Conflictos: ${result.summary.conflicts}`);
  console.log(`  Warnings:   ${result.summary.warnings}`);
  console.log(`  Infos:      ${result.summary.infos}`);
  console.log(`  Estado:     ${result.summary.status}`);
  console.log('');
}

main().catch(e => { console.error(e); process.exit(1); });
