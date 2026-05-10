const TYPE_LABELS = { client: 'Cliente', followup: 'Seguimiento', task: 'Jira', internal: 'Interno' };
const SEV_CLASS = { high: 'sev-red', medium: 'sev-yellow', low: 'sev-green' };

function InboxItem({ item, onAction }) {
  return (
    <div className={`inbox-item ${SEV_CLASS[item.severity] || ''}`}>
      <div className="inbox-item-header">
        <span className={`inbox-badge badge-${item.type}`}>{TYPE_LABELS[item.type] || item.type}</span>
        <span className={`inbox-dot dot-${item.severity}`} />
        <span className="inbox-age">{item.age_days}d</span>
      </div>
      <p className="inbox-summary">{item.summary}</p>
      {item.suggested_action && (
        <div className="inbox-footer">
          <span className="inbox-action-hint">{item.suggested_action}</span>
          <button className="inbox-btn" onClick={() => onAction(item)}>
            Ver {item.source === 'jira' ? 'en Jira' : 'correo'}
          </button>
        </div>
      )}
    </div>
  );
}

export default function ExecutiveInbox({ items }) {
  function handleAction(item) {
    if (item.source === 'jira') {
      window.open(`https://webyseo.atlassian.net/browse/${item.thread_id}`, '_blank');
    }
  }

  if (!items.length) {
    return <div className="inbox-empty">Bandeja limpia — sin items que requieren atención.</div>;
  }

  return (
    <div className="executive-inbox">
      {items.map(item => (
        <InboxItem key={item.id} item={item} onAction={handleAction} />
      ))}
    </div>
  );
}
