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
  FACTURA:            'factura',              // Invoice / billing
  CUENTA_POR_PAGAR:   'cuenta_por_pagar',    // Subscription/service with payment failure
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

  // 7. Invoice / billing
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

module.exports = { classify, applyLabels, classifyThread, CATEGORIES };
