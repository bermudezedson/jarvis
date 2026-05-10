import { useState, useCallback, useEffect } from 'react';

const API = 'http://localhost:3000/api';
const GMAIL_URL = id => `https://mail.google.com/mail/u/0/#inbox/${id}`;

// ─── Helpers ──────────────────────────────────────────────────────────────────

function ageBadge(days) {
  if (days === 0)  return { label: 'hoy',           cls: 'age-ok'  };
  if (days === 1)  return { label: 'hace 1d',        cls: 'age-ok'  };
  if (days <= 3)   return { label: `hace ${days}d`,  cls: 'age-warn' };
  if (days <= 7)   return { label: `hace ${days}d`,  cls: 'age-warn' };
  return           { label: `hace ${days}d`,         cls: 'age-crit' };
}

function EmpresaBadge({ empresa }) {
  const list = Array.isArray(empresa) ? empresa : [empresa];
  return (
    <span className="ct-empresa-wrap">
      {list.map(e => (
        <span key={e} className={`ct-empresa ${e === 'ClickRepuestos' ? 'ct-cr' : 'ct-ws'}`}>
          {e === 'ClickRepuestos' ? 'CR' : 'WS'}
        </span>
      ))}
    </span>
  );
}

// ─── Single thread row ────────────────────────────────────────────────────────

function ThreadCard({ t }) {
  const [open, setOpen] = useState(false);
  const age  = ageBadge(t.days_since_last ?? 0);
  const sevCls = t.severity === 'high' ? 'ct-sev-high' : t.severity === 'medium' ? 'ct-sev-med' : 'ct-sev-low';

  return (
    <div className={`ct-card ${sevCls}`}>
      <div className="ct-card-top" onClick={() => setOpen(v => !v)}>
        <span className={`ct-sev-bar`} />
        <div className="ct-card-main">
          <div className="ct-card-header">
            <span className="ct-client-name">{t.client?.name}</span>
            {t.client?.empresa && <EmpresaBadge empresa={t.client.empresa} />}
            <span className={`ct-age ${age.cls}`}>{age.label}</span>
            {t.jira_suggested && <span className="ct-jira-hint">→ Jira</span>}
          </div>
          <p className="ct-subject">{t.subject}</p>
          <p className="ct-meta">
            {t.message_count} {t.message_count === 1 ? 'mensaje' : 'mensajes'}
            {t.last_sender_is_me
              ? <span className="ct-last-sender"> · último: <em>tú</em></span>
              : <span className="ct-last-sender"> · último: <em>{t.last_from?.split('<')[0].trim() || 'cliente'}</em></span>
            }
          </p>
        </div>
        <div className="ct-card-actions" onClick={e => e.stopPropagation()}>
          <a href={GMAIL_URL(t.thread_id)} target="_blank" rel="noreferrer" className="ct-btn ct-btn-gmail" title="Abrir en Gmail">
            ↗ Gmail
          </a>
        </div>
        <span className="ct-expand">{open ? '▲' : '▼'}</span>
      </div>
      {open && t.snippet && (
        <p className="ct-snippet">"{t.snippet}"</p>
      )}
    </div>
  );
}

// ─── Section ──────────────────────────────────────────────────────────────────

function Section({ title, icon, items, emptyMsg }) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? items : items.slice(0, 5);
  return (
    <div className="ct-section">
      <div className="ct-section-title">
        <span className="ct-section-icon">{icon}</span>
        {title}
        <span className="ct-section-count">{items.length}</span>
      </div>
      {items.length === 0
        ? <p className="ct-empty-section">{emptyMsg}</p>
        : <>
            {visible.map(t => <ThreadCard key={t.thread_id} t={t} />)}
            {items.length > 5 && (
              <button className="ct-show-more" onClick={() => setShowAll(v => !v)}>
                {showAll ? 'Ver menos' : `+${items.length - 5} más`}
              </button>
            )}
          </>
      }
    </div>
  );
}

// ─── Scan stats pill ─────────────────────────────────────────────────────────

function ScanStats({ stats, scanType }) {
  if (!stats) return null;
  const parts = [];
  if (stats.new > 0)     parts.push(`${stats.new} nuevos`);
  if (stats.updated > 0) parts.push(`${stats.updated} actualizados`);
  if (stats.skipped > 0) parts.push(`${stats.skipped} sin cambios`);
  if (parts.length === 0) return null;
  const label = scanType === 'refresh_states' ? '⟳ sin costo' : '⟳';
  return (
    <span className="ct-scan-stats" title={`Tipo: ${scanType}`}>
      {label} {parts.join(' · ')}
    </span>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function ClientThreads() {
  const [data,     setData]     = useState(null);
  const [loading,  setLoading]  = useState(true);
  const [scanning, setScanning] = useState(false);
  const [days,     setDays]     = useState(30);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`${API}/mail/client-threads`);
      const json = await res.json();
      setData(json.scanned === false ? null : json);
    } catch {}
    setLoading(false);
  }, []);

  const scan = useCallback(async (mode = 'incremental') => {
    setScanning(true);
    try {
      const body = mode === 'initial'
        ? { mode, days }
        : { mode };
      const res = await fetch(`${API}/mail/client-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });
      const json = await res.json();
      setData(json);
    } catch {}
    setScanning(false);
  }, [days]);

  // Silent refresh_states every 5 min — recalculates severities, zero Gmail cost
  useEffect(() => {
    if (!data) return;
    const interval = setInterval(async () => {
      try {
        const res = await fetch(`${API}/mail/client-scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'refresh_states' }),
        });
        const json = await res.json();
        setData(json);
      } catch {}
    }, 5 * 60 * 1000);
    return () => clearInterval(interval);
  }, [data]);

  useEffect(() => { load(); }, [load]);

  // Split items
  const items         = data?.items || [];
  const needsAction   = items.filter(t => !t.last_sender_is_me);
  const waitingClient = items.filter(t =>  t.last_sender_is_me);

  return (
    <div className="client-threads">
      {/* ── Header ── */}
      <div className="ct-header">
        <div className="ct-header-left">
          {data && (
            <div className="ct-summary">
              {data.high_severity > 0 && (
                <span className="ct-badge ct-badge-red">⚡ {data.high_severity} urgentes</span>
              )}
              <span className="ct-badge ct-badge-blue">{data.requiring_my_action} requieren acción</span>
              <span className="ct-badge ct-badge-gold">{data.waiting_client_response} esperando cliente</span>
              {data.scanned_at && (
                <span className="ct-scan-time">
                  Escaneado {new Date(data.scanned_at).toLocaleString('es-CL', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
              <ScanStats stats={data.scan_stats} scanType={data.scan_type} />
            </div>
          )}
        </div>
        <div className="ct-header-right">
          <select className="mc-hours-select" value={days} onChange={e => setDays(Number(e.target.value))}>
            <option value={7}>7 días</option>
            <option value={14}>14 días</option>
            <option value={30}>30 días</option>
            <option value={60}>60 días</option>
          </select>
          {data && (
            <button className="mc-classify-btn" onClick={() => scan('incremental')} disabled={scanning}>
              {scanning ? '⟳ Escaneando...' : '⟳ Escanear nuevos'}
            </button>
          )}
        </div>
      </div>

      {/* ── Loading / empty state ── */}
      {loading && <div className="mc-loading"><div className="spinner" /><span>Cargando...</span></div>}

      {scanning && (
        <div className="mc-loading">
          <div className="spinner" />
          <span>Escaneando correos de clientes...</span>
        </div>
      )}

      {!loading && !scanning && !data && (
        <div className="mc-empty">
          <p>Sin escaneo de clientes aún.</p>
          <p className="mc-empty-sub">Busca TODOS los hilos con clientes (leídos y no leídos) y detecta quién tiene la pelota.</p>
          <button className="mc-classify-btn" onClick={() => scan('initial')}>
            ⟳ Escaneo inicial ({days} días)
          </button>
        </div>
      )}

      {/* ── Two sections ── */}
      {!scanning && data && (
        <div className="ct-sections">
          <Section
            title="Requieren tu respuesta"
            icon="●"
            items={needsAction}
            emptyMsg="Sin correos pendientes de clientes. ¡Al día!"
          />
          <Section
            title="Esperando respuesta del cliente"
            icon="⏳"
            items={waitingClient}
            emptyMsg="Sin hilos en espera de respuesta."
          />
        </div>
      )}
    </div>
  );
}
