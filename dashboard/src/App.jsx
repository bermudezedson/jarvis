import { useJarvisData } from './hooks/useJarvisData';
import StatusBar from './components/StatusBar';
import ExecutiveInbox from './components/ExecutiveInbox';
import RiskRadar from './components/RiskRadar';
import BriefingPanel from './components/BriefingPanel';
import RefreshIndicator from './components/RefreshIndicator';
import CommitmentTracker from './components/CommitmentTracker';
import ClientPulse from './components/ClientPulse';

export default function App() {
  const { data, loading, error, lastRefresh, viewMode, setViewMode, refresh } = useJarvisData();

  return (
    <div className="cockpit">
      <header className="cockpit-header">
        <div className="cockpit-logo">
          <span className="logo-icon">⚡</span>
          <span className="logo-name">Jarvis</span>
          <span className="logo-sub">CEO Cockpit</span>
        </div>

        <div className="cockpit-controls">
          <div className="view-toggle">
            {[
              { mode: 'morning', label: 'AM' },
              { mode: 'current', label: 'AHORA' },
              { mode: 'evening', label: 'PM' },
            ].map(({ mode, label }) => (
              <button
                key={mode}
                className={`toggle-btn ${viewMode === mode ? 'active' : ''}`}
                onClick={() => setViewMode(mode)}
              >
                {label}
              </button>
            ))}
          </div>
          <RefreshIndicator lastRefresh={lastRefresh} onRefresh={refresh} loading={loading} />
        </div>
      </header>

      {error && <div className="error-banner">Error al cargar datos: {error}</div>}

      {loading && !data && (
        <div className="loading-screen">
          <div className="spinner" />
          <span>Cargando briefing...</span>
        </div>
      )}

      {data && (
        <main className="cockpit-main">
          {/* Zona 1 — Métricas del día */}
          <section className="zone zone-top">
            <StatusBar metrics={data.metrics} />
            <BriefingPanel data={data} />
          </section>

          {/* Zonas 2 y 3 — Bandeja + Radar */}
          <div className="zone-row">
            <section className="zone zone-inbox">
              <h2 className="zone-title">Bandeja Ejecutiva</h2>
              <ExecutiveInbox items={data.executive_inbox || []} />
            </section>

            <section className="zone zone-radar">
              <h2 className="zone-title">Radar de Riesgos</h2>
              <RiskRadar alerts={data.risk_radar || []} />
            </section>
          </div>

          {/* Zonas Fase 2 — Compromisos + Client Pulse */}
          <div className="zone-row zone-row-phase2">
            <section className="zone zone-commitments">
              <h2 className="zone-title">Compromisos Abiertos</h2>
              <CommitmentTracker />
            </section>

            <section className="zone zone-pulse">
              <h2 className="zone-title">Client Health Score</h2>
              <ClientPulse />
            </section>
          </div>
        </main>
      )}
    </div>
  );
}
