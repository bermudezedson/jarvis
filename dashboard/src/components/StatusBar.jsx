function MetricCard({ label, value, sub, borderColor, subColor }) {
  return (
    <div className="metric-card" style={{ borderLeft: `3px solid ${borderColor}` }}>
      <div className="metric-value">{value ?? '—'}</div>
      <div className="metric-label">{label}</div>
      {sub && (
        <div className="metric-sub" style={subColor ? { color: subColor } : undefined}>
          {sub}
        </div>
      )}
    </div>
  );
}

export default function StatusBar({ metrics, threadMetrics }) {
  const nm = metrics?.next_meeting;

  const urgentes     = threadMetrics?.correos_urgentes ?? 0;
  const correoAccion = threadMetrics?.correos_accion   ?? null;

  const clientSub = threadMetrics == null
    ? 'Sin datos — escanear clientes'
    : urgentes > 0
      ? `${urgentes} urgentes sin responder`
      : 'Sin correos urgentes';

  const jiraSub = metrics == null
    ? 'Sin datos de Jira'
    : metrics.overdue_tasks > 0
      ? `${metrics.overdue_tasks} vencidas`
      : 'Al día';

  const calSub = metrics == null
    ? 'Sin datos de Calendar'
    : nm
      ? `Próxima ${nm.time} — ${nm.title}`
      : 'Sin reuniones pendientes';

  const commitSub = metrics?.overdue_commitments > 0
    ? `${metrics.overdue_commitments} vencidos`
    : metrics?.open_commitments != null
      ? 'Al día'
      : 'Sin datos';

  return (
    <div className="status-bar">
      <MetricCard
        label="Correos de clientes"
        value={correoAccion}
        sub={clientSub}
        borderColor="#ef4444"
        subColor={urgentes > 0 ? '#ef4444' : undefined}
      />
      <MetricCard
        label="Tareas Jira hoy"
        value={metrics?.jira_tasks_today ?? '—'}
        sub={jiraSub}
        borderColor="#f59e0b"
        subColor={metrics?.overdue_tasks > 0 ? '#f59e0b' : undefined}
      />
      <MetricCard
        label="Reuniones"
        value={metrics?.meetings_today ?? '—'}
        sub={calSub}
        borderColor="#22c55e"
        subColor="#22c55e"
      />
      <MetricCard
        label="Compromisos abiertos"
        value={metrics?.open_commitments ?? '—'}
        sub={commitSub}
        borderColor="#3b82f6"
        subColor={metrics?.overdue_commitments > 0 ? '#f59e0b' : undefined}
      />
    </div>
  );
}
