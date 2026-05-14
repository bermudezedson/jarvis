import { useState, useEffect, useCallback } from 'react';
import FeedbackModal  from './FeedbackModal';
import RulesPanel     from './RulesPanel';
import TicketPreview  from './TicketPreview';

const API   = 'http://localhost:3000/api';
const GMAIL = id => `https://mail.google.com/mail/u/0/#inbox/${id}`;

// Team domains — must match rules.yml team.domains
const TEAM_DOMAINS = ['clickrepuestos.cl', 'webyseo.cl'];

function isTeamEmail(email) {
  if (!email) return false;
  const domain = email.toLowerCase().split('@')[1] || '';
  return TEAM_DOMAINS.some(d => domain === d);
}

// Calculate the correct reply-to (last EXTERNAL participant, not team/CEO)
function calculateReplyTo(messages, thread) {
  if (!messages?.length) {
    return {
      to:      thread.last_from_email || '',
      name:    thread.client?.name || '',
      subject: `Re: ${thread.subject || ''}`,
    };
  }
  const lastExternal = [...messages].reverse().find(m => !m.is_from_me && !m.is_from_team);
  if (lastExternal) {
    const email   = lastExternal.reply_to || lastExternal.sender_email || '';
    const rawName = lastExternal.sender?.replace(/<.*>/, '').replace(/"/g, '').trim() || '';
    const nameIsEmail = !rawName || rawName.toLowerCase() === email.toLowerCase() || rawName.includes('@');
    return {
      to:      email,
      name:    lastExternal.sender_display_name || (nameIsEmail ? '' : rawName),
      subject: `Re: ${thread.subject || ''}`,
    };
  }
  return {
    to:      thread.last_from_email || '',
    name:    thread.client?.name || '',
    subject: `Re: ${thread.subject || ''}`,
  };
}

// Collect all unique EXTERNAL participants from the thread (for reply-all CC)
function calculateReplyAll(messages) {
  if (!messages?.length) return [];
  const external = new Map(); // email → name
  messages.forEach(msg => {
    const allRecipients = [
      { email: msg.sender_email, name: msg.sender_display_name || msg.sender?.replace(/<.*>/, '').trim() || '' },
      ...((msg.to_recipients || '').match(/[a-zA-Z0-9._%+-]+@[\w.-]+/g) || []).map(e => ({ email: e, name: e })),
      ...((msg.cc_recipients || '').match(/[a-zA-Z0-9._%+-]+@[\w.-]+/g) || []).map(e => ({ email: e, name: e })),
    ];
    allRecipients.forEach(({ email, name }) => {
      if (!email) return;
      const lower = email.toLowerCase();
      if (!isTeamEmail(lower) && !external.has(lower)) {
        external.set(lower, name || lower);
      }
    });
  });
  return Array.from(external.entries()).map(([email, name]) => ({ email, name }));
}

function formatRecipients(str) {
  if (!str) return '';
  const emails = str.match(/[a-zA-Z0-9._%+-]+@[\w.-]+/g) || [];
  if (emails.length <= 2) return str.replace(/[<>]/g, '').trim();
  return `${emails.slice(0, 2).join(', ')} y ${emails.length - 2} más`;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ageBadge(days) {
  if (days <= 2)  return { cls: 'ctl-age-ok',   label: days === 0 ? 'hoy' : `${days}d` };
  if (days <= 7)  return { cls: 'ctl-age-warn',  label: `${days}d` };
  return              { cls: 'ctl-age-crit',  label: `${days}d` };
}

function EmpresaBadge({ empresa }) {
  const list = Array.isArray(empresa)
    ? empresa
    : typeof empresa === 'string' && empresa.includes(',')
      ? empresa.split(',')
      : empresa ? [empresa] : [];
  return (
    <>
      {list.map(e => (
        <span key={e} className={`ctl-empresa ${e.trim() === 'ClickRepuestos' ? 'ctl-cr' : 'ctl-ws'}`}>
          {e.trim() === 'ClickRepuestos' ? 'CR' : 'WS'}
        </span>
      ))}
    </>
  );
}

function senderDisplay(t) {
  if (t.last_sender_is_me) return 'tú respondiste';
  const name  = t.last_from?.split('<')[0].trim().replace(/"/g, '');
  const email = t.last_from_email || t.last_from?.match(/[a-zA-Z0-9._%+-]+@[\w.-]+/)?.[0];
  return name || email || 'cliente';
}

function stripQuotedText(text) {
  if (!text) return '';
  // Remove common quoted reply markers
  return text
    .replace(/^(El|On).*escribió:[\s\S]*/m, '')
    .replace(/^-+\s*Mensaje original\s*-+[\s\S]*/m, '')
    .replace(/^>{1,}.*$/gm, '')
    .trim()
    .substring(0, 800);
}

// ─── Message bubble ───────────────────────────────────────────────────────────

function MessageBubble({ message, onNameSaved }) {
  const isMe   = message.is_from_me;
  const isTeam = message.is_from_team;
  const isUs   = isMe || isTeam;

  const senderEmail = message.sender_email || '';
  const rawName     = message.sender?.replace(/<.*>/, '').replace(/"/g, '').trim() || '';
  const nameIsEmail = !rawName
    || rawName.trim() === ''
    || rawName.toLowerCase() === senderEmail.toLowerCase()
    || rawName.includes('@');

  const resolvedName = message.sender_display_name || (nameIsEmail ? '' : rawName) || (isMe ? 'Yo' : senderEmail);

  const [displayName, setDisplayName] = useState(resolvedName);
  const [editing,     setEditing]     = useState(false);
  const [editValue,   setEditValue]   = useState(resolvedName);
  const [saving,      setSaving]      = useState(false);

  const showEditBtn = !isUs && senderEmail && (!message.sender_display_name && nameIsEmail);

  const ccList = (message.cc_recipients || '').match(/[a-zA-Z0-9._%+-]+@[\w.-]+/g) || [];

  const body = stripQuotedText(message.body_text || '');
  const dateStr = message.date
    ? new Date(message.date).toLocaleDateString('es-CL', {
        day: 'numeric', month: 'short', year: 'numeric',
        hour: '2-digit', minute: '2-digit',
      })
    : '';

  async function saveName() {
    if (!editValue.trim() || !senderEmail) { setEditing(false); return; }
    setSaving(true);
    try {
      await fetch(`${API}/contacts/${encodeURIComponent(senderEmail)}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ name: editValue.trim() }),
      });
      setDisplayName(editValue.trim());
      setEditing(false);
      if (onNameSaved) onNameSaved(senderEmail, editValue.trim());
    } catch { /* silent */ }
    finally { setSaving(false); }
  }

  // Bubble class: from-me (CEO, blue), from-team (muted blue), from-client (green)
  const bubbleCls = isMe ? 'from-me' : isTeam ? 'from-team' : 'from-client';

  return (
    <div className={`thread-message ${bubbleCls}`}>
      <div className="msg-header">
        {editing ? (
          <span className="edit-name-inline">
            <input
              className="edit-name-input"
              value={editValue}
              onChange={e => setEditValue(e.target.value)}
              onKeyDown={e => { if (e.key === 'Enter') saveName(); if (e.key === 'Escape') setEditing(false); }}
              autoFocus
            />
            <button className="edit-name-save"  onClick={saveName} disabled={saving}>✓</button>
            <button className="edit-name-cancel" onClick={() => setEditing(false)}>✕</button>
          </span>
        ) : (
          <span className={isMe ? 'sender-me' : isTeam ? 'sender-team' : 'sender-client'}>
            {displayName}
            {showEditBtn && (
              <button className="edit-name-btn" title="Asignar nombre"
                onClick={() => { setEditValue(displayName); setEditing(true); }}>✏</button>
            )}
          </span>
        )}
        {senderEmail && !editing && <span className="sender-email">({senderEmail})</span>}
        <span className="msg-date">{dateStr}</span>
      </div>

      {/* Para / CC recipients */}
      {(message.to_recipients || ccList.length > 0) && (
        <div className="msg-recipients">
          {message.to_recipients && (
            <span className="msg-to">Para: {formatRecipients(message.to_recipients)}</span>
          )}
          {ccList.length > 0 && (
            <span className="msg-cc">CC: {ccList.join(', ')}</span>
          )}
        </div>
      )}

      <div className="msg-body">{body || '(sin contenido)'}</div>
    </div>
  );
}

// ─── State machine ────────────────────────────────────────────────────────────

const VALID_TRANSITIONS = {
  requiere_mi_accion: [
    { estado: 'pendiente',         label: 'Mover a Pendientes',    color: '' },
    { estado: 'esperando_cliente', label: 'Esperando cliente',     color: '' },
    { estado: 'solucionado',       label: 'Marcar solucionado',    color: 'green' },
    { estado: 'archivado',         label: 'Archivar',              color: 'gray' },
  ],
  pendiente: [
    { estado: 'requiere_mi_accion', label: 'Subir a Urgentes',     color: 'orange' },
    { estado: 'esperando_cliente',  label: 'Esperando cliente',    color: '' },
    { estado: 'solucionado',        label: 'Marcar solucionado',   color: 'green' },
    { estado: 'archivado',          label: 'Archivar',             color: 'gray' },
  ],
  esperando_cliente: [
    { estado: 'requiere_mi_accion', label: 'Requiere mi acción',   color: 'orange' },
    { estado: 'solucionado',        label: 'Marcar solucionado',   color: 'green' },
    { estado: 'archivado',          label: 'Archivar',             color: 'gray' },
  ],
  informativo: [
    { estado: 'requiere_mi_accion', label: 'Requiere mi acción',   color: 'orange' },
    { estado: 'pendiente',          label: 'Mover a Pendientes',   color: '' },
    { estado: 'solucionado',        label: 'Marcar solucionado',   color: 'green' },
    { estado: 'archivado',          label: 'Archivar',             color: 'gray' },
  ],
  en_jira: [
    { estado: 'solucionado',        label: 'Marcar solucionado',   color: 'green' },
    { estado: 'requiere_mi_accion', label: 'Reabrir',              color: 'orange' },
  ],
};

// Determine which transition key to use given a thread
function transitionKey(t, isInformativo) {
  if (isInformativo || t.estado === 'informativo') return 'informativo';
  if (t.estado === 'requiere_mi_accion')           return 'requiere_mi_accion';
  if (t.estado === 'esperando_cliente')            return 'esperando_cliente';
  if (t.estado === 'en_jira')                      return 'en_jira';
  // pendiente — but urgente threads (high severity) show as requiere_mi_accion
  if (t.severity === 'high' && !t.last_sender_is_me) return 'requiere_mi_accion';
  return 'pendiente';
}

function MoveToDropdown({ t, isInformativo, onTransition }) {
  const [open,        setOpen]        = useState(false);
  const [resolveMode, setResolveMode] = useState(false);
  const [resolveNote, setResolveNote] = useState('');

  const key         = transitionKey(t, isInformativo);
  const transitions = VALID_TRANSITIONS[key] || [];
  if (transitions.length === 0) return null;

  function handleClick(estado) {
    if (estado === 'solucionado') {
      setOpen(false);
      setResolveMode(true);
    } else {
      setOpen(false);
      onTransition(estado, '');
    }
  }

  if (resolveMode) {
    return (
      <div className="resolve-form" onClick={e => e.stopPropagation()}>
        <input
          className="resolve-input"
          placeholder="Nota de resolución (opcional)"
          value={resolveNote}
          autoFocus
          onChange={e => setResolveNote(e.target.value)}
          onKeyDown={e => {
            if (e.key === 'Enter') { onTransition('solucionado', resolveNote); setResolveMode(false); }
            if (e.key === 'Escape') setResolveMode(false);
          }}
        />
        <button className="ctl-btn ctl-btn-resolve-confirm"
          onClick={() => { onTransition('solucionado', resolveNote); setResolveMode(false); }}>
          ✓ Confirmar
        </button>
        <button className="ctl-btn ctl-btn-cancel" onClick={() => setResolveMode(false)}>×</button>
      </div>
    );
  }

  return (
    <div className="move-to-wrapper" onClick={e => e.stopPropagation()}>
      <button className="move-to-btn" onClick={() => setOpen(o => !o)}>
        Mover a <span style={{ fontSize: '9px', marginLeft: '2px' }}>▾</span>
      </button>
      {open && (
        <>
          <div className="move-to-backdrop" onClick={() => setOpen(false)} />
          <div className="move-to-dropdown">
            {transitions.map(tr => (
              <button
                key={tr.estado}
                className={`move-to-option ${tr.color || ''}`}
                onClick={() => handleClick(tr.estado)}
              >
                {tr.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Agent Brain analysis panel ──────────────────────────────────────────────

const ACTION_TYPE_ICONS = {
  crear_ticket_jira:   '🎫',
  responder_correo:    '📧',
  delegar:             '👤',
  agendar_reunion:     '📅',
  marcar_solucionado:  '✅',
  escalar:             '🔺',
  marcar_spam:         '🚫',
};

function AnalysisPanel({ analysis, actions, fromCache, analyzedAt, onReanalyze, threadId, thread, onSpammed }) {
  const [ticketActionId, setTicketActionId] = useState(null);
  const [createdTickets, setCreatedTickets] = useState({});
  const [rejectedIds,    setRejectedIds]    = useState(new Set());
  const [spamDoneIds,    setSpamDoneIds]    = useState(new Set());

  const urgCls = `ai-badge-urgencia-${analysis.urgencia || 'media'}`;
  const ageStr = analyzedAt
    ? (() => {
        const mins = Math.round((Date.now() - new Date(analyzedAt).getTime()) / 60000);
        if (mins < 1)  return 'ahora mismo';
        if (mins < 60) return `hace ${mins} min`;
        return `hace ${Math.round(mins / 60)}h`;
      })()
    : null;

  // Build a map: action index → proposed_action id (from DB actions array)
  const actionIds = {};
  if (actions?.length) {
    actions.forEach((a, i) => { if (a.id) actionIds[i] = a.id; });
  }

  async function handleReject(actionIdx) {
    const id = actionIds[actionIdx];
    if (!id) return;
    try {
      await fetch(`${API}/agent/action/${id}/reject`, { method: 'POST' });
      setRejectedIds(prev => new Set([...prev, actionIdx]));
    } catch { /* silent */ }
  }

  async function executeMarkSpam(actionIdx, blockDomain) {
    const threadIdToUse = threadId;
    try {
      const res  = await fetch(`${API}/mail/thread/${threadIdToUse}/mark-spam`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ blockDomain }),
      });
      const data = await res.json();
      if (data.success) {
        setSpamDoneIds(prev => new Set([...prev, actionIdx]));
        if (onSpammed) onSpammed(data);
      }
    } catch { /* silent */ }
  }

  return (
    <>
      <div className="ai-analysis-header">
        <span className="ai-analysis-title">🤖 Análisis de Jarvis</span>
        <div className="ai-analysis-meta">
          {fromCache && ageStr && <span>cache · {ageStr} · </span>}
          <button
            style={{ background: 'none', border: 'none', color: '#9c9a92', cursor: 'pointer', fontSize: '10px', padding: 0 }}
            onClick={onReanalyze}
            title="Re-analizar (consume tokens)"
          >
            🔄 Re-analizar
          </button>
        </div>
      </div>

      <div className="ai-analysis-resumen">{analysis.resumen}</div>

      <div className="ai-analysis-badges">
        {analysis.urgencia && (
          <span className={`ai-badge ${urgCls}`}>
            {analysis.urgencia === 'alta' ? '⚡ ' : ''}urgencia {analysis.urgencia}
          </span>
        )}
        {analysis.tipo && (
          <span className="ai-badge ai-badge-tipo">{analysis.tipo.replace(/_/g, ' ')}</span>
        )}
      </div>

      {analysis.acciones_sugeridas?.length > 0 && (
        <>
          <div className="ai-actions-title">Acciones sugeridas</div>
          {analysis.acciones_sugeridas.map((a, i) => {
            const isJira     = a.tipo === 'crear_ticket_jira' || a.tipo === 'delegar';
            const isSpam     = a.tipo === 'marcar_spam';
            const isRejected = rejectedIds.has(i);
            const isSpamDone = spamDoneIds.has(i);
            const ticketDone = createdTickets[i];
            const actionId   = actionIds[i];
            const showForm   = ticketActionId === i;

            return (
              <div key={i} className={`ai-action-item ${isRejected ? 'ai-action-rejected' : ''}`}>
                <span className="ai-action-num">{ACTION_TYPE_ICONS[a.tipo] || '→'}</span>
                <div className="ai-action-body">
                  <div className="ai-action-desc">
                    {ticketDone
                      ? <span style={{ color: '#4ade80' }}>
                          ✅ Ticket <a href={ticketDone.url} target="_blank" rel="noreferrer" className="tp-ticket-link">{ticketDone.key}</a> creado
                        </span>
                      : isSpamDone
                        ? <span style={{ color: '#4ade80' }}>✅ Marcado como spam en Jarvis y Gmail</span>
                      : isRejected
                        ? <span style={{ color: '#6b7280', textDecoration: 'line-through' }}>{a.descripcion}</span>
                        : a.descripcion
                    }
                  </div>
                  {!ticketDone && !isRejected && !isSpamDone && (
                    <div className="ai-action-meta">
                      {a.asignar_a && a.asignar_a !== 'null' && (
                        <span className="ai-action-tag assignee">→ {a.asignar_a}</span>
                      )}
                      {a.prioridad && (
                        <span className={`ai-action-tag prioridad-${a.prioridad}`}>{a.prioridad}</span>
                      )}
                      <span className="ai-action-tag">{(a.tipo || '').replace(/_/g, ' ')}</span>

                      {isJira && actionId && !showForm && (
                        <button
                          className="ai-action-tag ai-action-btn-ticket"
                          onClick={e => { e.stopPropagation(); setTicketActionId(i); }}
                          style={{ cursor: 'pointer', background: 'rgba(96,165,250,.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,.3)', borderRadius: 3, padding: '1px 6px', fontSize: '10px' }}
                        >
                          📋 Preparar ticket
                        </button>
                      )}

                      {isSpam && (
                        <>
                          <button
                            className="ai-action-tag"
                            onClick={e => { e.stopPropagation(); executeMarkSpam(i, false); }}
                            style={{ cursor: 'pointer', background: 'rgba(239,68,68,.12)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)', borderRadius: 3, padding: '1px 6px', fontSize: '10px' }}
                          >
                            🚫 Marcar spam
                          </button>
                          <button
                            className="ai-action-tag"
                            onClick={e => { e.stopPropagation(); executeMarkSpam(i, true); }}
                            style={{ cursor: 'pointer', background: 'rgba(239,68,68,.08)', color: '#fb923c', border: '1px solid rgba(239,68,68,.2)', borderRadius: 3, padding: '1px 6px', fontSize: '10px' }}
                          >
                            🔇 Spam + bloquear dominio
                          </button>
                        </>
                      )}

                      {actionId && (
                        <button
                          className="ai-action-tag"
                          onClick={e => { e.stopPropagation(); handleReject(i); }}
                          style={{ cursor: 'pointer', background: 'rgba(239,68,68,.08)', color: '#f87171', border: '1px solid rgba(239,68,68,.2)', borderRadius: 3, padding: '1px 6px', fontSize: '10px' }}
                        >
                          ❌ Rechazar
                        </button>
                      )}
                    </div>
                  )}

                  {showForm && actionId && (
                    <TicketPreview
                      actionId={actionId}
                      threadId={threadId}
                      onCreated={ticket => {
                        setCreatedTickets(prev => ({ ...prev, [i]: ticket }));
                        setTicketActionId(null);
                      }}
                      onCancel={() => setTicketActionId(null)}
                    />
                  )}
                </div>
              </div>
            );
          })}
        </>
      )}

      {analysis.contexto_adicional && analysis.contexto_adicional !== 'null' && (
        <div className="ai-analysis-context">💡 {analysis.contexto_adicional}</div>
      )}

      {analysis._parse_error && (
        <div className="ai-parse-error">⚠️ Análisis incompleto — el JSON no pudo parsearse correctamente. Revisar manualmente.</div>
      )}
    </>
  );
}

// ─── Thread row (expandable accordion) ───────────────────────────────────────

const INITIAL_MESSAGES = 3;

// ─── Spam button ──────────────────────────────────────────────────────────────

function SpamButton({ thread, onSpammed }) {
  const [confirming, setConfirming] = useState(false);
  const [loading,    setLoading]    = useState(false);
  const domain = (thread.last_from_email || '').split('@')[1] || '?';

  async function markSpam(blockDomain) {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/mail/thread/${thread.thread_id}/mark-spam`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ blockDomain }),
      });
      const data = await res.json();
      if (data.success && onSpammed) onSpammed(data);
    } catch { /* silent */ }
    setLoading(false);
    setConfirming(false);
  }

  if (confirming) {
    return (
      <div className="spam-confirm" onClick={e => e.stopPropagation()} style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', flexWrap: 'wrap' }}>
        <span style={{ fontSize: '11px', color: '#9c9a92' }}>¿Spam de {domain}?</span>
        <button className="ctl-btn" onClick={() => markSpam(false)} disabled={loading} style={{ fontSize: '10px', padding: '2px 6px' }}>Solo spam</button>
        <button className="ctl-btn ctl-btn-silence" onClick={() => markSpam(true)} disabled={loading} style={{ fontSize: '10px', padding: '2px 6px' }}>+ Bloquear dominio</button>
        <button className="ctl-btn" onClick={() => setConfirming(false)} style={{ fontSize: '10px', padding: '2px 6px' }}>✕</button>
      </div>
    );
  }

  return (
    <button
      className="ctl-btn"
      title={`Marcar como spam · dominio: ${domain}`}
      onClick={e => { e.stopPropagation(); setConfirming(true); }}
      style={{ fontSize: '11px' }}
    >
      🚫 Spam
    </button>
  );
}

function ThreadRow({ t, onArchive, onResolve, onJira, onFeedback, onTransition, onSilenceDomain, onSilencePattern, onSpam, jiraStatus, isInformativo = false }) {
  const [expanded,        setExpanded]        = useState(false);
  const [messages,        setMessages]        = useState(null);
  const [loadingMsgs,     setLoadingMsgs]     = useState(false);
  const [showAll,         setShowAll]         = useState(false);
  const [showReply,       setShowReply]       = useState(false);
  const [replyText,       setReplyText]       = useState('');
  const [suggestLoading,  setSuggestLoading]  = useState(false);
  const [sendLoading,     setSendLoading]     = useState(false);
  const [replyMode,       setReplyMode]       = useState('reply'); // 'reply' | 'reply_all'
  const [analysisCollapsed, setAnalysisCollapsed] = useState(false);
  const [summary,         setSummary]         = useState(t.ai_summary || null);
  const [summaryLoading,  setSummaryLoading]  = useState(false);
  const [showWhy,         setShowWhy]         = useState(false);
  const [whyData,         setWhyData]         = useState(null);
  const [whyLoading,      setWhyLoading]      = useState(false);
  const [analysisData,    setAnalysisData]    = useState(
    t.ai_analysis ? { analysis: JSON.parse(t.ai_analysis), actions: [], from_cache: true } : null
  );
  const [analysisLoading, setAnalysisLoading] = useState(false);
  const [showAnalysis,    setShowAnalysis]    = useState(false);

  // Lazy-generate summary in background on mount
  useEffect(() => {
    if (summary || summaryLoading) return;
    let cancelled = false;
    const delay = Math.floor(Math.random() * 1200);
    const timer = setTimeout(async () => {
      if (cancelled) return;
      setSummaryLoading(true);
      try {
        const res  = await fetch(`${API}/mail/thread/${t.thread_id}/summary`, { method: 'POST' });
        const data = await res.json();
        if (!cancelled && data.summary) setSummary(data.summary);
      } catch { /* silent */ }
      finally { if (!cancelled) setSummaryLoading(false); }
    }, delay);
    return () => { cancelled = true; clearTimeout(timer); };
  }, [t.thread_id]); // eslint-disable-line react-hooks/exhaustive-deps

  const age    = ageBadge(t.days_since_last ?? 0);
  const sevCls = t.severity === 'high' ? 'ctl-row-high' : t.severity === 'medium' ? 'ctl-row-med' : '';

  async function loadMessages() {
    if (messages !== null) return; // already loaded
    setLoadingMsgs(true);
    try {
      const res  = await fetch(`${API}/mail/thread/${t.thread_id}/messages`);
      const data = await res.json();
      setMessages(data.messages || []);
    } catch {
      setMessages([]);
    } finally {
      setLoadingMsgs(false);
    }
  }

  function toggle() {
    const next = !expanded;
    setExpanded(next);
    if (next && messages === null) loadMessages();
  }

  async function suggestReply() {
    setSuggestLoading(true);
    try {
      // Ensure messages are loaded first
      if (messages === null) await loadMessages();
      const res  = await fetch(`${API}/mail/thread/${t.thread_id}/suggest-reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      if (data.draft) setReplyText(data.draft);
    } catch {}
    setSuggestLoading(false);
  }

  const replyTo          = calculateReplyTo(messages, t);
  const replyAllContacts = calculateReplyAll(messages || []);
  const showReplyAll     = replyAllContacts.length > 1;
  const ccRecipients     = replyMode === 'reply_all'
    ? replyAllContacts.filter(r => r.email !== replyTo.to).map(r => r.email).join(', ')
    : '';

  async function sendReply() {
    if (!replyText.trim()) return;
    setSendLoading(true);
    try {
      await fetch(`${API}/mail/thread/${t.thread_id}/reply`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          body:       replyText,
          to:         replyTo.to,
          cc:         ccRecipients,
          subject:    replyTo.subject,
          reply_mode: replyMode,
        }),
      });
      setReplyText('');
      setExpanded(false);
    } catch {}
    setSendLoading(false);
  }

  return (
    <div className={`ctl-row ${isInformativo ? 'ctl-row-informativo' : sevCls} ${expanded ? 'ctl-row-expanded' : ''}`}>
      {/* ── Summary row (click to expand) ── */}
      <div className="ctl-row-summary" onClick={toggle} style={{ cursor: 'pointer' }}>
        <div className="ctl-row-badges">
          {isInformativo
            ? <span className="ctl-badge ctl-badge-info">INFO</span>
            : !t.last_sender_is_me
              ? <span className="ctl-badge ctl-badge-action">ACCIÓN</span>
              : <span className="ctl-badge ctl-badge-waiting">ESPERA</span>
          }
          {t.client?.empresa && <EmpresaBadge empresa={t.client.empresa} />}
        </div>

        <div className="ctl-row-main">
          <div className="ctl-row-header">
            <span className="ctl-client">{t.client?.name}</span>
            <span className="ctl-subject">{t.subject}</span>
          </div>
          <div className="ctl-row-meta">
            <span className="ctl-sender">{senderDisplay(t)}</span>
            <span className="ctl-sep">·</span>
            <span>{t.message_count} {t.message_count === 1 ? 'msg' : 'msgs'}</span>
            {!isInformativo && t.jira_suggested && <><span className="ctl-sep">·</span><span className="ctl-jira-hint">→ Jira</span></>}
          </div>
          {/* AI classification badge for unknown/new threads */}
          {t.ai_classification && <AiClassBadge cls={t.ai_classification} />}
          {/* AI summary line */}
          {summary && <div className="thread-summary">{summary}</div>}
          {summaryLoading && <div className="thread-summary loading">Generando resumen...</div>}
        </div>

        <div className="ctl-row-right">
          <span className={`ctl-age ${age.cls}`}>{age.label}</span>
          <span className="ctl-expand-icon">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── Accordion body ── */}
      {expanded && (
        <div className="ctl-accordion">

          {/* Action bar — STICKY TOP so it's always visible */}
          <div className="action-bar" style={{ position: 'sticky', top: 0, zIndex: 10, background: 'var(--bg-surface, #1e1e1e)', paddingBottom: '6px', borderBottom: '1px solid rgba(255,255,255,0.06)', marginBottom: '8px' }}>
            {/* Jira — non-informativo only */}
            {!isInformativo && (
              jiraStatus === 'done'
                ? <span className="ctl-btn ctl-btn-jira ctl-jira-done">✓ Jira</span>
                : <button
                    className={`ctl-btn ctl-btn-jira ${jiraStatus === 'loading' ? 'ctl-loading' : ''}`}
                    onClick={e => { e.stopPropagation(); onJira(t.thread_id); }}
                    disabled={jiraStatus === 'loading'}
                  >
                    {jiraStatus === 'loading' ? '...' : 'Crear Jira'}
                  </button>
            )}

            {/* Gmail link for informativos */}
            {isInformativo && (
              <a href={GMAIL(t.thread_id)} target="_blank" rel="noreferrer" className="ctl-btn ctl-btn-reply">
                Gmail ↗
              </a>
            )}

            {/* "Mover a" dropdown */}
            <MoveToDropdown
              t={t}
              isInformativo={isInformativo}
              onTransition={(newEstado, note) => onTransition(t.thread_id, newEstado, note)}
            />

            {/* 🚫 Spam */}
            <SpamButton
              thread={t}
              onSpammed={data => {
                if (onSpam) onSpam(t.thread_id, data);
              }}
            />

            {/* Corregir / Feedback */}
            <button className="ctl-btn ctl-btn-feedback"
              onClick={e => { e.stopPropagation(); onFeedback(t); }}
              title="Corregir clasificación — enseñar a Jarvis">
              ✎ Corregir
            </button>

            {/* Silenciar — fast-path blacklist training */}
            {onSilenceDomain && (
              <button className="ctl-btn ctl-btn-silence"
                title={`Silenciar dominio ${(t.last_from_email || '').split('@')[1] || ''} para siempre`}
                onClick={e => { e.stopPropagation(); onSilenceDomain(t); }}>
                🔇
              </button>
            )}

            {/* 🤖 Analizar con Sonnet */}
            <button
              className={`ctl-btn ctl-btn-analyze ${showAnalysis ? 'active' : ''}`}
              title="Analizar con Jarvis (Sonnet)"
              disabled={analysisLoading}
              onClick={async e => {
                e.stopPropagation();
                if (showAnalysis) { setShowAnalysis(false); return; }
                if (analysisData && !analysisData.actions?.length) {
                  setShowAnalysis(true);
                  setAnalysisLoading(true);
                  try {
                    const res  = await fetch(`${API}/mail/thread/${t.thread_id}/analysis`);
                    const data = await res.json();
                    if (data.analysis) {
                      setAnalysisData({ analysis: data.analysis, actions: data.actions || [], from_cache: true, analyzed_at: data.analyzed_at });
                    }
                  } catch { /* silent */ }
                  finally { setAnalysisLoading(false); }
                  return;
                }
                if (analysisData?.actions?.length) { setShowAnalysis(true); return; }
                setAnalysisLoading(true);
                setShowAnalysis(true);
                try {
                  const res  = await fetch(`${API}/mail/thread/${t.thread_id}/analyze`, {
                    method: 'POST', headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({ force: false }),
                  });
                  const data = await res.json();
                  if (data.success) setAnalysisData(data);
                } catch { /* silent */ }
                finally { setAnalysisLoading(false); }
              }}
            >
              {analysisLoading ? '🤖 …' : '🤖 Analizar'}
            </button>

            {/* ¿Por qué? — trazabilidad de clasificación */}
            <button
              className={`ctl-btn ctl-btn-why ${showWhy ? 'active' : ''}`}
              title="¿Por qué Jarvis clasificó este correo así?"
              onClick={async e => {
                e.stopPropagation();
                if (showWhy) { setShowWhy(false); return; }
                if (!whyData) {
                  setWhyLoading(true);
                  try {
                    const res  = await fetch(`${API}/mail/thread/${t.thread_id}/why`);
                    const data = await res.json();
                    setWhyData(data);
                  } catch { /* silent */ }
                  setWhyLoading(false);
                }
                setShowWhy(true);
              }}
            >
              {whyLoading ? '…' : '?'}
            </button>
          </div>

          {/* 🤖 AI Analysis panel — colapsable */}
          {showAnalysis && (
            <div className="ai-analysis-panel" onClick={e => e.stopPropagation()}>
              {analysisLoading && (
                <div className="ai-analysis-loading">🤖 Jarvis está analizando el hilo completo…</div>
              )}
              {!analysisLoading && analysisData?.analysis && (
                <>
                  {/* Collapsible header */}
                  <div
                    className="ai-analysis-collapse-header"
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: analysisCollapsed ? 0 : '6px' }}
                    onClick={() => setAnalysisCollapsed(v => !v)}
                  >
                    <span style={{ fontSize: '10px', color: '#6b7280' }}>{analysisCollapsed ? '▶' : '▼'}</span>
                    <span className="ai-analysis-title" style={{ margin: 0 }}>🤖 Análisis de Jarvis</span>
                    <span className="ai-analysis-resumen" style={{ margin: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {analysisData.analysis.resumen}
                    </span>
                  </div>
                  {!analysisCollapsed && (
                    <AnalysisPanel
                      analysis={analysisData.analysis}
                      actions={analysisData.actions || []}
                      fromCache={analysisData.from_cache}
                      analyzedAt={analysisData.analyzed_at}
                      threadId={t.thread_id}
                      thread={t}
                      onSpammed={data => { if (onSpam) onSpam(t.thread_id, data); }}
                      onReanalyze={async () => {
                        setAnalysisLoading(true);
                        try {
                          const res  = await fetch(`${API}/mail/thread/${t.thread_id}/analyze`, {
                            method: 'POST', headers: { 'Content-Type': 'application/json' },
                            body: JSON.stringify({ force: true }),
                          });
                          const data = await res.json();
                          if (data.success) setAnalysisData(data);
                        } catch { /* silent */ }
                        finally { setAnalysisLoading(false); }
                      }}
                    />
                  )}
                </>
              )}
              {!analysisLoading && !analysisData?.analysis && (
                <div className="ai-parse-error">No hay análisis disponible. Intenta de nuevo.</div>
              )}
            </div>
          )}

          {/* Messages — max height with scroll */}
          <div className="thread-messages" style={{ maxHeight: '320px', overflowY: 'auto' }}>
            {loadingMsgs && <div className="thread-loading">Cargando conversación...</div>}
            {!loadingMsgs && messages?.length === 0 && (
              <div className="thread-loading">Sin mensajes cargados.</div>
            )}
            {messages && (() => {
              const hiddenCount = messages.length - INITIAL_MESSAGES;
              const visible = showAll ? messages : messages.slice(-INITIAL_MESSAGES);
              return (
                <>
                  {hiddenCount > 0 && !showAll && (
                    <button className="show-more-btn" onClick={() => setShowAll(true)}>
                      Ver {hiddenCount} mensaje{hiddenCount > 1 ? 's' : ''} anterior{hiddenCount > 1 ? 'es' : ''}
                    </button>
                  )}
                  {visible.map(m => <MessageBubble key={m.message_id} message={m} />)}
                </>
              );
            })()}
          </div>

          {/* Snippet fallback if no messages loaded */}
          {!loadingMsgs && !messages?.length && t.snippet && (
            <div className="thread-snippet-fallback">"{t.snippet}"</div>
          )}

          {/* Reply area — colapsable, hidden for informativos */}
          {!isInformativo && (
            <div className="reply-area">
              {!showReply ? (
                <div style={{ display: 'flex', gap: '6px', alignItems: 'center' }}>
                  <button
                    className="ctl-btn ctl-btn-suggest"
                    style={{ fontSize: '11px' }}
                    onClick={e => { e.stopPropagation(); setShowReply(true); }}
                  >
                    📝 Responder
                  </button>
                  <a href={GMAIL(t.thread_id)} target="_blank" rel="noreferrer" className="ctl-btn ctl-btn-reply" style={{ fontSize: '11px' }}>
                    Gmail ↗
                  </a>
                </div>
              ) : (
                <>
                  {showReplyAll && (
                    <div className="reply-mode-toggle">
                      <button className={`reply-mode-btn ${replyMode === 'reply' ? 'active' : ''}`}
                        onClick={() => setReplyMode('reply')}>
                        Responder
                      </button>
                      <button className={`reply-mode-btn ${replyMode === 'reply_all' ? 'active' : ''}`}
                        onClick={() => setReplyMode('reply_all')}>
                        Responder a todos ({replyAllContacts.length})
                      </button>
                    </div>
                  )}
                  <div className="reply-to-info">
                    <span className="reply-to-label">Para: </span>
                    <strong className="reply-to-email">{replyTo.to}</strong>
                    {replyTo.name && replyTo.name !== replyTo.to && (
                      <span className="reply-to-name"> ({replyTo.name})</span>
                    )}
                    {replyMode === 'reply_all' && ccRecipients && (
                      <span className="reply-cc-list"><br/>CC: {ccRecipients}</span>
                    )}
                    <span className="reply-to-subject"> · {replyTo.subject}</span>
                  </div>
                  <textarea
                    className="reply-input"
                    placeholder="Escribe tu respuesta..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    rows={4}
                    autoFocus
                  />
                  <div className="reply-actions">
                    <button className="ctl-btn ctl-btn-suggest" onClick={suggestReply} disabled={suggestLoading}>
                      {suggestLoading ? '✦ Generando...' : '✦ Jarvis'}
                    </button>
                    <button className="ctl-btn ctl-btn-send" onClick={sendReply} disabled={sendLoading || !replyText.trim()}>
                      {sendLoading ? 'Enviando...' : 'Enviar'}
                    </button>
                    <a href={GMAIL(t.thread_id)} target="_blank" rel="noreferrer" className="ctl-btn ctl-btn-reply">
                      Gmail ↗
                    </a>
                    <button className="ctl-btn" onClick={() => { setShowReply(false); setReplyText(''); }} style={{ fontSize: '11px', color: '#6b7280' }}>
                      ✕ Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}

          {/* ¿Por qué? panel */}
          {showWhy && whyData && (
            <div className="why-panel" onClick={e => e.stopPropagation()}>
              <div className="why-title">📋 ¿Por qué está aquí?</div>
              <div className="why-pipeline">Pipeline: {whyData.pipeline}{whyData.pipeline_ts ? ` · ${new Date(whyData.pipeline_ts).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}` : ''}</div>
              <div className="why-explanation">{whyData.explanation}</div>
              {!whyData.has_reason && (
                <div className="why-no-reason">Sin trazabilidad detallada — el correo fue procesado antes de que se implementara esta función. Corre un nuevo scan para actualizar.</div>
              )}
              {whyData.steps?.length > 0 && (
                <details className="why-steps-details">
                  <summary className="why-steps-toggle">Ver pasos de clasificación ({whyData.steps.length})</summary>
                  <div className="why-steps">
                    {whyData.steps.map((s, i) => (
                      <div key={i} className={`why-step ${s.matched === false ? 'step-pass' : s.matched ? 'step-match' : ''}`}>
                        <span className="step-name">{s.step}</span>
                        {s.matched === true  && <span className="step-badge match">✓ coincide</span>}
                        {s.matched === false && <span className="step-badge pass">— no aplica</span>}
                        {s.result  && <span className="step-detail">{s.result}</span>}
                        {s.reason  && <span className="step-detail">{s.reason}</span>}
                        {s.detail  && <span className="step-detail">{s.detail}</span>}
                        {s.note    && <span className="step-detail">{s.note}</span>}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ─── Investigate panel ────────────────────────────────────────────────────────

function InvestigatePanel({ onClose }) {
  const [query,   setQuery]   = useState('');
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState(null);
  const [addingId, setAddingId] = useState(null);

  async function search() {
    if (!query.trim()) return;
    setLoading(true);
    setResults(null);
    try {
      const res = await fetch(`${API}/mail/investigate`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ search_query: query }),
      });
      setResults(await res.json());
    } catch (e) {
      setResults({ found: false, message: e.message });
    } finally {
      setLoading(false);
    }
  }

  async function addThread(threadId) {
    setAddingId(threadId);
    try {
      await fetch(`${API}/mail/investigate/add`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ thread_id: threadId }),
      });
      // Refresh results
      search();
    } catch {}
    setAddingId(null);
  }

  return (
    <div className="investigate-panel">
      <div className="investigate-header">
        <span className="investigate-title">Investigar correo ausente</span>
        <button className="investigate-close" onClick={onClose}>×</button>
      </div>
      <div className="investigate-search">
        <input
          className="investigate-input"
          placeholder="Pega el asunto, dominio o email del remitente..."
          value={query}
          onChange={e => setQuery(e.target.value)}
          onKeyDown={e => e.key === 'Enter' && search()}
        />
        <button className="ctl-btn ctl-btn-reply" onClick={search} disabled={loading}>
          {loading ? '...' : 'Buscar'}
        </button>
      </div>

      {results && !results.found && (
        <div className="investigate-not-found">
          <div className="investigate-msg">{results.message}</div>
          {results.suggestions?.map((s, i) => (
            <div key={i} className="investigate-suggestion">· {s}</div>
          ))}
        </div>
      )}

      {results?.found && (
        <div className="investigate-results">
          <div className="investigate-msg">{results.message}</div>
          {results.threads.map(t => (
            <div key={t.thread_id} className={`investigate-row ${t.action_needed ? 'has-issue' : ''}`}>
              <div className="investigate-row-header">
                <span className={`investigate-icon ${t.in_dashboard ? 'ok' : 'issue'}`}>
                  {t.in_dashboard ? '✓' : '✗'}
                </span>
                <span className="investigate-subject">"{t.subject}"</span>
                <a href={t.gmail_link} target="_blank" rel="noreferrer" className="investigate-gmail-link">Gmail ↗</a>
              </div>
              <div className="investigate-checks">
                {t.analysis.map((a, i) => (
                  <div key={i} className={`investigate-check ${a.is_issue ? 'check-issue' : 'check-ok'}`}>
                    <span>{a.is_issue ? '✗' : '✓'}</span>
                    <span><strong>{a.check}:</strong> {a.result}</span>
                  </div>
                ))}
              </div>
              {!t.in_dashboard && t.client_match && (
                <button
                  className="ctl-btn ctl-btn-resolve"
                  style={{ marginTop: '6px', fontSize: '11px' }}
                  onClick={() => addThread(t.thread_id)}
                  disabled={addingId === t.thread_id}
                >
                  {addingId === t.thread_id ? 'Agregando...' : 'Agregar al dashboard'}
                </button>
              )}
              {!t.client_match && (
                <div className="investigate-hint">
                  Agrega el dominio del cliente a <code>config/clients.yml</code> y vuelve a escanear
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Resolved / Archived compact row ─────────────────────────────────────────

function ClosedRow({ t, tipo }) {
  const age = ageBadge(t.days_since_last ?? 0);
  return (
    <div className="ctl-row ctl-row-archived">
      <div className="ctl-row-badges">
        <span className={`ctl-badge ${tipo === 'solucionado' ? 'ctl-badge-resolved' : 'ctl-badge-archived'}`}>
          {tipo === 'solucionado' ? 'RESUELTO' : 'ARCHIVADO'}
        </span>
        {t.client?.empresa && <EmpresaBadge empresa={t.client.empresa} />}
      </div>
      <div className="ctl-row-main">
        <div className="ctl-row-header">
          <span className="ctl-client">{t.client?.name}</span>
          <span className="ctl-subject">{t.subject}</span>
        </div>
        {t.resolution_note && (
          <div className="ctl-row-meta"><span className="ctl-sender">{t.resolution_note}</span></div>
        )}
        {tipo === 'solucionado' && t.resolution_time_hours != null && (
          <div className="ctl-row-meta">
            <span className="ctl-sender">Resuelto en {t.resolution_time_hours}h</span>
          </div>
        )}
      </div>
      <div className="ctl-row-right">
        <span className={`ctl-age ${age.cls}`}>{age.label}</span>
        <a href={GMAIL(t.thread_id)} target="_blank" rel="noreferrer" className="ctl-btn ctl-btn-reply">Gmail</a>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

const FILTER_TABS = [
  { id: 'urgente',     label: 'Urgentes' },
  { id: 'pending',     label: 'Pendientes' },
  { id: 'waiting',     label: 'Esperando' },
  { id: 'informativo', label: 'Informativos' },
  { id: 'nuevos',      label: 'Nuevos' },
  { id: 'solucionado', label: 'Solucionados' },
  { id: 'archived',    label: 'Archivados' },
];

const AI_CLASS_LABELS = {
  prospecto_nuevo: { label: 'Posible cliente', cls: 'badge-prospecto' },
  proveedor:       { label: 'Proveedor',        cls: 'badge-proveedor' },
  plataforma:      { label: 'Plataforma',       cls: 'badge-plataforma' },
  personal:        { label: 'Personal',         cls: 'badge-personal' },
  alerta_proveedor:{ label: 'Alerta proveedor', cls: 'badge-alerta' },
};

function AiClassBadge({ cls }) {
  const info = AI_CLASS_LABELS[cls];
  if (!info) return null;
  return <span className={`ai-class-badge ${info.cls}`}>{info.label}</span>;
}

export default function ClientActionList({ clientThreads, threadMetrics }) {
  const [localItems,    setLocalItems]    = useState([]);
  const [activeFilter,  setActiveFilter]  = useState('urgente');
  const [jiraStatus,    setJiraStatus]    = useState({});
  const [closedItems,   setClosedItems]   = useState(null);  // lazy loaded
  const [closedLoading, setClosedLoading] = useState(false);
  const [feedbackThread,      setFeedbackThread]      = useState(null);
  const [showInvestigate,     setShowInvestigate]     = useState(false);
  const [showRules,           setShowRules]           = useState(false);
  const [summaryBatchMsg,     setSummaryBatchMsg]     = useState(null);
  const [summaryBatchLoading, setSummaryBatchLoading] = useState(false);
  const [uncategorized,       setUncategorized]       = useState(null);
  const [uncatLoading,        setUncatLoading]        = useState(false);
  const [silenceMsg,          setSilenceMsg]          = useState(null);

  useEffect(() => {
    if (clientThreads?.items) setLocalItems(clientThreads.items);
  }, [clientThreads]);

  // Lazy load resolved/archived from API when those tabs activated
  useEffect(() => {
    if ((activeFilter === 'solucionado' || activeFilter === 'archived') && !closedItems?.[activeFilter]) {
      setClosedLoading(true);
      const estado = activeFilter === 'solucionado' ? 'solucionado' : 'archivado';
      fetch(`${API}/mail/client-threads?estado=${estado}`)
        .then(r => r.json())
        .then(data => setClosedItems(prev => ({ ...prev, [activeFilter]: data.items || [] })))
        .catch(() => setClosedItems(prev => ({ ...prev, [activeFilter]: [] })))
        .finally(() => setClosedLoading(false));
    }
  }, [activeFilter]);

  // Lazy load uncategorized threads when "Nuevos" tab is activated
  useEffect(() => {
    if (activeFilter === 'nuevos' && uncategorized === null) {
      setUncatLoading(true);
      fetch(`${API}/mail/uncategorized`)
        .then(r => r.json())
        .then(data => setUncategorized(data.items || []))
        .catch(() => setUncategorized([]))
        .finally(() => setUncatLoading(false));
    }
  }, [activeFilter, uncategorized]);

  const handleArchive = useCallback(async (thread_id) => {
    setLocalItems(prev =>
      prev.map(t => t.thread_id === thread_id ? { ...t, estado: 'archivado', severity: 'none' } : t)
    );
    try {
      await fetch(`${API}/mail/client-archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id }),
      });
    } catch {}
  }, []);

  const handleResolve = useCallback(async (thread_id, note = '') => {
    setLocalItems(prev =>
      prev.map(t => t.thread_id === thread_id ? { ...t, estado: 'solucionado', severity: 'none' } : t)
    );
    try {
      await fetch(`${API}/mail/client-resolve`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id, note }),
      });
    } catch {}
  }, []);

  const handleTransition = useCallback(async (thread_id, newEstado, note = '') => {
    // Optimistic update immediately
    setLocalItems(prev => prev.map(t => {
      if (t.thread_id !== thread_id) return t;
      const updates = { estado: newEstado };
      if (newEstado === 'solucionado') updates.severity = 'none';
      if (newEstado === 'archivado')   updates.severity = 'none';
      if (newEstado === 'informativo') { updates.severity = 'none'; updates.is_informativo = 1; }
      if (newEstado === 'requiere_mi_accion') { updates.severity = 'high'; updates.last_sender_is_me = 0; }
      if (newEstado === 'esperando_cliente')  { updates.last_sender_is_me = 1; }
      if (newEstado === 'pendiente') { updates.last_sender_is_me = 0; updates.severity = 'low'; }
      return { ...t, ...updates };
    }));
    try {
      await fetch(`${API}/mail/thread/${thread_id}/transition`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ estado: newEstado, note }),
      });
    } catch { /* silent — optimistic update stays */ }
  }, []);

  const handleSilenceDomain = useCallback(async (thread) => {
    const email  = thread.last_from_email || thread.from || '';
    const domain = email.split('@')[1];
    if (!domain) return;
    if (!window.confirm(`¿Silenciar dominio "${domain}" para siempre? Se archivarán todos sus hilos.`)) return;
    try {
      const res  = await fetch(`${API}/mail/silence-domain`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ domain }),
      });
      const data = await res.json();
      // Remove silenced threads from local state
      setLocalItems(prev => prev.filter(t => !(t.last_from_email || '').endsWith(`@${domain}`)));
      setUncategorized(prev => prev ? prev.filter(t => !(t.last_from_email || '').endsWith(`@${domain}`)) : prev);
      setSilenceMsg(`Dominio ${domain} silenciado. ${data.archived || 0} hilos archivados.`);
      setTimeout(() => setSilenceMsg(null), 5000);
    } catch { setSilenceMsg('Error al silenciar dominio'); setTimeout(() => setSilenceMsg(null), 3000); }
  }, []);

  const handleSilencePattern = useCallback(async (thread) => {
    const subject = thread.subject || '';
    // Propose pattern: first meaningful words
    const words   = subject.split(/\s+/).slice(0, 4).join(' ');
    const pattern = window.prompt('Patrón a silenciar (aparece en el asunto):', words);
    if (!pattern) return;
    try {
      const res  = await fetch(`${API}/mail/silence-pattern`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pattern }),
      });
      const data = await res.json();
      const patLow = pattern.toLowerCase();
      setLocalItems(prev => prev.filter(t => !(t.subject || '').toLowerCase().includes(patLow)));
      setUncategorized(prev => prev ? prev.filter(t => !(t.subject || '').toLowerCase().includes(patLow)) : prev);
      setSilenceMsg(`Patrón "${pattern}" silenciado. ${data.archived || 0} hilos archivados.`);
      setTimeout(() => setSilenceMsg(null), 5000);
    } catch { setSilenceMsg('Error al silenciar patrón'); setTimeout(() => setSilenceMsg(null), 3000); }
  }, []);

  const handleFeedback = useCallback((thread) => {
    setFeedbackThread(thread);
  }, []);

  const handleSpam = useCallback((thread_id, data) => {
    // Remove from all active lists
    setLocalItems(prev => prev.filter(t => t.thread_id !== thread_id));
    setUncategorized(prev => prev ? prev.filter(t => t.thread_id !== thread_id) : prev);
    const msg = data?.domainBlocked
      ? `✅ Spam marcado. Dominio ${data.domain} bloqueado — futuros correos descartados.`
      : '✅ Marcado como spam en Jarvis y Gmail.';
    setSilenceMsg(msg);
    setTimeout(() => setSilenceMsg(null), 5000);
  }, []);

  const handleFeedbackSent = useCallback((data) => {
    // Optimistically update local state with corrected classification
    if (data?.success && feedbackThread) {
      setLocalItems(prev => prev.map(t =>
        t.thread_id === feedbackThread.thread_id
          ? { ...t, estado: data.rule?.correct_estado || 'informativo', severity: 'none' }
          : t
      ));
    }
  }, [feedbackThread]);

  const handleJira = useCallback(async (thread_id) => {
    setJiraStatus(prev => ({ ...prev, [thread_id]: 'loading' }));
    try {
      const res = await fetch(`${API}/task-bridge/email-to-jira`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id }),
      });
      setJiraStatus(prev => ({ ...prev, [thread_id]: res.ok ? 'done' : 'error' }));
    } catch {
      setJiraStatus(prev => ({ ...prev, [thread_id]: 'error' }));
    }
  }, []);

  if (!clientThreads) {
    return (
      <div className="client-action-list ctl-empty">
        <div className="ctl-empty-icon">◈</div>
        <p>Sin datos de correos de clientes.</p>
        <p className="ctl-empty-sub">Ve a la pestaña Correo → Escaneo inicial para cargar los últimos 30 días.</p>
      </div>
    );
  }

  // Mismo criterio que metrics.js — URGENTE_ESTADOS whitelist
  const URGENTE_EST = ['requiere_mi_accion', 'esperando_nosotros', 'pendiente'];
  const active      = localItems.filter(t => t.estado !== 'archivado' && t.estado !== 'solucionado');
  const urgent      = active.filter(t => URGENTE_EST.includes(t.estado) && !t.last_sender_is_me && (t.severity === 'high' || t.severity === 'critical'));
  const pending     = active.filter(t => URGENTE_EST.includes(t.estado) && !t.last_sender_is_me && t.severity !== 'high' && t.severity !== 'critical');
  const waiting     = active.filter(t => t.estado === 'esperando_cliente');
  const informativos= active.filter(t => t.estado === 'informativo');

  const counts = {
    urgente:     threadMetrics?.correos_urgentes    ?? urgent.length,
    pending:     threadMetrics?.correos_pendientes  ?? pending.length,
    waiting:     threadMetrics?.esperando_cliente   ?? waiting.length,
    informativo: threadMetrics?.informativos        ?? informativos.length,
    nuevos:      uncategorized?.length ?? '?',
    solucionado: threadMetrics?.solucionados        ?? '—',
    archived:    threadMetrics?.archivados          ?? '—',
  };

  let visibleItems = [];
  let visibleType  = 'active';
  if (activeFilter === 'urgente')     { visibleItems = urgent; }
  if (activeFilter === 'pending')     { visibleItems = pending; }
  if (activeFilter === 'waiting')     { visibleItems = waiting; }
  if (activeFilter === 'informativo') { visibleItems = informativos; visibleType = 'informativo'; }
  if (activeFilter === 'nuevos')      { visibleItems = uncategorized || []; visibleType = 'nuevos'; }
  if (activeFilter === 'solucionado') { visibleItems = closedItems?.solucionado || []; visibleType = 'solucionado'; }
  if (activeFilter === 'archived')    { visibleItems = closedItems?.archived    || []; visibleType = 'archived'; }

  const scanStats = clientThreads.scan_stats;
  const scannedAt = clientThreads.scanned_at
    ? new Date(clientThreads.scanned_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="client-action-list">
      {/* ── Feedback modal ── */}
      {feedbackThread && (
        <FeedbackModal
          thread={feedbackThread}
          onClose={() => setFeedbackThread(null)}
          onFeedbackSent={handleFeedbackSent}
        />
      )}

      {/* ── Investigate panel ── */}
      {showInvestigate && (
        <InvestigatePanel onClose={() => setShowInvestigate(false)} />
      )}

      {/* ── Rules panel ── */}
      {showRules && (
        <RulesPanel onClose={() => setShowRules(false)} />
      )}

      {/* ── Header ── */}
      <div className="ctl-header">
        <div className="ctl-header-badges">
          {(threadMetrics?.correos_urgentes || 0) > 0 && (
            <span className="ctl-summary-badge ctl-summary-red">⚡ {threadMetrics.correos_urgentes} urgentes</span>
          )}
          <span className="ctl-summary-badge ctl-summary-blue">{threadMetrics?.correos_accion ?? '—'} requieren acción</span>
          <span className="ctl-summary-badge ctl-summary-gold">{threadMetrics?.esperando_cliente ?? '—'} esperando cliente</span>
        </div>
        <div className="ctl-header-actions">
          <button
            className="ctl-btn ctl-btn-rules"
            onClick={() => setShowRules(v => !v)}
            title="Ver reglas aprendidas y historial de feedback"
          >
            ⚙ Reglas
          </button>
          <button
            className="ctl-btn ctl-btn-investigate"
            onClick={() => setShowInvestigate(v => !v)}
            title="Buscar por qué un correo no aparece en el dashboard"
          >
            Investigar
          </button>
          <button
            className="ctl-btn ctl-btn-summaries"
            disabled={summaryBatchLoading}
            title="Generar resúmenes IA para correos sin resumen"
            onClick={async () => {
              setSummaryBatchLoading(true);
              setSummaryBatchMsg(null);
              try {
                const res  = await fetch(`${API}/mail/generate-summaries`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' },
                  body: JSON.stringify({ limit: 10 }),
                });
                const data = await res.json();
                setSummaryBatchMsg(data.message || `${data.generated} resúmenes generados`);
                setTimeout(() => setSummaryBatchMsg(null), 5000);
              } catch { setSummaryBatchMsg('Error al generar resúmenes'); }
              finally { setSummaryBatchLoading(false); }
            }}
          >
            {summaryBatchLoading ? '✦ Generando...' : '✦ Resúmenes'}
          </button>
        </div>
      </div>
      {summaryBatchMsg && <div className="ctl-batch-msg">{summaryBatchMsg}</div>}
      {silenceMsg     && <div className="ctl-batch-msg ctl-silence-msg">{silenceMsg}</div>}

      {/* ── Filter tabs ── */}
      <div className="ctl-filters">
        {FILTER_TABS.map(f => (
          <button
            key={f.id}
            className={`ctl-filter-tab ${activeFilter === f.id ? 'active' : ''} ${f.id === 'urgente' && (threadMetrics?.correos_urgentes || 0) > 0 ? 'has-urgent' : ''}`}
            onClick={() => setActiveFilter(f.id)}
          >
            {f.label}
            <span className="ctl-filter-count">{counts[f.id]}</span>
          </button>
        ))}
      </div>

      {/* ── Thread list ── */}
      <div className="ctl-list">
        {closedLoading && <div className="ctl-list-empty">Cargando...</div>}

        {(closedLoading || uncatLoading) && <div className="ctl-list-empty">Cargando...</div>}

        {!closedLoading && !uncatLoading && visibleItems.length === 0 && (
          <div className="ctl-list-empty">
            {activeFilter === 'urgente'     && '✓ Sin correos urgentes de clientes.'}
            {activeFilter === 'pending'     && '✓ Sin correos pendientes.'}
            {activeFilter === 'waiting'     && 'Sin hilos en espera de respuesta.'}
            {activeFilter === 'informativo' && '✓ Sin correos informativos (facturas, notificaciones).'}
            {activeFilter === 'nuevos'      && '✓ Sin correos nuevos sin catalogar. Haz clic en ↻ Actualizar para escanear.'}
            {activeFilter === 'solucionado' && 'Sin threads solucionados aún.'}
            {activeFilter === 'archived'    && 'Sin threads archivados.'}
          </div>
        )}

        {visibleType === 'active'
          ? visibleItems.map(t => (
              <ThreadRow
                key={t.thread_id}
                t={t}
                onArchive={handleArchive}
                onResolve={handleResolve}
                onJira={handleJira}
                onFeedback={handleFeedback}
                onTransition={handleTransition}
                onSilenceDomain={handleSilenceDomain}
                onSilencePattern={handleSilencePattern}
                onSpam={handleSpam}
                jiraStatus={jiraStatus[t.thread_id]}
              />
            ))
          : visibleType === 'informativo'
            ? visibleItems.map(t => (
                <ThreadRow
                  key={t.thread_id}
                  t={t}
                  onArchive={handleArchive}
                  onResolve={handleResolve}
                  onJira={handleJira}
                  onFeedback={handleFeedback}
                  onTransition={handleTransition}
                  onSilenceDomain={handleSilenceDomain}
                  onSpam={handleSpam}
                  jiraStatus={jiraStatus[t.thread_id]}
                  isInformativo={true}
                />
              ))
            : visibleType === 'nuevos'
              ? visibleItems.map(t => (
                  <ThreadRow
                    key={t.thread_id}
                    t={t}
                    onArchive={handleArchive}
                    onResolve={handleResolve}
                    onJira={handleJira}
                    onFeedback={handleFeedback}
                    onTransition={handleTransition}
                    onSilenceDomain={handleSilenceDomain}
                    onSilencePattern={handleSilencePattern}
                    onSpam={handleSpam}
                    jiraStatus={jiraStatus[t.thread_id]}
                    isInformativo={t.estado === 'informativo'}
                  />
                ))
              : visibleItems.map(t => <ClosedRow key={t.thread_id} t={t} tipo={visibleType} />)
        }
      </div>

      {/* ── Scan info ── */}
      {scannedAt && (
        <div className="ctl-scan-info">
          Último escaneo: {scannedAt}
          {scanStats && (
            <span className="ctl-scan-detail">
              {' · '}{scanStats.new > 0 ? `${scanStats.new} nuevos` : ''}
              {scanStats.updated > 0 ? ` ${scanStats.updated} actualizados` : ''}
              {` ${scanStats.skipped} sin cambios`}
            </span>
          )}
        </div>
      )}
    </div>
  );
}
