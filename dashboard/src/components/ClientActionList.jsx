import { useState, useEffect, useCallback } from 'react';
import FeedbackModal from './FeedbackModal';

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

// ─── Thread row (expandable accordion) ───────────────────────────────────────

const INITIAL_MESSAGES = 3;

function ThreadRow({ t, onArchive, onResolve, onJira, onFeedback, jiraStatus }) {
  const [expanded,       setExpanded]       = useState(false);
  const [messages,       setMessages]       = useState(null);
  const [loadingMsgs,    setLoadingMsgs]    = useState(false);
  const [showAll,        setShowAll]        = useState(false);
  const [replyText,      setReplyText]      = useState('');
  const [suggestLoading, setSuggestLoading] = useState(false);
  const [sendLoading,    setSendLoading]    = useState(false);
  const [resolveNote,    setResolveNote]    = useState('');
  const [showResolve,    setShowResolve]    = useState(false);
  const [replyMode,      setReplyMode]      = useState('reply'); // 'reply' | 'reply_all'

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
    <div className={`ctl-row ${sevCls} ${expanded ? 'ctl-row-expanded' : ''}`}>
      {/* ── Summary row (click to expand) ── */}
      <div className="ctl-row-summary" onClick={toggle} style={{ cursor: 'pointer' }}>
        <div className="ctl-row-badges">
          {!t.last_sender_is_me
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
            {t.jira_suggested && <><span className="ctl-sep">·</span><span className="ctl-jira-hint">→ Jira</span></>}
          </div>
        </div>

        <div className="ctl-row-right">
          <span className={`ctl-age ${age.cls}`}>{age.label}</span>
          <span className="ctl-expand-icon">{expanded ? '▲' : '▼'}</span>
        </div>
      </div>

      {/* ── Accordion body ── */}
      {expanded && (
        <div className="ctl-accordion">
          {/* Messages */}
          <div className="thread-messages">
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

          {/* Reply area */}
          <div className="reply-area">
            {/* Reply mode toggle */}
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
            />
            <div className="reply-actions">
              <button
                className="ctl-btn ctl-btn-suggest"
                onClick={suggestReply}
                disabled={suggestLoading}
              >
                {suggestLoading ? '✦ Generando...' : '✦ Jarvis'}
              </button>
              <button
                className="ctl-btn ctl-btn-send"
                onClick={sendReply}
                disabled={sendLoading || !replyText.trim()}
              >
                {sendLoading ? 'Enviando...' : 'Enviar'}
              </button>
              <a
                href={GMAIL(t.thread_id)}
                target="_blank"
                rel="noreferrer"
                className="ctl-btn ctl-btn-reply"
              >
                Gmail ↗
              </a>
            </div>
          </div>

          {/* Action bar */}
          <div className="action-bar">
            {/* Jira */}
            {jiraStatus === 'done'
              ? <span className="ctl-btn ctl-btn-jira ctl-jira-done">✓ Jira</span>
              : <button
                  className={`ctl-btn ctl-btn-jira ${jiraStatus === 'loading' ? 'ctl-loading' : ''}`}
                  onClick={e => { e.stopPropagation(); onJira(t.thread_id); }}
                  disabled={jiraStatus === 'loading'}
                >
                  {jiraStatus === 'loading' ? '...' : 'Crear Jira'}
                </button>
            }

            {/* Solucionado */}
            {showResolve ? (
              <div className="resolve-form" onClick={e => e.stopPropagation()}>
                <input
                  className="resolve-input"
                  placeholder="Nota de resolución (opcional)"
                  value={resolveNote}
                  onChange={e => setResolveNote(e.target.value)}
                />
                <button
                  className="ctl-btn ctl-btn-resolve-confirm"
                  onClick={() => { onResolve(t.thread_id, resolveNote); setShowResolve(false); }}
                >
                  ✓ Confirmar
                </button>
                <button className="ctl-btn ctl-btn-cancel" onClick={() => setShowResolve(false)}>×</button>
              </div>
            ) : (
              <button
                className="ctl-btn ctl-btn-resolve"
                onClick={e => { e.stopPropagation(); setShowResolve(true); }}
              >
                Solucionado
              </button>
            )}

            {/* Archivar */}
            <button
              className="ctl-btn ctl-btn-archive"
              onClick={e => { e.stopPropagation(); onArchive(t.thread_id); }}
            >
              Archivar
            </button>

            {/* Corregir / Feedback */}
            <button
              className="ctl-btn ctl-btn-feedback"
              onClick={e => { e.stopPropagation(); onFeedback(t); }}
              title="Corregir clasificación — enseñar a Jarvis"
            >
              ✎ Corregir
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Informativo row (muted, no reply button) ─────────────────────────────────

function InformativoRow({ t, onArchive, onFeedback }) {
  const age = ageBadge(t.days_since_last ?? 0);
  return (
    <div className="ctl-row ctl-row-informativo">
      <div className="ctl-row-badges">
        <span className="ctl-badge ctl-badge-info">INFO</span>
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
        </div>
      </div>
      <div className="ctl-row-right">
        <span className={`ctl-age ${age.cls}`}>{age.label}</span>
        <div className="ctl-actions">
          <a href={GMAIL(t.thread_id)} target="_blank" rel="noreferrer" className="ctl-btn ctl-btn-reply">Gmail</a>
          <button className="ctl-btn ctl-btn-archive" onClick={() => onArchive(t.thread_id)}>Archivar</button>
          <button className="ctl-btn ctl-btn-feedback" onClick={() => onFeedback(t)} title="Corregir clasificación">✎</button>
        </div>
      </div>
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
  { id: 'solucionado', label: 'Solucionados' },
  { id: 'archived',    label: 'Archivados' },
];

export default function ClientActionList({ clientThreads }) {
  const [localItems,    setLocalItems]    = useState([]);
  const [activeFilter,  setActiveFilter]  = useState('urgente');
  const [jiraStatus,    setJiraStatus]    = useState({});
  const [closedItems,   setClosedItems]   = useState(null);  // lazy loaded
  const [closedLoading, setClosedLoading] = useState(false);
  const [feedbackThread,setFeedbackThread]= useState(null);  // thread to give feedback on
  const [showInvestigate, setShowInvestigate] = useState(false);

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

  const handleFeedback = useCallback((thread) => {
    setFeedbackThread(thread);
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

  const active      = localItems.filter(t => t.estado !== 'archivado' && t.estado !== 'solucionado');
  const actionable  = active.filter(t => t.estado !== 'informativo');
  const urgent      = actionable.filter(t => t.severity === 'high'  && !t.last_sender_is_me);
  const pending     = actionable.filter(t => t.severity !== 'high'  && !t.last_sender_is_me);
  const waiting     = actionable.filter(t => t.last_sender_is_me);
  const informativos= active.filter(t => t.estado === 'informativo');

  const counts = {
    urgente:     urgent.length,
    pending:     pending.length,
    waiting:     waiting.length,
    informativo: informativos.length,
    solucionado: clientThreads.by_estado?.solucionado ?? '—',
    archived:    clientThreads.by_estado?.archivado   ?? '—',
  };

  let visibleItems = [];
  let visibleType  = 'active';
  if (activeFilter === 'urgente')     { visibleItems = urgent; }
  if (activeFilter === 'pending')     { visibleItems = pending; }
  if (activeFilter === 'waiting')     { visibleItems = waiting; }
  if (activeFilter === 'informativo') { visibleItems = informativos; visibleType = 'informativo'; }
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

      {/* ── Header ── */}
      <div className="ctl-header">
        <div className="ctl-header-badges">
          {clientThreads.high_severity > 0 && (
            <span className="ctl-summary-badge ctl-summary-red">⚡ {clientThreads.high_severity} urgentes</span>
          )}
          <span className="ctl-summary-badge ctl-summary-blue">{clientThreads.requiring_my_action} requieren acción</span>
          <span className="ctl-summary-badge ctl-summary-gold">{clientThreads.waiting_client_response} esperando cliente</span>
        </div>
        <button
          className="ctl-btn ctl-btn-investigate"
          onClick={() => setShowInvestigate(v => !v)}
          title="Buscar por qué un correo no aparece en el dashboard"
        >
          Investigar
        </button>
      </div>

      {/* ── Filter tabs ── */}
      <div className="ctl-filters">
        {FILTER_TABS.map(f => (
          <button
            key={f.id}
            className={`ctl-filter-tab ${activeFilter === f.id ? 'active' : ''} ${f.id === 'urgente' && urgent.length > 0 ? 'has-urgent' : ''}`}
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

        {!closedLoading && visibleItems.length === 0 && (
          <div className="ctl-list-empty">
            {activeFilter === 'urgente'     && '✓ Sin correos urgentes de clientes.'}
            {activeFilter === 'pending'     && '✓ Sin correos pendientes.'}
            {activeFilter === 'waiting'     && 'Sin hilos en espera de respuesta.'}
            {activeFilter === 'informativo'  && '✓ Sin correos informativos (facturas, notificaciones).'}
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
                jiraStatus={jiraStatus[t.thread_id]}
              />
            ))
          : visibleType === 'informativo'
            ? visibleItems.map(t => (
                <InformativoRow
                  key={t.thread_id}
                  t={t}
                  onArchive={handleArchive}
                  onFeedback={handleFeedback}
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
