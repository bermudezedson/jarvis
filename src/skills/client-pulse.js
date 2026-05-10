const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const cache = require('../cache/store');
const { ageDays } = require('../utils/date-helpers');
const logger = require('../utils/logger');

const SKILL = 'client-pulse';

const rules = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));
const clientsConfig = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/clients.yml'), 'utf8'));

async function calculatePulse() {
  logger.info('Calculating client pulse', { skill: SKILL });

  const results = await Promise.allSettled(
    clientsConfig.clients.map(c => scoreClient(c))
  );

  const clients = results.map((r, i) => {
    if (r.status === 'rejected') {
      logger.warn('Client score failed', { skill: SKILL, client: clientsConfig.clients[i].name, error: r.reason?.message });
      return fallbackScore(clientsConfig.clients[i]);
    }
    return r.value;
  });

  // Worst first — critical clients at top
  clients.sort((a, b) => a.score - b.score);

  const pulse = {
    calculated_at: new Date().toISOString(),
    is_mock: false,
    summary: {
      healthy: clients.filter(c => c.status === 'healthy').length,
      at_risk: clients.filter(c => c.status === 'at_risk').length,
      critical: clients.filter(c => c.status === 'critical').length,
    },
    clients,
  };

  cache.write('client-pulse.json', pulse);
  logger.info('Client pulse saved', { skill: SKILL, ...pulse.summary });
  return pulse;
}

// Derive a display tier from the billing frequency in clients.yml
function deriveTier(client) {
  const map = { recurrente: 'premium', anual: 'standard', esporadico: 'trial' };
  return map[client.facturacion] || 'standard';
}

// empresa field can be a string or array — normalise to array
function empresas(client) {
  return Array.isArray(client.empresa) ? client.empresa : [client.empresa];
}

async function scoreClient(client) {
  const weights  = rules.clients.health_weights;
  const staleDays = rules.clients.stale_contact_days;

  const [emailAgeDays, meetingAgeDays, openTickets] = await Promise.all([
    getLastEmailAgeDays(client, staleDays),
    getLastMeetingAgeDays(client, staleDays),
    getOpenTicketCount(client),
  ]);

  const emailScore   = Math.max(0, 1 - emailAgeDays / staleDays);
  const meetingScore = Math.max(0, 1 - meetingAgeDays / staleDays);
  // 0 tickets = 1.0, 5+ tickets = 0.0
  const ticketScore  = Math.max(0, 1 - openTickets / 5);
  // Response time not yet tracked — default 0.8 (good)
  const responseScore = 0.8;

  const total = Math.round((
    emailScore   * weights.last_email    +
    meetingScore * weights.last_meeting  +
    ticketScore  * weights.open_tickets  +
    responseScore * weights.response_time
  ) * 100) / 100;

  const status = total >= 0.7 ? 'healthy' : total >= 0.4 ? 'at_risk' : 'critical';

  return {
    name:    client.name,
    tier:    deriveTier(client),
    empresa: empresas(client),
    score:   total,
    status,
    breakdown: {
      email_score:            round2(emailScore),
      meeting_score:          round2(meetingScore),
      ticket_score:           round2(ticketScore),
      response_score:         round2(responseScore),
      last_email_age_days:    Math.round(emailAgeDays),
      last_meeting_age_days:  Math.round(meetingAgeDays),
      open_tickets:           openTickets,
    },
    alert: status !== 'healthy'
      ? buildAlert(client, emailAgeDays, meetingAgeDays, openTickets, staleDays)
      : null,
  };
}

async function getLastEmailAgeDays(client, staleDays) {
  try {
    const gmail = require('../mcp/gmail');
    const query = client.domains.map(d => `from:${d} OR to:${d}`).join(' OR ');
    const threads = await gmail.searchThreads(query, 1);
    if (!threads.length) return staleDays + 1;
    return Math.max(0, ageDays(new Date(threads[0].date)));
  } catch {
    return staleDays + 1;
  }
}

async function getLastMeetingAgeDays(client, staleDays) {
  try {
    const calendar = require('../mcp/calendar');
    const events = await calendar.getPastEvents(90);
    const clientMeetings = events.filter(e =>
      (e.attendees || []).some(a => client.contacts.includes(a.email))
    );
    if (!clientMeetings.length) return staleDays + 1;
    const latest = clientMeetings.sort((a, b) => new Date(b.start) - new Date(a.start))[0];
    return Math.max(0, ageDays(new Date(latest.start)));
  } catch {
    return staleDays + 1;
  }
}

async function getOpenTicketCount(client) {
  try {
    const jira = require('../mcp/jira');
    const tasks = await jira.getClientTasks(client.jira_label);
    return tasks.filter(t => !['Done', 'Closed', 'Cancelled'].includes(t.status)).length;
  } catch {
    return 0;
  }
}

function buildAlert(client, emailAge, meetingAge, openTickets, staleDays) {
  const reasons = [];
  if (emailAge > staleDays) reasons.push(`sin email hace ${Math.round(emailAge)}d`);
  if (meetingAge > staleDays) reasons.push(`sin reunión hace ${Math.round(meetingAge)}d`);
  if (openTickets >= 3) reasons.push(`${openTickets} tickets abiertos`);
  return reasons.join(' · ');
}

function fallbackScore(client) {
  return {
    name:    client.name,
    tier:    deriveTier(client),
    empresa: Array.isArray(client.empresa) ? client.empresa : [client.empresa],
    score:   null,
    status:  'unknown',
    breakdown: null,
    alert: 'Error al calcular — datos no disponibles',
  };
}

function getPulse() {
  return cache.read('client-pulse.json') || cache.read('mock-client-pulse.json');
}

function round2(n) { return Math.round(n * 100) / 100; }

module.exports = { calculatePulse, scoreClient, getPulse };
