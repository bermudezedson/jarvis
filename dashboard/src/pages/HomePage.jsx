import { useNavigate } from 'react-router-dom';
import { useJarvis } from '../contexts/JarvisContext';
import { useSprintData } from '../hooks/useSprintData';
import { useAlerts } from '../hooks/useAlerts';
import MetricCard from '../components/MetricCard';
import SprintCard from '../components/SprintCard';
import AlertsCard from '../components/AlertsCard';
import TeamLoadCard from '../components/TeamLoadCard';
import EmailList from '../components/EmailList';
import MailModal from '../components/MailModal';
import { useState, useCallback } from 'react';

const API = 'http://localhost:3000/api';

function greeting() {
  const h = new Date().getHours();
  if (h < 12) return 'Buenos días';
  if (h < 20) return 'Buenas tardes';
  return 'Buenas noches';
}

export default function HomePage() {
  const { threadMetrics, clientThreads } = useJarvis();
  const { data: sprintData, loading: sprintLoading } = useSprintData();
  const { alerts, loading: alertsLoading } = useAlerts();
  const navigate = useNavigate();

  const [selectedThread, setSelectedThread]   = useState(null);
  const [localItems,     setLocalItems]       = useState(null);
  const [uncategorized,  setUncategorized]    = useState(null);

  const items = localItems ?? clientThreads?.items ?? [];

  const handleTransition = useCallback(async (thread_id, newEstado, note = '') => {
    setLocalItems(prev => (prev || items).map(t => {
      if (t.thread_id !== thread_id) return t;
      return { ...t, estado: newEstado, severity: ['solucionado','archivado'].includes(newEstado) ? 'none' : t.severity };
    }));
    try {
      await fetch(`${API}/mail/thread/${thread_id}/transition`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ estado: newEstado, note }) });
    } catch {}
  }, [items]);

  const handleSpam = useCallback((thread_id) => {
    setLocalItems(prev => (prev || items).filter(t => t.thread_id !== thread_id));
    setSelectedThread(null);
  }, [items]);

  // Metrics
  const urgentes   = threadMetrics?.correos_urgentes  ?? 0;
  const accion     = threadMetrics?.correos_accion    ?? 0;
  const esperando  = threadMetrics?.esperando_cliente ?? 0;
  const riesgo     = clientThreads?.clientPulse?.summary?.at_risk ?? 0;

  const sprintTotal    = sprintData?.summary?.total    ?? 0;
  const sprintProgress = sprintData?.summary?.inProgress ?? 0;
  const sprintOverdue  = sprintData?.summary?.overdue   ?? 0;

  // Top 5 urgent threads for the email mini-card
  const urgentItems = items
    .filter(t => ['requiere_mi_accion','esperando_nosotros','pendiente'].includes(t.estado) && !t.last_sender_is_me && (t.severity === 'high' || t.severity === 'critical'))
    .slice(0, 5);

  return (
    <div className="home-page">
      {/* Greeting */}
      <div className="home-greeting">
        <h1 className="home-greeting-text">{greeting()}, Alejandro</h1>
        <span className="home-greeting-date">
          {new Date().toLocaleDateString('es-CL', { weekday: 'long', day: 'numeric', month: 'long' })}
        </span>
      </div>

      {/* Top metrics row */}
      <div className="home-metrics">
        <MetricCard
          icon="✉"
          value={urgentes}
          label="Correos urgentes"
          sub={urgentes > 0 ? 'Sin respuesta +7d' : 'Todo al día'}
          variant={urgentes > 0 ? 'danger' : 'default'}
          onClick={() => navigate('/correo')}
        />
        <MetricCard
          icon="⊟"
          value={sprintTotal}
          label="Tareas en sprint"
          sub={`${sprintProgress} en progreso${sprintOverdue > 0 ? ` · ${sprintOverdue} atrasadas` : ''}`}
          variant={sprintOverdue > 0 ? 'warning' : 'default'}
          onClick={() => navigate('/sprint')}
        />
        <MetricCard
          icon="✓"
          value={accion}
          label="Requieren acción"
          sub={esperando > 0 ? `${esperando} esperando cliente` : 'Sin pendientes urgentes'}
          variant={accion > 0 ? 'warning' : 'default'}
          onClick={() => navigate('/correo')}
        />
        <MetricCard
          icon="◈"
          value={riesgo || '—'}
          label="Clientes en riesgo"
          sub={riesgo > 0 ? 'health score < 50' : 'Sin alertas de clientes'}
          variant={riesgo > 0 ? 'danger' : 'default'}
          onClick={() => navigate('/clientes')}
        />
      </div>

      {/* Main 2×2 grid */}
      <div className="home-grid">
        {/* Sprint card */}
        <SprintCard data={sprintData} loading={sprintLoading} />

        {/* Urgent emails mini-list */}
        <div className="home-card emails-card">
          <div className="home-card-header">
            <div className="home-card-title">Correos urgentes</div>
            <button className="home-card-link" onClick={() => navigate('/correo')}>Ver todos →</button>
          </div>
          {urgentItems.length === 0 ? (
            <div className="home-card-empty" style={{ color: '#4ade80' }}>✓ Sin urgentes</div>
          ) : (
            <div className="home-urgent-list">
              {urgentItems.map(t => {
                const days = t.days_since_last ?? 0;
                const dot  = t.severity === 'high' || t.severity === 'critical' ? 'dot-red' : 'dot-orange';
                return (
                  <div key={t.thread_id} className="home-urgent-item" onClick={() => setSelectedThread(t)} role="button" tabIndex={0}>
                    <span className={`email-dot ${dot}`} />
                    <div className="home-urgent-info">
                      <span className="home-urgent-client">{t.client?.name || t.client_name || '?'}</span>
                      <span className="home-urgent-subject">{(t.subject || '').substring(0, 55)}</span>
                    </div>
                    <span className={`email-age ${days > 7 ? 'age-crit' : days > 2 ? 'age-warn' : 'age-ok'}`}>{days}d</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {/* Team load */}
        <TeamLoadCard sprintData={sprintData} />

        {/* Alerts */}
        <AlertsCard alerts={alerts} loading={alertsLoading} />
      </div>

      {/* Mail modal */}
      {selectedThread && (
        <MailModal
          thread={selectedThread}
          onClose={() => setSelectedThread(null)}
          onTransition={handleTransition}
          onSpam={handleSpam}
          isInformativo={selectedThread.estado === 'informativo'}
        />
      )}
    </div>
  );
}
