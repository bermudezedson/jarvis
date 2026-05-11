const DOT = { high: 'dot-red', medium: 'dot-yellow', low: 'dot-green', info: 'dot-blue' };

function generateRisks(clientThreads, briefing, commitments, clientPulse, threadMetrics) {
  const risks = [];
  const m = briefing?.metrics;

  // 1. Client threads requiring urgent action — count from metrics (single source of truth)
  const urgentCount = threadMetrics?.correos_urgentes ?? 0;
  if (urgentCount > 0) {
    risks.push({
      severity: 'high',
      message: `${urgentCount} correo${urgentCount > 1 ? 's' : ''} de cliente${urgentCount > 1 ? 's' : ''} sin responder hace +7 días`,
      action: 'Credibilidad comercial en riesgo — responder hoy',
    });
  }

  // 2. Overdue Jira tasks
  const overdueTasks = m?.overdue_tasks || 0;
  if (overdueTasks > 0) {
    risks.push({
      severity: 'high',
      message: `${overdueTasks} tarea${overdueTasks > 1 ? 's' : ''} Jira vencida${overdueTasks > 1 ? 's' : ''} sin actualizar`,
      action: 'Revisar y actualizar estado',
    });
  }

  // 3. Critical clients (client pulse)
  const critical = clientPulse?.clients?.filter(c => c.status === 'critical') || [];
  if (critical.length > 0) {
    risks.push({
      severity: 'medium',
      message: `${critical.length} cliente${critical.length > 1 ? 's' : ''} en estado crítico`,
      clients: critical.slice(0, 4).map(c => c.name),
      action: 'Sin contacto hace +14 días — agendar llamada',
    });
  }

  // 4. At-risk clients
  const atRisk = clientPulse?.clients?.filter(c => c.status === 'at_risk') || [];
  if (atRisk.length > 0) {
    risks.push({
      severity: 'medium',
      message: `${atRisk.length} cliente${atRisk.length > 1 ? 's' : ''} en riesgo de churn`,
      clients: atRisk.slice(0, 4).map(c => c.name),
      action: 'Agendar llamada de seguimiento',
    });
  }

  // 5. Overdue commitments
  const overdueCommitments = commitments?.overdue_count || 0;
  if (overdueCommitments > 0) {
    risks.push({
      severity: 'medium',
      message: `${overdueCommitments} compromiso${overdueCommitments > 1 ? 's' : ''} vencido${overdueCommitments > 1 ? 's' : ''} por correo`,
      action: 'Revisar correos enviados',
    });
  }

  // 6. Long wait on client (we replied, no answer +14d)
  const longWait = clientThreads?.items?.filter(
    t => t.last_sender_is_me && (t.days_since_last ?? 0) > 14 && t.estado !== 'archivado'
  ) || [];
  if (longWait.length > 0) {
    risks.push({
      severity: 'low',
      message: `${longWait.length} hilo${longWait.length > 1 ? 's' : ''} con cliente sin respuesta hace +14 días`,
      action: 'Considerar reenvío o llamada',
    });
  }

  // 7. Stale Jira tasks
  const staleTasks = m?.jira_tasks_today != null && overdueTasks === 0 && m.jira_tasks_today > 5
    ? m.jira_tasks_today - overdueTasks
    : 0;
  if (staleTasks > 3) {
    risks.push({
      severity: 'low',
      message: `${m.jira_tasks_today} tareas Jira acumuladas para hoy`,
      action: 'Revisar prioridades del sprint',
    });
  }

  if (risks.length === 0) {
    risks.push({ severity: 'info', message: 'Sin alertas activas — todo en orden.', action: null });
  }

  const order = { high: 0, medium: 1, low: 2, info: 3 };
  return risks.sort((a, b) => (order[a.severity] ?? 3) - (order[b.severity] ?? 3));
}

function RiskItem({ alert }) {
  return (
    <div className={`risk-item risk-${alert.severity}`}>
      <span className={`risk-dot ${DOT[alert.severity] || 'dot-blue'}`} />
      <div className="risk-body">
        <p className="risk-message">{alert.message}</p>
        {alert.clients?.length > 0 && (
          <p className="risk-clients">{alert.clients.join(', ')}</p>
        )}
        {alert.action && <p className="risk-action">{alert.action}</p>}
      </div>
    </div>
  );
}

export default function RiskRadar({ clientThreads, briefing, commitments, clientPulse, threadMetrics }) {
  const risks = generateRisks(clientThreads, briefing, commitments, clientPulse, threadMetrics);

  // If no data at all, show a neutral state
  if (!clientThreads && !briefing) {
    return (
      <div className="risk-radar">
        <div className="radar-empty">Sin datos para calcular riesgos — ejecutar briefing o escaneo.</div>
      </div>
    );
  }

  return (
    <div className="risk-radar">
      {risks.map((alert, i) => <RiskItem key={i} alert={alert} />)}
    </div>
  );
}
