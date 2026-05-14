#!/usr/bin/env node
/**
 * Sync Jarvis labels to Gmail for all existing threads in SQLite.
 * Run ONCE manually: node scripts/sync-gmail-labels.js
 *
 * Rate limit: 200ms delay between threads (safe for Gmail's quota).
 */

require('dotenv').config({ path: require('path').join(__dirname, '../.env') });

const db      = require('../src/db/database');
const gmail   = require('../src/mcp/gmail');
const logger  = require('../src/utils/logger');

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function main() {
  console.log('Jarvis → Gmail label sync\n');

  // 1. Ensure Jarvis labels exist in Gmail
  console.log('Creando/verificando labels de Jarvis en Gmail...');
  const ok = await gmail.ensureJarvisLabels();
  if (!ok) {
    console.error('ERROR: No se pudieron inicializar los labels. Verifica GMAIL_REFRESH_TOKEN y los scopes OAuth2 (se requiere gmail.modify).');
    process.exit(1);
  }
  console.log('Labels OK.\n');

  // 2. Load all threads from SQLite
  const sqlDb   = db.getDb();
  const threads = sqlDb.prepare(`
    SELECT thread_id, estado, source_type, client_name, is_informativo
    FROM threads
    ORDER BY updated_at DESC
  `).all();

  console.log(`Sincronizando ${threads.length} threads...\n`);

  let synced = 0;
  let failed = 0;
  let skipped = 0;

  for (let i = 0; i < threads.length; i++) {
    const t = threads[i];
    process.stdout.write(`\r[${i + 1}/${threads.length}] ${t.thread_id} → ${t.estado}    `);

    try {
      if (t.estado === 'archivado' || t.estado === 'solucionado') {
        const labels = t.estado === 'solucionado' ? ['Jarvis/Solucionado'] : [];
        await gmail.modifyThread(t.thread_id, labels, ['Jarvis/Acción Requerida'], true);
      } else if (t.estado === 'en_jira') {
        await gmail.modifyThread(t.thread_id, ['Jarvis/En Jira', 'Jarvis/Procesado'], ['Jarvis/Acción Requerida'], false);
      } else if (t.is_informativo || t.estado === 'informativo') {
        await gmail.modifyThread(t.thread_id, ['Jarvis/Procesado'], [], true);
      } else if (t.client_name) {
        const labels = ['Jarvis/Procesado', 'Jarvis/Cliente'];
        if (t.estado === 'requiere_mi_accion' || t.estado === 'esperando_nosotros') {
          labels.push('Jarvis/Acción Requerida');
        }
        await gmail.modifyThread(t.thread_id, labels, [], false);
      } else if (t.source_type === 'provider') {
        await gmail.modifyThread(t.thread_id, ['Jarvis/Procesado', 'Jarvis/Proveedor'], [], true);
      } else {
        await gmail.modifyThread(t.thread_id, ['Jarvis/Procesado'], [], false);
      }
      synced++;
    } catch (e) {
      failed++;
      logger.debug('Sync failed', { thread_id: t.thread_id, error: e.message });
    }

    // Rate limit: 200ms between each thread
    await sleep(200);
  }

  console.log('\n');
  console.log('─'.repeat(40));
  console.log(`✅ Sincronizados: ${synced}`);
  console.log(`❌ Fallidos:      ${failed}`);
  console.log(`— Skipped:        ${skipped}`);
  console.log('─'.repeat(40));

  if (failed > 0) {
    console.log('\nAlgunos threads fallaron. Posibles causas:');
    console.log('  · Threads muy antiguos ya no están en Gmail');
    console.log('  · Rate limit temporal — vuelve a correr el script');
  }
}

main().catch(e => {
  console.error('\nError fatal:', e.message);
  process.exit(1);
});
