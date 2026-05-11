import { useState, useEffect } from 'react';

const API = 'http://localhost:3000/api';

function formatDate(iso) {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-CL', { day: 'numeric', month: 'short', year: 'numeric' });
}

// ─── Inline edit form for a learned rule ─────────────────────────────────────

function RuleEditForm({ rule, onSave, onCancel }) {
  const [pattern,   setPattern]   = useState(rule.pattern);
  const [matchType, setMatchType] = useState(rule.match_type || 'subject');
  const [action,    setAction]    = useState(rule.action    || 'informativo');
  const [saving,    setSaving]    = useState(false);

  async function save() {
    if (!pattern.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${API}/mail/learned-rules/${rule.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          pattern, match_type: matchType, action,
          category: action === 'informativo' ? 'informativo' : action,
          active: rule.active,
        }),
      });
      const data = await res.json();
      if (data.success) onSave({ ...rule, pattern, match_type: matchType, action });
    } catch { /* silent */ }
    setSaving(false);
  }

  return (
    <div className="rule-edit-form" onClick={e => e.stopPropagation()}>
      <label className="rule-edit-label">Patrón</label>
      <input
        className="rule-edit-input"
        value={pattern}
        onChange={e => setPattern(e.target.value)}
        onKeyDown={e => { if (e.key === 'Enter') save(); if (e.key === 'Escape') onCancel(); }}
        autoFocus
      />
      <div className="rule-edit-row">
        <div>
          <label className="rule-edit-label">Aplica en</label>
          <select className="rule-edit-select" value={matchType} onChange={e => setMatchType(e.target.value)}>
            <option value="subject">Asunto</option>
            <option value="from">Remitente</option>
            <option value="subject+from">Asunto + Remitente</option>
          </select>
        </div>
        <div>
          <label className="rule-edit-label">Acción</label>
          <select className="rule-edit-select" value={action} onChange={e => setAction(e.target.value)}>
            <option value="informativo">Informativo</option>
            <option value="archivado">Archivar</option>
            <option value="requiere_mi_accion">Requiere acción</option>
          </select>
        </div>
      </div>
      <div className="rule-edit-actions">
        <button className="rule-btn rule-btn-save" onClick={save} disabled={saving}>
          {saving ? '…' : '✓ Guardar'}
        </button>
        <button className="rule-btn rule-btn-cancel" onClick={onCancel}>Cancelar</button>
      </div>
    </div>
  );
}

// ─── Single learned rule row ──────────────────────────────────────────────────

function LearnedRuleRow({ rule: initialRule, onDelete }) {
  const [rule,     setRule]     = useState(initialRule);
  const [editing,  setEditing]  = useState(false);
  const [toggling, setToggling] = useState(false);
  const [deleting, setDeleting] = useState(false);

  async function toggle() {
    setToggling(true);
    try {
      await fetch(`${API}/mail/learned-rules/${rule.id}`, {
        method:  'PUT',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({ active: !rule.active }),
      });
      setRule(r => ({ ...r, active: !r.active }));
    } catch { /* silent */ }
    setToggling(false);
  }

  async function confirmDelete() {
    if (!window.confirm(`¿Eliminar la regla "${rule.pattern}"?\nSe aplicó ${rule.times_applied} vece${rule.times_applied !== 1 ? 's' : ''}.`)) return;
    setDeleting(true);
    try {
      await fetch(`${API}/mail/learned-rules/${rule.id}`, { method: 'DELETE' });
      onDelete(rule.id);
    } catch { /* silent */ }
    setDeleting(false);
  }

  const actionLabel = {
    informativo: 'Informativo',
    archivado:   'Archivar',
    requiere_mi_accion: 'Requiere acción',
  }[rule.action] || rule.action;

  return (
    <div className={`learned-rule-row ${rule.active ? '' : 'rule-inactive'}`}>
      {editing ? (
        <RuleEditForm
          rule={rule}
          onSave={updated => { setRule(updated); setEditing(false); }}
          onCancel={() => setEditing(false)}
        />
      ) : (
        <>
          <div className="rule-row-main">
            <button
              className={`rule-toggle ${rule.active ? 'on' : 'off'}`}
              onClick={toggle}
              disabled={toggling}
              title={rule.active ? 'Desactivar' : 'Activar'}
            >
              {toggling ? '…' : rule.active ? '●' : '○'}
            </button>
            <div className="rule-row-content">
              <div className="rule-row-pattern">
                <span className="rule-pattern-text">"{rule.pattern}"</span>
                <span className="rule-arrow"> → </span>
                <span className={`rule-action-badge action-${rule.action}`}>{actionLabel}</span>
                <span className="rule-match-type">{rule.match_type}</span>
                <span className="rule-matches">{rule.times_applied}×</span>
              </div>
              {rule.origin && (
                <div className="rule-origin" title={rule.origin}>
                  {rule.origin}
                </div>
              )}
              {rule.example_thread && (
                <div className="rule-example">
                  Correo origen: "{rule.example_thread.subject}" — {rule.example_thread.from?.split('<')[0].trim()} ({formatDate(rule.example_thread.date)})
                </div>
              )}
            </div>
          </div>
          <div className="rule-row-actions">
            <button className="rule-btn rule-btn-edit"   onClick={() => setEditing(true)}>✏ Editar</button>
            <button className="rule-btn rule-btn-delete" onClick={confirmDelete} disabled={deleting}>
              {deleting ? '…' : '🗑 Eliminar'}
            </button>
          </div>
        </>
      )}
    </div>
  );
}

// ─── Expandable chip list ─────────────────────────────────────────────────────

function ChipList({ items, emptyMsg }) {
  const [expanded, setExpanded] = useState(false);
  if (!items?.length) return <div className="rules-empty">{emptyMsg || 'Ninguno.'}</div>;
  const visible = expanded ? items : items.slice(0, 5);
  return (
    <div className="chip-list">
      {visible.map((item, i) => (
        <span key={i} className="rules-chip">"{item}"</span>
      ))}
      {items.length > 5 && (
        <button className="chip-expand-btn" onClick={() => setExpanded(v => !v)}>
          {expanded ? 'Ver menos' : `+${items.length - 5} más`}
        </button>
      )}
    </div>
  );
}

// ─── Collapsible section ──────────────────────────────────────────────────────

function Section({ title, badge, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rules-section">
      <button className="rules-section-title" onClick={() => setOpen(v => !v)}>
        <span>{open ? '▼' : '▶'} {title}</span>
        {badge != null && <span className="rules-section-badge">{badge}</span>}
      </button>
      {open && <div className="rules-section-body">{children}</div>}
    </div>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export default function RulesPanel({ onClose }) {
  const [data,      setData]      = useState(null);
  const [loading,   setLoading]   = useState(true);
  const [deduping,  setDeduping]  = useState(false);
  const [dedupeMsg, setDedupeMsg] = useState(null);

  function loadData() {
    fetch(`${API}/mail/rules-full`)
      .then(r => r.json())
      .then(d => { setData(d); setLoading(false); })
      .catch(() => setLoading(false));
  }

  useEffect(() => { loadData(); }, []);

  function handleDeleteRule(id) {
    setData(prev => ({
      ...prev,
      learned_rules: prev.learned_rules.filter(r => r.id !== id),
    }));
  }

  async function deduplicate() {
    setDeduping(true);
    try {
      const res  = await fetch(`${API}/mail/learned-rules/deduplicate`, { method: 'POST' });
      const resp = await res.json();
      setDedupeMsg(resp.message);
      loadData();
      setTimeout(() => setDedupeMsg(null), 5000);
    } catch { setDedupeMsg('Error al deduplicar'); }
    setDeduping(false);
  }

  const cfg    = data?.config_rules || {};
  const sm     = data?.state_machine_rules || {};
  const rules  = data?.learned_rules || [];
  const active = rules.filter(r => r.active).length;

  return (
    <div className="rules-overlay" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div className="rules-panel">

        {/* Header */}
        <div className="rules-header">
          <div className="rules-title-group">
            <span className="rules-title">Reglas de Jarvis</span>
            {data && (
              <span className="rules-stats">
                {rules.length} reglas aprendidas ({active} activas)
              </span>
            )}
          </div>
          <button className="rules-close" onClick={onClose}>×</button>
        </div>

        {loading && <div className="rules-loading">Cargando...</div>}

        {!loading && data && (
          <div className="rules-body">

            {/* ── Sección 1: Reglas aprendidas ── */}
            <Section title="Reglas aprendidas (del feedback)" badge={rules.length} defaultOpen>
              <div className="rules-dedup-bar">
                <button
                  className="rule-btn rule-btn-dedup"
                  onClick={deduplicate}
                  disabled={deduping}
                  title="Eliminar reglas duplicadas automáticamente"
                >
                  {deduping ? '…' : '⟳ Deduplicar'}
                </button>
                {dedupeMsg && <span className="rules-dedup-msg">{dedupeMsg}</span>}
              </div>
              {rules.length === 0 ? (
                <div className="rules-empty">
                  Sin reglas aprendidas. Usa "✎ Corregir" en cualquier correo para enseñarle a Jarvis.
                </div>
              ) : (
                <div className="rules-list">
                  {rules.map(rule => (
                    <LearnedRuleRow key={rule.id} rule={rule} onDelete={handleDeleteRule} />
                  ))}
                </div>
              )}
            </Section>

            {/* ── Sección 2: Patrones informativos (no-action) ── */}
            <Section title="Patrones automáticos (informativo)" badge={cfg.no_action_patterns?.patterns?.length || 0}>
              <p className="rules-section-desc">{cfg.no_action_patterns?.description}</p>
              <ChipList items={cfg.no_action_patterns?.patterns} />
            </Section>

            {/* ── Sección 3: Patrones de descarte (ERP / sistema) ── */}
            <Section title="Patrones de descarte" badge={cfg.exclude_patterns?.patterns?.length || 0}>
              <p className="rules-section-desc">{cfg.exclude_patterns?.description}</p>
              <ChipList items={cfg.exclude_patterns?.patterns} />
            </Section>

            {/* ── Sección 4: Dominios bloqueados ── */}
            <Section
              title="Dominios bloqueados"
              badge={(cfg.spam_domains?.domains?.length || 0) + (cfg.blacklist?.discard_domains?.length || 0)}
            >
              <p className="rules-section-desc">{cfg.spam_domains?.description}</p>
              <div className="rules-subsection-label">Spam domains (config)</div>
              <ChipList items={cfg.spam_domains?.domains} />
              {(cfg.blacklist?.discard_domains?.length || 0) > 0 && (
                <>
                  <div className="rules-subsection-label" style={{ marginTop: 8 }}>Silenciados manualmente</div>
                  <ChipList items={cfg.blacklist.discard_domains} />
                </>
              )}
              {(cfg.blacklist?.discard_subjects?.length || 0) > 0 && (
                <>
                  <div className="rules-subsection-label" style={{ marginTop: 8 }}>Patrones de asunto silenciados</div>
                  <ChipList items={cfg.blacklist.discard_subjects} />
                </>
              )}
            </Section>

            {/* ── Sección 5: Proveedores conocidos ── */}
            <Section title="Proveedores conocidos" badge={cfg.providers?.items?.length || 0}>
              <p className="rules-section-desc">{cfg.providers?.description}</p>
              <div className="providers-list">
                {(cfg.providers?.items || []).map((prov, i) => (
                  <div key={i} className="provider-row">
                    <div className="provider-name">{prov.name}</div>
                    <div className="provider-domains">{prov.domains?.join(', ')}</div>
                    <div className="provider-alerts">
                      Alertas: {prov.alert_keywords?.slice(0, 5).map(k => `"${k}"`).join(', ')}
                      {prov.alert_keywords?.length > 5 ? ` +${prov.alert_keywords.length - 5}` : ''}
                    </div>
                  </div>
                ))}
              </div>
            </Section>

            {/* ── Sección 6: Keywords de prioridad ── */}
            <Section title="Keywords de prioridad (urgente)" badge={cfg.priority_keywords?.keywords?.length || 0}>
              <p className="rules-section-desc">{cfg.priority_keywords?.description}</p>
              <ChipList items={cfg.priority_keywords?.keywords} />
            </Section>

            {/* ── Sección 7: Reglas de estado automáticas ── */}
            <Section title="Reglas automáticas de estado">
              <div className="rules-auto-list">
                <div className="rules-auto-item">
                  <span className="rules-auto-icon">🗃</span>
                  Informativos se auto-archivan tras <strong>{sm.informativo_auto_archive_days} días</strong> sin actividad
                </div>
                <div className="rules-auto-item">
                  <span className="rules-auto-icon">⏫</span>
                  Facturas sin respuesta pasan a Pendientes tras <strong>{sm.invoice_days_without_response_to_pending} días</strong>
                </div>
                <div className="rules-auto-item">
                  <span className="rules-auto-icon">⚡</span>
                  Esperando cliente escala a urgente tras <strong>{sm.waiting_escalation_days} días</strong>
                </div>
                {sm.auto_resolve_keywords?.length > 0 && (
                  <div className="rules-auto-item">
                    <span className="rules-auto-icon">✓</span>
                    Auto-resolver si snippet contiene: {sm.auto_resolve_keywords.slice(0, 3).map(k => `"${k}"`).join(', ')}
                    {sm.auto_resolve_keywords.length > 3 ? ` +${sm.auto_resolve_keywords.length - 3}` : ''}
                  </div>
                )}
              </div>
            </Section>

          </div>
        )}
      </div>
    </div>
  );
}
