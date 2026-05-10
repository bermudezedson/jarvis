import { useState } from 'react';

const API = 'http://localhost:3000/api';

const FEEDBACK_OPTIONS = [
  {
    value: 'informativo',
    label: 'Informativo — no requiere acción',
    description: 'Facturas enviadas, notificaciones de sistema, confirmaciones de pago',
  },
  {
    value: 'esperando_cliente',
    label: 'Esperando cliente — ya respondimos',
    description: 'Nosotros o el equipo ya respondió, esperar al cliente',
  },
  {
    value: 'requiere_accion',
    label: 'Requiere mi acción — sí necesito actuar',
    description: 'La clasificación original es correcta, el CEO debe responder',
  },
  {
    value: 'solucionado',
    label: 'Solucionado — ya está resuelto',
    description: 'Se resolvió fuera del correo (teléfono, presencial, WhatsApp)',
  },
  {
    value: 'archivado',
    label: 'Archivar — no relevante',
    description: 'No aplica, spam del cliente, o ya pasó mucho tiempo',
  },
];

export default function FeedbackModal({ thread, onClose, onFeedbackSent }) {
  // phase: 'input' | 'confirm' | 'done'
  const [phase,       setPhase]       = useState('input');
  const [category,    setCategory]    = useState('informativo');
  const [explanation, setExplanation] = useState('');
  const [loading,     setLoading]     = useState(false);
  const [error,       setError]       = useState(null);

  // Propose response data
  const [proposed,    setProposed]    = useState(null);  // { proposed_rule, would_affect, would_affect_count }

  // Done response data
  const [doneData,    setDoneData]    = useState(null);

  // Phase 1 → propose (fix current thread, return proposal)
  async function handlePropose() {
    if (!explanation.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/mail/thread/${thread.thread_id}/feedback`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ correct_category: category, correct_estado: category, explanation }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al enviar feedback');

      // Thread already fixed. Check if there's a rule to confirm.
      if (data.needs_confirmation && data.proposed_rule) {
        setProposed(data);
        setPhase('confirm');
      } else {
        // No rule extracted — we're done
        setDoneData({ reclassified_count: 0 });
        setPhase('done');
        if (onFeedbackSent) onFeedbackSent(data);
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  // Phase 2 → confirm (save rule, optionally apply retroactively)
  async function handleConfirm(applyToAll) {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API}/mail/feedback/confirm`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          feedback_id:      proposed.feedback_id,
          proposed_rule:    proposed.proposed_rule,
          apply_to_existing: applyToAll,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || 'Error al confirmar');
      setDoneData(data);
      setPhase('done');
      if (onFeedbackSent) onFeedbackSent(data);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  const currentLabel = FEEDBACK_OPTIONS.find(o => o.value === thread.estado)?.label || thread.estado;
  const SHOW_AFFECTS = 5;

  return (
    <div className="fb-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="fb-modal">
        {/* Header */}
        <div className="fb-header">
          <span className="fb-title">Enseñar a Jarvis</span>
          <button className="fb-close" onClick={onClose}>×</button>
        </div>

        {/* Thread info */}
        <div className="fb-thread-info">
          <div className="fb-thread-subject">"{thread.subject}"</div>
          <div className="fb-thread-meta">
            Jarvis clasificó como: <span className="fb-original">{currentLabel}</span>
          </div>
        </div>

        {/* ── Phase: input ── */}
        {phase === 'input' && (
          <>
            <div className="fb-section-label">¿Cómo debería clasificarse?</div>
            <div className="fb-options">
              {FEEDBACK_OPTIONS.map(opt => (
                <label key={opt.value} className={`fb-option ${category === opt.value ? 'selected' : ''}`}>
                  <input
                    type="radio"
                    name="feedback_category"
                    value={opt.value}
                    checked={category === opt.value}
                    onChange={() => setCategory(opt.value)}
                  />
                  <div className="fb-option-text">
                    <span className="fb-option-label">{opt.label}</span>
                    <span className="fb-option-desc">{opt.description}</span>
                  </div>
                </label>
              ))}
            </div>

            <div className="fb-section-label">Explícale a Jarvis por qué:</div>
            <textarea
              className="fb-explanation"
              placeholder="Ej: Es una factura que nosotros enviamos al cliente. No requiere acción."
              value={explanation}
              onChange={e => setExplanation(e.target.value)}
              rows={3}
            />

            {error && <div className="fb-error">{error}</div>}

            <div className="fb-footer">
              <button className="fb-btn fb-btn-cancel" onClick={onClose}>Cancelar</button>
              <button
                className="fb-btn fb-btn-primary"
                onClick={handlePropose}
                disabled={loading || !explanation.trim()}
              >
                {loading ? 'Analizando...' : 'Enseñar a Jarvis'}
              </button>
            </div>
          </>
        )}

        {/* ── Phase: confirm ── */}
        {phase === 'confirm' && proposed && (
          <>
            <div className="fb-confirm-box">
              <div className="fb-confirm-title">Jarvis aprendió esta regla:</div>
              <div className="fb-confirm-rule">
                <strong>"{proposed.proposed_rule.pattern_value}"</strong>
                <span className="fb-arrow"> → </span>
                <span className="fb-confirm-estado">{category}</span>
              </div>
              {proposed.proposed_rule.explanation_for_ceo && (
                <div className="fb-confirm-explanation">{proposed.proposed_rule.explanation_for_ceo}</div>
              )}
            </div>

            {proposed.would_affect_count > 0 && (
              <div className="fb-affects">
                <div className="fb-affects-title">
                  Correos similares que se reclasificarían ({proposed.would_affect_count}):
                </div>
                <ul className="fb-affects-list">
                  {proposed.would_affect.slice(0, SHOW_AFFECTS).map(t => (
                    <li key={t.thread_id} className="fb-affects-item">
                      <span className="fb-affects-subject">{t.subject}</span>
                      <span className="fb-affects-client">{t.client?.name || t.client_name || ''}</span>
                    </li>
                  ))}
                  {proposed.would_affect_count > SHOW_AFFECTS && (
                    <li className="fb-affects-more">
                      + {proposed.would_affect_count - SHOW_AFFECTS} más...
                    </li>
                  )}
                </ul>
              </div>
            )}

            {error && <div className="fb-error">{error}</div>}

            <div className="fb-footer fb-footer-confirm">
              <button className="fb-btn fb-btn-cancel" onClick={onClose} disabled={loading}>
                Cancelar
              </button>
              <button
                className="fb-btn fb-btn-secondary"
                onClick={() => handleConfirm(false)}
                disabled={loading}
              >
                {loading ? '...' : 'Solo guardar regla'}
              </button>
              {proposed.would_affect_count > 0 && (
                <button
                  className="fb-btn fb-btn-primary"
                  onClick={() => handleConfirm(true)}
                  disabled={loading}
                >
                  {loading ? 'Aplicando...' : `Aplicar a todos (${proposed.would_affect_count}) ✓`}
                </button>
              )}
            </div>
          </>
        )}

        {/* ── Phase: done ── */}
        {phase === 'done' && doneData && (
          <div className="fb-result">
            <div className="fb-result-row">
              <span className="fb-check">✓</span>
              Este correo fue reclasificado como <strong>{category}</strong>.
            </div>
            {proposed?.proposed_rule && (
              <div className="fb-result-row">
                <span className="fb-check">✓</span>
                Regla guardada: <strong>"{proposed.proposed_rule.pattern_value}"</strong>
              </div>
            )}
            {doneData.reclassified_count > 0 && (
              <div className="fb-result-row">
                <span className="fb-check">✓</span>
                <strong>{doneData.reclassified_count}</strong> correo(s) similar(es) reclasificado(s) automáticamente.
              </div>
            )}
            <button className="fb-btn fb-btn-primary" onClick={onClose} style={{ marginTop: '14px' }}>
              Cerrar
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
