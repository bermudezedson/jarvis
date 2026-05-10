import { useState, useEffect } from 'react';

function timeAgo(date) {
  if (!date) return 'nunca';
  const mins = Math.floor((Date.now() - date.getTime()) / 60000);
  if (mins < 1) return 'ahora mismo';
  if (mins === 1) return 'hace 1 min';
  return `hace ${mins} min`;
}

export default function RefreshIndicator({ lastRefresh, onRefresh, loading }) {
  const [, tick] = useState(0);

  useEffect(() => {
    const id = setInterval(() => tick(n => n + 1), 30000);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="refresh-indicator">
      <span className="refresh-time">Datos {timeAgo(lastRefresh)}</span>
      <button
        className={`refresh-btn ${loading ? 'refreshing' : ''}`}
        onClick={onRefresh}
        disabled={loading}
        title="Actualizar ahora"
      >
        {loading ? '⟳' : '↻'} Actualizar
      </button>
    </div>
  );
}
