const fs = require('fs');
const path = require('path');
const yaml = require('js-yaml');
const cache = require('../cache/store');
const logger = require('../utils/logger');

const SKILL = 'mail-ops';

const rules = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));
const clientsConfig = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/clients.yml'), 'utf8'));

// ─── Categories ───────────────────────────────────────────────────────────────
const CATEGORIES = {
  SOLICITUD_CLIENTE:  'solicitud_cliente',   // Client needs action/response
  SEGUIMIENTO:        'seguimiento',          // Needs follow-up
  FACTURA:            'factura',              // Invoice / billing received (you owe)
  CUENTA_POR_PAGAR:   'cuenta_por_pagar',    // Subscription/service with payment failure
  PAGO_RECIBIDO:      'pago_recibido',       // Payment confirmation — client paid you
  COBRO_PENDIENTE:    'cobro_pendiente',     // Client owes YOU money — collect
  ESTAFA:             'estafa',              // Phishing / scam (brand impersonation)
  ENVIO:              'envio',               // Shipping / package tracking
  SUSCRIPCION:        'suscripcion',          // Newsletter / marketing
  SPAM:               'spam',                 // Spam / phishing
  NOTIFICACION:       'notificacion',         // Auto notifications (Google, systems)
  INTERNO:            'interno',              // Own domain emails
  OTRO:               'otro',                 // Unclassified
};

// ─── Main classify function ───────────────────────────────────────────────────

// ─── ERP / system noise filter ────────────────────────────────────────────────

function shouldExclude(t) {
  const patterns = rules.mail.exclude_patterns || [];
  const subject  = (t.subject || '').toLowerCase();
  const from     = (t.from    || '').toLowerCase();
  return patterns.some(p => subject.includes(p.toLowerCase()) || from.includes(p.toLowerCase()));
}

// ─── Main classify function ───────────────────────────────────────────────────

async function classify(hours = 48) {
  logger.info('Classifying emails', { skill: SKILL, hours });
  const gmail = require('../mcp/gmail');
  const threads = await gmail.getUnreadThreads(hours);

  // Pre-filter: strip ERP / system noise before any classification
  const filtered  = threads.filter(t => !shouldExclude(t));
  const excluded  = threads.length - filtered.length;
  if (excluded > 0) logger.info('Excluded system/ERP threads', { skill: SKILL, excluded });

  // Classify in parallel (cap at 10 concurrent to avoid rate limits)
  const classified = [];
  for (let i = 0; i < filtered.length; i += 10) {
    const batch = filtered.slice(i, i + 10);
    const results = await Promise.all(batch.map(t => classifyThread(t)));
    classified.push(...results);
  }

  // Try AI classification if key is available
  if (process.env.ANTHROPIC_API_KEY) {
    const needsAI = classified.filter(c => c.category === CATEGORIES.OTRO || c.ai_needed);
    logger.info('AI enhancement', { skill: SKILL, items: needsAI.length });
    if (needsAI.length > 0) {
      await enhanceWithAI(needsAI);
    }
  }

  const result = {
    classified_at:  new Date().toISOString(),
    hours_window:   hours,
    total:          classified.length,
    excluded:       excluded,
    by_category:    countByCategory(classified),
    by_estado:      countByEstado(classified),
    needs_action:   classified.filter(c => needsAction(c)).length,
    items:          classified,
  };

  cache.write('mail-classifications.json', result);
  logger.info('Classification done', { skill: SKILL, total: result.total, needs_action: result.needs_action });
  return result;
}

// ─── Thread classifier ────────────────────────────────────────────────────────

function classifyThread(t) {
  const fromDomain = extractDomain(t.from);
  const fromEmail = extractEmail(t.from);
  const text = `${t.subject} ${t.snippet}`.toLowerCase();
  const client = matchClient(fromDomain, fromEmail);

  // 1. Internal email
  if (['clickrepuestos.cl', 'webyseo.cl'].includes(fromDomain)) {
    return build(t, CATEGORIES.INTERNO, 'low', client, { accion: 'archivar' });
  }

  // 2. Phishing / brand impersonation — MUST run before subscription/invoice checks
  //    (fake Netflix "payment update" would otherwise match isPaymentError)
  if (isPhishing(t, fromDomain)) {
    return build(t, CATEGORIES.ESTAFA, 'high', null, { accion: 'eliminar' });
  }

  // 3. Known spam domain
  if (isSpamDomain(fromDomain)) {
    return build(t, CATEGORIES.SPAM, 'low', null, { accion: 'eliminar' });
  }

  // 4. Subscription domain or signals — escalate to cuenta_por_pagar if payment failed
  if (isSubscription(t) || isSubscriptionDomain(fromDomain)) {
    if (isPaymentError(text)) {
      return build(t, CATEGORIES.CUENTA_POR_PAGAR, 'high', null, { accion: 'revisar' });
    }
    return build(t, CATEGORIES.SUSCRIPCION, 'low', null, { accion: 'archivar' });
  }

  // 5. Shipping / package tracking
  if (isShipping(text, fromDomain)) {
    return build(t, CATEGORIES.ENVIO, 'low', null, { accion: 'archivar' });
  }

  // 6. Auto-notifications (Google, Atlassian, systems)
  if (isNotification(t, fromDomain)) {
    return build(t, CATEGORIES.NOTIFICACION, 'low', null, { accion: 'archivar' });
  }

  // 7. Payment received — client paid you (Transbank, Fintoc, transfer confirmation)
  if (isPaymentReceived(text, fromDomain)) {
    return build(t, CATEGORIES.PAGO_RECIBIDO, 'low', client, { accion: 'archivar' });
  }

  // 7b. Cobro pendiente — someone (client or supplier) has an outstanding amount
  if (isCobroPendiente(text)) {
    const severity = client ? 'high' : 'medium';
    return build(t, CATEGORIES.COBRO_PENDIENTE, severity, client, { accion: 'revisar' });
  }

  // 8. Invoice / billing received (you owe someone)
  if (isInvoice(text)) {
    const severity = client ? 'medium' : 'low';
    return build(t, CATEGORIES.FACTURA, severity, client, { accion: client ? 'revisar' : 'archivar' });
  }

  // 8. Known client
  if (client) {
    const priority = hasPriorityKeyword(text);
    const isRequest = hasClientRequestKeyword(text);
    const severity = priority ? 'high' : isRequest ? 'medium' : 'low';
    const cat = priority || isRequest ? CATEGORIES.SOLICITUD_CLIENTE : CATEGORIES.SEGUIMIENTO;
    return build(t, cat, severity, client, { accion: 'responder', jira_suggested: isRequest || priority });
  }

  // 9. Unknown — flag for AI or manual review
  return build(t, CATEGORIES.OTRO, 'low', null, { accion: 'revisar', ai_needed: true });
}

function build(t, category, severity, client, extra = {}) {
  return {
    thread_id: t.id,
    subject: t.subject,
    from: t.from,
    date: t.date,
    snippet: t.snippet,
    category,
    severity,
    client: client ? {
      name: client.name,
      domain: client.domains[0],
      empresa: client.empresa,
      jira_label: client.jira_label,
    } : null,
    needs_action:    needsActionFromCategory(category),
    accion_sugerida: extra.accion || 'revisar',
    jira_suggested:  extra.jira_suggested || false,
    ai_needed:       extra.ai_needed || false,
    aprobado:        null,   // null = pendiente, true = aprobado, false = rechazado
    // ── Lifecycle state ──────────────────────────────────────────────────────
    // pendiente          → not yet acted upon
    // esperando_cliente  → we replied, ball is in client's court
    // esperando_nosotros → client replied, we need to act
    // en_jira            → escalated to a Jira task
    // archivado          → resolved, no action needed
    estado: extra.estado || 'pendiente',
  };
}

// ─── Detection helpers ────────────────────────────────────────────────────────

function isSpamDomain(domain) {
  return rules.mail.spam_domains.some(d => domain?.includes(d));
}

function isSubscription(t) {
  const from = t.from?.toLowerCase() || '';
  const body = `${t.subject} ${t.snippet} ${t.body || ''}`.toLowerCase();
  if (from.includes('noreply') || from.includes('no-reply')) return true;
  return rules.mail.subscription_signals.some(s => body.includes(s.toLowerCase()));
}

function isNotification(t, domain) {
  const notifDomains = [
    'google.com', 'atlassian.com', 'jira.com', 'github.com', 'slack.com',
    'copecpay.cl', 'mercadopago.com', 'transbank.cl', 'fintoc.com',
    'khipu.com', 'flow.cl',
  ];
  if (notifDomains.some(d => domain?.includes(d))) return true;
  const from = t.from?.toLowerCase() || '';
  if (from.includes('notification') || from.includes('alert') || from.includes('automated')) return true;
  // Jira notifications
  if (from.includes('jira@') || t.subject?.includes('[Jira]') || t.subject?.includes('[JIRA]')) return true;
  // Bank / payment transfers
  const text = `${t.subject} ${t.snippet}`.toLowerCase();
  if (text.includes('transferencia') && (text.includes('recibiste') || text.includes('realizó'))) return true;
  return false;
}

// Maps brand keyword → legitimate domain fragment
// If brand name appears in display name/subject but domain doesn't match → phishing
const BRAND_DOMAINS = {
  'netflix':      'netflix.com',
  'netflx':       'netflix.com',   // typosquat variant
  'apple':        'apple.com',
  'paypal':       'paypal.com',
  'amazon':       'amazon.com',
  'mercadopago':  'mercadopago',
  'bancoestado':  'bancoestado.cl',
  'santander':    'santander.cl',
  'bci':          'bci.cl',
  'scotiabank':   'scotiabank.cl',
  'itau':         'itau.cl',
  'microsoft':    'microsoft.com',
  'outlook':      'microsoft.com',
  'google':       'google.com',
  'facebook':     'facebook.com',
  'instagram':    'instagram.com',
  'whatsapp':     'whatsapp.com',
  'dhl':          'dhl.com',
  'correos de chile': 'correoschile.cl',
};

function normalizeLookAlike(s) {
  // Replace common look-alike characters used in phishing display names
  return s.replace(/[IÍÌ]/g, 'i').replace(/[0]/g, 'o').replace(/[1]/g, 'l');
}

function isPhishing(t, fromDomain) {
  const displayName = normalizeLookAlike((t.from || '').toLowerCase());
  const subject     = normalizeLookAlike((t.subject || '').toLowerCase());

  for (const [brand, legitimateDomain] of Object.entries(BRAND_DOMAINS)) {
    const domainRoot = legitimateDomain.split('.')[0]; // e.g. "netflix"
    if (displayName.includes(brand) || subject.includes(brand)) {
      // If the sending domain does NOT contain the brand's root → impersonation
      if (!fromDomain.includes(domainRoot)) {
        return true;
      }
    }
  }
  return false;
}

function isShipping(text, domain) {
  const shippingDomains = ['dhl.com', 'fedex.com', 'ups.com', 'correoschile.cl', 'chilexpress.cl', 'starken.cl', 'bluexpress.cl'];
  if (shippingDomains.some(d => domain?.includes(d))) return true;
  const signals = [
    'tu pedido', 'tu envío', 'en camino', 'número de seguimiento', 'tracking number',
    'out for delivery', 'ha sido despachado', 'llegará hoy', 'entrega programada',
    'tu paquete', 'pedido confirmado', 'pedido enviado', 'pedido despachado',
    'seguimiento de envío', 'estado de tu envío', 'despacho', 'guía de despacho',
  ];
  return signals.some(s => text.includes(s));
}

function isPaymentReceived(text, domain) {
  // Payment processors that send confirmations
  const payDomains = ['transbank.cl', 'fintoc.com', 'khipu.com', 'flow.cl', 'mercadopago.com'];
  if (payDomains.some(d => domain?.includes(d))) return true;
  const signals = [
    'transferencia recibida', 'pago recibido', 'cobro exitoso', 'pago confirmado',
    'transacción exitosa', 'depósito recibido', 'abono recibido', 'tu cobro fue procesado',
    'se acreditó', 'se abonó', 'recibiste un pago', 'pago aprobado',
    'compra aprobada', 'venta aprobada',
  ];
  return signals.some(s => text.includes(s));
}

function isCobroPendiente(text) {
  const signals = [
    'recordatorio de pago', 'factura vencida', 'deuda pendiente', 'cobro pendiente',
    'saldo pendiente', 'pago atrasado', 'cuenta vencida', 'aviso de cobranza',
    'deuda en mora', 'gestión de cobranza', 'plazo vencido',
    'su factura no ha sido pagada', 'factura sin pagar', 'pago no recibido',
  ];
  return signals.some(s => text.includes(s));
}

function isPaymentError(text) {
  const signals = [
    'error en el pago', 'pago fallido', 'cobro fallido', 'tarjeta declinada',
    'problema con tu pago', 'payment failed', 'payment error', 'cargo rechazado',
    'no pudimos procesar', 'método de pago', 'actualiza tu método',
    'fallo en el cobro', 'no se pudo cobrar', 'renovación fallida',
  ];
  return signals.some(s => text.includes(s));
}

function isSubscriptionDomain(domain) {
  const subDomains = ['mercadolibre.com', 'mercadolibre.cl', 'semrush.com', 'linkedin.com', 'twitter.com', 'facebook.com'];
  return subDomains.some(d => domain?.includes(d));
}

function isInvoice(text) {
  return ['factura', 'boleta', 'cobro', 'pago pendiente', 'invoice'].some(kw => text.includes(kw));
}

function hasPriorityKeyword(text) {
  return rules.mail.priority_keywords.some(kw => text.includes(kw.toLowerCase()));
}

function hasClientRequestKeyword(text) {
  return rules.mail.client_request_keywords.some(kw => text.includes(kw.toLowerCase()));
}

function matchClient(domain, email) {
  for (const c of clientsConfig.clients) {
    if (c.domains.some(d => domain?.includes(d))) return c;
    if (c.contacts.some(ct => ct.toLowerCase() === email?.toLowerCase())) return c;
  }
  return null;
}

function needsActionFromCategory(cat) {
  return [
    CATEGORIES.SOLICITUD_CLIENTE,
    CATEGORIES.SEGUIMIENTO,
    CATEGORIES.FACTURA,
    CATEGORIES.CUENTA_POR_PAGAR,
    CATEGORIES.COBRO_PENDIENTE,
  ].includes(cat);
}

function needsAction(c) {
  return c.needs_action;
}

function extractDomain(from) {
  const match = from?.match(/@([\w.-]+)/);
  return match ? match[1].toLowerCase() : '';
}

function extractEmail(from) {
  const match = from?.match(/[a-zA-Z0-9._%+-]+@[\w.-]+/);
  return match ? match[0].toLowerCase() : '';
}

function countByCategory(classified) {
  const counts = {};
  classified.forEach(c => { counts[c.category] = (counts[c.category] || 0) + 1; });
  return counts;
}

function countByEstado(classified) {
  const counts = { pendiente: 0, esperando_cliente: 0, esperando_nosotros: 0, en_jira: 0, archivado: 0 };
  classified.forEach(c => { counts[c.estado] = (counts[c.estado] || 0) + 1; });
  return counts;
}

// ─── Client deep-scan ─────────────────────────────────────────────────────────

const db = require('../db/database');

function calculateSeverity(lastSenderIsMe, daysSince) {
  if (lastSenderIsMe) {
    if (daysSince > 14) return 'high';
    if (daysSince > 7)  return 'medium';
    return 'low';
  } else {
    if (daysSince > 7) return 'high';
    if (daysSince > 2) return 'medium';
    return 'low';
  }
}

function calculateEstado(lastSenderIsMe, daysSince) {
  return lastSenderIsMe ? 'esperando_cliente' : 'esperando_nosotros';
}

function sortAndBuild(classified, mode, days, stats) {
  const sevOrder = { high: 0, medium: 1, low: 2 };
  classified.sort((a, b) =>
    sevOrder[a.severity] !== sevOrder[b.severity]
      ? sevOrder[a.severity] - sevOrder[b.severity]
      : b.days_since_last - a.days_since_last
  );

  const byEstado = {};
  const byClient = {};
  classified.forEach(c => {
    byEstado[c.estado]      = (byEstado[c.estado]      || 0) + 1;
    if (c.client?.name) byClient[c.client.name] = (byClient[c.client.name] || 0) + 1;
  });

  const result = {
    scan_type:               mode,
    scanned_at:              new Date().toISOString(),
    days_window:             days,
    total_client_threads:    classified.length,
    requiring_my_action:     classified.filter(c => !c.last_sender_is_me).length,
    waiting_client_response: classified.filter(c =>  c.last_sender_is_me).length,
    high_severity:           classified.filter(c => c.severity === 'high').length,
    scan_stats:              stats,
    by_estado:               byEstado,
    by_client:               byClient,
    items:                   classified,
  };

  cache.write('client-threads.json', result);
  return result;
}

/** Build summary directly from SQLite (used by refresh_states and incremental merge). */
function sortAndBuildFromDb(stats, mode, days) {
  const result = db.getClientThreadsSummary(stats);
  result.scan_type   = mode;
  result.days_window = days;
  cache.write('client-threads.json', result);
  return result;
}

/**
 * Recalculate severity/estado from SQLite.
 * Zero Gmail API calls.
 */
function refreshStatesFromCache() {
  const sqlDb = db.getDb();
  // Only update actionable threads — skip resolved/archived/jira/informativo
  const active = sqlDb.prepare(`
    SELECT * FROM threads
    WHERE estado NOT IN ('solucionado','archivado','en_jira','informativo')
  `).all();

  const updateStmt = sqlDb.prepare(`
    UPDATE threads SET
      severity      = ?,
      estado        = ?,
      jira_suggested= ?,
      updated_at    = datetime('now')
    WHERE thread_id = ?
  `);

  let updated = 0;
  for (const row of active) {
    const daysSince = Math.max(0, Math.floor((Date.now() - new Date(row.date).getTime()) / 86400000));
    const lsim = !!row.last_sender_is_me;
    const newSeverity = calculateSeverity(lsim, daysSince);
    const newEstado   = calculateEstado(lsim, daysSince);
    const newJira     = daysSince > 7 ? 1 : 0;
    updateStmt.run(newSeverity, newEstado, newJira, row.thread_id);
    updated++;
  }

  const stats = { total: active.length, new: 0, updated, skipped: 0 };
  logger.info('Client refresh_states done (SQLite)', { skill: SKILL, updated });
  return sortAndBuildFromDb(stats, 'refresh_states', null);
}

/**
 * Scan client threads with smart caching.
 *
 * @param {Object} options
 * @param {'initial'|'incremental'|'refresh_states'} options.mode
 * @param {number}  options.days - only used for mode='initial' (default: 30)
 */
async function classifyClientThreads({ mode = 'initial', days = 30 } = {}) {
  logger.info('Client scan', { skill: SKILL, mode, days });

  // ─── Mode: refresh_states — no Gmail calls ───────────────────────────────────
  if (mode === 'refresh_states') {
    return refreshStatesFromCache();
  }

  const gmail = require('../mcp/gmail');

  // Collect all unique client domains
  const allDomains = [];
  clientsConfig.clients.forEach(c => {
    c.domains.forEach(d => { if (!allDomains.includes(d)) allDomains.push(d); });
  });

  let threads;

  if (mode === 'incremental') {
    // ─── Mode: incremental — only fetch since last scan ──────────────────────────
    const lastScan = db.getLastScan();
    if (!lastScan) {
      logger.info('No previous scan found, forcing initial', { skill: SKILL });
      return classifyClientThreads({ mode: 'initial', days });
    }
    const hoursSince = Math.ceil((Date.now() - new Date(lastScan).getTime()) / (1000 * 60 * 60));
    const scanDays   = Math.max(1, Math.ceil(hoursSince / 24));
    logger.info('Incremental scan window', { skill: SKILL, lastScan, hoursSince, scanDays });
    threads = await gmail.getClientThreads(allDomains, scanDays);
  } else {
    // ─── Mode: initial — full window scan ────────────────────────────────────────
    threads = await gmail.getClientThreads(allDomains, days);
  }

  const filtered = threads.filter(t => !shouldExclude(t));

  // ─── Team / CEO config from rules.yml ────────────────────────────────────────
  const teamDomains = (rules.team?.domains || ['clickrepuestos.cl', 'webyseo.cl'])
    .map(d => d.toLowerCase());
  const ceoEmails = (rules.team?.ceo_emails || [
    process.env.CEO_EMAIL || 'alejandro@webyseo.cl',
    'alejandro@clickrepuestos.cl',
    'hablemos@clickrepuestos.cl',
  ]).map(e => e.toLowerCase());
  const noActionPatterns = (rules.mail?.no_action_patterns || []).map(p => p.toLowerCase());

  const stats = { total: filtered.length, new: 0, updated: 0, skipped: 0 };
  const sqlDb = db.getDb();

  for (const t of filtered) {
    const currentHash = `${t.message_count}:${t.last_from_email || ''}:${t.date || ''}`;
    const existing    = sqlDb.prepare('SELECT content_hash, estado FROM threads WHERE thread_id = ?').get(t.id);

    if (existing && existing.content_hash === currentHash) {
      stats.skipped++;
      continue; // No changes — SQLite already has the right state
    }

    // ─── Match client ─────────────────────────────────────────────────────────
    let client = null;
    for (const email of (t.participants || [])) {
      const domain = email.split('@')[1];
      client = matchClient(domain, email);
      if (client) break;
    }
    if (!client) client = matchClient(extractDomain(t.from), extractEmail(t.from));
    if (!client) continue;

    if (existing) stats.updated++; else stats.new++;

    const lastFromEmail  = (t.last_from_email || '').toLowerCase();
    const lastFromDomain = lastFromEmail.split('@')[1] || '';
    const lastSenderIsCeo  = ceoEmails.includes(lastFromEmail);
    const lastSenderIsTeam = teamDomains.some(d => lastFromDomain === d || lastFromDomain.endsWith('.' + d));
    const lastSenderIsUs   = lastSenderIsCeo || lastSenderIsTeam;

    const daysSince = Math.max(0, Math.floor((Date.now() - new Date(t.date).getTime()) / 86400000));

    // ─── Determine estado, category, severity ────────────────────────────────
    const subjectLower = (t.subject || '').toLowerCase();
    const isNoAction   = noActionPatterns.some(p => subjectLower.includes(p));

    // Check learned rules first (CEO feedback overrides everything)
    const learnedRule = db.findLearnedRule(t.subject, lastFromEmail);

    let estado, category, severity, isInformativo;
    if (learnedRule) {
      estado        = learnedRule.correct_estado;
      category      = learnedRule.correct_category;
      severity      = learnedRule.correct_severity || 'none';
      isInformativo = estado === 'informativo';
    } else if (isNoAction) {
      // Facturas, notificaciones, correos enviados por el equipo sin respuesta esperada
      estado        = 'informativo';
      category      = 'informativo';
      severity      = 'none';
      isInformativo = true;
    } else if (lastSenderIsUs) {
      // Nuestro equipo/CEO respondió último → esperando cliente
      estado        = calculateEstado(true, daysSince);
      category      = 'esperando_respuesta';
      severity      = calculateSeverity(true, daysSince);
      isInformativo = false;
    } else {
      // Cliente respondió último → requiere acción
      estado        = calculateEstado(false, daysSince);
      category      = 'requiere_accion';
      severity      = calculateSeverity(false, daysSince);
      isInformativo = false;
    }

    db.upsertThread({
      thread_id:           t.id,
      subject:             t.subject,
      original_from:       t.from,
      last_from:           t.last_from,
      last_from_email:     t.last_from_email,
      snippet:             t.snippet,
      message_count:       t.message_count,
      participants:        t.participants || [],
      date:                t.date,
      original_date:       t.original_date,
      last_sender_is_me:   lastSenderIsCeo,
      last_sender_is_team: lastSenderIsTeam,
      is_informativo:      isInformativo,
      category,
      estado,
      severity,
      client_name:         client.name,
      client_domain:       client.domains[0],
      client_empresa:      Array.isArray(client.empresa) ? client.empresa.join(',') : client.empresa,
      client_jira_label:   client.jira_label,
      accion_sugerida:     isInformativo ? 'archivar' : lastSenderIsUs ? 'seguimiento' : 'responder',
      jira_suggested:      !isInformativo && daysSince > 7,
      content_hash:        currentHash,
    });
  }

  db.setLastScan();

  logger.info('Client scan done', { skill: SKILL, mode, ...stats });
  return sortAndBuildFromDb(stats, mode, days);
}

// ─── AI enhancement (optional) ───────────────────────────────────────────────

async function enhanceWithAI(items) {
  try {
    const { default: Anthropic } = await import('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

    for (const item of items.slice(0, 20)) { // max 20 AI calls per run
      const msg = await client.messages.create({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 150,
        messages: [{
          role: 'user',
          content: `Clasifica este email. Responde SOLO con JSON válido.
Asunto: ${item.subject}
De: ${item.from}
Snippet: ${item.snippet}

Categorías posibles:
- solicitud_cliente: cliente real pide algo
- seguimiento: requiere seguimiento posterior
- factura: factura o boleta legítima
- cuenta_por_pagar: error de cobro o pago pendiente en servicio que usa el receptor
- estafa: phishing, impersonación de marca, intento de fraude
- envio: tracking de paquete o envío
- suscripcion: newsletter o marketing
- spam: publicidad no solicitada
- notificacion: alerta automática de sistema
- otro: no encaja en lo anterior

Acciones posibles: responder, archivar, eliminar, revisar, crear_jira
IMPORTANTE: si el dominio remitente no corresponde a la marca mencionada en el asunto/nombre, clasifica como estafa.

{"categoria":"...","accion":"...","severidad":"high|medium|low","razon":"max 10 palabras"}`
        }]
      });

      try {
        const raw = msg.content[0].text.trim();
        const jsonMatch = raw.match(/\{[\s\S]*\}/);
        if (!jsonMatch) throw new Error('No JSON found: ' + raw.substring(0, 100));
        const ai = JSON.parse(jsonMatch[0]);
        item.category = ai.categoria || item.category;
        item.accion_sugerida = ai.accion || item.accion_sugerida;
        item.severity = ai.severidad || item.severity;
        item.ai_reason = ai.razon;
        item.needs_action = needsActionFromCategory(item.category);
        item.ai_needed = false;
      } catch (parseErr) {
        logger.debug('AI parse error', { skill: SKILL, error: parseErr.message, subject: item.subject });
      }
    }
  } catch (e) {
    logger.debug('AI enhancement skipped', { skill: SKILL, error: e.message });
  }
}

// ─── Apply labels (safe mode aware) ──────────────────────────────────────────

async function applyLabels(classifications) {
  const gmail = require('../mcp/gmail');
  const labels = await gmail.listLabels();
  const labelMap = {};
  labels.forEach(l => { labelMap[l.name] = l.id; });

  const actions = classifications.items
    .filter(c => c.aprobado === true && c.client)
    .map(c => {
      const empresas = Array.isArray(c.client.empresa) ? c.client.empresa : [c.client.empresa];
      const ids = [];
      if (empresas.includes('ClickRepuestos')) {
        const id = labelMap[`02 - ClickRepuestos/Clientes/${c.client.domain}`];
        if (id) ids.push(id);
      }
      if (empresas.includes('WebySEO')) {
        const id = labelMap[`03 - WebySEO/Clientes/${c.client.domain}`];
        if (id) ids.push(id);
      }
      return { thread_id: c.thread_id, subject: c.subject, labelIds: ids };
    })
    .filter(a => a.labelIds.length > 0);

  if (rules.mail.safe_mode) {
    return { mode: 'proposal', message: 'Safe mode activo — confirmar para aplicar', actions };
  }

  const results = await Promise.allSettled(
    actions.map(a => gmail.applyLabel(a.thread_id, a.labelIds))
  );
  const applied = results.filter(r => r.status === 'fulfilled').length;
  return { mode: 'applied', applied, failed: results.length - applied };
}

module.exports = { classify, classifyClientThreads, applyLabels, classifyThread, CATEGORIES };
