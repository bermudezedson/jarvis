import { useState, useEffect, useCallback } from 'react';

const API   = 'http://localhost:3000/api';
const GMAIL = id => `https://mail.google.com/mail/u/0/#inbox/${id}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ageBadge(days) {
  if (days <= 2)  return { cls: 'ctl-age-ok',   label: days === 0 ? 'hoy' : `${days}d` };
  if (days <= 7)  return { cls: 'ctl-age-warn',  label: `${days}d` };
  return              { cls: 'ctl-age-crit',  label: `${days}d` };
}

function EmpresaBadge({ empresa }) {
  const list = Array.isArray(empresa) ? empresa : empresa ? [empresa] : [];
  return (
    <>
      {list.map(e => (
        <span key={e} className={`ctl-empresa ${e === 'ClickRepuestos' ? 'ctl-cr' : 'ctl-ws'}`}>
          {e === 'ClickRepuestos' ? 'CR' : 'WS'}
        </span>
      ))}
    </>
  );
}

function senderDisplay(t) {
  if (t.last_sender_is_me) return 'tú respondiste';
  const email = t.last_from?.match(/[a-zA-Z0-9._%+-]+@[\w.-]+/)?.[0];
  const name  = t.last_from?.split('<')[0].trim().replace(/"/g, '');
  return name || email || 'cliente';
}

// ─── Thread row ───────────────────────────────────────────────────────────────

function ThreadRow({ t, onArchive, onJira, jiraStatus }) {
  const age    = ageBadge(t.days_since_last ?? 0);
  const sevCls = t.severity === 'high' ? 'ctl-row-high' : t.severity === 'medium' ? 'ctl-row-med' : '';

  return (
    <div className={`ctl-row ${sevCls}`}>
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
        <div className="ctl-actions">
          <a
            href={GMAIL(t.thread_id)}
            target="_blank"
            rel="noreferrer"
            className="ctl-btn ctl-btn-reply"
            title="Abrir en Gmail"
          >
            {t.last_sender_is_me ? 'Seguimiento' : 'Responder'}
          </a>

          {jiraStatus === 'done'
            ? <span className="ctl-btn ctl-btn-jira ctl-jira-done">✓ Jira</span>
            : <button
                className={`ctl-btn ctl-btn-jira ${jiraStatus === 'loading' ? 'ctl-loading' : ''}`}
                onClick={() => onJira(t.thread_id)}
                disabled={jiraStatus === 'loading'}
                title="Crear issue en Jira"
              >
                {jiraStatus === 'loading' ? '...' : 'Jira'}
              </button>
          }

          <button
            className="ctl-btn ctl-btn-archive"
            onClick={() => onArchive(t.thread_id)}
            title="Archivar thread"
          >
            Archivar
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Archived row (compact) ───────────────────────────────────────────────────

function ArchivedRow({ t }) {
  const age = ageBadge(t.days_since_last ?? 0);
  return (
    <div className="ctl-row ctl-row-archived">
      <div className="ctl-row-badges">
        <span className="ctl-badge ctl-badge-archived">ARCHIVADO</span>
        {t.client?.empresa && <EmpresaBadge empresa={t.client.empresa} />}
      </div>
      <div className="ctl-row-main">
        <div className="ctl-row-header">
          <span className="ctl-client">{t.client?.name}</span>
          <span className="ctl-subject">{t.subject}</span>
        </div>
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
  { id: 'urgente',  label: 'Urgentes' },
  { id: 'pending',  label: 'Pendientes' },
  { id: 'waiting',  label: 'Esperando' },
  { id: 'archived', label: 'Archivados' },
];

export default function ClientActionList({ clientThreads }) {
  const [localItems, setLocalItems] = useState([]);
  const [activeFilter, setActiveFilter] = useState('urgente');
  const [jiraStatus, setJiraStatus]     = useState({}); // { thread_id: 'loading'|'done'|'error' }

  // Sync local items when prop changes (e.g. auto-refresh)
  useEffect(() => {
    if (clientThreads?.items) {
      setLocalItems(clientThreads.items);
    }
  }, [clientThreads]);

  const handleArchive = useCallback(async (thread_id) => {
    // Optimistic: mark archived locally
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

  const handleJira = useCallback(async (thread_id) => {
    setJiraStatus(prev => ({ ...prev, [thread_id]: 'loading' }));
    try {
      const res = await fetch(`${API}/task-bridge/email-to-jira`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ thread_id }),
      });
      if (res.ok) {
        setJiraStatus(prev => ({ ...prev, [thread_id]: 'done' }));
      } else {
        setJiraStatus(prev => ({ ...prev, [thread_id]: 'error' }));
      }
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

  // Build filtered lists
  const urgent   = localItems.filter(t => t.severity === 'high'   && !t.last_sender_is_me && t.estado !== 'archivado');
  const pending  = localItems.filter(t => t.severity !== 'high'   && !t.last_sender_is_me && t.estado !== 'archivado');
  const waiting  = localItems.filter(t =>  t.last_sender_is_me                             && t.estado !== 'archivado');
  const archived = localItems.filter(t => t.estado === 'archivado');

  const counts = { urgente: urgent.length, pending: pending.length, waiting: waiting.length, archived: archived.length };

  let visibleItems = [];
  if (activeFilter === 'urgente')  visibleItems = urgent;
  if (activeFilter === 'pending')  visibleItems = pending;
  if (activeFilter === 'waiting')  visibleItems = waiting;
  if (activeFilter === 'archived') visibleItems = archived;

  const scanStats = clientThreads.scan_stats;
  const scannedAt = clientThreads.scanned_at
    ? new Date(clientThreads.scanned_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })
    : null;

  return (
    <div className="client-action-list">
      {/* ── Header ── */}
      <div className="ctl-header">
        <div className="ctl-header-badges">
          {clientThreads.high_severity > 0 && (
            <span className="ctl-summary-badge ctl-summary-red">⚡ {clientThreads.high_severity} urgentes</span>
          )}
          <span className="ctl-summary-badge ctl-summary-blue">{clientThreads.requiring_my_action} requieren acción</span>
          <span className="ctl-summary-badge ctl-summary-gold">{clientThreads.waiting_client_response} esperando cliente</span>
        </div>
      </div>

      {/* ── Filter tabs ── */}
      <div className="ctl-filters">
        {FILTER_TABS.map(f => (
          <button
            key={f.id}
            className={`ctl-filter-tab ${activeFilter === f.id ? 'active' : ''} ${f.id === 'urgente' && counts.urgente > 0 ? 'has-urgent' : ''}`}
            onClick={() => setActiveFilter(f.id)}
          >
            {f.label}
            <span className="ctl-filter-count">{counts[f.id] ?? counts.pending}</span>
          </button>
        ))}
      </div>

      {/* ── Thread list ── */}
      <div className="ctl-list">
        {visibleItems.length === 0 && (
          <div className="ctl-list-empty">
            {activeFilter === 'urgente'  && '✓ Sin correos urgentes de clientes.'}
            {activeFilter === 'pending'  && '✓ Sin correos pendientes.'}
            {activeFilter === 'waiting'  && 'Sin hilos en espera de respuesta.'}
            {activeFilter === 'archived' && 'Sin threads archivados.'}
          </div>
        )}
        {activeFilter === 'archived'
          ? visibleItems.map(t => <ArchivedRow key={t.thread_id} t={t} />)
          : visibleItems.map(t => (
              <ThreadRow
                key={t.thread_id}
                t={t}
                onArchive={handleArchive}
                onJira={handleJira}
                jiraStatus={jiraStatus[t.thread_id]}
              />
            ))
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
