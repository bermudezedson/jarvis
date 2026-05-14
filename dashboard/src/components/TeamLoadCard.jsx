const TEAM = [
  { key: 'luciano', name: 'Luciano Alvares',  initials: 'LA', color: '#6366f1', role: 'ERP · CLICK' },
  { key: 'richard', name: 'Richard Martínez', initials: 'RM', color: '#06b6d4', role: 'Hosting · WYS' },
  { key: 'johana',  name: 'Johana Pailanca',  initials: 'JP', color: '#f59e0b', role: 'Admin · Finanzas' },
];

function LoadBar({ value, hasOverdue }) {
  const pct = Math.min(100, Math.round((value / 10) * 100));
  return (
    <div className="team-load-bar-bg">
      <div
        className={`team-load-bar-fill ${hasOverdue ? 'team-load-bar-fill--overdue' : ''}`}
        style={{ width: `${pct}%` }}
      />
    </div>
  );
}

export default function TeamLoadCard({ sprintData }) {
  const tickets = sprintData?.tickets || [];

  const load = TEAM.map(member => {
    const memberTickets = tickets.filter(t =>
      (t.assignee || '').toLowerCase().includes(member.name.split(' ')[0].toLowerCase())
    );
    const overdue = memberTickets.filter(t => t.overdue).length;
    return { ...member, count: memberTickets.length, overdue };
  });

  return (
    <div className="home-card team-card">
      <div className="home-card-title">Carga del equipo</div>
      <div className="team-list">
        {load.map(m => (
          <div key={m.key} className="team-member">
            <div className="team-avatar" style={{ background: m.color }}>
              {m.initials}
            </div>
            <div className="team-member-info">
              <div className="team-member-name">
                {m.name}
                {m.overdue > 0 && <span className="team-overdue-badge">⚠ {m.overdue} atrasada{m.overdue > 1 ? 's' : ''}</span>}
              </div>
              <div className="team-member-role">{m.role}</div>
              <LoadBar value={m.count} hasOverdue={m.overdue > 0} />
            </div>
            <div className="team-member-count">{m.count}</div>
          </div>
        ))}
      </div>
    </div>
  );
}
