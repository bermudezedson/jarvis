import { useState, useEffect, useRef } from 'react';
import TicketPreview from './TicketPreview';
import FeedbackModal from './FeedbackModal';

const API   = 'http://localhost:3000/api';
const GMAIL = id => `https://mail.google.com/mail/u/0/#inbox/${id}`;

const TEAM_DOMAINS = ['clickrepuestos.cl', 'webyseo.cl'];
function isTeamEmail(e) { const d = (e || '').split('@')[1] || ''; return TEAM_DOMAINS.some(t => d === t); }

function calcReplyTo(messages, t) {
  if (!messages?.length) return { to: t.last_from_email || '', name: t.client?.name || '', subject: `Re: ${t.subject || ''}` };
  const ext = [...messages].reverse().find(m => !m.is_from_me && !m.is_from_team);
  if (ext) {
    const email = ext.reply_to || ext.sender_email || '';
    const raw   = ext.sender?.replace(/<.*>/, '').replace(/"/g, '').trim() || '';
    const noName = !raw || raw.toLowerCase() === email.toLowerCase() || raw.includes('@');
    return { to: email, name: ext.sender_display_name || (noName ? '' : raw), subject: `Re: ${t.subject || ''}` };
  }
  return { to: t.last_from_email || '', name: t.client?.name || '', subject: `Re: ${t.subject || ''}` };
}

function calcReplyAll(messages) {
  if (!messages?.length) return [];
  const ext = new Map();
  messages.forEach(m => {
    [
      { email: m.sender_email, name: m.sender_display_name || '' },
      ...((m.to_recipients  || '').match(/[a-zA-Z0-9._%+-]+@[\w.-]+/g) || []).map(e => ({ email: e, name: e })),
      ...((m.cc_recipients  || '').match(/[a-zA-Z0-9._%+-]+@[\w.-]+/g) || []).map(e => ({ email: e, name: e })),
    ].forEach(({ email, name }) => {
      if (!email) return;
      const l = email.toLowerCase();
      if (!isTeamEmail(l) && !ext.has(l)) ext.set(l, name || l);
    });
  });
  return Array.from(ext.entries()).map(([email, name]) => ({ email, name }));
}

function stripQuoted(text) {
  return (text || '')
    .replace(/^(El|On).*escribió:[\s\S]*/m, '')
    .replace(/^-+\s*Mensaje original\s*-+[\s\S]*/m, '')
    .replace(/^>{1,}.*$/gm, '')
    .trim()
    .substring(0, 800);
}

function ageDays(days) {
  if (days <= 2)  return 'ctl-age-ok';
  if (days <= 7)  return 'ctl-age-warn';
  return 'ctl-age-crit';
}

// ─── MessageBubble ────────────────────────────────────────────────────────────

function Bubble({ msg }) {
  const isUs   = msg.is_from_me || msg.is_from_team;
  const name   = msg.sender_display_name || msg.sender?.replace(/<.*>/, '').trim() || (msg.is_from_me ? 'Yo' : msg.sender_email);
  const date   = msg.date ? new Date(msg.date).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
  const body   = stripQuoted(msg.body_text || '');
  const cls    = msg.is_from_me ? 'from-me' : msg.is_from_team ? 'from-team' : 'from-client';
  const cc     = (msg.cc_recipients || '').match(/[a-zA-Z0-9._%+-]+@[\w.-]+/g) || [];

  return (
    <div className={`thread-message ${cls}`}>
      <div className="msg-header">
        <span className={msg.is_from_me ? 'sender-me' : msg.is_from_team ? 'sender-team' : 'sender-client'}>{name}</span>
        {msg.sender_email && !isUs && <span className="sender-email">({msg.sender_email})</span>}
        <span className="msg-date">{date}</span>
      </div>
      {(msg.to_recipients || cc.length > 0) && (
        <div className="msg-recipients">
          {msg.to_recipients && <span className="msg-to">Para: {msg.to_recipients}</span>}
          {cc.length > 0      && <span className="msg-cc">CC: {cc.join(', ')}</span>}
        </div>
      )}
      <div className="msg-body">{body || '(sin contenido)'}</div>
    </div>
  );
}

// ─── MoveToDropdown ───────────────────────────────────────────────────────────

const TRANSITIONS = {
  requiere_mi_accion: [
    { estado: 'pendiente',        label: 'Mover a Pendientes' },
    { estado: 'esperando_cliente',label: 'Esperando cliente' },
    { estado: 'solucionado',      label: 'Marcar solucionado', color: 'green' },
    { estado: 'archivado',        label: 'Archivar',           color: 'gray' },
  ],
  pendiente: [
    { estado: 'requiere_mi_accion',label: 'Subir a Urgentes', color: 'orange' },
    { estado: 'esperando_cliente', label: 'Esperando cliente' },
    { estado: 'solucionado',       label: 'Marcar solucionado', color: 'green' },
    { estado: 'archivado',         label: 'Archivar',           color: 'gray' },
  ],
  esperando_cliente: [
    { estado: 'requiere_mi_accion',label: 'Requiere mi acción', color: 'orange' },
    { estado: 'solucionado',       label: 'Marcar solucionado', color: 'green' },
    { estado: 'archivado',         label: 'Archivar',           color: 'gray' },
  ],
  informativo: [
    { estado: 'requiere_mi_accion',label: 'Requiere mi acción', color: 'orange' },
    { estado: 'pendiente',         label: 'Mover a Pendientes' },
    { estado: 'solucionado',       label: 'Marcar solucionado', color: 'green' },
    { estado: 'archivado',         label: 'Archivar',           color: 'gray' },
  ],
  en_jira: [
    { estado: 'solucionado',       label: 'Marcar solucionado', color: 'green' },
    { estado: 'requiere_mi_accion',label: 'Reabrir',            color: 'orange' },
  ],
};

function MoveToDropdown({ t, onTransition }) {
  const [open, setOpen] = useState(false);
  const [resolveMode, setResolveMode] = useState(false);
  const [resolveNote, setResolveNote] = useState('');
  const key = t.estado === 'informativo' ? 'informativo' : (TRANSITIONS[t.estado] ? t.estado : 'pendiente');
  const opts = TRANSITIONS[key] || [];
  if (!opts.length) return null;

  if (resolveMode) return (
    <div className="resolve-form" onClick={e => e.stopPropagation()}>
      <input className="resolve-input" placeholder="Nota (opcional)" value={resolveNote} autoFocus
        onChange={e => setResolveNote(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') { onTransition('solucionado', resolveNote); setResolveMode(false); } if (e.key === 'Escape') setResolveMode(false); }}
      />
      <button className="ctl-btn ctl-btn-resolve-confirm" onClick={() => { onTransition('solucionado', resolveNote); setResolveMode(false); }}>✓</button>
      <button className="ctl-btn ctl-btn-cancel" onClick={() => setResolveMode(false)}>×</button>
    </div>
  );

  return (
    <div className="move-to-wrapper" onClick={e => e.stopPropagation()}>
      <button className="move-to-btn" onClick={() => setOpen(o => !o)}>Mover a <span style={{ fontSize: '9px' }}>▾</span></button>
      {open && (
        <>
          <div className="move-to-backdrop" onClick={() => setOpen(false)} />
          <div className="move-to-dropdown">
            {opts.map(o => (
              <button key={o.estado} className={`move-to-option ${o.color || ''}`}
                onClick={() => { setOpen(false); if (o.estado === 'solucionado') setResolveMode(true); else onTransition(o.estado, ''); }}>
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── Analysis Panel ───────────────────────────────────────────────────────────

const ACTION_ICONS = { crear_ticket_jira: '🎫', responder_correo: '📧', delegar: '👤', agendar_reunion: '📅', marcar_solucionado: '✅', escalar: '🔺', marcar_spam: '🚫' };

function AnalysisPanel({ analysis, actions, threadId, onSpammed, onReanalyze, fromCache, analyzedAt }) {
  const [ticketActionId, setTicketActionId] = useState(null);
  const [createdTickets, setCreatedTickets] = useState({});
  const [rejectedIds,    setRejectedIds]    = useState(new Set());
  const [spamDoneIds,    setSpamDoneIds]    = useState(new Set());

  const actionIds = {};
  (actions || []).forEach((a, i) => { if (a.id) actionIds[i] = a.id; });

  const ageStr = analyzedAt
    ? (() => { const m = Math.round((Date.now() - new Date(analyzedAt).getTime()) / 60000); if (m < 1) return 'ahora'; if (m < 60) return `hace ${m}m`; return `hace ${Math.round(m/60)}h`; })()
    : null;

  async function handleReject(idx) {
    const id = actionIds[idx];
    if (!id) return;
    await fetch(`${API}/agent/action/${id}/reject`, { method: 'POST' }).catch(() => {});
    setRejectedIds(prev => new Set([...prev, idx]));
  }

  async function execSpam(idx, blockDomain) {
    try {
      const res  = await fetch(`${API}/mail/thread/${threadId}/mark-spam`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ blockDomain }) });
      const data = await res.json();
      if (data.success) { setSpamDoneIds(prev => new Set([...prev, idx])); if (onSpammed) onSpammed(data); }
    } catch {}
  }

  return (
    <div className="ai-analysis-body">
      <div className="ai-analysis-header">
        <span className="ai-analysis-title">🤖 Análisis de Jarvis</span>
        <div className="ai-analysis-meta">
          {fromCache && ageStr && <span>cache · {ageStr} · </span>}
          <button className="ai-reanalyze-btn" onClick={onReanalyze} title="Re-analizar">🔄 Re-analizar</button>
        </div>
      </div>

      <div className="ai-analysis-resumen">{analysis.resumen}</div>

      <div className="ai-analysis-badges">
        {analysis.urgencia && <span className={`ai-badge ai-badge-urgencia-${analysis.urgencia}`}>{analysis.urgencia === 'alta' ? '⚡ ' : ''}urgencia {analysis.urgencia}</span>}
        {analysis.tipo     && <span className="ai-badge ai-badge-tipo">{analysis.tipo.replace(/_/g, ' ')}</span>}
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
                <span className="ai-action-num">{ACTION_ICONS[a.tipo] || '→'}</span>
                <div className="ai-action-body">
                  <div className="ai-action-desc">
                    {ticketDone  ? <span style={{ color: '#4ade80' }}>✅ Ticket <a href={ticketDone.url} target="_blank" rel="noreferrer" className="tp-ticket-link">{ticketDone.key}</a> creado</span>
                    : isSpamDone ? <span style={{ color: '#4ade80' }}>✅ Marcado como spam</span>
                    : isRejected ? <span style={{ color: '#6b7280', textDecoration: 'line-through' }}>{a.descripcion}</span>
                    : a.descripcion}
                  </div>

                  {!ticketDone && !isRejected && !isSpamDone && (
                    <div className="ai-action-meta">
                      {a.asignar_a && a.asignar_a !== 'null' && <span className="ai-action-tag assignee">→ {a.asignar_a}</span>}
                      {a.prioridad && <span className={`ai-action-tag prioridad-${a.prioridad}`}>{a.prioridad}</span>}
                      <span className="ai-action-tag">{(a.tipo || '').replace(/_/g, ' ')}</span>

                      {isJira && actionId && !showForm && (
                        <button className="ai-action-tag ai-action-btn-ticket" onClick={() => setTicketActionId(i)}
                          style={{ cursor: 'pointer', background: 'rgba(96,165,250,.12)', color: '#60a5fa', border: '1px solid rgba(96,165,250,.3)', borderRadius: 3, padding: '1px 6px', fontSize: '10px' }}>
                          📋 Preparar ticket
                        </button>
                      )}

                      {isSpam && (
                        <>
                          <button className="ai-action-tag" onClick={() => execSpam(i, false)}
                            style={{ cursor: 'pointer', background: 'rgba(239,68,68,.12)', color: '#f87171', border: '1px solid rgba(239,68,68,.3)', borderRadius: 3, padding: '1px 6px', fontSize: '10px' }}>
                            🚫 Marcar spam
                          </button>
                          <button className="ai-action-tag" onClick={() => execSpam(i, true)}
                            style={{ cursor: 'pointer', background: 'rgba(239,68,68,.08)', color: '#fb923c', border: '1px solid rgba(239,68,68,.2)', borderRadius: 3, padding: '1px 6px', fontSize: '10px' }}>
                            🔇 + bloquear dominio
                          </button>
                        </>
                      )}

                      {actionId && (
                        <button className="ai-action-tag" onClick={() => handleReject(i)}
                          style={{ cursor: 'pointer', background: 'rgba(239,68,68,.08)', color: '#f87171', border: '1px solid rgba(239,68,68,.2)', borderRadius: 3, padding: '1px 6px', fontSize: '10px' }}>
                          ❌ Rechazar
                        </button>
                      )}
                    </div>
                  )}

                  {showForm && actionId && (
                    <TicketPreview
                      actionId={actionId}
                      threadId={threadId}
                      onCreated={ticket => { setCreatedTickets(prev => ({ ...prev, [i]: ticket })); setTicketActionId(null); }}
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
        <div className="ai-parse-error">⚠️ Análisis incompleto — el JSON no pudo parsearse.</div>
      )}
    </div>
  );
}

// ─── Spam inline confirm ──────────────────────────────────────────────────────

function SpamConfirm({ thread, onSpammed, onCancel }) {
  const domain = (thread.last_from_email || '').split('@')[1] || '?';
  const [loading, setLoading] = useState(false);

  async function exec(blockDomain) {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/mail/thread/${thread.thread_id}/mark-spam`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ blockDomain }),
      });
      const data = await res.json();
      if (data.success && onSpammed) onSpammed(data);
    } catch {}
    setLoading(false);
  }

  return (
    <div className="spam-confirm-modal" onClick={e => e.stopPropagation()}>
      <span className="spam-confirm-question">¿Marcar como spam?</span>
      <span className="spam-confirm-domain">({domain})</span>
      <button className="ctl-btn" onClick={() => exec(false)} disabled={loading} style={{ background: 'rgba(239,68,68,.15)', color: '#f87171' }}>
        Solo spam
      </button>
      <button className="ctl-btn" onClick={() => exec(true)} disabled={loading} style={{ background: 'rgba(239,68,68,.08)', color: '#fb923c' }}>
        + Bloquear dominio
      </button>
      <button className="ctl-btn" onClick={onCancel}>✕</button>
    </div>
  );
}

// ─── Main MailModal ───────────────────────────────────────────────────────────

const INITIAL_MSGS = 3;

export default function MailModal({ thread: t, onClose, onTransition, onSpam, onFeedback, isInformativo = false }) {
  const [messages,      setMessages]      = useState(null);
  const [loadingMsgs,   setLoadingMsgs]   = useState(false);
  const [showAll,       setShowAll]       = useState(false);

  const [showReply,     setShowReply]     = useState(false);
  const [replyText,     setReplyText]     = useState('');
  const [replyMode,     setReplyMode]     = useState('reply');
  const [suggestLoading,setSuggestLoading]= useState(false);
  const [sendLoading,   setSendLoading]   = useState(false);

  const [analysisData,  setAnalysisData]  = useState(
    t.ai_analysis ? { analysis: JSON.parse(t.ai_analysis), actions: [], from_cache: true } : null
  );
  const [analysisLoading,setAnalysisLoading] = useState(false);
  const [showAnalysis,  setShowAnalysis]  = useState(false);
  const [analysisCollapsed, setAnalysisCollapsed] = useState(false);

  const [showWhy,       setShowWhy]       = useState(false);
  const [whyData,       setWhyData]       = useState(null);
  const [whyLoading,    setWhyLoading]    = useState(false);

  const [showSpamConfirm, setShowSpamConfirm] = useState(false);
  const [showFeedbackModal, setShowFeedbackModal] = useState(false);
  const [replyDropdown, setReplyDropdown] = useState(false);

  const bodyRef = useRef(null);

  // Load messages on mount
  useEffect(() => {
    setLoadingMsgs(true);
    fetch(`${API}/mail/thread/${t.thread_id}/messages`)
      .then(r => r.json())
      .then(d => setMessages(d.messages || []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));
  }, [t.thread_id]);

  // Close on Escape
  useEffect(() => {
    const h = e => { if (e.key === 'Escape') onClose(); };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, [onClose]);

  const replyTo          = calcReplyTo(messages, t);
  const replyAllContacts = calcReplyAll(messages || []);
  const ccRecipients     = replyMode === 'reply_all'
    ? replyAllContacts.filter(r => r.email !== replyTo.to).map(r => r.email).join(', ')
    : '';

  async function openReply(mode = 'reply') {
    setReplyMode(mode);
    setShowReply(true);
    setReplyDropdown(false);
    if (!replyText) {
      setSuggestLoading(true);
      try {
        const res  = await fetch(`${API}/mail/thread/${t.thread_id}/suggest-reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
        const data = await res.json();
        if (data.draft) setReplyText(data.draft);
      } catch {}
      setSuggestLoading(false);
    }
  }

  async function handleSend() {
    if (!replyText.trim()) return;
    setSendLoading(true);
    try {
      await fetch(`${API}/mail/thread/${t.thread_id}/reply`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ body: replyText, to: replyTo.to, cc: ccRecipients, subject: replyTo.subject, reply_mode: replyMode }),
      });
      setReplyText('');
      setShowReply(false);
      onClose();
    } catch {}
    setSendLoading(false);
  }

  async function toggleAnalysis() {
    if (showAnalysis) { setShowAnalysis(false); return; }
    if (analysisData && !analysisData.actions?.length) {
      setShowAnalysis(true); setAnalysisLoading(true);
      try {
        const res  = await fetch(`${API}/mail/thread/${t.thread_id}/analysis`);
        const data = await res.json();
        if (data.analysis) setAnalysisData({ analysis: data.analysis, actions: data.actions || [], from_cache: true, analyzed_at: data.analyzed_at });
      } catch {}
      setAnalysisLoading(false); return;
    }
    if (analysisData?.actions?.length) { setShowAnalysis(true); return; }
    setAnalysisLoading(true); setShowAnalysis(true);
    try {
      const res  = await fetch(`${API}/mail/thread/${t.thread_id}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: false }) });
      const data = await res.json();
      if (data.success) setAnalysisData(data);
    } catch {}
    setAnalysisLoading(false);
  }

  async function toggleWhy() {
    if (showWhy) { setShowWhy(false); return; }
    if (!whyData) {
      setWhyLoading(true);
      try { const r = await fetch(`${API}/mail/thread/${t.thread_id}/why`); setWhyData(await r.json()); } catch {}
      setWhyLoading(false);
    }
    setShowWhy(true);
  }

  function handleTransitionLocal(estado, note) {
    if (onTransition) onTransition(t.thread_id, estado, note);
    onClose();
  }

  function handleSpammed(data) {
    if (onSpam) onSpam(t.thread_id, data);
    onClose();
  }

  const days = t.days_since_last ?? 0;
  const ageClass = ageDays(days);
  const ageLabel = days === 0 ? 'hoy' : `${days}d`;

  const visible     = showAll ? (messages || []) : (messages || []).slice(-INITIAL_MSGS);
  const hiddenCount = (messages?.length || 0) - INITIAL_MSGS;

  return (
    <>
      {/* Overlay */}
      <div className="mail-modal-overlay" onClick={onClose} />

      {/* Modal */}
      <div className="mail-modal" role="dialog" aria-modal="true">
        {/* Header */}
        <div className="mail-modal-header">
          <div className="mail-modal-title">
            <span className="mail-modal-subject">{t.subject || '(sin asunto)'}</span>
            <div className="mail-modal-meta">
              <span className="mail-modal-client">{t.client?.name || t.client_name}</span>
              {t.client?.name || t.client_name ? <span className="mail-modal-sep">·</span> : null}
              <span>{t.message_count} msg{t.message_count !== 1 ? 's' : ''}</span>
              <span className="mail-modal-sep">·</span>
              <span className={`ctl-age ${ageClass}`}>{ageLabel}</span>
              {t.jira_issue_key && (
                <span className="mail-modal-sep">·</span>
              )}
              {t.jira_issue_key && (
                <a href={`https://alejandro-bermudez.atlassian.net/browse/${t.jira_issue_key}`} target="_blank" rel="noreferrer"
                  className="mail-modal-jira-key">
                  {t.jira_issue_key}
                </a>
              )}
            </div>
          </div>
          <button className="mail-modal-close" onClick={onClose} aria-label="Cerrar">✕</button>
        </div>

        {/* Body */}
        <div className="mail-modal-body" ref={bodyRef}>

          {/* Action bar */}
          <div className="mail-modal-actions">
            <MoveToDropdown t={t} onTransition={handleTransitionLocal} />

            {/* Reply dropdown */}
            <div className="reply-dropdown-wrapper">
              <button className="ctl-btn ctl-btn-send" onClick={() => openReply('reply')} style={{ borderRadius: '6px 0 0 6px', paddingRight: '6px' }}>
                ↩ Responder
              </button>
              {replyAllContacts.length > 1 && (
                <button className="ctl-btn ctl-btn-send" onClick={() => setReplyDropdown(v => !v)} style={{ borderRadius: '0 6px 6px 0', borderLeft: '1px solid rgba(255,255,255,.15)', padding: '4px 6px' }}>
                  ▾
                </button>
              )}
              {replyDropdown && (
                <>
                  <div className="move-to-backdrop" onClick={() => setReplyDropdown(false)} />
                  <div className="move-to-dropdown">
                    <button className="move-to-option" onClick={() => openReply('reply')}>Responder a uno</button>
                    <button className="move-to-option" onClick={() => openReply('reply_all')}>Responder a todos ({replyAllContacts.length})</button>
                  </div>
                </>
              )}
            </div>

            <button
              className={`ctl-btn ctl-btn-analyze ${showAnalysis ? 'active' : ''}`}
              onClick={toggleAnalysis}
              disabled={analysisLoading}
            >
              {analysisLoading ? '🤖 …' : '🤖 Analizar'}
            </button>

            {!showSpamConfirm ? (
              <button className="ctl-btn" onClick={() => setShowSpamConfirm(true)}
                style={{ fontSize: '11px', background: 'rgba(239,68,68,.08)', color: '#f87171', border: '1px solid rgba(239,68,68,.2)' }}>
                🚫 Spam
              </button>
            ) : (
              <SpamConfirm thread={t} onSpammed={handleSpammed} onCancel={() => setShowSpamConfirm(false)} />
            )}

            <a href={GMAIL(t.thread_id)} target="_blank" rel="noreferrer" className="ctl-btn ctl-btn-reply">Gmail ↗</a>

            <button className="ctl-btn ctl-btn-feedback" onClick={() => setShowFeedbackModal(true)} title="Corregir clasificación">✎ Corregir</button>

            <button className={`ctl-btn ctl-btn-why ${showWhy ? 'active' : ''}`} onClick={toggleWhy} title="¿Por qué Jarvis clasificó así?">
              {whyLoading ? '…' : '?'}
            </button>
          </div>

          {/* Analysis panel */}
          {showAnalysis && (
            <div className="ai-analysis-panel">
              {analysisLoading && <div className="ai-analysis-loading">🤖 Jarvis está analizando el hilo completo…</div>}
              {!analysisLoading && analysisData?.analysis && (
                <>
                  <div className="ai-analysis-collapse-header" onClick={() => setAnalysisCollapsed(v => !v)}
                    style={{ cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', marginBottom: analysisCollapsed ? 0 : '6px' }}>
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
                      onSpammed={handleSpammed}
                      onReanalyze={async () => {
                        setAnalysisLoading(true);
                        try {
                          const res  = await fetch(`${API}/mail/thread/${t.thread_id}/analyze`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ force: true }) });
                          const data = await res.json();
                          if (data.success) setAnalysisData(data);
                        } catch {}
                        setAnalysisLoading(false);
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

          {/* Messages */}
          <div className="thread-messages" style={{ maxHeight: '340px', overflowY: 'auto', margin: '12px 0' }}>
            {loadingMsgs && <div className="thread-loading">Cargando conversación...</div>}
            {!loadingMsgs && messages?.length === 0 && <div className="thread-loading">Sin mensajes.</div>}
            {messages && (
              <>
                {hiddenCount > 0 && !showAll && (
                  <button className="show-more-btn" onClick={() => setShowAll(true)}>
                    Ver {hiddenCount} mensaje{hiddenCount > 1 ? 's' : ''} anterior{hiddenCount > 1 ? 'es' : ''}
                  </button>
                )}
                {visible.map(m => <Bubble key={m.message_id} msg={m} />)}
              </>
            )}
          </div>

          {/* Why panel */}
          {showWhy && whyData && (
            <div className="why-panel">
              <div className="why-title">📋 ¿Por qué está aquí?</div>
              <div className="why-pipeline">Pipeline: {whyData.pipeline}</div>
              <div className="why-explanation">{whyData.explanation}</div>
              {whyData.steps?.length > 0 && (
                <details className="why-steps-details">
                  <summary className="why-steps-toggle">Ver pasos ({whyData.steps.length})</summary>
                  <div className="why-steps">
                    {whyData.steps.map((s, i) => (
                      <div key={i} className={`why-step ${s.matched === false ? 'step-pass' : s.matched ? 'step-match' : ''}`}>
                        <span className="step-name">{s.step}</span>
                        {s.matched === true  && <span className="step-badge match">✓</span>}
                        {s.matched === false && <span className="step-badge pass">—</span>}
                        {(s.result || s.reason || s.detail || s.note) && (
                          <span className="step-detail">{s.result || s.reason || s.detail || s.note}</span>
                        )}
                      </div>
                    ))}
                  </div>
                </details>
              )}
            </div>
          )}

          {/* Reply area */}
          {!isInformativo && (
            <div className="reply-area" style={{ marginTop: '8px' }}>
              {!showReply ? (
                <button className="mail-reply-open-btn" onClick={() => openReply('reply')}>
                  ✏ Escribir respuesta{suggestLoading ? ' (generando borrador…)' : '...'}
                </button>
              ) : (
                <>
                  <div className="reply-to-info">
                    <span className="reply-to-label">Para: </span>
                    <strong className="reply-to-email">{replyTo.to}</strong>
                    {replyMode === 'reply_all' && ccRecipients && (
                      <span className="reply-cc-list"><br/>CC: {ccRecipients}</span>
                    )}
                    <span className="reply-to-subject"> · {replyTo.subject}</span>
                  </div>
                  {suggestLoading && <div className="thread-loading" style={{ fontSize: '11px', padding: '6px 0' }}>✦ Generando borrador...</div>}
                  <textarea
                    className="reply-input"
                    placeholder="Escribe tu respuesta..."
                    value={replyText}
                    onChange={e => setReplyText(e.target.value)}
                    rows={5}
                    autoFocus
                  />
                  <div className="reply-actions">
                    <button className="ctl-btn ctl-btn-send" onClick={handleSend} disabled={sendLoading || !replyText.trim()}>
                      {sendLoading ? 'Enviando...' : 'Enviar'}
                    </button>
                    <button className="ctl-btn ctl-btn-suggest" onClick={async () => {
                      setSuggestLoading(true);
                      try {
                        const r = await fetch(`${API}/mail/thread/${t.thread_id}/suggest-reply`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
                        const d = await r.json();
                        if (d.draft) setReplyText(d.draft);
                      } catch {}
                      setSuggestLoading(false);
                    }} disabled={suggestLoading}>
                      {suggestLoading ? '✦ ...' : '✦ Regenerar'}
                    </button>
                    <button className="ctl-btn" onClick={() => { setShowReply(false); setReplyText(''); }} style={{ color: '#6b7280' }}>
                      ✕ Cancelar
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Feedback modal */}
      {showFeedbackModal && (
        <FeedbackModal
          thread={t}
          onClose={() => setShowFeedbackModal(false)}
          onFeedbackSent={() => {}}
        />
      )}
    </>
  );
}
