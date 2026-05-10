import { useState, useEffect } from 'react';

const API = 'http://localhost:3000/api';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function RulesPanel({ onClose }) {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(true);
  const [toggling, setToggling] = useState({});

  useEffect(() => {
    fetch(`${API}/mail/learned-rules`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }, []);

  async function toggleRule(id, currentActive) {
    setToggling(prev => ({ ...prev, [id]: true }));
    try {
      await fetch(`${API}/mail/learned-rules/${id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ active: !currentActive }),
      });
      setData(prev => ({
        ...prev,
        rules: prev.rules.map(r => r.id === id ? { ...r, active: !currentActive ? 1 : 0 } : r),
      }));
    } catch { /* silent */ }
    finally { setToggling(prev => ({ ...prev, [id]: false })); }
  }

  return (
    <div className="rules-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rules-panel">
        {/* Header */}
        <div className="rules-header">
          <div className="rules-title-group">
            <span className="rules-title">Reglas de Jarvis</span>
            {data?.stats && (
              <span className="rules-stats">
                {data.stats.total_rules} reglas · {data.stats.total_matches} aplicaciones · {data.stats.total_feedback} feedbacks
              </span>
            )}
          </div>
          <button className="rules-close" onClick={onClose}>×</button>
        </div>

        {loading && <div className="rules-loading">Cargando...</div>}

        {!loading && data && (
          <div className="rules-body">

            {/* ── Sección 1: Reglas aprendidas ── */}
            <div className="rules-section">
              <div className="rules-section-title">Reglas aprendidas del feedback</div>
              {data.rules.length === 0 ? (
                <div className="rules-empty">Aún no hay reglas. Usa "✎ Corregir" en cualquier correo para enseñarle a Jarvis.</div>
              ) : (
                <div className="rules-list">
                  {data.rules.map(rule => (
                    <div key={rule.id} className={`rules-item ${rule.active ? '' : 'rules-item-inactive'}`}>
                      <button
                        className={`rules-toggle ${rule.active ? 'on' : 'off'}`}
                        onClick={() => toggleRule(rule.id, !!rule.active)}
                        disabled={!!toggling[rule.id]}
                        title={rule.active ? 'Desactivar regla' : 'Activar regla'}
                      >
                        {toggling[rule.id] ? '…' : rule.active ? '●' : '○'}
                      </button>
                      <div className="rules-item-body">
                        <span className="rules-pattern">"{rule.pattern_value}"</span>
                        <span className="rules-arrow"> → </span>
                        <span className="rules-target">{rule.correct_estado || rule.correct_category}</span>
                        <span className="rules-matches">{rule.match_count || 0}×</span>
                      </div>
                      <div className="rules-item-meta">
                        {rule.pattern_type} · creada {formatDate(rule.created_at)}
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* ── Sección 2: Patrones de no acción (rules.yml) ── */}
            <div className="rules-section">
              <div className="rules-section-title">Patrones automáticos (config)</div>
              <div className="rules-patterns-grid">
                {(data.no_action_patterns || []).map((p, i) => (
                  <span key={i} className="rules-pattern-chip">"{p}"</span>
                ))}
              </div>
            </div>

            {/* ── Sección 3: Reglas automáticas de estado ── */}
            <div className="rules-section">
              <div className="rules-section-title">Reglas automáticas de estado</div>
              <div className="rules-auto-list">
                <div className="rules-auto-item">
                  <span className="rules-auto-icon">🗃</span>
                  Informativos se auto-archivan tras <strong>{data.auto_rules.informativo_auto_archive_days} días</strong> sin actividad
                </div>
                <div className="rules-auto-item">
                  <span className="rules-auto-icon">⏫</span>
                  Facturas sin respuesta pasan a <strong>Pendientes</strong> tras <strong>{data.auto_rules.invoice_days_without_response_to_pending} días</strong>
                </div>
                <div className="rules-auto-item">
                  <span className="rules-auto-icon">⚡</span>
                  Esperando cliente escala a urgente tras <strong>{data.auto_rules.waiting_escalation_days} días</strong>
                </div>
              </div>
            </div>

            {/* ── Sección 4: Historial de feedback ── */}
            <div className="rules-section">
              <div className="rules-section-title">Historial de correcciones</div>
              {data.feedback_history.length === 0 ? (
                <div className="rules-empty">Sin correcciones aún.</div>
              ) : (
                <div className="rules-feedback-list">
                  {data.feedback_history.slice(0, 15).map(f => (
                    <div key={f.id} className="rules-feedback-item">
                      <span className="rules-fb-date">{formatDate(f.created_at)}</span>
                      <span className="rules-fb-arrow">
                        <span className="rules-fb-from">{f.original_estado || '?'}</span>
                        {' → '}
                        <span className="rules-fb-to">{f.correct_estado || '?'}</span>
                      </span>
                      {f.ceo_explanation && (
                        <span className="rules-fb-note" title={f.ceo_explanation}>
                          "{f.ceo_explanation.substring(0, 60)}{f.ceo_explanation.length > 60 ? '…' : ''}"
                        </span>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

          </div>
        )}
      </div>
    </div>
  );
}
