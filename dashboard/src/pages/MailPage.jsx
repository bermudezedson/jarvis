import { useState, useEffect, useCallback } from 'react';
import { useJarvis } from '../contexts/JarvisContext';
import EmailList from '../components/EmailList';
import MailModal from '../components/MailModal';
import { pushNotification } from '../hooks/useNotifications';

const API = 'http://localhost:3000/api';

export default function MailPage() {
  const { clientThreads, threadMetrics, refresh } = useJarvis();
  const [selectedThread,  setSelectedThread]  = useState(null);
  const [localItems,      setLocalItems]      = useState(null);
  const [uncategorized,   setUncategorized]   = useState(null);
  const [uncatLoading,    setUncatLoading]    = useState(false);
  const [silenceMsg,      setSilenceMsg]      = useState(null);

  // Sync local items from context
  useEffect(() => {
    if (clientThreads?.items) setLocalItems(clientThreads.items);
  }, [clientThreads]);

  // Load uncategorized threads
  useEffect(() => {
    if (uncategorized !== null) return;
    setUncatLoading(true);
    fetch(`${API}/mail/uncategorized`)
      .then(r => r.json())
      .then(d => setUncategorized(d.items || []))
      .catch(() => setUncategorized([]))
      .finally(() => setUncatLoading(false));
  }, []);

  const items = localItems || clientThreads?.items || [];

  const handleTransition = useCallback(async (thread_id, newEstado, note = '') => {
    setLocalItems(prev => (prev || items).map(t => {
      if (t.thread_id !== thread_id) return t;
      const updates = { estado: newEstado };
      if (['solucionado','archivado'].includes(newEstado)) updates.severity = 'none';
      return { ...t, ...updates };
    }));
    setSelectedThread(null);
    try {
      await fetch(`${API}/mail/thread/${thread_id}/transition`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ estado: newEstado, note }),
      });
    } catch {}
  }, [items]);

  const handleSpam = useCallback((thread_id, data) => {
    setLocalItems(prev => (prev || items).filter(t => t.thread_id !== thread_id));
    setUncategorized(prev => prev ? prev.filter(t => t.thread_id !== thread_id) : prev);
    setSelectedThread(null);
    const msg = data?.domainBlocked
      ? `✅ Spam. Dominio ${data.domain} bloqueado.`
      : '✅ Marcado como spam.';
    pushNotification(msg, 'success');
    setSilenceMsg(msg);
    setTimeout(() => setSilenceMsg(null), 4000);
  }, [items]);

  const handleFeedback = useCallback(() => {}, []);

  return (
    <div className="mail-page">
      {silenceMsg && <div className="ctl-batch-msg ctl-silence-msg">{silenceMsg}</div>}

      <EmailList
        clientThreads={{ ...clientThreads, items }}
        threadMetrics={threadMetrics}
        uncategorized={uncatLoading ? null : uncategorized}
        onOpenThread={setSelectedThread}
      />

      {selectedThread && (
        <MailModal
          thread={selectedThread}
          onClose={() => setSelectedThread(null)}
          onTransition={handleTransition}
          onSpam={handleSpam}
          onFeedback={handleFeedback}
          isInformativo={selectedThread.estado === 'informativo'}
        />
      )}
    </div>
  );
}
