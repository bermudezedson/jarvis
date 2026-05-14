import { useState, useEffect, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';

const API = 'http://localhost:3000/api';

const ESTADO_DOT = {
  requiere_mi_accion: 'dot-red',
  esperando_nosotros: 'dot-red',
  pendiente:          'dot-orange',
  esperando_cliente:  'dot-blue',
  informativo:        'dot-gray',
  en_jira:            'dot-blue',
  solucionado:        'dot-green',
  archivado:          'dot-gray',
};

function ageDays(dateStr) {
  if (!dateStr) return null;
  const d = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86400000);
  return d;
}

function useDebounce(value, ms) {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export default function GlobalSearch({ onOpenThread }) {
  const [query,    setQuery]    = useState('');
  const [results,  setResults]  = useState(null);
  const [loading,  setLoading]  = useState(false);
  const [focused,  setFocused]  = useState(false);
  const inputRef   = useRef(null);
  const dropRef    = useRef(null);
  const navigate   = useNavigate();
  const debouncedQ = useDebounce(query, 300);

  // Fetch results when debounced query changes
  useEffect(() => {
    if (debouncedQ.length < 3) { setResults(null); return; }
    setLoading(true);
    fetch(`${API}/search?q=${encodeURIComponent(debouncedQ)}`)
      .then(r => r.json())
      .then(d => setResults(d))
      .catch(() => setResults(null))
      .finally(() => setLoading(false));
  }, [debouncedQ]);

  // Cmd+K / Ctrl+K global shortcut
  useEffect(() => {
    const h = e => {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        inputRef.current?.focus();
        inputRef.current?.select();
      }
    };
    window.addEventListener('keydown', h);
    return () => window.removeEventListener('keydown', h);
  }, []);

  // Close on click outside
  useEffect(() => {
    const h = e => {
      if (dropRef.current && !dropRef.current.contains(e.target) &&
          inputRef.current && !inputRef.current.contains(e.target)) {
        setFocused(false);
      }
    };
    document.addEventListener('mousedown', h);
    return () => document.removeEventListener('mousedown', h);
  }, []);

  function close() { setFocused(false); setQuery(''); setResults(null); }

  function handleKeyDown(e) {
    if (e.key === 'Escape') { close(); inputRef.current?.blur(); }
  }

  function openThread(thread) {
    close();
    if (onOpenThread) onOpenThread(thread);
  }

  function goTo(path) { close(); navigate(path); }

  const showDrop = focused && (loading || results !== null || query.length >= 3);

  return (
    <div className="gsearch-wrapper">
      <div className={`gsearch-input-wrap ${focused ? 'gsearch-input-wrap--focused' : ''}`}>
        <span className="gsearch-icon">🔍</span>
        <input
          ref={inputRef}
          className="gsearch-input"
          type="text"
          placeholder="Buscar correo, cliente o tarea…"
          value={query}
          onChange={e => setQuery(e.target.value)}
          onFocus={() => setFocused(true)}
          onKeyDown={handleKeyDown}
          autoComplete="off"
          spellCheck={false}
        />
        {query && (
          <button className="gsearch-clear" onClick={() => { setQuery(''); setResults(null); inputRef.current?.focus(); }}>✕</button>
        )}
        <span className="gsearch-shortcut">⌘K</span>
      </div>

      {showDrop && (
        <div className="gsearch-dropdown" ref={dropRef}>
          {loading && <div className="gsearch-loading">Buscando…</div>}

          {!loading && results?.not_found_message_id && (
            <div className="gsearch-not-found">
              <div className="gsearch-nf-title">Message-ID no encontrado en Jarvis</div>
              <div className="gsearch-nf-hint">{results.suggestion}</div>
            </div>
          )}

          {!loading && results && !results.not_found_message_id && results.total === 0 && (
            <div className="gsearch-empty">
              <div>Sin resultados para <strong>"{query}"</strong></div>
              <div className="gsearch-empty-hint">¿No aparece? Usa ↻ Actualizar para escanear Gmail.</div>
            </div>
          )}

          {!loading && results?.threads?.length > 0 && (
            <div className="gsearch-section">
              <div className="gsearch-section-label">CORREOS ({results.threads.length})</div>
              {results.threads.map(t => {
                const dot  = ESTADO_DOT[t.estado] || 'dot-gray';
                const days = ageDays(t.date);
                return (
                  <button key={t.thread_id} className="gsearch-result" onClick={() => openThread(t)}>
                    <span className={`email-dot ${dot}`} style={{ flexShrink: 0, marginTop: 3 }} />
                    <div className="gsearch-result-body">
                      <span className="gsearch-result-client">{t.client_name || t.last_from_email?.split('@')[1] || '?'}</span>
                      <span className="gsearch-result-subject">{(t.subject || '').substring(0, 60)}</span>
                    </div>
                    <div className="gsearch-result-right">
                      {t.jira_issue_key
                        ? <span className="email-jira-key">{t.jira_issue_key}</span>
                        : <span className={`gsearch-estado gsearch-estado--${t.estado}`}>{t.estado?.replace(/_/g, ' ')}</span>
                      }
                      {days !== null && <span className="gsearch-age">{days === 0 ? 'hoy' : `${days}d`}</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {!loading && results?.clients?.length > 0 && (
            <div className="gsearch-section">
              <div className="gsearch-section-label">CLIENTES ({results.clients.length})</div>
              {results.clients.map(c => (
                <button key={c.name} className="gsearch-result" onClick={() => goTo('/clientes')}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>◈</span>
                  <div className="gsearch-result-body">
                    <span className="gsearch-result-client">{c.name}</span>
                    <span className="gsearch-result-subject">
                      {Array.isArray(c.empresa) ? c.empresa.join(', ') : c.empresa}
                      {c.domains?.length > 0 && ` · ${c.domains[0]}`}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          )}

          {!loading && results?.actions?.length > 0 && (
            <div className="gsearch-section">
              <div className="gsearch-section-label">TAREAS ({results.actions.length})</div>
              {results.actions.map(a => (
                <button key={a.id} className="gsearch-result" onClick={() => goTo('/tareas')}>
                  <span style={{ fontSize: 14, flexShrink: 0 }}>⊞</span>
                  <div className="gsearch-result-body">
                    <span className="gsearch-result-client">{a.client_name || a.thread_subject}</span>
                    <span className="gsearch-result-subject">{(a.description || '').substring(0, 60)}</span>
                  </div>
                  <span className={`gsearch-estado gsearch-estado--${a.status}`}>{a.status}</span>
                </button>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}
