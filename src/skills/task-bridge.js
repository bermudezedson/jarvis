const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const logger = require('../utils/logger');

const SKILL = 'task-bridge';

const rules = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));
const clientsConfig = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/clients.yml'), 'utf8'));

// Proposes a Jira issue from a Gmail thread.
// Safe mode (default): returns proposal without creating.
// Disable safe_mode in rules.yml to create automatically.
async function emailToJira(threadId, options = {}) {
  logger.info('Email → Jira proposal', { skill: SKILL, threadId });

  const gmail = require('../mcp/gmail');
  const thread = await gmail.getThread(threadId);

  const from = thread.from || '';
  const client = matchClient(from);

  const proposal = {
    project: { key: options.project || rules.jira.default_project },
    issuetype: { name: rules.jira.issue_types.client_request },
    summary: buildSummary(client, thread.subject),
    description: buildDescription(thread, from),
    labels: client ? [client.jira_label] : [],
    priority: { name: options.priority || 'Medium' },
  };

  if (options.dueDate) proposal.duedate = options.dueDate;

  if (rules.mail.safe_mode) {
    logger.info('Proposal generated (safe mode)', { skill: SKILL });
    return {
      mode: 'proposal',
      message: 'Safe mode activo — confirmar para crear en Jira',
      issue: proposal,
      thread: { id: threadId, subject: thread.subject, from },
    };
  }

  const jira = require('../mcp/jira');
  const created = await jira.createIssue(proposal);
  logger.info('Jira issue created', { skill: SKILL, key: created.key });
  return { mode: 'created', issue: created };
}

// Proposes a Calendar block for a Jira task due date.
async function jiraToCalendar(issueKey, options = {}) {
  logger.info('Jira → Calendar proposal', { skill: SKILL, issueKey });

  const jira = require('../mcp/jira');
  const issue = await jira.getIssue(issueKey);

  if (!issue) return { error: `Issue ${issueKey} not found` };
  if (!issue.due_date) return { error: `Issue ${issueKey} has no due date — set one in Jira first` };

  const startHour = options.startHour || '09:00';
  const endHour = options.endHour || '10:00';

  const proposal = {
    summary: `[Jira ${issue.key}] ${issue.summary}`,
    description: `Vinculado a Jira: https://webyseo.atlassian.net/browse/${issue.key}\nPrioridad: ${issue.priority}\nEstado: ${issue.status}`,
    start: { dateTime: `${issue.due_date}T${startHour}:00`, timeZone: rules.timezone },
    end: { dateTime: `${issue.due_date}T${endHour}:00`, timeZone: rules.timezone },
  };

  if (rules.mail.safe_mode) {
    logger.info('Proposal generated (safe mode)', { skill: SKILL });
    return {
      mode: 'proposal',
      message: 'Safe mode activo — confirmar para crear en Calendar',
      event: proposal,
      issue: { key: issue.key, summary: issue.summary, due_date: issue.due_date },
    };
  }

  const calendar = require('../mcp/calendar');
  const created = await calendar.createEvent(proposal);
  logger.info('Calendar event created', { skill: SKILL, eventId: created?.id });
  return { mode: 'created', event: created };
}

// Syncs Jira task list into cache for dashboard use without live MCP calls.
async function syncJiraTasks() {
  logger.info('Syncing Jira tasks to cache', { skill: SKILL });
  const jira = require('../mcp/jira');
  const cache = require('../cache/store');

  const tasks = await jira.getMyTasks();
  cache.write('jira-tasks.json', { synced_at: new Date().toISOString(), tasks });
  logger.info('Jira tasks cached', { skill: SKILL, count: tasks.length });
  return { count: tasks.length };
}

function buildSummary(client, subject) {
  const prefix = client ? `[${client.name}]` : '[Externo]';
  return `${prefix} ${(subject || 'Sin asunto').slice(0, 100)}`;
}

function buildDescription(thread, from) {
  const lines = [
    `*Origen:* correo de ${from}`,
    thread.subject ? `*Asunto:* ${thread.subject}` : null,
    '',
    `*Extracto:*`,
    (thread.body || thread.snippet || '').slice(0, 800),
    '',
    `_Creado automáticamente por Jarvis_`,
  ];
  return lines.filter(l => l !== null).join('\n');
}

function matchClient(from) {
  for (const c of clientsConfig.clients) {
    if (c.domains.some(d => from?.includes(d)) || c.contacts.some(ct => from?.includes(ct))) return c;
  }
  return null;
}

module.exports = { emailToJira, jiraToCalendar, syncJiraTasks };
