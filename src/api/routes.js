const express = require('express');
const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const router = express.Router();
const cache = require('../cache/store');
const { isMorningNow } = require('../utils/date-helpers');
const briefingSkill = require('../skills/daily-briefing');
const logger = require('../utils/logger');

router.get('/briefing/current', (req, res) => {
  const key = isMorningNow() ? 'briefing-am.json' : 'briefing-pm.json';
  const data = cache.read(key);
  if (!data) return res.status(404).json({ error: 'no_briefing', message: 'No hay briefing. Ejecuta POST /briefing/refresh' });
  res.json(data);
});

router.get('/briefing/morning', (req, res) => {
  const data = cache.read('briefing-am.json');
  if (!data) return res.status(404).json({ error: 'no_briefing', message: 'No hay briefing matutino. Ejecuta POST /briefing/refresh' });
  res.json(data);
});

router.get('/briefing/evening', (req, res) => {
  const data = cache.read('briefing-pm.json');
  if (!data) return res.status(404).json({ error: 'no_briefing', message: 'No hay briefing vespertino. Ejecuta POST /briefing/refresh' });
  res.json(data);
});

// ─── Dashboard consolidado ────────────────────────────────────────────────────

router.get('/dashboard', (req, res) => {
  const type = req.query.type;
  let briefing;
  if (type === 'morning') {
    briefing = cache.read('briefing-am.json');
  } else if (type === 'evening') {
    briefing = cache.read('briefing-pm.json');
  } else {
    const key = isMorningNow() ? 'briefing-am.json' : 'briefing-pm.json';
    briefing = cache.read(key) || cache.read('briefing-am.json') || cache.read('briefing-pm.json');
  }

  let clientThreads = null;
  try {
    const db = require('../db/database');
    clientThreads = db.getClientThreadsSummary();
  } catch {
    clientThreads = cache.read('client-threads.json');
  }
  const mailClassifications = cache.read('mail-classifications.json');
  const lastRefresh = cache.read('last-refresh.json');

  let commitments = null;
  try {
    const commitmentTracker = require('../skills/commitment-tracker');
    const { open, overdue } = commitmentTracker.getOpen();
    commitments = { open, overdue, open_count: open.length, overdue_count: overdue.length };
  } catch {}

  let clientPulse = null;
  try {
    const clientPulseSkill = require('../skills/client-pulse');
    clientPulse = clientPulseSkill.getPulse();
  } catch {}

  let threadMetrics = null;
  try {
    const { getDashboardMetrics } = require('../skills/metrics');
    threadMetrics = getDashboardMetrics();
  } catch { /* non-fatal if DB not ready */ }

  res.json({
    briefing:       briefing        || null,
    client_threads: clientThreads   || null,
    thread_metrics: threadMetrics,
    mail:           mailClassifications || null,
    commitments:    commitments     || null,
    client_pulse:   clientPulse     || null,
    last_refresh:   lastRefresh,
    has_real_data:  !!(briefing || clientThreads),
    timestamp:      new Date().toISOString(),
  });
});

router.post('/briefing/refresh', async (req, res) => {
  try {
    const type = isMorningNow() ? 'morning' : 'evening';
    logger.info('Manual refresh triggered', { type });
    const briefing = await briefingSkill.generate(type);
    res.json({ success: true, briefing });
  } catch (err) {
    logger.error('Manual refresh failed', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/health', async (req, res) => {
  const gmail = require('../mcp/gmail');
  const calendar = require('../mcp/calendar');
  const jira = require('../mcp/jira');
  const confluence = require('../mcp/confluence');

  const checks = await Promise.allSettled([
    gmail.healthCheck(),
    calendar.healthCheck(),
    jira.healthCheck(),
    confluence.healthCheck(),
  ]);

  res.json({
    status: 'ok',
    mcp: {
      gmail: checks[0].status === 'fulfilled' ? checks[0].value : 'error',
      calendar: checks[1].status === 'fulfilled' ? checks[1].value : 'error',
      jira: checks[2].status === 'fulfilled' ? checks[2].value : 'error',
      confluence: checks[3].status === 'fulfilled' ? checks[3].value : 'error',
    },
    last_refresh: cache.read('last-refresh.json'),
    timestamp: new Date().toISOString(),
  });
});

router.get('/config/clients', (req, res) => {
  const filePath = path.join(__dirname, '../../config/clients.yml');
  const data = yaml.load(fs.readFileSync(filePath, 'utf8'));
  res.json(data);
});

// ─── Métricas unificadas ─────────────────────────────────────────────────────
router.get('/dashboard/metrics', (req, res) => {
  try {
    const { getDashboardMetrics } = require('../skills/metrics');
    res.json(getDashboardMetrics());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Phase 2 endpoints ────────────────────────────────────────────────────────

// ─── Mail inbox ───────────────────────────────────────────────────────────────

router.get('/mail/inbox', (req, res) => {
  const data = cache.read('mail-classifications.json');
  if (!data) return res.json({ classified: false, message: 'Run POST /mail/classify first' });
  res.json(data);
});

router.post('/mail/classify', async (req, res) => {
  try {
    const { hours = 48 } = req.body;
    const mailOps = require('../skills/mail-ops');
    const result = await mailOps.classify(hours);
    res.json(result);
  } catch (err) {
    logger.error('Mail classify failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/approve', async (req, res) => {
  try {
    const { thread_id, action } = req.body; // action: 'approve' | 'reject'
    if (!thread_id || !action) return res.status(400).json({ error: 'thread_id and action required' });
    const data = cache.read('mail-classifications.json');
    if (!data) return res.status(404).json({ error: 'No classifications found' });
    const item = data.items.find(i => i.thread_id === thread_id);
    if (!item) return res.status(404).json({ error: 'Thread not found' });
    item.aprobado = action === 'approve';
    cache.write('mail-classifications.json', data);
    res.json({ success: true, thread_id, aprobado: item.aprobado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/approve-all', async (req, res) => {
  try {
    const { category, action } = req.body;
    const data = cache.read('mail-classifications.json');
    if (!data) return res.status(404).json({ error: 'No classifications found' });
    let count = 0;
    data.items.forEach(i => {
      if (!category || i.category === category) {
        i.aprobado = action !== 'reject';
        count++;
      }
    });
    cache.write('mail-classifications.json', data);
    res.json({ success: true, updated: count });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/set-status', (req, res) => {
  try {
    const { thread_id, estado } = req.body;
    const valid = ['pendiente', 'esperando_cliente', 'esperando_nosotros', 'en_jira', 'archivado'];
    if (!thread_id || !estado) return res.status(400).json({ error: 'thread_id and estado required' });
    if (!valid.includes(estado)) return res.status(400).json({ error: `estado must be one of: ${valid.join(', ')}` });

    const data = cache.read('mail-classifications.json');
    if (!data) return res.status(404).json({ error: 'No classifications found' });
    const item = data.items.find(i => i.thread_id === thread_id);
    if (!item) return res.status(404).json({ error: 'Thread not found' });

    item.estado = estado;

    // Recount by_estado
    const byEstado = { pendiente: 0, esperando_cliente: 0, esperando_nosotros: 0, en_jira: 0, archivado: 0 };
    data.items.forEach(i => { byEstado[i.estado || 'pendiente'] = (byEstado[i.estado || 'pendiente'] || 0) + 1; });
    data.by_estado = byEstado;

    cache.write('mail-classifications.json', data);
    logger.info('Mail status updated', { thread_id, estado, subject: item.subject });
    res.json({ success: true, thread_id, estado });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/report-phishing', async (req, res) => {
  try {
    const { thread_id } = req.body;
    if (!thread_id) return res.status(400).json({ error: 'thread_id required' });

    const data = cache.read('mail-classifications.json');
    if (!data) return res.status(404).json({ error: 'No classifications found' });
    const item = data.items.find(i => i.thread_id === thread_id);
    if (!item) return res.status(404).json({ error: 'Thread not found' });

    // 1. Report to Gmail (marks as SPAM, removes from INBOX — same as "Denunciar phishing")
    const gmail = require('../mcp/gmail');
    await gmail.reportPhishing(thread_id);
    logger.info('Phishing reported to Gmail', { thread_id, from: item.from });

    // 2. Auto-blacklist sender domain in rules.yml so Jarvis catches it from now on
    const rulesPath = path.join(__dirname, '../../config/rules.yml');
    const rules = yaml.load(fs.readFileSync(rulesPath, 'utf8'));
    const domainMatch = item.from?.match(/@([\w.-]+)/);
    let addedDomain = null;
    if (domainMatch) {
      const domain = domainMatch[1].toLowerCase();
      if (!rules.mail.spam_domains.includes(domain)) {
        rules.mail.spam_domains.push(domain);
        fs.writeFileSync(rulesPath, yaml.dump(rules, { lineWidth: 120 }));
        addedDomain = domain;
        logger.info('Domain blacklisted', { domain });
      }
    }

    // 3. Mark as rejected in cache
    item.aprobado = false;
    cache.write('mail-classifications.json', data);

    res.json({
      success: true,
      thread_id,
      reported_to_gmail: true,
      domain_blacklisted: addedDomain,
      message: addedDomain
        ? `Denunciado en Gmail · dominio ${addedDomain} bloqueado en Jarvis`
        : 'Denunciado en Gmail',
    });
  } catch (err) {
    logger.error('Phishing report failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/reclassify', (req, res) => {
  try {
    const { thread_id, category } = req.body;
    if (!thread_id || !category) return res.status(400).json({ error: 'thread_id and category required' });
    const data = cache.read('mail-classifications.json');
    if (!data) return res.status(404).json({ error: 'No classifications found' });
    const item = data.items.find(i => i.thread_id === thread_id);
    if (!item) return res.status(404).json({ error: 'Thread not found' });
    item.category = category;
    item.aprobado = null;  // reset decision
    // Recount
    const counts = {};
    data.items.forEach(i => { counts[i.category] = (counts[i.category] || 0) + 1; });
    data.by_category = counts;
    cache.write('mail-classifications.json', data);
    res.json({ success: true, thread_id, category });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Client threads (deep scan — read + unread, 30-day window) ───────────────

router.get('/mail/client-threads', (req, res) => {
  try {
    const db = require('../db/database');
    const { estado } = req.query;
    if (estado === 'solucionado') {
      const rows = db.getResolvedThreads().map(db.threadToApiFormat);
      return res.json({ items: rows, total: rows.length, estado: 'solucionado' });
    }
    if (estado === 'archivado') {
      const rows = db.getArchivedThreads().map(db.threadToApiFormat);
      return res.json({ items: rows, total: rows.length, estado: 'archivado' });
    }
    const data = db.getClientThreadsSummary();
    return res.json(data);
  } catch (e) {
    // fallback to JSON cache
    const data = cache.read('client-threads.json');
    if (!data) return res.json({ scanned: false, message: 'Ejecuta POST /mail/client-scan primero' });
    res.json(data);
  }
});

// ─── Nuevos / sin catalogar (source_type = unknown) ──────────────────────────
router.get('/mail/uncategorized', (req, res) => {
  try {
    const db    = require('../db/database');
    const sqlDb = db.getDb();
    const rows  = sqlDb.prepare(`
      SELECT * FROM threads
      WHERE source_type = 'unknown'
        AND estado NOT IN ('solucionado','archivado')
        AND (ai_classification IS NULL OR ai_classification != 'spam')
      ORDER BY
        CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 WHEN 'low' THEN 2 ELSE 3 END,
        date DESC
      LIMIT 50
    `).all();
    const items = rows.map(r => ({
      ...db.threadToApiFormat(r),
      source_type:       r.source_type,
      ai_classification: r.ai_classification,
      is_new_contact:    !!r.is_new_contact,
    }));
    res.json({ items, total: items.length, last_universal_scan: db.getLastUniversalScan() });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Last scan status ─────────────────────────────────────────────────────────
router.get('/mail/scan-status', (req, res) => {
  try {
    const db  = require('../db/database');
    const log = db.getLastScanLog('universal');
    res.json({
      last_universal_scan: db.getLastUniversalScan(),
      last_client_scan:    db.getLastScan(),
      last_log:            log,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/client-scan', async (req, res) => {
  try {
    const { days = 30, mode = 'initial' } = req.body;
    const validModes = ['initial', 'incremental', 'refresh_states'];
    if (!validModes.includes(mode)) {
      return res.status(400).json({ error: `mode must be one of: ${validModes.join(', ')}` });
    }
    const mailOps = require('../skills/mail-ops');
    const result = await mailOps.classifyClientThreads({ mode, days });
    res.json(result);
  } catch (err) {
    logger.error('Client scan failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Universal inbox scan ─────────────────────────────────────────────────
router.post('/mail/universal-scan', async (req, res) => {
  try {
    const { timeWindowMinutes = 90 } = req.body || {};
    const mailOps = require('../skills/mail-ops');
    const result  = await mailOps.runUniversalScan({ timeWindowMinutes });
    // Refresh DB summary after scan
    const db = require('../db/database');
    res.json({ ...result, inbox: db.getClientThreadsSummary(result.scan) });
  } catch (err) {
    logger.error('Universal scan failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Silenciar dominio ────────────────────────────────────────────────────
router.post('/mail/silence-domain', (req, res) => {
  try {
    const { domain } = req.body;
    if (!domain) return res.status(400).json({ error: 'domain required' });

    const fs   = require('fs');
    const path = require('path');
    const yaml = require('js-yaml');

    const rulesPath = path.join(__dirname, '../../config/rules.yml');
    const rulesDoc  = yaml.load(fs.readFileSync(rulesPath, 'utf8'));

    if (!rulesDoc.blacklist) rulesDoc.blacklist = { discard_domains: [], discard_subjects: [] };
    if (!rulesDoc.blacklist.discard_domains) rulesDoc.blacklist.discard_domains = [];

    const domainClean = domain.toLowerCase().trim();
    if (!rulesDoc.blacklist.discard_domains.includes(domainClean)) {
      rulesDoc.blacklist.discard_domains.push(domainClean);
      fs.writeFileSync(rulesPath, yaml.dump(rulesDoc, { lineWidth: 120 }), 'utf8');
    }

    // Archive existing threads from this domain
    const db      = require('../db/database');
    const archived = db.archiveThreadsByDomain(domainClean);

    logger.info('Domain silenced', { domain: domainClean, archived });
    res.json({ success: true, domain: domainClean, archived });
  } catch (err) {
    logger.error('Silence domain failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Silenciar patrón de subject ──────────────────────────────────────────
router.post('/mail/silence-pattern', (req, res) => {
  try {
    const { pattern } = req.body;
    if (!pattern) return res.status(400).json({ error: 'pattern required' });

    const fs   = require('fs');
    const path = require('path');
    const yaml = require('js-yaml');

    const rulesPath = path.join(__dirname, '../../config/rules.yml');
    const rulesDoc  = yaml.load(fs.readFileSync(rulesPath, 'utf8'));

    if (!rulesDoc.blacklist) rulesDoc.blacklist = { discard_domains: [], discard_subjects: [] };
    if (!rulesDoc.blacklist.discard_subjects) rulesDoc.blacklist.discard_subjects = [];

    const patternClean = pattern.trim();
    if (!rulesDoc.blacklist.discard_subjects.includes(patternClean)) {
      rulesDoc.blacklist.discard_subjects.push(patternClean);
      fs.writeFileSync(rulesPath, yaml.dump(rulesDoc, { lineWidth: 120 }), 'utf8');
    }

    const db      = require('../db/database');
    const archived = db.archiveThreadsBySubjectPattern(patternClean);

    logger.info('Pattern silenced', { pattern: patternClean, archived });
    res.json({ success: true, pattern: patternClean, archived });
  } catch (err) {
    logger.error('Silence pattern failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Marcar spam ─────────────────────────────────────────────────────────────

router.post('/mail/thread/:threadId/mark-spam', async (req, res) => {
  try {
    const { threadId }            = req.params;
    const { blockDomain = false } = req.body;

    const db    = require('../db/database');
    const sqlDb = db.getDb();

    const thread = sqlDb.prepare('SELECT * FROM threads WHERE thread_id = ?').get(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread no encontrado' });

    // 1. Archive in SQLite
    sqlDb.prepare(`
      UPDATE threads
      SET estado = 'archivado', archived_at = datetime('now'), updated_at = datetime('now')
      WHERE thread_id = ?
    `).run(threadId);

    // 2. Mark pending proposed_actions as executed
    sqlDb.prepare(`
      UPDATE proposed_actions
      SET status = 'executed', resolved_at = datetime('now'), resolved_by = 'spam'
      WHERE thread_id = ? AND status = 'pending'
    `).run(threadId);

    // 3. Gmail spam (best-effort)
    let gmailResult = { success: false };
    try {
      const gmail = require('../mcp/gmail');
      gmailResult = await gmail.markThreadAsSpam(threadId);
    } catch (e) {
      logger.warn('Gmail spam mark failed (non-fatal)', { threadId, error: e.message });
    }

    // 4. Block domain if requested
    let domainBlocked = false;
    let domain        = null;
    if (blockDomain) {
      const email  = thread.last_from_email || thread.from || '';
      const match  = email.match(/@([\w.-]+)/);
      if (match) {
        domain = match[1].toLowerCase();
        const rulesPath = path.join(__dirname, '../../config/rules.yml');
        const rulesDoc  = yaml.load(fs.readFileSync(rulesPath, 'utf8'));
        if (!rulesDoc.mail.spam_domains.includes(domain)) {
          rulesDoc.mail.spam_domains.push(domain);
          fs.writeFileSync(rulesPath, yaml.dump(rulesDoc, { lineWidth: 120 }), 'utf8');
          domainBlocked = true;
          logger.info('Domain blacklisted via spam', { domain });
        }
      }
    }

    // 5. Log action
    db.logAction(threadId, 'marked_spam', { domain, domainBlocked, blockDomain, gmailResult });

    logger.info('Thread marked as spam', { threadId, domain, domainBlocked });
    res.json({ success: true, thread_id: threadId, domainBlocked, domain, gmailResult });
  } catch (err) {
    logger.error('Mark spam failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/client-archive', (req, res) => {
  try {
    const { thread_id, reason = '' } = req.body;
    if (!thread_id) return res.status(400).json({ error: 'thread_id required' });
    const db = require('../db/database');
    const result = db.archiveThread(thread_id, reason);
    if (!result) return res.status(404).json({ error: 'Thread not found' });
    // Regenerate JSON cache asynchronously
    const mailOps = require('../skills/mail-ops');
    mailOps.classifyClientThreads({ mode: 'refresh_states' }).catch(() => {});
    // Gmail sync (best-effort)
    ;(async () => {
      try { await require('../mcp/gmail').archiveGmailThread(thread_id); } catch (_) {}
    })();
    logger.info('Client thread archived', { thread_id });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/client-resolve', (req, res) => {
  try {
    const { thread_id, note = '' } = req.body;
    if (!thread_id) return res.status(400).json({ error: 'thread_id required' });
    const db = require('../db/database');
    const result = db.resolveThread(thread_id, note);
    if (!result) return res.status(404).json({ error: 'Thread not found' });
    const mailOps = require('../skills/mail-ops');
    mailOps.classifyClientThreads({ mode: 'refresh_states' }).catch(() => {});
    // Gmail sync: add Solucionado label, mark read (best-effort)
    ;(async () => {
      try {
        const gmail = require('../mcp/gmail');
        await gmail.modifyThread(thread_id, ['Jarvis/Solucionado'], ['Jarvis/Acción Requerida'], true);
      } catch (_) {}
    })();
    logger.info('Client thread resolved', { thread_id, resolution_hours: result.resolution_time_hours });
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/mail/metrics', (req, res) => {
  try {
    const db = require('../db/database');
    res.json(db.getResolutionMetrics());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/mail/thread/:threadId/messages', async (req, res) => {
  try {
    const { threadId } = req.params;
    const db = require('../db/database');

    const fs = require('fs');
    const path = require('path');
    const yaml = require('js-yaml');
    const rules = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));
    const teamDomains = (rules.team?.domains || []).map(d => d.toLowerCase());
    const ceoEmails   = (rules.team?.ceo_emails || []).map(e => e.toLowerCase());

    const cached = db.getThreadMessages(threadId);
    // Stale cache: has messages but missing to_recipients (old format before Fix 1)
    const isStale = cached.length > 0 && cached.every(m => !m.to_recipients && !m.cc_recipients);

    if (cached.length === 0 || isStale) {
      const gmail = require('../mcp/gmail');
      const thread = await gmail.getFullThread(threadId);
      if (!thread) return res.status(404).json({ error: 'Thread not found in Gmail' });

      for (const msg of thread.messages) {
        const senderEmail  = (msg.from_email || '').toLowerCase();
        const senderDomain = senderEmail.split('@')[1] || '';
        const isCeo        = ceoEmails.includes(senderEmail);
        const isTeam       = teamDomains.some(d => senderDomain === d);

        db.saveMessage({
          message_id:    msg.id,
          thread_id:     threadId,
          sender:        msg.from,
          sender_email:  senderEmail,
          date:          msg.date,
          body_text:     msg.body_text,
          body_html:     msg.body_html || '',
          is_from_me:    isCeo,
          is_from_team:  isTeam,
          to_recipients: msg.to   || '',
          cc_recipients: msg.cc   || '',
          reply_to:      msg.reply_to || '',
        });
      }
    }

    // Enrich with contact names
    const raw = db.getThreadMessages(threadId);
    const messages = raw.map(msg => {
      const contact = db.getContact(msg.sender_email);
      // sender_display_name: prefer saved contact name, else parse the raw From header
      const parsedName = msg.sender?.replace(/<.*>/, '').replace(/"/g, '').trim() || '';
      const nameIsEmail = !parsedName || parsedName.toLowerCase() === (msg.sender_email || '').toLowerCase() || parsedName.includes('@');
      return {
        ...msg,
        is_from_me:   !!msg.is_from_me,
        is_from_team: !!msg.is_from_team,
        sender_display_name: contact?.name || (nameIsEmail ? null : parsedName),
        contact_role:        contact?.role || null,
      };
    });

    res.json({ thread_id: threadId, messages });
  } catch (err) {
    logger.error('Thread messages fetch failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/thread/:threadId/suggest-reply', async (req, res) => {
  try {
    const { threadId } = req.params;
    const db = require('../db/database');
    const messages = db.getThreadMessages(threadId);
    if (!messages.length) return res.status(400).json({ error: 'No messages loaded yet — call GET /messages first' });

    if (!process.env.ANTHROPIC_API_KEY) {
      return res.status(400).json({ error: 'ANTHROPIC_API_KEY not set' });
    }

    const thread = db.getDb().prepare('SELECT * FROM threads WHERE thread_id = ?').get(threadId);
    const conversation = messages.slice(-6).map(m =>
      `[${m.is_from_me ? 'Yo' : m.sender}] ${(m.body_text || '').substring(0, 500)}`
    ).join('\n\n');

    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const msg = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 400,
      messages: [{
        role: 'user',
        content: `Eres Alejandro, CEO de ClickRepuestos / WebySEO.
Redacta una respuesta profesional y concisa (máx 3 párrafos) para este hilo de email con cliente.

Asunto: ${thread?.subject || ''}
Cliente: ${thread?.client_name || ''}

Conversación reciente:
${conversation}

Responde SOLO con el cuerpo del email, sin asunto ni firma.`,
      }],
    });

    const draft = msg.content[0].text.trim();
    const saved = db.saveDraft(threadId, draft, 'reply', true);
    res.json({ draft, draft_id: saved.id });
  } catch (err) {
    logger.error('Suggest reply failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/thread/:threadId/reply', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { body, to, cc, subject, reply_mode } = req.body;
    if (!body) return res.status(400).json({ error: 'body required' });

    const gmail = require('../mcp/gmail');
    const db    = require('../db/database');

    const thread = db.getDb().prepare('SELECT * FROM threads WHERE thread_id = ?').get(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    const toEmail  = to || thread.last_from_email || '';
    const ccEmails = cc || '';
    const replySubject = subject || `Re: ${thread.subject || ''}`;

    await gmail.sendReply(toEmail, replySubject, body, threadId, ccEmails);

    db.getDb().prepare(`
      UPDATE threads SET
        last_sender_is_me = 1, last_sender_is_team = 1,
        estado = 'esperando_cliente', severity = 'low',
        updated_at = datetime('now')
      WHERE thread_id = ?
    `).run(threadId);

    db.logAction(threadId, reply_mode === 'reply_all' ? 'replied_all' : 'replied', { to: toEmail, cc: ccEmails });

    const lastDraftId = db.getLastDraftId(threadId);
    if (lastDraftId) db.markDraftSent(lastDraftId);

    res.json({ success: true, thread_id: threadId, to: toEmail, cc: ccEmails });
  } catch (err) {
    logger.error('Reply send failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/apply-labels', async (req, res) => {
  try {
    const mailOps = require('../skills/mail-ops');
    const classifications = cache.read('mail-classifications.json');
    if (!classifications) return res.status(400).json({ error: 'Run /mail/classify first' });
    const result = await mailOps.applyLabels(classifications);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/commitments', (req, res) => {
  const commitmentTracker = require('../skills/commitment-tracker');
  const { open, overdue } = commitmentTracker.getOpen();
  res.json({ open, overdue, open_count: open.length, overdue_count: overdue.length });
});

router.post('/commitments/scan', async (req, res) => {
  try {
    const { days = 7 } = req.body;
    const commitmentTracker = require('../skills/commitment-tracker');
    const result = await commitmentTracker.scanSentEmails(days);
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/commitments/:id/resolve', (req, res) => {
  const commitmentTracker = require('../skills/commitment-tracker');
  const result = commitmentTracker.markResolved(req.params.id, req.body.note || '');
  if (result.error) return res.status(404).json(result);
  res.json(result);
});

router.get('/clients/pulse', (req, res) => {
  const clientPulse = require('../skills/client-pulse');
  const data = clientPulse.getPulse();
  if (!data) return res.status(404).json({ error: 'No pulse data — run POST /clients/pulse/refresh' });
  res.json(data);
});

router.post('/clients/pulse/refresh', async (req, res) => {
  try {
    const clientPulse = require('../skills/client-pulse');
    const result = await clientPulse.calculatePulse();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/task-bridge/email-to-jira', async (req, res) => {
  try {
    const { thread_id, project, priority, due_date } = req.body;
    if (!thread_id) return res.status(400).json({ error: 'thread_id required' });
    const taskBridge = require('../skills/task-bridge');
    const result = await taskBridge.emailToJira(thread_id, { project, priority, dueDate: due_date });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/task-bridge/jira-to-calendar', async (req, res) => {
  try {
    const { issue_key, start_hour, end_hour } = req.body;
    if (!issue_key) return res.status(400).json({ error: 'issue_key required' });
    const taskBridge = require('../skills/task-bridge');
    const result = await taskBridge.jiraToCalendar(issue_key, { startHour: start_hour, endHour: end_hour });
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/task-bridge/sync-jira', async (req, res) => {
  try {
    const taskBridge = require('../skills/task-bridge');
    const result = await taskBridge.syncJiraTasks();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Feedback loop ───────────────────────────────────────────────────────────

router.post('/mail/thread/:threadId/feedback', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { correct_category, correct_estado, explanation } = req.body;
    if (!correct_category || !explanation) {
      return res.status(400).json({ error: 'correct_category and explanation required' });
    }

    const db = require('../db/database');
    const thread = db.getDb().prepare('SELECT * FROM threads WHERE thread_id = ?').get(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread not found' });

    // 1. Save feedback record
    const feedbackResult = db.saveFeedback({
      thread_id:         threadId,
      original_category: thread.category,
      original_estado:   thread.estado,
      original_severity: thread.severity,
      correct_category,
      correct_estado:    correct_estado || 'informativo',
      correct_severity:  correct_estado === 'informativo' ? 'none' : (thread.severity || 'low'),
      ceo_explanation:   explanation,
    });

    // 2. Extract rule with Claude Haiku
    let ruleData = null;
    if (process.env.ANTHROPIC_API_KEY) {
      try {
        const { default: Anthropic } = await import('@anthropic-ai/sdk');
        const ai = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
        const response = await ai.messages.create({
          model: 'claude-haiku-4-5-20251001',
          max_tokens: 300,
          messages: [{
            role: 'user',
            content: `Eres un sistema de aprendizaje para un clasificador de correos empresariales.
El CEO corrigió una clasificación errónea. Extrae UNA regla generalizable.

CORREO:
- Asunto: "${thread.subject}"
- Remitente: "${thread.last_from}"
- Cliente: "${thread.client_name || 'N/A'}"
- Jarvis clasificó como: ${thread.category} / ${thread.estado}
- Debería ser: ${correct_category} / ${correct_estado || 'informativo'}
- Explicación del CEO: "${explanation}"

Responde SOLO con JSON (sin markdown, sin backticks):
{
  "pattern_type": "subject",
  "pattern_value": "texto clave genérico a buscar en el asunto",
  "explanation_for_ceo": "Explicación en español en primera persona (soy Jarvis) de qué entendí y qué haré. Máx 2 oraciones.",
  "confidence": "high"
}

Reglas para el pattern_value: debe ser genérico (ej: "Factura N°" no "Factura N°375").
pattern_type puede ser "subject", "from", o "subject+from".`,
          }],
        });
        const raw = response.content[0].text.replace(/```json|```/g, '').trim();
        ruleData = JSON.parse(raw);
      } catch (e) {
        logger.debug('Rule extraction fallback', { error: e.message });
      }
    }

    if (!ruleData) {
      ruleData = {
        pattern_type:        'subject',
        pattern_value:       (thread.subject || '').substring(0, 30),
        explanation_for_ceo: `Entendí que correos con "${(thread.subject || '').substring(0, 30)}" deben clasificarse como ${correct_category}.`,
        confidence:          'low',
      };
    }

    // 3. Apply correction to THIS thread immediately
    const newSeverity = correct_estado === 'informativo' ? 'none' : (thread.severity || 'low');
    db.getDb().prepare(`
      UPDATE threads SET category = ?, estado = ?, severity = ?, is_informativo = ?, updated_at = datetime('now')
      WHERE thread_id = ?
    `).run(correct_category, correct_estado || 'informativo', newSeverity,
           correct_estado === 'informativo' ? 1 : 0, threadId);

    // 4. Find other threads that would match (but DON'T apply yet)
    const allActive = db.getActiveThreads();
    const wouldMatch = allActive
      .filter(t => t.thread_id !== threadId
               && !['solucionado','archivado','en_jira'].includes(t.estado)
               && t.subject?.toLowerCase().includes(ruleData.pattern_value.toLowerCase()))
      .map(t => ({
        thread_id:     t.thread_id,
        subject:       t.subject,
        client_name:   t.client_name,
        current_estado: t.estado,
      }));

    db.logAction(threadId, 'feedback_proposed', { correct_category, correct_estado, rule: ruleData.pattern_value });
    logger.info('Feedback proposed', { threadId, rule: ruleData.pattern_value, wouldAffect: wouldMatch.length });

    res.json({
      success:              true,
      feedback_id:          feedbackResult.id,
      current_thread_fixed: true,
      proposed_rule: {
        pattern_type:        ruleData.pattern_type,
        pattern_value:       ruleData.pattern_value,
        correct_category,
        correct_estado:      correct_estado || 'informativo',
        explanation_for_ceo: ruleData.explanation_for_ceo,
        confidence:          ruleData.confidence,
      },
      would_affect:       wouldMatch,
      would_affect_count: wouldMatch.length,
      needs_confirmation:  true,
    });
  } catch (err) {
    logger.error('Feedback failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/feedback/confirm', (req, res) => {
  try {
    const { feedback_id, proposed_rule, apply_to_existing } = req.body;
    if (!feedback_id || !proposed_rule) {
      return res.status(400).json({ error: 'feedback_id and proposed_rule required' });
    }

    const db = require('../db/database');

    // 1. Save learned rule
    const ruleResult = db.saveLearnedRule({
      pattern_type:       proposed_rule.pattern_type,
      pattern_value:      proposed_rule.pattern_value,
      correct_category:   proposed_rule.correct_category,
      correct_estado:     proposed_rule.correct_estado,
      correct_severity:   proposed_rule.correct_estado === 'informativo' ? 'none' : 'low',
      source_feedback_id: feedback_id,
    });

    // 2. Retroactively apply if confirmed
    let reclassified = 0;
    if (apply_to_existing) {
      const allActive = db.getActiveThreads();
      const newSev = proposed_rule.correct_estado === 'informativo' ? 'none' : 'low';
      const isInfo = proposed_rule.correct_estado === 'informativo' ? 1 : 0;
      const stmt = db.getDb().prepare(`
        UPDATE threads SET
          category = ?, estado = ?, severity = ?, is_informativo = ?, updated_at = datetime('now')
        WHERE thread_id = ? AND estado NOT IN ('solucionado','archivado','en_jira')
      `);
      for (const t of allActive) {
        if (t.subject?.toLowerCase().includes(proposed_rule.pattern_value.toLowerCase())) {
          stmt.run(proposed_rule.correct_category, proposed_rule.correct_estado, newSev, isInfo, t.thread_id);
          reclassified++;
        }
      }
    }

    // Log against the source thread (fetch thread_id from feedback row)
    try {
      const fbRow = db.getDb().prepare('SELECT thread_id FROM feedback WHERE id = ?').get(feedback_id);
      if (fbRow?.thread_id) {
        db.logAction(fbRow.thread_id, 'rule_confirmed', {
          rule_id:    ruleResult.id,
          pattern:    proposed_rule.pattern_value,
          reclassified,
        });
      }
    } catch { /* non-fatal */ }
    logger.info('Rule confirmed', { ruleId: ruleResult.id, pattern: proposed_rule.pattern_value, reclassified });

    res.json({
      success:           true,
      rule_id:           ruleResult.id,
      reclassified_count: reclassified,
      message: reclassified > 0
        ? `Regla guardada. ${reclassified} correo(s) reclasificado(s).`
        : 'Regla guardada. Se aplicará a correos futuros.',
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/mail/learned-rules', (req, res) => {
  try {
    const db     = require('../db/database');
    const yaml   = require('js-yaml');
    const fs     = require('fs');
    const rulesPath = require('path').join(__dirname, '../../config/rules.yml');
    const rules  = yaml.load(fs.readFileSync(rulesPath, 'utf8'));
    const sm     = rules.state_machine || {};

    const learnedRules = db.getAllLearnedRules();
    const feedback     = db.getFeedbackHistory(50);
    const totalMatches = learnedRules.reduce((s, r) => s + (r.match_count || 0), 0);

    res.json({
      rules: learnedRules,
      no_action_patterns: rules.mail?.no_action_patterns || [],
      auto_rules: {
        informativo_auto_archive_days:             sm.informativo_auto_archive_days || 7,
        invoice_days_without_response_to_pending:  sm.invoice_rules?.days_without_response_to_pending || 15,
        waiting_escalation_days:                   sm.waiting_escalation_days || 14,
      },
      feedback_history: feedback,
      stats: {
        total_rules:    learnedRules.length,
        total_matches:  totalMatches,
        total_feedback: feedback.length,
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Auditoría de reglas ─────────────────────────────────────────────────────
router.get('/mail/audit-rules', (req, res) => {
  try {
    const { runAudit } = require('../skills/rule-auditor');
    res.json(runAudit());
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Rules-full: todas las reglas del sistema consolidadas ──────────────────
router.get('/mail/rules-full', (req, res) => {
  try {
    const db   = require('../db/database');
    const yaml = require('js-yaml');
    const fs   = require('fs');
    const p    = require('path');

    const rules    = yaml.load(fs.readFileSync(p.join(__dirname, '../../config/rules.yml'), 'utf8'));
    const providers = (() => {
      try { return yaml.load(fs.readFileSync(p.join(__dirname, '../../config/providers.yml'), 'utf8')); }
      catch { return { providers: [] }; }
    })();
    const sm = rules.state_machine || {};

    // Learned rules enriched with feedback/thread origin
    const rawRules = db.getDb().prepare(`
      SELECT lr.*,
             f.ceo_explanation, f.thread_id as fb_thread_id,
             t.subject as fb_subject, t.last_from as fb_from, t.date as fb_date
      FROM learned_rules lr
      LEFT JOIN feedback f ON f.id = lr.source_feedback_id
      LEFT JOIN threads  t ON t.thread_id = f.thread_id
      ORDER BY lr.id ASC
    `).all();

    const learned_rules = rawRules.map(r => ({
      id:           r.id,
      pattern:      r.pattern_value,
      match_type:   r.pattern_type,
      action:       r.correct_estado,
      category:     r.correct_category,
      active:       !!r.active,
      times_applied: r.match_count || 0,
      created_at:   r.created_at,
      origin:       r.ceo_explanation
        ? `Feedback: "${r.ceo_explanation.substring(0, 80)}${r.ceo_explanation.length > 80 ? '…' : ''}"`
        : null,
      example_thread: r.fb_subject ? {
        thread_id: r.fb_thread_id,
        subject:   r.fb_subject,
        from:      r.fb_from,
        date:      r.fb_date,
      } : null,
    }));

    res.json({
      learned_rules,
      config_rules: {
        no_action_patterns: {
          description: 'Correos que se clasifican como informativos automáticamente',
          patterns: rules.mail?.no_action_patterns || [],
        },
        exclude_patterns: {
          description: 'Correos descartados sin guardar en el dashboard',
          patterns: rules.mail?.exclude_patterns || [],
        },
        spam_domains: {
          description: 'Dominios bloqueados — correos descartados',
          domains: rules.mail?.spam_domains || [],
        },
        blacklist: {
          discard_domains:  rules.blacklist?.discard_domains  || [],
          discard_subjects: rules.blacklist?.discard_subjects || [],
        },
        priority_keywords: {
          description: 'Keywords que marcan un correo como urgente',
          keywords: rules.mail?.priority_keywords || [],
        },
        providers: {
          description: 'Proveedores conocidos con alertas configuradas',
          items: providers.providers || [],
        },
      },
      state_machine_rules: {
        informativo_auto_archive_days: sm.informativo_auto_archive_days || 7,
        invoice_days_without_response_to_pending: sm.invoice_rules?.days_without_response_to_pending || 15,
        waiting_escalation_days: sm.waiting_escalation_days || 14,
        auto_resolve_keywords: sm.invoice_rules?.auto_resolve_keywords || [],
      },
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Gestión de reglas aprendidas ────────────────────────────────────────────

router.put('/mail/learned-rules/:id', (req, res) => {
  try {
    const { id } = req.params;
    const { active, pattern, match_type, action, category } = req.body;
    const db = require('../db/database');
    const numId = Number(id);

    if (active !== undefined && Object.keys(req.body).length === 1) {
      // Toggle-only update (legacy behaviour from RulesPanel toggle)
      db.getDb().prepare('UPDATE learned_rules SET active = ? WHERE id = ?').run(active ? 1 : 0, numId);
      return res.json({ success: true, id: numId, active: !!active });
    }

    // Full edit
    const fields = [];
    const values = [];
    if (pattern    !== undefined) { fields.push('pattern_value = ?');     values.push(pattern); }
    if (match_type !== undefined) { fields.push('pattern_type = ?');      values.push(match_type); }
    if (action     !== undefined) { fields.push('correct_estado = ?');    values.push(action); }
    if (category   !== undefined) { fields.push('correct_category = ?');  values.push(category); }
    if (active     !== undefined) { fields.push('active = ?');            values.push(active ? 1 : 0); }
    if (fields.length === 0) return res.status(400).json({ error: 'Nothing to update' });

    values.push(numId);
    db.getDb().prepare(`UPDATE learned_rules SET ${fields.join(', ')} WHERE id = ?`).run(...values);
    const updated = db.getDb().prepare('SELECT * FROM learned_rules WHERE id = ?').get(numId);
    res.json({ success: true, rule: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.delete('/mail/learned-rules/:id', (req, res) => {
  try {
    const { id } = req.params;
    const db = require('../db/database');
    const numId = Number(id);
    const existing = db.getDb().prepare('SELECT id, match_count FROM learned_rules WHERE id = ?').get(numId);
    if (!existing) return res.status(404).json({ error: 'Regla no encontrada' });
    db.getDb().prepare('DELETE FROM learned_rules WHERE id = ?').run(numId);
    logger.info('Learned rule deleted', { id: numId });
    res.json({ success: true, id: numId, was_applied: existing.match_count || 0 });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/learned-rules/deduplicate', (req, res) => {
  try {
    const db    = require('../db/database');
    const sqlDb = db.getDb();
    const all   = sqlDb.prepare('SELECT * FROM learned_rules ORDER BY id ASC').all();

    // Group by lowercase pattern_value
    const groups = {};
    for (const rule of all) {
      const key = rule.pattern_value.toLowerCase().trim();
      if (!groups[key]) groups[key] = [];
      groups[key].push(rule);
    }

    let deleted = 0;
    for (const [, group] of Object.entries(groups)) {
      if (group.length <= 1) continue;
      const [keep, ...dupes] = group; // keep oldest (lowest id)
      const totalMatches = group.reduce((s, r) => s + (r.match_count || 0), 0);
      sqlDb.prepare('UPDATE learned_rules SET match_count = ? WHERE id = ?').run(totalMatches, keep.id);
      for (const dupe of dupes) {
        sqlDb.prepare('DELETE FROM learned_rules WHERE id = ?').run(dupe.id);
        deleted++;
      }
    }

    logger.info('Learned rules deduplicated', { deleted });
    res.json({ success: true, deleted, message: `${deleted} regla${deleted !== 1 ? 's' : ''} duplicada${deleted !== 1 ? 's' : ''} eliminada${deleted !== 1 ? 's' : ''}.` });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── ¿Por qué está clasificado así? ─────────────────────────────────────────

router.get('/mail/thread/:threadId/why', (req, res) => {
  try {
    const { threadId } = req.params;
    const db     = require('../db/database');
    const thread = db.getDb().prepare('SELECT * FROM threads WHERE thread_id = ?').get(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread no encontrado' });

    let steps = [];
    let pipelineLabel = 'desconocido';
    let pipelineTs    = null;

    if (thread.classification_reason) {
      try {
        const parsed = JSON.parse(thread.classification_reason);
        steps        = parsed.steps || [];
        pipelineLabel = parsed.pipeline === 'universal_scan' ? 'Universal scan' : 'Client scan';
        pipelineTs    = parsed.timestamp;
      } catch { /* malformed JSON */ }
    }

    // Human-readable explanation
    const sourceStep   = steps.find(s => s.step === 'source_type' || s.step === 'client_match');
    const estadoStep   = steps.find(s => s.step === 'estado_calc');
    const severityStep = steps.find(s => s.step === 'severity_calc');
    const learnedStep  = steps.find(s => s.step === 'learned_rule' && s.matched);
    const noActionStep = steps.find(s => s.step === 'no_action_pattern' && s.matched);
    const provAlertStep = steps.find(s => s.step === 'provider_alert');

    let explanation = '';
    if (learnedStep) {
      explanation = `Una regla aprendida coincidió (patrón "${learnedStep.pattern}") y forzó el estado "${thread.estado}".`;
    } else if (noActionStep) {
      explanation = `El asunto coincide con un patrón de "sin acción requerida", por lo que se clasificó como informativo.`;
    } else if (sourceStep?.result === 'client' || sourceStep?.step === 'client_match') {
      const clientName = sourceStep.client || thread.client_name || 'cliente';
      explanation = `Este correo es de un cliente conocido (${clientName}).` +
        (estadoStep?.reason ? ` ${estadoStep.reason.charAt(0).toUpperCase() + estadoStep.reason.slice(1)}.` : '') +
        (severityStep?.reason ? ` Severity ${thread.severity}: ${severityStep.reason}.` : '');
    } else if (sourceStep?.result === 'provider') {
      explanation = `Remitente identificado como proveedor (${sourceStep.detail || thread.client_name}).` +
        (provAlertStep?.matched ? ` Alerta detectada por keyword "${provAlertStep.keyword}".` : ' Sin alertas activas → informativo.');
    } else if (sourceStep?.result === 'internal') {
      explanation = `Dominio del equipo interno → clasificado como informativo.`;
    } else if (thread.ai_classification) {
      explanation = `Dominio desconocido. La IA lo clasificó como "${thread.ai_classification}".`;
    } else {
      explanation = `Clasificación automática basada en estado y antigüedad del hilo.`;
    }

    res.json({
      thread_id:       threadId,
      subject:         thread.subject,
      current_estado:  thread.estado,
      current_severity: thread.severity,
      pipeline:        pipelineLabel,
      pipeline_ts:     pipelineTs,
      explanation,
      steps,
      has_reason:      !!thread.classification_reason,
    });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Investigar correo ausente ───────────────────────────────────────────────

router.post('/mail/investigate', async (req, res) => {
  try {
    const { search_query, from_email, subject_fragment } = req.body;
    if (!search_query && !from_email && !subject_fragment) {
      return res.status(400).json({ error: 'Provide search_query, from_email, or subject_fragment' });
    }

    const gmail = require('../mcp/gmail');
    const db    = require('../db/database');
    const yaml  = require('js-yaml');
    const fs    = require('fs');
    const rules = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));
    const clientsConfig = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/clients.yml'), 'utf8'));

    let query = search_query || '';
    if (from_email)       query = `from:${from_email} ${query}`.trim();
    if (subject_fragment) query = `subject:(${subject_fragment}) ${query}`.trim();
    query += ' newer_than:30d';

    const threads = await gmail.searchThreads(query, 10);

    if (!threads.length) {
      return res.json({
        found: false,
        message: 'No se encontraron correos con esos criterios en los últimos 30 días.',
        suggestions: [
          'Verifica el email del remitente',
          'Intenta con menos palabras en la búsqueda',
          'El correo podría estar en una cuenta diferente',
        ],
      });
    }

    const sqlDb = db.getDb();
    const analysis = threads.map(t => {
      const reasons = [];
      const inDb = sqlDb.prepare('SELECT estado FROM threads WHERE thread_id = ?').get(t.id);

      reasons.push({
        check: 'En base de datos',
        result: inDb ? `Sí — estado: ${inDb.estado}` : 'No — nunca fue escaneado',
        is_issue: !inDb,
      });

      const fromEmail  = (t.from?.match(/[a-zA-Z0-9._%+-]+@[\w.-]+/) || [''])[0].toLowerCase();
      const fromDomain = fromEmail.split('@')[1] || '';
      let clientMatch = null;
      for (const c of clientsConfig.clients) {
        if (c.domains.some(d => fromDomain === d || fromDomain.endsWith('.' + d))
          || c.contacts?.some(e => e.toLowerCase() === fromEmail)) {
          clientMatch = c.name; break;
        }
      }
      // Also check participants
      if (!clientMatch) {
        for (const email of (t.participants || [])) {
          const d = email.split('@')[1] || '';
          for (const c of clientsConfig.clients) {
            if (c.domains.some(cd => d === cd || d.endsWith('.' + cd))) { clientMatch = c.name; break; }
          }
          if (clientMatch) break;
        }
      }

      reasons.push({
        check: 'Match con clients.yml',
        result: clientMatch ? `Sí — ${clientMatch}` : `No — dominio "${fromDomain}" no registrado`,
        is_issue: !clientMatch,
      });

      const excluded = (rules.mail?.exclude_patterns || []).some(p =>
        t.subject?.toLowerCase().includes(p.toLowerCase()));
      if (excluded) reasons.push({ check: 'Excluido por regla', result: 'Sí — matchea exclude_patterns', is_issue: true });

      const isSpam = (rules.mail?.spam_domains || []).some(d => fromDomain.includes(d));
      if (isSpam) reasons.push({ check: 'Dominio en spam_domains', result: 'Bloqueado como spam', is_issue: true });

      const noAction = (rules.mail?.no_action_patterns || []).some(p =>
        t.subject?.toLowerCase().includes(p.toLowerCase()));
      if (noAction) reasons.push({ check: 'Patrón no-action', result: 'Clasificado como informativo (sin acción requerida)', is_issue: false });

      return {
        thread_id:    t.id,
        subject:      t.subject,
        from:         t.from,
        date:         t.date,
        message_count: t.message_count,
        in_dashboard: !!inDb && !['archivado','solucionado'].includes(inDb?.estado),
        client_match: clientMatch,
        current_estado: inDb?.estado || null,
        analysis:     reasons,
        action_needed: reasons.some(r => r.is_issue),
        gmail_link:   `https://mail.google.com/mail/u/0/#inbox/${t.id}`,
      };
    });

    res.json({
      found:   true,
      total:   analysis.length,
      threads: analysis,
      message: analysis.some(a => a.action_needed)
        ? 'Se encontraron correos con problemas de clasificación'
        : 'Todos los correos encontrados están clasificados correctamente',
    });
  } catch (err) {
    logger.error('Investigation failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/investigate/add', async (req, res) => {
  try {
    const { thread_id } = req.body;
    if (!thread_id) return res.status(400).json({ error: 'thread_id required' });

    // Re-run a single-thread scan by forcing a fresh classifyClientThreads pass
    // We do this by temporarily clearing the hash so the thread is re-processed
    const db = require('../db/database');
    db.getDb().prepare(`UPDATE threads SET content_hash = '' WHERE thread_id = ?`).run(thread_id);

    const mailOps = require('../skills/mail-ops');
    await mailOps.classifyClientThreads({ mode: 'incremental', days: 30 });

    const thread = db.getDb().prepare('SELECT * FROM threads WHERE thread_id = ?').get(thread_id);
    if (!thread) return res.status(404).json({ error: 'Thread not found after rescan — domain may not be in clients.yml' });

    db.logAction(thread_id, 'manually_added', { source: 'investigation' });
    res.json({ success: true, thread_id, estado: thread.estado, message: 'Thread re-escaneado y agregado al dashboard' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── State machine ───────────────────────────────────────────────────────────

router.post('/mail/thread/:threadId/transition', (req, res) => {
  try {
    const { threadId } = req.params;
    const { estado, note } = req.body;
    if (!estado) return res.status(400).json({ error: 'estado required' });
    const sm = require('../skills/state-machine');
    const result = sm.transition(threadId, estado, note || '');
    if (result.error) return res.status(400).json(result);
    // Gmail sync (fire-and-forget)
    ;(async () => {
      try {
        const gmail = require('../mcp/gmail');
        if (estado === 'solucionado') {
          await gmail.modifyThread(threadId, ['Jarvis/Solucionado'], ['Jarvis/Acción Requerida'], true);
        } else if (estado === 'archivado') {
          await gmail.archiveGmailThread(threadId);
        } else if (estado === 'requiere_mi_accion' || estado === 'esperando_nosotros') {
          await gmail.modifyThread(threadId, ['Jarvis/Acción Requerida'], ['Jarvis/Solucionado'], false);
        }
      } catch (_) {}
    })();
    res.json(result);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/auto-rules', async (req, res) => {
  try {
    const sm = require('../skills/state-machine');
    const result = await sm.runAutoRules();
    res.json({ success: true, ...result });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── AI Summary ──────────────────────────────────────────────────────────────

router.post('/mail/thread/:threadId/summary', async (req, res) => {
  try {
    const { threadId } = req.params;
    const { generateSummaryForThread } = require('../skills/mail-ops');
    const summary = await generateSummaryForThread(threadId);
    if (!summary) return res.status(404).json({ error: 'Could not generate summary' });

    const db = require('../db/database');
    const cached = db.getThreadSummary(threadId);
    res.json({ source: cached === summary ? 'cache' : 'generated', summary });
  } catch (err) {
    logger.error('Summary endpoint failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/mail/generate-summaries', async (req, res) => {
  try {
    const { limit = 10 } = req.body;
    const db = require('../db/database');
    const { generateSummaryForThread } = require('../skills/mail-ops');

    const pending = db.getDb().prepare(`
      SELECT thread_id, subject, client_name FROM threads
      WHERE ai_summary IS NULL AND estado NOT IN ('archivado')
      ORDER BY CASE severity WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END, date DESC
      LIMIT ?
    `).all(limit);

    let generated = 0;
    let failed    = 0;
    for (const t of pending) {
      try {
        const s = await generateSummaryForThread(t.thread_id);
        if (s) generated++;
        else    failed++;
      } catch {
        failed++;
      }
      // Throttle: 300ms between calls
      await new Promise(r => setTimeout(r, 300));
    }

    res.json({
      success:       true,
      total_pending: pending.length,
      generated,
      failed,
      message:       `${generated} resúmenes generados, ${failed} fallidos.`,
    });
  } catch (err) {
    logger.error('Batch summaries failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

// ─── Contactos ───────────────────────────────────────────────────────────────

router.get('/contacts', (req, res) => {
  try {
    const db = require('../db/database');
    const { client } = req.query;
    const contacts = client ? db.getContactsByClient(client) : db.getAllContacts();
    res.json({ contacts });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Agent brain helpers ──────────────────────────────────────────────────────

function buildTicketSummary(thread) {
  let s = thread.subject || '';

  // Strip leading domain/label brackets: "[toprental.cl]", "[CLICK]"
  s = s.replace(/^\[.*?\]\s*/g, '').trim();

  // Strip reply/forward prefixes
  s = s.replace(/^(Re|Fwd|FW|RE|AW):\s*/i, '').trim();

  // Strip inline domain references in parentheses: (toprental.cl)
  s = s.replace(/\s*\([a-zA-Z0-9.-]+\.[a-zA-Z]{2,}\)/g, '').trim();

  // Strip trailing period
  s = s.replace(/\.$/, '').trim();

  // Prefix with client name if it's not already in the subject
  const client = thread.client_name;
  if (client && !s.toLowerCase().includes(client.toLowerCase())) {
    s = `[${client}] ${s}`;
  }

  return s.length > 255 ? s.substring(0, 252) + '...' : s;
}

// ─── Agent brain ─────────────────────────────────────────────────────────────

router.post('/mail/thread/:threadId/analyze', async (req, res) => {
  try {
    const { threadId } = req.params;
    const force = req.body?.force === true;
    const { analyzeThread } = require('../skills/agent-brain');

    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('Análisis superó el tiempo límite de 30 segundos')), 30000)
    );
    const result = await Promise.race([analyzeThread(threadId, { force }), timeoutPromise]);
    res.json({ success: true, ...result });
  } catch (err) {
    logger.error('Thread analysis failed', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.get('/mail/thread/:threadId/analysis', (req, res) => {
  try {
    const { threadId } = req.params;
    const db    = require('../db/database');
    const sqlDb = db.getDb();

    const thread = sqlDb.prepare('SELECT ai_analysis, ai_analysis_at FROM threads WHERE thread_id = ?').get(threadId);
    if (!thread) return res.status(404).json({ error: 'Thread no encontrado' });

    const analysis = thread.ai_analysis ? JSON.parse(thread.ai_analysis) : null;
    const actions  = sqlDb.prepare(
      'SELECT * FROM proposed_actions WHERE thread_id = ? AND status != ? ORDER BY created_at DESC'
    ).all(threadId, 'superseded');

    res.json({ analysis, analyzed_at: thread.ai_analysis_at, actions });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agent/pending-actions', (req, res) => {
  try {
    const db    = require('../db/database');
    const sqlDb = db.getDb();
    const rows  = sqlDb.prepare(`
      SELECT pa.*, t.subject, t.client_name, t.estado, t.severity
      FROM proposed_actions pa
      JOIN threads t ON pa.thread_id = t.thread_id
      WHERE pa.status = 'pending'
      ORDER BY pa.created_at DESC
    `).all();
    res.json({ actions: rows, total: rows.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.post('/agent/action/:actionId/prepare-ticket', async (req, res) => {
  try {
    const { actionId } = req.params;
    const db    = require('../db/database');
    const jira  = require('../mcp/jira');
    const sqlDb = db.getDb();

    const action = sqlDb.prepare('SELECT * FROM proposed_actions WHERE id = ?').get(Number(actionId));
    if (!action) return res.status(404).json({ error: 'Acción no encontrada' });

    const thread = sqlDb.prepare('SELECT * FROM threads WHERE thread_id = ?').get(action.thread_id);
    if (!thread) return res.status(404).json({ error: 'Thread no encontrado' });

    const { resolveAssignee, getProjectForClient, extractKeywords } = require('../skills/agent-brain');

    // Resolve assignee
    const assigneeMember = resolveAssignee(action.assignee);

    // Determine project
    const projectKey = getProjectForClient(thread.client_name);
    const projects   = await jira.getAvailableProjects();
    const project    = projects.find(p => p.key === projectKey) || projects[0];

    // Load ai_analysis resumen for structured description
    let analysisResumen = '';
    try {
      const parsed = thread.ai_analysis ? JSON.parse(thread.ai_analysis) : null;
      analysisResumen = parsed?.resumen || '';
    } catch { /* ignore */ }

    const daysSinceActivity = thread.date
      ? Math.max(0, Math.floor((Date.now() - new Date(thread.date).getTime()) / 86400000))
      : '?';

    const gmailLink = thread.gmail_link || `https://mail.google.com/mail/u/0/#inbox/${thread.thread_id}`;
    const description = [
      `## Problema`,
      analysisResumen || `Correo de ${thread.client_name || 'cliente'} requiere atención.`,
      ``,
      `## Qué se necesita`,
      action.description,
      ``,
      `## Contexto del correo`,
      `- Cliente: ${thread.client_name || '—'}`,
      `- Remitente: ${thread.last_from || thread.original_from || '—'}`,
      `- Asunto: ${thread.subject || '—'}`,
      `- Días sin respuesta: ${daysSinceActivity}`,
      `- Severidad Jarvis: ${thread.severity || '—'}`,
      `- Estado: ${thread.estado || '—'}`,
      ``,
      `## Correo original`,
      gmailLink,
      ``,
      `---`,
      `Ticket creado automáticamente por Jarvis desde análisis de correo.`,
    ].join('\n');

    // Labels from client jira_label
    const labels = [];
    if (thread.client_jira_label) labels.push(thread.client_jira_label);
    if (action.action_type === 'crear_ticket_jira') labels.push('jarvis-auto');

    // Map priority
    const priorityMap = { alta: 'High', media: 'Medium', baja: 'Low' };
    const priority = priorityMap[action.priority] || 'Medium';

    // Search for related tickets + active sprint (both non-blocking)
    let relatedTickets = [];
    let activeSprint   = null;
    try {
      const [rt, sp] = await Promise.allSettled([
        (async () => {
          const keywords = extractKeywords(thread.subject);
          return keywords ? jira.searchRelatedTickets(keywords, projectKey) : [];
        })(),
        jira.getActiveSprintForProject(projectKey),
      ]);
      if (rt.status === 'fulfilled') relatedTickets = rt.value;
      if (sp.status === 'fulfilled') activeSprint   = sp.value;
    } catch { /* non-blocking */ }

    const alreadyLinked = jira.getLinkedTicket(thread.thread_id);

    // Build summary from thread subject (describes the problem, not the delegation instruction)
    // Prefer Sonnet's short title (action.description ≤ 80 chars) over the thread subject
    const isShortTitle = action.description && action.description.length <= 80
      && !action.description.toLowerCase().startsWith('asignar')
      && !action.description.toLowerCase().startsWith('delegar')
      && !action.description.toLowerCase().startsWith('crear ticket');
    const summary = isShortTitle ? action.description : buildTicketSummary(thread);

    // Build sprint options: active first, then Backlog
    const sprintOptions = [{ id: null, name: 'Backlog (sin sprint)' }];
    if (activeSprint) {
      const start = activeSprint.startDate ? activeSprint.startDate.substring(0, 10) : '';
      const end   = activeSprint.endDate   ? activeSprint.endDate.substring(0, 10)   : '';
      sprintOptions.unshift({
        id:    activeSprint.id,
        name:  `${activeSprint.name}${start ? ` (${start} → ${end})` : ''}`,
        state: activeSprint.state,
      });
    }

    res.json({
      preview: {
        summary,
        description,
        project:      { key: project.key, name: project.name },
        issueType:    'Tarea',
        priority,
        assignee:     assigneeMember
          ? { name: action.assignee, display: assigneeMember.nombre, account_id: assigneeMember.jira_account_id }
          : null,
        labels,
        gmail_link:   gmailLink,
        timeEstimate: action.time_estimate || '1h',
        sprint:       activeSprint || null,
      },
      options: {
        assignees: [
          { name: 'luciano',   display: 'Luciano Alvares',   account_id: '62727c32e01c14006a51fd3d' },
          { name: 'richard',   display: 'Richard Martinez',  account_id: '627280c8f42962006fdfa043' },
          { name: 'johana',    display: 'Johana Pailanca',   account_id: null },
          { name: 'alejandro', display: 'Alejandro Bermúdez', account_id: '6358866a1cc605b1fd162e92' },
        ],
        projects,
        issueTypes: ['Tarea', 'Historia', 'Error'],
        priorities: ['High', 'Medium', 'Low'],
        sprints:    sprintOptions,
      },
      related_tickets: relatedTickets,
      already_linked:  alreadyLinked,
    });
  } catch (err) {
    logger.error('Prepare ticket failed', { error: err.message });
    res.status(500).json({ error: err.message });
  }
});

router.post('/agent/action/:actionId/create-ticket', async (req, res) => {
  try {
    const { actionId } = req.params;
    const { summary, description, projectKey, issueType, priority, assignee, labels, timeEstimate, sprintId } = req.body;
    if (!summary || !projectKey) return res.status(400).json({ error: 'summary y projectKey son requeridos' });

    const db    = require('../db/database');
    const jira  = require('../mcp/jira');
    const sqlDb = db.getDb();

    const action = sqlDb.prepare('SELECT * FROM proposed_actions WHERE id = ?').get(Number(actionId));
    if (!action) return res.status(404).json({ error: 'Acción no encontrada' });

    // Check not already created
    const existing = jira.getLinkedTicket(action.thread_id);
    if (existing) {
      return res.status(409).json({ error: `Ya existe ticket ${existing.key} para este correo`, ticket: existing });
    }

    // Resolve assignee account ID
    const { resolveAssignee } = require('../skills/agent-brain');
    const member = resolveAssignee(assignee);
    const assigneeAccountId = member?.jira_account_id || null;

    // Create ticket
    const ticket = await jira.createTicket({
      summary,
      description,
      projectKey,
      issueType,
      priority,
      assigneeAccountId,
      labels:       Array.isArray(labels) ? labels : [],
      timeEstimate: timeEstimate || null,
      sprintId:     sprintId    || null,
    });

    // Log in actions_log
    db.logAction(action.thread_id, 'jira_ticket_created', {
      key:       ticket.key,
      url:       ticket.url,
      project:   projectKey,
      assignee:  assignee || null,
      priority,
      action_id: Number(actionId),
    });

    // Mark action as executed
    sqlDb.prepare(`
      UPDATE proposed_actions
      SET status = 'executed', resolved_by = 'ceo', resolved_at = datetime('now')
      WHERE id = ?
    `).run(Number(actionId));

    // Update thread estado → en_jira
    sqlDb.prepare(`
      UPDATE threads
      SET estado = 'en_jira', jira_issue_key = ?, updated_at = datetime('now')
      WHERE thread_id = ?
    `).run(ticket.key, action.thread_id);

    // Gmail sync: add En Jira label (fire-and-forget)
    ;(async () => {
      try {
        const gmail = require('../mcp/gmail');
        await gmail.modifyThread(action.thread_id, ['Jarvis/En Jira'], ['Jarvis/Acción Requerida'], false);
      } catch (_) {}
    })();

    logger.info('Jira ticket created from action', { key: ticket.key, actionId, thread_id: action.thread_id });
    res.json({ success: true, ticket });
  } catch (err) {
    logger.error('Create ticket failed', { error: err.message });
    res.status(500).json({ success: false, error: err.message });
  }
});

router.post('/agent/action/:actionId/reject', (req, res) => {
  try {
    const { actionId } = req.params;
    const db    = require('../db/database');
    const sqlDb = db.getDb();

    const action = sqlDb.prepare('SELECT * FROM proposed_actions WHERE id = ?').get(Number(actionId));
    if (!action) return res.status(404).json({ error: 'Acción no encontrada' });

    sqlDb.prepare(`
      UPDATE proposed_actions
      SET status = 'rejected', resolved_by = 'ceo', resolved_at = datetime('now')
      WHERE id = ?
    `).run(Number(actionId));

    db.logAction(action.thread_id, 'action_rejected', { action_id: Number(actionId), action_type: action.action_type });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

router.get('/agent/candidates', (req, res) => {
  try {
    const { getAnalysisCandidates } = require('../skills/agent-brain');
    const candidates = getAnalysisCandidates();
    res.json({ candidates, total: candidates.length });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// ─── Sprint summary (for Home cockpit card) ───────────────────────────────────

let _sprintSummaryCache = null;
let _sprintSummaryCacheAt = 0;
const SPRINT_SUMMARY_TTL = 5 * 60 * 1000; // 5 min

router.get('/agent/sprint-summary', async (req, res) => {
  try {
    if (_sprintSummaryCache && Date.now() - _sprintSummaryCacheAt < SPRINT_SUMMARY_TTL) {
      return res.json(_sprintSummaryCache);
    }

    const jira = require('../mcp/jira');
    const BOARDS = [{ project: 'CLICK', boardId: 67 }, { project: 'WYS', boardId: 100 }];

    const allTickets = [];
    let activeSprint  = null;

    for (const { project, boardId } of BOARDS) {
      try {
        const sprint = await jira.getActiveSprint(boardId);
        if (sprint) {
          if (!activeSprint) activeSprint = sprint;
          const sprintTickets = await jira.getSprintIssues(sprint.id);
          sprintTickets.forEach(t => allTickets.push({ ...t, project }));
        }
      } catch (e) {
        logger.debug('Sprint summary board failed', { boardId, error: e.message });
      }
    }

    // Fallback: getMyTasks
    let tickets = allTickets;
    if (!tickets.length) {
      try {
        tickets = (await jira.getMyTasks()).map(t => ({ ...t, project: t.key?.split('-')[0] || 'CLICK' }));
      } catch (e) { tickets = []; }
    }

    const summary = {
      total:      tickets.length,
      inProgress: tickets.filter(t => t.status?.toLowerCase().includes('progress')).length,
      todo:       tickets.filter(t => t.status?.toLowerCase().includes('do') || t.status === 'To Do').length,
      done:       tickets.filter(t => t.status?.toLowerCase().includes('done')).length,
      overdue:    tickets.filter(t => t.overdue).length,
    };

    const result = {
      sprint:   activeSprint,
      tickets:  tickets.slice(0, 20),
      summary,
      jiraAvailable: true,
    };

    _sprintSummaryCache   = result;
    _sprintSummaryCacheAt = Date.now();
    res.json(result);
  } catch (err) {
    logger.debug('Sprint summary failed', { error: err.message });
    res.json({ sprint: null, tickets: [], summary: { total: 0, inProgress: 0, todo: 0, done: 0, overdue: 0 }, jiraAvailable: false });
  }
});

// ─── Alerts (for Home cockpit card) ──────────────────────────────────────────

router.get('/agent/alerts', (req, res) => {
  try {
    const db    = require('../db/database');
    const sqlDb = db.getDb();
    const alerts = [];

    // 1. Urgent emails without response > 7 days
    const urgentThreads = sqlDb.prepare(`
      SELECT thread_id, subject, client_name, date,
             CAST(julianday('now') - julianday(date) AS INTEGER) AS days
      FROM threads
      WHERE estado IN ('requiere_mi_accion', 'esperando_nosotros', 'pendiente')
        AND severity IN ('high', 'critical')
        AND last_sender_is_me = 0
        AND CAST(julianday('now') - julianday(date) AS INTEGER) >= 7
      ORDER BY days DESC
      LIMIT 5
    `).all();

    urgentThreads.forEach(t => {
      alerts.push({
        type:     'email',
        severity: t.days >= 14 ? 'critical' : 'warning',
        text:     `${t.client_name || '(desconocido)'} lleva ${t.days} días sin respuesta — "${(t.subject || '').substring(0, 50)}"`,
        link:     '/correo',
        thread_id: t.thread_id,
        days:     t.days,
      });
    });

    // 2. Threads awaiting client > 14 days
    const waitingLong = sqlDb.prepare(`
      SELECT thread_id, subject, client_name,
             CAST(julianday('now') - julianday(updated_at) AS INTEGER) AS days
      FROM threads
      WHERE estado = 'esperando_cliente'
        AND CAST(julianday('now') - julianday(updated_at) AS INTEGER) >= 14
      ORDER BY days DESC
      LIMIT 3
    `).all();

    waitingLong.forEach(t => {
      alerts.push({
        type:     'email',
        severity: 'warning',
        text:     `${t.client_name || '(cliente)'} esperando cliente hace ${t.days} días — "${(t.subject || '').substring(0, 40)}"`,
        link:     '/correo',
        thread_id: t.thread_id,
        days:     t.days,
      });
    });

    // 3. Overdue Jira tasks (from cache if available)
    if (_sprintSummaryCache && _sprintSummaryCache.tickets) {
      const overdueTasks = _sprintSummaryCache.tickets.filter(t => t.overdue);
      overdueTasks.slice(0, 3).forEach(t => {
        alerts.push({
          type:     'task',
          severity: 'warning',
          text:     `${t.key} está atrasada — "${(t.summary || '').substring(0, 50)}"`,
          link:     '/sprint',
          jira_key: t.key,
          jira_url: t.url,
        });
      });
    }

    // Sort: critical first, then by days desc
    alerts.sort((a, b) => {
      if (a.severity === 'critical' && b.severity !== 'critical') return -1;
      if (b.severity === 'critical' && a.severity !== 'critical') return  1;
      return (b.days || 0) - (a.days || 0);
    });

    res.json({ alerts, total: alerts.length });
  } catch (err) {
    logger.error('Alerts failed', { error: err.message });
    res.json({ alerts: [], total: 0 });
  }
});

router.put('/contacts/:email', (req, res) => {
  try {
    const db = require('../db/database');
    const email = decodeURIComponent(req.params.email);
    const { name, role, client_name, phone, notes } = req.body;
    db.upsertContact(email, { name, role, client_name, phone, notes });
    const updated = db.getContact(email);
    res.json({ success: true, contact: updated });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

module.exports = router;
