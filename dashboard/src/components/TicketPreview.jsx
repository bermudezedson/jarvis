import { useState, useEffect } from 'react';

const API = 'http://localhost:3000/api';

export default function TicketPreview({ actionId, threadId, onCreated, onCancel }) {
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [preview,  setPreview]  = useState(null);
  const [options,  setOptions]  = useState(null);
  const [related,  setRelated]  = useState([]);
  const [linked,   setLinked]   = useState(null);
  const [error,    setError]    = useState(null);
  const [success,  setSuccess]  = useState(null);

  // Form state (mirrors preview fields, editable)
  const [form, setForm] = useState(null);

  // Load preview on mount
  useEffect(() => {
    fetch(`${API}/agent/action/${actionId}/prepare-ticket`, { method: 'POST' })
      .then(r => r.json())
      .then(data => {
        if (data.error) { setError(data.error); setLoading(false); return; }
        setPreview(data.preview);
        setOptions(data.options);
        setRelated(data.related_tickets || []);
        setLinked(data.already_linked || null);
        setForm({
          summary:     data.preview.summary     || '',
          description:  data.preview.description      || '',
          projectKey:   data.preview.project?.key    || 'CLICK',
          issueType:    data.preview.issueType       || 'Tarea',
          priority:     data.preview.priority        || 'Medium',
          assignee:     data.preview.assignee?.name  || '',
          labels:       (data.preview.labels || []).join(', '),
          timeEstimate: data.preview.timeEstimate    || '1h',
          sprintId:     data.preview.sprint?.id != null ? String(data.preview.sprint.id) : '',
        });
        setLoading(false);
      })
      .catch(e => { setError(e.message); setLoading(false); });
  }, [actionId]);

  function set(field) {
    return e => setForm(prev => ({ ...prev, [field]: e.target.value }));
  }

  async function handleCreate() {
    setCreating(true);
    setError(null);
    try {
      const labels = form.labels
        .split(',')
        .map(l => l.trim())
        .filter(Boolean);

      const res  = await fetch(`${API}/agent/action/${actionId}/create-ticket`, {
        method:  'POST',
        headers: { 'Content-Type': 'application/json' },
        body:    JSON.stringify({
          summary:      form.summary,
          description:  form.description,
          projectKey:   form.projectKey,
          issueType:    form.issueType,
          priority:     form.priority,
          assignee:     form.assignee    || null,
          labels,
          timeEstimate: form.timeEstimate || null,
          sprintId:     form.sprintId    ? Number(form.sprintId) : null,
        }),
      });
      const data = await res.json();
      if (data.success) {
        setSuccess(data.ticket);
        if (onCreated) onCreated(data.ticket);
      } else {
        setError(data.error || 'Error al crear el ticket');
      }
    } catch (e) {
      setError(e.message);
    } finally {
      setCreating(false);
    }
  }

  // ── Render ──────────────────────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="tp-wrap">
        <div className="tp-loading">⏳ Preparando ticket...</div>
      </div>
    );
  }

  if (success) {
    return (
      <div className="tp-wrap">
        <div className="tp-success">
          ✅ Ticket <a href={success.url} target="_blank" rel="noreferrer" className="tp-ticket-link">{success.key}</a> creado en Jira
          <button className="tp-btn tp-btn-cancel" onClick={onCancel} style={{ marginLeft: 12 }}>Cerrar</button>
        </div>
      </div>
    );
  }

  if (linked) {
    return (
      <div className="tp-wrap">
        <div className="tp-already-linked">
          ⚠️ Ya existe ticket <a href={linked.url} target="_blank" rel="noreferrer" className="tp-ticket-link">{linked.key}</a> para este correo.
          <button className="tp-btn tp-btn-cancel" onClick={onCancel} style={{ marginLeft: 12 }}>Cerrar</button>
        </div>
      </div>
    );
  }

  if (!form) return null;

  return (
    <div className="tp-wrap" onClick={e => e.stopPropagation()}>
      <div className="tp-header">
        <span className="tp-title">🎫 Crear ticket en Jira</span>
        <button className="tp-btn tp-btn-cancel tp-close" onClick={onCancel}>×</button>
      </div>

      {error && <div className="tp-error">{error}</div>}

      {/* Related tickets warning */}
      {related.length > 0 && (
        <div className="tp-related">
          <span className="tp-related-label">⚠️ Tickets similares:</span>
          {related.map(t => (
            <span key={t.key} className="tp-related-item">
              <a href={t.url} target="_blank" rel="noreferrer" className="tp-ticket-link">{t.key}</a>
              {' — '}{t.summary.substring(0, 60)}{t.summary.length > 60 ? '…' : ''}{' '}
              <span className="tp-related-status">({t.status}{t.assignee ? ', ' + t.assignee : ''})</span>
            </span>
          ))}
        </div>
      )}

      <div className="tp-form">
        {/* Summary */}
        <div className="tp-field tp-field-full">
          <label className="tp-label">Título</label>
          <input className="tp-input" value={form.summary} onChange={set('summary')} />
        </div>

        {/* Row: Project + IssueType */}
        <div className="tp-row">
          <div className="tp-field">
            <label className="tp-label">Proyecto</label>
            <select className="tp-select" value={form.projectKey} onChange={set('projectKey')}>
              {(options?.projects || []).map(p => (
                <option key={p.key} value={p.key}>{p.key} — {p.name}</option>
              ))}
            </select>
          </div>
          <div className="tp-field">
            <label className="tp-label">Tipo</label>
            <select className="tp-select" value={form.issueType} onChange={set('issueType')}>
              {(options?.issueTypes || ['Tarea', 'Historia', 'Error']).map(t => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Sprint */}
        <div className="tp-field tp-field-full">
          <label className="tp-label">Sprint</label>
          <select className="tp-select" value={form.sprintId} onChange={set('sprintId')}>
            {(options?.sprints || [{ id: null, name: 'Backlog (sin sprint)' }]).map(s => (
              <option key={s.id ?? 'backlog'} value={s.id ?? ''}>
                {s.state === 'active' ? '▶ ' : ''}{s.name}
              </option>
            ))}
          </select>
        </div>

        {/* Row: Priority + Assignee */}
        <div className="tp-row">
          <div className="tp-field">
            <label className="tp-label">Prioridad</label>
            <select className="tp-select" value={form.priority} onChange={set('priority')}>
              {(options?.priorities || ['High', 'Medium', 'Low']).map(p => (
                <option key={p} value={p}>{p}</option>
              ))}
            </select>
          </div>
          <div className="tp-field">
            <label className="tp-label">Asignado a</label>
            <select className="tp-select" value={form.assignee} onChange={set('assignee')}>
              <option value="">— Sin asignar —</option>
              {(options?.assignees || []).map(a => (
                <option key={a.name} value={a.name}>{a.display}</option>
              ))}
            </select>
          </div>
        </div>

        {/* Row: Time Estimate + Labels */}
        <div className="tp-row">
          <div className="tp-field" style={{ flex: '0 0 140px' }}>
            <label className="tp-label">Tiempo estimado</label>
            <select className="tp-select" value={form.timeEstimate} onChange={set('timeEstimate')}>
              {['30m','1h','2h','4h','8h','1d','2d','3d'].map(v => (
                <option key={v} value={v}>{v}</option>
              ))}
            </select>
          </div>
          <div className="tp-field">
            <label className="tp-label">Etiquetas <span className="tp-label-hint">(separadas por coma)</span></label>
            <input className="tp-input" value={form.labels} onChange={set('labels')} placeholder="client-repuestosdelsol, feature-request" />
          </div>
        </div>

        {/* Description */}
        <div className="tp-field tp-field-full">
          <label className="tp-label">Descripción</label>
          <textarea className="tp-textarea" rows={6} value={form.description} onChange={set('description')} />
        </div>
      </div>

      <div className="tp-actions">
        <button
          className="tp-btn tp-btn-create"
          onClick={handleCreate}
          disabled={creating || !form.summary.trim()}
        >
          {creating ? '⏳ Creando...' : '✅ Crear ticket'}
        </button>
        <button className="tp-btn tp-btn-cancel" onClick={onCancel}>Cancelar</button>
        {preview?.gmail_link && (
          <a href={preview.gmail_link} target="_blank" rel="noreferrer" className="tp-btn tp-btn-gmail">
            Gmail ↗
          </a>
        )}
      </div>
    </div>
  );
}
