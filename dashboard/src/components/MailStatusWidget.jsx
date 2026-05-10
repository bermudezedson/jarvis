import { useState, useEffect } from 'react';

const API = 'http://localhost:3000/api';

const GMAIL_THREAD_URL = id =>
  `https://mail.google.com/mail/u/0/#inbox/${id}`;

// ─── Mini donut (CSS conic-gradient) ─────────────────────────────────────────

function DonutChart({ segments }) {
  const total = segments.reduce((s, x) => s + x.value, 0);
  if (total === 0) return null;
  let angle = 0;
  const stops = segments.map(seg => {
    const pct = (seg.value / total) * 360;
    const from = angle; angle += pct;
    return `${seg.color} ${from}deg ${angle}deg`;
  });
  return (
    <div className="msw-donut-wrap">
      <div className="msw-donut" style={{ background: `conic-gradient(${stops.join(', ')})` }} />
      <span className="msw-donut-total">{total}</span>
    </div>
  );
}

// ─── Thread row ───────────────────────────────────────────────────────────────

function ThreadRow({ t }) {
  const [open, setOpen] = useState(false);
  const urgent = (t.age_days ?? 0) >= 3;
  const ageLabel = t.age_days == null ? '' :
    t.age_days === 0 ? 'hoy' :
    t.age_days === 1 ? 'hace 1d' : `hace ${t.age_days}d`;

  const pillCls =
    t.estado === 'esperando_nosotros' ? 'msw-pill-us' :
    t.estado === 'esperando_cliente'  ? 'msw-pill-client' :
    t.estado === 'en_jira'            ? 'msw-pill-jira' : 'msw-pill-pending';

  const pillLabel =
    t.estado === 'esperando_nosotros' ? '● Respóndele' :
    t.estado === 'esperando_cliente'  ? '⏳ Esperando respuesta' :
    t.estado === 'en_jira'            ? '◈ En Jira' : '○ Sin gestionar';

  return (
    <div className={`msw-thread ${urgent ? 'msw-urgent' : ''}`}>
      <div className="msw-thread-top">
        <div className="msw-thread-info" onClick={() => setOpen(v => !v)}>
          <span className="msw-client">{t.client?.name ?? t.client}</span>
          <span className="msw-subject">{t.subject}</span>
        </div>
        <div className="msw-thread-right">
          <span className={`msw-pill ${pillCls}`}>{pillLabel}</span>
          {ageLabel && <span className={`msw-age ${urgent ? 'msw-age-red' : ''}`}>{ageLabel}</span>}
          <a
            href={GMAIL_THREAD_URL(t.thread_id)}
            target="_blank"
            rel="noreferrer"
            className="msw-open-btn"
            title="Abrir en Gmail"
            onClick={e => e.stopPropagation()}
          >
            ↗
          </a>
        </div>
      </div>
      {open && t.snippet && (
        <p className="msw-snippet">"{t.snippet}"</p>
      )}
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
      .then(json => { if (json.classified !== false) setData(json); })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  if (loading) return <div className="msw-empty">Cargando correos...</div>;
  if (!data)   return (
    <div className="msw-empty">
      Sin clasificaciones —{' '}
      <a href="#" onClick={e => { e.preventDefault(); window.location.hash=''; }}>
        ve a la pestaña Correo y clasifica.
      </a>
    </div>
  );

  const items = data.items || [];
  const now   = Date.now();
  const ageDays = dateStr => dateStr
    ? Math.floor((now - new Date(dateStr)) / 86400000)
    : null;

  // ── Group threads ──────────────────────────────────────────────────────────

  // 1. Threads that need OUR response:
  //    - explicitly marked esperando_nosotros, OR
  //    - from known client, needs_action, pending, undecided (auto-detect)
  const needsUs = items
    .filter(i => i.client && (
      i.estado === 'esperando_nosotros' ||
      (i.needs_action && i.aprobado === null && (!i.estado || i.estado === 'pendiente'))
    ))
    .map(i => ({ ...i, age_days: ageDays(i.date), estado: i.estado === 'esperando_nosotros' ? 'esperando_nosotros' : 'esperando_nosotros' }))
    .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0));  // oldest first

  // 2. Waiting for CLIENT response
  const waitingClient = items
    .filter(i => i.client && i.estado === 'esperando_cliente')
    .map(i => ({ ...i, age_days: ageDays(i.date) }))
    .sort((a, b) => (b.age_days ?? 0) - (a.age_days ?? 0));

  // 3. In Jira
  const inJira = items
    .filter(i => i.client && i.estado === 'en_jira')
    .map(i => ({ ...i, age_days: ageDays(i.date) }));

  const overdueUs     = needsUs.filter(t => (t.age_days ?? 0) >= 3).length;
  const overdueClient = waitingClient.filter(t => (t.age_days ?? 0) >= 5).length;

  const segments = [
    { value: needsUs.length,      color: 'var(--iron-red)',  label: 'Acción requerida' },
    { value: waitingClient.length, color: 'var(--iron-gold)', label: 'Esperando cliente' },
    { value: inJira.length,        color: 'var(--purple)',    label: 'En Jira' },
  ].filter(s => s.value > 0);

  const allClear = needsUs.length === 0 && waitingClient.length === 0;

  return (
    <div className="mail-status-widget">
      <div className="msw-header">
        <span className="msw-title">Correos con Clientes</span>
        {data.classified_at && (
          <span className="msw-time">
            {new Date(data.classified_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
          </span>
        )}
      </div>

      {/* Summary */}
      <div className="msw-summary">
        <DonutChart segments={segments} />
        <div className="msw-stats">
          {needsUs.length > 0 && (
            <div className="msw-stat">
              <span className="msw-stat-dot" style={{ background: 'var(--iron-red)' }} />
              <span className="msw-stat-n">{needsUs.length}</span>
              <span className="msw-stat-lbl">
                requieren tu respuesta
                {overdueUs > 0 && <span className="msw-overdue">{overdueUs} con +3d de atraso</span>}
              </span>
            </div>
          )}
          {waitingClient.length > 0 && (
            <div className="msw-stat">
              <span className="msw-stat-dot" style={{ background: 'var(--iron-gold)' }} />
              <span className="msw-stat-n">{waitingClient.length}</span>
              <span className="msw-stat-lbl">
                esperando respuesta del cliente
                {overdueClient > 0 && <span className="msw-overdue">{overdueClient} sin respuesta +5d</span>}
              </span>
            </div>
          )}
          {inJira.length > 0 && (
            <div className="msw-stat">
              <span className="msw-stat-dot" style={{ background: 'var(--purple)' }} />
              <span className="msw-stat-n">{inJira.length}</span>
              <span className="msw-stat-lbl">en Jira</span>
            </div>
          )}
          {allClear && (
            <p className="msw-clear">✓ Sin correos de clientes pendientes</p>
          )}
        </div>
      </div>

      {/* Thread lists */}
      {needsUs.length > 0 && (
        <div className="msw-section">
          <p className="msw-section-title">● Requieren tu respuesta</p>
          {needsUs.slice(0, 6).map(t => <ThreadRow key={t.thread_id} t={t} />)}
          {needsUs.length > 6 && (
            <p className="msw-more">+{needsUs.length - 6} más en la pestaña Correo</p>
          )}
        </div>
      )}

      {waitingClient.length > 0 && (
        <div className="msw-section">
          <p className="msw-section-title">⏳ Esperando respuesta del cliente</p>
          {waitingClient.slice(0, 4).map(t => <ThreadRow key={t.thread_id} t={t} />)}
        </div>
      )}
    </div>
  );
}
