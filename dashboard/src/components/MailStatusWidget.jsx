import { useState, useEffect } from 'react';

const API = 'http://localhost:3000/api';

// ─── Mini donut chart (CSS conic-gradient) ────────────────────────────────────

function DonutChart({ segments }) {
  // segments: [{ value, color, label }]
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;

  let angle = 0;
  const stops = segments.map(seg => {
    const pct = (seg.value / total) * 360;
    const start = angle;
    angle += pct;
    return `${seg.color} ${start}deg ${angle}deg`;
  });

  return (
    <div className="msw-donut-wrap">
      <div
        className="msw-donut"
        style={{ background: `conic-gradient(${stops.join(', ')})` }}
        title={segments.map(s => `${s.label}: ${s.value}`).join(' | ')}
      />
      <span className="msw-donut-total">{total}</span>
    </div>
  );
}

// ─── Client thread row ────────────────────────────────────────────────────────

function ThreadRow({ thread }) {
  const ageLabel = thread.age_days != null
    ? thread.age_days === 0 ? 'hoy' : `hace ${thread.age_days}d`
    : '';
  const urgent = thread.age_days >= 3;

  return (
    <div className={`msw-thread-row ${urgent ? 'msw-thread-urgent' : ''}`}>
      <div className="msw-thread-main">
        <span className="msw-thread-client">{thread.client}</span>
        <span className="msw-thread-subject" title={thread.subject}>{thread.subject}</span>
      </div>
      <div className="msw-thread-meta">
        <span className={`msw-estado-pill msw-estado-${thread.estado}`}>
          {thread.estado === 'esperando_cliente'  ? '⏳ Esperando cliente'  :
           thread.estado === 'esperando_nosotros' ? '● Acción requerida'   :
           thread.estado === 'en_jira'            ? '◈ En Jira'            :
                                                    '○ Pendiente'}
        </span>
        {ageLabel && <span className={`msw-age ${urgent ? 'msw-age-urgent' : ''}`}>{ageLabel}</span>}
      </div>
    </div>
  );
}

// ─── Main widget ──────────────────────────────────────────────────────────────

export default function MailStatusWidget() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API}/mail/inbox`)
      .then(r => r.json())
      .then(json => {
        if (json.classified !== false) setData(json);
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="msw-empty">Cargando correos...</div>;
  if (!data)   return <div className="msw-empty">Sin clasificaciones — ve a la pestaña Correo y clasifica.</div>;

  const items = data.items || [];

  // Build stats
  const byEstado = data.by_estado || {};
  const waitingClient  = items.filter(i => i.estado === 'esperando_cliente');
  const waitingUs      = items.filter(i => i.estado === 'esperando_nosotros' || (i.needs_action && i.aprobado === null && i.estado === 'pendiente'));
  const inJira         = items.filter(i => i.estado === 'en_jira');
  const overdueWaiting = waitingClient.filter(i => {
    if (!i.date) return false;
    const days = Math.floor((Date.now() - new Date(i.date)) / 86400000);
    return days >= 3;
  });

  // Threads to show: client threads with notable estado
  const notableThreads = items
    .filter(i => i.client && i.estado !== 'archivado' && i.estado !== 'pendiente')
    .sort((a, b) => {
      // Waiting-on-us first, then by age
      const priority = { esperando_nosotros: 0, en_jira: 1, esperando_cliente: 2 };
      const pa = priority[a.estado] ?? 3;
      const pb = priority[b.estado] ?? 3;
      if (pa !== pb) return pa - pb;
      return new Date(a.date) - new Date(b.date); // oldest first
    })
    .slice(0, 8)
    .map(i => ({
      client: i.client?.name || '—',
      subject: i.subject || '(sin asunto)',
      estado: i.estado,
      age_days: i.date ? Math.floor((Date.now() - new Date(i.date)) / 86400000) : null,
    }));

  // Also add "pendiente with needs_action" that have client and are old
  const pendingWithClient = items
    .filter(i => i.client && i.needs_action && i.aprobado === null && i.estado === 'pendiente')
    .filter(i => {
      if (!i.date) return false;
      return Math.floor((Date.now() - new Date(i.date)) / 86400000) >= 2;
    })
    .slice(0, 4)
    .map(i => ({
      client: i.client?.name || '—',
      subject: i.subject || '(sin asunto)',
      estado: 'esperando_nosotros',
      age_days: i.date ? Math.floor((Date.now() - new Date(i.date)) / 86400000) : null,
    }));

  const allThreads = [...pendingWithClient, ...notableThreads].slice(0, 10);

  const segments = [
    { value: waitingUs.length,     color: 'var(--iron-red)',  label: 'Acción requerida' },
    { value: waitingClient.length, color: 'var(--iron-gold)', label: 'Esperando cliente' },
    { value: inJira.length,        color: 'var(--purple)',    label: 'En Jira' },
  ].filter(s => s.value > 0);

  return (
    <div className="mail-status-widget">
      <div className="msw-header">
        <span className="msw-title">Estado de Correos con Clientes</span>
        {data.classified_at && (
          <span className="msw-age">
            {new Date(data.classified_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Summary row */}
      <div className="msw-summary">
        <DonutChart segments={segments} />
        <div className="msw-stats">
          {waitingUs.length > 0 && (
            <div className="msw-stat msw-stat-us">
              <span className="msw-stat-dot" style={{ background: 'var(--iron-red)' }} />
              <span className="msw-stat-n">{waitingUs.length}</span>
              <span className="msw-stat-label">requieren acción tuya</span>
            </div>
          )}
          {waitingClient.length > 0 && (
            <div className="msw-stat msw-stat-client">
              <span className="msw-stat-dot" style={{ background: 'var(--iron-gold)' }} />
              <span className="msw-stat-n">{waitingClient.length}</span>
              <span className="msw-stat-label">
                esperando cliente
                {overdueWaiting.length > 0 && (
                  <span className="msw-overdue-pill">{overdueWaiting.length} con +3d sin respuesta</span>
                )}
              </span>
            </div>
          )}
          {inJira.length > 0 && (
            <div className="msw-stat">
              <span className="msw-stat-dot" style={{ background: 'var(--purple)' }} />
              <span className="msw-stat-n">{inJira.length}</span>
              <span className="msw-stat-label">en Jira</span>
            </div>
          )}
          {segments.length === 0 && (
            <p className="msw-all-clear">✓ Sin hilos de cliente activos — todo gestionado</p>
          )}
        </div>
      </div>

      {/* Thread list */}
      {allThreads.length > 0 && (
        <div className="msw-thread-list">
          <p className="msw-thread-list-title">Hilos activos con clientes</p>
          {allThreads.map((t, i) => <ThreadRow key={i} thread={t} />)}
        </div>
      )}

      {allThreads.length === 0 && segments.length > 0 && (
        <p className="msw-empty-threads">
          Marca hilos como "Esperando cliente" o "Acción requerida" en la pestaña Correo para verlos aquí.
        </p>
      )}
    </div>
  );
}
