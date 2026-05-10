/**
 * One-time migration: processed-threads.json → SQLite
 * Run: node src/db/migrate-from-json.js
 */

const path = require('path');
const cache = require('../cache/store');
const db = require('./database');

function main() {
  const data = cache.read('processed-threads.json');
  if (!data || !data.threads) {
    console.log('No processed-threads.json found or empty — nothing to migrate.');
    return;
  }

  const threads = Object.values(data.threads);
  console.log(`Migrating ${threads.length} threads to SQLite...`);

  let ok = 0;
  let err = 0;

  for (const entry of threads) {
    const c = entry.classification;
    if (!c || !c.thread_id) { err++; continue; }

    try {
      db.upsertThread({
        thread_id:         c.thread_id,
        subject:           c.subject           || '',
        original_from:     c.from              || '',
        last_from:         c.last_from         || c.from || '',
        last_from_email:   c.last_from_email   || '',
        snippet:           c.snippet           || '',
        message_count:     c.message_count     || 1,
        participants:      Array.isArray(c.participants) ? c.participants : [],
        date:              c.date              || new Date().toISOString(),
        original_date:     c.original_date     || c.date || new Date().toISOString(),
        last_sender_is_me: c.last_sender_is_me || false,
        category:          c.category          || 'otro',
        estado:            c.estado            || 'pendiente',
        severity:          c.severity          || 'low',
        client_name:       c.client?.name      || null,
        client_domain:     c.client?.domain    || null,
        client_empresa:    Array.isArray(c.client?.empresa)
                             ? c.client.empresa.join(',')
                             : (c.client?.empresa || null),
        client_jira_label: c.client?.jira_label|| null,
        accion_sugerida:   c.accion_sugerida   || 'revisar',
        jira_suggested:    c.jira_suggested    || false,
        content_hash:      entry.hash          || '',
        gmail_link:        null,  // will be set by upsertThread
      });
      ok++;
    } catch (e) {
      console.error(`  ✗ ${c.thread_id}: ${e.message}`);
      err++;
    }
  }

  // Migrate last_scan_at
  if (data.last_scan_at) {
    db.getDb().prepare(`INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_scan_at', ?)`)
      .run(data.last_scan_at);
    console.log(`  Last scan at: ${data.last_scan_at}`);
  }

  console.log(`Done. ✓ ${ok} threads migrated, ✗ ${err} errors.`);
  console.log(`DB path: ${require('path').resolve(__dirname, '../../../data/jarvis.db')}`);
}

main();
