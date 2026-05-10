const logger = require('../utils/logger');
const { ageDays } = require('../utils/date-helpers');

const SKILL = 'mcp:jira';

async function getMCPClient() {
  const url = process.env.JIRA_MCP_URL;
  const token = process.env.JIRA_ACCESS_TOKEN;
  if (!url || !token) throw new Error('Jira MCP not configured (JIRA_MCP_URL / JIRA_ACCESS_TOKEN missing)');

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'jarvis-jira', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function getMyTasks() {
  logger.info('Fetching Jira tasks', { skill: SKILL });
  const client = await getMCPClient();
  const userEmail = process.env.JIRA_USER_EMAIL;

  const result = await client.callTool({
    name: 'searchJiraIssuesUsingJql',
    arguments: {
      jql: `assignee = "${userEmail}" AND statusCategory != Done ORDER BY duedate ASC`,
      max_results: 50,
    },
  });

  await client.close();
  return normalizeTasks(result.content);
}

async function getIssue(key) {
  logger.info('Fetching Jira issue', { skill: SKILL, key });
  const client = await getMCPClient();
  const result = await client.callTool({
    name: 'getJiraIssue',
    arguments: { issue_key: key, cloud_id: process.env.JIRA_CLOUD_ID },
  });
  await client.close();
  const tasks = normalizeTasks(Array.isArray(result.content) ? result.content : [result.content]);
  return tasks[0] || null;
}

async function getClientTasks(jiraLabel) {
  logger.info('Fetching client tasks', { skill: SKILL, label: jiraLabel });
  const client = await getMCPClient();
  const result = await client.callTool({
    name: 'searchJiraIssuesUsingJql',
    arguments: {
      jql: `labels = "${jiraLabel}" AND statusCategory != Done ORDER BY updated DESC`,
      max_results: 20,
    },
  });
  await client.close();
  return normalizeTasks(result.content);
}

async function createIssue(data) {
  logger.info('Creating Jira issue', { skill: SKILL, summary: data.summary });
  const client = await getMCPClient();
  const result = await client.callTool({
    name: 'createJiraIssue',
    arguments: { cloud_id: process.env.JIRA_CLOUD_ID, ...data },
  });
  await client.close();
  return result.content;
}

async function healthCheck() {
  try {
    const client = await getMCPClient();
    await client.close();
    return 'connected';
  } catch (e) {
    logger.debug('Jira health check failed', { skill: SKILL, error: e.message });
    return 'disconnected';
  }
}

function normalizeTasks(raw) {
  if (!Array.isArray(raw)) return [];
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  return raw.map(issue => {
    const dueDate = issue.fields?.duedate ? new Date(issue.fields.duedate) : null;
    const overdue = dueDate ? dueDate < today : false;
    const dueToday = dueDate ? dueDate.toDateString() === today.toDateString() : false;
    const updatedAt = issue.fields?.updated ? new Date(issue.fields.updated) : new Date();

    return {
      key: issue.key,
      summary: issue.fields?.summary || '(sin descripción)',
      status: issue.fields?.status?.name || 'Unknown',
      priority: issue.fields?.priority?.name || 'Medium',
      due_date: issue.fields?.duedate || null,
      due_today: dueToday,
      overdue,
      days_overdue: overdue && dueDate ? ageDays(dueDate) : 0,
      days_without_activity: ageDays(updatedAt),
      assignee: issue.fields?.assignee?.displayName || null,
      labels: issue.fields?.labels || [],
    };
  });
}

module.exports = { getMyTasks, getIssue, getClientTasks, createIssue, healthCheck };
