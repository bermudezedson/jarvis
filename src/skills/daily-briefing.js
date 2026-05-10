const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const cache = require('../cache/store');
const { formatChile, ageHours, ageDays, isTodayDate } = require('../utils/date-helpers');
const logger = require('../utils/logger');

const SKILL = 'daily-briefing';

const rules = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));
const clientsConfig = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/clients.yml'), 'utf8'));
const clients = clientsConfig.clients;

async function generate(type = 'morning') {
  logger.info('Generating briefing', { skill: SKILL, type });

  const [emailResult, calendarResult, jiraResult] = await Promise.allSettled([
    fetchEmailData(),
    fetchCalendarData(),
    fetchJiraData(),
  ]);

  const sources = {
    gmail: emailResult.status === 'fulfilled' ? 'ok' : 'error',
    calendar: calendarResult.status === 'fulfilled' ? 'ok' : 'error',
    jira: jiraResult.status === 'fulfilled' ? 'ok' : 'error',
  };

  // Phase 2: run commitment scan and client pulse in background (non-blocking)
  if (type === 'morning') {
    const commitmentTracker = require('./commitment-tracker');
    const clientPulse = require('./client-pulse');
    Promise.allSettled([
      commitmentTracker.scanSentEmails(1),
      clientPulse.calculatePulse(),
    ]).then(([cr, pr]) => {
      if (cr.status === 'rejected') logger.warn('Commitment scan failed', { skill: SKILL, error: cr.reason?.message });
      if (pr.status === 'rejected') logger.warn('Client pulse failed', { skill: SKILL, error: pr.reason?.message });
    });
  }

  if (emailResult.status === 'rejected')
    logger.warn('Gmail fetch failed', { skill: SKILL, error: emailResult.reason?.message });
  if (calendarResult.status === 'rejected')
    logger.warn('Calendar fetch failed', { skill: SKILL, error: calendarResult.reason?.message });
  if (jiraResult.status === 'rejected')
    logger.warn('Jira fetch failed', { skill: SKILL, error: jiraResult.reason?.message });

  const emails = emailResult.status === 'fulfilled' ? emailResult.value : null;
  const events = calendarResult.status === 'fulfilled' ? calendarResult.value : null;
  const tasks = jiraResult.status === 'fulfilled' ? jiraResult.value : null;

  const briefing = buildBriefing(type, emails, events, tasks, sources);

  const filename = type === 'morning' ? 'briefing-am.json' : 'briefing-pm.json';
  cache.write(filename, briefing);
  cache.write('last-refresh.json', { timestamp: new Date().toISOString() });

  logger.info('Briefing saved to cache', { skill: SKILL, type, filename, sources });
  return briefing;
}

async function fetchEmailData() {
  const gmail = require('../mcp/gmail');
  const threads = await gmail.getUnreadThreads(12);

  return threads
    .filter(t => !isSpam(t.from))
    .map(t => ({
      ...t,
      client: matchClient(t.from),
      is_priority: hasPriorityKeyword(t.subject + ' ' + t.snippet),
      age_hours: t.date ? ageHours(t.date) : 0,
      needs_response: t.date ? ageHours(t.date) > 48 : false,
    }))
    .map(t => ({ ...t, needs_decision: t.is_priority || t.client !== null }));
}

async function fetchCalendarData() {
  const calendar = require('../mcp/calendar');
  return calendar.getTodayEvents();
}

async function fetchJiraData() {
  const jira = require('../mcp/jira');
  return jira.getMyTasks();
}

function buildBriefing(type, emails, events, tasks, sources) {
  const executiveInbox = buildExecutiveInbox(emails, tasks);
  const riskRadar = appendClientPulseRisks(buildRiskRadar(emails, tasks, events));
  const deepWorkSlots = events ? findDeepWorkSlots(events) : [];
  const nextMeeting = events ? getNextMeeting(events) : null;
  const commitments = getCommitmentsMetric();

  // Read client-threads data for CEO metrics
  const clientData = cache.read('client-threads.json');

  const metrics = {
    unread_emails:    emails ? emails.length : null,
    emails_need_decision: emails ? emails.filter(e => e.needs_decision).length : null,
    jira_tasks_today: tasks ? tasks.filter(t => t.due_today || t.overdue).length : null,
    overdue_tasks:    tasks ? tasks.filter(t => t.overdue).length : null,
    meetings_today:   events ? events.length : null,
    next_meeting:     nextMeeting,
    open_commitments:  commitments.open,
    overdue_commitments: commitments.overdue,
    // Client thread metrics (from client-threads.json)
    client_threads_total:            clientData?.total_client_threads    ?? null,
    client_threads_requiring_action: clientData?.requiring_my_action     ?? null,
    client_threads_waiting:          clientData?.waiting_client_response ?? null,
    client_threads_high_severity:    clientData?.high_severity           ?? null,
  };

  return {
    generated_at: formatChile(new Date()),
    type,
    is_mock: false,
    sources,
    metrics,
    executive_inbox: executiveInbox,
    risk_radar: riskRadar,
    deep_work_slots: deepWorkSlots,
    calendar_events: events || [],
  };
}

function buildExecutiveInbox(emails, tasks) {
  const items = [];

  if (emails) {
    const clientEmails = emails
      .filter(e => e.client && e.needs_decision)
      .slice(0, 5)
      .map(e => ({
        id: e.id,
        type: 'client',
        severity: e.is_priority ? 'high' : 'medium',
        summary: `${e.client.name} — ${truncate(e.snippet || e.subject, 80)}`,
        age_days: Math.floor(e.age_hours / 24),
        source: 'gmail',
        thread_id: e.id,
        suggested_action: 'Revisar y responder',
      }));
    items.push(...clientEmails);

    const unanswered = emails
      .filter(e => e.needs_response && !e.client)
      .slice(0, 2)
      .map(e => ({
        id: `${e.id}_followup`,
        type: 'followup',
        severity: 'medium',
        summary: `Sin respuesta ${e.age_hours}h — ${e.subject}`,
        age_days: Math.floor(e.age_hours / 24),
        source: 'gmail',
        thread_id: e.id,
        suggested_action: 'Hacer seguimiento o delegar',
      }));
    items.push(...unanswered);
  }

  if (tasks) {
    const overdue = tasks
      .filter(t => t.overdue)
      .slice(0, 2)
      .map(t => ({
        id: t.key,
        type: 'task',
        severity: 'high',
        summary: `[${t.key}] ${truncate(t.summary, 80)} — vencido hace ${t.days_overdue}d`,
        age_days: t.days_overdue,
        source: 'jira',
        thread_id: t.key,
        suggested_action: 'Actualizar estado o escalar',
      }));
    items.push(...overdue);
  }

  const order = { high: 0, medium: 1, low: 2 };
  return items
    .sort((a, b) => (order[a.severity] ?? 1) - (order[b.severity] ?? 1))
    .slice(0, rules.mail.max_executive_inbox_items);
}

function buildRiskRadar(emails, tasks, events) {
  const risks = [];

  if (tasks) {
    const overdueCount = tasks.filter(t => t.overdue).length;
    if (overdueCount > 0)
      risks.push({ severity: 'high', message: `${overdueCount} tarea${overdueCount > 1 ? 's' : ''} vencida${overdueCount > 1 ? 's' : ''} en Jira`, action: 'Revisar y actualizar estado' });

    const staleCount = tasks.filter(t => t.days_without_activity >= rules.jira.stale_days).length;
    if (staleCount > 0)
      risks.push({ severity: 'medium', message: `${staleCount} tarea${staleCount > 1 ? 's' : ''} sin actividad hace +${rules.jira.stale_days} días`, action: 'Revisar o cerrar' });
  }

  if (emails) {
    const unanswered = emails.filter(e => e.age_hours > 48 && e.needs_decision).length;
    if (unanswered > 0)
      risks.push({ severity: 'medium', message: `${unanswered} correo${unanswered > 1 ? 's' : ''} de cliente sin respuesta hace +48h`, action: 'Responder o delegar' });
  }

  const order = { high: 0, medium: 1, low: 2, info: 3 };
  return risks.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

function findDeepWorkSlots(events) {
  const slots = [];
  const workStart = 9 * 60;
  const workEnd = 18 * 60;

  const sorted = [...events].sort((a, b) => toMinutes(a.start_time) - toMinutes(b.start_time));
  let cursor = workStart;

  for (const event of sorted) {
    const start = toMinutes(event.start_time);
    const end = toMinutes(event.end_time);
    if (start - cursor >= 60)
      slots.push({ start: fromMinutes(cursor), end: fromMinutes(start), duration_minutes: start - cursor });
    cursor = Math.max(cursor, end);
  }

  if (workEnd - cursor >= 60)
    slots.push({ start: fromMinutes(cursor), end: fromMinutes(workEnd), duration_minutes: workEnd - cursor });

  return slots;
}

function getNextMeeting(events) {
  const now = new Date();
  const upcoming = events
    .filter(e => new Date(e.start) > now)
    .sort((a, b) => new Date(a.start) - new Date(b.start));
  if (!upcoming.length) return null;
  const next = upcoming[0];
  return { time: next.start_time, title: next.title, attendees: next.attendees_count };
}

function isSpam(from) {
  return rules.mail.spam_domains.some(d => from?.includes(d));
}

function hasPriorityKeyword(text) {
  return rules.mail.priority_keywords.some(kw => text?.toLowerCase().includes(kw.toLowerCase()));
}

function matchClient(from) {
  for (const c of clients) {
    if (c.domains.some(d => from?.includes(d)) || c.contacts.some(ct => from?.includes(ct)))
      return c;
  }
  return null;
}

function toMinutes(timeStr) {
  const [h, m] = (timeStr || '00:00').split(':').map(Number);
  return h * 60 + (m || 0);
}

function fromMinutes(mins) {
  return `${String(Math.floor(mins / 60)).padStart(2, '0')}:${String(mins % 60).padStart(2, '0')}`;
}

function truncate(str, len) {
  if (!str) return '';
  return str.length > len ? str.slice(0, len) + '...' : str;
}

function getCommitmentsMetric() {
  try {
    const commitmentTracker = require('./commitment-tracker');
    const { open, overdue } = commitmentTracker.getOpen();
    return { open: open.length, overdue: overdue.length };
  } catch {
    return { open: null, overdue: null };
  }
}

// Append client-pulse risks to existing radar (called after buildRiskRadar)
function appendClientPulseRisks(riskRadar) {
  try {
    const clientPulse = require('./client-pulse');
    const pulse = clientPulse.getPulse();
    if (!pulse) return riskRadar;

    const critical = pulse.clients.filter(c => c.status === 'critical');
    const atRisk = pulse.clients.filter(c => c.status === 'at_risk');

    if (critical.length > 0)
      riskRadar.unshift({
        severity: 'high',
        message: `${critical.length} cliente${critical.length > 1 ? 's' : ''} en estado crítico`,
        clients: critical.map(c => c.name),
        action: 'Contactar urgente — revisar health score',
      });

    if (atRisk.length > 0)
      riskRadar.push({
        severity: 'medium',
        message: `${atRisk.length} cliente${atRisk.length > 1 ? 's' : ''} en riesgo de churn`,
        clients: atRisk.map(c => c.name),
        action: 'Agendar llamada de seguimiento',
      });
  } catch {}

  return riskRadar;
}

module.exports = { generate };
