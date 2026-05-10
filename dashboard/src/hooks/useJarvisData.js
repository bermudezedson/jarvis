import { useState, useEffect, useCallback, useRef } from 'react';

const REFRESH_MS = 5 * 60 * 1000;
const API = 'http://localhost:3000/api';

export function useJarvisData() {
  const [dashboardData, setDashboardData] = useState(null);
  const [loading, setLoading]   = useState(true);
  const [error, setError]       = useState(null);
  const [lastRefresh, setLastRefresh] = useState(null);
  const [viewMode, setViewMode] = useState('current');
  const intervalRef = useRef(null);

  const fetchDashboard = useCallback(async (mode) => {
    const type = mode || viewMode;
    try {
      setLoading(true);
      const res = await fetch(`${API}/dashboard?type=${type}`);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = await res.json();
      setDashboardData(json);
      setLastRefresh(new Date());
      setError(null);
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  }, [viewMode]);

  useEffect(() => {
    fetchDashboard(viewMode);

    intervalRef.current = setInterval(async () => {
      // Recalculate severities with zero Gmail cost
      try {
        await fetch(`${API}/mail/client-scan`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'refresh_states' }),
        });
      } catch {}
      await fetchDashboard(viewMode);
    }, REFRESH_MS);

    return () => clearInterval(intervalRef.current);
  }, [viewMode, fetchDashboard]);

  const refresh = useCallback(async () => {
    // Universal scan: fetch ALL inbox threads, not just known clients
    try {
      await fetch(`${API}/mail/universal-scan`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ timeWindowMinutes: 90 }),
      });
    } catch {}
    // Refresh daily briefing (Calendar, Jira, etc.)
    try {
      await fetch(`${API}/briefing/refresh`, { method: 'POST' });
    } catch {}
    await fetchDashboard(viewMode);
  }, [fetchDashboard, viewMode]);

  return {
    // Individual data slices for components
    briefing:      dashboardData?.briefing      ?? null,
    clientThreads: dashboardData?.client_threads ?? null,
    commitments:   dashboardData?.commitments   ?? null,
    clientPulse:   dashboardData?.client_pulse  ?? null,
    // Legacy: expose `data` as briefing for any remaining component that uses it
    data:          dashboardData?.briefing      ?? null,
    loading,
    error,
    lastRefresh,
    viewMode,
    setViewMode,
    refresh,
    hasRealData: dashboardData?.has_real_data ?? false,
  };
}
