const https  = require('https');
const logger = require('../utils/logger');

const SKILL    = 'mcp:jira';
const CLOUD_ID = () => process.env.JIRA_CLOUD_ID;
const BASE_URL = 'api.atlassian.com';
const JIRA_SITE = 'alejandro-bermudez.atlassian.net';

// ─── HTTP helper (same pattern as gmail.js) ───────────────────────────────────

function getAuth() {
  const email = process.env.JIRA_USER_EMAIL;
  const token = process.env.JIRA_ACCESS_TOKEN;
  if (!email || !token) throw new Error('JIRA_USER_EMAIL / JIRA_ACCESS_TOKEN no configurados');
  return 'Basic ' + Buffer.from(`${email}:${token}`).toString('base64');
}

function request(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: BASE_URL,
      path:     `/ex/jira/${CLOUD_ID()}/rest/api/3${path}`,
      method,
      headers: {
        Authorization:  getAuth(),
        Accept:         'application/json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) {
            const msg = parsed.errorMessages?.join(', ') || parsed.message || `HTTP ${res.statusCode}`;
            reject(new Error(`Jira API error: ${msg}`));
          } else {
            resolve(parsed);
          }
        } catch {
          if (res.statusCode >= 400) reject(new Error(`Jira HTTP ${res.statusCode}`));
          else resolve(raw);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

// ─── Issue type name normalizer ───────────────────────────────────────────────
// Jira en español usa "Tarea", "Historia", "Error" — mapear nombres en inglés

const TYPE_MAP = {
  task:    'Tarea',
  bug:     'Error',
  story:   'Historia',
  epic:    'Epic',
  tarea:   'Tarea',
  error:   'Error',
  historia:'Historia',
};

function normalizeIssueType(name) {
  if (!name) return 'Tarea';
  return TYPE_MAP[name.toLowerCase()] || 'Tarea';
}

const PRIORITY_MAP = {
  alta:   'High',
  media:  'Medium',
  baja:   'Low',
  high:   'High',
  medium: 'Medium',
  low:    'Low',
};

function normalizePriority(p) {
  if (!p) return 'Medium';
  return PRIORITY_MAP[p.toLowerCase()] || 'Medium';
}

// ─── Text → Atlassian Document Format ────────────────────────────────────────

function textToAdf(text) {
  if (!text) return null;
  // Split on double-newline for paragraphs
  const paragraphs = text.split(/\n\n+/).filter(Boolean);
  return {
    type:    'doc',
    version: 1,
    content: paragraphs.map(para => ({
      type:    'paragraph',
      content: [{ type: 'text', text: para.replace(/\n/g, ' ') }],
    })),
  };
}

// ─── Ticket URL ───────────────────────────────────────────────────────────────

function ticketUrl(key) {
  return `https://${JIRA_SITE}/browse/${key}`;
}

// ─── Sprint helpers ───────────────────────────────────────────────────────────

// Board IDs per project (discovered via /rest/agile/1.0/board)
const PROJECT_BOARD = { CLICK: 67, WYS: 100 };

// 1-hour in-process cache for sprint data
const _sprintCache = new Map(); // boardId → { data, expires }

function requestAgile(method, path, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? JSON.stringify(body) : null;
    const options = {
      hostname: BASE_URL,
      path:     `/ex/jira/${CLOUD_ID()}/rest/agile/1.0${path}`,
      method,
      headers: {
        Authorization:  getAuth(),
        Accept:         'application/json',
        'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        if (res.statusCode === 204) { resolve(null); return; }
        try {
          const parsed = JSON.parse(raw);
          if (res.statusCode >= 400) reject(new Error(`Jira Agile error ${res.statusCode}: ${JSON.stringify(parsed).substring(0, 150)}`));
          else resolve(parsed);
        } catch {
          if (res.statusCode >= 400) reject(new Error(`Jira Agile HTTP ${res.statusCode}`));
          else resolve(raw);
        }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function getActiveSprint(boardId) {
  const cached = _sprintCache.get(boardId);
  if (cached && Date.now() < cached.expires) return cached.data;

  try {
    const data = await requestAgile('GET', `/board/${boardId}/sprint?state=active&maxResults=1`);
    const sprint = data?.values?.[0] || null;
    const result = sprint ? {
      id:        sprint.id,
      name:      sprint.name,
      state:     sprint.state,
      startDate: sprint.startDate,
      endDate:   sprint.endDate,
    } : null;
    _sprintCache.set(boardId, { data: result, expires: Date.now() + 3600000 });
    return result;
  } catch (err) {
    logger.debug('Get active sprint failed', { skill: SKILL, boardId, error: err.message });
    return null;
  }
}

async function getActiveSprintForProject(projectKey) {
  const boardId = PROJECT_BOARD[projectKey];
  if (!boardId) return null;
  return getActiveSprint(boardId);
}

async function moveToSprint(issueKey, sprintId) {
  logger.info('Moving issue to sprint', { skill: SKILL, issueKey, sprintId });
  return requestAgile('POST', `/sprint/${sprintId}/issue`, { issues: [issueKey] });
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function getMyTasks() {
  logger.info('Fetching Jira tasks', { skill: SKILL });
  const email = process.env.JIRA_USER_EMAIL;
  const data  = await request('GET',
    `/search?jql=${encodeURIComponent(`assignee = "${email}" AND statusCategory != Done ORDER BY duedate ASC`)}&maxResults=50&fields=summary,status,priority,duedate,assignee,labels,updated`
  );
  return normalizeTasks(data.issues || []);
}

async function getIssue(key) {
  logger.info('Fetching Jira issue', { skill: SKILL, key });
  const data = await request('GET', `/issue/${key}?fields=summary,status,priority,duedate,assignee,labels,updated`);
  const tasks = normalizeTasks([data]);
  return tasks[0] || null;
}

async function getClientTasks(jiraLabel) {
  logger.info('Fetching client tasks', { skill: SKILL, label: jiraLabel });
  const data = await request('GET',
    `/search?jql=${encodeURIComponent(`labels = "${jiraLabel}" AND statusCategory != Done ORDER BY updated DESC`)}&maxResults=20&fields=summary,status,priority,duedate,assignee,labels,updated`
  );
  return normalizeTasks(data.issues || []);
}

async function createTicket({ summary, description, projectKey, issueType, assigneeAccountId, priority, labels, timeEstimate, sprintId }) {
  logger.info('Creating Jira ticket', { skill: SKILL, projectKey, summary: summary?.substring(0, 50), sprintId });

  const fields = {
    project:   { key: projectKey },
    summary:   summary?.substring(0, 255),
    issuetype: { name: normalizeIssueType(issueType) },
    priority:  { name: normalizePriority(priority) },
  };

  if (description)       fields.description  = textToAdf(description);
  if (assigneeAccountId) fields.assignee     = { accountId: assigneeAccountId };
  if (labels?.length)    fields.labels       = labels;
  if (timeEstimate)      fields.timetracking = { originalEstimate: timeEstimate };
  // Note: customfield_10020 (sprint) is set via moveToSprint after creation — more reliable

  let data;
  try {
    data = await request('POST', '/issue', { fields });
  } catch (err) {
    if (timeEstimate && err.message?.includes('timetracking')) {
      logger.warn('Timetracking rejected by Jira, retrying without it', { skill: SKILL });
      delete fields.timetracking;
      data = await request('POST', '/issue', { fields });
    } else {
      throw err;
    }
  }

  logger.info('Jira ticket created', { skill: SKILL, key: data.key });
  const ticket = { key: data.key, id: data.id, url: ticketUrl(data.key) };

  // Assign to sprint post-creation (more reliable than customfield_10020 in body)
  if (sprintId) {
    try {
      await moveToSprint(ticket.key, sprintId);
      logger.info('Assigned to sprint', { skill: SKILL, key: ticket.key, sprintId });
      ticket.sprintId = sprintId;
    } catch (e) {
      logger.warn('Sprint assignment failed (non-fatal, ticket created in Backlog)', { skill: SKILL, key: ticket.key, error: e.message });
    }
  }

  return ticket;
}

// Legacy wrapper used by task-bridge.js (keep signature compatible)
async function createIssue(issueData) {
  return createTicket({
    summary:          issueData.summary,
    description:      issueData.description,
    projectKey:       issueData.project?.key || issueData.projectKey,
    issueType:        issueData.issuetype?.name || issueData.issueType || 'Tarea',
    priority:         issueData.priority?.name || issueData.priority,
    labels:           issueData.labels,
    assigneeAccountId: issueData.assignee?.accountId,
  });
}

async function searchRelatedTickets(keywords, projectKey) {
  if (!keywords || !projectKey) return [];
  logger.info('Searching related tickets', { skill: SKILL, keywords, projectKey });
  try {
    const jql = `project = ${projectKey} AND summary ~ "${keywords}" AND statusCategory != Done ORDER BY updated DESC`;
    const data = await request('GET',
      `/search?jql=${encodeURIComponent(jql)}&maxResults=5&fields=summary,status,assignee,created,updated`
    );
    return (data.issues || []).map(i => ({
      key:      i.key,
      summary:  i.fields?.summary || '',
      status:   i.fields?.status?.name || '',
      assignee: i.fields?.assignee?.displayName || null,
      url:      ticketUrl(i.key),
    }));
  } catch (err) {
    logger.debug('Related tickets search failed', { skill: SKILL, error: err.message });
    return [];
  }
}

async function getAvailableProjects() {
  return [
    { key: 'CLICK', name: 'ClickRepuestos ®' },
    { key: 'WYS',   name: 'WebySEO ®' },
  ];
}

async function getProjectMeta(projectKey) {
  return {
    issueTypes: ['Tarea', 'Historia', 'Error', 'Epic'],
    key:        projectKey,
  };
}

function getLinkedTicket(threadId) {
  const db    = require('../db/database');
  const sqlDb = db.getDb();
  const row   = sqlDb.prepare(
    `SELECT detail FROM actions_log WHERE thread_id = ? AND action = 'jira_ticket_created' ORDER BY created_at DESC LIMIT 1`
  ).get(threadId);
  if (!row) return null;
  try {
    const detail = JSON.parse(row.detail);
    return { key: detail.key, url: detail.url };
  } catch { return null; }
}

async function healthCheck() {
  try {
    await request('GET', '/myself');
    return 'connected';
  } catch (e) {
    logger.debug('Jira health check failed', { skill: SKILL, error: e.message });
    return 'disconnected';
  }
}

function normalizeTasks(issues) {
  const { ageDays } = require('../utils/date-helpers');
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return (issues || []).map(issue => {
    const f       = issue.fields || {};
    const dueDate = f.duedate ? new Date(f.duedate) : null;
    const updatedAt = f.updated ? new Date(f.updated) : new Date();
    const overdue   = dueDate ? dueDate < today : false;

    return {
      key:                   issue.key,
      summary:               f.summary || '(sin descripción)',
      status:                f.status?.name || 'Unknown',
      priority:              f.priority?.name || 'Medium',
      due_date:              f.duedate || null,
      due_today:             dueDate ? dueDate.toDateString() === today.toDateString() : false,
      overdue,
      days_overdue:          overdue && dueDate ? ageDays(dueDate) : 0,
      days_without_activity: ageDays(updatedAt),
      assignee:              f.assignee?.displayName || null,
      labels:                f.labels || [],
      url:                   ticketUrl(issue.key),
    };
  });
}

module.exports = {
  getMyTasks, getIssue, getClientTasks,
  createIssue, createTicket,
  searchRelatedTickets, getAvailableProjects, getProjectMeta, getLinkedTicket,
  getActiveSprint, getActiveSprintForProject, moveToSprint,
  healthCheck,
};
