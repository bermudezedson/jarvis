export default function MetricCard({ icon, value, label, sub, variant = 'default', onClick }) {
  return (
    <div
      className={`metric-card metric-card--${variant} ${onClick ? 'metric-card--clickable' : ''}`}
      onClick={onClick}
      role={onClick ? 'button' : undefined}
      tabIndex={onClick ? 0 : undefined}
    >
      {icon && <span className="metric-card-icon">{icon}</span>}
      <div className="metric-card-value">{value ?? '—'}</div>
      <div className="metric-card-label">{label}</div>
      {sub && <div className="metric-card-sub">{sub}</div>}
    </div>
  );
}
