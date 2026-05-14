// Compact email thread list for MailPage — click opens MailModal
import { useState } from 'react';

const FILTER_TABS = [
  { id: 'urgente',     label: 'Urgentes',     severity: 'danger' },
  { id: 'pending',     label: 'Pendientes',   severity: '' },
  { id: 'waiting',     label: 'Esperando',    severity: '' },
  { id: 'informativo', label: 'Informativos', severity: '' },
  { id: 'nuevos',      label: 'Nuevos',       severity: '' },
  { id: 'solucionado', label: 'Resueltos',    severity: '' },
  { id: 'archived',    label: 'Archivados',   severity: '' },
];

function ageDays(days) {
  if (days <= 2) return 'age-ok';
  if (days <= 7) return 'age-warn';
  return 'age-crit';
}

function EmpresaBadge({ empresa }) {
  const list = Array.isArray(empresa) ? empresa
    : typeof empresa === 'string' && empresa.includes(',') ? empresa.split(',')
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

function ThreadItem({ t, onClick, isInformativo = false }) {
  const days = t.days_since_last ?? 0;
  const dot  = isInformativo ? 'dot-gray'
    : t.severity === 'high' || t.severity === 'critical' ? 'dot-red'
    : t.last_sender_is_me ? 'dot-blue'
    : 'dot-orange';

  return (
    <div
      className={`email-row ${isInformativo ? 'email-row--informativo' : ''}`}
      onClick={() => onClick(t)}
      role="button"
      tabIndex={0}
      onKeyDown={e => e.key === 'Enter' && onClick(t)}
    >
      <span className={`email-dot ${dot}`} />

      <div className="email-row-main">
        <span className="email-client">
          {t.client?.name || t.client_name || t.last_from_email?.split('@')[1] || '?'}
        </span>
        {t.client?.empresa || t.client_empresa ? (
          <EmpresaBadge empresa={t.client?.empresa || t.client_empresa} />
        ) : null}
        <span className="email-subject">{t.subject || '(sin asunto)'}</span>
      </div>

      <div className="email-row-right">
        {t.jira_issue_key && (
          <span className="email-jira-key" onClick={e => { e.stopPropagation(); window.open(`https://alejandro-bermudez.atlassian.net/browse/${t.jira_issue_key}`, '_blank'); }}>
            {t.jira_issue_key}
          </span>
        )}
        {t.ai_analysis && !t.jira_issue_key && (
          <span className="email-analyzed">✓</span>
        )}
        <span className={`email-age ${ageDays(days)}`}>{days === 0 ? 'hoy' : `${days}d`}</span>
      </div>
    </div>
  );
}

export default function EmailList({ clientThreads, threadMetrics, uncategorized, onOpenThread }) {
  const [activeFilter, setActiveFilter] = useState('urgente');

  const items = clientThreads?.items || [];
  const URGENTE_EST = ['requiere_mi_accion', 'esperando_nosotros', 'pendiente'];
  const active      = items.filter(t => t.estado !== 'archivado' && t.estado !== 'solucionado');
  const urgent      = active.filter(t => URGENTE_EST.includes(t.estado) && !t.last_sender_is_me && (t.severity === 'high' || t.severity === 'critical'));
  const pending     = active.filter(t => URGENTE_EST.includes(t.estado) && !t.last_sender_is_me && t.severity !== 'high' && t.severity !== 'critical');
  const waiting     = active.filter(t => t.estado === 'esperando_cliente');
  const informativos= active.filter(t => t.estado === 'informativo');

  const counts = {
    urgente:     threadMetrics?.correos_urgentes   ?? urgent.length,
    pending:     threadMetrics?.correos_pendientes ?? pending.length,
    waiting:     threadMetrics?.esperando_cliente  ?? waiting.length,
    informativo: threadMetrics?.informativos       ?? informativos.length,
    nuevos:      uncategorized?.length ?? '?',
    solucionado: threadMetrics?.solucionados       ?? '—',
    archived:    threadMetrics?.archivados         ?? '—',
  };

  let visibleItems = [];
  let visibleType  = 'active';
  if (activeFilter === 'urgente')     { visibleItems = urgent; }
  if (activeFilter === 'pending')     { visibleItems = pending; }
  if (activeFilter === 'waiting')     { visibleItems = waiting; }
  if (activeFilter === 'informativo') { visibleItems = informativos; visibleType = 'informativo'; }
  if (activeFilter === 'nuevos')      { visibleItems = uncategorized || []; visibleType = 'nuevos'; }

  return (
    <div className="email-list">
      {/* Filter pills */}
      <div className="email-filters">
        {FILTER_TABS.map(f => (
          <button
            key={f.id}
            className={`email-filter-pill ${activeFilter === f.id ? 'active' : ''} ${f.id === 'urgente' && (counts.urgente || 0) > 0 ? 'has-urgent' : ''}`}
            onClick={() => setActiveFilter(f.id)}
          >
            {f.label}
            {counts[f.id] !== undefined && (
              <span className="email-filter-count">{counts[f.id]}</span>
            )}
          </button>
        ))}
      </div>

      {/* Thread list */}
      <div className="email-rows">
        {visibleItems.length === 0 && (
          <div className="email-empty">
            {activeFilter === 'urgente' && '✓ Sin correos urgentes.'}
            {activeFilter === 'pending' && '✓ Sin correos pendientes.'}
            {activeFilter === 'waiting' && 'Sin hilos en espera.'}
            {activeFilter === 'informativo' && '✓ Sin informativos.'}
            {activeFilter === 'nuevos' && 'Sin correos nuevos. Haz ↻ Actualizar para escanear.'}
            {activeFilter === 'solucionado' && 'Sin resueltos.'}
            {activeFilter === 'archived' && 'Sin archivados.'}
          </div>
        )}
        {visibleItems.map(t => (
          <ThreadItem
            key={t.thread_id}
            t={t}
            onClick={onOpenThread}
            isInformativo={visibleType === 'informativo' || t.estado === 'informativo'}
          />
        ))}
      </div>
    </div>
  );
}
