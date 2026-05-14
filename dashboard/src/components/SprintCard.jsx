import { useNavigate } from 'react-router-dom';

const STATUS_CLS = {
  'In Progress': 'status-progress',
  'To Do':       'status-todo',
  'Done':        'status-done',
};

function initials(name) {
  if (!name) return '?';
  return name.split(' ').map(w => w[0]).slice(0, 2).join('').toUpperCase();
}

function avatarColor(name) {
  const colors = ['#6366f1', '#8b5cf6', '#06b6d4', '#10b981', '#f59e0b', '#ef4444'];
  const hash   = (name || '?').split('').reduce((a, c) => a + c.charCodeAt(0), 0);
  return colors[hash % colors.length];
}

export default function SprintCard({ data, loading }) {
  const navigate = useNavigate();

  if (loading) return (
    <div className="home-card sprint-card">
      <div className="home-card-title">Sprint activo</div>
      <div className="home-card-loading">Cargando datos de Jira...</div>
    </div>
  );

  if (!data || !data.jiraAvailable) return (
    <div className="home-card sprint-card">
      <div className="home-card-title">Sprint activo</div>
      <div className="home-card-empty">No hay datos de sprint disponibles</div>
    </div>
  );

  const { sprint, tickets, summary } = data;

  return (
    <div className="home-card sprint-card">
      <div className="home-card-header">
        <div className="home-card-title">Sprint activo</div>
        {sprint && (
          <span className="sprint-name">{sprint.name}</span>
        )}
      </div>

      {summary && (
        <div className="sprint-summary-bar">
          <span className="sprint-stat sprint-stat--progress">{summary.inProgress} en progreso</span>
          <span className="sprint-stat sprint-stat--todo">{summary.todo} por hacer</span>
          {summary.overdue > 0 && (
            <span className="sprint-stat sprint-stat--overdue">⚠ {summary.overdue} atrasadas</span>
          )}
        </div>
      )}

      <div className="sprint-ticket-list">
        {(tickets || []).slice(0, 6).map(ticket => (
          <div key={ticket.key} className={`sprint-ticket ${ticket.overdue ? 'sprint-ticket--overdue' : ''}`}>
            <div
              className="sprint-avatar"
              style={{ background: avatarColor(ticket.assignee) }}
              title={ticket.assignee || 'Sin asignar'}
            >
              {initials(ticket.assignee)}
            </div>
            <div className="sprint-ticket-info">
              <span className="sprint-ticket-summary">{(ticket.summary || '').substring(0, 48)}</span>
              <span className="sprint-ticket-key">{ticket.key}</span>
            </div>
            <span className={`sprint-ticket-status ${STATUS_CLS[ticket.status] || 'status-todo'}`}>
              {ticket.status || 'To Do'}
            </span>
          </div>
        ))}
        {!tickets?.length && <div className="home-card-empty">Sin tareas en el sprint</div>}
      </div>

      <button className="home-card-link" onClick={() => navigate('/sprint')}>Ver tablero →</button>
    </div>
  );
}
