const https = require('https');
const logger = require('../utils/logger');

const SKILL = 'mcp:gmail';

let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;

  const refreshToken = process.env.GMAIL_REFRESH_TOKEN;
  const clientId = process.env.GMAIL_CLIENT_ID;
  const clientSecret = process.env.GMAIL_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    // Fallback: use static access token if provided
    const staticToken = process.env.GMAIL_ACCESS_TOKEN;
    if (staticToken) return staticToken;
    throw new Error('Gmail OAuth not configured (GMAIL_REFRESH_TOKEN / GMAIL_CLIENT_ID / GMAIL_CLIENT_SECRET missing)');
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: refreshToken,
    client_id: clientId,
    client_secret: clientSecret,
  }).toString();

  const data = await new Promise((resolve, reject) => {
    const req = https.request(
      { hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Content-Length': Buffer.byteLength(body) } },
      res => { let raw = ''; res.on('data', c => raw += c); res.on('end', () => resolve(JSON.parse(raw))); }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });

  if (!data.access_token) throw new Error(`Gmail token refresh failed: ${JSON.stringify(data)}`);
  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3599) * 1000;
  return _cachedToken;
}

async function getMCPClient() {
  const url = process.env.GMAIL_MCP_URL;
  if (!url) throw new Error('Gmail MCP not configured (GMAIL_MCP_URL missing)');

  const token = await getAccessToken();

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
    arguments: { query: `is:unread newer_than:${hours}h`, pageSize: 50 },
  });
  await client.close();
  return normalizeThreads(result.content);
}

async function getSentEmails(days = 7) {
  logger.info('Fetching sent emails', { skill: SKILL, days });
  const client = await getMCPClient();
  const result = await client.callTool({
    name: 'search_threads',
    arguments: { query: `in:sent newer_than:${days}d`, pageSize: 100 },
  });
  await client.close();
  return normalizeThreads(result.content, { sent: true });
}

async function searchThreads(query, maxResults = 20) {
  logger.info('Searching threads', { skill: SKILL, query });
  const client = await getMCPClient();
  const result = await client.callTool({
    name: 'search_threads',
    arguments: { query, pageSize: maxResults },
  });
  await client.close();
  return normalizeThreads(result.content);
}

async function getThread(threadId) {
  const client = await getMCPClient();
  const result = await client.callTool({ name: 'get_thread', arguments: { threadId } });
  await client.close();
  return result.content;
}

async function applyLabel(threadId, labelIds) {
  logger.info('Applying label', { skill: SKILL, threadId, labelIds });
  const client = await getMCPClient();
  const ids = Array.isArray(labelIds) ? labelIds : [labelIds];
  const result = await client.callTool({
    name: 'label_thread',
    arguments: { threadId, labelIds: ids },
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
