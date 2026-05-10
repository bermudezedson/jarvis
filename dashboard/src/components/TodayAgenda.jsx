export default function TodayAgenda({ events, deepWorkSlots }) {
  const hasData = (events?.length > 0) || (deepWorkSlots?.length > 0);

  if (!hasData) {
    return (
      <div className="today-agenda">
        <div className="agenda-title">Agenda de hoy</div>
        <div className="agenda-empty">Sin eventos — ejecutar briefing para cargar Calendar.</div>
      </div>
    );
  }

  const now = new Date();

  function eventStatus(event) {
    if (!event.start) return 'upcoming';
    const start = new Date(event.start);
    const diffMin = (start - now) / 60000;
    if (diffMin < -60)  return 'past';
    if (diffMin < 15)   return 'now';
    if (diffMin < 60)   return 'soon';
    return 'upcoming';
  }

  const statusLabel = { past: '', now: '● AHORA', soon: '⏱ pronto', upcoming: '' };

  return (
    <div className="today-agenda">
      <div className="agenda-title">Agenda de hoy</div>

      {events?.length > 0
        ? events.map((ev, i) => {
            const st = eventStatus(ev);
            return (
              <div key={i} className={`agenda-event agenda-${st}`}>
                <span className="agenda-time">{ev.start_time}</span>
                <div className="agenda-event-body">
                  <span className="agenda-name">{ev.title}</span>
                  {ev.attendees_count > 1 && (
                    <span className="agenda-attendees">{ev.attendees_count} pers.</span>
                  )}
                </div>
                {statusLabel[st] && <span className="agenda-status-tag">{statusLabel[st]}</span>}
              </div>
            );
          })
        : <div className="agenda-empty">Sin reuniones hoy.</div>
      }

      {deepWorkSlots?.map((slot, i) => {
        const hours = Math.round((slot.duration_minutes / 60) * 10) / 10;
        return (
          <div key={`dw-${i}`} className="agenda-deep-work">
            <span className="agenda-dw-icon">◈</span>
            <span className="agenda-dw-range">{slot.start}–{slot.end}</span>
            <span className="agenda-dw-duration">{hours}h libre</span>
          </div>
        );
      })}
    </div>
  );
}
