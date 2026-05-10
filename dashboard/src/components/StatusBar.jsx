function severity(value, warnAt, alertAt) {
  if (value === null || value === undefined) return 'unknown';
  if (value >= alertAt) return 'red';
  if (value >= warnAt) return 'yellow';
  return 'green';
}

function MetricCard({ label, value, sub, sev }) {
  return (
    <div className={`metric-card sev-${sev || 'ok'}`}>
      <div className="metric-value">{value ?? '—'}</div>
      <div className="metric-label">{label}</div>
      {sub && <div className="metric-sub">{sub}</div>}
    </div>
  );
}

export default function StatusBar({ metrics }) {
  if (!metrics) return <div className="status-bar status-bar--empty">Sin datos de métricas</div>;

  const m = metrics;
  const nm = m.next_meeting;

  return (
    <div className="status-bar">
      <MetricCard
        label="Correos sin leer"
        value={m.unread_emails}
        sub={m.emails_need_decision != null ? `${m.emails_need_decision} requieren decisión` : null}
        sev={severity(m.emails_need_decision, 2, 5)}
      />
      <MetricCard
        label="Tareas Jira hoy"
        value={m.jira_tasks_today}
        sub={m.overdue_tasks != null ? `${m.overdue_tasks} vencidas` : null}
        sev={severity(m.overdue_tasks, 1, 3)}
      />
      <MetricCard
        label="Reuniones"
        value={m.meetings_today}
        sub={nm ? `Próxima ${nm.time} — ${nm.title}` : 'Sin reuniones pendientes'}
        sev="ok"
      />
      <MetricCard
        label="Compromisos abiertos"
        value={m.open_commitments ?? '—'}
        sub={m.overdue_commitments != null ? `${m.overdue_commitments} vencidos` : 'Disponible en Fase 2'}
        sev={severity(m.overdue_commitments, 1, 3)}
      />
    </div>
  );
}
