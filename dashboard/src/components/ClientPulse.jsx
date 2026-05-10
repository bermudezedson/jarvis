import { useState, useEffect } from 'react';

const STATUS_CONFIG = {
  healthy:  { label: 'Saludable', cls: 'pulse-healthy',  dot: 'dot-green'  },
  at_risk:  { label: 'En riesgo', cls: 'pulse-at-risk',  dot: 'dot-yellow' },
  critical: { label: 'Crítico',   cls: 'pulse-critical', dot: 'dot-red'    },
  unknown:  { label: 'Sin datos', cls: 'pulse-unknown',  dot: 'dot-blue'   },
};

function ScoreBar({ score }) {
  if (score === null) return <div className="score-bar-empty">—</div>;
  const pct = Math.round(score * 100);
  const cls = pct >= 70 ? 'bar-green' : pct >= 40 ? 'bar-yellow' : 'bar-red';
  return (
    <div className="score-bar-wrap" title={`Score: ${pct}%`}>
      <div className={`score-bar-fill ${cls}`} style={{ width: `${pct}%` }} />
      <span className="score-bar-label">{pct}%</span>
    </div>
  );
}

const TIER_LABEL = { premium: 'Recurrente', standard: 'Anual', trial: 'Esporádico' };

function EmpresaBadges({ empresa }) {
  const list = Array.isArray(empresa) ? empresa : [empresa];
  return (
    <div className="cp-empresa-badges">
      {list.map(e => (
        <span key={e} className={`cp-empresa-badge ${e === 'ClickRepuestos' ? 'badge-cr' : 'badge-ws'}`}>
          {e === 'ClickRepuestos' ? 'CR' : 'WS'}
        </span>
      ))}
    </div>
  );
}

function ClientRow({ client }) {
  const [expanded, setExpanded] = useState(false);
  const cfg = STATUS_CONFIG[client.status] || STATUS_CONFIG.unknown;

  return (
    <div className={`client-row ${cfg.cls}`}>
      <div className="client-row-header" onClick={() => setExpanded(v => !v)}>
        <span className={`risk-dot ${cfg.dot}`} />
        <span className="client-name">{client.name}</span>
        {client.empresa && <EmpresaBadges empresa={client.empresa} />}
        <span className={`tier-badge tier-${client.tier}`}>{TIER_LABEL[client.tier] || client.tier}</span>
        <ScoreBar score={client.score} />
        <span className="client-status-label">{cfg.label}</span>
        <span className="expand-icon">{expanded ? '▲' : '▼'}</span>
      </div>

      {expanded && client.breakdown && (
        <div className="client-breakdown">
          <BreakdownRow label="Último email"    days={client.breakdown.last_email_age_days}   score={client.breakdown.email_score} />
          <BreakdownRow label="Última reunión"  days={client.breakdown.last_meeting_age_days} score={client.breakdown.meeting_score} />
          <div className="breakdown-row">
            <span className="bd-label">Tickets abiertos</span>
            <span className="bd-value">{client.breakdown.open_tickets}</span>
            <ScoreBar score={client.breakdown.ticket_score} />
          </div>
          {client.alert && <p className="client-alert">⚠ {client.alert}</p>}
        </div>
      )}
      {expanded && !client.breakdown && client.alert && (
        <div className="client-breakdown">
          <p className="client-alert">⚠ {client.alert}</p>
        </div>
      )}
    </div>
  );
}

function BreakdownRow({ label, days, score }) {
  return (
    <div className="breakdown-row">
      <span className="bd-label">{label}</span>
      <span className="bd-value">{days != null ? `${days}d` : '—'}</span>
      <ScoreBar score={score} />
    </div>
  );
}

export default function ClientPulse() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);

  async function load() {
    try {
      const res = await fetch('/api/clients/pulse');
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }

  async function refresh() {
    setLoading(true);
    try {
      await fetch('/api/clients/pulse/refresh', { method: 'POST' });
      await load();
    } catch { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="pulse-empty">Calculando health scores...</div>;
  if (!data) return <div className="pulse-empty">Sin datos — <button className="inline-btn" onClick={refresh}>calcular ahora</button></div>;

  return (
    <div className="client-pulse">
      <div className="pulse-header">
        <div className="pulse-summary">
          {data.summary.critical > 0 && <span className="pulse-badge badge-red">{data.summary.critical} críticos</span>}
          {data.summary.at_risk > 0 && <span className="pulse-badge badge-yellow">{data.summary.at_risk} en riesgo</span>}
          {data.summary.healthy > 0 && <span className="pulse-badge badge-green">{data.summary.healthy} saludables</span>}
        </div>
        <button className="inline-btn" onClick={refresh}>↻ Recalcular</button>
      </div>

      <div className="client-list">
        {(data.clients || []).map(c => (
          <ClientRow key={c.name} client={c} />
        ))}
      </div>

      {data.is_mock && <p className="mock-note">Datos de demostración — conecta los MCP para datos reales</p>}
    </div>
  );
}
