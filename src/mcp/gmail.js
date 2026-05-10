const https = require('https');
const logger = require('../utils/logger');

const SKILL = 'mcp:gmail';
const BASE = 'gmail.googleapis.com';
const USER = 'me';

let _cachedToken = null;
let _tokenExpiry = 0;

// ─── OAuth2 ───────────────────────────────────────────────────────────────────

async function getAccessToken() {
  if (_cachedToken && Date.now() < _tokenExpiry - 60_000) return _cachedToken;

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: process.env.GMAIL_REFRESH_TOKEN,
    client_id: process.env.GMAIL_CLIENT_ID,
    client_secret: process.env.GMAIL_CLIENT_SECRET,
  }).toString();

  const data = await request({ hostname: 'oauth2.googleapis.com', path: '/token', method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' } }, body);

  if (!data.access_token) throw new Error(`Gmail token refresh failed: ${JSON.stringify(data)}`);
  _cachedToken = data.access_token;
  _tokenExpiry = Date.now() + (data.expires_in || 3599) * 1000;
  return _cachedToken;
}

// ─── HTTP helper ──────────────────────────────────────────────────────────────

function request(opts, body) {
  return new Promise((resolve, reject) => {
    const payload = body ? (typeof body === 'string' ? body : JSON.stringify(body)) : null;
    const options = {
      ...opts,
      headers: {
        ...opts.headers,
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}),
      },
    };
    const req = https.request(options, res => {
      let raw = '';
      res.on('data', c => raw += c);
      res.on('end', () => {
        try { resolve(JSON.parse(raw)); }
        catch { resolve(raw); }
      });
    });
    req.on('error', reject);
    if (payload) req.write(payload);
    req.end();
  });
}

async function gmail(method, path, body) {
  const token = await getAccessToken();
  return request({
    hostname: BASE,
    path: `/gmail/v1/users/${USER}${path}`,
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
  }, body);
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function header(headers, name) {
  return headers?.find(h => h.name.toLowerCase() === name.toLowerCase())?.value || '';
}

function decodeBody(part) {
  if (!part) return '';
  if (part.body?.data) {
    return Buffer.from(part.body.data, 'base64').toString('utf-8');
  }
  if (part.parts) {
    const text = part.parts.find(p => p.mimeType === 'text/plain');
    const html = part.parts.find(p => p.mimeType === 'text/html');
    return decodeBody(text || html || part.parts[0]);
  }
  return '';
}

function normalizeThread(t) {
  const msg = t.messages?.[t.messages.length - 1];
  const hdrs = msg?.payload?.headers || [];
  return {
    id: t.id,
    subject: header(hdrs, 'subject') || '(sin asunto)',
    from: header(hdrs, 'from'),
    to: header(hdrs, 'to'),
    snippet: t.snippet || msg?.snippet || '',
    body: decodeBody(msg?.payload),
    date: header(hdrs, 'date'),
    unread: (msg?.labelIds || []).includes('UNREAD'),
    sent: (msg?.labelIds || []).includes('SENT'),
    labels: msg?.labelIds || [],
    message_count: t.messages?.length || 1,
  };
}

async function fetchThreads(query, maxResults = 50) {
  const params = new URLSearchParams({ q: query, maxResults });
  const list = await gmail('GET', `/threads?${params}`);
  if (!list.threads?.length) return [];

  const threads = await Promise.all(
    list.threads.map(t => gmail('GET', `/threads/${t.id}?format=full`))
  );
  return threads.map(normalizeThread);
}

// ─── Public API ───────────────────────────────────────────────────────────────

async function getUnreadThreads(hours = 12) {
  logger.info('Fetching unread threads', { skill: SKILL, hours });
  return fetchThreads(`is:unread newer_than:${hours}h`, 50);
}

async function getSentEmails(days = 7) {
  logger.info('Fetching sent emails', { skill: SKILL, days });
  return fetchThreads(`in:sent newer_than:${days}d`, 100);
}

async function searchThreads(query, maxResults = 20) {
  logger.info('Searching threads', { skill: SKILL, query });
  return fetchThreads(query, maxResults);
}

async function getThread(threadId) {
  logger.info('Fetching thread', { skill: SKILL, threadId });
  const t = await gmail('GET', `/threads/${threadId}?format=full`);
  return normalizeThread(t);
}

async function listLabels() {
  logger.info('Listing labels', { skill: SKILL });
  const data = await gmail('GET', '/labels');
  return (data.labels || []).map(l => ({ id: l.id, name: l.name, type: l.type }));
}

async function applyLabel(threadId, labelIds) {
  logger.info('Applying label', { skill: SKILL, threadId, labelIds });
  const ids = Array.isArray(labelIds) ? labelIds : [labelIds];
  return gmail('POST', `/threads/${threadId}/modify`, { addLabelIds: ids });
}

async function removeLabel(threadId, labelIds) {
  logger.info('Removing label', { skill: SKILL, threadId, labelIds });
  const ids = Array.isArray(labelIds) ? labelIds : [labelIds];
  return gmail('POST', `/threads/${threadId}/modify`, { removeLabelIds: ids });
}

async function createLabel(name, color) {
  logger.info('Creating label', { skill: SKILL, name });
  const body = { name, labelListVisibility: 'labelShow', messageListVisibility: 'show' };
  if (color) body.color = color;
  return gmail('POST', '/labels', body);
}

async function createDraft(to, subject, body, replyToMessageId) {
  logger.info('Creating draft', { skill: SKILL, to, subject });
  const raw = [
    `To: ${to}`,
    `Subject: ${subject}`,
    'Content-Type: text/plain; charset=utf-8',
    '',
    body,
  ].join('\r\n');
  const encoded = Buffer.from(raw).toString('base64url');
  const payload = { message: { raw: encoded } };
  if (replyToMessageId) payload.message.threadId = replyToMessageId;
  return gmail('POST', '/drafts', payload);
}

async function healthCheck() {
  try {
    const profile = await gmail('GET', '/profile');
    if (profile.emailAddress) return 'connected';
    return 'disconnected';
  } catch (e) {
    logger.debug('Gmail health check failed', { skill: SKILL, error: e.message });
    return 'disconnected';
  }
}

module.exports = {
  getUnreadThreads, getSentEmails, searchThreads, getThread,
  listLabels, applyLabel, removeLabel, createLabel, createDraft,
  healthCheck,
};
