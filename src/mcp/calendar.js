const logger = require('../utils/logger');
const { formatChile } = require('../utils/date-helpers');

const SKILL = 'mcp:calendar';

async function getMCPClient() {
  const url = process.env.CALENDAR_MCP_URL;
  const token = process.env.CALENDAR_ACCESS_TOKEN;
  if (!url || !token) throw new Error('Calendar MCP not configured (CALENDAR_MCP_URL / CALENDAR_ACCESS_TOKEN missing)');

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
    arguments: { time_min: startOfDay, time_max: endOfDay, single_events: true },
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
      time_min: start.toISOString(),
      time_max: end.toISOString(),
      single_events: true,
      max_results: 200,
    },
  });

  await client.close();
  return normalizeEvents(result.content, { includeAttendees: true });
}

async function createEvent(data) {
  logger.info('Creating calendar event', { skill: SKILL, summary: data.summary });
  const client = await getMCPClient();
  const result = await client.callTool({ name: 'create_event', arguments: data });
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
