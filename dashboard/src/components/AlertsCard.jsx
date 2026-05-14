import { useNavigate } from 'react-router-dom';

export default function AlertsCard({ alerts, loading }) {
  const navigate = useNavigate();

  return (
    <div className="home-card alerts-card">
      <div className="home-card-title">Alertas</div>

      {loading && <div className="home-card-loading">Calculando alertas...</div>}

      {!loading && (!alerts || alerts.length === 0) && (
        <div className="home-card-empty" style={{ color: '#4ade80' }}>
          ✓ Sin alertas activas
        </div>
      )}

      <div className="alerts-list">
        {(alerts || []).slice(0, 6).map((a, i) => (
          <div
            key={i}
            className={`alert-item alert-item--${a.severity}`}
            onClick={() => navigate(a.link || '/')}
            role="button"
            tabIndex={0}
          >
            <span className={`alert-dot alert-dot--${a.severity}`} />
            <span className="alert-text">{a.text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
