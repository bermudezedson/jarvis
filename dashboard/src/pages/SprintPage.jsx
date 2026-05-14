import { useSprintData } from '../hooks/useSprintData';
import SprintCard from '../components/SprintCard';

export default function SprintPage() {
  const { data, loading, refresh } = useSprintData();

  return (
    <div className="page-container">
      <div className="page-header">
        <h2 className="page-title">Sprint activo</h2>
        <button className="ctl-btn" onClick={refresh} style={{ fontSize: '11px' }}>↻ Actualizar</button>
      </div>

      <div style={{ maxWidth: '800px' }}>
        <SprintCard data={data} loading={loading} />
      </div>

      <div className="page-placeholder-note">
        Tablero Kanban completo con drag-and-drop disponible próximamente
      </div>
    </div>
  );
}
