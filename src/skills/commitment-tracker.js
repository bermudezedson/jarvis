const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const crypto = require('crypto');
const cache = require('../cache/store');
const { formatChile } = require('../utils/date-helpers');
const logger = require('../utils/logger');

const SKILL = 'commitment-tracker';

const rules = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));

async function scanSentEmails(days = 7) {
  logger.info('Scanning sent emails for commitments', { skill: SKILL, days });

  const gmail = require('../mcp/gmail');
  const sent = await gmail.getSentEmails(days);

  const detected = [];
  for (const email of sent) {
    const found = detectInEmail(email);
    detected.push(...found);
  }

  // Merge with existing store — avoid duplicates by fingerprint
  const store = cache.read('commitments.json') || { commitments: [], last_scan: null };
  const existingFingerprints = new Set(store.commitments.map(c => c.fingerprint));

  const newOnes = detected.filter(c => !existingFingerprints.has(c.fingerprint));
  store.commitments = [...store.commitments, ...newOnes];
  store.last_scan = new Date().toISOString();

  cache.write('commitments.json', store);

  logger.info('Commitment scan done', { skill: SKILL, new: newOnes.length, total: store.commitments.length });
  return { new: newOnes.length, total: store.commitments.length, open: countOpen(store.commitments) };
}

function detectInEmail(email) {
  const text = (email.body || email.snippet || '').trim();
  const found = [];

  for (const phrase of rules.commitments.trigger_phrases) {
    let idx = 0;
    const lowerText = text.toLowerCase();
    const lowerPhrase = phrase.toLowerCase();

    while ((idx = lowerText.indexOf(lowerPhrase, idx)) !== -1) {
      const contextStart = Math.max(0, idx - 30);
      const contextEnd = Math.min(text.length, idx + phrase.length + 80);
      const context = text.slice(contextStart, contextEnd).replace(/\n+/g, ' ').trim();

      const deadline = extractDeadline(text, idx) || defaultDeadline(email.date);
      const fingerprint = crypto
        .createHash('md5')
        .update(`${email.id}|${phrase}|${idx}`)
        .digest('hex')
        .slice(0, 12);

      found.push({
        id: `commit_${fingerprint}`,
        fingerprint,
        email_id: email.id,
        email_subject: email.subject,
        to: email.to,
        phrase,
        context,
        detected_date: email.date || new Date().toISOString(),
        deadline,
        resolved: false,
        resolution_date: null,
        resolution_note: null,
      });

      idx += lowerPhrase.length;
    }
  }

  return found;
}

function extractDeadline(text, phraseIdx) {
  const window = text.slice(phraseIdx, Math.min(text.length, phraseIdx + 120)).toLowerCase();

  // "el lunes / martes / ... / viernes"
  const dayNames = ['lunes', 'martes', 'miércoles', 'miercoles', 'jueves', 'viernes'];
  const dayNumbers = [1, 2, 3, 3, 4, 5]; // ISO day of week
  for (let i = 0; i < dayNames.length; i++) {
    if (window.includes(dayNames[i])) return nextWeekday(dayNumbers[i]);
  }

  // "mañana"
  if (window.includes('mañana') || window.includes('manana')) return offsetDays(1);

  // "esta semana"
  if (window.includes('esta semana')) return offsetDays(4);

  // "próxima semana" / "la semana que viene"
  if (window.includes('próxima semana') || window.includes('semana que viene')) return offsetDays(7);

  // "en N días / dia"
  const nDaysMatch = window.match(/en\s+(\d+|un|dos|tres|cuatro|cinco)\s+d[íi]a/);
  if (nDaysMatch) {
    const wordToNum = { un: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5 };
    const n = parseInt(nDaysMatch[1]) || wordToNum[nDaysMatch[1]] || rules.commitments.default_deadline_days;
    return offsetDays(n);
  }

  // "a fin de mes"
  if (window.includes('fin de mes')) return endOfMonth();

  return null;
}

function defaultDeadline(emailDate) {
  const base = emailDate ? new Date(emailDate) : new Date();
  base.setDate(base.getDate() + rules.commitments.default_deadline_days);
  return base.toISOString().split('T')[0];
}

function nextWeekday(targetISODay) {
  const now = new Date();
  const current = now.getDay() || 7; // Sunday=7
  const diff = targetISODay >= current ? targetISODay - current : 7 - current + targetISODay;
  return offsetDays(diff || 7);
}

function offsetDays(n) {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().split('T')[0];
}

function endOfMonth() {
  const d = new Date();
  d.setMonth(d.getMonth() + 1, 0);
  return d.toISOString().split('T')[0];
}

function getOpen() {
  const store = cache.read('commitments.json') || cache.read('mock-commitments.json') || { commitments: [] };
  const today = new Date().toISOString().split('T')[0];
  const open = store.commitments.filter(c => !c.resolved);
  const overdue = open.filter(c => c.deadline && c.deadline < today);
  return { open, overdue, total: store.commitments.length };
}

function markResolved(id, note = '') {
  const store = cache.read('commitments.json') || { commitments: [] };
  const idx = store.commitments.findIndex(c => c.id === id);
  if (idx === -1) return { error: `Commitment ${id} not found` };

  store.commitments[idx].resolved = true;
  store.commitments[idx].resolution_date = new Date().toISOString();
  store.commitments[idx].resolution_note = note;

  cache.write('commitments.json', store);
  logger.info('Commitment resolved', { skill: SKILL, id });
  return { success: true, commitment: store.commitments[idx] };
}

function countOpen(list) {
  return list.filter(c => !c.resolved).length;
}

module.exports = { scanSentEmails, detectInEmail, getOpen, markResolved };
