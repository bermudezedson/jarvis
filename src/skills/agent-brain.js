const fs     = require('fs');
const path   = require('path');
const yaml   = require('js-yaml');
const logger = require('../utils/logger');
const db     = require('../db/database');

const SKILL        = 'agent-brain';
const SONNET_MODEL = 'claude-sonnet-4-6';
const MAX_BODY_CHARS = 2000;
const MAX_TOKENS     = 1024;

let _clientsConfig = null;
function getClientsConfig() {
  if (!_clientsConfig) {
    _clientsConfig = yaml.load(
      fs.readFileSync(path.join(__dirname, '../../config/clients.yml'), 'utf8')
    );
  }
  return _clientsConfig;
}

let _teamConfig = null;
function getTeamConfig() {
  if (!_teamConfig) {
    _teamConfig = yaml.load(
      fs.readFileSync(path.join(__dirname, '../../config/team.yml'), 'utf8')
    );
  }
  return _teamConfig;
}

function findClientInfo(clientName) {
  if (!clientName) return null;
  return getClientsConfig().clients.find(c => c.name === clientName) || null;
}

// Returns 'CLICK' or 'WYS' based on the client's empresa field
function getProjectForClient(clientName) {
  const client = findClientInfo(clientName);
  if (!client) return 'CLICK';
  const empresa = Array.isArray(client.empresa) ? client.empresa : [client.empresa || ''];
  if (empresa.some(e => (e || '').includes('WebySEO')) && !empresa.some(e => (e || '').includes('ClickRepuestos'))) {
    return 'WYS';
  }
  return 'CLICK';
}

// Extract 2-3 meaningful keywords from a subject for JQL (NO AI, pure regex/stopwords)
const STOPWORDS = new Set([
  'de','del','la','el','los','las','para','en','con','por','que','se','su','un','una','al','y','o','a',
  're','fwd','fw','solicitud','problema','error','advertencia','aviso','alerta','notificación','notificacion',
  'hola','estimado','estimada','favor','por','gracias','saludos',
]);

function extractKeywords(subject) {
  if (!subject) return '';
  const clean = subject
    .replace(/^(Re|Fwd|FW|RE|AW):\s*/i, '')
    .replace(/[[\](){}*?!¡¿#]/g, ' ')
    .toLowerCase();
  const words = clean.split(/\s+/)
    .map(w => w.replace(/[^a-záéíóúñü]/g, ''))
    .filter(w => w.length > 3 && !STOPWORDS.has(w));
  return words.slice(0, 3).join(' ');
}

function resolveAssignee(name) {
  if (!name || name === 'null') return null;
  const { team } = getTeamConfig();
  const member   = team[name.toLowerCase()];
  if (!member) {
    logger.warn('Team member not found', { SKILL, name });
    return null;
  }
  return member;
}

function formatMessages(messages) {
  return messages.map(msg => {
    const dateStr = msg.date
      ? new Date(msg.date).toLocaleDateString('es-CL', {
          day: 'numeric', month: 'short', year: 'numeric',
          hour: '2-digit', minute: '2-digit',
        })
      : 'fecha desconocida';
    const who = msg.is_from_me
      ? 'CEO (Alejandro)'
      : msg.is_from_team
        ? `Equipo (${msg.sender_email})`
        : `Cliente (${msg.sender_email})`;

    let body = (msg.body_text || '').trim();
    const originalLen = body.length;
    if (originalLen > MAX_BODY_CHARS) {
      body = body.substring(0, MAX_BODY_CHARS)
        + `\n[...truncado, mensaje original tiene ${originalLen} caracteres]`;
    }
    return `[${dateStr}] DE: ${who}\n${body || '(sin contenido)'}`;
  }).join('\n---\n');
}

function parseAgentResponse(rawText) {
  try {
    return JSON.parse(rawText);
  } catch {
    try {
      const cleaned = rawText.replace(/```json\n?/g, '').replace(/```\n?/g, '').trim();
      return JSON.parse(cleaned);
    } catch {
      try {
        const match = rawText.match(/\{[\s\S]*\}/);
        if (match) return JSON.parse(match[0]);
      } catch { /* fall through */ }
    }
  }
  return {
    resumen:           'Análisis generado pero no se pudo parsear el JSON. Texto crudo disponible.',
    urgencia:          'media',
    tipo:              'otro',
    acciones_sugeridas: [],
    contexto_adicional: rawText.substring(0, 500),
    _parse_error:      true,
  };
}

async function analyzeThread(threadId, { force = false } = {}) {
  const sqlDb = db.getDb();

  const thread = sqlDb.prepare('SELECT * FROM threads WHERE thread_id = ?').get(threadId);
  if (!thread) throw new Error(`Thread ${threadId} no encontrado en la base de datos`);

  if (!process.env.ANTHROPIC_API_KEY) {
    throw new Error('ANTHROPIC_API_KEY no está configurada');
  }

  // Return cached analysis if < 24h old and not forcing
  if (!force && thread.ai_analysis_at) {
    const hoursAgo = (Date.now() - new Date(thread.ai_analysis_at).getTime()) / 3600000;
    if (hoursAgo < 24) {
      logger.info('AI analysis cache hit', { SKILL, threadId, hoursAgo: Math.round(hoursAgo) });
      const analysis = parseAgentResponse(thread.ai_analysis || '{}');
      const actions  = sqlDb.prepare(
        'SELECT * FROM proposed_actions WHERE thread_id = ? AND status != ? ORDER BY created_at DESC'
      ).all(threadId, 'superseded');
      return { analysis, actions, from_cache: true };
    }
  }

  // Load messages from SQLite; fetch from Gmail if not cached
  let messages = db.getThreadMessages(threadId);
  if (messages.length === 0) {
    const gmail = require('../mcp/gmail');
    const fullThread = await gmail.getFullThread(threadId);
    if (!fullThread?.messages) throw new Error('No se pudieron obtener los mensajes del thread desde Gmail');

    const rules      = yaml.load(fs.readFileSync(path.join(__dirname, '../../config/rules.yml'), 'utf8'));
    const teamDomains = (rules.team?.domains || []).map(d => d.toLowerCase());
    const ceoEmails   = (rules.team?.ceo_emails || []).map(e => e.toLowerCase());

    for (const msg of fullThread.messages) {
      const senderEmail  = (msg.from_email || '').toLowerCase();
      const senderDomain = senderEmail.split('@')[1] || '';
      db.saveMessage({
        message_id:    msg.id,
        thread_id:     threadId,
        sender:        msg.from,
        sender_email:  senderEmail,
        date:          msg.date,
        body_text:     msg.body_text,
        body_html:     msg.body_html || '',
        is_from_me:    ceoEmails.includes(senderEmail),
        is_from_team:  teamDomains.some(d => senderDomain === d),
        to_recipients: msg.to      || '',
        cc_recipients: msg.cc      || '',
        reply_to:      msg.reply_to || '',
      });
    }
    messages = db.getThreadMessages(threadId);
  }

  if (!messages.length) throw new Error('El thread no tiene mensajes disponibles');

  // Client context
  const clientInfo    = findClientInfo(thread.client_name);
  const clientEmpresa = clientInfo
    ? (Array.isArray(clientInfo.empresa) ? clientInfo.empresa.join(', ') : clientInfo.empresa)
    : (thread.client_empresa || 'desconocida');

  const daysSince = thread.date
    ? Math.max(0, Math.floor((Date.now() - new Date(thread.date).getTime()) / 86400000))
    : '?';

  // Search for related Jira tickets (non-blocking — failure just means no context)
  let relatedTickets = [];
  let linkedTicket   = null;
  try {
    const jira       = require('../mcp/jira');
    const keywords   = extractKeywords(thread.subject);
    const projectKey = getProjectForClient(thread.client_name);
    if (keywords) relatedTickets = await jira.searchRelatedTickets(keywords, projectKey);
    linkedTicket = jira.getLinkedTicket(threadId);
  } catch (err) {
    logger.debug('Jira context fetch failed, continuing', { SKILL, error: err.message });
  }

  const messagesText = formatMessages(messages);

  // Build Jira context block for prompt
  let jiraContext = '';
  if (linkedTicket) {
    jiraContext = `\nTICKET YA CREADO PARA ESTE CORREO: ${linkedTicket.key} — no crear otro.\n`;
  } else if (relatedTickets.length > 0) {
    const list = relatedTickets.map(t => `- ${t.key}: ${t.summary} (${t.status}${t.assignee ? ', ' + t.assignee : ''})`).join('\n');
    jiraContext = `\nTICKETS JIRA EXISTENTES RELACIONADOS:\n${list}\nSi ya existe un ticket que cubre este tema, NO propongás crear uno nuevo — en su lugar sugerí vincularlo.\n`;
  }

  const prompt = `Eres Jarvis, asistente ejecutivo del CEO de WebySEO y ClickRepuestos.

Tu trabajo es analizar correos de clientes y proponer acciones concretas.

CONTEXTO DEL CEO:
- Alejandro Bermúdez Alcaino, CEO/CTO
- WebySEO: agencia de marketing digital (SEO, hosting, e-commerce)
- ClickRepuestos: ERP/WMS SaaS para repuestos automotrices
- Equipo: Johana Pailanca (admin/finanzas), Luciano Alvares (desarrollo ERP), Richard Martínez (hosting/servidores)

REGLAS DE DELEGACIÓN:
- Hosting, cPanel, SSL, dominios, servidores → Richard
- Desarrollo ERP, bugs del sistema, integraciones API, features ClickRepuestos → Luciano
- Facturación, cobranza, pagos, administración → Johana
- Estrategia, pricing, clientes nuevos, decisiones comerciales → Alejandro (no delegar)

CLIENTE: ${thread.client_name || 'desconocido'} (empresa: ${clientEmpresa})
ASUNTO: ${thread.subject || '(sin asunto)'}
ESTADO ACTUAL: ${thread.estado}
SEVERIDAD: ${thread.severity}
DÍAS SIN RESPUESTA: ${daysSince}
${jiraContext}
HILO DE CORREOS (del más antiguo al más reciente):
${messagesText}

INSTRUCCIONES:
Analiza el hilo completo y responde SOLO con un JSON válido (sin backticks, sin explicación):

REGLAS PARA acciones_sugeridas:
- Para tipo "crear_ticket_jira" o "delegar": el campo "descripcion" es el TÍTULO del ticket en Jira. Debe describir el problema o requerimiento — NO una instrucción. Máximo 80 caracteres.
  - BUENOS: "Cuota disco al 90% en cPanel toprental.cl", "Panel logístico: ventas por importadora + filtros", "API Laudus: integración multi-RUT Nutrabody"
  - MALOS: "Asignar a Richard para que revise...", "Crear ticket para agregar...", "Delegar a Luciano el desarrollo de..."
- Para tipo "responder_correo": "descripcion" explica qué responder y cómo.
- Para tipo "escalar" o "agendar_reunion": "descripcion" explica el objetivo.
- Para tipo "marcar_spam": el correo es spam, prospección no solicitada, phishing o masivo sin relación con WebySEO/ClickRepuestos. En "contexto_adicional" incluir el dominio del remitente. No asignar a nadie.
- tiempo_estimado (solo en crear_ticket_jira y delegar): "30m" limpiar disco/config, "1h" bug simple/fix puntual, "2h" feature pequeña/ajuste UI, "4h" feature mediana/integración, "1d" módulo nuevo/feature grande.

{
  "resumen": "1-2 oraciones resumiendo la situación actual",
  "urgencia": "alta|media|baja",
  "tipo": "soporte|feature_request|cobranza|consulta|reclamo|otro",
  "acciones_sugeridas": [
    {
      "tipo": "crear_ticket_jira|responder_correo|delegar|agendar_reunion|marcar_solucionado|escalar|marcar_spam",
      "descripcion": "Título del ticket (max 80 chars) o descripción de la acción",
      "asignar_a": "luciano|richard|johana|alejandro|null",
      "prioridad": "alta|media|baja",
      "tiempo_estimado": "30m|1h|2h|4h|1d",
      "borrador": null
    }
  ],
  "contexto_adicional": "Observaciones relevantes o null"
}`;

  logger.info('Calling Sonnet for thread analysis', { SKILL, threadId, messages: messages.length, model: SONNET_MODEL });

  const { default: Anthropic } = await import('@anthropic-ai/sdk');
  const client    = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  const startTime = Date.now();

  const response = await client.messages.create({
    model:      SONNET_MODEL,
    max_tokens: MAX_TOKENS,
    messages:   [{ role: 'user', content: prompt }],
  });

  const elapsed      = Date.now() - startTime;
  const rawText      = response.content[0].text.trim();
  const inputTokens  = response.usage?.input_tokens  || 0;
  const outputTokens = response.usage?.output_tokens || 0;

  logger.info('Sonnet analysis complete', { SKILL, threadId, inputTokens, outputTokens, elapsedMs: elapsed });

  const analysis = parseAgentResponse(rawText);

  // Persist analysis to threads table
  sqlDb.prepare(`
    UPDATE threads
    SET ai_analysis = ?, ai_analysis_at = datetime('now'), updated_at = datetime('now')
    WHERE thread_id = ?
  `).run(JSON.stringify(analysis), threadId);

  // Mark previous pending actions as superseded when re-analyzing
  if (force) {
    sqlDb.prepare(`
      UPDATE proposed_actions
      SET status = 'superseded', resolved_at = datetime('now')
      WHERE thread_id = ? AND status = 'pending'
    `).run(threadId);
  }

  // Insert proposed actions
  const savedActions = [];
  const insertAction = sqlDb.prepare(`
    INSERT INTO proposed_actions (thread_id, action_type, description, assignee, priority, draft_content, time_estimate)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);
  for (const action of (analysis.acciones_sugeridas || [])) {
    const result = insertAction.run(
      threadId,
      action.tipo             || 'otro',
      action.descripcion      || '',
      action.asignar_a        || null,
      action.prioridad        || 'media',
      action.borrador         || null,
      action.tiempo_estimado  || null,
    );
    savedActions.push({ id: result.lastInsertRowid, ...action, status: 'pending' });
  }

  // Log the analysis call
  db.logAction(threadId, 'ai_analysis', {
    model:         SONNET_MODEL,
    input_tokens:  inputTokens,
    output_tokens: outputTokens,
    elapsed_ms:    elapsed,
    actions_count: savedActions.length,
    parse_error:   analysis._parse_error || false,
    forced:        force,
  });

  return { analysis, actions: savedActions, from_cache: false };
}

function getAnalysisCandidates() {
  const sqlDb = db.getDb();
  return sqlDb.prepare(`
    SELECT thread_id, subject, client_name, estado, severity, date, ai_analysis_at
    FROM threads
    WHERE estado IN ('requiere_mi_accion', 'esperando_nosotros')
      AND client_name IS NOT NULL
      AND (ai_analysis_at IS NULL OR ai_analysis_at < datetime('now', '-24 hours'))
    ORDER BY
      CASE severity
        WHEN 'critical' THEN 1
        WHEN 'high'     THEN 2
        WHEN 'medium'   THEN 3
        ELSE 4
      END,
      date DESC
  `).all();
}

module.exports = { analyzeThread, getAnalysisCandidates, resolveAssignee, getProjectForClient, extractKeywords };
