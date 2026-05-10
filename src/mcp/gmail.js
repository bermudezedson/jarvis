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

function decodeBody(part, preferredType = 'text/plain') {
  if (!part) return '';
  if (part.body?.data) {
    return Buffer.from(part.body.data, 'base64').toString('utf-8');
  }
  if (part.parts) {
    const preferred = part.parts.find(p => p.mimeType === preferredType);
    const fallback  = part.parts.find(p => p.mimeType === 'text/plain');
    const html      = part.parts.find(p => p.mimeType === 'text/html');
    return decodeBody(preferred || fallback || html || part.parts[0], preferredType);
  }
  return '';
}

function normalizeThread(t) {
  const messages = t.messages || [];
  const lastMsg  = messages[messages.length - 1];
  const firstMsg = messages[0];
  const lastHdrs  = lastMsg?.payload?.headers  || [];
  const firstHdrs = firstMsg?.payload?.headers || [];

  // Collect every email address that appears anywhere in the thread
  const allParticipants = new Set();
  messages.forEach(m => {
    ['from', 'to', 'cc'].forEach(field => {
      const val = header(m?.payload?.headers || [], field);
      if (val) {
        const emails = val.match(/[a-zA-Z0-9._%+-]+@[\w.-]+/g);
        if (emails) emails.forEach(e => allParticipants.add(e.toLowerCase()));
      }
    });
  });

  const lastFrom      = header(lastHdrs, 'from');
  const lastFromEmail = (lastFrom.match(/[a-zA-Z0-9._%+-]+@[\w.-]+/) || [''])[0].toLowerCase();

  return {
    id:              t.id,
    subject:         header(firstHdrs, 'subject') || header(lastHdrs, 'subject') || '(sin asunto)',
    from:            header(firstHdrs, 'from'),   // original sender
    last_from:       lastFrom,                    // who sent the last message
    last_from_email: lastFromEmail,
    to:              header(lastHdrs, 'to'),
    snippet:         t.snippet || lastMsg?.snippet || '',
    body:            decodeBody(lastMsg?.payload),
    date:            header(lastHdrs,  'date'),   // date of last message
    original_date:   header(firstHdrs, 'date'),   // date thread started
    unread:          (lastMsg?.labelIds || []).includes('UNREAD'),
    sent:            (lastMsg?.labelIds || []).includes('SENT'),
    labels:          lastMsg?.labelIds || [],
    message_count:   messages.length,
    participants:    Array.from(allParticipants),
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

/**
 * Fetch ALL threads (read + unread) involving known client domains.
 * Searches both from: AND to: so we catch both inbound and outbound messages.
 * Used for the client deep-scan — does NOT use is:unread.
 *
 * @param {string[]} clientDomains - domains from clients.yml
 * @param {number}   days          - look-back window (default 30)
 */
async function getClientThreads(clientDomains, days = 30) {
  logger.info('Fetching client threads', { skill: SKILL, domains: clientDomains.length, days });

  const batchSize = 10; // stay under Gmail query-length limit
  const allThreads = [];

  // Threads where a client wrote to us
  for (let i = 0; i < clientDomains.length; i += batchSize) {
    const batch = clientDomains.slice(i, i + batchSize);
    const q = `(${batch.map(d => `from:${d}`).join(' OR ')}) newer_than:${days}d`;
    allThreads.push(...await fetchThreads(q, 100));
  }

  // Threads where we wrote to a client (CEO replied last)
  for (let i = 0; i < clientDomains.length; i += batchSize) {
    const batch = clientDomains.slice(i, i + batchSize);
    const q = `(${batch.map(d => `to:${d}`).join(' OR ')}) newer_than:${days}d`;
    allThreads.push(...await fetchThreads(q, 100));
  }

  // Deduplicate by thread id
  const seen = new Set();
  const unique = allThreads.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  logger.info('Client threads fetched', { skill: SKILL, total: unique.length });
  return unique;
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

/**
 * Returns all messages in a thread with full body content (text + html).
 * Used for the accordion lazy load.
 */
async function getFullThread(threadId) {
  logger.info('Fetching full thread', { skill: SKILL, threadId });
  const t = await gmail('GET', `/threads/${threadId}?format=full`);
  if (!t?.messages) return null;

  const messages = t.messages.map(msg => {
    const hdrs      = msg.payload?.headers || [];
    const fromFull  = header(hdrs, 'from');
    const fromEmail = (fromFull.match(/[a-zA-Z0-9._%+-]+@[\w.-]+/) || [''])[0].toLowerCase();
    return {
      id:        msg.id,
      from:      fromFull,
      from_email: fromEmail,
      to:        header(hdrs, 'to'),
      cc:        header(hdrs, 'cc'),
      bcc:       header(hdrs, 'bcc'),
      reply_to:  header(hdrs, 'reply-to'),
      date:      header(hdrs, 'date'),
      subject:   header(hdrs, 'subject'),
      body_text: decodeBody(msg.payload, 'text/plain'),
      body_html: decodeBody(msg.payload, 'text/html'),
      labels:    msg.labelIds || [],
    };
  });

  return { thread_id: threadId, messages };
}

/**
 * Send a reply to a thread via Gmail API.
 */
async function sendReply(to, subject, body, threadId, cc = '') {
  logger.info('Sending reply', { skill: SKILL, to, cc, threadId });
  const replySubject = subject?.startsWith('Re:') ? subject : `Re: ${subject || ''}`;
  const raw = [
    `To: ${to}`,
    ...(cc ? [`Cc: ${cc}`] : []),
    `Subject: ${replySubject}`,
    'Content-Type: text/plain; charset=utf-8',
    `MIME-Version: 1.0`,
    '',
    body,
  ].join('\r\n');
  const encoded = Buffer.from(raw).toString('base64url');
  return gmail('POST', '/messages/send', { raw: encoded, threadId });
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

// Mark a thread as phishing/spam — moves out of INBOX and signals Google
async function reportPhishing(threadId) {
  logger.info('Reporting phishing', { skill: SKILL, threadId });
  // SPAM label = Google learns it's spam; removing INBOX moves it out
  return gmail('POST', `/threads/${threadId}/modify`, {
    addLabelIds: ['SPAM'],
    removeLabelIds: ['INBOX'],
  });
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

/**
 * Universal inbox scan — fetches ALL threads with activity in the last N minutes.
 * Only downloads metadata (no body), dedup happens in SQLite by thread_id.
 *
 * @param {{ timeWindowMinutes?: number }} options
 */
async function universalInboxScan({ timeWindowMinutes = 90 } = {}) {
  // Use 2h window minimum to compensate Gmail indexing delays; overlap is fine
  // because SQLite deduplicates by thread_id + content_hash
  const hours = Math.max(2, Math.ceil(timeWindowMinutes / 60));
  logger.info('Universal inbox scan', { skill: SKILL, hours });

  const allThreads = [];

  // All threads with inbox activity (read + unread, from any sender)
  allThreads.push(...await fetchThreads(`in:inbox newer_than:${hours}h`, 200));

  // Also grab sent threads (so we catch conversations where CEO wrote last)
  allThreads.push(...await fetchThreads(`in:sent newer_than:${hours}h`, 100));

  // Deduplicate by thread id
  const seen = new Set();
  const unique = allThreads.filter(t => {
    if (seen.has(t.id)) return false;
    seen.add(t.id);
    return true;
  });

  logger.info('Universal scan fetched', { skill: SKILL, total: unique.length });
  return unique;
}

module.exports = {
  getUnreadThreads, getClientThreads, universalInboxScan,
  getSentEmails, searchThreads, getThread,
  getFullThread, sendReply,
  listLabels, applyLabel, removeLabel, createLabel, createDraft,
  reportPhishing, healthCheck,
};
