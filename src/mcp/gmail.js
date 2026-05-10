const logger = require('../utils/logger');

const SKILL = 'mcp:gmail';

async function getMCPClient() {
  const url = process.env.GMAIL_MCP_URL;
  const token = process.env.GMAIL_ACCESS_TOKEN;
  if (!url || !token) throw new Error('Gmail MCP not configured (GMAIL_MCP_URL / GMAIL_ACCESS_TOKEN missing)');

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'jarvis-gmail', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function getUnreadThreads(hours = 12) {
  logger.info('Fetching unread threads', { skill: SKILL, hours });
  const client = await getMCPClient();
  const result = await client.callTool({
    name: 'search_threads',
    arguments: { query: `is:unread newer_than:${hours}h`, max_results: 50 },
  });
  await client.close();
  return normalizeThreads(result.content);
}

async function getSentEmails(days = 7) {
  logger.info('Fetching sent emails', { skill: SKILL, days });
  const client = await getMCPClient();
  const result = await client.callTool({
    name: 'search_threads',
    arguments: { query: `in:sent newer_than:${days}d`, max_results: 100 },
  });
  await client.close();
  return normalizeThreads(result.content, { sent: true });
}

async function searchThreads(query, maxResults = 20) {
  logger.info('Searching threads', { skill: SKILL, query });
  const client = await getMCPClient();
  const result = await client.callTool({
    name: 'search_threads',
    arguments: { query, max_results: maxResults },
  });
  await client.close();
  return normalizeThreads(result.content);
}

async function getThread(threadId) {
  const client = await getMCPClient();
  const result = await client.callTool({ name: 'get_thread', arguments: { thread_id: threadId } });
  await client.close();
  return result.content;
}

async function applyLabel(threadId, labelName) {
  logger.info('Applying label', { skill: SKILL, threadId, labelName });
  const client = await getMCPClient();
  const result = await client.callTool({
    name: 'label_thread',
    arguments: { thread_id: threadId, label_name: labelName },
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
    logger.debug('Gmail health check failed', { skill: SKILL, error: e.message });
    return 'disconnected';
  }
}

function normalizeThreads(raw, opts = {}) {
  if (!Array.isArray(raw)) return [];
  return raw.map(t => ({
    id: t.id || t.threadId,
    subject: t.subject || '(sin asunto)',
    from: t.from || '',
    to: t.to || '',
    snippet: t.snippet || '',
    body: t.body || t.snippet || '',
    date: t.date || t.internalDate,
    unread: !opts.sent,
    sent: !!opts.sent,
  }));
}

module.exports = { getUnreadThreads, getSentEmails, searchThreads, getThread, applyLabel, healthCheck };
