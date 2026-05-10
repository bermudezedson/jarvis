import { useState, useEffect } from 'react';

function daysUntil(deadline) {
  if (!deadline) return null;
  const diff = Math.ceil((new Date(deadline) - new Date()) / 86400000);
  return diff;
}

function DeadlineBadge({ deadline }) {
  const days = daysUntil(deadline);
  if (days === null) return null;
  const cls = days < 0 ? 'deadline-overdue' : days === 0 ? 'deadline-today' : 'deadline-upcoming';
  const label = days < 0 ? `vencido hace ${Math.abs(days)}d` : days === 0 ? 'vence hoy' : `${days}d`;
  return <span className={`deadline-badge ${cls}`}>{label}</span>;
}

function CommitmentItem({ item, onResolve }) {
  const isOverdue = daysUntil(item.deadline) < 0;
  return (
    <div className={`commitment-item ${isOverdue ? 'commit-overdue' : ''}`}>
      <div className="commit-header">
        <span className="commit-to" title={item.to}>{item.to?.split('@')[0] || 'desconocido'}</span>
        <DeadlineBadge deadline={item.deadline} />
      </div>
      <p className="commit-phrase">"{item.phrase}"</p>
      <p className="commit-context">{item.context}</p>
      <div className="commit-footer">
        <span className="commit-subject" title={item.email_subject}>{item.email_subject}</span>
        <button className="commit-resolve-btn" onClick={() => onResolve(item.id)}>
          ✓ Resuelto
        </button>
      </div>
    </div>
  );
}

export default function CommitmentTracker() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [showAll, setShowAll] = useState(false);

  async function load() {
    try {
      const res = await fetch('/api/commitments');
      if (res.ok) setData(await res.json());
    } catch {}
    setLoading(false);
  }

  async function resolve(id) {
    await fetch(`/api/commitments/${id}/resolve`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
    load();
  }

  useEffect(() => { load(); }, []);

  if (loading) return <div className="commit-empty">Cargando compromisos...</div>;
  if (!data) return <div className="commit-empty">Sin datos de compromisos.</div>;

  const allOpen = data.open || [];
  const visible = showAll ? allOpen : allOpen.slice(0, 5);

  return (
    <div className="commitment-tracker">
      <div className="commit-summary">
        <span className={`commit-count ${data.overdue_count > 0 ? 'count-red' : 'count-ok'}`}>
          {data.open_count} abiertos
        </span>
        {data.overdue_count > 0 && (
          <span className="commit-count count-red">{data.overdue_count} vencidos</span>
        )}
      </div>

      {visible.length === 0 && <div className="commit-empty">Sin compromisos pendientes.</div>}

      {visible.map(item => (
        <CommitmentItem key={item.id} item={item} onResolve={resolve} />
      ))}

      {allOpen.length > 5 && (
        <button className="show-more-btn" onClick={() => setShowAll(v => !v)}>
          {showAll ? 'Ver menos' : `Ver ${allOpen.length - 5} más`}
        </button>
      )}
    </div>
  );
}
