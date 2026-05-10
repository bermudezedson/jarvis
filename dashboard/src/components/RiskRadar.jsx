const DOT_CLASS = { high: 'dot-red', medium: 'dot-yellow', low: 'dot-green', info: 'dot-blue' };

function RiskItem({ alert }) {
  return (
    <div className={`risk-item risk-${alert.severity}`}>
      <span className={`risk-dot ${DOT_CLASS[alert.severity] || 'dot-blue'}`} />
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

export default function RiskRadar({ alerts }) {
  if (!alerts.length) {
    return <div className="radar-empty">Sin alertas activas.</div>;
  }

  return (
    <div className="risk-radar">
      {alerts.map((alert, i) => (
        <RiskItem key={i} alert={alert} />
      ))}
    </div>
  );
}
