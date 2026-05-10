import { useState, useCallback, useEffect } from 'react';

const API = 'http://localhost:3000/api';

function recountByCategory(items) {
  const counts = {};
  items.forEach(i => { counts[i.category] = (counts[i.category] || 0) + 1; });
  return counts;
}

export function useMailInbox() {
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(false);
  const [classifying, setClassifying] = useState(false);
  const [error, setError] = useState(null);

  const fetchInbox = useCallback(async () => {
    try {
      setLoading(true);
      const res = await fetch(`${API}/mail/inbox`);
      const json = await res.json();
      setData(json.classified === false ? null : json);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  const classify = useCallback(async (hours = 48) => {
    try {
      setClassifying(true);
      setError(null);
      const res = await fetch(`${API}/mail/classify`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ hours }),
      });
      const json = await res.json();
      setData(json);
    } catch (e) {
      setError(e.message);
    } finally {
      setClassifying(false);
    }
  }, []);

  const approve = useCallback(async (threadId, action) => {
    await fetch(`${API}/mail/approve`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, action }),
    });
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map(i =>
          i.thread_id === threadId ? { ...i, aprobado: action === 'approve' } : i
        ),
      };
    });
  }, []);

  const setStatus = useCallback(async (threadId, estado) => {
    await fetch(`${API}/mail/set-status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, estado }),
    });
    setData(prev => {
      if (!prev) return prev;
      const items = prev.items.map(i => i.thread_id === threadId ? { ...i, estado } : i);
      const byEstado = { pendiente: 0, esperando_cliente: 0, esperando_nosotros: 0, en_jira: 0, archivado: 0 };
      items.forEach(i => { byEstado[i.estado || 'pendiente'] = (byEstado[i.estado || 'pendiente'] || 0) + 1; });
      return { ...prev, items, by_estado: byEstado };
    });
  }, []);

  const reportPhishing = useCallback(async (threadId) => {
    const res = await fetch(`${API}/mail/report-phishing`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId }),
    });
    const json = await res.json();
    // Mark as rejected in local state
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map(i =>
          i.thread_id === threadId ? { ...i, aprobado: false } : i
        ),
      };
    });
    return json;
  }, []);

  const reclassify = useCallback(async (threadId, newCategory) => {
    await fetch(`${API}/mail/reclassify`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ thread_id: threadId, category: newCategory }),
    });
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map(i =>
          i.thread_id === threadId
            ? { ...i, category: newCategory, aprobado: null }   // reset decision too
            : i
        ),
        by_category: recountByCategory(prev.items.map(i =>
          i.thread_id === threadId ? { ...i, category: newCategory } : i
        )),
      };
    });
  }, []);

  const approveAll = useCallback(async (category, action) => {
    await fetch(`${API}/mail/approve-all`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, action }),
    });
    setData(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        items: prev.items.map(i =>
          !category || i.category === category ? { ...i, aprobado: action !== 'reject' } : i
        ),
      };
    });
  }, []);

  useEffect(() => { fetchInbox(); }, [fetchInbox]);

  return { data, loading, classifying, error, classify, approve, approveAll, reclassify, setStatus, reportPhishing, refetch: fetchInbox };
}
