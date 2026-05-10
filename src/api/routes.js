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
  const data = cache.read(key) || cache.read('mock-briefing.json');
  res.json(data);
});

router.get('/briefing/morning', (req, res) => {
  const data = cache.read('briefing-am.json') || cache.read('mock-briefing.json');
  res.json(data);
});

router.get('/briefing/evening', (req, res) => {
  const data = cache.read('briefing-pm.json') || cache.read('mock-briefing.json');
  res.json(data);
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

module.exports = router;
