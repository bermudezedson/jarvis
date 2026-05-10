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

  res.json({
    briefing: briefing || null,
    client_threads: clientThreads || null,
    mail: mailClassifications || null,
    commitments: commitments || null,
    client_pulse: clientPulse || null,
    last_refresh: lastRefresh,
    has_real_data: !!(briefing || clientThreads),
    timestamp: new Date().toISOString(),
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
    const db = require('../db/database');
    res.json({
      rules: db.getAllLearnedRules(),
      feedback_history: db.getFeedbackHistory(),
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
