import { useState, useEffect } from 'react';

const API = 'http://localhost:3000/api';

export function useAlerts() {
  const [alerts,  setAlerts]  = useState([]);
  const [loading, setLoading] = useState(false);

  async function load() {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/agent/alerts`);
      const json = await res.json();
      setAlerts(json.alerts || []);
    } catch { /* silent */ }
    finally { setLoading(false); }
  }

  useEffect(() => { load(); }, []);

  return { alerts, loading, refresh: load };
}
