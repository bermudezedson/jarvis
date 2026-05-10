import { useState } from 'react';
import { useMailInbox } from '../hooks/useMailInbox';

// ─── Category metadata ────────────────────────────────────────────────────────

const CAT_LABEL = {
  solicitud_cliente: 'Cliente',
  seguimiento:       'Seguimiento',
  factura:           'Factura',
  cuenta_por_pagar:  'Cuenta x Pagar',
  estafa:            'Estafa / Phishing',
  envio:             'Envío',
  suscripcion:       'Suscripción',
  spam:              'Spam',
  notificacion:      'Notificación',
  interno:           'Interno',
  otro:              'Sin clasificar',
};

const CAT_COLOR = {
  solicitud_cliente: 'var(--blue)',
  seguimiento:       'var(--purple)',
  factura:           'var(--iron-gold)',
  cuenta_por_pagar:  'var(--iron-red)',
  estafa:            'var(--iron-red)',
  envio:             'var(--green)',
  suscripcion:       'var(--muted)',
  spam:              'var(--iron-red)',
  notificacion:      'var(--muted)',
  interno:           'var(--muted)',
  otro:              'var(--iron-gold)',
};

const SEV_COLOR = {
  high:   'var(--iron-red)',
  medium: 'var(--iron-gold)',
  low:    'var(--muted)',
};

// ─── Contextual actions per category ─────────────────────────────────────────
// approve_label / reject_label: texto de los botones
// tip: explicación breve de qué hace cada acción

const CAT_ACTIONS = {
  solicitud_cliente: {
    approve_label: '→ Crear Jira',
    reject_label:  'Archivar',
    tip: 'Crear Jira: abre una tarea en Jira con el hilo adjunto. Archivar: lo marca como revisado sin crear tarea.',
  },
  seguimiento: {
    approve_label: '✓ Pendiente',
    reject_label:  'Archivar',
    tip: 'Pendiente: queda en tu lista de correos a responder. Archivar: ya fue atendido.',
  },
  factura: {
    approve_label: '✓ Registrada',
    reject_label:  'Archivar',
    tip: 'Registrada: la factura se anota como recibida. Archivar: ya procesada.',
  },
  cuenta_por_pagar: {
    approve_label: '💳 Gestionar',
    reject_label:  'Ignorar',
    tip: 'Gestionar: queda en lista de pagos pendientes. Ignorar: si el cargo ya fue resuelto.',
  },
  estafa: {
    approve_label: '🚨 Confirmar estafa',
    reject_label:  'No es estafa',
    tip: 'Confirmar estafa: mueve a spam y bloquea el dominio. No es estafa: si Jarvis se equivocó.',
  },
  envio: {
    approve_label: '📦 Seguir envío',
    reject_label:  'Archivar',
    tip: 'Seguir envío: queda en lista de envíos activos. Archivar: si ya fue recibido.',
  },
  suscripcion: {
    approve_label: '✓ Mantener',
    reject_label:  '✕ Cancelar',
    tip: 'Mantener: estás conforme con esta suscripción. Cancelar: la agrega a lista de bajas pendientes.',
  },
  spam: {
    approve_label: '🚫 Es spam',
    reject_label:  'No es spam',
    tip: 'Es spam: confirma la clasificación para limpiar tu bandeja. No es spam: si Jarvis se equivocó.',
  },
  notificacion: {
    approve_label: '✓ Visto',
    reject_label:  'Ignorar',
    tip: 'Visto: confirmas que lo leíste. No genera ninguna acción adicional.',
  },
  interno: {
    approve_label: '✓ Visto',
    reject_label:  'Ignorar',
    tip: 'Correo interno — marcar como visto o ignorar si no requiere atención.',
  },
  otro: {
    approve_label: '🔍 Revisar',
    reject_label:  'Ignorar',
    tip: 'Revisar: lo marcas para atención manual. Ignorar: no requiere acción.',
  },
};

const DEFAULT_ACTIONS = {
  approve_label: '✓ Aprobar',
  reject_label:  '✕ Ignorar',
  tip: '',
};

// All categories available for reclassification
const ALL_CATS = Object.entries(CAT_LABEL);

// ─── Category summary bar ─────────────────────────────────────────────────────

function CategoryBar({ counts, onFilter, activeFilter, onApproveAll }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="mc-catbar">
      <button
        className={`mc-cat-btn ${!activeFilter ? 'active' : ''}`}
        onClick={() => onFilter(null)}
      >
        Todos <span className="mc-cat-count">{total}</span>
      </button>
      {Object.entries(counts)
        .sort((a, b) => b[1] - a[1])
        .map(([cat, n]) => (
          <button
            key={cat}
            className={`mc-cat-btn ${activeFilter === cat ? 'active' : ''}`}
            onClick={() => onFilter(cat)}
            style={{ '--cat-color': CAT_COLOR[cat] }}
          >
            <span className="mc-cat-dot" />
            {CAT_LABEL[cat]} <span className="mc-cat-count">{n}</span>
          </button>
        ))}
      {activeFilter && (
        <button className="mc-approve-all-btn" onClick={() => onApproveAll(activeFilter, 'approve')}>
          ✓ Aprobar todos
        </button>
      )}
    </div>
  );
}

// ─── Category action legend ───────────────────────────────────────────────────

function ActionLegend({ category }) {
  const actions = CAT_ACTIONS[category] || DEFAULT_ACTIONS;
  if (!actions.tip) return null;
  return (
    <div className="mc-action-legend">
      <span className="mc-legend-icon">ℹ</span>
      <span>{actions.tip}</span>
    </div>
  );
}

// ─── Individual email item ────────────────────────────────────────────────────

function MailItem({ item, onApprove, onReject, onReclassify, onReportPhishing }) {
  const [expanded, setExpanded]           = useState(false);
  const [reclassifying, setReclassifying] = useState(false);
  const [reporting, setReporting]         = useState(false);
  const [reportResult, setReportResult]   = useState(null);
  const approved = item.aprobado === true;
  const rejected = item.aprobado === false;
  const decided  = item.aprobado !== null;
  const actions  = CAT_ACTIONS[item.category] || DEFAULT_ACTIONS;
  const isEstafa = item.category === 'estafa';

  async function handleReportPhishing() {
    setReporting(true);
    try {
      const result = await onReportPhishing(item.thread_id);
      setReportResult(result?.message || 'Denunciado');
    } catch {
      setReportResult('Error al denunciar');
    } finally {
      setReporting(false);
    }
  }

  return (
    <div className={`mc-item ${decided ? (approved ? 'mc-approved' : 'mc-rejected') : ''}`}>
      <div className="mc-item-header" onClick={() => setExpanded(e => !e)}>
        <div className="mc-item-meta">
          <span className="mc-sev-dot" style={{ background: SEV_COLOR[item.severity] }} />
          <span className="mc-cat-badge" style={{ color: CAT_COLOR[item.category] }}>
            {CAT_LABEL[item.category] || item.category}
          </span>
          {item.client && (
            <span className="mc-client-badge">{item.client.name}</span>
          )}
          {item.jira_suggested && (
            <span className="mc-jira-badge">→ Jira</span>
          )}
        </div>
        <span className="mc-expand">{expanded ? '▲' : '▼'}</span>
      </div>

      <p className="mc-subject">{item.subject || '(sin asunto)'}</p>
      <p className="mc-from">{item.from}</p>

      {expanded && (
        <div className="mc-detail">
          {item.snippet && <p className="mc-snippet">"{item.snippet}"</p>}
          {item.ai_reason && (
            <p className="mc-ai-reason">🤖 {item.ai_reason}</p>
          )}
          {item.client && (
            <p className="mc-client-info">
              🏢 {item.client.name} · {Array.isArray(item.client.empresa) ? item.client.empresa.join(' + ') : item.client.empresa}
            </p>
          )}
        </div>
      )}

      {/* Phishing warning banner */}
      {isEstafa && (
        <div className="mc-phishing-banner">
          <span>⚠ Posible estafa — dominio remitente no coincide con la marca</span>
        </div>
      )}

      <div className="mc-item-footer">
        <span className="mc-accion" style={{ color: CAT_COLOR[item.category] }}>
          {item.accion_sugerida}
        </span>

        {!decided ? (
          <div className="mc-actions">
            {/* Phishing report button — always first for estafa */}
            {isEstafa && (
              <button
                className="mc-btn mc-btn-phishing"
                onClick={handleReportPhishing}
                disabled={reporting}
                title="Denunciar a Google y bloquear dominio en Jarvis"
              >
                {reporting ? '⟳ Denunciando...' : '🚨 Denunciar phishing'}
              </button>
            )}
            {!isEstafa && (
              <button className="mc-btn mc-btn-approve" onClick={() => onApprove(item.thread_id)}>
                {actions.approve_label}
              </button>
            )}
            <button className="mc-btn mc-btn-reject" onClick={() => onReject(item.thread_id)}>
              {isEstafa ? 'No es estafa' : actions.reject_label}
            </button>
            {/* Third option: reclassify */}
            <div className="mc-reclassify-wrap">
              <button
                className="mc-btn mc-btn-reclassify"
                onClick={() => setReclassifying(r => !r)}
                title="Jarvis se equivocó — cambiar categoría"
              >
                ✎
              </button>
              {reclassifying && (
                <div className="mc-reclassify-menu">
                  <p className="mc-reclassify-label">Mover a:</p>
                  {ALL_CATS.filter(([id]) => id !== item.category).map(([id, label]) => (
                    <button
                      key={id}
                      className="mc-reclassify-option"
                      style={{ '--cat-c': CAT_COLOR[id] }}
                      onClick={() => {
                        onReclassify(item.thread_id, id);
                        setReclassifying(false);
                      }}
                    >
                      <span className="mc-reclassify-dot" />
                      {label}
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="mc-actions">
            {reportResult ? (
              <span className="mc-phishing-reported">✓ {reportResult}</span>
            ) : (
              <span className={`mc-status ${approved ? 'mc-status-ok' : 'mc-status-skip'}`}>
                {approved ? `✓ ${actions.approve_label}` : `✕ ${actions.reject_label}`}
              </span>
            )}
            <button className="mc-btn mc-btn-undo" onClick={() => onReclassify(item.thread_id, item.category)}>
              ↩
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MailClassifier() {
  const { data, loading, classifying, error, classify, approve, approveAll, reclassify, reportPhishing } = useMailInbox();
  const [filter, setFilter] = useState(null);
  const [hours, setHours] = useState(48);

  const items      = data?.items || [];
  const filtered   = filter ? items.filter(i => i.category === filter) : items;
  const needsAction = items.filter(i => i.needs_action && i.aprobado === null).length;
  const pendingCount = items.filter(i => i.aprobado === null).length;

  return (
    <div className="mail-classifier">
      {/* Header */}
      <div className="mc-header">
        <div className="mc-header-left">
          {data && (
            <div className="mc-summary">
              <span className="mc-total">{data.total} emails</span>
              {needsAction > 0 && (
                <span className="mc-needs-action">· {needsAction} requieren acción</span>
              )}
              {pendingCount > 0 && (
                <span className="mc-pending">· {pendingCount} sin decidir</span>
              )}
              {data.classified_at && (
                <span className="mc-age">
                  · clasificado {new Date(data.classified_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="mc-header-right">
          <select
            className="mc-hours-select"
            value={hours}
            onChange={e => setHours(Number(e.target.value))}
          >
            <option value={12}>12h</option>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
            <option value={168}>7 días</option>
          </select>
          <button
            className="mc-classify-btn"
            onClick={() => classify(hours)}
            disabled={classifying}
          >
            {classifying ? '⟳ Clasificando...' : '⟳ Clasificar'}
          </button>
          {data && pendingCount > 0 && (
            <button className="mc-approve-all-btn" onClick={() => approveAll(null, 'approve')}>
              ✓ Aprobar todo
            </button>
          )}
        </div>
      </div>

      {error && <div className="mc-error">{error}</div>}

      {/* Category filter bar */}
      {data && (
        <CategoryBar
          counts={data.by_category || {}}
          onFilter={setFilter}
          activeFilter={filter}
          onApproveAll={approveAll}
        />
      )}

      {/* Action legend for active filter */}
      {filter && <ActionLegend category={filter} />}

      {/* Loading / empty states */}
      {(loading || classifying) && (
        <div className="mc-loading">
          <div className="spinner" />
          <span>{classifying ? 'Clasificando con IA...' : 'Cargando...'}</span>
        </div>
      )}

      {!loading && !classifying && !data && (
        <div className="mc-empty">
          <p>No hay clasificaciones aún.</p>
          <p className="mc-empty-sub">Selecciona un rango de horas y pulsa "Clasificar".</p>
          <button className="mc-classify-btn" onClick={() => classify(hours)}>
            ⟳ Clasificar ahora
          </button>
        </div>
      )}

      {/* Email list */}
      {!classifying && filtered.length > 0 && (
        <div className="mc-list">
          {/* Needs action first */}
          {filtered.filter(i => i.needs_action).map(item => (
            <MailItem
              key={item.thread_id}
              item={item}
              onApprove={id => approve(id, 'approve')}
              onReject={id => approve(id, 'reject')}
              onReclassify={(id, cat) => reclassify(id, cat)}
              onReportPhishing={reportPhishing}
            />
          ))}
          {filtered.filter(i => !i.needs_action).map(item => (
            <MailItem
              key={item.thread_id}
              item={item}
              onApprove={id => approve(id, 'approve')}
              onReject={id => approve(id, 'reject')}
              onReclassify={(id, cat) => reclassify(id, cat)}
              onReportPhishing={reportPhishing}
            />
          ))}
        </div>
      )}

      {!classifying && data && filtered.length === 0 && (
        <div className="mc-empty">Sin emails en esta categoría.</div>
      )}
    </div>
  );
}
