import { useState, useEffect } from 'react';

const API = 'http://localhost:3000/api';

export function useSprintData() {
  const [data,    setData]    = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState(null);

  async function load() {
    setLoading(true);
    try {
      const res  = await fetch(`${API}/agent/sprint-summary`);
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => { load(); }, []);

  return { data, loading, error, refresh: load };
}
