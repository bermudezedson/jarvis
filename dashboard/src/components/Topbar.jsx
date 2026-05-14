import { useState } from 'react';
import { useLocation } from 'react-router-dom';
import { useNotifications, pushNotification } from '../hooks/useNotifications';
import GlobalSearch from './GlobalSearch';

const API = 'http://localhost:3000/api';
const JIRA_URL = 'https://alejandro-bermudez.atlassian.net';
const CONFLUENCE_URL = 'https://alejandro-bermudez.atlassian.net/wiki';

const SECTION_LABELS = {
  '/':         'Inicio',
  '/correo':   'Correo',
  '/tareas':   'Tareas',
  '/sprint':   'Sprint',
  '/clientes': 'Clientes',
  '/reglas':   'Reglas',
  '/config':   'Configuración',
};

export default function Topbar({ lastRefresh, onRefreshed, onOpenThread }) {
  const location = useLocation();
  const [scanning, setScanning] = useState(false);
  const [showNotifs, setShowNotifs] = useState(false);
  const { notifs, dismiss, clear } = useNotifications();

  const section = SECTION_LABELS[location.pathname] || '';

  // Sync status
  const minsAgo = lastRefresh
    ? Math.round((Date.now() - new Date(lastRefresh).getTime()) / 60000)
    : null;
  const isStale = minsAgo !== null && minsAgo > 30;
  const syncLabel = minsAgo === null
    ? 'Sin sincronizar'
    : minsAgo === 0
      ? 'Ahora mismo'
      : `hace ${minsAgo} min`;

  const [syncing, setSyncing] = useState(false);

  async function handleGmailSync() {
    setSyncing(true);
    try {
      const res  = await fetch(`${API}/mail/sync-gmail-labels`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
      const data = await res.json();
      pushNotification(`Labels Gmail sincronizados: ${data.synced} hilos actualizados${data.failed > 0 ? `, ${data.failed} fallidos` : ''}`, 'success');
    } catch (e) {
      pushNotification('Error al sincronizar labels: ' + e.message, 'error');
    }
    setSyncing(false);
  }

  async function handleScan() {
    setScanning(true);
    try {
      const res  = await fetch(`${API}/mail/universal-scan`, { method: 'POST' });
      const data = await res.json();
      const msg  = data.stats
        ? `Scan completo: ${data.stats.threads_new || 0} nuevos, ${data.stats.threads_found || 0} revisados`
        : 'Scan completado';
      pushNotification(msg, 'success');
      if (onRefreshed) onRefreshed();
    } catch (e) {
      pushNotification('Error al escanear: ' + e.message, 'error');
    }
    setScanning(false);
  }

  return (
    <header className="topbar">
      <div className="topbar-left">
        <span className="topbar-breadcrumb">
          {section && <span className="topbar-section">/ {section}</span>}
        </span>
      </div>

      <div className="topbar-center">
        <GlobalSearch onOpenThread={onOpenThread} />
      </div>

      <div className="topbar-right">
        {/* Sync status */}
        <span className={`topbar-sync ${isStale ? 'topbar-sync--stale' : ''}`}>
          <span className={`topbar-sync-dot ${isStale ? 'stale' : 'ok'}`} />
          {isStale ? 'Desactualizado' : `Sincronizado ${syncLabel}`}
        </span>

        {/* Gmail labels sync */}
        <button
          className={`topbar-btn ${syncing ? 'topbar-btn--loading' : ''}`}
          onClick={handleGmailSync}
          disabled={syncing}
          title="Sincronizar labels de Jarvis en Gmail para todos los correos"
          style={{ fontSize: '11px' }}
        >
          {syncing ? '⟳ Sincronizando...' : '✉ Sync Gmail'}
        </button>

        {/* Refresh button */}
        <button
          className={`topbar-btn ${scanning ? 'topbar-btn--loading' : ''}`}
          onClick={handleScan}
          disabled={scanning}
          title="Escanear correos ahora"
        >
          {scanning ? '⟳ Actualizando...' : '↻ Actualizar'}
        </button>

        {/* External links */}
        <a href={JIRA_URL}       target="_blank" rel="noreferrer" className="topbar-link">Jira ↗</a>
        <a href={CONFLUENCE_URL} target="_blank" rel="noreferrer" className="topbar-link">Confluence ↗</a>

        {/* Notifications */}
        <div className="topbar-notif-wrapper">
          <button
            className="topbar-notif-btn"
            onClick={() => setShowNotifs(v => !v)}
            title="Notificaciones"
          >
            🔔
            {notifs.length > 0 && <span className="topbar-notif-count">{notifs.length}</span>}
          </button>

          {showNotifs && (
            <>
              <div className="topbar-notif-backdrop" onClick={() => setShowNotifs(false)} />
              <div className="topbar-notif-panel">
                <div className="topbar-notif-header">
                  <span>Notificaciones</span>
                  {notifs.length > 0 && (
                    <button className="topbar-notif-clear" onClick={clear}>Limpiar</button>
                  )}
                </div>
                {notifs.length === 0 ? (
                  <div className="topbar-notif-empty">Sin notificaciones</div>
                ) : (
                  notifs.map(n => (
                    <div key={n.id} className={`topbar-notif-item topbar-notif-item--${n.type}`}>
                      <div className="topbar-notif-msg">{n.msg}</div>
                      <div className="topbar-notif-time">
                        {new Date(n.at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                        <button className="topbar-notif-dismiss" onClick={() => dismiss(n.id)}>✕</button>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </>
          )}
        </div>

        {/* Avatar */}
        <div className="topbar-avatar" title="Alejandro Bermúdez">AB</div>
      </div>
    </header>
  );
}
