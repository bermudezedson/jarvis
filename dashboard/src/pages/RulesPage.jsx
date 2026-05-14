import { useState } from 'react';
import RulesPanel from '../components/RulesPanel';

export default function RulesPage() {
  const [showPanel, setShowPanel] = useState(false);

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">Reglas</h2>
        <span className="page-subtitle">Reglas aprendidas, filtros y configuración de clasificación</span>
      </div>

      <div style={{ marginTop: '16px' }}>
        <button
          className="ctl-btn ctl-btn-rules"
          style={{ padding: '8px 18px', fontSize: '13px' }}
          onClick={() => setShowPanel(true)}
        >
          ⚙ Abrir panel de reglas
        </button>
        <p style={{ marginTop: '12px', color: 'var(--muted)', fontSize: '12px' }}>
          También puedes acceder desde cualquier correo usando el botón "✎ Corregir".
        </p>
      </div>

      {showPanel && <RulesPanel onClose={() => setShowPanel(false)} />}
    </div>
  );
}
