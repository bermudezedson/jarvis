const Database = require('better-sqlite3');
const path = require('path');
const logger = require('../utils/logger');

const DB_PATH = path.join(__dirname, '../../data/jarvis.db');

let _db = null;

function getDb() {
  if (!_db) {
    const fs = require('fs');
    const dir = path.dirname(DB_PATH);
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });

    _db = new Database(DB_PATH);
    _db.pragma('journal_mode = WAL');
    _db.pragma('foreign_keys = ON');
    initTables();
    logger.info('SQLite database initialized', { path: DB_PATH });
  }
  return _db;
}

function initTables() {
  const db = _db;
  db.exec(`
    CREATE TABLE IF NOT EXISTS threads (
      thread_id TEXT PRIMARY KEY,
      subject TEXT,
      original_from TEXT,
      last_from TEXT,
      last_from_email TEXT,
      snippet TEXT,
      message_count INTEGER DEFAULT 1,
      participants TEXT,
      date TEXT,
      original_date TEXT,
      last_sender_is_me INTEGER DEFAULT 0,

      category TEXT,
      estado TEXT DEFAULT 'pendiente',
      severity TEXT DEFAULT 'low',

      client_name TEXT,
      client_domain TEXT,
      client_empresa TEXT,
      client_jira_label TEXT,

      accion_sugerida TEXT,
      jira_suggested INTEGER DEFAULT 0,
      jira_issue_key TEXT,

      resolved_at TEXT,
      archived_at TEXT,
      resolution_time_hours INTEGER,
      resolution_note TEXT,

      content_hash TEXT,
      first_seen_at TEXT DEFAULT (datetime('now')),
      updated_at TEXT DEFAULT (datetime('now')),
      gmail_link TEXT
    );

    CREATE TABLE IF NOT EXISTS messages (
      message_id TEXT PRIMARY KEY,
      thread_id TEXT NOT NULL,
      sender TEXT,
      sender_email TEXT,
      date TEXT,
      body_text TEXT,
      body_html TEXT,
      is_from_me INTEGER DEFAULT 0,
      loaded_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (thread_id) REFERENCES threads(thread_id)
    );

    CREATE TABLE IF NOT EXISTS actions_log (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      action TEXT NOT NULL,
      detail TEXT,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (thread_id) REFERENCES threads(thread_id)
    );

    CREATE TABLE IF NOT EXISTS drafts (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      draft_type TEXT,
      content TEXT,
      ai_generated INTEGER DEFAULT 0,
      sent INTEGER DEFAULT 0,
      created_at TEXT DEFAULT (datetime('now')),
      sent_at TEXT,
      FOREIGN KEY (thread_id) REFERENCES threads(thread_id)
    );

    CREATE TABLE IF NOT EXISTS metadata (
      key TEXT PRIMARY KEY,
      value TEXT
    );

    CREATE TABLE IF NOT EXISTS contacts (
      email       TEXT PRIMARY KEY,
      name        TEXT,
      role        TEXT,
      client_name TEXT,
      phone       TEXT,
      notes       TEXT,
      created_at  TEXT DEFAULT (datetime('now')),
      updated_at  TEXT DEFAULT (datetime('now'))
    );

    CREATE INDEX IF NOT EXISTS idx_threads_estado   ON threads(estado);
    CREATE INDEX IF NOT EXISTS idx_threads_severity ON threads(severity);
    CREATE INDEX IF NOT EXISTS idx_threads_client   ON threads(client_name);
    CREATE INDEX IF NOT EXISTS idx_messages_thread  ON messages(thread_id);
    CREATE INDEX IF NOT EXISTS idx_actions_thread   ON actions_log(thread_id);
    CREATE INDEX IF NOT EXISTS idx_contacts_client  ON contacts(client_name);

    CREATE TABLE IF NOT EXISTS feedback (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      thread_id TEXT NOT NULL,
      original_category TEXT,
      original_estado TEXT,
      original_severity TEXT,
      correct_category TEXT,
      correct_estado TEXT,
      correct_severity TEXT,
      ceo_explanation TEXT,
      learned_pattern TEXT,
      learned_from_pattern TEXT,
      learned_client TEXT,
      rule_active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (thread_id) REFERENCES threads(thread_id)
    );

    CREATE TABLE IF NOT EXISTS learned_rules (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      pattern_type TEXT NOT NULL,
      pattern_value TEXT NOT NULL,
      correct_category TEXT,
      correct_estado TEXT,
      correct_severity TEXT,
      source_feedback_id INTEGER,
      match_count INTEGER DEFAULT 0,
      active INTEGER DEFAULT 1,
      created_at TEXT DEFAULT (datetime('now')),
      FOREIGN KEY (source_feedback_id) REFERENCES feedback(id)
    );
  `);

  // Add new columns to threads if they don't exist yet (idempotent migration)
  const alterStatements = [
    `ALTER TABLE threads ADD COLUMN last_sender_is_team INTEGER DEFAULT 0`,
    `ALTER TABLE threads ADD COLUMN is_informativo INTEGER DEFAULT 0`,
    `ALTER TABLE messages ADD COLUMN to_recipients TEXT DEFAULT ''`,
    `ALTER TABLE messages ADD COLUMN cc_recipients TEXT DEFAULT ''`,
    `ALTER TABLE messages ADD COLUMN reply_to TEXT DEFAULT ''`,
    `ALTER TABLE messages ADD COLUMN is_from_team INTEGER DEFAULT 0`,
  ];
  for (const sql of alterStatements) {
    try { db.exec(sql); } catch { /* column already exists */ }
  }
}

// ─── Thread format helpers ─────────────────────────────────────────────────

function parseRow(r) {
  if (!r) return null;
  return {
    ...r,
    participants: JSON.parse(r.participants || '[]'),
    last_sender_is_me: !!r.last_sender_is_me,
    jira_suggested: !!r.jira_suggested,
  };
}

function threadToApiFormat(r) {
  if (!r) return null;
  const t = parseRow(r);
  const daysSince = Math.max(0, Math.floor((Date.now() - new Date(t.date).getTime()) / 86400000));
  return {
    thread_id:         t.thread_id,
    subject:           t.subject,
    from:              t.original_from,
    last_from:         t.last_from,
    last_from_email:   t.last_from_email,
    last_sender_is_me: t.last_sender_is_me,
    date:              t.date,
    original_date:     t.original_date,
    snippet:           t.snippet,
    message_count:     t.message_count,
    days_since_last:   daysSince,
    estado:            t.estado,
    severity:          t.severity,
    category:          t.category,
    client: {
      name:       t.client_name,
      domain:     t.client_domain,
      empresa:    t.client_empresa,
      jira_label: t.client_jira_label,
    },
    accion_sugerida:   t.accion_sugerida,
    jira_suggested:    t.jira_suggested,
    jira_issue_key:    t.jira_issue_key,
    resolved_at:       t.resolved_at,
    archived_at:       t.archived_at,
    resolution_time_hours: t.resolution_time_hours,
    resolution_note:   t.resolution_note,
    gmail_link:        t.gmail_link,
  };
}

// ─── CRUD para threads ─────────────────────────────────────────────────────

function upsertThread(thread) {
  const db = getDb();
  const stmt = db.prepare(`
    INSERT INTO threads (
      thread_id, subject, original_from, last_from, last_from_email,
      snippet, message_count, participants, date, original_date,
      last_sender_is_me, last_sender_is_team, is_informativo,
      category, estado, severity,
      client_name, client_domain, client_empresa, client_jira_label,
      accion_sugerida, jira_suggested, content_hash, updated_at, gmail_link
    ) VALUES (
      @thread_id, @subject, @original_from, @last_from, @last_from_email,
      @snippet, @message_count, @participants, @date, @original_date,
      @last_sender_is_me, @last_sender_is_team, @is_informativo,
      @category, @estado, @severity,
      @client_name, @client_domain, @client_empresa, @client_jira_label,
      @accion_sugerida, @jira_suggested, @content_hash, datetime('now'), @gmail_link
    )
    ON CONFLICT(thread_id) DO UPDATE SET
      subject              = excluded.subject,
      last_from            = excluded.last_from,
      last_from_email      = excluded.last_from_email,
      snippet              = excluded.snippet,
      message_count        = excluded.message_count,
      participants         = excluded.participants,
      date                 = excluded.date,
      last_sender_is_me    = excluded.last_sender_is_me,
      last_sender_is_team  = excluded.last_sender_is_team,
      is_informativo       = excluded.is_informativo,
      category             = excluded.category,
      estado = CASE
        WHEN threads.estado IN ('solucionado','archivado','en_jira')
        THEN threads.estado
        ELSE excluded.estado
      END,
      severity = CASE
        WHEN threads.estado IN ('solucionado','archivado')
        THEN 'none'
        ELSE excluded.severity
      END,
      accion_sugerida = excluded.accion_sugerida,
      jira_suggested  = excluded.jira_suggested,
      content_hash    = excluded.content_hash,
      updated_at      = datetime('now')
  `);

  return stmt.run({
    ...thread,
    participants:         JSON.stringify(thread.participants || []),
    last_sender_is_me:    thread.last_sender_is_me    ? 1 : 0,
    last_sender_is_team:  thread.last_sender_is_team  ? 1 : 0,
    is_informativo:       thread.is_informativo        ? 1 : 0,
    jira_suggested:       thread.jira_suggested        ? 1 : 0,
    gmail_link:           `https://mail.google.com/mail/u/0/#inbox/${thread.thread_id}`,
  });
}

function getActiveThreads(filter = {}) {
  const db = getDb();
  let query = `SELECT * FROM threads WHERE estado NOT IN ('solucionado','archivado')`;
  const params = {};

  if (filter.severity)    { query += ' AND severity = @severity';        params.severity    = filter.severity; }
  if (filter.estado)      { query += ' AND estado = @estado';            params.estado      = filter.estado; }
  if (filter.client_name) { query += ' AND client_name = @client_name';  params.client_name = filter.client_name; }

  query += ` ORDER BY
    CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
    date ASC`;

  return db.prepare(query).all(params).map(parseRow);
}

function getArchivedThreads() {
  const db = getDb();
  return db.prepare(`SELECT * FROM threads WHERE estado = 'archivado' ORDER BY archived_at DESC`).all().map(parseRow);
}

function getResolvedThreads() {
  const db = getDb();
  return db.prepare(`SELECT * FROM threads WHERE estado = 'solucionado' ORDER BY resolved_at DESC`).all().map(parseRow);
}

function getClientThreadsSummary(scanStats) {
  const db = getDb();
  const rows = db.prepare(`
    SELECT * FROM threads WHERE estado NOT IN ('solucionado','archivado')
    ORDER BY
      CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
      date ASC
  `).all();

  const items = rows.map(threadToApiFormat);

  // Actionable = not informativo (those are FYI only)
  const actionable = items.filter(t => t.estado !== 'informativo');

  const byEstado = {};
  const byClient = {};
  items.forEach(t => {
    byEstado[t.estado]           = (byEstado[t.estado]           || 0) + 1;
    if (t.client?.name) byClient[t.client.name] = (byClient[t.client.name] || 0) + 1;
  });

  return {
    scan_type:               'sqlite',
    scanned_at:              getLastScan() || new Date().toISOString(),
    total_client_threads:    items.length,
    requiring_my_action:     actionable.filter(t => !t.last_sender_is_me).length,
    waiting_client_response: actionable.filter(t =>  t.last_sender_is_me).length,
    high_severity:           actionable.filter(t => t.severity === 'high').length,
    scan_stats:              scanStats || null,
    by_estado:               byEstado,
    by_client:               byClient,
    items,
  };
}

function resolveThread(threadId, note = '') {
  const db = getDb();
  const thread = db.prepare('SELECT original_date FROM threads WHERE thread_id = ?').get(threadId);
  if (!thread) return null;

  const now = new Date();
  const resolutionHours = Math.round((now - new Date(thread.original_date)) / (1000 * 60 * 60));

  db.prepare(`
    UPDATE threads SET
      estado = 'solucionado',
      severity = 'none',
      resolved_at = datetime('now'),
      resolution_time_hours = ?,
      resolution_note = ?,
      updated_at = datetime('now')
    WHERE thread_id = ?
  `).run(resolutionHours, note, threadId);

  logAction(threadId, 'resolved', { note, resolution_hours: resolutionHours });
  return { thread_id: threadId, estado: 'solucionado', resolution_time_hours: resolutionHours };
}

function archiveThread(threadId, reason = '') {
  const db = getDb();
  db.prepare(`
    UPDATE threads SET
      estado = 'archivado',
      severity = 'none',
      archived_at = datetime('now'),
      updated_at = datetime('now')
    WHERE thread_id = ?
  `).run(threadId);

  logAction(threadId, 'archived', { reason });
  return { thread_id: threadId, estado: 'archivado' };
}

// ─── Mensajes ──────────────────────────────────────────────────────────────

function getThreadMessages(threadId) {
  const db = getDb();
  return db.prepare('SELECT * FROM messages WHERE thread_id = ? ORDER BY date ASC').all(threadId);
}

function hasThreadMessages(threadId) {
  const db = getDb();
  return db.prepare('SELECT COUNT(*) as count FROM messages WHERE thread_id = ?').get(threadId).count > 0;
}

function saveMessage(msg) {
  const db = getDb();
  db.prepare(`
    INSERT OR REPLACE INTO messages (
      message_id, thread_id, sender, sender_email, date,
      body_text, body_html, is_from_me, is_from_team,
      to_recipients, cc_recipients, reply_to
    ) VALUES (
      @message_id, @thread_id, @sender, @sender_email, @date,
      @body_text, @body_html, @is_from_me, @is_from_team,
      @to_recipients, @cc_recipients, @reply_to
    )
  `).run({
    ...msg,
    is_from_me:    msg.is_from_me    ? 1 : 0,
    is_from_team:  msg.is_from_team  ? 1 : 0,
    to_recipients: msg.to_recipients || '',
    cc_recipients: msg.cc_recipients || '',
    reply_to:      msg.reply_to      || '',
  });
}

// ─── Log de acciones ───────────────────────────────────────────────────────

function logAction(threadId, action, detail = {}) {
  const db = getDb();
  db.prepare(`INSERT INTO actions_log (thread_id, action, detail) VALUES (?, ?, ?)`)
    .run(threadId, action, JSON.stringify(detail));
}

function getThreadActions(threadId) {
  const db = getDb();
  return db.prepare('SELECT * FROM actions_log WHERE thread_id = ? ORDER BY created_at DESC').all(threadId);
}

// ─── Borradores ────────────────────────────────────────────────────────────

function saveDraft(threadId, content, type = 'reply', aiGenerated = false) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO drafts (thread_id, draft_type, content, ai_generated)
    VALUES (?, ?, ?, ?)
  `).run(threadId, type, content, aiGenerated ? 1 : 0);
  return { id: result.lastInsertRowid, thread_id: threadId };
}

function markDraftSent(draftId) {
  const db = getDb();
  db.prepare(`UPDATE drafts SET sent = 1, sent_at = datetime('now') WHERE id = ?`).run(draftId);
}

function getLastDraftId(threadId) {
  const db = getDb();
  const row = db.prepare(`SELECT id FROM drafts WHERE thread_id = ? ORDER BY id DESC LIMIT 1`).get(threadId);
  return row?.id || null;
}

// ─── Métricas ──────────────────────────────────────────────────────────────

function getResolutionMetrics() {
  const db = getDb();
  const resolved = db.prepare(`
    SELECT COUNT(*) as total,
           AVG(resolution_time_hours) as avg_hours,
           MIN(resolution_time_hours) as min_hours,
           MAX(resolution_time_hours) as max_hours
    FROM threads WHERE estado = 'solucionado'
  `).get();

  const archived = db.prepare(`SELECT COUNT(*) as total FROM threads WHERE estado = 'archivado'`).get();
  const active   = db.prepare(`SELECT COUNT(*) as total FROM threads WHERE estado NOT IN ('solucionado','archivado')`).get();

  return {
    resolved:               resolved.total,
    avg_resolution_hours:   Math.round(resolved.avg_hours || 0),
    avg_resolution_days:    Math.round(((resolved.avg_hours || 0) / 24) * 10) / 10,
    min_resolution_hours:   resolved.min_hours || 0,
    max_resolution_hours:   resolved.max_hours || 0,
    archived:               archived.total,
    active:                 active.total,
  };
}

// ─── Feedback y reglas aprendidas ─────────────────────────────────────────

function saveFeedback(feedbackData) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO feedback (
      thread_id, original_category, original_estado, original_severity,
      correct_category, correct_estado, correct_severity, ceo_explanation
    ) VALUES (
      @thread_id, @original_category, @original_estado, @original_severity,
      @correct_category, @correct_estado, @correct_severity, @ceo_explanation
    )
  `).run(feedbackData);
  return { id: result.lastInsertRowid };
}

function saveLearnedRule(rule) {
  const db = getDb();
  const result = db.prepare(`
    INSERT INTO learned_rules
      (pattern_type, pattern_value, correct_category, correct_estado, correct_severity, source_feedback_id)
    VALUES
      (@pattern_type, @pattern_value, @correct_category, @correct_estado, @correct_severity, @source_feedback_id)
  `).run(rule);
  return { id: result.lastInsertRowid };
}

function findLearnedRule(subject, fromEmail) {
  const db = getDb();
  const subjectRules = db.prepare(
    `SELECT * FROM learned_rules WHERE active = 1 AND pattern_type IN ('subject','subject+from') ORDER BY match_count DESC`
  ).all();
  for (const rule of subjectRules) {
    if (subject?.toLowerCase().includes(rule.pattern_value.toLowerCase())) {
      db.prepare('UPDATE learned_rules SET match_count = match_count + 1 WHERE id = ?').run(rule.id);
      return rule;
    }
  }
  const fromRules = db.prepare(
    `SELECT * FROM learned_rules WHERE active = 1 AND pattern_type = 'from' ORDER BY match_count DESC`
  ).all();
  for (const rule of fromRules) {
    if (fromEmail?.toLowerCase().includes(rule.pattern_value.toLowerCase())) {
      db.prepare('UPDATE learned_rules SET match_count = match_count + 1 WHERE id = ?').run(rule.id);
      return rule;
    }
  }
  return null;
}

function getAllLearnedRules() {
  const db = getDb();
  return db.prepare('SELECT * FROM learned_rules WHERE active = 1 ORDER BY match_count DESC').all();
}

function getFeedbackHistory(limit = 20) {
  const db = getDb();
  return db.prepare('SELECT * FROM feedback ORDER BY created_at DESC LIMIT ?').all(limit);
}

// ─── Contactos ─────────────────────────────────────────────────────────────

function upsertContact(email, data = {}) {
  const db = getDb();
  db.prepare(`
    INSERT INTO contacts (email, name, role, client_name, phone, notes, updated_at)
    VALUES (@email, @name, @role, @client_name, @phone, @notes, datetime('now'))
    ON CONFLICT(email) DO UPDATE SET
      name        = COALESCE(@name,        contacts.name),
      role        = COALESCE(@role,        contacts.role),
      client_name = COALESCE(@client_name, contacts.client_name),
      phone       = COALESCE(@phone,       contacts.phone),
      notes       = COALESCE(@notes,       contacts.notes),
      updated_at  = datetime('now')
  `).run({
    email,
    name:        data.name        || null,
    role:        data.role        || null,
    client_name: data.client_name || null,
    phone:       data.phone       || null,
    notes:       data.notes       || null,
  });
}

function getContact(email) {
  if (!email) return null;
  const db = getDb();
  return db.prepare('SELECT * FROM contacts WHERE email = ?').get(email) || null;
}

function getContactsByClient(clientName) {
  const db = getDb();
  return db.prepare('SELECT * FROM contacts WHERE client_name = ? ORDER BY name ASC').all(clientName);
}

function getAllContacts() {
  const db = getDb();
  return db.prepare('SELECT * FROM contacts ORDER BY client_name ASC, name ASC').all();
}

/**
 * Seed contacts from clients.yml config so known contacts already have names.
 * clientsConfig = array of client objects from clients.yml
 */
function seedContactsFromConfig(clientsConfig = []) {
  const db = getDb();
  let seeded = 0;
  for (const client of clientsConfig) {
    const clientName = Array.isArray(client.empresa) ? client.empresa[0] : (client.empresa || client.name || '');
    for (const contact of (client.contacts || [])) {
      // contacts can be a string (email only) or an object {email, name, role}
      const contactEmail = typeof contact === 'string' ? contact : contact.email;
      const contactName  = typeof contact === 'object' ? (contact.name || null) : null;
      const contactRole  = typeof contact === 'object' ? (contact.role || null) : null;
      if (!contactEmail) continue;
      // Only insert if not already present (don't overwrite user edits)
      const existing = db.prepare('SELECT email FROM contacts WHERE email = ?').get(contactEmail);
      if (!existing) {
        db.prepare(`
          INSERT INTO contacts (email, name, role, client_name)
          VALUES (?, ?, ?, ?)
        `).run(contactEmail, contactName, contactRole, clientName || null);
        seeded++;
      }
    }
  }
  if (seeded > 0) logger.info(`Seeded ${seeded} contacts from clients.yml`);
  return seeded;
}

// ─── Scan metadata ─────────────────────────────────────────────────────────

function getLastScan() {
  const db = getDb();
  try {
    return db.prepare(`SELECT value FROM metadata WHERE key = 'last_scan_at'`).get()?.value || null;
  } catch { return null; }
}

function setLastScan() {
  const db = getDb();
  db.prepare(`INSERT OR REPLACE INTO metadata (key, value) VALUES ('last_scan_at', datetime('now'))`).run();
}

function init() {
  getDb(); // triggers initTables
}

module.exports = {
  init, getDb,
  upsertThread, getActiveThreads, getArchivedThreads, getResolvedThreads,
  getClientThreadsSummary,
  resolveThread, archiveThread,
  getThreadMessages, hasThreadMessages, saveMessage,
  logAction, getThreadActions,
  saveDraft, markDraftSent, getLastDraftId,
  getResolutionMetrics,
  getLastScan, setLastScan,
  threadToApiFormat,
  saveFeedback, saveLearnedRule, findLearnedRule, getAllLearnedRules, getFeedbackHistory,
  upsertContact, getContact, getContactsByClient, getAllContacts, seedContactsFromConfig,
};
