import { useState } from 'react';
import { useMailInbox } from '../hooks/useMailInbox';

// ─── Category metadata ────────────────────────────────────────────────────────

const CAT_LABEL = {
  solicitud_cliente: 'Cliente',
  seguimiento:       'Seguimiento',
  factura:           'Factura',
  cuenta_por_pagar:  'Cuenta x Pagar',
  pago_recibido:     'Pago Recibido',
  cobro_pendiente:   'Cobro Pendiente',
  estafa:            'Estafa',
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
  pago_recibido:     'var(--green)',
  cobro_pendiente:   'var(--iron-red)',
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

// ─── Email lifecycle estado ───────────────────────────────────────────────────

const ESTADO_CONFIG = {
  pendiente:          { label: 'Pendiente',           color: 'var(--muted)',      icon: '○' },
  esperando_cliente:  { label: 'Esperando cliente',   color: 'var(--iron-gold)',  icon: '⏳' },
  esperando_nosotros: { label: 'Acción requerida',    color: 'var(--iron-red)',   icon: '●' },
  en_jira:            { label: 'En Jira',             color: 'var(--purple)',     icon: '◈' },
  archivado:          { label: 'Archivado',           color: 'var(--muted)',      icon: '✓' },
};

// Categories that support lifecycle tracking (client-facing threads)
const LIFECYCLE_CATS = new Set(['solicitud_cliente', 'seguimiento', 'factura', 'cuenta_por_pagar', 'cobro_pendiente']);

// ─── Contextual actions per category ─────────────────────────────────────────

const CAT_ACTIONS = {
  solicitud_cliente: {
    approve_label: '→ Crear Jira',
    reject_label:  'Archivar',
    tip: 'Crear Jira: genera una tarea en Jira con el hilo adjunto. Archivar: revisado, sin tarea.',
  },
  seguimiento: {
    approve_label: '✓ Gestionar',
    reject_label:  'Archivar',
    tip: 'Gestionar: queda en tu lista de pendientes. Archivar: ya fue atendido.',
  },
  factura: {
    approve_label: '✓ Registrada',
    reject_label:  'Archivar',
    tip: 'Registrada: la factura se anota como recibida. Archivar: ya procesada.',
  },
  cuenta_por_pagar: {
    approve_label: '💳 Gestionar',
    reject_label:  'Ignorar',
    tip: 'Gestionar: queda en lista de pagos pendientes. Ignorar: cargo ya resuelto.',
  },
  pago_recibido: {
    approve_label: '✓ Registrado',
    reject_label:  'Ignorar',
    tip: 'Registrado: confirmas que recibiste el pago. Útil para reconciliación contable.',
  },
  cobro_pendiente: {
    approve_label: '📞 Gestionar cobro',
    reject_label:  'Ya pagado',
    tip: 'Gestionar cobro: queda en lista de seguimiento financiero. Ya pagado: si el cliente ya canceló.',
  },
  estafa: {
    approve_label: '🚨 Denunciar phishing',
    reject_label:  'No es estafa',
    tip: 'Denunciar: envía a spam en Gmail y bloquea el dominio en Jarvis.',
  },
  envio: {
    approve_label: '📦 Seguir envío',
    reject_label:  'Archivar',
    tip: 'Seguir envío: lista de envíos activos. Archivar: si ya fue recibido.',
  },
  suscripcion: {
    approve_label: '✓ Mantener',
    reject_label:  '✕ Cancelar',
    tip: 'Mantener: conforme con esta suscripción. Cancelar: agrega a lista de bajas.',
  },
  spam: {
    approve_label: '🚫 Confirmar spam',
    reject_label:  'No es spam',
    tip: 'Confirmar: limpia tu bandeja. No es spam: si Jarvis se equivocó, usa ✎ para reclasificar.',
  },
  notificacion: {
    approve_label: '✓ Visto',
    reject_label:  'Ignorar',
    tip: 'Visto: confirma lectura. No genera ninguna acción adicional.',
  },
  interno: {
    approve_label: '✓ Visto',
    reject_label:  'Ignorar',
    tip: 'Correo interno — visto o ignorar si no requiere atención.',
  },
  otro: {
    approve_label: '🔍 Revisar',
    reject_label:  'Ignorar',
    tip: 'Revisar: atención manual. Ignorar: no requiere acción.',
  },
};

const DEFAULT_ACTIONS = { approve_label: '✓ Aprobar', reject_label: '✕ Ignorar', tip: '' };

const ALL_CATS = Object.entries(CAT_LABEL);

// ─── Category summary bar ─────────────────────────────────────────────────────

function CategoryBar({ counts, onFilter, activeFilter, onApproveAll }) {
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  return (
    <div className="mc-catbar">
      <button className={`mc-cat-btn ${!activeFilter ? 'active' : ''}`} onClick={() => onFilter(null)}>
        Todos <span className="mc-cat-count">{total}</span>
      </button>
      {Object.entries(counts).sort((a, b) => b[1] - a[1]).map(([cat, n]) => (
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

// ─── Estado (lifecycle) filter bar ───────────────────────────────────────────

function EstadoBar({ counts, onFilter, activeFilter }) {
  if (!counts) return null;
  const hasData = Object.entries(counts).some(([k, v]) => k !== 'pendiente' && v > 0);
  if (!hasData) return null;

  return (
    <div className="mc-estado-bar">
      {Object.entries(ESTADO_CONFIG).map(([estado, cfg]) => {
        const n = counts[estado] || 0;
        if (n === 0 && estado === 'pendiente') return null;
        if (n === 0) return null;
        return (
          <button
            key={estado}
            className={`mc-estado-btn ${activeFilter === estado ? 'active' : ''}`}
            style={{ '--estado-color': cfg.color }}
            onClick={() => onFilter(activeFilter === estado ? null : estado)}
            title={cfg.label}
          >
            <span className="mc-estado-icon">{cfg.icon}</span>
            {cfg.label}
            <span className="mc-cat-count">{n}</span>
          </button>
        );
      })}
    </div>
  );
}

// ─── Action legend ────────────────────────────────────────────────────────────

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

// ─── Reclassify menu ─────────────────────────────────────────────────────────

function ReclassifyMenu({ currentCat, onSelect, onClose }) {
  return (
    <div className="mc-reclassify-menu">
      <p className="mc-reclassify-label">Mover a:</p>
      {ALL_CATS.filter(([id]) => id !== currentCat).map(([id, label]) => (
        <button
          key={id}
          className="mc-reclassify-option"
          style={{ '--cat-c': CAT_COLOR[id] }}
          onClick={() => { onSelect(id); onClose(); }}
        >
          <span className="mc-reclassify-dot" />
          {label}
        </button>
      ))}
    </div>
  );
}

// ─── Estado selector (lifecycle) ─────────────────────────────────────────────

function EstadoSelector({ currentEstado, onSelect, onClose }) {
  return (
    <div className="mc-reclassify-menu mc-estado-selector">
      <p className="mc-reclassify-label">Estado del hilo:</p>
      {Object.entries(ESTADO_CONFIG).map(([estado, cfg]) => (
        <button
          key={estado}
          className={`mc-reclassify-option ${currentEstado === estado ? 'mc-option-active' : ''}`}
          style={{ '--cat-c': cfg.color }}
          onClick={() => { onSelect(estado); onClose(); }}
        >
          <span style={{ color: cfg.color, marginRight: 4 }}>{cfg.icon}</span>
          {cfg.label}
          {currentEstado === estado && <span style={{ marginLeft: 'auto', color: 'var(--muted)', fontSize: 10 }}>actual</span>}
        </button>
      ))}
    </div>
  );
}

// ─── Individual email item ────────────────────────────────────────────────────

function MailItem({ item, onApprove, onReject, onReclassify, onSetStatus, onReportPhishing }) {
  const [expanded,      setExpanded]      = useState(false);
  const [showRecat,     setShowRecat]     = useState(false);
  const [showEstado,    setShowEstado]    = useState(false);
  const [reporting,     setReporting]     = useState(false);
  const [reportResult,  setReportResult]  = useState(null);

  const approved  = item.aprobado === true;
  const rejected  = item.aprobado === false;
  const decided   = item.aprobado !== null;
  const actions   = CAT_ACTIONS[item.category] || DEFAULT_ACTIONS;
  const isEstafa  = item.category === 'estafa';
  const isSpam    = item.category === 'spam';
  const hasLifecycle = LIFECYCLE_CATS.has(item.category);
  const estado    = item.estado || 'pendiente';
  const estadoCfg = ESTADO_CONFIG[estado] || ESTADO_CONFIG.pendiente;
  const isWaiting = estado === 'esperando_cliente';

  async function handleReport() {
    setReporting(true);
    try {
      const result = await onReportPhishing(item.thread_id);
      setReportResult(result?.message || 'Denunciado en Gmail');
    } catch { setReportResult('Error al denunciar'); }
    finally  { setReporting(false); }
  }

  return (
    <div className={`mc-item
      ${decided ? (approved ? 'mc-approved' : 'mc-rejected') : ''}
      ${isWaiting ? 'mc-waiting' : ''}
      ${estado === 'esperando_nosotros' ? 'mc-needs-us' : ''}
    `}>
      {/* Header row */}
      <div className="mc-item-header" onClick={() => setExpanded(e => !e)}>
        <div className="mc-item-meta">
          <span className="mc-sev-dot" style={{ background: SEV_COLOR[item.severity] }} />
          <span className="mc-cat-badge" style={{ color: CAT_COLOR[item.category] }}>
            {CAT_LABEL[item.category] || item.category}
          </span>
          {item.client && <span className="mc-client-badge">{item.client.name}</span>}
          {item.jira_suggested && <span className="mc-jira-badge">→ Jira</span>}
          {estado !== 'pendiente' && (
            <span className="mc-estado-badge" style={{ color: estadoCfg.color }}>
              {estadoCfg.icon} {estadoCfg.label}
            </span>
          )}
        </div>
        <span className="mc-expand">{expanded ? '▲' : '▼'}</span>
      </div>

      <p className="mc-subject">{item.subject || '(sin asunto)'}</p>
      <p className="mc-from">{item.from}</p>

      {expanded && (
        <div className="mc-detail">
          {item.snippet   && <p className="mc-snippet">"{item.snippet}"</p>}
          {item.ai_reason && <p className="mc-ai-reason">🤖 {item.ai_reason}</p>}
          {item.client    && (
            <p className="mc-client-info">
              🏢 {item.client.name} · {Array.isArray(item.client.empresa)
                ? item.client.empresa.join(' + ')
                : item.client.empresa}
            </p>
          )}
        </div>
      )}

      {isEstafa && (
        <div className="mc-phishing-banner">
          ⚠ Posible estafa — dominio remitente no coincide con la marca
        </div>
      )}

      {/* Footer: actions */}
      <div className="mc-item-footer">
        <span className="mc-accion" style={{ color: CAT_COLOR[item.category] }}>
          {item.accion_sugerida}
        </span>

        <div className="mc-actions">
          {/* ── Primary action ── */}
          {!decided && !isEstafa && (
            <button className="mc-btn mc-btn-approve" onClick={() => onApprove(item.thread_id)}>
              {actions.approve_label}
            </button>
          )}
          {!decided && isEstafa && (
            <button
              className="mc-btn mc-btn-phishing"
              onClick={handleReport}
              disabled={reporting}
            >
              {reporting ? '⟳...' : '🚨 Denunciar phishing'}
            </button>
          )}

          {/* ── Secondary / reject ── */}
          {!decided && (
            <button className="mc-btn mc-btn-reject" onClick={() => onReject(item.thread_id)}>
              {actions.reject_label}
            </button>
          )}

          {/* ── Decided state ── */}
          {decided && !reportResult && (
            <span className={`mc-status ${approved ? 'mc-status-ok' : 'mc-status-skip'}`}>
              {approved ? `✓ ${actions.approve_label}` : `✕ ${actions.reject_label}`}
            </span>
          )}
          {reportResult && <span className="mc-phishing-reported">✓ {reportResult}</span>}

          {/* ── Lifecycle estado button (all client threads) ── */}
          {hasLifecycle && (
            <div className="mc-reclassify-wrap">
              <button
                className="mc-btn mc-btn-estado"
                onClick={() => { setShowEstado(v => !v); setShowRecat(false); }}
                style={{ '--estado-c': estadoCfg.color }}
                title="Cambiar estado del hilo (quién tiene la pelota)"
              >
                {estadoCfg.icon}
              </button>
              {showEstado && (
                <EstadoSelector
                  currentEstado={estado}
                  onSelect={s => onSetStatus(item.thread_id, s)}
                  onClose={() => setShowEstado(false)}
                />
              )}
            </div>
          )}

          {/* ── Reclassify ✎ — ALWAYS visible ── */}
          <div className="mc-reclassify-wrap">
            <button
              className="mc-btn mc-btn-reclassify"
              onClick={() => { setShowRecat(v => !v); setShowEstado(false); }}
              title="Categoría incorrecta — cambiar"
            >
              ✎
            </button>
            {showRecat && (
              <ReclassifyMenu
                currentCat={item.category}
                onSelect={cat => onReclassify(item.thread_id, cat)}
                onClose={() => setShowRecat(false)}
              />
            )}
          </div>

          {/* ── Undo ── */}
          {decided && (
            <button className="mc-btn mc-btn-undo" onClick={() => onReclassify(item.thread_id, item.category)} title="Deshacer">
              ↩
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function MailClassifier() {
  const {
    data, loading, classifying, error,
    classify, approve, approveAll, reclassify, setStatus, reportPhishing,
  } = useMailInbox();

  const [catFilter,    setCatFilter]    = useState(null);
  const [estadoFilter, setEstadoFilter] = useState(null);
  const [hours,        setHours]        = useState(48);

  const items = data?.items || [];

  // Apply both filters
  const filtered = items
    .filter(i => !catFilter    || i.category === catFilter)
    .filter(i => !estadoFilter || (i.estado || 'pendiente') === estadoFilter);

  const needsAction  = items.filter(i => i.needs_action && i.aprobado === null).length;
  const pendingCount = items.filter(i => i.aprobado === null).length;
  const waitingCount = items.filter(i => i.estado === 'esperando_cliente').length;

  return (
    <div className="mail-classifier">
      {/* ── Header ── */}
      <div className="mc-header">
        <div className="mc-header-left">
          {data && (
            <div className="mc-summary">
              <span className="mc-total">{data.total} emails</span>
              {needsAction  > 0 && <span className="mc-needs-action">· {needsAction} requieren acción</span>}
              {waitingCount > 0 && <span className="mc-waiting-count">· {waitingCount} esperando cliente</span>}
              {data.excluded > 0 && <span className="mc-excluded">· {data.excluded} ERP ignorados</span>}
              {data.classified_at && (
                <span className="mc-age">
                  · {new Date(data.classified_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' })}
                </span>
              )}
            </div>
          )}
        </div>
        <div className="mc-header-right">
          <select className="mc-hours-select" value={hours} onChange={e => setHours(Number(e.target.value))}>
            <option value={12}>12h</option>
            <option value={24}>24h</option>
            <option value={48}>48h</option>
            <option value={168}>7 días</option>
          </select>
          <button className="mc-classify-btn" onClick={() => classify(hours)} disabled={classifying}>
            {classifying ? '⟳ Clasificando...' : '⟳ Clasificar'}
          </button>
          {pendingCount > 0 && (
            <button className="mc-approve-all-btn" onClick={() => approveAll(null, 'approve')}>
              ✓ Aprobar todo
            </button>
          )}
        </div>
      </div>

      {error && <div className="mc-error">{error}</div>}

      {/* ── Category filter ── */}
      {data && (
        <CategoryBar
          counts={data.by_category || {}}
          onFilter={f => { setCatFilter(f); setEstadoFilter(null); }}
          activeFilter={catFilter}
          onApproveAll={approveAll}
        />
      )}

      {/* ── Lifecycle estado filter ── */}
      {data && (
        <EstadoBar
          counts={data.by_estado}
          onFilter={setEstadoFilter}
          activeFilter={estadoFilter}
        />
      )}

      {/* ── Action legend ── */}
      {catFilter && <ActionLegend category={catFilter} />}

      {/* ── Loading ── */}
      {(loading || classifying) && (
        <div className="mc-loading">
          <div className="spinner" />
          <span>{classifying ? 'Clasificando con IA...' : 'Cargando...'}</span>
        </div>
      )}

      {!loading && !classifying && !data && (
        <div className="mc-empty">
          <p>No hay clasificaciones aún.</p>
          <p className="mc-empty-sub">Selecciona un rango y pulsa Clasificar.</p>
          <button className="mc-classify-btn" onClick={() => classify(hours)}>⟳ Clasificar ahora</button>
        </div>
      )}

      {/* ── Email list — needs_action first ── */}
      {!classifying && filtered.length > 0 && (
        <div className="mc-list">
          {filtered.filter(i => i.needs_action).map(item => (
            <MailItem key={item.thread_id} item={item}
              onApprove={id => approve(id, 'approve')}
              onReject={id => approve(id, 'reject')}
              onReclassify={(id, cat) => reclassify(id, cat)}
              onSetStatus={(id, s) => setStatus(id, s)}
              onReportPhishing={reportPhishing}
            />
          ))}
          {filtered.filter(i => !i.needs_action).map(item => (
            <MailItem key={item.thread_id} item={item}
              onApprove={id => approve(id, 'approve')}
              onReject={id => approve(id, 'reject')}
              onReclassify={(id, cat) => reclassify(id, cat)}
              onSetStatus={(id, s) => setStatus(id, s)}
              onReportPhishing={reportPhishing}
            />
          ))}
        </div>
      )}

      {!classifying && data && filtered.length === 0 && (
        <div className="mc-empty">Sin emails con este filtro.</div>
      )}
    </div>
  );
}
