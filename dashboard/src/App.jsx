import { useState } from 'react';
import { useJarvisData } from './hooks/useJarvisData';
import StatusBar from './components/StatusBar';
import ExecutiveInbox from './components/ExecutiveInbox';
import RiskRadar from './components/RiskRadar';
import BriefingPanel from './components/BriefingPanel';
import RefreshIndicator from './components/RefreshIndicator';
import CommitmentTracker from './components/CommitmentTracker';
import ClientPulse from './components/ClientPulse';
import MailClassifier from './components/MailClassifier';

// ─── Iron Man face SVG ────────────────────────────────────────────────────────
function IronManLogo() {
  return (
    <svg width="28" height="28" viewBox="0 0 28 28" fill="none" xmlns="http://www.w3.org/2000/svg">
      {/* Helmet body */}
      <path d="M14 2L5 7.5v8.5c0 5 3.8 8.5 9 10 5.2-1.5 9-5 9-10V7.5L14 2z"
            fill="#8B0000" stroke="#5a0000" strokeWidth=".6"/>
      {/* Forehead panel */}
      <path d="M14 2L5 7.5h18L14 2z" fill="#a30000"/>
      {/* Cheek panels */}
      <path d="M5 7.5v8.5c0 2.5 1 4.7 2.8 6.4L5 7.5z" fill="#7a0000"/>
      <path d="M23 7.5v8.5c0 2.5-1 4.7-2.8 6.4L23 7.5z" fill="#7a0000"/>
      {/* Left eye */}
      <path d="M7.5 12.5l4.2 1.8" stroke="#D4900C" strokeWidth="2.2" strokeLinecap="round"/>
      {/* Right eye */}
      <path d="M20.5 12.5l-4.2 1.8" stroke="#D4900C" strokeWidth="2.2" strokeLinecap="round"/>
      {/* Eye glow */}
      <path d="M7.5 12.5l4.2 1.8" stroke="#FFD54F" strokeWidth=".8" strokeLinecap="round" opacity=".8"/>
      <path d="M20.5 12.5l-4.2 1.8" stroke="#FFD54F" strokeWidth=".8" strokeLinecap="round" opacity=".8"/>
      {/* Jaw / mouth piece */}
      <path d="M9 19h10" stroke="#7a0000" strokeWidth="1" strokeLinecap="round"/>
      <path d="M10.5 21.5h7" stroke="#5a0000" strokeWidth=".8" strokeLinecap="round"/>
      {/* Center chest RT glow (tiny) */}
      <circle cx="14" cy="17.5" r="1.2" fill="#D4900C" opacity=".5"/>
    </svg>
  );
}

const TABS = [
  { id: 'briefing',      label: 'Briefing',      icon: '◈' },
  { id: 'correo',        label: 'Correo',         icon: '✉' },
  { id: 'compromisos',   label: 'Compromisos',    icon: '◎' },
  { id: 'clientes',      label: 'Clientes',       icon: '◈' },
];

export default function App() {
  const { data, loading, error, lastRefresh, viewMode, setViewMode, refresh } = useJarvisData();
  const [activeTab, setActiveTab] = useState('briefing');

  return (
    <div className="cockpit">
      <header className="cockpit-header">
        <div className="cockpit-logo">
          <span className="logo-icon"><IronManLogo /></span>
          <div>
            <div className="logo-name">JARVIS</div>
            <div className="logo-sub">CEO Cockpit</div>
          </div>
        </div>

        <nav className="cockpit-nav">
          {TABS.map(tab => (
            <button
              key={tab.id}
              className={`nav-tab ${activeTab === tab.id ? 'active' : ''}`}
              onClick={() => setActiveTab(tab.id)}
            >
              {tab.label}
            </button>
          ))}
        </nav>

        <div className="cockpit-controls">
          {activeTab === 'briefing' && (
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
          )}
          <RefreshIndicator lastRefresh={lastRefresh} onRefresh={refresh} loading={loading} />
        </div>
      </header>

      {error && <div className="error-banner">Error al cargar datos: {error}</div>}

      {/* ── Tab: Briefing ── */}
      {activeTab === 'briefing' && (
        <>
          {loading && !data && (
            <div className="loading-screen">
              <div className="spinner" />
              <span>Cargando briefing...</span>
            </div>
          )}
          {data && (
            <main className="cockpit-main">
              <section className="zone zone-top">
                <StatusBar metrics={data.metrics} />
                <BriefingPanel data={data} />
              </section>
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
            </main>
          )}
        </>
      )}

      {/* ── Tab: Correo ── */}
      {activeTab === 'correo' && (
        <main className="cockpit-main">
          <section className="zone zone-mail-full">
            <h2 className="zone-title">Clasificación de Correo</h2>
            <MailClassifier />
          </section>
        </main>
      )}

      {/* ── Tab: Compromisos ── */}
      {activeTab === 'compromisos' && (
        <main className="cockpit-main">
          <section className="zone zone-full">
            <h2 className="zone-title">Compromisos Abiertos</h2>
            <CommitmentTracker />
          </section>
        </main>
      )}

      {/* ── Tab: Clientes ── */}
      {activeTab === 'clientes' && (
        <main className="cockpit-main">
          <section className="zone zone-full">
            <h2 className="zone-title">Client Health Score</h2>
            <ClientPulse />
          </section>
        </main>
      )}
    </div>
  );
}
