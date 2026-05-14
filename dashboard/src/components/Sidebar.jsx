import { NavLink, useLocation } from 'react-router-dom';

const NAV_ITEMS = [
  { to: '/',         icon: '⊞', label: 'Inicio',      badge: null },
  { to: '/correo',   icon: '✉', label: 'Correo',      badge: 'urgentes' },
  { to: '/tareas',   icon: '⊟', label: 'Tareas',      badge: 'tareas' },
  { to: '/sprint',   icon: '◎', label: 'Sprint',      badge: null },
  { to: '/clientes', icon: '◈', label: 'Clientes',    badge: null },
];

const SYS_ITEMS = [
  { to: '/reglas',   icon: '⚙', label: 'Reglas',   badge: null },
  { to: '/config',   icon: '⊡', label: 'Config',   badge: null },
];

export default function Sidebar({ metrics }) {
  const location = useLocation();

  const getBadge = key => {
    if (!metrics) return null;
    if (key === 'urgentes') return metrics.correos_urgentes > 0 ? metrics.correos_urgentes : null;
    if (key === 'tareas')   return null;
    return null;
  };

  function Item({ to, icon, label, badge: badgeKey }) {
    const count = getBadge(badgeKey);
    const isActive = to === '/'
      ? location.pathname === '/'
      : location.pathname.startsWith(to);

    return (
      <NavLink
        to={to}
        className={`sidebar-item ${isActive ? 'sidebar-item--active' : ''}`}
        end={to === '/'}
      >
        <span className="sidebar-icon">{icon}</span>
        <span className="sidebar-label">{label}</span>
        {count ? <span className="sidebar-badge">{count}</span> : null}
      </NavLink>
    );
  }

  return (
    <aside className="sidebar">
      <div className="sidebar-logo">
        <span className="sidebar-logo-mark">J</span>
        <div>
          <div className="sidebar-logo-title">Jarvis</div>
          <div className="sidebar-logo-sub">CEO Cockpit</div>
        </div>
      </div>

      <nav className="sidebar-nav">
        <div className="sidebar-section-label">Principal</div>
        {NAV_ITEMS.map(item => (
          <Item key={item.to} {...item} />
        ))}

        <div className="sidebar-section-label" style={{ marginTop: '16px' }}>Sistema</div>
        {SYS_ITEMS.map(item => (
          <Item key={item.to} {...item} />
        ))}
      </nav>

      <div className="sidebar-footer">
        <div className="sidebar-avatar" title="Alejandro Bermúdez">AB</div>
        <div className="sidebar-user">
          <div className="sidebar-user-name">Alejandro</div>
          <div className="sidebar-user-role">CEO · WebySEO / CR</div>
        </div>
      </div>
    </aside>
  );
}
