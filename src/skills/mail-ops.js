const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const cache = require('../cache/store');
const { classifyEmail } = require('../utils/ai-classifier');
const logger = require('../utils/logger');

const SKILL = 'mail-ops';

const rules = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));
const clientsConfig = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/clients.yml'), 'utf8'));

async function classify(hours = 24) {
  logger.info('Classifying emails', { skill: SKILL, hours });

  const gmail = require('../mcp/gmail');
  const threads = await gmail.getUnreadThreads(hours);

  const classified = await Promise.all(threads.map(t => classifyThread(t)));

  const result = {
    classified_at: new Date().toISOString(),
    hours_window: hours,
    total: classified.length,
    needs_decision: classified.filter(c => c.needs_decision).length,
    spam_detected: classified.filter(c => c.is_spam).length,
    priority: classified.filter(c => c.severity === 'high').length,
    emails: classified,
  };

  cache.write('mail-classifications.json', result);
  logger.info('Classification done', { skill: SKILL, ...pick(result, ['total', 'needs_decision', 'spam_detected']) });
  return result;
}

async function classifyThread(t) {
  const domain = extractDomain(t.from);
  const clientMatch = matchClient(t.from);
  const isSpam = isSpamDomain(domain);
  const isPriority = hasPriorityKeyword(`${t.subject} ${t.snippet}`);

  let aiResult = null;
  if (!isSpam && process.env.ANTHROPIC_API_KEY) {
    try {
      aiResult = await classifyEmail(t.subject, t.snippet, domain);
    } catch (e) {
      logger.debug('AI classify failed, using rules only', { skill: SKILL, error: e.message });
    }
  }

  const severity = aiResult?.severity || (isPriority ? 'high' : clientMatch ? 'medium' : 'low');
  const category = aiResult?.category || (clientMatch ? 'client' : isSpam ? 'spam' : 'unknown');

  return {
    thread_id: t.id,
    subject: t.subject,
    from: t.from,
    date: t.date,
    client: clientMatch?.name || null,
    client_tier: clientMatch?.tier || null,
    is_spam: isSpam,
    is_priority: isPriority || severity === 'high',
    needs_decision: !isSpam && (isPriority || clientMatch !== null || aiResult?.needs_decision),
    category,
    severity,
    suggested_labels: buildLabels(clientMatch, severity, isSpam, category),
  };
}

// SAFE MODE: returns a proposal — does NOT apply labels until safe_mode is disabled
async function applyLabels(classifications) {
  const actions = classifications.emails
    .filter(c => !c.is_spam && c.suggested_labels.length > 0)
    .map(c => ({ thread_id: c.thread_id, subject: c.subject, labels: c.suggested_labels }));

  if (rules.mail.safe_mode) {
    logger.info('Label proposal generated (safe mode)', { skill: SKILL, count: actions.length });
    return { mode: 'proposal', message: 'Safe mode activo — confirmar para aplicar', actions };
  }

  // Only runs when safe_mode: false
  const gmail = require('../mcp/gmail');
  const results = await Promise.allSettled(
    actions.flatMap(a => a.labels.map(label => gmail.applyLabel(a.thread_id, label)))
  );

  const applied = results.filter(r => r.status === 'fulfilled').length;
  const failed = results.filter(r => r.status === 'rejected').length;
  logger.info('Labels applied', { skill: SKILL, applied, failed });
  return { mode: 'applied', applied, failed, actions };
}

function buildLabels(client, severity, isSpam, category) {
  const labels = [];
  if (isSpam) { labels.push('jarvis/spam'); return labels; }
  if (client) labels.push(`jarvis/client/${client.jira_label || client.name.toLowerCase().replace(/\s+/g, '-')}`);
  if (severity === 'high') labels.push('jarvis/priority');
  if (category === 'billing') labels.push('jarvis/billing');
  if (category === 'technical') labels.push('jarvis/technical');
  return labels;
}

function matchClient(from) {
  for (const c of clientsConfig.clients) {
    if (c.domains.some(d => from?.includes(d)) || c.contacts.some(ct => from?.includes(ct))) return c;
  }
  return null;
}

function isSpamDomain(domain) {
  return rules.mail.spam_domains.some(d => domain?.includes(d));
}

function hasPriorityKeyword(text) {
  return rules.mail.priority_keywords.some(kw => text?.toLowerCase().includes(kw.toLowerCase()));
}

function extractDomain(from) {
  const match = from?.match(/@([\w.-]+)/);
  return match ? match[1] : '';
}

function pick(obj, keys) {
  return Object.fromEntries(keys.map(k => [k, obj[k]]));
}

module.exports = { classify, applyLabels, classifyThread };
