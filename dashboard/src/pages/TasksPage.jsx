import { useState, useEffect } from 'react';

const API = 'http://localhost:3000/api';

const TYPE_ICONS = { crear_ticket_jira: '🎫', responder_correo: '📧', delegar: '👤', agendar_reunion: '📅', marcar_solucionado: '✅', escalar: '🔺', marcar_spam: '🚫' };

export default function TasksPage() {
  const [actions,  setActions]  = useState(null);
  const [loading,  setLoading]  = useState(false);

  useEffect(() => {
    setLoading(true);
    fetch(`${API}/agent/pending-actions`)
      .then(r => r.json())
      .then(d => setActions(d.actions || []))
      .catch(() => setActions([]))
      .finally(() => setLoading(false));
  }, []);

  async function handleReject(id) {
    await fetch(`${API}/agent/action/${id}/reject`, { method: 'POST' }).catch(() => {});
    setActions(prev => prev.filter(a => a.id !== id));
  }

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">Tareas pendientes</h2>
        <span className="page-subtitle">Acciones propuestas por Jarvis pendientes de aprobación</span>
      </div>

      {loading && <div className="page-loading">Cargando acciones...</div>}

      {!loading && (!actions || actions.length === 0) && (
        <div className="page-empty">✓ Sin acciones pendientes de aprobación</div>
      )}

      <div className="tasks-list">
        {(actions || []).map(a => (
          <div key={a.id} className="task-item">
            <span className="task-icon">{TYPE_ICONS[a.action_type] || '→'}</span>
            <div className="task-body">
              <div className="task-desc">{a.description}</div>
              <div className="task-meta">
                <span className="task-client">{a.client_name || a.thread_subject}</span>
                {a.assignee && <span className="task-assignee">→ {a.assignee}</span>}
                {a.priority && <span className={`ai-action-tag prioridad-${a.priority}`}>{a.priority}</span>}
                {a.time_estimate && <span className="ai-action-tag">{a.time_estimate}</span>}
              </div>
            </div>
            <button
              className="ctl-btn"
              onClick={() => handleReject(a.id)}
              style={{ fontSize: '10px', color: '#f87171', background: 'rgba(239,68,68,.08)', border: '1px solid rgba(239,68,68,.2)' }}
            >
              ❌ Rechazar
            </button>
          </div>
        ))}
      </div>

      <div className="page-placeholder-note">
        Panel de acciones completo disponible próximamente (Prompt #20)
      </div>
    </div>
  );
}
