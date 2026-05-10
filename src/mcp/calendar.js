const https = require('https');
const logger = require('../utils/logger');
const { formatChile } = require('../utils/date-helpers');

const SKILL = 'mcp:calendar';

let _cachedToken = null;
let _tokenExpiry = 0;

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;

  const refreshToken = process.env.CALENDAR_REFRESH_TOKEN;
  const clientId = process.env.CALENDAR_CLIENT_ID;
  const clientSecret = process.env.CALENDAR_CLIENT_SECRET;

  if (!refreshToken || !clientId || !clientSecret) {
    const staticToken = process.env.CALENDAR_ACCESS_TOKEN;
    if (staticToken) return staticToken;
    throw new Error('Calendar OAuth not configured (CALENDAR_REFRESH_TOKEN / CALENDAR_CLIENT_ID / CALENDAR_CLIENT_SECRET missing)');
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

  if (!data.access_token) throw new Error(`Calendar token refresh failed: ${JSON.stringify(data)}`);
  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3599) * 1000;
  return _cachedToken;
}

async function getMCPClient() {
  const url = process.env.CALENDAR_MCP_URL;
  if (!url) throw new Error('Calendar MCP not configured (CALENDAR_MCP_URL missing)');

  const token = await getAccessToken();

  const { Client } = await import('@modelcontextprotocol/sdk/client/index.js');
  const { StreamableHTTPClientTransport } = await import('@modelcontextprotocol/sdk/client/streamableHttp.js');

  const transport = new StreamableHTTPClientTransport(new URL(url), {
    requestInit: { headers: { Authorization: `Bearer ${token}` } },
  });
  const client = new Client({ name: 'jarvis-calendar', version: '1.0.0' });
  await client.connect(transport);
  return client;
}

async function getTodayEvents() {
  logger.info('Fetching today events', { skill: SKILL });
  const client = await getMCPClient();

  const now = new Date();
  const startOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate()).toISOString();
  const endOfDay = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59).toISOString();

  const result = await client.callTool({
    name: 'list_events',
    arguments: { startTime: startOfDay, endTime: endOfDay, timeZone: 'America/Santiago' },
  });

  await client.close();
  return normalizeEvents(result.content);
}

async function getPastEvents(days = 30) {
  logger.info('Fetching past events', { skill: SKILL, days });
  const client = await getMCPClient();

  const end = new Date();
  const start = new Date(Date.now() - days * 86400000);

  const result = await client.callTool({
    name: 'list_events',
    arguments: {
      startTime: start.toISOString(),
      endTime: end.toISOString(),
      pageSize: 200,
      timeZone: 'America/Santiago',
    },
  });

  await client.close();
  return normalizeEvents(result.content, { includeAttendees: true });
}

async function createEvent(data) {
  logger.info('Creating calendar event', { skill: SKILL, summary: data.summary });
  const client = await getMCPClient();
  const result = await client.callTool({ name: 'create_event', arguments: { timeZone: 'America/Santiago', ...data } });
  await client.close();
  return result.content;
}

async function updateEvent(eventId, data) {
  logger.info('Updating calendar event', { skill: SKILL, eventId });
  const client = await getMCPClient();
  const result = await client.callTool({ name: 'update_event', arguments: { eventId, ...data } });
  await client.close();
  return result.content;
}

async function deleteEvent(eventId) {
  logger.info('Deleting calendar event', { skill: SKILL, eventId });
  const client = await getMCPClient();
  const result = await client.callTool({ name: 'delete_event', arguments: { eventId } });
  await client.close();
  return result.content;
}

async function healthCheck() {
  try {
    const client = await getMCPClient();
    await client.close();
    return 'connected';
  } catch (e) {
    logger.debug('Calendar health check failed', { skill: SKILL, error: e.message });
    return 'disconnected';
  }
}

function normalizeEvents(raw, opts = {}) {
  if (!Array.isArray(raw)) return [];
  return raw.map(e => ({
    id: e.id,
    title: e.summary || '(sin título)',
    start: e.start?.dateTime || e.start?.date,
    end: e.end?.dateTime || e.end?.date,
    start_time: e.start?.dateTime ? formatChile(e.start.dateTime, 'HH:mm') : '00:00',
    end_time: e.end?.dateTime ? formatChile(e.end.dateTime, 'HH:mm') : '23:59',
    attendees_count: (e.attendees || []).length,
    attendees: opts.includeAttendees ? (e.attendees || []).map(a => ({ email: a.email, name: a.displayName })) : undefined,
    location: e.location || null,
  }));
}

module.exports = { getTodayEvents, getPastEvents, createEvent, healthCheck };
