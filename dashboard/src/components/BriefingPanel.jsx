const SOURCE_LABEL = { ok: '✓', error: '✗', mock: '~' };
const SOURCE_CLASS = { ok: 'source-ok', error: 'source-error', mock: 'source-mock' };

export default function BriefingPanel({ data }) {
  if (!data) return null;

  const { generated_at, type, is_mock, sources, deep_work_slots } = data;
  const genTime = generated_at ? new Date(generated_at).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' }) : null;

  return (
    <div className="briefing-panel">
      <div className="briefing-meta">
        <span className="briefing-type">{type === 'morning' ? 'Briefing matutino' : 'Cierre del día'}</span>
        {genTime && <span className="briefing-time">Generado {genTime}</span>}
        {is_mock && <span className="mock-badge">DEMO</span>}
      </div>
      {sources && (
        <div className="briefing-sources">
          {Object.entries(sources).map(([src, status]) => (
            <span key={src} className={`source-tag ${SOURCE_CLASS[status] || ''}`}>
              {SOURCE_LABEL[status]} {src}
            </span>
          ))}
        </div>
      )}
      {deep_work_slots?.length > 0 && (
        <div className="deep-work">
          <span className="deep-work-label">Trabajo profundo:</span>
          {deep_work_slots.map((s, i) => (
            <span key={i} className="deep-work-slot">{s.start}–{s.end} ({s.duration_minutes}min)</span>
          ))}
        </div>
      )}
    </div>
  );
}
