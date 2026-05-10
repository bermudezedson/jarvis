import { useState, useEffect, useCallback, useRef } from 'react';

const REFRESH_MS = 5 * 60 * 1000;

export function useJarvisData() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [viewMode, setViewMode] = useState('current');
  const intervalRef = useRef(null);

  const fetchData = useCallback(async (mode) => {
    const endpoint = {
      current: '/api/briefing/current',
      morning: '/api/briefing/morning',
      evening: '/api/briefing/evening',
    }[mode || viewMode] || '/api/briefing/current';

    try {
      setLoading(true);
      const res = await fetch(endpoint);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setData(await res.json());
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  useEffect(() => {
    fetchData(viewMode);
    intervalRef.current = setInterval(() => fetchData(viewMode), REFRESH_MS);
    return () => clearInterval(intervalRef.current);
  }, [viewMode, fetchData]);

  const refresh = useCallback(async () => {
    try {
      await fetch('/api/briefing/refresh', { method: 'POST' });
    } catch {
      // refresh endpoint best-effort
    }
    await fetchData(viewMode);
  }, [fetchData, viewMode]);

  return { data, loading, error, lastRefresh, viewMode, setViewMode, refresh };
}
